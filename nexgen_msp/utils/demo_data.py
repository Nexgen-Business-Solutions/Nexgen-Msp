"""A believable MSP book of business, for a development site to be looked at and clicked through.

Twenty-five client companies across Cameroon, about a thousand people, their machines, the
services they hold and how those changed over the year, a year of monthly billing, portal
accounts, and a few months of requests in every state a request can be in.

Nothing here is real. The companies and people are invented, every address is on the
reserved `.example` domain so no mail can reach anybody, and the same seed always gives the
same data. Everything is made through the application's own services where one exists, so
the records obey the same rules production records do.

    bench --site nexgen.msp execute nexgen_msp.utils.demo_data.build
    bench --site nexgen.msp execute nexgen_msp.utils.demo_data.purge
    bench --site nexgen.msp execute nexgen_msp.utils.demo_data.logins

`build` clears an earlier demo build first, so it can be run again. It only runs on a site
in developer mode, and never against production.
"""

import json
import random
import time
import unicodedata

import frappe
from frappe.utils import add_days, add_months, get_first_day, get_last_day, getdate, today

SEED = 2026
PASSWORD = "Nexgen-Demo-2026"
STAFF_DOMAIN = "nexgen-solutions.example"
CURRENCY = "XAF"
PRICE_LIST = "Standard Selling"

# --------------------------------------------------------------------------- catalogue
# code, name, scope, monthly list rate in XAF, invoice label
SERVICES = [
    ("SVC-M365-BASIC", "Microsoft 365 Business Basic", "User", 4000, "Microsoft 365 Basic"),
    ("SVC-M365-STD", "Microsoft 365 Business Standard", "User", 8200, "Microsoft 365 Standard"),
    ("SVC-M365-PREM", "Microsoft 365 Business Premium", "User", 14500, "Microsoft 365 Premium"),
    ("SVC-HELPDESK", "Helpdesk & User Support", "User", 6500, "Helpdesk support"),
    ("SVC-VPN", "Remote Access VPN", "User", 3000, "VPN access"),
    ("SVC-NEXTCLOUD", "Nextcloud File Storage 100 GB", "User", 2500, "Cloud file storage"),
    ("SVC-PARALLELS", "Parallels RAS Remote Desktop", "User", 7000, "Remote desktop"),
    ("SVC-SOPHOS-EP", "Sophos Intercept X Endpoint", "Device", 3800, "Endpoint protection"),
    ("SVC-DATTO-RMM", "Datto RMM Monitoring & Patching", "Device", 2800, "Monitoring & patching"),
    ("SVC-BACKUP-WS", "Workstation Cloud Backup", "Device", 4500, "Workstation backup"),
    ("SVC-MDM", "Mobile Device Management", "Device", 2000, "Mobile device management"),
    ("SVC-SOPHOS-SRV", "Sophos Intercept X for Server", "Device", 12000, "Server protection"),
    ("SVC-SRV-MGMT", "Managed Server", "Device", 65000, "Managed server"),
    ("SVC-SRV-BACKUP", "Server Backup & Disaster Recovery", "Device", 48000, "Server backup & DR"),
    ("SVC-FW-MGMT", "Managed Firewall", "Device", 85000, "Managed firewall"),
    ("SVC-LEGACY-AV", "Kaspersky Endpoint (legacy)", "Device", 2500, "Antivirus (legacy)"),
]
SERVICE_CODES = [row[0] for row in SERVICES]
LEGACY = "SVC-LEGACY-AV"

DEPARTMENTS = [
    "Management", "Finance", "Accounting", "Human Resources", "Sales", "Marketing",
    "Operations", "Logistics", "Procurement", "IT", "Legal", "Customer Service",
    "Administration", "Production", "Warehouse", "Engineering", "Medical", "Nursing",
    "Teaching Staff", "Editorial", "Quality Assurance",
]

# --------------------------------------------------------------------------- the clients
# name, code, domain, city, group, people, m365 tier, extras, departments, contract status,
# months since contract start
CUSTOMERS = [
    ("Wouri Freight & Logistics SARL", "WFL", "wouri-freight", "Douala", "Commercial", 64, "STD",
     ["VPN", "BACKUP-WS", "MDM", "SRV"], ["Management", "Finance", "Operations", "Logistics", "Warehouse", "Customer Service", "IT"], "Active", 12),
    ("Clinique Sainte-Anne de Bonapriso", "CSA", "clinique-sainteanne", "Douala", "Commercial", 46, "STD",
     ["NEXTCLOUD", "BACKUP-WS", "SRV"], ["Management", "Medical", "Nursing", "Administration", "Accounting", "IT"], "Active", 11),
    ("Mfoundi Microfinance SA", "MMF", "mfoundi-microfinance", "Yaoundé", "Commercial", 82, "PREM",
     ["VPN", "PARALLELS", "BACKUP-WS", "SRV"], ["Management", "Finance", "Accounting", "Customer Service", "Legal", "IT", "Operations"], "Active", 12),
    ("Cabinet Ekambi & Associés", "CEA", "cabinet-ekambi", "Douala", "Commercial", 18, "STD",
     ["NEXTCLOUD", "VPN"], ["Management", "Legal", "Administration"], "Active", 9),
    ("Sanaga Agro-Industries SA", "SAI", "sanaga-agro", "Edéa", "Commercial", 108, "BASIC",
     ["VPN", "MDM", "SRV"], ["Management", "Finance", "Production", "Warehouse", "Logistics", "Procurement", "Human Resources", "IT", "Quality Assurance"], "Active", 12),
    ("Hôtel Les Collines du Mfoundi", "HCM", "collines-mfoundi", "Yaoundé", "Commercial", 34, "BASIC",
     ["MDM"], ["Management", "Customer Service", "Accounting", "Operations"], "Active", 8),
    ("Bamenda Highlands Coffee Cooperative", "BHC", "highlands-coffee", "Bamenda", "Non Profit", 22, "BASIC",
     ["NEXTCLOUD"], ["Management", "Production", "Accounting", "Sales"], "Active", 10),
    ("Limbe Offshore Services Ltd", "LOS", "limbe-offshore", "Limbe", "Commercial", 41, "STD",
     ["VPN", "BACKUP-WS", "MDM", "SRV"], ["Management", "Engineering", "Operations", "Finance", "Human Resources", "IT"], "Active", 12),
    ("PharmaPlus Akwa SARL", "PPA", "pharmaplus-akwa", "Douala", "Commercial", 26, "BASIC",
     ["BACKUP-WS"], ["Management", "Sales", "Warehouse", "Accounting"], "Active", 7),
    ("École Internationale Les Palmiers", "EIP", "ecole-lespalmiers", "Yaoundé", "Non Profit", 57, "BASIC",
     ["NEXTCLOUD", "MDM"], ["Management", "Teaching Staff", "Administration", "Finance", "IT"], "Active", 12),
    ("Kribi Deep Sea Fisheries SA", "KDF", "kribi-fisheries", "Kribi", "Commercial", 30, "BASIC",
     ["MDM"], ["Management", "Operations", "Logistics", "Accounting"], "Active", 6),
    ("Garoua Cotton Ginning Company", "GCG", "garoua-cotton", "Garoua", "Commercial", 68, "BASIC",
     ["VPN", "SRV"], ["Management", "Production", "Warehouse", "Finance", "Procurement", "Human Resources"], "Active", 12),
    ("Nyong Engineering & Construction", "NEC", "nyong-engineering", "Yaoundé", "Commercial", 63, "STD",
     ["VPN", "PARALLELS", "BACKUP-WS", "MDM", "SRV"], ["Management", "Engineering", "Procurement", "Finance", "Human Resources", "IT"], "Active", 11),
    ("Buea Tech Hub Ltd", "BTH", "buea-techhub", "Buea", "Commercial", 15, "PREM",
     ["NEXTCLOUD", "VPN"], ["Management", "Engineering", "Marketing"], "Active", 5),
    ("Fondation Santé Pour Tous", "FSP", "fondation-santepourtous", "Yaoundé", "Non Profit", 28, "BASIC",
     ["NEXTCLOUD"], ["Management", "Medical", "Administration", "Finance"], "Active", 10),
    ("Akwa Business Centre SARL", "ABC", "akwa-businesscentre", "Douala", "Commercial", 12, "BASIC",
     [], ["Management", "Administration", "Customer Service"], "Active", 4),
    ("Tropical Timber Exports SA", "TTE", "tropical-timber", "Bertoua", "Commercial", 49, "BASIC",
     ["VPN", "SRV"], ["Management", "Production", "Logistics", "Finance", "Legal"], "Active", 12),
    ("Tiko Rubber & Palm Ltd", "TRP", "tiko-rubberpalm", "Tiko", "Commercial", 74, "BASIC",
     ["MDM", "SRV"], ["Management", "Production", "Warehouse", "Human Resources", "Finance", "IT"], "Active", 12),
    ("Assurances Mutuelles du Wouri", "AMW", "assurances-wouri", "Douala", "Commercial", 88, "STD",
     ["VPN", "PARALLELS", "BACKUP-WS", "SRV"], ["Management", "Sales", "Customer Service", "Finance", "Legal", "IT", "Accounting"], "Active", 12),
    ("Bafoussam Auto Parts SARL", "BAP", "bafoussam-autoparts", "Bafoussam", "Commercial", 20, "BASIC",
     ["BACKUP-WS"], ["Management", "Sales", "Warehouse"], "Active", 9),
    ("Adamaoua Livestock Traders", "ALT", "adamaoua-livestock", "Ngaoundéré", "Commercial", 16, "BASIC",
     [], ["Management", "Sales", "Logistics"], "Suspended", 10),
    ("Cabinet Comptable Fotso & Fils", "CCF", "cabinet-fotso", "Bafoussam", "Commercial", 14, "STD",
     ["NEXTCLOUD", "BACKUP-WS"], ["Management", "Accounting"], "Active", 8),
    ("Maison de Couture Ndolo", "MCN", "couture-ndolo", "Douala", "Commercial", 10, "BASIC",
     [], ["Management", "Production", "Sales"], "Ended", 11),
    ("Imprimerie Moderne du Centre", "IMC", "imprimerie-centre", "Yaoundé", "Commercial", 24, "BASIC",
     ["BACKUP-WS"], ["Management", "Production", "Sales", "Accounting"], "Active", 6),
    ("Radio Sawa FM", "RSF", "radiosawa", "Douala", "Commercial", 19, "STD",
     ["NEXTCLOUD", "VPN"], ["Management", "Editorial", "Sales", "IT"], "Draft", 0),
]

