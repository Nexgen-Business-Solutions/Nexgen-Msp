"""The patches that give requests their new names, proved on synthetic data."""

import contextlib
import io

import frappe

from nexgen_msp.patches import rename_request_doctypes, rename_request_field

from .base import PREFIX, MSPTestCase

OLD_NAMES = ("MSP Service Request", "MSP Service Request Line", "MSP Service Work Order")
NEW_NAMES = ("MSP Request", "MSP Request Line", "MSP Work Order")
OWNERS = ("MSP Work Order", "MSP Requested Client User", "MSP Requested Device")
CARRIER = f"{PREFIX} Request Carrier"
CARRIER_TABLE = f"tab{CARRIER}"


def printed(call, *args):
	"""What a patch function printed, and what it returned."""
	buffer = io.StringIO()

	with contextlib.redirect_stdout(buffer):
		result = call(*args)

	return buffer.getvalue(), result


def request_state(request):
	"""The doctypes, and the rows and history of one request, that the rename would move."""
	orders = frappe.get_all("MSP Work Order", filters={"request": request}, pluck="name", order_by="name")

	return {
		"doctypes": {name: bool(frappe.db.exists("DocType", name)) for name in OLD_NAMES + NEW_NAMES},
		"rows": {
			"MSP Request": frappe.db.count("MSP Request", {"name": request}),
			"MSP Request Line": frappe.db.count("MSP Request Line", {"parent": request}),
			"MSP Work Order": orders,
		},
		"versions": frappe.db.count("Version", {"ref_doctype": "MSP Request", "docname": request}),
		"comments": frappe.db.count("Comment", {"reference_doctype": "MSP Request", "reference_name": request}),
		"renamed": frappe.db.count(
			"Comment", {"reference_doctype": "DocType", "reference_name": ("in", NEW_NAMES)}
		),
		"line parents": frappe.db.sql(
			"select parenttype, count(*) from `tabMSP Request Line` where parent = %s group by parenttype",
			request,
		),
	}


def owned_request(case):
	"""A draft request of the test's own, with two lines, a comment, a work order and Requested records."""
	from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
	from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService

	customer = case.make_customer("RN")
	person = case.make_person(customer, "Renamed")
	service = case.make_service("RNS", scope="User")
	second = case.make_service("RNT", scope="User")
	line = {"target_scope": "User", "client_user": person, "requested_service": service, "action": "Add"}
	doc = frappe.get_doc(
		{
			"doctype": "MSP Request",
			"customer": customer,
			"request_type": "Add",
			"priority": "Medium",
			"status": "Draft",
			"source": "Internal",
			"requester": frappe.session.user,
			"lines": [line, dict(line, requested_service=second)],
		}
	).insert(ignore_permissions=True)
	case.track("MSP Request", doc.name)
	doc.add_comment("Comment", "Owned by the rename test")
	frappe.get_doc(
		{
			"doctype": "MSP Work Order",
			"request": doc.name,
			"customer": customer,
			"work_type": "Service Action",
			"action": "Add",
			"service_item": service,
			"target_scope": "User",
			"client_user": person,
			"status": "Open",
		}
	).insert(ignore_permissions=True)
	RequestedClientUserService.create_or_update_draft(doc.name, "new:renamed", {"full_name": f"{PREFIX} Renamed New"})
	RequestedDeviceService.create_or_update_draft(doc.name, "new-device:renamed", {"display_label": "Renamed laptop"})
	frappe.db.commit()

	return doc.name


class TestRequestDoctypeRename(MSPTestCase):

	def test_rename_changes_nothing_once_the_new_names_are_in_place(self):
		request = owned_request(self)
		before = request_state(request)

		self.assertEqual(before["rows"]["MSP Request"], 1)
		self.assertEqual(before["rows"]["MSP Request Line"], 2)
		self.assertEqual(len(before["rows"]["MSP Work Order"]), 1)
		self.assertEqual(before["comments"], 1)
		self.assertEqual(before["line parents"], (("MSP Request", 2),))

		self.assertEqual(before["doctypes"], {**dict.fromkeys(OLD_NAMES, False), **dict.fromkeys(NEW_NAMES, True)})

		output, _ = printed(rename_request_doctypes.execute)

		self.assertIn("0 request doctype(s) renamed, 0 stored name(s) moved", output)
		self.assertEqual(request_state(request), before)

	def test_a_stored_old_name_is_moved_to_the_new_one(self):
		record = frappe.get_doc(
			{
				"doctype": "Deleted Document",
				"deleted_doctype": "MSP Service Work Order",
				"deleted_name": f"{PREFIX}-WO-{frappe.generate_hash(length=6)}",
				"data": "{}",
			}
		).insert(ignore_permissions=True)
		self.addCleanup(self.forget_record, record.name)

		output, _ = printed(rename_request_doctypes.execute)

		self.assertIn("0 request doctype(s) renamed, 1 stored name(s) moved", output)
		self.assertEqual(frappe.db.get_value("Deleted Document", record.name, "deleted_doctype"), "MSP Work Order")

	def forget_record(self, name):
		frappe.db.delete("Deleted Document", {"name": name})
		frappe.db.commit()


