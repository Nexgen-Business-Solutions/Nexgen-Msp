"""Where a login lands, and the orders it must never be decided in.

Signing in used to decide destination as a side effect: our login screen was the site's
login screen, so whoever came through it was carried into our screens whether or not they
held a single role of ours. Rules make destination a decision of its own, and these hold
that decision to being deterministic — a direct exception always beats a role, a tie is
always refused rather than broken, and a destination is always re-checked against who is
actually standing at it.

The two rules the migration seeds are live on the site these tests run against, so the
rules made here are given priorities well above them. That is deliberate rather than
incidental: the seeded rules are what several of these tests fall back onto, and what they
assert is still reached when a role is taken away.
"""

import frappe

from nexgen_msp.api.core.services.login_rule_service import ROUTING_FLAG, LoginRuleService
from nexgen_msp.api.core.services.session_service import SessionService
from nexgen_msp.utils import app_visibility, gatekeeper
from nexgen_msp.utils import login_route_registry as routes

from .base import PREFIX, MSPTestCase
from .test_access_guards import RequestContextMixin

RULE = "Nexgen Login Rule"

# above the seeded Nexgen MSP rule, so these decide and it does not
HIGH = 600
LOW = 500


class LoginRuleCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)

    def make_role(self, suffix, desk_access=0):
        doc = frappe.get_doc(
            {
                "doctype": "Role",
                "role_name": f"{PREFIX} {suffix} {self.tag}",
                "desk_access": desk_access,
            }
        )
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("Role", doc.name)

    def make_rule(
        self, suffix, route="/msp", priority=LOW, enabled=1, roles=(), users=(), desk=0
    ):
        doc = frappe.new_doc(RULE)
        doc.name = f"{PREFIX} {suffix} {self.tag}"
        doc.enabled = enabled
        doc.home_route = route
        doc.priority = priority
        doc.desk_access = desk

        for role in roles:
            doc.append("applicable_roles", {"role": role})

        for user, default in users:
            doc.append("applicable_users", {"user": user, "default": default})

        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track(RULE, doc.name)

    def make_plain_account(self, suffix, roles=()):
        """An account of no application of ours, which is the case that used to slip in."""
        email = f"{PREFIX.lower()}.{suffix}{self.tag[:4]}@example.invalid"
        doc = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": f"{PREFIX} {suffix}",
                "send_welcome_email": 0,
                "roles": [{"role": role} for role in roles],
            }
        )
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=email)

        return self.track("User", email)

    def give(self, user, role):
        doc = frappe.get_doc("User", user)
        doc.append("roles", {"role": role})
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=user)

    def take_away(self, user, role):
        doc = frappe.get_doc("User", user)
        doc.roles = [row for row in doc.roles if row.role != role]
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=user)


