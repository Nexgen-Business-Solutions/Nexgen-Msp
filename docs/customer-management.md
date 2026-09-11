# Customer management

ERPNext `Customer` is the customer master. Billing addresses use ERPNext `Address`, and company contacts use ERPNext `Contact`. No additional customer or access-control DocType is needed.

| Role | Customer visibility | Editing |
| --- | --- | --- |
| MSP System Admin | All customers, including commercial details | Create customers and edit all supported customer fields |
| MSP Technician | Customer directory and operational profiles | Read-only |
| MSP Customer Manager | Only companies linked to the account | Website, address, phone, email, and customer contacts |
| MSP Customer Operator | Only linked company identity in the profile view | No customer master editing |

Admins use **Customers → Add Customer**. Creation redirects to the customer's existing commercial page. Technicians use **Customers** for the directory and read-only profiles. Customer-side roles use **Company profile**; operators see only company identity there. Existing portal requests and other workflows remain available according to their own permissions.

`MSP System Admin` is required for customer creation and administration. A standalone ERPNext `System Manager` role does not grant these rights. Frappe's built-in Administrator has the installed MSP admin role. Customer-side roles take precedence over accidentally added staff roles, except for the built-in Administrator account.

## Server-side enforcement

`utils/customer_access.py` resolves roles and target access from the authenticated session. The persistent login-account relationship is `Contact.user` plus its Customer dynamic link, with a matching `User Permission`. `MSP Client User` represents a managed employee, not necessarily a Frappe login account; email or username matching is not used to grant customer access.

Contact links and User Permissions must agree. A stale permission alone cannot expose another customer. Accounts deliberately linked to multiple companies may select only those companies; when no customer is supplied, the service resolves it only if exactly one company is authorized. Missing or unauthorized targets produce the same authorization error for customer-side accounts, before looking up the target Customer.

Manager Customer edits accept only `website`. Address edits accept `address_line1`, `address_line2`, `city`, `state`, `pincode`, `country`, `phone`, and `email_id`. Contact edits accept `first_name`, `last_name`, `email_id`, and `phone`, plus an existing linked contact identifier when updating. Unknown fields, identity/link changes, commercial fields, and account/role changes are rejected. Contacts are added or updated, not deleted by omission. Primary email and phone are changed without replacing unrelated secondary entries.

Shared addresses and contacts are displayed read-only and rejected on update for Customer Managers, so edits cannot change another company’s contact information. MSP admins can maintain these shared records or arrange an exclusive record. Contact email updates cannot implicitly link an existing User or grant account access; use the existing Accounts workflow for account access.

Customer, address, and contact writes run in one transaction. Failed validation rolls back all changes. ERPNext still validates its required fields, links, and customer type. The guarded service uses `ignore_permissions=True` for document saves because ERPNext's standard DocTypes do not natively grant the application roles these operations. This does not bypass the service's role, customer, or field checks.

## API and UI

The existing internal v1 API provides `create_customer`, `get_customer_details`, `save_customer_details`, and `get_customer_options`. `list_customers` provides the operational directory for internal customer roles. Creation and saving accept POST only. Detail responses are projected by role: commercial fields are returned only to MSP admins, while operators receive only `name` and `customer_name`.

The shared `CustomerModal` supports creation, administrative editing, and restricted manager editing. The session returns `customer_profile_role` so routes/actions can reflect backend authorization. Frontend controls supplement the backend checks.

Old `Customer Portal Manager` and `MSP Customer Portal Manager` strings remain only in historical rename patches. Those source names must remain so upgrades can migrate old installations.

## Verification and deployment

From the frontend directory:

```sh
npm test
npx tsc -b
npm run build
```

The customer backend tests can run against an existing ERPNext site from the bench `sites` directory:

```sh
../env/bin/python -m nexgen_msp.tests.run_customer_tests SITE_NAME
```

The integration fixtures create temporary records, suppress commits, and roll back after each test. The tests cover all four MSP roles, mixed roles, customer isolation, allowed and forbidden fields, contacts and shared records, invalid ERPNext options, duplicate creation, and transaction rollback.

Deploy backend code and rebuild frontend assets through the normal deployment workflow. No schema migration or role fixture changes are introduced by this feature. Refresh the session after deploying so the frontend receives the new role capability.