FIRST_NAMES = [
    "Jean", "Marie", "Paul", "Christelle", "Brice", "Arlette", "Serge", "Patrice", "Nadège",
    "Hervé", "Joël", "Sandrine", "Armand", "Larissa", "Yannick", "Carine", "Rodrigue",
    "Murielle", "Franck", "Gisèle", "Blaise", "Josiane", "Ulrich", "Estelle", "Boris",
    "Aurélie", "Thierry", "Mireille", "Cédric", "Prisca", "Emmanuel", "Grace", "Divine",
    "Peter", "Clovis", "Raoul", "Achille", "Vanessa", "Linda", "Stéphane", "Landry",
    "Marcelle", "Pélagie", "Fabrice", "Joseph", "Esther", "Samuel", "Ruth", "Michael",
    "Eric", "Florence", "Kevin", "Sylvie", "Alain", "Bernadette", "Christian", "Doris",
    "Ernest", "Félicité", "Georges", "Hortense", "Ivan", "Jacqueline", "Lionel", "Martine",
    "Nelson", "Odile", "Pascal", "Rosine", "Sophie", "Victor", "Wilfried", "Yvette",
]
LAST_NAMES = [
    "Mbarga", "Fotso", "Ngono", "Essomba", "Tchoupo", "Kamga", "Nana", "Atangana", "Manga",
    "Ndongo", "Biyong", "Ewane", "Tchinda", "Djoumessi", "Nguemo", "Abena", "Owona",
    "Mvondo", "Kouam", "Tamba", "Ebongue", "Moukoko", "Njoya", "Tabi", "Ayuk", "Tanyi",
    "Ashu", "Nfor", "Che", "Bessong", "Mbah", "Ngwa", "Tchakounte", "Wamba", "Zambo",
    "Onana", "Ngassa", "Simo", "Fokou", "Mefire", "Bilong", "Elong", "Mballa", "Ondoua",
    "Yomba", "Etoundi", "Nkolo", "Ngando", "Dikoume", "Ekwalla", "Mbappe", "Priso",
    "Tagne", "Foning", "Kengne", "Wandji", "Nkwain", "Tambe", "Agbor", "Enow", "Takang",
]
STREETS = [
    "Boulevard de la Liberté", "Rue Joss", "Avenue Kennedy", "Rue Njo-Njo", "Boulevard du 20 Mai",
    "Avenue Charles de Gaulle", "Rue de la Motte-Picquet", "Rue Drouot", "Avenue Ahidjo",
    "Commercial Avenue", "Church Street", "Market Road", "Rue Franqueville", "Route de Bastos",
]
STAFF = [
    ("Achille", "Mbarga", "MSP System Admin"),
    ("Laure", "Ekotto", "MSP System Admin"),
    ("Patrick", "Nkoulou", "MSP Technician"),
    ("Brice", "Tchamba", "MSP Technician"),
    ("Sandra", "Ayuk", "MSP Technician"),
    ("Hugues", "Ngando", "MSP Technician"),
    ("Clarisse", "Mendo", "MSP Technician"),
    ("Desmond", "Fru", "MSP Technician"),
]

# device kinds: hostname code, type, (manufacturer, model, os) choices
COMPUTERS = [
    ("LT", "Laptop", [
        ("Dell", "Latitude 5440", "Windows 11 Pro 23H2"),
        ("HP", "EliteBook 840 G10", "Windows 11 Pro 23H2"),
        ("Lenovo", "ThinkPad T14 Gen 4", "Windows 11 Pro 23H2"),
        ("Lenovo", "ThinkPad E15 Gen 2", "Windows 10 Pro 22H2"),
        ("HP", "ProBook 450 G9", "Windows 11 Pro 22H2"),
    ]),
    ("PC", "PC", [
        ("Dell", "OptiPlex 7010", "Windows 11 Pro 23H2"),
        ("HP", "ProDesk 400 G9", "Windows 11 Pro 23H2"),
        ("Lenovo", "ThinkCentre M70q", "Windows 10 Pro 22H2"),
    ]),
    ("MAC", "Mac", [
        ("Apple", "MacBook Air M2", "macOS Sonoma 14.6"),
        ("Apple", "MacBook Pro 14 M3", "macOS Sequoia 15.1"),
    ]),
]
PHONES = [
    ("Samsung", "Galaxy A54", "Android 14"),
    ("Samsung", "Galaxy S23", "Android 14"),
    ("Apple", "iPhone 14", "iOS 17.6"),
    ("Tecno", "Camon 20 Pro", "Android 13"),
]
SERVERS = [
    ("Dell", "PowerEdge R650", "Windows Server 2022 Standard"),
    ("HPE", "ProLiant DL380 Gen10", "Windows Server 2019 Standard"),
    ("Dell", "PowerEdge T350", "Ubuntu Server 22.04 LTS"),
]
FIREWALLS = [
    ("Fortinet", "FortiGate 60F", "FortiOS 7.2.8"),
    ("Sophos", "XGS 2100", "SFOS 20.0"),
]
OUIS = {
    "Dell": "D4:81:D7", "HP": "3C:52:82", "Lenovo": "54:EE:75", "Apple": "F0:18:98",
    "Samsung": "8C:F5:A3", "Tecno": "A4:50:46", "HPE": "94:40:C9", "Fortinet": "00:09:0F",
    "Sophos": "7C:5A:1C",
}


# =========================================================================== entry points
def _guard():
    if not frappe.conf.developer_mode:
        frappe.throw("Demo data is only built on a development site.")


def build(people_scale=1.0):
    """Clear any earlier demo build, then make the whole book of business again."""
    _guard()
    frappe.set_user("Administrator")
    frappe.flags.mute_emails = True
    started = time.time()
    rng = random.Random(SEED)

    purge(_quiet=True)
    _log("catalogue")
    _catalogue()
    _departments()
    staff = _staff()

    built = []

    for row in CUSTOMERS:
        built.append(_company(rng, row, people_scale))
        _log(f"company {row[0]} — {len(built[-1]['people'])} people, {len(built[-1]['devices'])} devices")

    _legacy_retired()
    _log("billing")
    _billing(rng, built)

    for company in built:
        if company.get("close_contract"):
            frappe.db.set_value("MSP Contract", company["contract"], company["close_contract"])
    frappe.db.commit()
    _log("requests")
    _requests(rng, built, staff)
    _integration_events(rng, built)
    frappe.db.commit()

    _log(f"done in {int(time.time() - started)}s")
    print(json.dumps(_counts(), indent=2))
    logins()


def logins():
    """Who to sign in as. Every demo account shares one password."""
    customers = [_customer_name(row) for row in CUSTOMERS]
    portal = frappe.db.sql(
        """
        select u.name, u.full_name, r.role
        from `tabUser` u join `tabHas Role` r on r.parent = u.name
        where r.role in ('MSP Customer Manager', 'MSP Customer Operator', 'MSP System Admin', 'MSP Technician')
          and (u.name like %(staff)s or u.name in (
            select p.user from `tabUser Permission` p
            where p.allow = 'Customer' and p.for_value in %(customers)s))
        order by r.role, u.name
        """,
        {"staff": f"%@{STAFF_DOMAIN}", "customers": tuple(customers)},
        as_dict=True,
    )
    print(f"\nPassword for every demo account: {PASSWORD}")
    print("Each account sets up its two-factor code on first sign-in.\n")

    for row in portal:
        print(f"  {row.role:24} {row.name:52} {row.full_name}")


