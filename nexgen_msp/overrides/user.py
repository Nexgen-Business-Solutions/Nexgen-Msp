from frappe.core.doctype.user.user import User

from nexgen_msp.utils import notifications


class MSPUser(User):
    def password_reset_mail(self, link):
        """Frappe's plain reset mail, replaced by our branded one."""
        notifications.send(
            "MSP Password Reset",
            [self.name],
            {"full_name": self.full_name or self.name, "link": link},
            reference_doctype="User",
            reference_name=self.name,
            now=True,
        )
