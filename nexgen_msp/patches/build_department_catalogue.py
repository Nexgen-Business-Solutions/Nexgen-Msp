"""Turn every department a customer once typed by hand into one global catalogue.

Before this phase, "department" was free text entered independently per customer:
"Customer A / Accounting", "Customer B / Accounting", "Customer C / Accounting" were three
unrelated strings that happened to read the same. This patch reads every distinct value
already on record, collapses the ones that are only case or whitespace apart into a single
canonical `MSP Department`, and rewrites the source records to point at it.

Values that are merely spelled differently — "HR" against "Human Resources" — are a
judgement call this migration will not make for anyone: each becomes its own department, and
the pairing is only reported, so an administrator can consolidate them by hand if that is
really what they are.

Safe to run more than once: a canonical department already on file is reused rather than
recreated, and a source value already spelled canonically is simply left alone.
"""

import re
from collections import defaultdict

import frappe

FIELD = "department"
SOURCES = ("MSP Client User", "MSP Approver")


def execute():
	"""Fail as one unit; the patch runner owns the surrounding transaction."""
	frappe.db.savepoint("department_catalogue")
	try:
		return _migrate()
	except Exception:
		frappe.db.rollback(save_point="department_catalogue")
		raise


def _migrate():
	report = {
		"distinct_values": 0,
		"canonical_departments": 0,
		"created": 0,
		"reused": 0,
		"client_users_rewritten": 0,
		"approvers_rewritten": 0,
		"alias_groups_flagged": 0,
	}

	raw = _collect_raw_values()
	report["distinct_values"] = len(raw)

	groups = _group_case_insensitive(raw)
	canonical_by_key = {}

	for key, variants in groups.items():
		canonical = _choose_canonical(variants)
		existing = _existing_department(key)

		if existing:
			canonical_by_key[key] = existing
			report["reused"] += 1
		else:
			canonical_by_key[key] = _create_department(canonical)
			report["created"] += 1

	report["canonical_departments"] = len(canonical_by_key)

	report["client_users_rewritten"] = _rewrite("MSP Client User", canonical_by_key)
	report["approvers_rewritten"] = _rewrite("MSP Approver", canonical_by_key)

	aliases = _flag_potential_aliases(list(canonical_by_key.values()))
	report["alias_groups_flagged"] = len(aliases)

	print(f"  {report['distinct_values']} distinct department value(s) found on existing records")
	print(f"  {report['canonical_departments']} canonical department(s) now in the catalogue")
	print(f"  {report['created']} newly created, {report['reused']} already on file and reused")
	print(f"  {report['client_users_rewritten']} MSP Client User department value(s) rewritten")
	print(f"  {report['approvers_rewritten']} MSP Approver department value(s) rewritten")
	print(f"  {report['alias_groups_flagged']} potential alias group(s) flagged for manual review")

	return report


# --------------------------------------------------------------- collecting and grouping
def _collect_raw_values():
	"""Every distinct, non-empty department string on file, with how often each is used.

	The count decides which spelling becomes the canonical one when several forms of the
	same word are on record; the most common spelling is the one most people already read.
	"""
	counts = defaultdict(int)

	for doctype in SOURCES:
		for row in frappe.db.sql(
			f"""
			select `{FIELD}` as value, count(*) as cnt
			from `tab{doctype}`
			where `{FIELD}` is not null and trim(`{FIELD}`) != ''
			group by `{FIELD}`
			""",
			as_dict=True,
		):
			counts[row.value] += row.cnt

	return counts


def _normalized(value):
	return " ".join(value.split()).casefold()


def _group_case_insensitive(raw_counts):
	"""Every raw spelling, bucketed with the others that differ only in case or spacing."""
	groups = defaultdict(dict)

	for value, count in raw_counts.items():
		groups[_normalized(value)][value] = count

	return groups


def _choose_canonical(variants):
	"""The spelling most people already used; ties broken alphabetically, for determinism."""
	ordered = sorted(variants.items(), key=lambda pair: (-pair[1], pair[0]))
	return " ".join(ordered[0][0].strip().split())


def _existing_department(normalized_key):
	names = frappe.db.sql_list(
		"""
		select name from `tabMSP Department`
		where lower(trim(department_name)) = %(key)s
		limit 1
		""",
		{"key": normalized_key},
	)

	return names[0] if names else None


def _create_department(canonical_name):
	doc = frappe.get_doc(
		{"doctype": "MSP Department", "department_name": canonical_name, "enabled": 1}
	)

	# Never manufacture a mapping for a record that failed to persist.
	doc.insert(ignore_permissions=True)

	return doc.name


# --------------------------------------------------------------- rewriting the sources
def _rewrite(doctype, canonical_by_key):
	rewritten = 0

	for row in frappe.db.sql(
		f"""
		select name, `{FIELD}` as value from `tab{doctype}`
		where `{FIELD}` is not null and trim(`{FIELD}`) != ''
		""",
		as_dict=True,
	):
		canonical = canonical_by_key.get(_normalized(row.value))

		if not canonical or canonical == row.value:
			continue

		frappe.db.set_value(doctype, row.name, FIELD, canonical, update_modified=False)
		rewritten += 1

	return rewritten


# --------------------------------------------------------------- informational only
def _initials(name):
	"""The first letter of each word, for names made of more than one — an abbreviation
	such as "HR" is only ever a stand-in for several words, never for one."""
	words = [word for word in re.split(r"[^A-Za-z0-9]+", name) if word]

	if len(words) < 2:
		return None

	return "".join(word[0] for word in words).casefold()


def _looks_like_an_alias(a, b):
	"""A cautious, deterministic check — never a fuzzy match, only an initialism either way."""
	na, nb = _normalized(a), _normalized(b)

	if na == nb:
		return False

	initials_a = _initials(a)
	initials_b = _initials(b)

	return (initials_a is not None and initials_a == nb) or (
		initials_b is not None and initials_b == na
	)


def _flag_potential_aliases(canonical_names):
	"""Group names that may be the same department spelled differently, and only report it.

	Nothing is merged here: a real merge is a decision for a person, made once they have
	seen the whole group named plainly.
	"""
	names = sorted(set(canonical_names))
	parent = {name: name for name in names}

	def find(name):
		while parent[name] != name:
			parent[name] = parent[parent[name]]
			name = parent[name]
		return name

	def union(a, b):
		ra, rb = find(a), find(b)
		if ra != rb:
			parent[ra] = rb

	for i, a in enumerate(names):
		for b in names[i + 1 :]:
			if _looks_like_an_alias(a, b):
				union(a, b)

	clusters = defaultdict(list)
	for name in names:
		clusters[find(name)].append(name)

	groups = [sorted(members) for members in clusters.values() if len(members) > 1]

	for group in groups:
		listing = "\n".join(group)
		message = f"Potential department aliases:\n\n{listing}"
		print(f"  {message}")
		frappe.log_error(title="Potential department aliases", message=message)

	return groups
