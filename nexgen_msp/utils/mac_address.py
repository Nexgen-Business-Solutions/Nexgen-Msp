"""Canonical MAC formatting for Parallels RAS and Nexgen MSP."""

import re

_MAC_INPUT = re.compile(r"^(?:[0-9A-F]{12}|[0-9A-F]{2}(?P<sep>[:-])(?:[0-9A-F]{2}(?P=sep)){4}[0-9A-F]{2})$", re.IGNORECASE)


def normalize_mac_address(value):
    """Return AA-BB-CC-DD-EE-FF, or raise ValueError for invalid input.

    Accept unseparated, consistently colon-separated, or hyphen-separated
    hexadecimal octets. Do not silently discard arbitrary punctuation.
    """
    if not isinstance(value, str):
        raise ValueError("MAC address must be a string")
    candidate = value.strip().upper()
    if not _MAC_INPUT.fullmatch(candidate):
        raise ValueError("Invalid MAC address: expected 12 hex digits or six octets separated by ':' or '-'")
    digits = candidate.replace(":", "").replace("-", "")
    return "-".join(digits[i:i + 2] for i in range(0, 12, 2))
