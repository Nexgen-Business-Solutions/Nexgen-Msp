from frappe.core.doctype.user.user import User

from nexgen_msp.utils import notifications


class MSPUser(User):
    def password_reset_mail(self, link):
        """Frappe's plain reset mail, replaced by our branded one.

        A customer resets their password on the portal address, the staff on the internal
        one; the link is moved only for the first.
        """
        if self.user_type == "Website User":
            link = notifications.on_portal_host(link)

        notifications.send(
            "MSP Password Reset",
            [self.name],
            {"full_name": self.full_name or self.name, "link": link},
            reference_doctype="User",
            reference_name=self.name,
            now=True,
        )