def enable_accounts():
    """Switch on every demo account, for a build made before accounts were enabled."""
    _guard()
    customers = [name for name in (_existing_customer(row) for row in CUSTOMERS) if name]
    emails = frappe.db.sql_list(
        """select distinct user from `tabUser Permission` where allow = 'Customer' and for_value in %(c)s""",
        {"c": tuple(customers)},
    ) + frappe.get_all("User", filters={"name": ("like", f"%@{STAFF_DOMAIN}")}, pluck="name")
    for email in emails:
        if email not in _protected_staff():
            frappe.db.set_value("User", email, "enabled", 1)
    frappe.db.commit()
    _log(f"{len(emails)} demo accounts enabled")


def requests_only():
    """Raise the requests again on the companies already built, leaving everything else as it is."""
    _guard()
    frappe.set_user("Administrator")
    frappe.flags.mute_emails = True
    rng = random.Random(SEED + 1)
    companies = [_company_from_site(row) for row in CUSTOMERS]
    companies = [c for c in companies if c]
    customers = [c["customer"] for c in companies]

    old = frappe.get_all("MSP Request", filters={"customer": ("in", customers)}, pluck="name")
    if old:
        _log(f"removing {len(old)} earlier demo requests")
        _purge_requests(old)

    staff = {
        "admins": _staff_with("MSP System Admin"),
        "technicians": _staff_with("MSP Technician"),
    }
    _requests(rng, companies, staff)
    frappe.db.commit()
    print(json.dumps(_counts(), indent=2))


def _company_from_site(row):
    (_name, code, domain, _city, _group, _size, tier, extras, departments, status, months) = row
    customer = _existing_customer(row)
    if not customer:
        return None

    contract = frappe.db.get_value("MSP Contract", {"customer": customer}, ["name", "start_date"], as_dict=True)
    people = [
        {"name": p.name, "full_name": p.full_name, "department": p.department,
         "joined": str(p.start_date), "left": str(p.disabled_date) if p.lifecycle_status == "Disabled" else None,
         "devices": []}
        for p in frappe.get_all(
            "MSP Client User", filters={"customer": customer},
            fields=["name", "full_name", "department", "start_date", "disabled_date", "lifecycle_status"],
            order_by="name asc",
        )
    ]
    accounts = {}
    for approver in frappe.get_all(
        "MSP Approver", filters={"parent": customer, "status": "Active"},
        fields=["user", "can_submit", "can_approve"], order_by="idx asc",
    ):
        if approver.can_submit and approver.can_approve:
            accounts.setdefault("manager", approver.user)
        elif approver.can_submit:
            accounts.setdefault("requester", approver.user)

    return {
        "customer": customer, "code": code, "domain": f"{domain}.example", "status": status, "tier": tier,
        "extras": extras, "departments": departments, "people": people, "devices": [],
        "started": str(contract.start_date) if contract and months else None,
        "contract": contract.name if contract else None, "accounts": accounts,
    }


def _staff_with(role):
    return frappe.db.sql_list(
        "select parent from `tabHas Role` where role = %s and parent like %s order by parent",
        (role, f"%@{STAFF_DOMAIN}"),
    )


def _purge_requests(requests):
    business = [("MSP Request", r) for r in requests]
    for doctype in ("MSP Work Order", "MSP Requested Device", "MSP Requested Client User"):
        business += [(doctype, n) for n in frappe.get_all(doctype, filters={"request": ("in", requests)}, pluck="name")]
    _purge_notifications(business)
    for doctype, name in business:
        frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
    frappe.db.commit()


def invoice_approved():
    """Draw the invoice of every approved demo run that has none yet, oldest first.

    Needs a default income account on the company, which is for a person to choose.
    """
    from nexgen_msp.api.internal.services.billing_service import BillingService

    _guard()
    frappe.set_user("Administrator")
    customers = [name for name in (_existing_customer(row) for row in CUSTOMERS) if name]
    runs = frappe.get_all(
        "MSP Billing Run",
        filters={"customer": ("in", customers), "docstatus": 1, "status": "Approved", "sales_invoice": ("is", "not set")},
        pluck="name",
        order_by="billing_period_start asc",
    )
    drawn = 0

    for name in runs:
        try:
            BillingService.create_invoice(name=name)
            drawn += 1
        except Exception as error:
            frappe.db.rollback()
            _log(f"{name}: {str(getattr(error, 'message', error))[:160]}")

    frappe.db.commit()
    _log(f"{drawn} of {len(runs)} runs invoiced")


def purge(_quiet=False):
    """Take every demo record away again, children before parents."""
    _guard()
    frappe.set_user("Administrator")
    customers = [
        name for name in (_existing_customer(row) for row in CUSTOMERS) if name
    ]

    if customers:
        _purge_customers(customers)

    for email in frappe.get_all("User", filters={"name": ("like", f"%@{STAFF_DOMAIN}")}, pluck="name"):
        if email in _protected_staff():
            continue
        _purge_account(email)

    for code in SERVICE_CODES:
        for doctype, field in (("Item Price", "item_code"), ("MSP Service Definition", "item")):
            for name in frappe.get_all(doctype, filters={field: code}, pluck="name"):
                frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

        if frappe.db.exists("Item", code):
            frappe.delete_doc("Item", code, force=True, ignore_permissions=True)

    for name in DEPARTMENTS:
        if frappe.db.exists("MSP Department", name):
            if not frappe.db.exists("MSP Client User", {"department": name}):
                frappe.delete_doc("MSP Department", name, force=True, ignore_permissions=True)

    frappe.db.commit()

    if not _quiet:
        print(json.dumps(_counts(), indent=2))


# =========================================================================== reference data
def _catalogue():
    for code, name, scope, rate, label in SERVICES:
        if not frappe.db.exists("Item", code):
            frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": code,
                    "item_name": name,
                    "description": name,
                    "item_group": "Services",
                    "is_stock_item": 0,
                    "is_sales_item": 1,
                    "include_item_in_manufacturing": 0,
                    "stock_uom": "Month",
                    "sales_uom": "Month",
                    "uoms": [{"uom": "Month", "conversion_factor": 1}],
                }
            ).insert(ignore_permissions=True)

        frappe.get_doc(
            {
                "doctype": "MSP Service Definition",
                "item": code,
                "enabled": 1,
                "service_scope": scope,
                "invoice_label": label,
            }
        ).insert(ignore_permissions=True)

        frappe.get_doc(
            {
                "doctype": "Item Price",
                "item_code": code,
                "price_list": PRICE_LIST,
                "selling": 1,
                "buying": 0,
                "currency": CURRENCY,
                "price_list_rate": rate,
                "valid_from": "2025-01-01",
            }
        ).insert(ignore_permissions=True)

    frappe.db.commit()


def _departments():
    for index, name in enumerate(DEPARTMENTS):
        if not frappe.db.exists("MSP Department", name):
            frappe.get_doc(
                {
                    "doctype": "MSP Department",
                    "department_name": name,
                    "enabled": 1,
                    "sort_order": index + 1,
                    "customer": None,
                }
            ).insert(ignore_permissions=True)

    frappe.db.commit()


def _staff():
    from nexgen_msp.api.internal.services.team_service import TeamService

    staff = {"admins": [], "technicians": []}

    for first, last, role in STAFF:
        email = f"{_slug(first)}.{_slug(last)}@{STAFF_DOMAIN}"

        if email not in _protected_staff():
            with _bulk_accounts():
                TeamService.create_account(
                    email=email, first_name=first, last_name=last, kind="internal", role=role, send_email=0
                )
            _password(email)

        staff["admins" if role == "MSP System Admin" else "technicians"].append(email)

    frappe.db.commit()

    return staff


