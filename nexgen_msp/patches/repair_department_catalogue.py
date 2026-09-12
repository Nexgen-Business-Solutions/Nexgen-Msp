"""Re-run the corrected catalogue migration on sites that already applied Phase 2.5."""

from nexgen_msp.patches.build_department_catalogue import execute as rebuild_catalogue


def execute():
	return rebuild_catalogue()
