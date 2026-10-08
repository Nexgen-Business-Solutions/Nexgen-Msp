"""What an account detail screen is told this account may do.

The screen must not guess from a role name: every line it shows is a question put to the
rules themselves, for that very account, so a reader is never promised what the code would
refuse.
"""

from nexgen_msp.api.internal.services.team_service import TeamService
from nexgen_msp.utils import access

from .base import MSPTestCase


def answers(abilities):
    """Each right by label, flattened out of its group."""
    return {
        item["label"]: item["allowed"] for group in abilities["groups"] for item in group["items"]
    }


def scope(abilities):
    return abilities["scope"]


def answers_detail(abilities, label):
    """The sentence shown under one right."""
    return next(
        item["detail"]
        for group in abilities["groups"]
        for item in group["items"]
        if item["label"] == label
    )


def titles(abilities):
    return [group["title"] for group in abilities["groups"]]


class TestEveryRoleIsDescribed(MSPTestCase):
    def test_a_technician_carries_work_out_and_touches_no_money(self):
        email = self.make_account("internal", "MSP Technician", suffix="tech")

        held = answers(TeamService.abilities(email))

        self.assertTrue(held["Carry requests out"])
        self.assertTrue(held["Register new people and machines while fulfilling"])
        self.assertTrue(held["Read across every customer"])
        self.assertFalse(held["Manage contracts"])
        self.assertFalse(held["Manage pricing"])
        self.assertFalse(held["Draw and issue billing runs"])
        self.assertFalse(held["Add a customer"])
        self.assertFalse(held["Manage settings"])
        self.assertFalse(held["Manage accounts and portal access"])

    def test_an_administrator_holds_the_commercial_side(self):
        email = self.make_account("internal", "MSP System Admin", suffix="admin")

        held = answers(TeamService.abilities(email))

        for right in (
            "Add a customer",
            "Change commercial terms",
            "Manage contracts",
            "Manage pricing",
            "Draw and issue billing runs",
            "Manage settings",
            "Manage accounts and portal access",
            "Carry requests out",
            "Read across every customer",
            "Read invoices",
        ):
            self.assertTrue(held[right], right)

    def test_a_customer_manager_reads_its_own_company_and_nothing_else(self):
        customer = self.make_customer("ABIL")
        email = self.make_account("customer", "MSP Customer Manager", customer=customer, suffix="mgr")

        abilities = TeamService.abilities(email)
        held = answers(abilities)

        self.assertFalse(held["Read across every customer"])
        self.assertFalse(held["Carry requests out"])
        self.assertFalse(held["Manage contracts"])
        self.assertFalse(held["Reach the Frappe desk"])
        self.assertTrue(held["Read this company's people, machines, services and requests"])
        self.assertTrue(held["Change this company's own details"])
        self.assertTrue(held["Read invoices"])
        self.assertEqual(abilities["family"], "customer")
        self.assertEqual(abilities["role_label"], "Customer Manager")

    def test_a_customer_operator_is_the_one_kept_away_from_the_money(self):
        customer = self.make_customer("ABIL")
        email = self.make_account("customer", "MSP Customer Operator", customer=customer, suffix="ope")

        abilities = TeamService.abilities(email)
        held = answers(abilities)
        money = next(
            item
            for group in abilities["groups"]
            for item in group["items"]
            if item["label"] == "Read invoices"
        )

        self.assertFalse(held["Read invoices"])
        self.assertEqual(money["detail"], "The one thing a Customer Operator is kept away from")
        self.assertFalse(held["Change this company's own details"])
        self.assertEqual(abilities["role_label"], "Customer Operator")


class TestTheOneCompanyItActsFor(MSPTestCase):
    def test_staff_are_told_they_reach_every_customer(self):
        email = self.make_account("internal", "MSP Technician", suffix="reach")

        self.assertEqual(scope(TeamService.abilities(email)), "Every customer we serve")

    def test_a_customer_account_is_told_its_one_company_by_name(self):
        customer = self.make_customer("ABIL")
        email = self.make_account("customer", "MSP Customer Manager", customer=customer, suffix="named")

        self.assertEqual(scope(TeamService.abilities(email)), customer)

    def test_the_company_is_one_name_and_never_a_list(self):
        customer = self.make_customer("ABIL")
        email = self.make_account("customer", "MSP Customer Manager", customer=customer, suffix="single")

        told = scope(TeamService.abilities(email))

        self.assertIsInstance(told, str)
        self.assertNotIn(",", told)

    def test_nothing_in_the_rights_speaks_of_several_companies(self):
        customer = self.make_customer("ABIL")
        for kind, role, suffix in (
            ("customer", "MSP Customer Manager", "plural1"),
            ("customer", "MSP Customer Operator", "plural2"),
        ):
            email = self.make_account(kind, role, customer=customer, suffix=suffix)
            labels = [
                f"{item['label']} {item.get('detail') or ''}"
                for group in TeamService.abilities(email)["groups"]
                for item in group["items"]
            ]

            for line in labels:
                self.assertNotIn("companies", line.lower(), line)