# =========================================================================== one client
def _company(rng, row, scale):
    from nexgen_msp.api.internal.services.customer_service import CustomerService

    (name, code, domain, city, group, size, tier, extras, departments, status, months) = row
    size = max(6, int(size * scale))
    domain = f"{domain}.example"
    started = get_first_day(add_months(today(), -months)) if months else None

    customer = CustomerService.create_customer(
        customer_name=name,
        details={
            "customer_type": "Company",
            "customer_group": group,
            "territory": "Cameroon",
            "tax_id": f"M{rng.randint(10, 99)}{rng.randint(1000000, 9999999)}{rng.choice('ABCDEFGHJKLMNPQRSTVWXYZ')}",
            "default_currency": CURRENCY,
            "website": f"https://www.{domain}",
            "msp_free_of_charge": 0,
        },
        address={
            "address_line1": f"{rng.randint(1, 240)} {rng.choice(STREETS)}",
            "address_line2": f"BP {rng.randint(1000, 15999)}",
            "city": city,
            "state": _region(city),
            "country": "Cameroon",
            "phone": _phone(rng),
            "email_id": f"contact@{domain}",
        },
    )["name"]
    first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
    CustomerService.add_billing_contact(
        customer=customer, full_name=f"{first} {last}", email=f"comptabilite@{domain}"
    )

    out = {
        "customer": customer, "code": code, "domain": domain, "status": status, "tier": tier,
        "extras": extras, "departments": departments, "people": [], "devices": [],
        "started": started, "contract": None, "accounts": {},
    }

    if not started:
        # a company we are still talking to: on file, no contract signed yet, nothing running
        out["contract"] = _contract(rng, out, "Draft", add_days(today(), 30))
        _accounts(rng, out)
        return out

    out["contract"] = _contract(rng, out, "Active", started)
    _people(rng, out, size)
    _devices(rng, out)
    _services(rng, out)

    # services stop now, the contract itself closes once its months are billed
    if status == "Suspended":
        _suspend_company(rng, out)
    elif status == "Ended":
        _end_company(rng, out)

    if status != "Ended":
        _accounts(rng, out)

    frappe.db.commit()

    return out


def _contract(rng, company, status, started):
    services = _services_for(company)
    doc = frappe.get_doc(
        {
            "doctype": "MSP Contract",
            "customer": company["customer"],
            "title": f"Managed IT services — {company['customer']}",
            "status": status,
            "start_date": started,
            "end_date": add_days(add_months(started, 24), -1),
            "billing_frequency": "Monthly",
            "billing_timing": "In Arrears",
            "proration_method": rng.choice(["Daily Actual Days", "Daily Actual Days", "30-Day Convention"]),
            "invoice_grouping": "One Invoice",
            "price_list": PRICE_LIST,
            "currency": CURRENCY,
            "billing_notes": "Invoice by the 5th of the following month. Payment by bank transfer within 30 days.",
            "services": [{"service_item": code} for code in services],
        }
    ).insert(ignore_permissions=True)

    # bigger accounts negotiated their per-seat rates down; one never had a server rate agreed
    if company["code"] in ("MMF", "SAI", "AMW", "TRP", "NEC"):
        for code in services:
            rate = dict((s[0], s[3]) for s in SERVICES)[code]
            frappe.get_doc(
                {
                    "doctype": "Item Price",
                    "item_code": code,
                    "price_list": PRICE_LIST,
                    "customer": company["customer"],
                    "selling": 1,
                    "buying": 0,
                    "currency": CURRENCY,
                    "price_list_rate": round(rate * rng.choice([0.85, 0.88, 0.9]) / 50) * 50,
                    "valid_from": started,
                }
            ).insert(ignore_permissions=True)

    return doc.name


def _services_for(company):
    codes = [f"SVC-M365-{company['tier']}", "SVC-HELPDESK", "SVC-SOPHOS-EP", "SVC-DATTO-RMM"]
    extras = company["extras"]

    for extra in ("VPN", "NEXTCLOUD", "PARALLELS", "BACKUP-WS", "MDM"):
        if extra in extras:
            codes.append(f"SVC-{extra}")

    if "SRV" in extras:
        codes += ["SVC-SOPHOS-SRV", "SVC-SRV-MGMT", "SVC-SRV-BACKUP", "SVC-FW-MGMT"]

    # a few of the oldest clients came to us with an antivirus we have since replaced
    if company["code"] in ("WFL", "MMF", "SAI", "GCG", "TTE"):
        codes.append(LEGACY)

    return codes


def _people(rng, company, size):
    used_names, used_logins = set(), set()
    started = getdate(company["started"])
    span = (getdate(today()) - started).days

    for index in range(size):
        while True:
            first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
            if (first, last) not in used_names:
                used_names.add((first, last))
                break

        login = f"{_slug(first)[0]}.{_slug(last)}"
        suffix = 2
        while login in used_logins:
            login = f"{_slug(first)[0]}.{_slug(last)}{suffix}"
            suffix += 1
        used_logins.add(login)

        # most were there when we took the company on; the rest joined since
        joined = started if index < size * 0.75 else add_days(started, rng.randint(20, max(21, span - 10)))
        department = company["departments"][0] if index < 2 else rng.choice(company["departments"])
        doc = frappe.get_doc(
            {
                "doctype": "MSP Client User",
                "customer": company["customer"],
                "full_name": f"{first} {last}",
                "department": department,
                "username": login,
                "email": f"{login}@{company['domain']}",
                "external_employee_id": f"{company['code']}-{1000 + index}",
                "lifecycle_status": "Active",
                "start_date": joined,
                "ad_status": rng.choice(["Active", "Active", "Active", "Not Managed"]),
            }
        ).insert(ignore_permissions=True)
        company["people"].append(
            {"name": doc.name, "joined": str(joined), "department": department, "full_name": doc.full_name,
             "left": None, "devices": []}
        )


def _devices(rng, company):
    from nexgen_msp.utils import device_holders

    counter = {}

    def hostname(prefix):
        counter[prefix] = counter.get(prefix, 0) + 1
        return f"{company['code']}-{prefix}{counter[prefix]:03d}"

    def make(prefix, device_type, spec, holder=None, since=None, status="Stock"):
        manufacturer, model, os_name = spec
        values = {
            "doctype": "MSP Managed Device",
            "customer": company["customer"],
            "hostname": hostname(prefix),
            "device_type": device_type,
            "status": "Stock",
            "serial_number": _serial(rng, manufacturer),
            "asset_tag": f"{company['code']}-A{rng.randint(10000, 99999)}",
            "manufacturer": manufacturer,
            "model": model,
            "operating_system": os_name,
            "rmm_asset_id": f"datto-{rng.randint(100000, 999999)}" if device_type != "Phone" else None,
            "sophos_endpoint_id": frappe.generate_hash(length=24) if device_type in ("Laptop", "PC", "Mac", "Server") else None,
            "network_interfaces": _interfaces(rng, manufacturer, device_type),
        }
        doc = frappe.get_doc(values).insert(ignore_permissions=True)

        if holder:
            device_holders.hand_over(doc, holder["name"], on_date=since)
            doc.status = "Active"
            doc.assigned_date = since
            doc.save(ignore_permissions=True)
            holder["devices"].append(doc.name)
        elif status != "Stock":
            doc.status = status
            doc.retired_date = add_days(today(), -rng.randint(15, 200))
            doc.save(ignore_permissions=True)

        record = {"name": doc.name, "type": device_type, "holder": holder["name"] if holder else None,
                  "since": str(since) if since else None, "status": doc.status}
        company["devices"].append(record)

        return record

    for person in company["people"]:
        if rng.random() < 0.9:
            prefix, device_type, specs = rng.choices(COMPUTERS, weights=[6, 3, 1])[0]
            make(prefix, device_type, rng.choice(specs), person, person["joined"])

        if "MDM" in company["extras"] and rng.random() < 0.35:
            make("PH", "Phone", rng.choice(PHONES), person, person["joined"])

    if "SRV" in company["extras"]:
        admin = next((p for p in company["people"] if p["department"] in ("IT", "Management")), company["people"][0])
        for _ in range(rng.randint(1, 3)):
            make("SRV", "Server", rng.choice(SERVERS), admin, company["started"])
        make("FW", "Firewall", rng.choice(FIREWALLS), admin, company["started"])

    # spare machines on the shelf, and a few that broke, went missing or were written off
    for _ in range(rng.randint(2, 6)):
        prefix, device_type, specs = rng.choice(COMPUTERS[:2])
        make(prefix, device_type, rng.choice(specs))

    for status in rng.sample(["Damaged", "Lost", "Retired", "Returned"], k=rng.randint(1, 3)):
        prefix, device_type, specs = rng.choice(COMPUTERS[:2])
        make(prefix, device_type, rng.choice(specs), status=status)


