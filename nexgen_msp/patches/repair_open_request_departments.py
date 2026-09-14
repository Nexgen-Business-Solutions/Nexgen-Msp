"""Bring open request departments into the catalogue on already-migrated sites."""

from nexgen_msp.patches.build_department_catalogue import execute as rebuild_catalogue


def execute():
	return rebuild_catalogue()
