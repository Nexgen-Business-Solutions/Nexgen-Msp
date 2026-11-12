"""The printed invoice: the fields the document records, and a total that is its own.

The Nexgen print format is read by the customer who pays it, so every line has to say what
was charged and why: the price on the list, the discount the line records, the price after it
and the amount. None of it is worked out in the template — a figure that is not on the Sales
Invoice is not printed, and the amount owed is the one ERPNext governs.
"""

import re

import frappe

from nexgen_msp.utils import invoice_pdf

from .test_billing_history import BillingHistoryCase

FORMAT = "Nexgen MSP Invoice"
COLUMNS = [
    "DESCRIPTION",
    "USERS/DEVICES",
    "QUANTITY",
    "LIST UNIT PRICE",
    "DISCOUNT %",
    "NET UNIT PRICE",
    "LINE TOTAL",
]


def text(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


def cells(row):
    return [text(cell) for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]


class PrintCase(BillingHistoryCase):
    def payable(self, doc):
        rounded = doc.rounded_total if not doc.disable_rounded_total else None

        return rounded or doc.grand_total

    def money(self, value, doc):
        formatted = frappe.format_value(abs(value), {"fieldtype": "Currency"}, doc)

        return f"({formatted})" if value < 0 else formatted

    def invoice(self, items, taxes=None, is_return=0, **values):
        """An invoice written as the desk writes one, then read back as ERPNext stored it."""
        company = frappe.defaults.get_global_default("company")
        income = frappe.db.get_value("Company", company, "default_income_account")
        doc = frappe.get_doc(
            {
                "doctype": "Sales Invoice",
                "company": company,
                "customer": self.customer,
                "posting_date": self.today,
                "set_posting_time": 1,
                "due_date": frappe.utils.add_days(self.today, 30),
                "is_return": is_return,
                "items": [{"income_account": income, **item} for item in items],
                "taxes": taxes or [],
                **values,
            }
        )
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)
        self.track("Sales Invoice", doc.name)

        return frappe.get_doc("Sales Invoice", doc.name)

    def printed(self, name):
        return frappe.get_print("Sales Invoice", name, print_format=FORMAT, no_letterhead=1)

    def table(self, html):
        """The detail table as a reader sees it: its heading row, then one list per line.

        The heading is found by its first column rather than by its position: a draft or a
        cancelled document carries a status band above it, which repeats wherever the table
        breaks across a page and is not a column heading.
        """
        block = re.search(r'<table class="items grid">(.*?)</table>', html, re.S)
        rows = [cells(row) for row in re.findall(r"<tr[^>]*>(.*?)</tr>", block.group(1), re.S)]
        heading = next(index for index, row in enumerate(rows) if row and row[0] == COLUMNS[0])

        return rows[heading], rows[heading + 1 :]

    def totals(self, html):
        block = re.search(r'<table class="totals">(.*?)</table>', html, re.S)
        found = {}

        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", block.group(1), re.S):
            written = [cell for cell in cells(row) if cell]

            if len(written) >= 2:
                found[written[-2]] = written[-1]

        return found


class TestOneLineOnePrice(PrintCase):
    def test_a_line_with_no_discount_prints_its_price_once_and_deducts_nothing(self):
        service = self.offering("PNO")
        doc = self.invoice([{"item_code": service, "qty": 2, "rate": 1000.0, "uom": "Month"}])
        heading, rows = self.table(self.printed(doc.name))
        item = doc.items[0]
        totals = self.totals(self.printed(doc.name))

        self.assertEqual(heading, COLUMNS)
        self.assertEqual(
            rows[0][2:],
            [
                "2 Month",
                self.money(item.price_list_rate, doc) if item.price_list_rate else "—",
                "0%" if item.price_list_rate else "—",
                self.money(item.rate, doc),
                self.money(item.amount, doc),
            ],
        )
        self.assertEqual(totals["SUBTOTAL"], self.money(doc.total, doc))
        self.assertEqual(totals["TOTAL"], self.money(self.payable(doc), doc))
        self.assertNotIn("INVOICE DISCOUNT", totals)

    def test_the_count_behind_the_line_is_printed_as_it_is_recorded(self):
        service = self.offering("PCT")
        doc = self.invoice(
            [
                {"item_code": service, "qty": 1, "rate": 500.0, "msp_billed_count": 7},
                {"item_code": service, "qty": 1, "rate": 400.0},
            ]
        )
        _, rows = self.table(self.printed(doc.name))

        self.assertEqual([row[1] for row in rows], ["7", "—"])

    def test_the_download_and_the_attachment_use_this_same_format(self):
        self.assertEqual(invoice_pdf.PRINT_FORMAT, FORMAT)