class TestWhichRuleDecides(LoginRuleCase):
    def setUp(self):
        super().setUp()
        self.role = self.make_role("Ra")
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"lr{self.tag[:3]}"
        )
        self.give(self.technician, self.role)

    def test_a_role_carries_an_account_to_its_destination(self):
        rule = self.make_rule("Only", roles=[self.role])

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertTrue(verdict["success"], verdict)
        self.assertEqual(verdict["rule"], rule)
        self.assertEqual(verdict["source"], "role")
        self.assertEqual(verdict["path"], "/msp")
        self.assertIsNone(verdict["error"])

    def test_one_rule_naming_two_roles_the_account_holds_is_one_match(self):
        """Two ways into the same rule is not a disagreement about where to go."""
        second = self.make_role("Rb")
        self.give(self.technician, second)
        rule = self.make_rule("Both", roles=[self.role, second])

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertTrue(verdict["success"], verdict)
        self.assertEqual(verdict["rule"], rule)

    def test_the_higher_priority_decides(self):
        other = self.make_role("Rc")
        self.give(self.technician, other)
        self.make_rule("Lower", roles=[self.role], priority=LOW)
        winner = self.make_rule("Higher", roles=[other], priority=HIGH)

        self.assertEqual(LoginRuleService.resolve_for_user(self.technician)["rule"], winner)

    def test_two_rules_of_equal_priority_are_refused_rather_than_broken(self):
        other = self.make_role("Rd")
        self.give(self.technician, other)
        self.make_rule("Tie one", roles=[self.role], priority=HIGH)
        self.make_rule("Tie two", roles=[other], priority=HIGH)

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertFalse(verdict["success"])
        self.assertEqual(verdict["error"], "AMBIGUOUS_ROLE_RULE")
        self.assertIsNone(verdict["path"])

    def test_a_tie_is_still_a_tie_when_both_rules_name_the_same_destination(self):
        """Agreeing by accident is not a decision; the configuration is still wrong."""
        other = self.make_role("Re")
        self.give(self.technician, other)
        self.make_rule("Same one", roles=[self.role], route="/msp", priority=HIGH)
        self.make_rule("Same two", roles=[other], route="/msp", priority=HIGH)

        self.assertEqual(
            LoginRuleService.resolve_for_user(self.technician)["error"], "AMBIGUOUS_ROLE_RULE"
        )

    def test_a_rule_switched_off_does_not_compete(self):
        self.make_rule("Off", roles=[self.role], priority=1000, enabled=0)
        live = self.make_rule("On", roles=[self.role], priority=LOW)

        self.assertEqual(LoginRuleService.resolve_for_user(self.technician)["rule"], live)

    def test_nothing_applicable_is_said_rather_than_guessed(self):
        plain = self.make_plain_account("nr")

        verdict = LoginRuleService.resolve_for_user(plain)

        self.assertFalse(verdict["success"])
        self.assertEqual(verdict["error"], "NO_LOGIN_RULE")

    def test_renaming_a_rule_changes_nothing_but_its_name(self):
        rule = self.make_rule("Named", roles=[self.role])
        renamed = f"{rule} renamed"
        frappe.rename_doc(RULE, rule, renamed, force=True)
        self.track(RULE, renamed)
        frappe.db.commit()

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertEqual(verdict["rule"], renamed)
        self.assertEqual(verdict["path"], "/msp")

    def test_a_role_given_and_taken_away_moves_the_account_with_it(self):
        """No document per person: the roles the account holds are read at the moment asked."""
        mine = self.make_rule("Followed", roles=[self.role])

        self.assertEqual(LoginRuleService.resolve_for_user(self.technician)["rule"], mine)

        self.take_away(self.technician, self.role)

        # back to the rule the migration seeded, which it still matches as a technician
        self.assertEqual(
            LoginRuleService.resolve_for_user(self.technician)["rule"], "Nexgen MSP Internal"
        )


class TestADirectExceptionAlwaysWins(LoginRuleCase):
    def setUp(self):
        super().setUp()
        self.role = self.make_role("Da")
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"ld{self.tag[:3]}"
        )
        self.give(self.technician, self.role)

    def test_a_default_assignment_beats_the_highest_role_rule(self):
        self.make_rule("Thousand", roles=[self.role], priority=1000)
        direct = self.make_rule("Direct", users=[(self.technician, 1)], priority=0)

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertEqual(verdict["rule"], direct)
        self.assertEqual(verdict["source"], "direct_user")

    def test_an_assignment_that_is_not_the_default_decides_nothing(self):
        """A line left at zero is a preparation, never a destination."""
        self.make_rule("Prepared", users=[(self.technician, 0)], priority=1000)
        by_role = self.make_rule("By role", roles=[self.role])

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertEqual(verdict["rule"], by_role)
        self.assertEqual(verdict["source"], "role")

    def test_a_default_on_a_rule_switched_off_is_a_refusal_not_a_fallback(self):
        self.make_rule("Live role", roles=[self.role], priority=HIGH)
        self.make_rule("Blocked", users=[(self.technician, 1)], enabled=0)

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertFalse(verdict["success"])
        self.assertEqual(verdict["error"], "RULE_DISABLED")
        self.assertIsNone(verdict["path"])

    def test_a_second_default_for_one_account_cannot_be_saved(self):
        self.make_rule("First", users=[(self.technician, 1)])

        with self.assertRaises(frappe.ValidationError):
            self.make_rule("Second", users=[(self.technician, 1)])

    def test_two_defaults_already_in_the_data_refuse_to_resolve(self):
        """Nothing is chosen from a state that should not exist."""
        first = self.make_rule("One", users=[(self.technician, 1)])
        second = self.make_rule("Two", roles=[self.role])

        # written underneath validation, exactly as older data would carry it
        frappe.db.sql(
            """
            insert into `tabNexgen Login Applicable User`
                (name, parent, parenttype, parentfield, idx, user, `default`)
            values (%s, %s, %s, 'applicable_users', 1, %s, 1)
            """,
            (frappe.generate_hash(length=10), second, RULE, self.technician),
        )
        frappe.db.commit()

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertFalse(verdict["success"])
        self.assertEqual(verdict["error"], "AMBIGUOUS_DIRECT_RULE")
        self.assertIsNone(verdict["rule"])
        self.assertNotEqual(verdict["rule"], first)


