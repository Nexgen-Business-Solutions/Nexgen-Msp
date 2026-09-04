"""The request, from the customer's hand to ours, with the accord in between.

Two rights decide everything: who may raise a request, and who may agree to it. This walks
the whole road for each combination, and checks at every step that a request waiting for the
customer's own accord has not reached us.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import approval
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .base import MSPTestCase


class TestTheRequestProcess(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.track("MSP Approval Authority", self.customer)
        self.person = self.make_person(self.customer, "Subject")
        self.service = self.make_service("P", scope="User")

        self.asker = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="ask")
        self.decider = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="dec")
        self.tech = self.make_account("internal", "MSP Technician", suffix="tec")

    # ------------------------------------------------------------- helpers
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def rights(self, email, **grants):
        AuthorityService.set_account_rights(email, grants)

    def raise_one(self, email):
        out = self.as_user(
            email,
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "client_user": self.person,
                        "requested_service": self.service,
                    }
                ],
            ),
        )

        return self.track("MSP Service Request", out["name"]), out

    def reaches_us(self, name):
        listed = self.as_user(self.tech, lambda: RequestService.list_requests(page_length=500))

        return name in [row["name"] for row in listed["rows"]]

    # ------------------------------------------- nobody decides at this customer
    def test_with_no_approver_a_request_still_waits(self):
        """The matrix is the law, not a switch: no accord, nothing reaches us."""
        self.assertFalse(approval.has_approvers(self.customer))

        name, out = self.raise_one(self.asker)

        self.assertEqual(out["status"], "Awaiting Customer Approval")
        self.assertFalse(self.reaches_us(name))

    # ------------------------------------------------ somebody decides, and waits
    def test_once_someone_may_approve_the_others_wait(self):
        self.rights(self.decider, can_submit=1, can_approve=1)

        name, out = self.raise_one(self.asker)

        self.assertEqual(out["status"], "Awaiting Customer Approval")
        self.assertFalse(self.reaches_us(name), "it must not reach us before the accord")

        with self.assertRaises(NotFoundError):
            self.as_user(self.tech, lambda: RequestService.get_request(name))

        self.assertEqual(RequestService._allowed_actions("Awaiting Customer Approval"), [])

    def test_the_decider_can_see_it_and_agree_and_then_it_reaches_us(self):
        self.rights(self.decider, can_submit=1, can_approve=1)
        name, _ = self.raise_one(self.asker)

        waiting = self.as_user(self.decider, lambda: PortalService.my_approval_rights(self.customer))
        self.assertEqual(waiting["awaiting"], 1)

        detail = self.as_user(self.decider, lambda: PortalService.get_request(name))
        self.assertTrue(detail["can_decide"], "the button must be offered to the decider")

        self.as_user(self.decider, lambda: PortalService.approve_request(name))

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Submitted")
        self.assertTrue(self.reaches_us(name), "the accord is what sends it to us")
        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "customer_approved_by"), self.decider
        )

    def test_refusing_it_closes_it_and_it_never_reaches_us(self):
        self.rights(self.decider, can_submit=1, can_approve=1)
        name, _ = self.raise_one(self.asker)

        self.as_user(self.decider, lambda: PortalService.reject_request(name, "not now"))

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Rejected")
        self.assertFalse(self.reaches_us(name))

    # --------------------------------------------------- who may do what, exactly
    def test_someone_named_without_the_right_cannot_raise_one(self):
        """A line granting nothing is no line at all, so the denial rides on another right."""
        self.rights(self.decider, can_submit=1, can_approve=1)
        self.rights(self.asker, can_submit=0, can_approve=1)

        with self.assertRaises(ValidationError):
            self.raise_one(self.asker)

    def test_someone_the_matrix_does_not_name_may_still_raise_and_waits(self):
        """Naming an approver must not silently take the portal away from everyone else."""
        self.rights(self.decider, can_submit=1, can_approve=1)

        name, out = self.raise_one(self.asker)

        self.assertEqual(out["status"], "Awaiting Customer Approval")
        self.assertFalse(self.reaches_us(name))

    def test_someone_without_the_right_cannot_agree(self):
        self.rights(self.decider, can_submit=1, can_approve=1)
        name, _ = self.raise_one(self.asker)

        detail = self.as_user(self.asker, lambda: PortalService.get_request(name))
        self.assertFalse(detail["can_decide"], "no button for someone who may not decide")

        with self.assertRaises(ValidationError):
            self.as_user(self.asker, lambda: PortalService.approve_request(name))

        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "status"), "Awaiting Customer Approval"
        )

    def test_the_decider_own_request_needs_no_second_accord(self):
        """Giving one person both rights is itself the decision."""
        self.rights(self.decider, can_submit=1, can_approve=1)

        name, out = self.raise_one(self.decider)

        self.assertEqual(out["status"], "Submitted")
        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "customer_approved_by"), self.decider
        )
        self.assertTrue(self.reaches_us(name))

    def test_we_never_wait_for_an_accord_on_our_own_request(self):
        self.rights(self.decider, can_submit=1, can_approve=1)

        name, out = self.raise_one(self.tech)

        self.assertEqual(out["status"], "Submitted")
        self.assertEqual(out["source"], "Internal")
        self.assertTrue(self.reaches_us(name))

    # ------------------------------------------------------ the road after us
    def test_the_whole_road_from_the_customer_to_completion(self):
        self.rights(self.decider, can_submit=1, can_approve=1)
        name, _ = self.raise_one(self.asker)

        self.as_user(self.decider, lambda: PortalService.approve_request(name))

        self.as_user(self.tech, lambda: RequestService.run_action(name, "start_review"))
        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Under Review")

        self.as_user(self.tech, lambda: RequestService.set_line_status(name, 1, "Approved"))
        self.as_user(self.tech, lambda: RequestService.run_action(name, "approve"))
        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Approved")

        self.as_user(self.tech, lambda: RequestService.run_action(name, "start_work"))

        # the closing gate still applies at the end of the road
        with self.assertRaises(ValidationError):
            self.as_user(self.tech, lambda: RequestService.run_action(name, "complete"))

        self.as_user(self.tech, lambda: RequestService.set_delivery_detail(name, 1, username="p.subject"))
        self.as_user(self.tech, lambda: RequestService.run_action(name, "complete"))

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Completed")

    def test_a_department_bound_decider_only_decides_for_their_own(self):
        outsider = self.make_person(self.customer, "Outsider", department="Sales")
        AuthorityService.set_account_rights(
            self.decider, {"can_submit": 1, "can_approve": 1, "department": "Support"}
        )

        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "client_user": outsider,
                        "requested_service": self.service,
                    }
                ],
            ),
        )
        name = self.track("MSP Service Request", out["name"])

        detail = self.as_user(self.decider, lambda: PortalService.get_request(name))
        self.assertFalse(detail["can_decide"], "outside their department")

        with self.assertRaises(ValidationError):
            self.as_user(self.decider, lambda: PortalService.approve_request(name))

        self.assertFalse(self.reaches_us(name))


class TestARefusedRequestCanBeCorrected(MSPTestCase):
    """Refused is not the end of the road: the author reads why, corrects, and sends again."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.track("MSP Approval Authority", self.customer)
        self.person = self.make_person(self.customer, "Subject")
        self.service = self.make_service("RC", scope="User")
        self.asker = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="rca")
        self.decider = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="rcd")
        self.tech = self.make_account("internal", "MSP Technician", suffix="rct")

    def as_user(self, email, fn):
        frappe.set_user(email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def line(self):
        return {
            "request_action": self.action(),
            "action": "Add",
            "target_scope": "User",
            "client_user": self.person,
            "requested_service": self.service,
        }

    def raise_one(self):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add", lines=[self.line()]
            ),
        )
        return self.track("MSP Service Request", out["name"])

    def test_refused_inside_the_company_it_stays_readable_and_can_be_raised_again(self):
        AuthorityService.set_account_rights(self.decider, {"can_submit": 1, "can_approve": 1})
        self.grant(self.asker, can_submit=1, can_approve=0)
        name = self.raise_one()
        self.as_user(self.decider, lambda: PortalService.reject_request(name, "wrong service"))

        again = self.as_user(self.asker, lambda: PortalService.get_request(name))
        self.assertEqual(again["status"], "Rejected")
        self.assertEqual(again["lines"][0]["client_user"], self.person, "the form can be refilled")
        self.assertIn(name, [r["name"] for r in self.as_user(self.asker, lambda: PortalService.list_requests(page_length=500))["rows"]])

        resent = self.raise_one()
        self.assertNotEqual(resent, name, "a fresh request, the refused one is kept as history")
        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Rejected")

    def test_refused_by_us_the_answer_is_readable_and_it_can_be_raised_again(self):
        self.grant(self.asker)
        name = self.raise_one()
        self.as_user(self.tech, lambda: RequestService.run_action(name, "reject", "not covered"))

        again = self.as_user(self.asker, lambda: PortalService.get_request(name))
        self.assertEqual(again["status"], "Rejected")
        self.assertEqual(again["rejection_reason"], "not covered")

        resent = self.raise_one()
        self.assertEqual(frappe.db.get_value("MSP Service Request", resent, "status"), "Submitted")