class TestWhatCameOffEachLine(PrintCase):
    def test_two_lines_with_different_discounts_each_keep_their_own_percentage(self):
        service = self.offering("PDI")
        doc = self.invoice(
            [
                {
                    "item_code": service,
                    "qty": 3,
                    "price_list_rate": 1000.0,
                    "discount_percentage": 12.5,
                    "uom": "Month",
                },
                {
                    "item_code": service,
                    "qty": 1,
                    "price_list_rate": 800.0,
                    "discount_percentage": 20,
                    "uom": "Month",
                },
            ]
        )
        html = self.printed(doc.name)
        _, rows = self.table(html)
        totals = self.totals(html)

        self.assertEqual([row[4] for row in rows], ["12.5%", "20%"])
        self.assertEqual(
            [row[3] for row in rows],
            [self.money(item.price_list_rate, doc) for item in doc.items],
        )
        self.assertEqual([row[5] for row in rows], [self.money(item.rate, doc) for item in doc.items])
        self.assertEqual([row[6] for row in rows], [self.money(item.amount, doc) for item in doc.items])
        self.assertEqual(
            totals["SUBTOTAL"],
            self.money(sum(item.amount for item in doc.items), doc),
            "the subtotal is the lines themselves, with their discounts already in them",
        )
        self.assertNotIn(
            "DISCOUNT", totals, "a line discount is not deducted a second time in the footer"
        )
        self.assertEqual(totals["TOTAL"], self.money(self.payable(doc), doc))

    def test_a_net_rate_with_no_percentage_recorded_says_zero_and_invents_nothing(self):
        service = self.offering("PNET")
        doc = self.invoice(
            [{"item_code": service, "qty": 1, "price_list_rate": 64.38, "rate": 51.50}]
        )
        html = self.printed(doc.name)
        heading, rows = self.table(html)
        item = doc.items[0]
        detail = " ".join(" ".join(row) for row in [heading, *rows])

        self.assertEqual(rows[0][3], self.money(item.price_list_rate, doc))
        self.assertEqual(rows[0][5], self.money(item.rate, doc))
        self.assertEqual(
            rows[0][4],
            f"{frappe.utils.flt(item.discount_percentage, 2):g}%",
            "the percentage printed is the one the line records, however it was written",
        )
        self.assertIn("0%", detail)
        self.assertNotIn("20%", detail, "a percentage nobody recorded is not printed")
        self.assertEqual(self.totals(html)["TOTAL"], self.money(self.payable(doc), doc))


class TestTheTotalIsTheDocumentsOwn(PrintCase):
    def test_a_part_month_a_tax_and_a_discount_on_the_invoice_still_add_up(self):
        service = self.offering("PMIX")
        account = frappe.db.get_value(
            "Account", {"account_type": "Tax", "is_group": 0, "disabled": 0}, "name"
        ) or frappe.db.get_value("Account", {"is_group": 0, "disabled": 0}, "name")
        doc = self.invoice(
            [
                {
                    "item_code": service,
                    "qty": 2.5,
                    "price_list_rate": 1000.0,
                    "discount_percentage": 10,
                    "uom": "Month",
                }
            ],
            taxes=[
                {
                    "charge_type": "On Net Total",
                    "account_head": account,
                    "description": "VAT",
                    "rate": 19.25,
                }
            ],
            apply_discount_on="Net Total",
            discount_amount=250.0,
        )
        html = self.printed(doc.name)
        _, rows = self.table(html)
        totals = self.totals(html)
        self.assertEqual(rows[0][2], "2.5 Month")
        self.assertEqual(rows[0][4], "10%")
        self.assertEqual(totals["SUBTOTAL"], self.money(sum(item.amount for item in doc.items), doc))
        self.assertEqual(totals["INVOICE DISCOUNT"], self.money(-doc.discount_amount, doc))
        self.assertEqual(totals["NET TOTAL"], self.money(doc.net_total, doc))
        self.assertEqual(totals["VAT"], self.money(doc.taxes[0].tax_amount, doc))
        self.assertEqual(totals["TOTAL"], self.money(self.payable(doc), doc))

    def test_a_credit_note_says_so_and_keeps_the_signs_it_was_written_with(self):
        service = self.offering("PCN")
        doc = self.invoice(
            [{"item_code": service, "qty": -1, "rate": 1000.0, "uom": "Month"}], is_return=1
        )
        html = self.printed(doc.name)
        _, rows = self.table(html)
        totals = self.totals(html)

        self.assertIn("CREDIT NOTE", text(html))
        self.assertNotIn(">INVOICE<", html)
        self.assertEqual(rows[0][2], "-1 Month")
        self.assertEqual(rows[0][6], self.money(doc.items[0].amount, doc))
        self.assertTrue(rows[0][6].startswith("("), "a credit note is not printed as a charge")
        self.assertEqual(totals["TOTAL"], self.money(self.payable(doc), doc))