class TestADestinationIsNeverAPermission(LoginRuleCase):
    def setUp(self):
        super().setUp()
        self.role = self.make_role("Pa")
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"lp{self.tag[:3]}"
        )
        self.give(self.technician, self.role)

    def test_a_rule_cannot_let_an_account_into_this_application(self):
        plain = self.make_plain_account("pm", roles=[self.role])
        self.make_rule("Wishful", roles=[self.role], route="/msp")

        verdict = LoginRuleService.resolve_for_user(plain)

        self.assertFalse(verdict["success"])
        self.assertEqual(verdict["error"], "MSP_ACCESS_DENIED")

    def test_a_desk_destination_with_the_box_shut_cannot_be_saved(self):
        """A rule that would refuse every account it decides for is not a rule."""
        with self.assertRaises(frappe.ValidationError):
            self.make_rule("Shut", roles=[self.role], route="/desk", priority=HIGH, desk=0)

    def test_a_rule_without_the_desk_box_cannot_send_anybody_to_the_desk(self):
        """Still refused at the resolution, for data written before the save said no."""
        rule = self.make_rule("Shut", roles=[self.role], route="/desk", priority=HIGH, desk=1)
        frappe.db.set_value(RULE, rule, "desk_access", 0, update_modified=False)
        frappe.db.commit()

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertFalse(verdict["success"])
        self.assertEqual(verdict["error"], "DESK_ACCESS_DENIED")

    def test_the_box_opens_a_door_and_does_not_hand_out_a_seat(self):
        """Our own technicians are kept as Website Users on purpose, box or no box."""
        self.make_rule("Open", roles=[self.role], route="/desk", priority=HIGH, desk=1)

        verdict = LoginRuleService.resolve_for_user(self.technician)

        self.assertFalse(verdict["success"])
        self.assertEqual(verdict["error"], "DESK_ACCESS_DENIED")

    def test_a_refused_destination_never_falls_back_to_a_lesser_rule(self):
        """The winning rule is the answer, even when the answer is no."""
        self.make_rule("Wins and fails", roles=[self.role], route="/desk", priority=HIGH, desk=1)
        self.make_rule("Would have worked", roles=[self.role], route="/msp", priority=LOW)

        self.assertEqual(
            LoginRuleService.resolve_for_user(self.technician)["error"], "DESK_ACCESS_DENIED"
        )

    def test_guest_and_a_disabled_account_are_refused_before_any_rule_is_read(self):
        self.assertEqual(
            LoginRuleService.resolve_for_user("Guest")["error"], "NOT_AUTHENTICATED"
        )

        frappe.db.set_value("User", self.technician, "enabled", 0)
        frappe.db.commit()

        self.assertEqual(
            LoginRuleService.resolve_for_user(self.technician)["error"], "USER_DISABLED"
        )


class TestWhatMayBeWrittenInARule(LoginRuleCase):
    UNSAFE_ROUTES = (
        "",
        "msp",
        "//evil.example.com/msp",
        "https://evil.example.com",
        "javascript:alert(1)",
        "/msp/../app",
        "/msp/./app",
        "/msp\\app",
        "/msp%2f..%2fapp",
        # the escape that walks a directory up once a browser resolves it, which the
        # segment check never saw because the segment was spelled %2e%2e
        "/msp/%2e%2e/desk",
        "/msp/%2E%2E/desk",
        "/msp?next=/app",
        "/msp#fragment",
        "/api/method/frappe.ping",
        "/assets/js/app.js",
        "/msp/login",
        "/msp/unauthorized",
    )

    def setUp(self):
        super().setUp()
        self.role = self.make_role("Wa")

    def test_a_rule_that_names_nobody_decides_nothing_and_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            self.make_rule("Empty")

    def test_a_role_every_account_carries_cannot_be_a_destination(self):
        for blanket in ("All", "Guest"):
            with self.assertRaises(frappe.ValidationError):
                self.make_rule(f"Blanket {blanket}", roles=[blanket])

    def test_a_priority_outside_its_range_is_refused(self):
        for priority in (-1, 1001):
            with self.assertRaises(frappe.ValidationError):
                self.make_rule(f"Priority {priority}", roles=[self.role], priority=priority)

    def test_no_route_that_leaves_this_site_can_be_stored(self):
        for route in self.UNSAFE_ROUTES:
            with self.assertRaises(frappe.ValidationError, msg=route):
                self.make_rule(f"Route {route}", roles=[self.role], route=route)

            self.assertEqual(
                LoginRuleService.validate_home_route(route)["error"],
                routes.INVALID_ROUTE,
                route,
            )

    def test_a_route_nothing_is_registered_to_guard_cannot_be_stored(self):
        with self.assertRaises(frappe.ValidationError):
            self.make_rule("Unknown", roles=[self.role], route="/somewhere-else")

        self.assertEqual(
            LoginRuleService.validate_home_route("/somewhere-else")["error"],
            routes.NOT_REGISTERED,
        )

    def test_a_route_is_stored_as_the_server_reads_it(self):
        rule = self.make_rule("Trailing", roles=[self.role], route="/msp/")

        self.assertEqual(frappe.db.get_value(RULE, rule, "home_route"), "/msp")

    def test_an_application_role_does_not_manage_the_site_destinations(self):
        """Destinations span applications, so running one of them is not authority over them."""
        for kind, role, suffix in (
            ("internal", "MSP Technician", "pt"),
            ("internal", "MSP System Admin", "pa"),
        ):
            account = self.make_account(kind, role, suffix=f"{suffix}{self.tag[:3]}")
            frappe.set_user(account)

            try:
                self.assertFalse(frappe.has_permission(RULE, "read"), role)
                self.assertFalse(frappe.has_permission(RULE, "write"), role)
            finally:
                frappe.set_user("Administrator")