def _services(rng, company):
    """Everybody's services from the day they started, then a year of changes to them."""
    from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService

    customer, extras = company["customer"], company["extras"]
    tier = f"SVC-M365-{company['tier']}"
    company["assignments"] = []
    devices = {row["name"]: row for row in company["devices"]}

    def open_(code, since, person=None, device=None):
        result = ServiceLifecycleService.activate(
            customer=customer,
            service_item=code,
            target_scope="Device" if device else "User",
            client_user=person["name"] if person else None,
            managed_device=device["name"] if device else None,
            effective_date=since,
        )
        row = {"name": result["name"], "code": code, "since": str(since),
               "person": person["name"] if person else None, "device": device["name"] if device else None}
        company["assignments"].append(row)
        return row

    for person in company["people"]:
        since = person["joined"]
        open_(tier, since, person=person)
        open_("SVC-HELPDESK", since, person=person)

        if "VPN" in extras and (person["department"] in ("Management", "Finance", "IT", "Sales", "Engineering") or rng.random() < 0.25):
            open_("SVC-VPN", since, person=person)
        if "NEXTCLOUD" in extras and rng.random() < 0.6:
            open_("SVC-NEXTCLOUD", since, person=person)
        if "PARALLELS" in extras and person["department"] in ("Finance", "Accounting", "Customer Service", "Operations"):
            open_("SVC-PARALLELS", since, person=person)

    for device in company["devices"]:
        if device["status"] != "Active":
            continue

        since = device["since"]

        if device["type"] in ("Laptop", "PC", "Mac"):
            open_(LEGACY if (LEGACY in _services_for(company) and getdate(since) == getdate(company["started"]))
                  else "SVC-SOPHOS-EP", since, device=device)
            open_("SVC-DATTO-RMM", since, device=device)
            if "BACKUP-WS" in extras and (device["type"] == "Laptop" or rng.random() < 0.3):
                open_("SVC-BACKUP-WS", since, device=device)
        elif device["type"] == "Phone":
            open_("SVC-MDM", since, device=device)
        elif device["type"] == "Server":
            for code in ("SVC-SOPHOS-SRV", "SVC-SRV-MGMT", "SVC-SRV-BACKUP", "SVC-DATTO-RMM"):
                open_(code, since, device=device)
        elif device["type"] == "Firewall":
            open_("SVC-FW-MGMT", since, device=device)

    _history(rng, company, devices)


def _history(rng, company, devices):
    """What a year does to a client: the antivirus swap, leavers, pauses, upgrades."""
    from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
    from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService

    started = getdate(company["started"])
    now = getdate(today())
    span = (now - started).days

    if span < 45:
        return

    # the legacy antivirus was swapped for Sophos two to four months in
    swap = add_days(started, rng.randint(60, min(120, span - 5)))
    for row in [r for r in company["assignments"] if r["code"] == LEGACY]:
        ServiceLifecycleService.end(assignment=row["name"], effective_date=swap, notes="Replaced by Sophos Intercept X.")
        row["ended"] = str(swap)
        new = ServiceLifecycleService.activate(
            customer=company["customer"], service_item="SVC-SOPHOS-EP", target_scope="Device",
            managed_device=row["device"], effective_date=add_days(swap, 1),
        )
        company["assignments"].append({"name": new["name"], "code": "SVC-SOPHOS-EP", "since": str(add_days(swap, 1)),
                                       "person": None, "device": row["device"]})

    # leavers: about one in twelve, gone some time after they started
    for person in company["people"][2:]:
        joined = getdate(person["joined"])
        if rng.random() > 0.08 or (now - joined).days < 60:
            continue

        # they leave after everything on their machines had started, the antivirus swap included
        latest = max(
            [getdate(add_days(joined, 45))]
            + [getdate(add_days(r["since"], 1)) for r in company["assignments"] if r["device"] in person["devices"]]
        )
        if (now - latest).days < 6:
            continue
        left = add_days(latest, rng.randint(0, (now - latest).days - 5))
        for row in company["assignments"]:
            if row["person"] == person["name"] and not row.get("ended"):
                ServiceLifecycleService.end(assignment=row["name"], effective_date=left, notes="Employee left the company.")
                row["ended"] = str(left)

        for device_name in person["devices"]:
            for row in company["assignments"]:
                if row["device"] == device_name and not row.get("ended"):
                    ServiceLifecycleService.end(assignment=row["name"], effective_date=left, notes="Machine returned by a leaver.")
                    row["ended"] = str(left)
            DeviceLifecycleService.repossess(device=device_name, effective_date=left, note="Returned on departure.")
            devices[device_name]["status"] = "Stock"
            devices[device_name]["free_from"] = str(left)

        frappe.db.set_value(
            "MSP Client User",
            person["name"],
            {"lifecycle_status": "Disabled", "disabled_date": left,
             "disabled_reason": rng.choice(["Departure", "Departure", "Departure", "Contract Ended"]),
             "ad_status": "Disabled" if rng.random() < 0.8 else "Active"},
        )
        person["left"] = str(left)

    # a few services paused for a month or two (long leave, a laptop away for repair), some still paused
    candidates = [r for r in company["assignments"] if not r.get("ended") and r["code"] in
                  ("SVC-VPN", "SVC-PARALLELS", "SVC-BACKUP-WS", "SVC-NEXTCLOUD")]
    for row in rng.sample(candidates, k=min(len(candidates), rng.randint(1, 4))):
        since = getdate(row["since"])
        if (now - since).days < 60:
            continue
        paused = add_days(since, rng.randint(30, (now - since).days - 10))
        ServiceLifecycleService.suspend(assignment=row["name"], effective_date=paused, notes="Paused at the client's request.")
        back = add_days(paused, rng.randint(20, 70))
        if getdate(back) < now and rng.random() < 0.7:
            ServiceLifecycleService.resume(assignment=row["name"], effective_date=back, notes="Back in service.")

    # a handful of people moved up a Microsoft 365 plan
    if company["tier"] == "BASIC":
        basics = [r for r in company["assignments"] if r["code"] == "SVC-M365-BASIC" and not r.get("ended")]
        for row in rng.sample(basics, k=min(len(basics), rng.randint(1, 4))):
            since = getdate(row["since"])
            if (now - since).days < 40:
                continue
            on = add_days(since, rng.randint(30, (now - since).days - 3))
            ServiceLifecycleService.end(assignment=row["name"], effective_date=on, notes="Upgraded to Business Standard.")
            row["ended"] = str(on)
            ServiceLifecycleService.activate(
                customer=company["customer"], service_item="SVC-M365-STD", target_scope="User",
                client_user=row["person"], effective_date=add_days(on, 1),
            )

    # and some machines changed hands
    stock = [d for d in company["devices"] if d["status"] == "Stock" and d["type"] in ("Laptop", "PC")]
    newcomers = [p for p in company["people"] if not p["left"] and not p["devices"]]
    for device, person in zip(stock, newcomers, strict=False):
        # never before the machine came back, nor before the person joined
        on = max(
            getdate(person["joined"]),
            getdate(add_days(now, -rng.randint(5, 40))),
            getdate(device.get("free_from") or person["joined"]),
        )
        try:
            DeviceLifecycleService.assign(device=device["name"], client_user=person["name"], effective_date=on)
        except Exception as error:
            frappe.db.rollback()
            _log(f"  {device['name']} not handed over: {str(getattr(error, 'message', error))[:120]}")
            continue
        device.update(status="Active", holder=person["name"], since=str(on))
        person["devices"].append(device["name"])
        # protection resumes the day after the last period on this machine ended, never inside it
        previous = frappe.db.sql(
            """select max(effective_end_date) from `tabMSP Service Assignment`
               where managed_device = %s and service_item = 'SVC-SOPHOS-EP' and operational_status = 'Ended'""",
            device["name"],
        )[0][0]
        start = max(getdate(on), getdate(add_days(previous, 1)) if previous else getdate(on))
        if start > now:
            continue
        try:
            ServiceLifecycleService.activate(
                customer=company["customer"], service_item="SVC-SOPHOS-EP", target_scope="Device",
                managed_device=device["name"], effective_date=start,
            )
        except Exception as error:
            frappe.db.rollback()
            _log(f"  {device['name']} protection not reopened: {str(getattr(error, 'message', error))[:120]}")


def _legacy_retired():
    """The legacy antivirus is no longer sold: only the old assignments still name it."""
    frappe.db.set_value("MSP Service Definition", {"item": LEGACY}, "enabled", 0)
    frappe.db.commit()


def _suspend_company(rng, company):
    """A client who stopped paying: every running service paused six weeks ago."""
    from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService

    on = add_days(today(), -42)
    for row in company["assignments"]:
        if row.get("ended") or getdate(row["since"]) > getdate(on):
            continue
        try:
            ServiceLifecycleService.suspend(assignment=row["name"], effective_date=on, notes="Account on hold: invoices overdue.")
        except Exception:
            frappe.db.rollback()

    company["close_contract"] = {"status": "Suspended"}


def _end_company(rng, company):
    """A client who left us at the end of last month."""
    from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService

    on = get_last_day(add_months(today(), -2))
    for row in company["assignments"]:
        if row.get("ended") or getdate(row["since"]) > getdate(on):
            continue
        try:
            ServiceLifecycleService.end(assignment=row["name"], effective_date=on, notes="Contract not renewed.")
            row["ended"] = str(on)
        except Exception:
            frappe.db.rollback()

    company["close_contract"] = {"status": "Ended", "end_date": on}


