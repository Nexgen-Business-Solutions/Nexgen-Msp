"""When a reminder is owed, on whose clock, and when it is owed nothing.

A reminder is not a timer. It is a question asked of a business record — is this still
waiting? — and the answer has to be read again every time, because the thing it reminds
about may have been settled an hour ago. Everything here therefore starts from the record
and ends at an instant in UTC, with the administrator's own timezone applied in between.

Two rules govern the arithmetic, and both exist because of real failures:

A reminder dated before the rule was switched on is not owed. Otherwise enabling a rule
mails a year of history in one tick, which is the first thing anybody notices and the last
thing they forgive.

A local time that does not exist, or happens twice, still yields exactly one send. The
hour a clock skips in spring and repeats in autumn is where a reminder engine quietly
sends double or nothing at all.
"""

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.api.internal.services.notification_dispatch_service import (
    ATTESTED_NOT_SENT,
    RENDER_FAILED,
    NotificationDispatchService,
)
from nexgen_msp.api.internal.services.notification_settings_service import (
    NotificationSettingsService,
)
from nexgen_msp.utils import notifications

DISPATCH = "MSP Notification Dispatch"

UNIT_DAYS = {"Hours": 0, "Days": 1, "Weeks": 7}

# why a record is not being reminded about, in words an administrator can act on
REASONS = {
    "eligible": "Due now",
    "not_due": "Not due yet",
    "max_reached": "The maximum number of reminders has been sent",
    "resolved": "The record no longer matches the condition",
    "quiet_hours": "Deferred until the quiet period ends",
    "before_activation": "Waiting for the first send under the current settings",
    "disabled": "This reminder is switched off",
}

BATCH = 200

# how far past the first page one tick will look. Bounded so a rule with a hundred thousand
# waiting records cannot hold the scheduler, and wide enough that nothing waits for ever
SCAN_PAGES = 25


def _zone(name):
    from zoneinfo import ZoneInfo

    try:
        return ZoneInfo(name or frappe.utils.get_system_timezone())
    except Exception:
        return ZoneInfo("UTC")


def _site_zone():
    return _zone(frappe.utils.get_system_timezone())


def _aware(value, zone):
    """A stored timestamp as an instant, read on the site's clock as Frappe wrote it."""
    moment = frappe.utils.get_datetime(value)

    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=_site_zone())

    return moment.astimezone(zone)


def _localise(naive, zone):
    """One real instant for a local wall-clock time, even when the clock lied.

    Spring forward leaves an hour that never happens: a reminder dated inside it is moved
    to the first instant that does exist. Autumn repeats an hour: the first of the two is
    taken, always, so a sequence cannot produce the same iteration twice.
    """
    attempt = naive.replace(tzinfo=zone, fold=0)
    round_trip = attempt.astimezone(_zone("UTC")).astimezone(zone)

    if round_trip.replace(tzinfo=None) == naive:
        return attempt

    # the local time does not exist: walk forward to the first one that does
    import datetime

    for minutes in range(0, 24 * 60, 15):
        moved = naive + datetime.timedelta(minutes=minutes)
        candidate = moved.replace(tzinfo=zone, fold=0)

        if candidate.astimezone(_zone("UTC")).astimezone(zone).replace(tzinfo=None) == moved:
            return candidate

    return attempt


def _utc(moment):
    """The same instant, said in UTC, which is the only way to compare two of them.

    Python compares two aware datetimes by their wall-clock fields when their `tzinfo` is
    the *same object* — and `ZoneInfo` hands out cached instances, so it usually is. Across
    a clock change that is wrong: half past two on the morning the clocks go forward is
    half past seven UTC, which is later than three o'clock, which is seven. Compared as
    wall times it reads as earlier, and a reminder goes out thirty minutes before it is due.
    """
    import datetime

    return moment.astimezone(datetime.timezone.utc)


def _add(moment, value, unit, zone):
    """A calendar offset, applied on the administrator's own clock.

    Three days means the same wall-clock time three days later, not seventy-two hours:
    those differ by an hour twice a year, and the one people mean is the clock. An hour,
    on the other hand, means an hour — so it is added to the instant rather than to the
    clock face, which on the morning the clocks go forward are not the same thing.
    """
    import datetime

    value = frappe.utils.cint(value)

    if unit == "Hours":
        return (_utc(moment) + datetime.timedelta(hours=value)).astimezone(zone)

    local = moment.astimezone(zone).replace(tzinfo=None)
    moved = local + datetime.timedelta(days=value * UNIT_DAYS.get(unit, 1))

    return _localise(moved, zone)


