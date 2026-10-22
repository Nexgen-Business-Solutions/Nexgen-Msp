"""Regression tests for issue #22."""
import unittest

from nexgen_msp.utils.mac_address import normalize_mac_address


class TestNormalizeMacAddress(unittest.TestCase):
    def test_supported_inputs(self):
        for value in ("0A:EA:31:1A:95:BB", "0A-EA-31-1A-95-BB", "0aea311a95bb",
                      " 0a-ea-31-1a-95-bb "):
            with self.subTest(value=value):
                self.assertEqual(normalize_mac_address(value), "0A-EA-31-1A-95-BB")

    def test_invalid_inputs(self):
        for value in ("", None, "0A:EA-31:1A:95:BB", "0A:EA:31:1A:95",
                      "0A:EA:31:1A:95:GG", "0A.EA.31.1A.95.BB", "0AEA311A95B",
                      "0A:EA:31:1A:95:BB:CC", "0A EA 31 1A 95 BB"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    normalize_mac_address(value)

    def test_idempotent(self):
        canonical = normalize_mac_address("0a:ea:31:1a:95:bb")
        self.assertEqual(normalize_mac_address(canonical), canonical)


if __name__ == "__main__":
    unittest.main()
