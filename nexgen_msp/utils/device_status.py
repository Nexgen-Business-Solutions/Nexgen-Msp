"""What each status of a machine means, written once for everything that asks."""

# out in the field, in somebody's hands
DEPLOYED_STATUSES = ("Active",)

# on the shelf at the customer, free to be given to somebody
AVAILABLE_STATUSES = ("Pending", "Stock")

# not in service: nobody holds one of these
UNAVAILABLE_STATUSES = ("Returned", "Damaged", "Retired", "Lost")

# the end of the line
TERMINAL_STATUSES = ("Retired",)

RETIRABLE_FROM = ("Active", "Stock", "Damaged", "Lost")
REINSTATABLE_FROM = ("Retired", "Damaged", "Lost", "Returned")


def is_deployed(status):
	return status in DEPLOYED_STATUSES


def is_out_of_service(status):
	return status in UNAVAILABLE_STATUSES
