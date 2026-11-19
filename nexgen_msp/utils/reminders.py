"""Reminders for the requests nobody has moved yet.

Two things stall a request, and neither of them is anybody's fault: an approver who has not
opened their mail, and a request that reached us while everybody was busy. The ones still in
that state are pointed out again, to the same people the first mail went to.

Those two conditions are still exactly what they were. What has changed is who decides when:
the cadence, the number of reminders and the point at which they stop are now the
administrator's, configured per rule, and the sending itself goes through the dispatch
records that make a reminder impossible to send twice. This file is the door the scheduler
knocks on; the two conditions themselves are declared in the notification registry, and the
engine that reads them lives beside it.

One scheduler owns each condition. The old three-hourly entry point is kept below because a
site may still hold a scheduled job row pointing at it, and it now asks the same engine the
same question — which is safe to ask twice, since what is already sent is already recorded.
"""


def tick():
    """Ask the engine whether any reminder has come round, and send what has.

    Called every ten minutes. That is polling frequency and nothing else: a rule set to
    remind every three days is reminded every three days, and the other four hundred and
    thirty ticks of those days find nothing to do and say so.
    """
    from nexgen_msp.api.internal.services.notification_reminder_service import (
        NotificationReminderService,
    )
    from nexgen_msp.api.internal.services.request_comment_service import RequestCommentService

    answer = NotificationReminderService.run()

    # a comment written while the mail could not be handed over owes its notification
    # still; the same tick is what comes back for it. What it finds is its own business:
    # this answer is the reminder engine's, and a deployed scheduler row reads it
    RequestCommentService.deliver_owed()

    return answer


def ensure_rules():
    """Put the managed notifications on the record at migration, without touching settings."""
    from nexgen_msp.api.internal.services.notification_settings_service import (
        NotificationSettingsService,
    )

    return {"created": NotificationSettingsService.seed()}


def every_three_hours():
    """The entry point a deployed scheduler row may still name, answered by the engine.

    Kept so that a site whose scheduled job has not been re-synced keeps reminding people
    rather than falling silent. It asks the same question `tick` asks, and asking twice
    sends nothing twice: an iteration already queued is already recorded against its own
    identity.
    """
    return tick()


