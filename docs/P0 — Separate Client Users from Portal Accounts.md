## Objective

Correct the conflation between `MSP Client User` and authenticated portal access.

### Core invariant

```text
MSP Client User != Frappe User
```

A Client User represents a managed person.

A Portal Account represents an authenticated application account.

Creating or importing a Client User MUST NOT grant portal access.

---

## Remove the incorrect semantics

Stop using:

```text
MSP Client User.portal_visible
```

as an indication of portal access.

Do not expose:

```text
portal_access = bool(portal_visible)
```

from User 360.

Remove unconditional:

```python
"portal_visible": 1
```

from:

- `UserService.create_client_user()`
- Excel import
- load/test fixtures where inappropriate.

Evaluate migration/removal of the `portal_visible` field.

If retained temporarily for backward compatibility, mark it deprecated and do not use it for authorization or account-status display.

---

## Add explicit account relationship

Add:

```text
MSP Client User.portal_user
Link → User
Optional
Read Only through normal user editing
```

A null value means:

```text
No linked portal account.
```

The linked User must be verified by the account/access service.

Never infer the relation from matching email addresses.

---

## Portal provisioning

Implement a dedicated domain operation such as:

```text
PortalAccountService.grant_access(client_user, role)
PortalAccountService.revoke_access(client_user)
```

or reuse/refactor the existing Team/Accounts domain.

Grant access must:

1. validate the Client User;
2. require a valid email;
3. create or explicitly link the Frappe User;
4. create/ensure the Contact;
5. link Contact → Customer;
6. create/ensure Customer User Permission;
7. assign an allowed customer role;
8. preserve mixed-role fail-closed rules;
9. set `MSP Client User.portal_user`;
10. optionally send the invitation.

Do not authorize by email equality.

---

## Request Workbench

When:

```text
needs_portal_access = 1
```

the Workbench must actually expose and complete a Portal Access work step.

Creating the `MSP Client User` alone is NOT enough.

The workflow must clearly show:

```text
User Setup       ✓
Portal Access    Pending / ✓
```

or equivalent embedded sections.

Request completion must not claim Portal Access was delivered if provisioning was requested but never completed.

---

## User 360

Replace the misleading boolean display with real account state.

Examples:

```text
PORTAL ACCESS

No portal account
[ Grant access ]
```

or:

```text
PORTAL ACCESS

john@acme.com
Customer Operator
Enabled
[ Manage access ]
```

The state must come from the linked `User` and access policy.

---

## Excel import

Employee import must create only:

```text
MSP Client User
```

It must never create:

```text
Frappe User
Contact/User Permission
portal role
invitation
```

unless a separate explicit account-import workflow is designed later.

---

## Tests

Mandatory:

```text
creating Client User does not create User

importing 500 Client Users creates 0 portal accounts

Client User with email does not automatically receive access

grant_access creates/links exactly one User

grant_access creates Customer Contact relationship

grant_access creates matching User Permission

grant_access assigns correct Customer role

grant_access refuses missing email

grant_access refuses cross-customer relationship

grant_access cannot create mixed customer/internal role

revoke_access does not delete Client User

revoke_access does not alter services/devices

needs_portal_access request cannot complete portal-delivery step until account exists

User 360 shows no access when portal_user is NULL

User 360 shows actual role/enabled status when portal_user exists
```

## Definition of Done

A Customer with:

```text
500 MSP Client Users
```

can have:

```text
3 portal accounts
```

without the other 497 receiving credentials, roles, permissions, invitations, or being displayed as having portal access.