class TestRequestFieldRename(MSPTestCase):
	def setUp(self):
		super().setUp()
		self.drop_carrier()
		frappe.get_doc(
			{
				"doctype": "DocType",
				"name": CARRIER,
				"module": "Nexgen MSP",
				"custom": 1,
				"autoname": "hash",
				"fields": [
					{"fieldname": "request", "fieldtype": "Data", "label": "Request"},
					{"fieldname": "note", "fieldtype": "Data", "label": "Note"},
				],
				"permissions": [{"role": "System Manager", "read": 1, "write": 1}],
			}
		).insert(ignore_permissions=True)
		frappe.db.commit()

	def tearDown(self):
		self.drop_carrier()
		super().tearDown()

	def drop_carrier(self):
		for doctype in ("DocField", "DocPerm", "DocType Action", "DocType Link", "DocType State"):
			frappe.db.delete(doctype, {"parent": CARRIER, "parenttype": "DocType"})
		frappe.db.delete("DocType", {"name": CARRIER})
		frappe.db.delete("Version", {"ref_doctype": "DocType", "docname": CARRIER})
		frappe.db.delete("Comment", {"reference_doctype": "DocType", "reference_name": CARRIER})
		frappe.db.commit()
		frappe.db.sql_ddl(f"drop table if exists `{CARRIER_TABLE}`")
		frappe.clear_cache(doctype=CARRIER)
		rename_request_field.forget_columns(CARRIER_TABLE)

	def carrier_rows(self):
		return dict(frappe.db.sql(f"select note, request from `{CARRIER_TABLE}` order by note"))

	def index_columns(self, name):
		return frappe.db.sql_list(
			"""
			select column_name from information_schema.statistics
			where table_schema = database() and table_name = %s and index_name = %s
			order by seq_in_index
			""",
			(CARRIER_TABLE, name),
		)

	def seed_old_column(self):
		frappe.db.sql_ddl(f"alter table `{CARRIER_TABLE}` add column `service_request` varchar(140)")
		frappe.db.sql_ddl(f"alter table `{CARRIER_TABLE}` add index `carrier_request` (`service_request`, `note`)")

		for note, value in (("a", "SR-ZZTEST-1"), ("b", "SR-ZZTEST-2"), ("c", None)):
			frappe.db.sql(
				f"insert into `{CARRIER_TABLE}` (name, note, service_request, creation, modified) "
				"values (%s, %s, %s, now(), now())",
				(f"{PREFIX}-{note}-{frappe.generate_hash(length=6)}", note, value),
			)

		frappe.db.commit()

	def test_the_old_column_is_carried_into_the_new_one_then_dropped(self):
		self.seed_old_column()
		self.assertEqual(self.carrier_rows(), {"a": None, "b": None, "c": None})
		self.assertEqual(self.index_columns("carrier_request"), ["service_request", "note"])

		_, copied = printed(rename_request_field.move_column, CARRIER)

		self.assertEqual(copied, 2)
		self.assertEqual(self.carrier_rows(), {"a": "SR-ZZTEST-1", "b": "SR-ZZTEST-2", "c": None})
		self.assertFalse(frappe.db.has_column(CARRIER, "service_request"))
		self.assertEqual(self.index_columns("carrier_request"), ["request", "note"])

		_, again = printed(rename_request_field.move_column, CARRIER)

		self.assertIsNone(again)
		self.assertEqual(self.carrier_rows(), {"a": "SR-ZZTEST-1", "b": "SR-ZZTEST-2", "c": None})

	def test_nothing_happens_without_the_old_column(self):
		frappe.db.sql(
			f"insert into `{CARRIER_TABLE}` (name, note, request, creation, modified) values (%s, 'a', 'SR-ZZTEST-9', now(), now())",
			(f"{PREFIX}-a-{frappe.generate_hash(length=6)}",),
		)
		frappe.db.commit()

		_, copied = printed(rename_request_field.move_column, CARRIER)

		self.assertIsNone(copied)
		self.assertEqual(self.carrier_rows(), {"a": "SR-ZZTEST-9"})

	def test_the_migrated_site_has_nothing_left_to_carry(self):
		request = owned_request(self)

		def owned():
			return {
				doctype: frappe.get_all(doctype, filters={"request": request}, pluck="name", order_by="name")
				for doctype in OWNERS
			}

		counts = owned()
		self.assertEqual({doctype: len(names) for doctype, names in counts.items()}, dict.fromkeys(OWNERS, 1))

		output, _ = printed(rename_request_field.execute)

		for doctype in OWNERS:
			self.assertIn(f"{doctype}: no service_request column, nothing to carry", output)
			self.assertFalse(frappe.db.has_column(doctype, "service_request"))

		self.assertEqual(owned(), counts)
