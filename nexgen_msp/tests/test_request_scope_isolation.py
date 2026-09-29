import json

import frappe

from nexgen_msp.api.internal.services.request_presentation_service import RequestPresentationService
from nexgen_msp.api.portal.services.request_builder_service import RequestBuilderService
from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .writer_case import WriterCase


class TestAnotherCustomersPersonStaysUnread(WriterCase):
    """A customer account naming somebody of another customer learns nothing about them."""

    def setUp(self):
        super().setUp()
        self.other = self.make_customer(f"WX{self.tag[:4]}")
        self.secret_department = self.make_department(f"ZZTEST Hidden {self.tag}")
        self.stranger = self.make_person(self.other, f"Stranger {self.tag}", department=self.secret_department)
        self.secret_email = f"stranger-{self.tag}@example.invalid"
        self.secret_username = f"stranger{self.tag}"
        frappe.db.set_value(
            "MSP Client User",
            self.stranger,
            {"email": self.secret_email, "username": self.secret_username},
        )
        self.secret_full_name = frappe.db.get_value("MSP Client User", self.stranger, "full_name")
        self.secret_device = self.make_device(
            self.other, hostname=f"WX{self.tag[:4]}", holder=self.stranger, serial=f"ZZTEST-WX-{self.tag}"
        )
        self.secret_hostname = frappe.db.get_value("MSP Managed Device", self.secret_device, "hostname")
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user("Administrator")

        for name in frappe.get_all("MSP Client User", filters={"customer": self.other}, pluck="name"):
            self.track("MSP Client User", name)

        super().tearDown()

    def foreign(self, client_user=None, key="user:foreign"):
        return {
            "subject_key": key,
            "kind": "existing",
            "client_user": client_user or self.stranger,
            "full_name": "Typed by the browser",
            "department": "Typed department",
            "email": "typed@example.invalid",
            "username": "typedname",
            "added_via": "Existing",
            "selection_label": "Typed label",
        }

    def assertNothingPersonal(self, payload):
        text = json.dumps(payload, default=str)

        for secret in (
            self.secret_full_name,
            self.secret_email,
            self.secret_username,
            self.secret_department,
            self.secret_hostname,
            self.secret_device,
        ):
            self.assertNotIn(secret, text)

    def assertBlankRow(self, row, key):
        self.assertEqual(row["subject_key"], key)
        self.assertFalse(row["usable"])
        self.assertEqual(row["reason_code"], "CROSS_CUSTOMER_TARGET")
        self.assertEqual(row["full_name"], "")
        self.assertIsNone(row["client_user"])
        self.assertIsNone(row["department"])
        self.assertIsNone(row["email"])
        self.assertIsNone(row["username"])
        self.assertIsNone(row["selection_label"])
        self.assertEqual(row["devices"], [])
        self.assertEqual(row["current_services"], [])
        self.assertIsNone(row["last_billed"])

    def test_scope_projects_another_customers_person_with_nothing_personal(self):
        out = self.as_manager(
            lambda: RequestScopeService.scope_projection(
                customer=self.customer, subjects=[self.existing(self.helen), self.foreign()]
            )
        )

        mine, theirs = out["subjects"]
        self.assertBlankRow(theirs, "user:foreign")
        self.assertNothingPersonal(out)
        self.assertEqual(mine["client_user"], self.helen)
        self.assertEqual(mine["full_name"], frappe.db.get_value("MSP Client User", self.helen, "full_name"))
        self.assertTrue(mine["usable"])

    def test_scope_projects_a_person_who_does_not_exist_the_same_way(self):
        out = self.as_manager(
            lambda: RequestScopeService.scope_projection(
                customer=self.customer, subjects=[self.foreign(f"ZZTEST-NOBODY-{self.tag}", "user:nobody")]
            )
        )

        self.assertBlankRow(out["subjects"][0], "user:nobody")

    def test_the_holdings_of_another_customers_person_are_never_offered(self):
        franck = self.existing(self.franck)
        out = self.as_manager(
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects=[franck, self.foreign()]
            )
        )

        self.assertNothingPersonal(out)
        options = [option for domain in out["domains"] for option in domain["options"]]
        exclusions = [
            entry
            for option in options
            for action in option.get("actions") or [option]
            for entry in action["exclusions"]
            if entry["subject_key"] == "user:foreign"
        ]
        self.assertTrue(exclusions)
        self.assertEqual({entry["reason_code"] for entry in exclusions}, {"CROSS_CUSTOMER_TARGET"})
        self.assertEqual({entry["full_name"] for entry in exclusions}, {""})
        self.assertEqual({entry["client_user"] for entry in exclusions}, {None})
        targets = [
            target
            for option in options
            for action in option.get("actions") or [option]
            for target in action["targets"]
        ]
        self.assertNotIn("user:foreign", {target["subject_key"] for target in targets})
        self.assertIn(self.laptop, {target.get("managed_device") for target in targets})

    def test_a_preview_naming_another_customers_person_is_refused_without_their_data(self):
        with self.assertRaises(ValidationError) as caught:
            self.as_manager(
                lambda: RequestPresentationService.for_draft(
                    customer=self.customer,
                    subjects=[self.foreign()],
                    action_groups=[
                        self.group(
                            "grp:m365",
                            "service.add",
                            [self.target(self.foreign())],
                            service=self.m365,
                        )
                    ],
                )
            )

        self.assertNothingPersonal(str(caught.exception))
        self.assertIn("does not belong to this Customer", str(caught.exception))

    def test_subject_context_answers_another_customers_person_as_not_found(self):
        nobody = f"ZZTEST-NOBODY-{self.tag}"

        with self.assertRaises(NotFoundError) as foreign:
            self.as_manager(lambda: RequestBuilderService.subject_context(client_user=self.stranger))

        with self.assertRaises(NotFoundError) as missing:
            self.as_manager(lambda: RequestBuilderService.subject_context(client_user=nobody))

        self.assertEqual(
            str(foreign.exception).replace(self.stranger, "X"), str(missing.exception).replace(nobody, "X")
        )
        self.assertNothingPersonal(str(foreign.exception))
        mine = self.as_manager(lambda: RequestBuilderService.subject_context(client_user=self.helen))
        self.assertEqual(mine["user"]["name"], self.helen)