class TestTheRulesTheMigrationSeeded(LoginRuleCase):
    """What the site already was, written down. Nobody who had a home may have lost it."""

    def test_the_three_rules_exist_as_the_migration_describes_them(self):
        expected = {
            "Nexgen MSP Portal": ("/msp", 100, 0, ["MSP Customer Manager", "MSP Customer Operator"]),
            "Nexgen MSP Internal": ("/msp", 100, 1, ["MSP System Admin", "MSP Technician"]),
            "Frappe Desk": ("/desk", 10, 1, ["Desk User"]),
        }

        # present and correct, not alone: an administrator may add an application of their
        # own, and that is the point of the feature
        self.assertFalse(set(expected) - set(frappe.get_all(RULE, pluck="name")))

        for name, (route, priority, desk, roles) in expected.items():
            doc = frappe.get_doc(RULE, name)

            self.assertEqual(
                (doc.home_route, doc.priority, doc.enabled, doc.desk_access),
                (route, priority, 1, desk),
                name,
            )
            self.assertEqual(sorted(row.role for row in doc.applicable_roles), roles, name)

    def test_the_portal_and_the_internal_rules_do_not_tie(self):
        """Equal priority, but no account holds both sides — and one that did is refused anyway."""
        manager = self.make_account(
            "customer", "MSP Customer Manager", self.make_customer(self.tag), suffix=f"lp{self.tag[:3]}"
        )
        technician = self.make_account("internal", "MSP Technician", suffix=f"li{self.tag[:3]}")

        self.assertEqual(LoginRuleService.resolve_for_user(manager)["rule"], "Nexgen MSP Portal")
        self.assertEqual(
            LoginRuleService.resolve_for_user(technician)["rule"], "Nexgen MSP Internal"
        )

    def test_the_builtin_administrator_keeps_the_home_it_has_always_had(self):
        """It holds every role on the site, so its home is named outright."""
        verdict = LoginRuleService.resolve_for_user("Administrator")

        self.assertEqual(verdict["path"], "/msp")
        self.assertEqual(verdict["rule"], "Nexgen MSP Internal")
        self.assertEqual(verdict["source"], "direct_user")

    def test_our_own_people_land_in_the_application(self):
        technician = self.make_account("internal", "MSP Technician", suffix=f"ls{self.tag[:3]}")

        verdict = LoginRuleService.resolve_for_user(technician)

        self.assertEqual(verdict["path"], "/msp")
        self.assertEqual(verdict["rule"], "Nexgen MSP Internal")

    def test_an_administrator_of_ours_lands_here_rather_than_in_the_desk(self):
        """A System User too, and the internal rule outranks the desk rule for that reason."""
        admin = self.make_account("internal", "MSP System Admin", suffix=f"lz{self.tag[:3]}")

        self.assertEqual(
            LoginRuleService.resolve_for_user(admin)["rule"], "Nexgen MSP Internal"
        )
        self.assertTrue(LoginRuleService.desk_allowed(admin), "must keep the desk it had")

    def test_a_system_user_of_another_application_lands_in_the_desk(self):
        role = self.make_role("Sa", desk_access=1)
        employee = self.make_plain_account("sy", roles=[role])

        self.assertEqual(
            frappe.db.get_value("User", employee, "user_type"), "System User", "fixture"
        )

        verdict = LoginRuleService.resolve_for_user(employee)

        self.assertEqual(verdict["path"], "/desk")
        self.assertEqual(verdict["rule"], "Frappe Desk")
        self.assertEqual(verdict["source"], "role")

    def test_a_website_account_of_another_application_is_sent_nowhere_of_ours(self):
        stranger = self.make_plain_account("wu")

        verdict = LoginRuleService.resolve_for_user(stranger)

        self.assertFalse(verdict["success"])
        self.assertEqual(verdict["error"], "NO_LOGIN_RULE")
        self.assertIsNone(verdict["path"])


