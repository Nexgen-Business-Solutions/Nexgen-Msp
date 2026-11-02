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
        self.frappe.get_roles.return_value = ['MSP Customer Manager']
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

    def test_staff_precedence_is_independent_of_membership_and_desk(self):
        from nexgen_msp.utils import permissions
        from nexgen_msp.utils.app_visibility import can_show_msp_app
        self.frappe.db.get_all.return_value = ['A', 'B']
        for role in ('MSP System Admin', 'MSP Technician'):
            for portal_roles in ([], ['MSP Customer Manager'], ['MSP Customer Operator']):
                for declared, permitted in ((set(), set()), ({'A'}, set()), (set(), {'A'}),
                                            ({'A'}, {'A'}), ({'A'}, {'B'})):
                    with self.subTest(role=role, portal=portal_roles, declared=declared, permitted=permitted), \
                         patch.object(self.access, 'declared_customers', return_value=declared), \
                         patch.object(self.access, 'permitted_customers', return_value=permitted):
                        self.frappe.get_roles.return_value = [role] + portal_roles
                        self.assertTrue(self.access.entry()['ok'])
                        self.assertTrue(can_show_msp_app())
                        self.assertEqual(self.access.allowed_customers(), ['A', 'B'])
                        self.assertEqual(self.access.customer_memberships(), sorted(declared & permitted))
                        self.assertEqual(self.access.resolve_customer('B'), 'B')
                        self.assertTrue(self.access.can_execute_requests())
                        self.assertEqual(self.access.can_manage_contracts(), role == 'MSP System Admin')
                        self.assertEqual(permissions.may_see_invoices(), role == 'MSP System Admin')
                        self.assertTrue(self.access.has_raw_msp_permission(None))
                        self.assertEqual(self.access.can_edit_customer_profile('B'), role == 'MSP System Admin'
                                         or ('MSP Customer Manager' in portal_roles and 'B' in declared & permitted))

    def test_default_tie_resolves_without_giving_website_staff_a_desk(self):
        self.frappe.get_roles.return_value = ['MSP Technician', 'MSP Customer Manager']
        internal = types.SimpleNamespace(rule='Nexgen MSP Internal', priority=100, enabled=1,
                                         desk_access=1, home_route='/msp')
        portal = types.SimpleNamespace(rule='Nexgen MSP Portal', priority=100, enabled=1,
                                       desk_access=0, home_route='/msp')
        with patch.object(self.rules, 'routing_enabled', return_value=True), \
             patch.object(self.rules, '_direct_assignments', return_value=[]), \
             patch.object(self.rules, '_role_matches', return_value=[portal, internal]):
            self.assertEqual(self.session.login_destination(self.frappe.session.user)['path'], '/app')
            self.system_user.return_value = False
            self.assertFalse(self.rules.desk_reachable())
            self.assertEqual(self.session.login_destination(self.frappe.session.user)['path'], '/msp')
            self.system_user.return_value = True
            portal.rule = 'Custom portal rule'
            self.assertFalse(self.rules.desk_reachable())

    def test_removing_staff_role_restores_only_customer_memberships(self):
        self.frappe.db.get_all.return_value = ['A', 'B']
        with patch.object(self.access, 'declared_customers', return_value={'A', 'B'}), \
             patch.object(self.access, 'permitted_customers', return_value={'A', 'C'}):
            self.assertEqual(self.access.allowed_customers(), ['A', 'B'])
            self.frappe.get_roles.return_value = ['MSP Customer Manager', 'System Manager']
            self.assertEqual(self.access.allowed_customers(), ['A'])
            with self.assertRaises(self.access.ValidationError):
                self.access.resolve_customer('B')
            self.assertFalse(self.access.has_raw_msp_permission(None))
            self.frappe.get_roles.return_value = ['System Manager']
            self.assertEqual(self.access.allowed_customers(), [])
            self.assertEqual(self.access.entry()['code'], self.access.NO_ROLE)