def _accounts(rng, company):
    """A manager who approves, and at larger clients an assistant who asks and someone who only reads."""
    from nexgen_msp.api.internal.services.authority_service import AuthorityService
    from nexgen_msp.api.internal.services.team_service import TeamService

    plan = [("manager", "MSP Customer Manager", {"can_submit": 1, "can_approve": 1})]
    if len(company["people"]) >= 20 or not company["people"]:
        plan.append(("requester", "MSP Customer Manager", {"can_submit": 1, "can_approve": 0}))
    if len(company["people"]) >= 40:
        plan.append(("operator", "MSP Customer Operator", {"can_submit": 0, "can_approve": 0}))

    for kind, role, rights in plan:
        first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
        email = f"{_slug(first)}.{_slug(last)}@{company['domain']}"
        with _bulk_accounts():
            TeamService.create_account(
                email=email, first_name=first, last_name=last, kind="customer", role=role,
                customer=company["customer"], send_email=0,
            )
        _password(email)
        AuthorityService.set_account_rights(email, rights)
        company["accounts"][kind] = email

    frappe.db.commit()


# =========================================================================== billing
def _billing(rng, companies):
    """Every finished month billed. Old months invoiced, last month still being checked."""
    from nexgen_msp.api.internal.services.billing_service import BillingService

    last_month = get_first_day(add_months(today(), -1))
    # drawing an invoice needs the company's income account, which is an accounting choice
    # made by a person: without it, finished months are approved and wait to be invoiced
    can_invoice = bool(frappe.db.get_value(
        "Company", frappe.defaults.get_global_default("company"), "default_income_account"
    ))

    for company in companies:
        if not company["started"]:
            continue

        month = getdate(company["started"])
        while month <= last_month:
            start, end = month, get_last_day(month)
            month = add_months(month, 1)

            try:
                run = BillingService.generate(contract=company["contract"], period_start=start, period_end=end)
            except Exception as error:
                frappe.db.rollback()
                _log(f"  no run for {company['code']} {start}: {getattr(error, 'message', error)}")
                continue

            name = run["name"] if isinstance(run, dict) else run
            is_last = getdate(start) == getdate(last_month)

            if is_last and rng.random() < 0.6:
                continue  # left for somebody to check

            try:
                if is_last or not can_invoice or rng.random() < 0.1:
                    BillingService.approve(name=name)
                else:
                    BillingService.finalise(name=name)
            except Exception as error:
                frappe.db.rollback()
                _log(f"  {name} stays open: {str(getattr(error, 'message', error))[:120]}")

            _backdate("MSP Billing Run", name, add_days(end, rng.randint(2, 6)))

        frappe.db.commit()


