"""One MAC address, written the one way Parallels RAS reads it.

Issue #22. A MAC is the same number however it is punctuated, but the configuration this
application feeds only recognises `AA-BB-CC-DD-EE-FF`. So the punctuation is decided here,
once, for every path that saves one: a form, an import, a service request, the API. What
somebody types is accepted in the three forms people actually use; what is stored and
handed back is always the hyphenated, upper-case one.

Nothing here makes an invalid value valid: punctuation is not stripped until twelve digits
appear, and a separator has to be used consistently. Six octets, twelve hexadecimal
digits, or it is refused and said so.
"""

import re

# six octets, separated the same way throughout, or twelve bare hexadecimal digits
SEPARATED = re.compile(r"^[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}$")
BARE = re.compile(r"^[0-9A-Fa-f]{12}$")

CANONICAL = "AA-BB-CC-DD-EE-FF"
REFUSAL = f"Invalid MAC address. Use {CANONICAL} (12 hexadecimal digits)."


def normalize_mac_address(value):
    """`AA-BB-CC-DD-EE-FF` from any of the three forms, or a `ValueError`.

    Accepts `0A:EA:31:1A:95:BB`, `0A-EA-31-1A-95-BB` and `0aea311a95bb`, with outer spaces
    and either case. Mixed separators, the wrong number of digits, a non-hexadecimal
    character or an inner space are refused. Running it on its own result changes nothing.
    """
    written = str(value or "").strip()

    if not written:
        raise ValueError(REFUSAL)

    if SEPARATED.match(written):
        digits = written.replace(written[2], "")
    elif BARE.match(written):
        digits = written
    else:
        raise ValueError(REFUSAL)

    digits = digits.upper()

    return "-".join(digits[index : index + 2] for index in range(0, 12, 2))


def is_mac_address(value):
    """Whether this is a MAC at all, for a reader that has to decide rather than refuse."""
    try:
        normalize_mac_address(value)
    except ValueError:
        return False

    return True


def canonical_or_none(value):
    """The canonical form when there is one, and nothing when the value is not a MAC."""
    try:
        return normalize_mac_address(value)
    except ValueError:
        return None
