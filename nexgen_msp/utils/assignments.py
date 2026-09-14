"""What is true of a service assignment across the app, written once."""

# a service that is still on somebody's hands, in whatever stage of its life
OPEN_ASSIGNMENT_STATUSES = ("Pending Setup", "Active", "Suspended", "Pending Removal")

# billing follows the operational life of a service, it never runs a state machine of its own
OPERATIONAL_TO_BILLING = {
    "Draft": "Not Billable",
    "Pending Setup": "Pending",
    "Active": "Billable",
    "Suspended": "On Hold",
    "Pending Removal": "Billable",
    "Ended": "Ended",
    "Cancelled": "Not Billable",
}