class TestOnThePage(PrintCase):
    def test_long_descriptions_and_many_lines_keep_the_seven_columns(self):
        service = self.offering("PLONG")
        written = (
            "Managed detection and response for the whole estate, invoiced monthly in arrears, "
            "including the quarterly review meeting and the out-of-hours escalation line"
        )
        doc = self.invoice(
            [
                {
                    "item_code": service,
                    "qty": 1,
                    "rate": 100.0 + index,
                    "uom": "Month",
                    "description": f"{written} — line {index + 1}",
                }
                for index in range(25)
            ]
        )
        html = self.printed(doc.name)
        heading, rows = self.table(html)

        self.assertEqual(heading, COLUMNS)
        self.assertEqual(len(rows), 25)
        self.assertTrue(all(len(row) == 7 for row in rows))
        self.assertIn(written, text(html), "nothing of what was written is cut out")
        self.assertIn("table-header-group", html, "the heading is repeated on every page")
        self.assertEqual(
            self.totals(html)["SUBTOTAL"],
            self.money(sum(item.amount for item in doc.items), doc),
        )


class TestTheDocumentSaysWhatItIs(PrintCase):
    """A printed invoice has to carry its own accounting standing.

    The template chose INVOICE or CREDIT NOTE from `is_return` and said nothing at all about
    `docstatus`, so a draft printed exactly like a payable document. That is not theoretical:
    this site leaves `allow_print_for_draft` on, which is how a customer ends up holding an
    unmarked draft. Frappe refuses to print a cancelled document unless the matching setting
    is turned on, so that side is a precaution rather than a live hole — but the setting is
    one click away, and a document printed under it must say what it is.

    The standing is written three ways on purpose: a stamp beside the title, a band inside
    the detail table's head — which a renderer repeats wherever that table breaks across a
    page — and a light mark behind the page. Each spells the word, so a grey print still
    says it, and none is dark enough to cover a figure.
    """

    CANCELLED_SETTING = "allow_print_for_cancelled"

    def setUp(self):
        super().setUp()
        self.kept = frappe.db.get_single_value("Print Settings", self.CANCELLED_SETTING)

    def tearDown(self):
        frappe.db.set_single_value("Print Settings", self.CANCELLED_SETTING, self.kept)
        frappe.db.commit()
        super().tearDown()

    def service(self):
        """One offering per test: a second one would price the same item twice."""
        if not getattr(self, "_service", None):
            self._service = self.offering("PSTD")

        return self._service

    def allow_cancelled(self):
        frappe.db.set_single_value("Print Settings", self.CANCELLED_SETTING, 1)
        frappe.db.commit()

    def drawn(self, docstatus, is_return=0):
        """A document at a given standing.

        Only `docstatus` is moved, because only that is what the template reads: posting it
        for real would write ledger entries that have nothing to do with what is tested here.
        """
        doc = self.invoice(
            [{
                "item_code": self.service(),
                "qty": -1 if is_return else 1,
                "rate": 100.0,
                "uom": "Month",
            }],
            is_return=is_return,
        )

        if docstatus:
            frappe.db.set_value(
                "Sales Invoice", doc.name, "docstatus", docstatus, update_modified=False
            )

        return self.printed(doc.name)

    def test_a_draft_says_so_beside_its_title(self):
        printed = text(self.drawn(0))

        self.assertIn("DRAFT", printed)
        self.assertIn("INVOICE", printed)
        self.assertNotIn("CANCELLED", printed)

    def test_a_posted_document_carries_no_standing_at_all(self):
        printed = text(self.drawn(1))

        self.assertNotIn("DRAFT", printed)
        self.assertNotIn("CANCELLED", printed)
        self.assertIn("INVOICE", printed)

    def test_frappe_refuses_a_cancelled_document_before_the_template_is_reached(self):
        """The first guard is the framework's own, and it is left exactly as it is."""
        frappe.db.set_single_value("Print Settings", self.CANCELLED_SETTING, 0)
        frappe.db.commit()

        with self.assertRaises(frappe.PermissionError):
            self.drawn(2)

    def test_a_cancelled_document_printed_under_that_setting_says_it_is_not_payable(self):
        self.allow_cancelled()

        printed = text(self.drawn(2))

        self.assertIn("CANCELLED", printed)
        self.assertIn("not a payable document", printed)
        self.assertNotIn("DRAFT", printed)

    def test_a_credit_note_keeps_its_own_title_and_takes_the_standing_as_well(self):
        printed = text(self.drawn(0, is_return=1))

        self.assertIn("CREDIT NOTE", printed)
        self.assertIn("DRAFT", printed)

    def test_the_standing_rides_in_the_table_head_so_every_page_carries_it(self):
        """A fixed banner is a renderer's whim; a table head is repeated by both of them."""
        self.allow_cancelled()

        html = self.drawn(2)
        head = re.search(r'<table class="items grid">\s*<thead>(.*?)</thead>', html, re.S)

        self.assertIsNotNone(head, "the detail table head was not found")
        self.assertIn("CANCELLED", text(head.group(1)))

    def test_the_standing_is_spelled_out_and_never_left_to_colour(self):
        self.allow_cancelled()

        for docstatus, word in ((0, "DRAFT"), (2, "CANCELLED")):
            printed = text(self.drawn(docstatus))

            self.assertGreaterEqual(printed.count(word), 2, word)

    def test_nothing_about_the_money_moves_with_the_standing(self):
        """The only difference between the three is the standing itself."""
        self.allow_cancelled()
        figures = {}

        for docstatus in (0, 1, 2):
            html = self.drawn(docstatus)
            heading, rows = self.table(html)
            figures[docstatus] = (heading, rows, self.totals(html))

        self.assertEqual(figures[0], figures[1])
        self.assertEqual(figures[1], figures[2])

    def test_the_status_is_read_off_the_document_and_not_inferred(self):
        """Never from the run, the route or the name: only the Sales Invoice's own field."""
        source = frappe.get_app_path(
            "nexgen_msp", "nexgen_msp", "print_format", "nexgen_msp_invoice",
            "nexgen_msp_invoice.html",
        )

        with open(source) as handle:
            template = handle.read()

        self.assertIn("doc.docstatus", template)
        self.assertNotIn("billing_run", template.lower())