class TestTheSessionCarriesTheDestination(LoginRuleCase):
    """What the client is told, and the switch that decides whether it is told anything.

    The switch is what an incident turns off: the rules stay written, the login goes back to
    the way it always worked, and nobody has to delete an assignment under pressure.
    """

    def setUp(self):
        super().setUp()
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"lc{self.tag[:3]}"
        )
        self.kept = frappe.db.get_single_value("MSP Portal Settings", ROUTING_FLAG)

    def tearDown(self):
        frappe.db.set_single_value("MSP Portal Settings", ROUTING_FLAG, self.kept)
        frappe.db.commit()
        super().tearDown()

    def routing(self, on):
        frappe.db.set_single_value("MSP Portal Settings", ROUTING_FLAG, 1 if on else 0)
        frappe.db.commit()

    def context_for(self, user):
        frappe.set_user(user)

        try:
            return SessionService.get_session_context()
        finally:
            frappe.set_user("Administrator")

    def test_the_destination_travels_with_the_session(self):
        self.routing(True)

        context = self.context_for(self.technician)

        self.assertEqual(context["login_destination"]["path"], "/msp")
        self.assertEqual(context["login_destination"]["rule"], "Nexgen MSP Internal")
        self.assertTrue(context["access"]["ok"])

    def test_the_verdict_and_the_destination_are_two_separate_answers(self):
        """One says whether they may be here; the other says where they belong."""
        self.routing(True)

        context = self.context_for(self.technician)

        self.assertIn("access", context)
        self.assertIn("login_destination", context)
        self.assertNotEqual(context["access"], context["login_destination"])

    def test_nothing_is_decided_for_the_client_while_the_switch_is_off(self):
        self.routing(False)

        context = self.context_for(self.technician)

        self.assertIsNone(context["login_destination"])
        self.assertTrue(context["access"]["ok"])

    def test_a_refused_destination_is_reported_rather_than_hidden(self):
        self.routing(True)
        stranger = self.make_plain_account("sd")

        context = self.context_for(stranger)

        self.assertFalse(context["login_destination"]["success"])
        self.assertEqual(context["login_destination"]["error"], "NO_LOGIN_RULE")


class TestWhoIsSentOffTheDesk(RequestContextMixin, LoginRuleCase):
    """The desk redirect: who it turns away, and where each of them is taken.

    It used to send every Website User to the site's front door — right while this was the
    only application here, wrong as soon as it was not: somebody else's portal account was
    pushed off its own pages onto a login screen. Now each account goes to the home its own
    rule gives it, and only one the rules give no home at all sees the front door.
    """

    def setUp(self):
        super().setUp()
        self.acme = self.make_customer(self.tag)
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.acme, suffix=f"gk{self.tag[:3]}"
        )
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"gt{self.tag[:3]}"
        )
        self.sysadmin = self.make_account(
            "internal", "MSP System Admin", suffix=f"ga{self.tag[:3]}"
        )
        self.stranger = self.make_plain_account("gs")

    def sent_from(self, path, user, user_type=None):
        self.at(path)
        frappe.set_user(user)

        if user_type:
            frappe.session.data.user_type = user_type

        try:
            gatekeeper.guard()
        except gatekeeper.SeeOther as moved:
            return moved.new_url
        finally:
            frappe.set_user("Administrator")

        return None

    def test_everybody_turned_away_is_taken_to_their_own_home(self):
        for user in (self.manager, self.technician):
            for path in ("/app", "/desk", "/apps", "/app/user"):
                self.assertEqual(self.sent_from(path, user), "/msp", f"{user} {path}")

    def test_a_rule_without_the_desk_box_shuts_the_door(self):
        """The portal rule leaves it shut, so a manager never reaches the desk."""
        self.assertFalse(LoginRuleService.desk_allowed(self.manager))
        self.assertFalse(LoginRuleService.desk_reachable(self.manager))
        self.assertEqual(self.sent_from("/desk", self.manager), "/msp")

    def test_an_account_the_rules_give_no_home_falls_back_to_the_front_door(self):
        self.assertIsNone(LoginRuleService.home_for(self.stranger))
        self.assertEqual(self.sent_from("/desk", self.stranger), "/")

    def test_a_desk_account_of_ours_keeps_the_desk_it_already_had(self):
        """An MSP System Admin is a System User and the internal rule opens the door."""
        self.assertTrue(LoginRuleService.desk_allowed(self.sysadmin))
        self.assertTrue(LoginRuleService.desk_reachable(self.sysadmin))
        self.assertIsNone(self.sent_from("/desk", self.sysadmin))

    def test_the_box_is_not_a_seat(self):
        """The same rule opens the door for a technician, and Frappe still says no."""
        self.assertTrue(LoginRuleService.desk_allowed(self.technician))
        self.assertEqual(self.sent_from("/desk", self.technician), "/msp")

    def test_the_builtin_administrator_always_gets_through(self):
        """The one account that has to be able to repair a rule that shut everybody out."""
        for path in ("/app", "/desk", "/apps"):
            self.assertIsNone(self.sent_from(path, "Administrator"), path)

    def test_nothing_but_the_desk_is_touched(self):
        for path in ("/msp", "/msp/login", "/"):
            self.assertIsNone(self.sent_from(path, self.manager), path)