class TestNothingSlipsThroughWithoutAnAccord(MSPTestCase):
    """The matrix is the law, not a switch: without the right to approve, one waits."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.track("MSP Approval Authority", self.customer)
        self.person = self.make_person(self.customer, "Subject")
        self.service = self.make_service("NS", scope="User")
        self.asker = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="nsa")
        self.tech = self.make_account("internal", "MSP Technician", suffix="nst")

    def as_user(self, email, fn):
        frappe.set_user(email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def raise_one(self):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "client_user": self.person,
                        "requested_service": self.service,
                    }
                ],
            ),
        )
        return self.track("MSP Service Request", out["name"]), out

    def reaches_us(self, name):
        listed = self.as_user(self.tech, lambda: RequestService.list_requests(page_length=500))
        return name in [row["name"] for row in listed["rows"]]

    def test_named_to_raise_but_not_to_approve_one_waits_even_with_no_approver_at_all(self):
        AuthorityService.set_account_rights(self.asker, {"can_submit": 1, "can_approve": 0})
        self.assertFalse(approval.has_approvers(self.customer))

        name, out = self.raise_one()

        self.assertEqual(out["status"], "Awaiting Customer Approval")
        self.assertFalse(self.reaches_us(name), "nothing reaches us without an accord")
        with self.assertRaises(NotFoundError):
            self.as_user(self.tech, lambda: RequestService.get_request(name))

        detail = self.as_user(self.asker, lambda: PortalService.get_request(name))
        self.assertFalse(detail["has_approver"], "and the page can say nobody can approve yet")

    def test_someone_the_matrix_does_not_name_waits_too(self):
        name, out = self.raise_one()

        self.assertEqual(out["status"], "Awaiting Customer Approval")
        self.assertFalse(self.reaches_us(name))

    def test_once_the_right_is_granted_the_waiting_request_can_be_agreed(self):
        name, _ = self.raise_one()
        decider = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="nsd")
        AuthorityService.set_account_rights(decider, {"can_submit": 1, "can_approve": 1})

        self.assertTrue(self.as_user(self.asker, lambda: PortalService.get_request(name))["has_approver"])
        self.as_user(decider, lambda: PortalService.approve_request(name))

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Submitted")
        self.assertTrue(self.reaches_us(name))
