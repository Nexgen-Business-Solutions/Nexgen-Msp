"""Run customer tests on an existing ERPNext site, with test records rolled back.

Usage from the bench sites directory:
    ../env/bin/python -m nexgen_msp.tests.run_customer_tests SITE
"""

import argparse
import unittest

import frappe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site")
    args = parser.parse_args()
    frappe.init(site=args.site)
    try:
        frappe.connect()
        frappe.flags.in_test = True
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            "nexgen_msp.tests.test_customer_creation.TestCustomerCreation",
            "nexgen_msp.tests.test_customer_creation.TestCustomerCreationIntegration",
            "nexgen_msp.tests.test_customer_profile.TestCustomerProfileIntegration",
        ])
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        return 0 if result.wasSuccessful() else 1
    finally:
        if getattr(frappe.local, "db", None):
            frappe.db.rollback()
        frappe.destroy()


if __name__ == "__main__":
    raise SystemExit(main())