class TestWhoSeesTheApplicationInFrappe(LoginRuleCase):
    """The apps screen, the workspace rail and the desk icon.

    All three default to showing an entry to everybody with a desk seat, which offered this
    application to accounts it would refuse at the door.
    """

    def setUp(self):
        super().setUp()
        self.admin = self.make_account("internal", "MSP System Admin", suffix=f"av{self.tag[:3]}")
        self.stranger = self.make_plain_account("as")

    def test_it_is_offered_to_an_account_that_may_actually_enter(self):
        for user in (self.admin, "Administrator"):
            self.assertTrue(app_visibility.can_show_msp_app(user), user)

    def test_it_is_hidden_from_an_account_holding_no_role_of_ours(self):
        self.assertFalse(app_visibility.can_show_msp_app(self.stranger))

    def test_the_apps_screen_asks_the_server_and_names_the_real_route(self):
        entries = frappe.get_hooks("add_to_apps_screen", app_name="nexgen_msp")
        entry = next(item for item in entries if item.get("name") == "nexgen_msp")

        self.assertEqual(entry["route"], routes.MSP)
        self.assertEqual(
            entry["has_permission"], "nexgen_msp.utils.app_visibility.can_show_msp_app"
        )
        self.assertTrue(frappe.get_attr(entry["has_permission"]))

    def test_the_workspace_and_the_desk_icon_are_not_open_to_every_desk_seat(self):
        for doctype in ("Workspace", "Desktop Icon"):
            roles = [row.role for row in frappe.get_doc(doctype, "Nexgen MSP").roles]

            self.assertTrue(roles, f"{doctype} is visible to everybody")
            self.assertNotIn("Desk User", roles, doctype)


class TestTheScreenAndTheGuardAgreeAboutTheDesk(LoginRuleCase):
    """One question, asked once.

    The denial screen read the roles and the request guard read the rule, so the screen
    could offer a door the guard would shut the moment it was used.
    """

    def setUp(self):
        super().setUp()
        self.acme = self.make_customer(self.tag)
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.acme, suffix=f"dq{self.tag[:3]}"
        )
        self.sysadmin = self.make_account(
            "internal", "MSP System Admin", suffix=f"dr{self.tag[:3]}"
        )

    def offered_to(self, user):
        frappe.set_user(user)

        try:
            return SessionService.get_session_context()["can_open_desk"]
        finally:
            frappe.set_user("Administrator")

    def test_the_screen_offers_the_desk_to_exactly_whoever_the_guard_lets_in(self):
        for user in (self.manager, self.sysadmin, "Administrator"):
            self.assertEqual(
                self.offered_to(user), LoginRuleService.desk_reachable(user), user
            )

    def test_a_website_account_is_never_offered_the_desk_however_it_is_routed(self):
        """The box opens a door; it does not hand out a seat Frappe has not given."""
        self.assertFalse(self.offered_to(self.manager))

    def test_our_own_administrators_are_still_offered_it(self):
        self.assertTrue(self.offered_to(self.sysadmin))