# =========================================================================== requests
def _requests(rng, companies, staff):
    """Three months of what clients asked for, in every state a request can be in."""
    live = [c for c in companies if c["started"] and c["status"] == "Active" and c["accounts"].get("manager")]
    made = []

    for company in live:
        weight = max(2, len(company["people"]) // 10)
        for _ in range(rng.randint(weight, weight + 4)):
            made.append(_one_request(rng, company, staff))

    # one prospect already sent in what it wants for go-live
    made = [m for m in made if m]
    made.sort(key=lambda row: row["when"])
    for row in made:
        _backdate("MSP Request", row["name"], row["when"])

    frappe.db.commit()
    _log(f"  {len(made)} requests")


OUTCOMES = [
    ("completed", 44), ("approved", 10), ("review", 10), ("submitted", 14),
    ("awaiting", 7), ("rejected", 6), ("cancelled", 3), ("draft", 6),
]


def _one_request(rng, company, staff):
    from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
    from nexgen_msp.api.internal.services.request_service import RequestService
    from nexgen_msp.api.portal.services.portal_service import PortalService

    outcome = rng.choices([o for o, _ in OUTCOMES], weights=[w for _, w in OUTCOMES])[0]
    age = rng.randint(0, 6) if outcome in ("submitted", "awaiting", "draft") else rng.randint(2, 90)
    when = frappe.utils.add_to_date(frappe.utils.now_datetime(), days=-age, hours=-rng.randint(0, 9))
    if outcome == "awaiting" and not company["accounts"].get("requester"):
        outcome = "submitted"
    asker = company["accounts"]["requester"] if outcome == "awaiting" else company["accounts"]["manager"]
    technician = rng.choice(staff["technicians"])

    try:
        payload = _request_payload(rng, company, asker)
    except Exception as error:
        frappe.db.rollback()
        _log(f"  {company['code']}: could not shape a request: {str(error)[:120]}")
        return None

    if not payload:
        return None

    frappe.set_user(asker)
    frappe.clear_cache(user=asker)
    try:
        call = PortalService.save_draft if outcome == "draft" else PortalService.create_request
        name = call(customer=company["customer"], **payload)["name"]
    except Exception as error:
        frappe.db.rollback()
        _log(f"  {company['code']}: request refused: {str(getattr(error, 'message', error))[:140]}")
        return None
    finally:
        frappe.set_user("Administrator")

    frappe.db.commit()

    if outcome in ("draft", "awaiting", "submitted"):
        return {"name": name, "when": when}

    frappe.set_user(technician)
    frappe.clear_cache(user=technician)
    try:
        if outcome == "cancelled":
            frappe.set_user(rng.choice(staff["admins"]))
            RequestService.run_action(name=name, action="cancel", reason=rng.choice([
                "Duplicate of an earlier request.", "The client withdrew it by phone.",
            ]))
            return {"name": name, "when": when}

        RequestService.run_action(name=name, action="start_review")

        if outcome == "review":
            return {"name": name, "when": when}

        if outcome == "rejected":
            RequestService.run_action(name=name, action="reject", reason=rng.choice([
                "This service is not on the client's contract. Sales will follow up with a quote.",
                "The person named has left the company according to HR.",
                "Please raise this again with the cost centre filled in.",
            ]))
            return {"name": name, "when": when}

        lines = frappe.get_doc("MSP Request", name).lines
        refused = [row.idx for row in lines if len(lines) > 3 and rng.random() < 0.08]
        approved = [row.idx for row in lines if row.idx not in refused]
        if refused:
            RequestService.set_line_statuses(name=name, idxs=refused, line_status="Rejected",
                                             reason="Already covered by an existing service.")
        if approved:
            RequestService.set_line_statuses(name=name, idxs=approved, line_status="Approved")
        RequestService.run_action(name=name, action="approve")
        frappe.db.commit()

        if outcome == "approved":
            return {"name": name, "when": when}

        _prepare(rng, company, name)

        # a hand-over has to happen before the services that run on the machine, so whatever
        # was refused for that reason gets a second pass
        for _attempt in range(3):
            orders = frappe.get_all(
                "MSP Work Order",
                filters={"request": name, "status": ("in", ("Open", "Scheduled", "In Progress"))},
                pluck="name",
                order_by="work_type desc, name asc",
            )
            if not orders:
                break
            result = RequestExecutionService.execute_work_orders(
                request=name, executions=[{"work_order": order, "inputs": {}} for order in orders]
            )
            frappe.db.commit()
            if not result.get("failed"):
                break
            if _attempt == 2:
                for row in result["results"]:
                    if not row["ok"]:
                        _log(f"  {row['work_order']}: {str(row['message'])[:140]}")

        try:
            RequestExecutionService.complete_request(request=name)
        except Exception as error:
            frappe.db.rollback()
            _log(f"  {name} left in progress: {str(getattr(error, 'message', error))[:120]}")
    except Exception as error:
        frappe.db.rollback()
        _log(f"  {name} stopped early: {str(getattr(error, 'message', error))[:140]}")
    finally:
        frappe.set_user("Administrator")

    frappe.db.commit()

    return {"name": name, "when": when}


def _prepare(rng, company, request):
    """What a technician settles before new work can run: who the new person is, which machine."""
    from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
    from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService

    for row in frappe.get_all(
        "MSP Requested Client User", filters={"request": request, "status": "Open"},
        fields=["name", "full_name"],
    ):
        first, _, last = row.full_name.partition(" ")
        login = f"{_slug(first)[:1]}.{_slug(last)}{rng.randint(2, 99)}"
        RequestedClientUserService.resolve_create(
            row.name,
            prepared_values={"username": login, "email": f"{login}@{company['domain']}", "start_date": today()},
        )

    for row in frappe.get_all("MSP Requested Device", filters={"request": request, "status": "Open"}, pluck="name"):
        manufacturer, model, os_name = rng.choice(COMPUTERS[0][2])
        number = frappe.db.count("MSP Managed Device", {"customer": company["customer"]}) + 1
        RequestedDeviceService.resolve_new(
            row,
            prepared_values={
                "hostname": f"{company['code']}-LT{number + 100:03d}",
                "serial_number": _serial(rng, manufacturer),
                "manufacturer": manufacturer,
                "model": model,
                "operating_system": os_name,
            },
            interfaces=_interfaces(rng, manufacturer, "Laptop"),
        )

    frappe.db.commit()


def _request_payload(rng, company, asker):
    """What a client typically asks for, built from the same options the portal offers them."""
    from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

    active = [p for p in company["people"] if not p["left"]]
    kind = rng.choices(["add", "end", "suspend", "new_hire", "department"], weights=[40, 20, 12, 18, 10])[0]
    details = {
        "add": "Please add the following, the team needs it from next week.",
        "end": "These people no longer need this, please stop billing us for it.",
        "suspend": "On extended leave, please pause until they are back.",
        "new_hire": "New joiner starting soon, please prepare their account and laptop.",
        "department": "Rolling this out to the whole department.",
    }[kind]

    def subject(person, via="Existing"):
        return {
            "subject_key": f"user:{person['name']}",
            "client_user": person["name"],
            "full_name": person["full_name"],
            "department": person["department"],
            "added_via": via,
        }

    frappe.set_user(asker)
    frappe.clear_cache(user=asker)
    try:
        if kind == "new_hire":
            first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
            key = f"new:{frappe.generate_hash(length=8)}"
            device_key = f"new-device:{key[4:]}"
            subjects = [{"subject_key": key, "kind": "new", "client_user": None,
                         "full_name": f"{first} {last}", "department": rng.choice(company["departments"]),
                         "email": f"{_slug(first)[0]}.{_slug(last)}@{company['domain']}", "added_via": "New"}]
            devices = [{"device_requirement_key": device_key, "display_label": "New laptop",
                        "device_type": "Laptop", "intended_holder_subject_key": key}]
            options = RequestScopeService.operation_options(
                customer=company["customer"], subjects=subjects, requested_devices=devices
            )
            groups = [{
                "group_key": f"grp:{key}-laptop", "operation_code": "device.assign",
                "operation_label_snapshot": "Assign device", "domain": "Device", "service_item": None,
                "source_scope_type": "Person", "source_scope_key": key, "source_scope_label": f"{first} {last}",
                "selected_subject_count": 1, "exclusions": [],
                "targets": [{"subject_key": key, "client_user": None, "full_name": f"{first} {last}",
                             "target_scope": "Device", "managed_device": None, "device_requirement_key": device_key,
                             "requested_holder_subject_key": key, "source_service_assignment": None}],
            }]
            wanted = (f"SVC-M365-{company['tier']}", "SVC-HELPDESK", "SVC-SOPHOS-EP", "SVC-DATTO-RMM")
            for option in _service_options(options):
                if option["object_key"] in wanted and option["actions"]:
                    groups.append(_group(option, option["actions"][0], key, "Person", f"{first} {last}", 1))
            return {"subjects": subjects, "requested_devices": devices, "action_groups": groups,
                    "details": details, "priority": rng.choice(["Medium", "High"])}

        if kind == "department":
            department = rng.choice(company["departments"])
            chosen = [p for p in active if p["department"] == department][:15]
            via = "Department"
        else:
            chosen = rng.sample(active, k=min(len(active), rng.choice([1, 1, 1, 2, 3])))
            via = "Existing"

        if not chosen:
            return None

        subjects = [subject(p, via) for p in chosen]
        options = RequestScopeService.operation_options(customer=company["customer"], subjects=subjects)
        code = {"add": "service.add", "department": "service.add", "end": "service.end", "suspend": "service.suspend"}[kind]
        choices = [
            (option, action)
            for option in _service_options(options)
            for action in option["actions"]
            if action["operation_code"] == code and action.get("targets")
        ]
        if not choices:
            return None

        option, action = rng.choice(choices)
        scope = ("Department", chosen[0]["department"]) if kind == "department" else ("All", "All selected")
        group = _group(option, action, scope[1] if kind == "department" else None, scope[0], scope[1], len(subjects))

        return {"subjects": subjects, "action_groups": [group], "details": details,
                "priority": rng.choices(["Low", "Medium", "High", "Urgent"], weights=[15, 55, 22, 8])[0]}
    finally:
        frappe.set_user("Administrator")


def _service_options(options):
    for domain in options.get("domains") or []:
        if domain["key"] == "Service":
            yield from domain["options"]


def _group(option, action, scope_key, scope_type, label, count):
    return {
        "group_key": f"grp:{frappe.generate_hash(length=10)}",
        "operation_code": action["operation_code"],
        "operation_label_snapshot": action["operation_label_snapshot"],
        "domain": "Service",
        "service_item": option["object_key"],
        "source_scope_type": scope_type,
        "source_scope_key": scope_key,
        "source_scope_label": label,
        "selected_subject_count": count,
        "targets": action["targets"],
        "exclusions": action.get("exclusions") or [],
    }


# =========================================================================== integrations
def _integration_events(rng, companies):
    """The sync traffic a monitoring screen shows: mostly fine, sometimes not."""
    systems = [
        ("Active Directory", ["user.created", "user.disabled", "group.membership_changed"]),
        ("Sophos", ["endpoint.registered", "endpoint.threat_cleaned", "endpoint.out_of_date"]),
        ("Datto RMM", ["device.online", "device.patch_failed", "device.offline"]),
        ("Microsoft 365", ["license.assigned", "license.removed", "mailbox.created"]),
        ("Nextcloud", ["account.created", "quota.exceeded"]),
    ]
    errors = [
        "Timed out after 30s waiting for the remote API.",
        "401 Unauthorized: the API token has expired.",
        "Endpoint not found in the Sophos tenant.",
        "License pool exhausted for this SKU.",
    ]

    for _ in range(400):
        company = rng.choice([c for c in companies if c["people"]])
        system, events = rng.choice(systems)
        status = rng.choices(["Success", "Failed", "Retrying", "Ignored", "Pending"], weights=[78, 8, 4, 6, 4])[0]
        if system in ("Sophos", "Datto RMM") and company["devices"]:
            reference = ("MSP Managed Device", rng.choice(company["devices"])["name"])
        else:
            reference = ("MSP Client User", rng.choice(company["people"])["name"])
        happened = frappe.utils.add_to_date(frappe.utils.now_datetime(), minutes=-rng.randint(5, 60 * 24 * 30))
        doc = frappe.get_doc(
            {
                "doctype": "MSP Integration Event",
                "external_system": system,
                "direction": rng.choice(["Inbound", "Inbound", "Outbound"]),
                "event_type": rng.choice(events),
                "status": status,
                "retry_count": rng.randint(1, 5) if status in ("Failed", "Retrying") else 0,
                "processed_at": happened if status != "Pending" else None,
                "reference_doctype": reference[0],
                "reference_name": reference[1],
                "idempotency_key": frappe.generate_hash(length=20),
                "payload_summary": f"{company['code']} · {reference[1]}",
                "error_message": rng.choice(errors) if status in ("Failed", "Retrying") else None,
            }
        ).insert(ignore_permissions=True)
        _backdate("MSP Integration Event", doc.name, happened)

    frappe.db.commit()


# =========================================================================== clean-up
def _purge_customers(customers):
    params = {"customers": tuple(customers)}
    requests = frappe.db.sql_list("select name from `tabMSP Request` where customer in %(customers)s", params)
    runs = frappe.db.sql_list("select name from `tabMSP Billing Run` where customer in %(customers)s", params)
    invoices = frappe.db.sql_list(
        "select name from `tabSales Invoice` where customer in %(customers)s", params
    )

    for invoice in invoices:
        doc = frappe.get_doc("Sales Invoice", invoice)
        if doc.docstatus == 1:
            doc.cancel()
        frappe.delete_doc("Sales Invoice", invoice, force=True, ignore_permissions=True)

    for run in runs:
        frappe.db.sql("delete from `tabMSP Billing Run Line` where parent = %s", run)
        frappe.db.sql("delete from `tabMSP Billing Run` where name = %s", run)

    business = [("MSP Request", r) for r in requests]
    for doctype in ("MSP Work Order", "MSP Requested Device", "MSP Requested Client User",
                    "MSP Service Assignment", "MSP Managed Device", "MSP Client User"):
        names = frappe.db.sql_list(f"select name from `tab{doctype}` where customer in %(customers)s", params)
        business += [(doctype, n) for n in names]

    _purge_notifications(business)

    # children of these documents go by parent, the documents themselves by customer
    for doctype, children in (
        ("MSP Work Order", ("MSP Work Order Checklist Item",)),
        ("MSP Requested Device", ()),
        ("MSP Requested Client User", ()),
        ("MSP Request", ("MSP Request Line", "MSP Request Subject", "MSP Request Action Group", "MSP Remark")),
        ("MSP Service Assignment", ("MSP Service Suspension",)),
        ("MSP Managed Device", ("MSP Network Interface", "MSP Device Holder", "MSP Remark")),
        ("MSP Client User", ("MSP Remark",)),
        ("MSP Contract", ("MSP Contract Service",)),
    ):
        for child in children:
            frappe.db.sql(
                f"""delete from `tab{child}` where parenttype = %(parent)s and parent in
                    (select name from `tab{doctype}` where customer in %(customers)s)""",
                {**params, "parent": doctype},
            )
        frappe.db.sql(f"delete from `tab{doctype}` where customer in %(customers)s", params)

    frappe.db.sql("delete from `tabMSP Integration Event` where payload_summary rlike %s",
                  "^(" + "|".join(row[1] for row in CUSTOMERS) + ") ·")
    frappe.db.sql("delete from `tabItem Price` where customer in %(customers)s", params)

    for customer in customers:
        if frappe.db.exists("MSP Approval Authority", customer):
            frappe.delete_doc("MSP Approval Authority", customer, force=True, ignore_permissions=True)

        accounts = frappe.db.sql_list(
            "select user from `tabUser Permission` where allow = 'Customer' and for_value = %s", customer
        )
        for email in set(accounts):
            _purge_account(email)

        for doctype in ("Contact", "Address"):
            for name in frappe.db.sql_list(
                """select parent from `tabDynamic Link` where parenttype = %s
                   and link_doctype = 'Customer' and link_name = %s""",
                (doctype, customer),
            ):
                frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

        frappe.delete_doc("Customer", customer, force=True, ignore_permissions=True)
        frappe.db.commit()


def _purge_notifications(business):
    for doctype, name in business:
        rows = frappe.db.sql_list(
            "select name from `tabMSP Notification Dispatch` where business_doctype=%s and business_name=%s",
            (doctype, name),
        )
        for row in rows:
            frappe.db.sql("delete from `tabMSP Notification Audit` where dispatch = %s", row)
        frappe.db.sql(
            "delete from `tabMSP Notification Dispatch` where business_doctype=%s and business_name=%s",
            (doctype, name),
        )
        frappe.db.sql(
            "delete from `tabMSP Notification Audit` where business_doctype=%s and business_name=%s",
            (doctype, name),
        )
        frappe.db.sql("delete from `tabComment` where reference_doctype=%s and reference_name=%s", (doctype, name))
        frappe.db.sql("delete from `tabVersion` where ref_doctype=%s and docname=%s", (doctype, name))
        for queued in frappe.db.sql_list(
            "select name from `tabEmail Queue` where reference_doctype=%s and reference_name=%s", (doctype, name)
        ):
            frappe.db.sql("delete from `tabEmail Queue Recipient` where parent = %s", queued)
            frappe.db.sql("delete from `tabEmail Queue` where name = %s", queued)


def _purge_account(email):
    for queued in frappe.db.sql_list(
        "select distinct parent from `tabEmail Queue Recipient` where recipient = %s", email
    ):
        frappe.db.sql("delete from `tabEmail Queue Recipient` where parent = %s", queued)
        frappe.db.sql("delete from `tabEmail Queue` where name = %s", queued)

    contacts = set(frappe.get_all("Contact", filters={"user": email}, pluck="name"))
    contacts.update(frappe.db.sql_list("select distinct parent from `tabContact Email` where email_id = %s", email))
    for contact in contacts:
        frappe.db.sql("delete from `tabDynamic Link` where parenttype='Contact' and parent=%s", contact)
        frappe.db.sql("delete from `tabContact Email` where parent=%s", contact)
        frappe.db.sql("delete from `tabContact Phone` where parent=%s", contact)
        frappe.db.sql("delete from `tabContact` where name=%s", contact)

    frappe.db.sql("delete from `tabMSP Approver` where user=%s", email)
    frappe.db.sql("delete from `tabUser Permission` where user=%s", email)
    frappe.db.sql("delete from `tabHas Role` where parent=%s", email)
    frappe.db.sql("delete from `tabNotification Settings` where name=%s", email)
    frappe.db.sql("delete from `tabDefaultValue` where parent=%s or defkey like %s", (email, f"%{email}%"))
    frappe.db.sql("delete from `tabUser` where name=%s", email)


# =========================================================================== helpers
class _bulk_accounts:
    """Dozens of accounts in a minute is a bulk load, which Frappe only allows as an import.

    Only the account itself is made under the flag: an import also skips filling in field
    defaults, which every other record here depends on.
    """

    def __enter__(self):
        self.before = frappe.flags.in_import
        frappe.flags.in_import = True

    def __exit__(self, *exc):
        frappe.flags.in_import = self.before


def _protected_staff():
    """Accounts on the staff domain that a person made by hand, which a purge never touches."""
    return {"brenda.nkeng@nexgen-solutions.example"}


def _customer_name(row):
    return row[0]


def _existing_customer(row):
    return frappe.db.get_value("Customer", {"customer_name": row[0]}, "name")


def _password(email):
    """A known password, and the account switched on: a new account waits for its invitation."""
    from frappe.utils.password import update_password

    update_password(email, PASSWORD)
    frappe.db.set_value("User", email, "enabled", 1)


def _backdate(doctype, name, when):
    when = frappe.utils.get_datetime(when)
    values = {"creation": when, "modified": when}
    if doctype == "MSP Request" and frappe.db.get_value(doctype, name, "submitted_on"):
        values["submitted_on"] = when
    if doctype == "MSP Billing Run":
        values["cutoff_datetime"] = when
        if frappe.db.get_value(doctype, name, "approved_at"):
            values["approved_at"] = frappe.utils.add_to_date(when, hours=3)
    frappe.db.set_value(doctype, name, values, update_modified=False)


def _slug(value):
    plain = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return "".join(ch for ch in plain.lower() if ch.isalnum())


def _phone(rng):
    return f"+237 6{rng.choice('5789')}{rng.randint(0, 9)} {rng.randint(10, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)}"


def _region(city):
    return {
        "Douala": "Littoral", "Edéa": "Littoral", "Yaoundé": "Centre", "Bamenda": "North-West",
        "Limbe": "South-West", "Buea": "South-West", "Tiko": "South-West", "Kribi": "South",
        "Garoua": "North", "Bertoua": "East", "Bafoussam": "West", "Ngaoundéré": "Adamawa",
    }.get(city)


def _serial(rng, manufacturer):
    alnum = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"
    pick = lambda n: "".join(rng.choice(alnum) for _ in range(n))  # noqa: E731
    return {
        "Dell": pick(7),
        "HP": f"5CG{rng.randint(2000, 3999)}{pick(4)}",
        "HPE": f"CZ{rng.randint(20, 29)}{pick(6)}",
        "Lenovo": f"PF{pick(6)}",
        "Apple": f"C02{pick(9)}",
        "Samsung": f"R58{pick(8)}",
        "Tecno": f"TC{rng.randint(10**11, 10**12 - 1)}",
        "Fortinet": f"FGT60F{pick(8)}",
        "Sophos": f"X21{pick(10)}",
    }.get(manufacturer, pick(10))


def _interfaces(rng, manufacturer, device_type):
    oui = OUIS.get(manufacturer, "00:1A:2B")

    def mac():
        return oui + "".join(f":{rng.randint(0, 255):02X}" for _ in range(3))

    def ip():
        return f"192.168.{rng.randint(1, 20)}.{rng.randint(10, 250)}"

    if device_type in ("Phone", "Mac"):
        return [{"interface_type": "Wi-Fi", "mac_address": mac(), "ip_address": ip(), "is_primary": 1}]
    if device_type == "Laptop":
        return [
            {"interface_type": "Wi-Fi", "mac_address": mac(), "ip_address": ip(), "is_primary": 1},
            {"interface_type": "Ethernet", "mac_address": mac(), "ip_address": None, "is_primary": 0},
        ]
    if device_type in ("Server", "Firewall"):
        return [
            {"interface_type": "Ethernet", "mac_address": mac(), "ip_address": f"10.0.0.{rng.randint(1, 30)}", "is_primary": 1},
            {"interface_type": "Ethernet", "mac_address": mac(), "ip_address": None, "is_primary": 0},
        ]
    return [{"interface_type": "Ethernet", "mac_address": mac(), "ip_address": ip(), "is_primary": 1}]


def _counts():
    doctypes = (
        "Customer", "MSP Contract", "MSP Client User", "MSP Managed Device", "MSP Service Assignment",
        "MSP Request", "MSP Work Order", "MSP Billing Run", "Sales Invoice", "MSP Integration Event", "User",
    )
    return {doctype: frappe.db.count(doctype) for doctype in doctypes}


def _log(message):
    print(f"[{frappe.utils.now_datetime().strftime('%H:%M:%S')}] {message}", flush=True)