class TestTheAuthorityMatrixIsPartOfIt(MSPTestCase):
    def test_a_named_approver_is_shown_what_the_matrix_gave_them(self):
        customer = self.make_customer("ABIL")
        email = self.make_account("customer", "MSP Customer Manager", customer=customer, suffix="appr")
        self.grant(email, can_submit=1, can_approve=1)

        abilities = TeamService.abilities(email)
        held = answers(abilities)

        self.assertIn("Requests", titles(abilities))
        self.assertTrue(held["Raise requests from the portal"])
        self.assertTrue(held["Approve this company's requests"])
        self.assertEqual(
            answers_detail(abilities, "Approve this company's requests"), "For the whole company"
        )
        self.assertEqual(
            answers_detail(abilities, "Raise requests from the portal"),
            "Named on the authority matrix",
        )

    def test_an_approver_held_to_one_department_is_told_which(self):
        customer = self.make_customer("ABIL")
        department = self.make_department("Finance")
        email = self.make_account("customer", "MSP Customer Manager", customer=customer, suffix="dept")

        from nexgen_msp.api.internal.services.authority_service import AuthorityService

        AuthorityService.set_account_rights(
            email, {"can_submit": 1, "can_approve": 1, "department": department}
        )

        detail = answers_detail(
            TeamService.abilities(email), "Approve this company's requests"
        )

        self.assertEqual(detail, f"For the {department} Department only")

    def test_an_account_nobody_named_is_told_its_requests_wait(self):
        customer = self.make_customer("ABIL")
        email = self.make_account("customer", "MSP Customer Operator", customer=customer, suffix="wait")

        abilities = TeamService.abilities(email)
        held = answers(abilities)

        self.assertFalse(held["Raise requests from the portal"])
        self.assertFalse(held["Approve this company's requests"])
        self.assertEqual(
            answers_detail(abilities, "Approve this company's requests"),
            "Their own requests wait for somebody who may approve",
        )

    def test_our_own_team_is_never_shown_a_matrix_right_it_cannot_hold(self):
        email = self.make_account("internal", "MSP System Admin", suffix="nomatrix")

        held = answers(TeamService.abilities(email))

        self.assertNotIn("Raise requests from the portal", held)
        self.assertNotIn("Approve this company's requests", held)
        self.assertTrue(held["Carry requests out"])


class TestItAgreesWithTheRulesItDescribes(MSPTestCase):
    def test_every_capability_answer_matches_the_capability_itself(self):
        customer = self.make_customer("ABIL")
        pairs = (
            ("Read across every customer", "view_all_customers", {}),
            ("Add a customer", "create_customer", {}),
            ("Change commercial terms", "edit_customer_commercial", {}),
            ("Manage contracts", "manage_contracts", {}),
            ("Manage pricing", "manage_pricing", {}),
            ("Carry requests out", "execute_requests", {}),
            ("Manage settings", "manage_settings", {}),
        )

        for kind, role, suffix in (
            ("internal", "MSP Technician", "agree1"),
            ("internal", "MSP System Admin", "agree2"),
            ("customer", "MSP Customer Manager", "agree3"),
            ("customer", "MSP Customer Operator", "agree4"),
        ):
            email = self.make_account(
                kind, role, customer=customer if kind == "customer" else None, suffix=suffix
            )
            held = answers(TeamService.abilities(email))

            for label, capability, context in pairs:
                self.assertEqual(
                    held[label],
                    bool(access.allows(capability, user=email, **context)),
                    f"{role}: {label} does not agree with {capability}",
                )

    def test_the_screen_is_told_nothing_it_was_not_asked_about(self):
        email = self.make_account("internal", "MSP Technician", suffix="shape")

        abilities = TeamService.abilities(email)

        self.assertEqual(
            sorted(abilities), ["family", "groups", "role", "role_label", "scope"]
        )
        for group in abilities["groups"]:
            self.assertEqual(sorted(group), ["items", "title"])
            self.assertTrue(group["items"], group["title"])
            for item in group["items"]:
                self.assertLessEqual(set(item), {"allowed", "detail", "label"})
                self.assertIn("label", item)
                self.assertIsInstance(item["allowed"], bool)


class TestTheDetailScreenCarriesIt(MSPTestCase):
    def test_the_account_payload_includes_what_it_may_do(self):
        customer = self.make_customer("ABIL")
        email = self.make_account("customer", "MSP Customer Manager", customer=customer, suffix="load")

        account = TeamService.get_member(email=email)

        self.assertIn("abilities", account)
        self.assertEqual(account["abilities"]["role_label"], account["role_label"])
        self.assertTrue(account["abilities"]["groups"])
