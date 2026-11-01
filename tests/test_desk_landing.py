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

    def test_customer_roles_do_not_override_existing_desk_eligibility(self):
        with patch.object(self.rules, 'routing_enabled', return_value=False):
            self.assertTrue(self.rules.desk_reachable())
        self.system_user.assert_called_once_with('desk@example.invalid')

    def test_desk_landing_precedes_conflicting_msp_entry_with_switch_off_or_on(self):
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