class TestTheSwitchIsAWayBack(RequestContextMixin, LoginRuleCase):
    """Turning the routing off has to undo all of it, not some of it.

    A switch that left the desk decided by rules would be no use against a bad rule, which
    is the one thing it exists for.
    """

    def setUp(self):
        super().setUp()
        self.acme = self.make_customer(self.tag)
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.acme, suffix=f"sw{self.tag[:3]}"
        )
        self.sysadmin = self.make_account(
            "internal", "MSP System Admin", suffix=f"sx{self.tag[:3]}"
        )
        self.kept = frappe.db.get_single_value("MSP Portal Settings", ROUTING_FLAG)

    def tearDown(self):
        frappe.db.set_single_value("MSP Portal Settings", ROUTING_FLAG, self.kept)
        frappe.db.commit()
        super().tearDown()

    def routing(self, on):
        frappe.db.set_single_value("MSP Portal Settings", ROUTING_FLAG, 1 if on else 0)
        frappe.db.commit()

    def sent_from(self, path, user):
        self.at(path)
        frappe.set_user(user)

        try:
            gatekeeper.guard()
        except gatekeeper.SeeOther as moved:
            return moved.new_url
        finally:
            frappe.set_user("Administrator")

        return None

    def test_switched_off_the_desk_goes_back_to_what_frappe_says(self):
        """A seat gets you in and the absence of one sends you to the front door."""
        self.routing(False)

        self.assertFalse(LoginRuleService.desk_reachable(self.manager))
        self.assertEqual(self.sent_from("/desk", self.manager), "/")

        self.assertTrue(LoginRuleService.desk_reachable(self.sysadmin))
        self.assertIsNone(self.sent_from("/desk", self.sysadmin))

    def test_switched_off_a_rule_cannot_shut_a_desk_frappe_grants(self):
        """The one thing the switch exists for: undoing a rule that shut somebody out.

        The account is not one of a customer's — that restriction is permanent and the
        switch does not reach it. It is a desk account whose winning rule leaves the desk
        shut, which is the mistake an incident would be made of.
        """
        role = self.make_role("Sb", desk_access=1)
        employee = self.make_plain_account("sz", roles=[role])
        self.make_rule("Shut them out", roles=[role], priority=HIGH, desk=0)

        self.routing(True)
        self.assertFalse(LoginRuleService.desk_reachable(employee))
        self.assertEqual(self.sent_from("/desk", employee), "/msp")

        self.routing(False)
        self.assertTrue(LoginRuleService.desk_reachable(employee))
        self.assertIsNone(self.sent_from("/desk", employee))

    def test_switched_on_the_rule_decides_again(self):
        self.routing(True)

        self.assertFalse(LoginRuleService.desk_reachable(self.manager))
        self.assertEqual(self.sent_from("/desk", self.manager), "/msp")


