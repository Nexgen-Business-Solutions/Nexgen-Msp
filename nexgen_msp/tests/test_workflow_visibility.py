"""Who sees which request, and what they may do to it, from the draft to the last status.

Seven pairs of eyes on one request: its author (may raise, not approve), the person who
decides at the company (may approve, not raise), someone holding both rights, a colleague
the matrix does not name, a manager at another company, our technician, our administrator.
The request is walked through every status, including both ways of being refused.
"""

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .base import MSPTestCase

REFUSED = (ValidationError, NotFoundError, frappe.PermissionError, frappe.ValidationError)


class TestWhoSeesWhatAndMayDoWhat(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.elsewhere = self.make_customer(suffix="B")
        self.track("MSP Approval Authority", self.customer)
        self.person = self.make_person(self.customer, "Subject")
        frappe.db.set_value("MSP Client User", self.person, "username", "s.subject")
        self.service = self.make_service("WV", scope="User")

        self.author = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="wva")
        self.decider = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="wvd")
        self.both = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="wvb")
        self.colleague = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="wvc")
        self.stranger = self.make_account("customer", "MSP Customer Manager", self.elsewhere, suffix="wvs")
        self.tech = self.make_account("internal", "MSP Technician", suffix="wvt")
        self.admin = self.make_account("internal", "MSP System Admin", suffix="wvm")

        self.grant(self.author, can_submit=1, can_approve=0)
        self.grant(self.decider, can_submit=0, can_approve=1)
        self.grant(self.both, can_submit=1, can_approve=1)

    # ------------------------------------------------------------------ helpers
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
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

    def raised_by(self, email):
        out = self.as_user(
            email,
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add", lines=[self.line()]
            ),
        )
        return self.track("MSP Service Request", out["name"]), out

    def drafted_by(self, email):
        out = self.as_user(
            email,
            lambda: PortalService.save_draft(customer=self.customer, request_type="Add", lines=[self.line()]),
        )
        return self.track("MSP Service Request", out["name"])

    def portal_sees(self, email, name):
        listed = self.as_user(email, lambda: PortalService.list_requests(page_length=500))
        return name in [row["name"] for row in listed["rows"]]

    def portal_opens(self, email, name):
        try:
            return self.as_user(email, lambda: PortalService.get_request(name))
        except REFUSED:
            return None

    def we_see(self, email, name):
        listed = self.as_user(email, lambda: RequestService.list_requests(page_length=500))
        return name in [row["name"] for row in listed["rows"]]

    def we_open(self, email, name):
        try:
            return self.as_user(email, lambda: RequestService.get_request(name))
        except REFUSED:
            return None

    def act(self, email, name, action, reason=None):
        return self.as_user(email, lambda: RequestService.run_action(name, action, reason))

    def refused(self, fn):
        with self.assertRaises(REFUSED):
            fn()

    def status(self, name):
        return frappe.db.get_value("MSP Service Request", name, "status")

    def to_in_progress(self, name):
        self.act(self.tech, name, "start_review")
        self.as_user(self.tech, lambda: RequestService.set_line_status(name, 1, "Approved"))
        self.act(self.tech, name, "approve")
        self.act(self.tech, name, "start_work")

    # ------------------------------------------------------------ the draft
    def test_a_draft_exists_for_its_author_alone(self):
        name = self.drafted_by(self.author)

        self.assertTrue(self.portal_sees(self.author, name))
        self.assertIsNotNone(self.portal_opens(self.author, name))

        for someone in (self.decider, self.both, self.colleague, self.stranger):
            self.assertFalse(self.portal_sees(someone, name), someone)
            self.assertIsNone(self.portal_opens(someone, name), someone)

        for ours in (self.tech, self.admin):
            self.assertFalse(self.we_see(ours, name), ours)
            self.assertIsNone(self.we_open(ours, name), ours)

        # nobody can agree to, refuse, or move a page still being written
        self.refused(lambda: self.as_user(self.decider, lambda: PortalService.approve_request(name)))
        self.refused(lambda: self.act(self.tech, name, "start_review"))
        self.refused(lambda: self.act(self.admin, name, "cancel"))

    # ------------------------------------------ waiting inside the company
    def test_waiting_for_the_accord_the_company_sees_it_and_we_do_not(self):
        name, out = self.raised_by(self.author)
        self.assertEqual(out["status"], "Awaiting Customer Approval")

        for theirs in (self.author, self.decider, self.both, self.colleague):
            self.assertTrue(self.portal_sees(theirs, name), theirs)
            self.assertIsNotNone(self.portal_opens(theirs, name), theirs)

        self.assertFalse(self.portal_sees(self.stranger, name))
        self.assertIsNone(self.portal_opens(self.stranger, name))

        for ours in (self.tech, self.admin):
            self.assertFalse(self.we_see(ours, name), ours)
            self.assertIsNone(self.we_open(ours, name), ours)

        # only those holding the right are offered the decision
        self.assertTrue(self.portal_opens(self.decider, name)["can_decide"])
        self.assertTrue(self.portal_opens(self.both, name)["can_decide"])
        for not_them in (self.author, self.colleague):
            self.assertFalse(self.portal_opens(not_them, name)["can_decide"], not_them)
            self.refused(lambda: self.as_user(not_them, lambda: PortalService.approve_request(name)))
            self.refused(lambda: self.as_user(not_them, lambda: PortalService.reject_request(name, "no")))

        self.refused(lambda: self.as_user(self.stranger, lambda: PortalService.approve_request(name)))

        # and our team has nothing to do with it yet, whatever it tries
        self.assertEqual(RequestService._allowed_actions("Awaiting Customer Approval"), [])
        for action in ("start_review", "reject", "cancel"):
            self.refused(lambda: self.act(self.admin, name, action, "x"))
        self.assertEqual(self.status(name), "Awaiting Customer Approval")

    def test_refused_inside_the_company_it_never_reaches_us(self):
        name, _ = self.raised_by(self.author)

        self.as_user(self.decider, lambda: PortalService.reject_request(name, "not this quarter"))

        self.assertEqual(self.status(name), "Rejected")
        self.assertTrue(frappe.db.get_value("MSP Service Request", name, "refused_by_customer"))

        seen = self.portal_opens(self.author, name)
        self.assertIsNotNone(seen)
        self.assertEqual(seen["rejection_reason"], "not this quarter")
        self.assertTrue(self.portal_sees(self.colleague, name))

        for ours in (self.tech, self.admin):
            self.assertFalse(self.we_see(ours, name), ours)
            self.assertIsNone(self.we_open(ours, name), ours)

        # closed on their side: nobody agrees to it afterwards
        self.refused(lambda: self.as_user(self.decider, lambda: PortalService.approve_request(name)))

    def test_holding_both_rights_one_raises_and_agrees_in_one_gesture(self):
        name, out = self.raised_by(self.both)

        self.assertEqual(out["status"], "Submitted")
        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "customer_approved_by"), self.both)
        self.assertTrue(self.we_see(self.tech, name))

    def test_holding_only_the_right_to_approve_one_cannot_raise(self):
        self.refused(lambda: self.raised_by(self.decider))
        self.refused(lambda: self.drafted_by(self.decider) and self.as_user(
            self.decider,
            lambda: PortalService.create_request(
                name=frappe.db.get_value("MSP Service Request", {"requester": self.decider, "status": "Draft"}, "name"),
                customer=self.customer, request_type="Add", lines=[self.line()],
            ),
        ))
        rights = self.as_user(self.decider, lambda: PortalService.my_approval_rights(self.customer))
        self.assertFalse(rights["can_submit"], "and the portal must not even offer the button")
        self.assertTrue(rights["can_approve"])

    # --------------------------------------------------------- once with us
    def test_agreed_it_reaches_us_and_the_company_can_no_longer_decide(self):
        name, _ = self.raised_by(self.author)
        self.as_user(self.decider, lambda: PortalService.approve_request(name))

        self.assertEqual(self.status(name), "Submitted")
        for ours in (self.tech, self.admin):
            self.assertTrue(self.we_see(ours, name), ours)
            self.assertIsNotNone(self.we_open(ours, name), ours)
        for theirs in (self.author, self.decider, self.colleague):
            self.assertTrue(self.portal_sees(theirs, name), theirs)
            self.assertFalse(self.portal_opens(theirs, name)["can_decide"], theirs)
        self.assertIsNone(self.portal_opens(self.stranger, name))

        self.refused(lambda: self.as_user(self.decider, lambda: PortalService.approve_request(name)))
        self.refused(lambda: self.as_user(self.decider, lambda: PortalService.reject_request(name, "late")))

    def test_the_road_through_our_hands_and_who_may_walk_it(self):
        name, _ = self.raised_by(self.both)

        # only our team moves it, and only along the road
        self.refused(lambda: self.as_user(self.author, lambda: RequestService.run_action(name, "start_review")))
        self.refused(lambda: self.act(self.tech, name, "approve"))
        self.refused(lambda: self.act(self.tech, name, "complete"))

        self.act(self.tech, name, "start_review")
        self.assertEqual(self.status(name), "Under Review")

        # a review is a decision on every line first
        self.refused(lambda: self.act(self.tech, name, "approve"))
        self.as_user(self.tech, lambda: RequestService.set_line_status(name, 1, "Approved"))
        self.act(self.tech, name, "approve")
        self.assertEqual(self.status(name), "Approved")

        # cancelling is the administrator's, not the technician's
        self.refused(lambda: self.act(self.tech, name, "cancel", "x"))

        self.act(self.tech, name, "start_work")
        self.assertEqual(self.status(name), "In Progress")

        self.act(self.tech, name, "complete")
        self.assertEqual(self.status(name), "Completed")

        # the customer reads the outcome, and nothing moves any more
        self.assertEqual(self.portal_opens(self.author, name)["status"], "Completed")
        for action in ("reject", "cancel", "complete", "start_review"):
            self.refused(lambda: self.act(self.admin, name, action, "x"))

    def test_we_may_refuse_it_at_any_open_stage_and_the_customer_reads_why(self):
        for stage in ("Submitted", "Under Review", "In Progress"):
            name, _ = self.raised_by(self.both)
            if stage != "Submitted":
                self.act(self.tech, name, "start_review")
            if stage == "In Progress":
                self.as_user(self.tech, lambda: RequestService.set_line_status(name, 1, "Approved"))
                self.act(self.tech, name, "approve")
                self.act(self.tech, name, "start_work")
            self.assertEqual(self.status(name), stage)

            self.act(self.tech, name, "reject", f"refused at {stage}")

            self.assertEqual(self.status(name), "Rejected")
            self.assertFalse(frappe.db.get_value("MSP Service Request", name, "refused_by_customer"))
            self.assertEqual(self.portal_opens(self.both, name)["rejection_reason"], f"refused at {stage}")
            self.assertTrue(self.we_see(self.admin, name), "refused by us, it stays in our history")
            self.refused(lambda: self.act(self.admin, name, "start_review"))

    def test_the_administrator_may_cancel_what_the_technician_may_not(self):
        name, _ = self.raised_by(self.both)
        self.to_in_progress(name)

        self.refused(lambda: self.act(self.tech, name, "cancel", "x"))
        self.act(self.admin, name, "cancel", "no longer needed")

        self.assertEqual(self.status(name), "Cancelled")
        self.assertEqual(self.portal_opens(self.author, name)["status"], "Cancelled")
        self.refused(lambda: self.act(self.admin, name, "start_work"))

    def test_after_a_refusal_the_author_sends_a_corrected_one_that_walks_the_same_road(self):
        first, _ = self.raised_by(self.author)
        self.as_user(self.decider, lambda: PortalService.reject_request(first, "wrong service"))

        second, out = self.raised_by(self.author)
        self.assertNotEqual(second, first)
        self.assertEqual(out["status"], "Awaiting Customer Approval")
        self.assertFalse(self.we_see(self.tech, second))

        self.as_user(self.decider, lambda: PortalService.approve_request(second))
        self.assertTrue(self.we_see(self.tech, second))
        self.assertEqual(self.status(first), "Rejected", "the refused one is history, untouched")

    def test_another_company_reaches_nothing_at_any_stage(self):
        name, _ = self.raised_by(self.both)
        self.to_in_progress(name)

        self.assertFalse(self.portal_sees(self.stranger, name))
        self.assertIsNone(self.portal_opens(self.stranger, name))
        self.refused(lambda: self.as_user(self.stranger, lambda: PortalService.reject_request(name, "x")))
        self.refused(lambda: self.as_user(self.stranger, lambda: RequestService.run_action(name, "complete")))
