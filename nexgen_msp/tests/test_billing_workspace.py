"""One read behind the Billing page: the figures, the work waiting, one list at a time."""

import frappe

from nexgen_msp.api.internal.services.billing import workspace

from .test_billing_history import BillingHistoryCase


class WorkspaceCase(BillingHistoryCase):
    def setUp(self):
        super().setUp()
        self.service = self.offering("WSP")
        self.assignment = self.running(self.service, client_user=self.john)
        frappe.db.set_value("Customer", self.customer, "msp_last_billed_on", self.days_ago(400))
        frappe.db.commit()

    def mine(self, **kwargs):
        answer = workspace.workspace(**kwargs)
        answer["rows"] = [
            row for row in answer["rows"] if row.get("customer") in (self.customer, None)
        ]

        return answer


class TestWhatThePageIsTold(WorkspaceCase):
    def test_it_answers_with_everything_the_page_draws(self):
        answer = workspace.workspace()

        for key in ("figures", "actions", "rows", "counts", "tab", "total"):
            self.assertIn(key, answer)

    def test_the_figures_never_add_two_currencies_together(self):
        totals = workspace.workspace()["figures"]["invoiced_totals"]

        self.assertEqual(len({entry["currency"] for entry in totals}), len(totals))

    def test_a_drawn_run_shows_in_the_runs_tab_with_its_kind(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end)

        rows = self.mine(search=run)["rows"]

        self.assertEqual([row["name"] for row in rows], [run])
        self.assertEqual(rows[0]["kind"], "Regular billing")
        # a clean run validates itself on the way out of generate()
        self.assertEqual(rows[0]["status"], "Ready for Approval")

    def test_the_invoices_tab_reads_the_accounting_desk(self):
        answer = workspace.workspace(tab="invoices")

        self.assertEqual(answer["tab"], "invoices")
        for row in answer["rows"]:
            self.assertIn(row["origin"], ("MSP", "ERPNext"))

    def test_both_tabs_carry_their_own_count(self):
        answer = workspace.workspace()

        self.assertIn("runs", answer["counts"])
        self.assertIn("invoices", answer["counts"])


class TestTheOneStatusFilter(WorkspaceCase):
    def test_open_keeps_a_run_nobody_has_posted(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end)

        self.assertIn(run, [row["name"] for row in self.mine(search=run, status="open")["rows"]])

    def test_posted_leaves_an_unposted_run_out(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end)

        self.assertEqual(self.mine(search=run, status="posted")["rows"], [])

    def test_issue_keeps_only_what_needs_somebody(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end)
        frappe.db.set_value("MSP Billing Run", run, "exception_count", 2)
        frappe.db.commit()

        self.assertIn(run, [row["name"] for row in self.mine(search=run, status="issue")["rows"]])

    def test_a_clean_run_is_not_an_issue(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end)

        self.assertEqual(self.mine(search=run, status="issue")["rows"], [])


class TestWhatIsWaiting(WorkspaceCase):
    def test_the_actions_are_typed_and_never_merged(self):
        actions = workspace.workspace()["actions"]

        for action in actions:
            self.assertIn(action["kind"], ("period", "additions", "credit_note"))

    def test_an_overdue_contract_proposes_its_period(self):
        mine = [
            action
            for action in workspace.workspace()["actions"]
            if action["customer"] == self.customer and action["kind"] == "period"
        ]

        self.assertTrue(mine)
        self.assertEqual(mine[0]["frequency"], "Monthly")