class TestTheMigrationReplacesItsOwnEarlierShape(LoginRuleCase):
    """A patch whose output changed has to clear away what it wrote the first time.

    The first version made one rule for all of our people and one for the desk, and neither
    carried the desk box. Left standing on a site that already ran it, the desk rule would
    now refuse the desk to every account whose only home it is.
    """

    OLD_MSP = "Nexgen MSP"
    OLD_DESK = "Frappe Desk"

    def setUp(self):
        super().setUp()
        from nexgen_msp.patches import seed_login_rules

        self.patch = seed_login_rules
        self.live = {}

        for name in frappe.get_all(RULE, pluck="name"):
            self.live[name] = frappe.get_doc(RULE, name).as_dict()
            frappe.delete_doc(RULE, name, force=True, ignore_permissions=True)

        frappe.db.commit()

    def tearDown(self):
        for name in frappe.get_all(RULE, pluck="name"):
            frappe.delete_doc(RULE, name, force=True, ignore_permissions=True)

        for kept in self.live.values():
            frappe.get_doc(kept).insert(ignore_permissions=True)

        frappe.db.commit()
        super().tearDown()

    def write_the_old_shape(self):
        """Exactly what a site that ran the two-rule version has in its database.

        The desk rule of that version carried no desk access, which the save now refuses —
        it had no such field to carry. So the field is written underneath validation, which
        is the state the migration actually has to deal with.
        """
        for name, shape in self.patch.SUPERSEDED.items():
            doc = frappe.new_doc(RULE)
            doc.name = name
            doc.home_route = shape["home_route"]
            doc.priority = shape["priority"]
            doc.enabled = shape["enabled"]
            doc.desk_access = 1

            for role in shape["roles"]:
                doc.append("applicable_roles", {"role": role})

            for user, default in shape["users"]:
                doc.append("applicable_users", {"user": user, "default": default})

            doc.insert(ignore_permissions=True)
            frappe.db.set_value(
                RULE, name, "desk_access", shape["desk_access"], update_modified=False
            )

        frappe.db.commit()

    def test_the_earlier_two_rules_are_replaced_by_the_three(self):
        self.write_the_old_shape()

        self.patch.execute()

        self.assertEqual(
            sorted(frappe.get_all(RULE, pluck="name")),
            ["Frappe Desk", "Nexgen MSP Internal", "Nexgen MSP Portal"],
        )
        self.assertEqual(frappe.db.get_value(RULE, "Frappe Desk", "desk_access"), 1)

    def test_the_earlier_rules_are_kept_rather_than_deleted(self):
        """Switched off and renamed aside, so nothing attached to them is lost."""
        self.write_the_old_shape()

        self.patch.execute()

        for name in self.patch.SUPERSEDED:
            aside = self.patch.STOOD_DOWN.format(name)

            self.assertTrue(frappe.db.exists(RULE, aside), aside)
            self.assertEqual(frappe.db.get_value(RULE, aside, "enabled"), 0, aside)

    def test_running_it_a_second_time_stands_nothing_down_twice(self):
        self.write_the_old_shape()
        self.patch.execute()

        before = sorted(frappe.get_all(RULE, pluck="name"))
        stamps = {
            name: frappe.db.get_value(RULE, name, "modified") for name in before
        }

        self.patch.execute()

        self.assertEqual(sorted(frappe.get_all(RULE, pluck="name")), before)
        self.assertEqual(
            {name: frappe.db.get_value(RULE, name, "modified") for name in before}, stamps
        )

    def test_a_rule_somebody_has_edited_since_is_left_exactly_as_it_is(self):
        """Not this patch's output any more, so not this patch's to clear away."""
        self.write_the_old_shape()
        frappe.db.set_value(RULE, self.OLD_MSP, "notes", "somebody was here")
        frappe.db.commit()

        # the edited rule now ties with the two that replace it, which the simulation
        # reports rather than resolving
        with self.assertRaises(frappe.ValidationError):
            self.patch.execute()

        self.assertTrue(frappe.db.exists(RULE, self.OLD_MSP))
        self.assertEqual(
            frappe.db.get_value(RULE, self.OLD_MSP, "notes"), "somebody was here"
        )

    def test_it_is_registered_under_a_name_a_site_has_not_already_recorded(self):
        """Frappe keys a patch on the whole line, so a changed patch needs a changed line.

        A site that ran the two-rule version has the bare module path in its Patch Log and
        would never run it again, which would leave it with a desk rule that shuts the desk.
        """
        with open(frappe.get_app_path("nexgen_msp", "patches.txt")) as handle:
            lines = [line.strip() for line in handle]

        entries = [line for line in lines if line.startswith("nexgen_msp.patches.seed_login_rules")]

        self.assertEqual(entries, ["nexgen_msp.patches.seed_login_rules #three_rules"])


class TestAPortalAccountIsNeverInTheDesk(RequestContextMixin, LoginRuleCase):
    """The restriction asked for is permanent, so nothing may lift it.

    Not a box on a rule, and not an account type somebody changed by hand. A portal role on
    a System User is a mistake to be corrected; the desk must not read it as a way in.
    """

    def setUp(self):
        super().setUp()
        self.acme = self.make_customer(self.tag)
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.acme, suffix=f"pd{self.tag[:3]}"
        )
        self.rule = self.make_rule(
            "Portal with the desk open", roles=["MSP Customer Manager"], priority=HIGH, desk=1
        )
        frappe.db.set_value("User", self.manager, "user_type", "System User")
        frappe.clear_cache(user=self.manager)

    def tearDown(self):
        frappe.db.set_value("User", self.manager, "user_type", "Website User")
        frappe.clear_cache(user=self.manager)
        super().tearDown()

    def test_the_box_cannot_open_the_desk_to_a_customer_account(self):
        self.assertEqual(frappe.db.get_value("User", self.manager, "user_type"), "System User")
        self.assertTrue(LoginRuleService.desk_allowed(self.manager), "the rule does open it")

        self.assertFalse(LoginRuleService.desk_reachable(self.manager))

    def test_the_guard_turns_them_away_from_every_desk_address(self):
        for path in ("/app", "/desk", "/apps", "/app/user"):
            self.at(path)
            frappe.set_user(self.manager)

            try:
                with self.assertRaises(gatekeeper.SeeOther, msg=path):
                    gatekeeper.guard()
            finally:
                frappe.set_user("Administrator")

    def test_the_screen_does_not_offer_them_a_door_either(self):
        frappe.set_user(self.manager)

        try:
            self.assertFalse(SessionService.get_session_context()["can_open_desk"])
        finally:
            frappe.set_user("Administrator")
