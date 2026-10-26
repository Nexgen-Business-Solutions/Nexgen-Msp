import frappe

from nexgen_msp.utils.mac_address import canonical_or_none

DOCTYPE = "MSP Network Interface"


def execute():
	"""Write every interface already on file the one way Parallels RAS reads it.

	Issue #22. The rule is now decided in one place for everything that saves a MAC, but
	the rows saved before it was are still punctuated however they arrived. This rewrites
	the ones there is no doubt about, and touches nothing else:

	- a row whose value is not a MAC at all is left exactly as it is and reported, because
	  a value nobody can read is a question for a person, not something to overwrite;
	- two rows of the same machine that would become the same address are both left alone
	  and reported, since choosing which one to drop is not a migration's decision;
	- only `mac_address` is written. The row keeps its name, its parent, its position, its
	  interface type, its IP and its primary flag.

	Run twice it changes nothing the second time: canonical values are already canonical.
	"""
	report = inventory()

	for row in report["canonical"]:
		frappe.db.set_value(DOCTYPE, row["row"], "mac_address", row["after"], update_modified=False)

	frappe.db.commit()

	say(report)


def inventory():
	"""What the migration would do, read-only: nothing here writes anything.

	Called on its own — `bench execute nexgen_msp.patches.normalize_managed_device_macs.say`
	— it is the dry run the deployment asks for before the backfill is let near real data.
	"""
	rows = frappe.db.sql(
		"""
		select name as row, parent, idx, mac_address
		from `tabMSP Network Interface`
		order by parent, idx
		""",
		as_dict=True,
	)

	already, canonical, invalid = [], [], []
	seen = {}
	collisions = []

	for row in rows:
		written = row.mac_address or ""
		after = canonical_or_none(written)

		if not after:
			invalid.append({"row": row.row, "parent": row.parent, "idx": row.idx, "before": written})
			continue

		key = (row.parent, after)

		if key in seen:
			collisions.append(
				{
					"row": row.row,
					"parent": row.parent,
					"idx": row.idx,
					"before": written,
					"after": after,
					"same_as": seen[key],
				}
			)
			continue

		seen[key] = row.row

		if written == after:
			already.append({"row": row.row, "parent": row.parent, "before": written})
			continue

		canonical.append(
			{"row": row.row, "parent": row.parent, "idx": row.idx, "before": written, "after": after}
		)

	# a row that would collide is not rewritten, so neither is the row it would collide with
	colliding = {entry["same_as"] for entry in collisions}
	held = [entry for entry in canonical if entry["row"] in colliding]
	canonical = [entry for entry in canonical if entry["row"] not in colliding]

	return {
		"interfaces": len(rows),
		"already": already,
		"canonical": canonical,
		"invalid": invalid,
		"collisions": collisions,
		"held_back": held,
	}


def say(report=None):
	"""The before/after the deployment has to read, without touching anything."""
	report = report or inventory()

	frappe.msgprint(
		f"{report['interfaces']} interface(s): {len(report['already'])} already canonical, "
		f"{len(report['canonical'])} rewritten, {len(report['invalid'])} invalid, "
		f"{len(report['collisions'])} collision(s), {len(report['held_back'])} held back."
	)

	for entry in report["canonical"]:
		print(f"  {entry['parent']} #{entry['idx']}: {entry['before']} -> {entry['after']}")

	for entry in report["invalid"]:
		print(f"  INVALID {entry['parent']} #{entry['idx']}: {entry['before']!r} left as it is")

	for entry in report["collisions"]:
		print(
			f"  COLLISION {entry['parent']} #{entry['idx']}: {entry['before']} would become "
			f"{entry['after']}, already on row {entry['same_as']} — both left as they are"
		)

	return report
