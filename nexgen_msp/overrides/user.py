from frappe.core.doctype.user.user import User

from nexgen_msp.utils import notifications, permissions


class MSPUser(User):
    def password_reset_mail(self, link):
        """Frappe's plain reset mail, replaced by our branded one.

        A customer resets their password on the portal address, the staff on the internal
        one. Which is which is read off the roles, not the account type: our technicians are
        Website Users too — that is how they are kept out of the desk — and their link must
        not be moved onto the customer's address.
        """
        if permissions.is_customer_contact(self.name):
            link = notifications.on_portal_host(link)

        notifications.send(
            "MSP Password Reset",
            [self.name],
            {"full_name": self.full_name or self.name, "link": link},
            reference_doctype="User",
            reference_name=self.name,
            now=True,
        )
