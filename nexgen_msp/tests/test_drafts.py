"""The draft, and the road it takes into the process.

A draft is a page the author has not finished writing. It must reach nobody until it is
sent: not a colleague at the same company, not the person who agrees to requests there,
not our own queue, and not a counter on either dashboard. Once sent, it becomes an ordinary
request and follows the very same road as one raised in a single sitting.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.api.internal.services.dashboard_service import DashboardService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .base import MSPTestCase


class TestTheDraft(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.track("MSP Approval Authority", self.customer)
        self.person = self.make_person(self.customer, "Subject")
        self.service = self.make_service("D", scope="User")

        self.author = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="aut")
        self.colleague = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="col")
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

    def line(self, **over):
        row = {
            "request_action": self.action(),
            "action": "Add",
            "target_scope": "User",
            "client_user": self.person,
            "requested_service": self.service,
        }
        row.update(over)
        return row

    def draft_of(self, email, name=None):
        out = self.as_user(
            email,
            lambda: PortalService.save_draft(
                name=name, customer=self.customer, request_type="Add", lines=[self.line()]
            ),
        )
        return self.track("MSP Service Request", out["name"]), out

    def portal_names(self, email):
        listed = self.as_user(email, lambda: PortalService.list_requests(page_length=500))
        return [row["name"] for row in listed["rows"]]

    def our_names(self, email=None):
        listed = self.as_user(email or self.tech, lambda: RequestService.list_requests(page_length=500))
        return [row["name"] for row in listed["rows"]]

    # ------------------------------------------------------ what a draft is
    def test_a_draft_is_saved_as_the_authors_own(self):
        name, out = self.draft_of(self.author)

        self.assertEqual(out["status"], "Draft")
        row = frappe.db.get_value(
            "MSP Service Request", name, ["requester", "source", "customer"], as_dict=True
        )
        self.assertEqual(row.requester, self.author)
        self.assertEqual(row.source, "Portal")
        self.assertEqual(row.customer, self.customer)

    def test_saving_again_grows_the_same_page_rather_than_a_second_one(self):
        name, _ = self.draft_of(self.author)

        again, out = self.draft_of(self.author, name=name)

        self.assertEqual(again, name)
        self.assertEqual(out["status"], "Draft")
        self.assertEqual(
            frappe.db.count("MSP Service Request", {"customer": self.customer, "status": "Draft"}), 1
        )

    def test_a_draft_tells_nobody(self):
        self.rights_of_decider()
        frappe.db.delete("Email Queue")

        self.draft_of(self.author)

        self.assertEqual(frappe.db.count("Email Queue"), 0, "a draft is not an announcement")

    # -------------------------------------------------- who may see a draft
    def test_only_its_author_sees_it_at_the_customer(self):
        name, _ = self.draft_of(self.author)

        self.assertIn(name, self.portal_names(self.author))
        self.assertNotIn(name, self.portal_names(self.colleague))
        self.assertNotIn(name, self.portal_names(self.decider))

    def test_a_colleague_cannot_open_it(self):
        name, _ = self.draft_of(self.author)

        with self.assertRaises(NotFoundError):
            self.as_user(self.colleague, lambda: PortalService.get_request(name))

        self.assertIsNotNone(self.as_user(self.author, lambda: PortalService.get_request(name)))

    def test_it_never_reaches_our_queue(self):
        name, _ = self.draft_of(self.author)

        self.assertNotIn(name, self.our_names())

        with self.assertRaises(NotFoundError):
            self.as_user(self.tech, lambda: RequestService.get_request(name))

    def test_our_own_draft_stays_ours_alone(self):
        other_tech = self.make_account("internal", "MSP Technician", suffix="te2")
        name, _ = self.draft_of(self.tech)

        self.assertIn(name, self.our_names(self.tech))
        self.assertNotIn(name, self.our_names(other_tech))

    # ------------------------------------------------------ what it counts as
    def test_it_is_not_work_waiting_on_our_team(self):
        before = self.as_user(self.tech, DashboardService.get_dashboard)["requests"]["open"]

        self.draft_of(self.author)

        after = self.as_user(self.tech, DashboardService.get_dashboard)["requests"]["open"]
        self.assertEqual(after, before, "a draft is not an open request")

    def test_the_customer_counts_their_own_draft_and_not_a_colleagues(self):
        mine, _ = self.draft_of(self.author)
        theirs, _ = self.draft_of(self.colleague)

        rows = self.as_user(
            self.author, lambda: PortalService.list_kpi_rows("open_requests", self.customer, 0, 100)
        )
        names = [row["name"] for row in rows["rows"]]

        self.assertIn(mine, names)
        self.assertNotIn(theirs, names)
        self.assertEqual(rows["total"], len(names))

        summary = self.as_user(self.author, lambda: PortalService.get_summary(self.customer))
        self.assertEqual(summary["open_requests"], rows["total"])

    # ----------------------------------------------- who may touch a draft
    def test_a_colleague_can_neither_save_over_it_nor_throw_it_away(self):
        name, _ = self.draft_of(self.author)

        with self.assertRaises(ValidationError):
            self.draft_of(self.colleague, name=name)

        with self.assertRaises(ValidationError):
            self.as_user(self.colleague, lambda: PortalService.discard_draft(name))

        self.assertTrue(frappe.db.exists("MSP Service Request", name))

    def test_another_company_cannot_reach_it_at_all(self):
        elsewhere = self.make_customer(suffix="B")
        stranger = self.make_account("customer", "MSP Customer Manager", elsewhere, suffix="str")
        name, _ = self.draft_of(self.author)

        for call in (
            lambda: PortalService.get_request(name),
            lambda: PortalService.discard_draft(name),
            lambda: PortalService.save_draft(
                name=name, customer=self.customer, request_type="Add", lines=[self.line()]
            ),
        ):
            with self.assertRaises((NotFoundError, ValidationError, frappe.PermissionError)):
                self.as_user(stranger, call)

        self.assertTrue(frappe.db.exists("MSP Service Request", name))

    def test_throwing_it_away_leaves_nothing_behind(self):
        name, _ = self.draft_of(self.author)

        self.as_user(self.author, lambda: PortalService.discard_draft(name))

        self.assertFalse(frappe.db.exists("MSP Service Request", name))

    # ------------------------------------------- the draft inside the process
    def rights_of_decider(self):
        AuthorityService.set_account_rights(self.decider, {"can_submit": 1, "can_approve": 1})

    def test_nobody_can_agree_to_a_page_still_being_written(self):
        self.rights_of_decider()
        name, _ = self.draft_of(self.author)

        with self.assertRaises((ValidationError, NotFoundError)):
            self.as_user(self.decider, lambda: PortalService.approve_request(name))

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Draft")

    def test_sending_it_walks_the_same_road_as_any_other_request(self):
        self.rights_of_decider()
        name, _ = self.draft_of(self.author)

        sent = self.as_user(
            self.author,
            lambda: PortalService.create_request(
                name=name, customer=self.customer, request_type="Add", lines=[self.line()]
            ),
        )

        self.assertEqual(sent["name"], name, "the same document grows up")
        self.assertEqual(sent["status"], "Awaiting Customer Approval")
        self.assertNotIn(name, self.our_names(), "not before the customer has agreed")

        self.as_user(self.decider, lambda: PortalService.approve_request(name))

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Submitted")
        self.assertIn(name, self.our_names())
        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "customer_approved_by"), self.decider
        )

    def test_sent_by_someone_who_may_approve_it_reaches_us_at_once(self):
        self.grant(self.author)
        name, _ = self.draft_of(self.author)

        sent = self.as_user(
            self.author,
            lambda: PortalService.create_request(
                name=name, customer=self.customer, request_type="Add", lines=[self.line()]
            ),
        )

        self.assertEqual(sent["status"], "Submitted")
        self.assertIn(name, self.our_names())

    def test_someone_who_may_not_raise_one_cannot_send_their_draft(self):
        self.rights_of_decider()
        AuthorityService.set_account_rights(self.author, {"can_submit": 0, "can_approve": 1})
        name, _ = self.draft_of(self.author)

        with self.assertRaises(ValidationError):
            self.as_user(
                self.author,
                lambda: PortalService.create_request(
                    name=name, customer=self.customer, request_type="Add", lines=[self.line()]
                ),
            )

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Draft")

    def test_once_sent_it_is_no_longer_a_draft_to_edit_or_throw_away(self):
        self.grant(self.author)
        name, _ = self.draft_of(self.author)
        self.as_user(
            self.author,
            lambda: PortalService.create_request(
                name=name, customer=self.customer, request_type="Add", lines=[self.line()]
            ),
        )

        with self.assertRaises(ValidationError):
            self.draft_of(self.author, name=name)

        with self.assertRaises(ValidationError):
            self.as_user(self.author, lambda: PortalService.discard_draft(name))

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Submitted")