class NotificationReminderService:
    # ------------------------------------------------------------------ eligibility
    @staticmethod
    def _anchor(adapter, row):
        for field in adapter.get("anchor_fields", ("creation",)):
            if row.get(field):
                return row[field]

        return row.get("creation")

    @staticmethod
    def _candidates(adapter, limit=None, after=None, start=0, stop_key=None):
        """A page of records this condition watches, read from a place rather than an offset.

        An offset shifts under its own feet: records leave the status while the walk is
        going on, and page two then begins somewhere page one already was. A place in the
        order — the oldest record after the last one looked at — cannot do that.
        """
        watched = registry.watch_filters(adapter, stop_key)
        fields = ["name", "customer", "requester", "status", "creation"] + [
            field
            for field in adapter.get("anchor_fields", ())
            if field not in ("creation",)
        ]

        if not after:
            return frappe.get_all(
                adapter["doctype"],
                filters=dict(watched),
                fields=sorted(set(fields)),
                order_by="creation asc, name asc",
                # a screen paging through a list wants the page the reader asked for; the
                # scheduler's own walk carries a place instead, which cannot shift under it
                start=start,
                page_length=limit or BATCH,
            )

        # the place is both halves of the order, because the first on its own is not a place:
        # two hundred and one records written in the same second share a timestamp, and
        # "after that timestamp" steps over the one left on the page boundary for ever
        moment, last = after
        table = f"tab{adapter['doctype']}"
        values = {"moment": moment, "last": last, "page": frappe.utils.cint(limit or BATCH)}
        conditions = []

        for index, (field, wanted) in enumerate(watched.items()):
            key = f"f{index}"
            conditions.append(f"`{field}` = %({key})s")
            values[key] = wanted

        where = " and ".join(conditions) or "1 = 1"

        return frappe.db.sql(
            f"""
            select {", ".join(f"`{field}`" for field in sorted(set(fields)))}
            from `{table}`
            where {where}
              and (creation > %(moment)s or (creation = %(moment)s and name > %(last)s))
            order by creation asc, name asc
            limit %(page)s
            """,
            values,
            as_dict=True,
        )

    @staticmethod
    def _cursor_key(rule_key):
        return f"msp_notification_scan_{rule_key}"

    @staticmethod
    def _cursor(rule_key):
        """Where this rule's last walk stopped, kept across restarts.

        One tick does a bounded amount of work, so a rule watching more records than that
        has to carry on where it left off — otherwise it reads the same first few thousand
        for ever and the rest are never looked at once.

        Both halves of the order are kept. A timestamp alone is not a place: records written
        in the same second share one, and a page that ends in the middle of them would never
        come back to the rest.
        """
        stored = frappe.db.get_default(NotificationReminderService._cursor_key(rule_key))

        if not stored or "\t" not in stored:
            return None

        moment, last = stored.split("\t", 1)

        return (moment, last) if moment and last else None

    @staticmethod
    def _remember(rule_key, place):
        frappe.db.set_default(
            NotificationReminderService._cursor_key(rule_key),
            f"{place[0]}\t{place[1]}" if place else "",
        )

    @staticmethod
    def _sent_iterations(rule_key, business_name):
        """What has really been sent for this record: how many, and when the last one went.

        A failed enqueue is neither of them: the maximum counts reminders the customer
        could have received, not attempts the mail server refused.
        """
        found = frappe.db.sql(
            """
            select coalesce(max(reminder_iteration), 0) as reached,
                   max(coalesce(sent_at, queued_at)) as last_at
            from `tabMSP Notification Dispatch`
            where rule = %(rule)s
              and business_name = %(record)s
              and ifnull(is_test, 0) = 0
              and status in ('Queued', 'Sent')
            """,
            {"rule": rule_key, "record": business_name},
            as_dict=True,
        )

        if not found:
            return 0, None

        return frappe.utils.cint(found[0].reached), found[0].last_at

    @staticmethod
    def _owed(rule_key, names):
        """Per record, the deliveries that never reached anybody and may be tried again.

        The record's cadence is one question and delivery is another: `max_sends` counts
        reminders about the record, so a recipient whose mail was attested as never sent
        would otherwise wait for an iteration the record will never reach again.

        Read for a whole page of records at once. Asked record by record it would be one
        query per watched record per tick, which is the scheduler's own time spent finding
        out that almost nothing is owed.
        """
        if not names:
            return {}

        rows = frappe.db.sql(
            """
            select business_name, reminder_iteration, recipient
            from `tabMSP Notification Dispatch`
            where rule = %(rule)s
              and business_name in %(records)s
              and ifnull(is_test, 0) = 0
              and status = 'Failed'
              and skip_reason in (%(attested)s, %(render)s)
            order by reminder_iteration asc, recipient asc
            """,
            {
                "rule": rule_key,
                "records": tuple(names),
                "attested": ATTESTED_NOT_SENT,
                "render": RENDER_FAILED,
            },
            as_dict=True,
        )
        out = {}

        for row in rows:
            out.setdefault(row.business_name, []).append(
                (frappe.utils.cint(row.reminder_iteration), row.recipient)
            )

        return out

    @staticmethod
    def _quiet_shift(current, moment, zone):
        """The first permitted instant at or after this one.

        A quiet period defers a reminder; it never cancels it. A send pushed out of the
        night goes in the morning, and the iteration is still the same iteration.
        """
        if not frappe.utils.cint(current.get("quiet_hours_enabled")):
            return moment, False

        start = current.get("quiet_start")
        end = current.get("quiet_end")

        if not start or not end:
            return moment, False

        import datetime

        local = moment.astimezone(zone)
        begins = frappe.utils.get_time(start)
        ends = frappe.utils.get_time(end)
        clock = local.time()
        crosses_midnight = begins > ends

        inside = (
            (clock >= begins or clock < ends) if crosses_midnight else (begins <= clock < ends)
        )

        if not inside:
            return moment, False

        day = local.date()

        # the window that ends tomorrow morning is still the window that began last night
        if crosses_midnight and clock >= begins:
            day = day + datetime.timedelta(days=1)

        return _localise(datetime.datetime.combine(day, ends), zone), True

    @staticmethod
    def state_of(rule_key, row, current, adapter, zone, now=None):
        """Everything known about one record under one rule, and why.

        The reason travels with the answer because "no reminders went out" is a question an
        administrator will ask, and the engine is the only thing that knows whether that is
        because nothing was due, because the record was settled, or because somebody
        switched the rule off.
        """
        now = _aware(now or frappe.utils.now(), zone)
        reached, _last_at = NotificationReminderService._sent_iterations(rule_key, row.name)
        maximum = frappe.utils.cint(current.get("max_sends"))

        if reached >= maximum:
            return {
                "record": row.name,
                "iteration": reached,
                "next_due": None,
                "reason": "max_reached",
                "deferred": False,
            }

        # the first reminder: the anchor plus the configured delay, and never before the
        # rule itself said so. That boundary is what stops enabling a rule from mailing
        # everything it could have mailed while it was off
        first = _add(
            _aware(NotificationReminderService._anchor(adapter, row), zone),
            current.get("initial_delay_value"),
            current.get("initial_delay_unit"),
            zone,
        )
        boundary = current.get("schedule_effective_at")

        if boundary:
            effective = _aware(boundary, zone)

            if _utc(first) < _utc(effective):
                first = effective

        # and the ones after it, each an interval from the one before — counted from that
        # first instant, not clamped to the boundary in turn. Clamping every iteration put
        # them all on the same instant, so a record older than the rule had its whole
        # allowance come due at once and went out over three consecutive ticks
        due = first

        for _ in range(reached):
            due = _add(
                due,
                current.get("repeat_interval_value"),
                current.get("repeat_interval_unit"),
                zone,
            )

        due, deferred = NotificationReminderService._quiet_shift(current, due, zone)

        return {
            "record": row.name,
            "iteration": reached,
            "next_due": due,
            "reason": "eligible"
            if _utc(due) <= _utc(now)
            else ("quiet_hours" if deferred else "not_due"),
            "deferred": deferred,
        }

    # ------------------------------------------------------------------ for the screen
    @staticmethod
    def summary(rule_key):
        """The earliest thing this rule owes, and how many records it is watching."""
        declared = registry.rule(rule_key) or {}

        if declared.get("kind") != registry.REMINDER:
            return {"next_due": None, "next_due_label": "On next valid event", "eligible_count": None}

        current = NotificationSettingsService.effective(rule_key)

        if not current["enabled"]:
            return {"next_due": None, "next_due_label": "Disabled", "eligible_count": 0}

        adapter = registry.condition(
            registry.effective_condition_key(rule_key, current.get("condition_key"))
        )
        zone = _zone(current.get("timezone"))
        rows = NotificationReminderService._candidates(
            adapter, limit=BATCH, stop_key=current.get("stop_condition_key")
        )
        states = [
            NotificationReminderService.state_of(rule_key, row, current, adapter, zone)
            for row in rows
        ]
        waiting = [state for state in states if state["next_due"]]

        if not waiting:
            return {
                "next_due": None,
                "next_due_label": "None eligible",
                "eligible_count": 0,
                "watched": len(rows),
            }

        soonest = min((state["next_due"] for state in waiting), key=_utc)

        return {
            "next_due": soonest.isoformat(),
            "next_due_label": None,
            "eligible_count": sum(1 for state in states if state["reason"] == "eligible"),
            "watched": len(rows),
            # counted over the records this read looked at, not over every one the rule
            # watches: a figure that says "all" of a page is a figure that misleads
            "partial": len(rows) >= BATCH,
        }

    @staticmethod
    def eligibility(rule_key, page=0, page_length=50):
        """Record by record, what is owed and why — the drill-down behind one rule."""
        NotificationSettingsService._guard()
        declared = registry.require(rule_key)

        if declared["kind"] != registry.REMINDER:
            return {"rows": [], "total": 0, "note": "An event notification watches no records."}

        current = NotificationSettingsService.effective(rule_key)
        adapter = registry.condition(
            registry.effective_condition_key(rule_key, current.get("condition_key"))
        )
        zone = _zone(current.get("timezone"))
        page = max(0, frappe.utils.cint(page))
        page_length = min(200, max(1, frappe.utils.cint(page_length) or 50))
        rows = NotificationReminderService._candidates(
            adapter, limit=page_length, start=page * page_length
        )
        out = []

        for row in rows:
            state = (
                {"record": row.name, "iteration": 0, "next_due": None, "reason": "disabled"}
                if not current["enabled"]
                else NotificationReminderService.state_of(
                    rule_key, row, current, adapter, zone
                )
            )
            out.append(
                {
                    "business_doctype": adapter["doctype"],
                    "business_name": row.name,
                    "customer": row.get("customer"),
                    "status": row.get("status"),
                    "iteration": state["iteration"],
                    "max_sends": frappe.utils.cint(current.get("max_sends")),
                    "next_due": state["next_due"].isoformat() if state["next_due"] else None,
                    "reason": state["reason"],
                    "reason_label": REASONS.get(state["reason"], state["reason"]),
                    "timezone": current.get("timezone"),
                    "revision": current.get("revision"),
                }
            )

        # on the first page, the records this rule has written to and that no longer match
        # it. "Why did the reminders stop" is the question this screen exists to answer, and
        # a record that quietly left the list answers it by being absent — which is no answer
        if not page:
            out += NotificationReminderService._settled(rule_key, adapter, current, out)

        return {
            "rows": out,
            "total": frappe.db.count(
                adapter["doctype"],
                registry.watch_filters(adapter, current.get("stop_condition_key")),
            ),
            "page": page,
            "page_length": page_length,
        }

    @staticmethod
    def _settled(rule_key, adapter, current, listed, limit=20):
        """Records this reminder has written to which are no longer eligible."""
        already = {row["business_name"] for row in listed}
        watched = registry.watch_filters(adapter, current.get("stop_condition_key"))
        reminded = frappe.db.sql(
            """
            select business_name, max(reminder_iteration) as iteration
            from `tabMSP Notification Dispatch`
            where rule = %(rule)s
              and ifnull(is_test, 0) = 0
              and ifnull(business_name, '') != ''
              and status in ('Queued', 'Sent')
            group by business_name
            order by max(coalesce(sent_at, queued_at)) desc
            limit %(limit)s
            """,
            {"rule": rule_key, "limit": limit},
            as_dict=True,
        )
        out = []

        for row in reminded:
            if row.business_name in already:
                continue

            if not frappe.db.exists(adapter["doctype"], row.business_name):
                continue

            still = frappe.db.get_value(
                adapter["doctype"], row.business_name, list(watched), as_dict=True
            )

            if still and all(
                f"{still.get(field)}" == f"{value}" for field, value in watched.items()
            ):
                continue

            out.append(
                {
                    "business_doctype": adapter["doctype"],
                    "business_name": row.business_name,
                    "customer": frappe.db.get_value(
                        adapter["doctype"], row.business_name, "customer"
                    ),
                    "status": (still or {}).get("status"),
                    "iteration": frappe.utils.cint(row.iteration),
                    "max_sends": frappe.utils.cint(current.get("max_sends")),
                    "next_due": None,
                    "reason": "resolved",
                    "reason_label": REASONS["resolved"],
                    "timezone": current.get("timezone"),
                    "revision": current.get("revision"),
                }
            )

        return out

    # ------------------------------------------------------------------ the tick
    @staticmethod
    def run(limit=BATCH):
        """Send what is due, for every reminder that is switched on.

        Called by the scheduler often enough for the shortest interval anybody configures.
        How often it runs is not how often anybody is reminded: the cadence is the rule's,
        and this only asks whether that cadence has come round.
        """
        NotificationSettingsService.seed()
        sent = skipped = 0

        for rule_key in registry.keys(registry.REMINDER):
            outcome = NotificationReminderService.run_one(rule_key, limit=limit)
            sent += outcome["sent"]
            skipped += outcome["skipped"]

        NotificationDispatchService.reconcile()

        return {"sent": sent, "skipped": skipped}

    @staticmethod
    def run_one(rule_key, limit=BATCH):
        declared = registry.require(rule_key)
        current = NotificationSettingsService.effective(rule_key)

        if not current["enabled"]:
            return {"sent": 0, "skipped": 0}

        adapter = registry.condition(
            registry.effective_condition_key(rule_key, current.get("condition_key"))
        )
        zone = _zone(current.get("timezone"))
        sent = skipped = 0
        after = NotificationReminderService._cursor(rule_key)

        # the walk carries on from where the last tick stopped, and wraps round when it runs
        # out. Starting from the beginning every time means a rule with more watched records
        # than one tick can read never reaches the ones at the end — they wait for ever while
        # the same first few thousand are read again and again. Scanning is cheap; what has
        # to stay bounded is the mail, so the walk also stops on work done
        for _ in range(SCAN_PAGES):
            rows = NotificationReminderService._candidates(
                adapter, limit=BATCH, after=after, stop_key=current.get("stop_condition_key")
            )

            if not rows:
                # the end of the order. The cursor goes back to the top for the next tick
                # rather than carrying on here: reading from the top again in this same
                # pass would walk the records just walked, and walk them twenty-five times
                NotificationReminderService._remember(rule_key, None)
                break

            owed = NotificationReminderService._owed(rule_key, [row.name for row in rows])

            for row in rows:
                if row.name in owed:
                    again = NotificationReminderService._redeliver(
                        declared, current, adapter, row, owed[row.name]
                    )
                    sent += again["sent"]
                    skipped += again["skipped"]

                state = NotificationReminderService.state_of(
                    rule_key, row, current, adapter, zone
                )

                if state["reason"] != "eligible":
                    skipped += 1
                    continue

                outcome = NotificationReminderService._remind(
                    declared, current, adapter, row, state["iteration"] + 1
                )
                sent += outcome["sent"]
                skipped += outcome["skipped"]

            after = (str(rows[-1].creation), rows[-1].name)
            NotificationReminderService._remember(rule_key, after)

            if sent >= limit:
                break

        return {"sent": sent, "skipped": skipped}

    @staticmethod
    def _remind(declared, current, adapter, row, iteration):
        """One iteration of one reminder, to everybody it is addressed to.

        The record is read again here, whole and fresh: between the moment it was listed as
        due and this one, somebody may have approved the very request being reminded about.
        """
        doc = frappe.get_doc(adapter["doctype"], row.name)

        if not NotificationReminderService._still_waiting(
            doc, adapter, current.get("stop_condition_key")
        ):
            NotificationSettingsService._write_audit(
                action="Skipped",
                rule=declared["rule_key"],
                rule_revision=current.get("revision"),
                business_doctype=adapter["doctype"],
                business_name=doc.name,
                reason_code="resolved",
                detail="Settled between being listed as due and being sent.",
            )

            return {"sent": 0, "skipped": 1}

        audience = current["audience_key"]
        escalating = frappe.utils.cint(current.get("escalation_after_iteration"))

        if escalating and iteration > escalating and current.get("escalation_audience_key"):
            audience = current["escalation_audience_key"]

        # who this reminder reaches: the audience the record resolves to, plus the addresses
        # an administrator added by hand. Resolved alone, an extra recipient saved in the
        # screen was stored and never written to
        addresses = []

        for address in list(registry.resolve_audience(audience, doc)) + list(
            current.get("extra") or []
        ):
            normalised = (address or "").strip().lower()

            if normalised and normalised not in addresses:
                addresses.append(normalised)

        context = NotificationReminderService._context(declared, doc, adapter)
        sent = skipped = 0

        for address in addresses:
            outcome = NotificationDispatchService.deliver(
                declared["rule_key"],
                address,
                context={
                    **context,
                    "full_name": frappe.db.get_value("User", address, "full_name") or address,
                },
                business_doctype=adapter["doctype"],
                business_name=doc.name,
                iteration=iteration,
                occurrence=f"iteration:{iteration}",
                cc=current.get("cc"),
            )

            if outcome["status"] == "Queued":
                sent += 1
            else:
                skipped += 1

        return {"sent": sent, "skipped": skipped}

    @staticmethod
    def _redeliver(declared, current, adapter, row, owed):
        """Each delivery still owed, to the address it was owed to and at its own iteration.

        The audience is not resolved again: somebody who has since left it must not receive
        an old iteration, and nothing here creates one, so the record's count is untouched.
        """
        doc = frappe.get_doc(adapter["doctype"], row.name)
        sent = skipped = 0

        if not NotificationReminderService._still_waiting(
            doc, adapter, current.get("stop_condition_key")
        ):
            return {"sent": 0, "skipped": len(owed)}

        for iteration, address in owed:
            outcome = NotificationDispatchService.deliver(
                declared["rule_key"],
                address,
                context={
                    **NotificationReminderService._context(declared, doc, adapter),
                    "full_name": frappe.db.get_value("User", address, "full_name") or address,
                },
                business_doctype=adapter["doctype"],
                business_name=doc.name,
                iteration=frappe.utils.cint(iteration),
                occurrence=f"iteration:{frappe.utils.cint(iteration)}",
                cc=current.get("cc"),
            )

            if outcome["status"] == "Queued":
                sent += 1
            else:
                skipped += 1

        return {"sent": sent, "skipped": skipped}

    @staticmethod
    def _still_waiting(doc, adapter, stop_key=None):
        """Whether the record is, right now, what made it eligible in the first place."""
        for field, value in registry.watch_filters(adapter, stop_key).items():
            if f"{doc.get(field)}" != f"{value}":
                return False

        return True

    @staticmethod
    def _context(declared, doc, adapter):
        """What the template is given, built the way the existing reminders build it."""
        if adapter["doctype"] != registry.REQUEST:
            return {"customer": doc.get("customer"), "link": notifications.portal_url()}

        lines = len(doc.get("lines") or [])

        return {
            "request": doc.name,
            "customer": doc.customer,
            "waiting_since": f"{frappe.utils.format_datetime(doc.creation)}",
            "summary": notifications.summary_table(
                [
                    ("Request", doc.name),
                    ("Lines", f"{lines}"),
                    ("Priority", doc.get("priority") or "—"),
                ]
            ),
            "acts": "",
            "headline": notifications.request_headline(doc),
            **notifications.request_briefing(doc),
            "link": notifications.portal_url(f"/requests/{doc.name}"),
        }
