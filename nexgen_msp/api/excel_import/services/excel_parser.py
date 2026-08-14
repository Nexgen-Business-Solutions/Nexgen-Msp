import datetime
import re

from nexgen_msp.utils.errors import ValidationError

EXCLUDED_COLUMNS = ("user", "password")

COLUMN_INDEX = {
    "full_name": 0,
    "username": 1,
    "password": 2,
    "email": 3,
    "company": 4,
    "department": 5,
    "ad_created": 6,
    "ad_disabled": 7,
    "parallels": 8,
    "nextcloud": 9,
    "nextcloud_activated": 10,
    "nextcloud_disabled": 11,
    "sophos": 12,
    "hostname": 13,
    "device_created": 14,
    "device_disabled": 15,
    "mac_wifi": 16,
    "mac_lan": 17,
    "mac_extra": 18,
    "device_type": 19,
    "remarks": 20,
}

EXPECTED_HEADERS = ("full name", "user", "password", "email")

BLANK_TOKENS = {"", "n/a", "na", "none", "-", "null"}

DEVICE_TYPE_MAP = {
    "pc": "PC",
    "laptop": "Laptop",
    "mini pc": "Mini PC",
    "minipc": "Mini PC",
    "mac": "Mac",
    "tablette": "Tablet",
    "tablet": "Tablet",
    "server": "Server",
    "serveur": "Server",
    "firewall": "Firewall",
    "vm": "VM",
}

MAC_PATTERN = re.compile(r"^[0-9A-F]{2}([:-])(?:[0-9A-F]{2}\1){4}[0-9A-F]{2}$")


def is_blank(value):
    if value is None:
        return True
    if isinstance(value, datetime.datetime):
        return False
    return str(value).strip().lower() in BLANK_TOKENS


def as_text(value):
    if is_blank(value):
        return None
    return " ".join(str(value).split())


def as_date(value):
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    return None


def is_yes(value):
    return not is_blank(value) and str(value).strip().lower() in ("yes", "oui", "y", "1", "true")


def normalize_mac(value):
    if is_blank(value):
        return None
    candidate = str(value).strip().upper().replace(".", ":")
    return candidate if MAC_PATTERN.match(candidate) else False


def normalize_device_type(value):
    text = as_text(value)
    if not text:
        return None
    return DEVICE_TYPE_MAP.get(text.strip().lower())


def load_rows(file_path):
    try:
        import openpyxl
    except ImportError:
        raise ValidationError("openpyxl is not installed on the server.", "INTERNAL_ERROR", 500)

    try:
        workbook = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    except Exception as e:
        raise ValidationError(f"Cannot read the workbook: {e}", "INVALID_FILE")

    sheet = workbook[workbook.sheetnames[0]]
    rows = [row[: len(COLUMN_INDEX)] for row in sheet.iter_rows(values_only=True)]

    if not rows:
        raise ValidationError("The workbook is empty.", "INVALID_FILE")

    header = [str(cell).strip().lower() if cell is not None else "" for cell in rows[0]]
    for expected in EXPECTED_HEADERS:
        if expected not in header:
            raise ValidationError(
                f"Column '{expected}' is missing from the workbook.", "MISSING_COLUMN"
            )

    return [row for row in rows[1:] if any(not is_blank(cell) for cell in row)]


def read(row, key):
    index = COLUMN_INDEX[key]
    return row[index] if index < len(row) else None


def parse_row(row, row_number):
    record = {
        "row_number": row_number,
        "full_name": as_text(read(row, "full_name")),
        "email": as_text(read(row, "email")),
        "company": as_text(read(row, "company")),
        "department": as_text(read(row, "department")),
        "ad_created": as_date(read(row, "ad_created")),
        "ad_disabled": as_date(read(row, "ad_disabled")),
        "ad_marked_active": str(read(row, "ad_disabled")).strip().lower() == "active",
        "hostname": as_text(read(row, "hostname")),
        "device_type": normalize_device_type(read(row, "device_type")),
        "device_type_raw": as_text(read(row, "device_type")),
        "device_created": as_date(read(row, "device_created")),
        "device_disabled": as_date(read(row, "device_disabled")),
        "remarks": as_text(read(row, "remarks")),
        "services": {
            "parallels": is_yes(read(row, "parallels")),
            "nextcloud": is_yes(read(row, "nextcloud")),
            "sophos": not is_blank(read(row, "sophos")),
        },
        "nextcloud_activated": as_date(read(row, "nextcloud_activated")),
        "nextcloud_disabled": as_date(read(row, "nextcloud_disabled")),
        "macs": [],
        "invalid_macs": [],
    }

    if record["hostname"]:
        record["hostname"] = record["hostname"].upper()

    for key, interface_type in (
        ("mac_wifi", "Wi-Fi"),
        ("mac_lan", "LAN"),
        ("mac_extra", "Extra"),
    ):
        raw = read(row, key)
        if is_blank(raw):
            continue
        mac = normalize_mac(raw)
        if mac is False:
            record["invalid_macs"].append(str(raw).strip())
        else:
            record["macs"].append({"interface_type": interface_type, "mac_address": mac})

    return record
