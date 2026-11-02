"""Standalone routing regression tests with a minimal Frappe boundary.

Run with python -m unittest discover -s tests.
Real database/endpoint isolation is covered by test_desk_landing.py under bench.
"""
import importlib
import sys
import types
import unittest
from unittest.mock import Mock, patch


class TestDeskLanding(unittest.TestCase):
    def setUp(self):
        self.frappe = types.ModuleType('frappe')
        self.frappe.session = types.SimpleNamespace(user='desk@example.invalid')
        self.frappe.db = Mock()
        self.frappe.db.get_value.return_value = 1
        self.frappe.get_roles = Mock(return_value=['MSP System Admin', 'MSP Customer Manager'])
        utils = types.ModuleType('frappe.utils')
        utils.cint = lambda value: int(value or 0)
        perms = types.ModuleType('frappe.permissions')
        self.system_user = Mock(return_value=True)
        perms.is_system_user = self.system_user
        self.modules = patch.dict(sys.modules, {'frappe': self.frappe, 'frappe.utils': utils,
                                                 'frappe.permissions': perms})
        self.modules.start()
        # Only these real production modules are imported; the framework is unavailable locally.
        self.loaded = ('nexgen_msp.utils.access', 'nexgen_msp.utils.login_route_registry',
                       'nexgen_msp.api.core.services.login_rule_service',
                       'nexgen_msp.api.core.services.session_service')
        for name in self.loaded:
            sys.modules.pop(name, None)
        self.rules = importlib.import_module(self.loaded[2]).LoginRuleService
        self.session = importlib.import_module(self.loaded[3])
        self.access = importlib.import_module(self.loaded[0])

    def tearDown(self):
        for name in self.loaded:
            sys.modules.pop(name, None)
        self.modules.stop()

    def test_customer_roles_cannot_use_an_existing_desk_seat(self):
        self.frappe.get_roles.return_value = ['MSP Customer Manager', 'Desk User']
        with patch.object(self.rules, 'routing_enabled', return_value=False):
            self.assertFalse(self.rules.desk_reachable())

    def test_existing_staff_desk_landing_with_switch_off_or_on(self):
        self.frappe.get_roles.return_value = ['MSP System Admin']
        with patch.object(self.access, 'entry', return_value={'ok': False, 'code': 'CONFLICTING_ROLES'}):
            for routing in (False, True):
                with self.subTest(routing=routing), patch.object(self.rules, 'routing_enabled', return_value=routing), \
                     patch.object(self.rules, 'desk_allowed', return_value=True), \
                     patch.object(self.rules, 'resolve_for_user', return_value={'success': False, 'path': None}):
                    destination = self.session.login_destination('desk@example.invalid')
                    self.assertIsNotNone(destination)
                    self.assertTrue(destination['success'])
                    self.assertEqual(destination['path'], '/app')

    def test_existing_rule_can_still_close_desk(self):
        with patch.object(self.rules, 'routing_enabled', return_value=True), \
             patch.object(self.rules, 'desk_allowed', return_value=False):
            self.assertFalse(self.rules.desk_reachable())

    def test_website_technician_is_not_given_a_desk(self):
        self.system_user.return_value = False
        self.frappe.get_roles.return_value = ['MSP Technician']
        with patch.object(self.rules, 'routing_enabled', return_value=False):
            self.assertFalse(self.rules.desk_reachable())
            self.assertIsNone(self.session.login_destination('desk@example.invalid'))

    def test_disabled_accounts_including_administrator_have_no_desk(self):
        self.frappe.db.get_value.return_value = 0
        with patch.object(self.rules, 'routing_enabled', return_value=False):
            for user in ('desk@example.invalid', 'Administrator', 'Guest'):
                self.assertFalse(self.rules.desk_reachable(user), user)

    def test_routing_does_not_widen_customer_scope_or_internal_capabilities(self):
        with patch.object(self.rules, 'routing_enabled', return_value=False), \
             patch.object(self.access, 'declared_customers', return_value={'A', 'B'}), \
             patch.object(self.access, 'permitted_customers', return_value={'A', 'C'}):
            before = self.access.allowed_customers()
            self.session.login_destination('desk@example.invalid')
            self.assertEqual(before, ['A'])
            self.assertEqual(self.access.allowed_customers(), before)
            self.assertFalse(self.access.is_staff())
            self.assertFalse(self.access.can_manage_contracts())
            self.assertFalse(self.access.has_raw_msp_permission(None))
            with self.assertRaises(Exception) as denied:
                self.access.resolve_customer('B')
            self.assertEqual(denied.exception.code, 'PERMISSION_DENIED')

    def test_staff_association_preserves_entry_icon_and_scope(self):
        self.frappe.get_roles.return_value = ['MSP Technician']
        self.frappe.db.get_single_value.return_value = 0
        from nexgen_msp.utils.app_visibility import can_show_msp_app
        with patch.object(self.access, 'declared_customers', return_value={'A', 'B'}), \
             patch.object(self.access, 'permitted_customers', return_value={'A', 'C'}):
            self.assertTrue(self.access.entry()['ok'])
            self.assertFalse(self.access.is_staff())
            self.assertFalse(self.access.can_manage_contracts())
            self.assertFalse(self.access.has_raw_msp_permission(None))
            self.assertTrue(can_show_msp_app())
            self.assertEqual(self.access.allowed_customers(), ['A'])

    def test_mixed_staff_login_and_entry_preserve_customer_isolation(self):
        self.frappe.get_roles.return_value = ['System Manager', 'MSP Technician', 'MSP System Admin',
                                              'MSP Customer Manager', 'Desk User']
        internal = types.SimpleNamespace(rule='Nexgen MSP Internal', priority=100, enabled=1,
                                         desk_access=1, home_route='/msp')
        portal = types.SimpleNamespace(rule='Nexgen MSP Portal', priority=100, enabled=1,
                                       desk_access=0, home_route='/msp')
        with patch.object(self.rules, 'routing_enabled', return_value=True), \
             patch.object(self.rules, '_direct_assignments', return_value=[]), \
             patch.object(self.rules, '_role_matches', return_value=[portal, internal]), \
             patch.object(self.access, 'declared_customers', return_value={'A', 'B'}), \
             patch.object(self.access, 'permitted_customers', return_value={'A'}) as permissions:
            self.assertEqual(self.session.login_destination(self.frappe.session.user)['path'], '/app')
            self.assertTrue(self.access.entry()['ok'])
            self.assertTrue(self.access.is_scoped_staff())
            self.assertEqual(self.access.allowed_customers(), ['A'])
            with self.assertRaises(self.access.ValidationError):
                self.access.resolve_customer('B')
            permissions.return_value = set()
            self.assertEqual(self.access.allowed_customers(), [])
            self.assertFalse(self.access.is_staff())
            self.assertFalse(self.access.can_execute_requests())
            self.assertFalse(self.access.has_raw_msp_permission(None))
            internal.desk_access = 0
            self.assertFalse(self.rules.desk_reachable())
            self.assertFalse(self.access.entry()['ok'])
            internal.desk_access = 1
            portal.rule = 'Custom portal rule'
            self.assertFalse(self.rules.desk_reachable())
            portal.rule = 'Nexgen MSP Portal'
            self.system_user.return_value = False
            self.assertFalse(self.rules.desk_reachable())
            self.assertFalse(self.access.entry()['ok'])

    def test_website_staff_role_does_not_override_customer_binding(self):
        self.frappe.get_roles.return_value = ['MSP Technician']
        self.system_user.return_value = False
        with patch.object(self.access, 'declared_customers', return_value={'A'}), \
             patch.object(self.access, 'permitted_customers', return_value={'A'}):
            self.assertFalse(self.access.is_staff())
            self.assertEqual(self.access.entry()['code'], 'CONFLICTING_ROLES')
            self.assertEqual(self.access.allowed_customers(), ['A'])

    def test_unbound_mixed_roles_never_reach_all_customers(self):
        self.frappe.db.get_all.return_value = ['A', 'B']
        with patch.object(self.access, 'declared_customers', return_value=set()), \
             patch.object(self.access, 'permitted_customers', return_value=set()):
            self.assertEqual(self.access.allowed_customers(), [])

    def test_revoking_last_customer_permission_never_promotes_staff(self):
        self.frappe.get_roles.return_value = ['MSP System Admin']
        self.frappe.db.get_single_value.return_value = 0
        from nexgen_msp.utils import permissions
        with patch.object(self.access, 'declared_customers', return_value={'A'}), \
             patch.object(self.access, 'permitted_customers', return_value={'A'}) as permitted:
            self.assertTrue(self.access.entry()['ok'])
            self.assertEqual(self.access.allowed_customers(), ['A'])
            permitted.return_value = set()
            self.assertTrue(self.access.entry()['ok'])
            self.assertTrue(self.access.is_scoped_staff())
            with self.assertRaises(self.access.ValidationError):
                self.access.resolve_customer('A')
            self.assertEqual(self.access.allowed_customers(), [])
            self.assertFalse(self.access.is_staff())
            self.assertFalse(self.access.has_raw_msp_permission(None))
            self.assertFalse(permissions.may_see_invoices())
            with self.assertRaises(permissions.ValidationError):
                permissions.guard_can_manage_access()