class TestTheStandingSurvivesTheRenderer(PrintCase):
    """The file the customer opens, not the HTML we hand to a renderer.

    Nothing here simulates a PDF. On a bench with no renderer installed every test in this
    class says exactly that and stops: a PDF nobody produced proves nothing about the one
    the customer receives, and a test that passes by pretending is worse than no test.
    """

    CANCELLED_SETTING = "allow_print_for_cancelled"
    RENDERERS = ("wkhtmltopdf", "chromium", "chromium-browser", "google-chrome", "chrome")

    def setUp(self):
        super().setUp()
        self.kept = frappe.db.get_single_value("Print Settings", self.CANCELLED_SETTING)

    def tearDown(self):
        frappe.db.set_single_value("Print Settings", self.CANCELLED_SETTING, self.kept)
        frappe.db.commit()
        super().tearDown()

    def renderer(self):
        """The binary that turns the page into a file, or a stated reason there is none."""
        from shutil import which

        found = next((binary for binary in self.RENDERERS if which(binary)), None)

        if not found:
            self.skipTest(
                "No PDF renderer is installed on this bench "
                f"({', '.join(self.RENDERERS)}): the printed HTML is covered by the tests "
                "above, and the PDF itself cannot be produced here."
            )

        return found

    def document(self, docstatus, is_return=0):
        doc = self.invoice(
            [{"item_code": self.offering("PPDF"), "qty": -1 if is_return else 1,
              "rate": 100.0, "uom": "Month"}],
            is_return=is_return,
        )

        if docstatus:
            frappe.db.set_value(
                "Sales Invoice", doc.name, "docstatus", docstatus, update_modified=False
            )

        return doc.name

    def rendered(self, name):
        from frappe.utils.pdf import get_pdf

        return get_pdf(self.printed(name))

    def words(self, pdf):
        from io import BytesIO

        from pypdf import PdfReader

        return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf)).pages)

    def test_the_renderer_produces_a_real_file(self):
        self.renderer()

        pdf = self.rendered(self.document(0))

        self.assertTrue(pdf.startswith(b"%PDF"), "what came back is not a PDF")

    def test_a_draft_carries_the_word_into_the_file(self):
        self.renderer()

        self.assertIn("DRAFT", self.words(self.rendered(self.document(0))))

    def test_a_cancelled_document_carries_its_own_word_and_not_the_other(self):
        self.renderer()
        frappe.db.set_single_value("Print Settings", self.CANCELLED_SETTING, 1)
        frappe.db.commit()

        printed = self.words(self.rendered(self.document(2)))

        self.assertIn("CANCELLED", printed)
        self.assertNotIn("DRAFT", printed)

    def test_a_posted_document_carries_neither(self):
        self.renderer()

        printed = self.words(self.rendered(self.document(1)))

        self.assertNotIn("DRAFT", printed)
        self.assertNotIn("CANCELLED", printed)
