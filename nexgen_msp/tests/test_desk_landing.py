"""Bench regressions: navigation must not change customer or document authority."""
from unittest.mock import patch

import frappe

from nexgen_msp.api.core.services.login_rule_service import ROUTING_FLAG, LoginRuleService
from nexgen_msp.api.core.services.session_service import SessionService, login_destination
from nexgen_msp.api.portal.endpoints import v1 as portal
from nexgen_msp.utils import access, permissions

from .test_login_rules import HIGH, LoginRuleCase


class TestDeskLanding(LoginRuleCase):
    def setUp(self):
        super().setUp()
        self.kept_routing = frappe.db.get_single_value('MSP Portal Settings', ROUTING_FLAG)
        self.mine = self.make_customer(f'DA{self.tag}')
        self.theirs = self.make_customer(f'DB{self.tag}')
        self.manager = self.make_account('customer', 'MSP Customer Manager', self.mine,
                                         suffix=f'dm{self.tag}')
        self.staff = self.make_account('internal', 'MSP System Admin', suffix=f'ds{self.tag}')
        self.technician = self.make_account('internal', 'MSP Technician', suffix=f'dt{self.tag}')
        self.make_rule('Existing staff Desk seat', roles=['MSP System Admin'], priority=HIGH, desk=1)

    def tearDown(self):
        frappe.set_user('Administrator')
        frappe.db.set_single_value('MSP Portal Settings', ROUTING_FLAG, self.kept_routing)
        frappe.db.commit()
        super().tearDown()

    def routing(self, value):
        frappe.db.set_single_value('MSP Portal Settings', ROUTING_FLAG, int(value))
        frappe.db.commit()

    def snapshot(self, user):
        return (frappe.db.get_value('User', user, ['user_type', 'enabled']),
                sorted(access.roles(user)), sorted(access.declared_customers(user)),
                sorted(access.permitted_customers(user)), access.allowed_customers(user),
                frappe.get_all('User Permission', filters={'user': user},
                               fields=['name', 'allow', 'for_value'], order_by='name'))

    def context(self, user):
        frappe.set_user(user)
        try:
            return SessionService.get_session_context()
        finally:
            frappe.set_user('Administrator')

    def test_existing_desk_users_land_on_app_before_and_after_customer_binding(self):
        for kind in ('none', 'contact', 'permission', 'customer_role'):
            if kind == 'contact':
                permissions.ensure_customer_contact(frappe.get_doc('User', self.staff), self.mine)
            elif kind == 'permission':
                doc = frappe.get_doc({'doctype': 'User Permission', 'user': self.staff,
                                      'allow': 'Customer', 'for_value': self.mine})
                doc.insert(ignore_permissions=True)
            elif kind == 'customer_role':
                self.give(self.staff, 'MSP Customer Manager')
            frappe.db.commit()
            frappe.clear_cache(user=self.staff)
            before = self.snapshot(self.staff)
            for enabled in (False, True):
                self.routing(enabled)
                with self.subTest(binding=kind, routing=enabled):
                    ctx = self.context(self.staff)
                    if kind == 'customer_role':
                        self.assertFalse(ctx['can_open_desk'])
                        self.assertEqual(ctx['access']['code'], access.CONFLICTING_ROLES)
                    else:
                        self.assertTrue(ctx['can_open_desk'])
                        self.assertEqual(ctx['login_destination']['path'], '/app')
                        self.assertTrue(ctx['access']['ok'])
                        self.assertEqual(ctx['is_internal_user'], kind == 'none')
                        self.assertEqual(ctx['scoped_msp'], kind in ('permission', 'contact'))
                        from nexgen_msp.utils.app_visibility import can_show_msp_app
                        self.assertTrue(can_show_msp_app(self.staff))
                    self.assertEqual(before, self.snapshot(self.staff))
            if kind in ('permission', 'customer_role'):
                self.assertFalse(access.is_staff(self.staff))
                self.assertEqual(access.allowed_customers(self.staff), [self.mine])

    def test_non_desk_technician_and_customer_keep_existing_portal_entry(self):
        self.routing(False)
        for user in (self.manager, self.technician):
            ctx = self.context(user)
            self.assertFalse(ctx['can_open_desk'])
            self.assertIsNone(ctx['login_destination'])
            self.assertTrue(ctx['access']['ok'])
        self.give(self.manager, 'MSP Technician')
        ctx = self.context(self.manager)
        self.assertFalse(ctx['can_open_desk'])
        self.assertEqual(ctx['access']['code'], access.CONFLICTING_ROLES)

    def test_disabled_and_guest_contexts_cannot_navigate_into_either_application(self):
        frappe.db.set_value('User', self.manager, 'enabled', 0)
        frappe.clear_cache(user=self.manager)
        try:
            for user in (self.manager, 'Guest'):
                ctx = self.context(user)
                self.assertFalse(ctx['authenticated'])
                self.assertFalse(ctx['can_open_desk'])
                self.assertFalse(ctx['access']['ok'])
                self.assertIsNone(ctx['login_destination'])
        finally:
            frappe.db.set_value('User', self.manager, 'enabled', 1)
            frappe.clear_cache(user=self.manager)

    def test_desk_rule_restriction_is_still_required(self):
        self.routing(True)
        with patch.object(LoginRuleService, 'desk_allowed', return_value=False):
            self.assertFalse(LoginRuleService.desk_reachable(self.staff))
            destination = login_destination(self.staff)
            self.assertNotEqual(destination.get('path'), '/app')

    def test_landing_preserves_cross_customer_api_denial_and_exact_scope(self):
        their_person = self.make_person(self.theirs, 'Other company')
        self.routing(False)
        before = self.snapshot(self.manager)
        self.context(self.manager)
        frappe.set_user(self.manager)
        try:
            # Direct exported endpoints, bypassing all React guards.
            for call in (
                lambda: portal.list_client_users(customer=self.theirs),
                lambda: portal.get_user_detail(client_user=their_person),
                lambda: portal.export_client_users(customer=self.theirs),
            ):
                denied = call()
                self.assertFalse(denied['success'], denied)
                self.assertEqual(denied['code'], 'PERMISSION_DENIED', denied)
            self.assertEqual(access.allowed_customers(), [self.mine])
        finally:
            frappe.set_user('Administrator')
        self.assertEqual(before, self.snapshot(self.manager))

    def test_multiple_customer_account_keeps_only_its_existing_intersection(self):
        other = self.make_customer(f'DC{self.tag}')
        permissions.ensure_customer_contact(frappe.get_doc('User', self.manager), other)
        frappe.get_doc({'doctype': 'User Permission', 'user': self.manager,
                        'allow': 'Customer', 'for_value': other}).insert(ignore_permissions=True)
        # An unmatched permission cannot add the unrelated company to the scope.
        frappe.get_doc({'doctype': 'User Permission', 'user': self.manager,
                        'allow': 'Customer', 'for_value': self.theirs}).insert(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=self.manager)
        before = self.snapshot(self.manager)
        for routing in (False, True):
            self.routing(routing)
            ctx = self.context(self.manager)
            self.assertFalse(ctx['can_open_desk'])
            self.assertEqual(ctx['customers'], sorted([self.mine, other]))
            self.assertEqual(before, self.snapshot(self.manager))

    def test_an_ambiguous_rule_does_not_create_existing_desk_access(self):
        self.make_rule('Tied staff rule', roles=['MSP System Admin'], priority=HIGH, desk=1)
        self.routing(True)
        self.assertFalse(LoginRuleService.desk_reachable(self.staff))
        self.assertEqual(login_destination(self.staff)['error'], 'AMBIGUOUS_ROLE_RULE')
