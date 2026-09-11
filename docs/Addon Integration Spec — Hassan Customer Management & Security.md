# Addon Integration Spec

## Hassan Customer Management & Security

## 1. Objectif

Intégrer sélectivement les apports pertinents de :

```text
Nexgen-Msp-hassan-addons
```

dans l'architecture définie par nos Phases 1–7.

Cette tâche n'est **pas** :

```text
merge addon branch
resolve conflicts
ship
```

Elle est :

```text
inspect addon intent
        ↓
map to our architecture
        ↓
reuse good implementation/tests
        ↓
rewrite conflicting pieces
        ↓
discard regressions
```

---

# 2. Priorité des spécifications

En cas de conflit :

```text
OUR VALIDATED SPECS
        >
ADDON IMPLEMENTATION
```

L'addon peut améliorer nos specs.

Il ne peut pas réintroduire une architecture que nous avons volontairement supprimée.

Exemples :

```text
Addon:
Request asks customer to navigate/select devices globally

Our Phase 3:
contextual current devices / unresolved device requirement

→ Phase 3 wins
```

```text
Addon:
Customer uses ERPNext Customer master

Our roadmap:
Customer management not yet deeply specified

→ addon improves roadmap
```

---

# 3. Classification générale

Les changements Hassan sont répartis en quatre catégories.

## ADOPT

Réutilisable conceptuellement et largement techniquement.

## ADAPT

Bonne fonctionnalité mais implémentation à remapper sur nos specs.

## COVERED

Besoin déjà mieux traité dans nos Phases existantes.

## REJECT

Ne doit pas entrer dans le produit.

---

# 4. Classification

| Fonctionnalité | Décision | Destination |
|---|---|---|
| ERPNext Customer comme master | ADOPT | Phase 5B |
| ERPNext Address / Contact | ADOPT | Phase 5B |
| Add Customer depuis MSP | ADOPT | Phase 5B |
| Customer Directory | ADAPT | Phase 5B |
| Customer Profile | ADAPT | Phase 5B |
| Company Profile client | ADOPT | Phase 5B |
| Contact + User Permission security | ADOPT | Security transverse |
| Multi-company login support | ADOPT | Security transverse |
| Mixed-role fail-closed | ADOPT | Security transverse |
| Shared Contact/Address protection | ADOPT | Phase 5B |
| Contact email privilege-escalation protection | ADOPT | Security transverse |
| Customer transaction atomicity | ADOPT | Phase 5B |
| MSP System Admin commercial boundary | ADAPT | Permission model |
| Customer-side Device selection changes | COVERED / REWRITE | Phase 3 |
| `service_scope` UI cleanup | COVERED | Phase 2/3 |
| Session timeout refresh removal | REJECT | Security |
| `allowedHosts = msp.local.com` | REJECT | Local environment |
| Customer/security tests | ADOPT | QA suite |

---

# 5. Nouveau complément roadmap : Phase 5B

Ajouter officiellement :

```text
PHASE 5B
Customer 360 & Customer Access
```

Elle se situe conceptuellement entre :

```text
Phase 5 — User 360
Phase 6 — Settings
```

Même si l'implémentation réelle peut être ordonnancée selon les dépendances.

---

# 6. Customer master

Ne créer aucun :

```text
MSP Customer
Nexgen Customer
Customer Access DocType
```

La source de vérité reste :

```text
ERPNext Customer
```

Avec :

```text
Customer
├── Dynamic Links → Address
└── Dynamic Links → Contact
```

C'est une décision architecturale définitive.

---

# 7. Pourquoi

Nous avons déjà dans ERPNext :

```text
identity
territory
customer group
currency
price list
payment terms
addresses
contacts
tax information
accounting integration
```

Les répliquer créerait immédiatement :

```text
synchronization problems
duplicate identity
billing inconsistencies
ERPNext incompatibilities
```

---

# 8. Customer 360

Créer une vue unifiée :

```text
/customers/:customer
```

Elle devient :

```text
CUSTOMER 360
```

et non une page complètement différente selon le rôle.

---

# 9. Structure Customer 360

Exemple :

```text
ACME CORPORATION

Company
Contacts
Address

OPERATIONS

126 Users
83 Devices
4 Open Requests
2 Billing issues

Recent activity


COMMERCIAL
[visible according to capability]

Contract
Coverage
Pricing
Billing readiness
```

---

# 10. Rendu selon capacités

La page est unique.

Les sections changent.

### MSP System Admin

Voit :

```text
identity
contacts
address
operations
contracts
pricing
billing
commercial configuration
```

### MSP Technician

Voit :

```text
identity
contacts
address
operational summaries
users/devices/requests
```

Read-only Customer master.

### MSP Customer Manager

Voit uniquement ses Customers autorisés.

Peut modifier :

```text
website
allowed contact information
allowed address information
```

### MSP Customer Operator

Voit uniquement l'identité autorisée.

Read-only.

---

# 11. Ne pas garder deux significations pour `/customers/:id`

L'addon fait actuellement conceptuellement :

```text
Admin
/customers/ACME
→ Commercial page

Technician
/customers/ACME
→ Operational profile
```

Ne pas conserver.

Utiliser :

```text
same entity
same route
same page architecture
capability-based sections
```

Cela améliore la cohérence navigationnelle.

---

# 12. Customer creation

Conserver :

```text
Customers
→ Add Customer
```

Réservé à :

```text
MSP System Admin
```

et au builtin `Administrator`.

Pas simplement :

```text
System Manager
```

---

# 13. Customer Creation

L'action crée directement :

```text
ERPNext Customer
```

en laissant ERPNext exécuter ses validations normales.

Aucun shadow record.

---

# 14. Après création

Je modifierais légèrement le comportement Hassan.

Au lieu d'envoyer exclusivement vers une page :

```text
Contracts & pricing
```

rediriger vers :

```text
Customer 360
```

qui présente ensuite :

```text
Complete profile
Add contacts
Add contract
Configure services
```

selon le besoin.

---

# 15. Customer Access — principe

L'autorisation d'un compte Customer ne doit jamais être déduite depuis :

```text
email string
username string
MSP Client User email
MSP Client User.username
```

Un `MSP Client User` représente un employé géré.

Ce n'est pas automatiquement un compte Frappe.

---

# 16. Déclaration de relation de compte

La relation authentifiée utilise :

```text
Frappe User
    ↓
Contact.user
    ↓
Contact Dynamic Link
    ↓
Customer
```

C'est la déclaration de relation.

---

# 17. User Permission comme deuxième preuve

Cette relation doit également être autorisée par :

```text
User Permission
allow = Customer
for_value = ACME
```

La liste finale devient :

```text
customers_from_contacts(user)
INTERSECTION
customers_from_user_permissions(user)
```

et non UNION.

---

# 18. Pourquoi Intersection

Exemple :

Contact :

```text
John → ACME
```

mais ancienne permission :

```text
John → BETA
```

Résultat :

```text
ACME only if matching permission exists
BETA denied
```

Une User Permission stale ne peut pas élargir les accès.

---

# 19. Multi-company

Un même compte peut légitimement être lié à :

```text
ACME
BETA
```

si les deux relations Contact et User Permission existent.

Il peut alors sélectionner :

```text
ACME
or
BETA
```

mais rien d'autre.

---

# 20. Customer implicite

Si un utilisateur possède exactement :

```text
1 authorized Customer
```

le backend peut le résoudre automatiquement.

Si :

```text
> 1 Customer
```

le Customer cible doit être explicitement fourni par le workflow.

Ne jamais choisir arbitrairement le premier.

---

# 21. Authorization failure

Pour un Customer-side account, ces cas :

```text
Customer does not exist
Customer exists but unauthorized
```

doivent retourner la même famille d'erreur d'accès.

Ne pas révéler l'existence de Customers non autorisés.

---

# 22. Mixed-role protection

Cas dangereux :

```text
John

MSP Customer Manager
+
MSP System Admin
```

Un rôle staff ajouté accidentellement ne doit pas transformer John en utilisateur global.

---

# 23. Résolution de rôle fail-closed

Pour les utilisateurs normaux :

```text
Customer Operator
        ↓ precedence

Customer Manager
        ↓

persistent customer-linked account
        ↓ cannot silently become staff-global

MSP System Admin / Technician
```

Le builtin :

```text
Administrator
```

reste l'exception contrôlée.

---

# 24. Ne pas disséminer cette logique

Ne pas recopier :

```python
if "MSP Customer Manager" in roles:
```

dans :

```text
CustomerService
ContractService
RequestService
BillingService
PortalService
```

Créer une politique centrale.

---

# 25. Capability model

Étendre/refactorer les helpers permissions pour exprimer :

```python
can_view_all_customers()
can_create_customer()
can_edit_customer_commercial()
can_edit_customer_profile()
can_view_customer_operations()
can_manage_contracts()
can_manage_pricing()
can_execute_requests()
can_manage_settings()
```

Les services interrogent des capabilities.

Ils ne définissent pas eux-mêmes leur notion d'Admin.

---

# 26. Rôle System Manager

Décision :

```text
System Manager
```

est un rôle d'administration Frappe.

Il ne doit pas automatiquement signifier :

```text
MSP Commercial Administrator
```

Les fonctions commerciales nécessitent :

```text
MSP System Admin
```

ou Administrator.

---

# 27. Harmonisation nécessaire

Rechercher dans le projet :

```text
ADMIN_ROLES
System Manager
MSP System Admin
Administrator
```

et classifier chaque opération.

Exemples :

### Frappe/system operation

System Manager peut être valide.

### Customer commercial operation

MSP System Admin.

### Technician execution

MSP Technician / appropriate operational capability.

### Customer self-service

Customer Manager/Operator selon permission.

---

# 28. Customer Manager — champs autorisés

Conserver la philosophie Hassan.

Customer master :

```text
website
```

modifiable.

Pas :

```text
customer_name
customer_group
territory
currency
price_list
payment_terms
commercial configuration
```

---

# 29. Address manager

Autoriser :

```text
address_line1
address_line2
city
state
pincode
country
phone
email_id
```

selon validations ERPNext.

---

# 30. Contact manager

Autoriser :

```text
first_name
last_name
email_id
phone
```

et un identifiant d'un Contact déjà autorisé pour Update.

---

# 31. Unknown fields

Payload :

```json
{
  "currency": "USD"
}
```

depuis Customer Manager :

```text
REJECT
```

Ne pas simplement ignorer silencieusement les propriétés inconnues.

---

# 32. Shared Address

Un Address lié à :

```text
ACME
BETA
```

ne peut pas être modifié par Customer Manager ACME.

Pourquoi :

```text
his update would mutate BETA
```

Afficher :

```text
Shared address
Read-only

Contact your service provider to update this shared record.
```

---

# 33. Shared Contact

Même règle.

Un Contact partagé entre plusieurs Customers :

```text
Customer Manager
→ read-only
```

`MSP System Admin` peut le maintenir.

---

# 34. Contact email ≠ account access

Changer :

```text
Contact.email_id
```

ne doit jamais implicitement :

```text
link existing Frappe User
assign Customer permission
grant portal access
change roles
```

Le workflow Accounts existant reste responsable de l'accès utilisateur.

---

# 35. Atomic Customer save

Une sauvegarde Customer comprenant :

```text
website
address
contact
```

doit être une transaction métier.

Si Contact échoue :

```text
Customer change rollback
Address change rollback
Contact change rollback
```

Pas de profil partiellement enregistré.

---

# 36. ERPNext validations restent actives

L'utilisation interne éventuelle de :

```python
ignore_permissions=True
```

doit uniquement contourner l'absence de permissions DocType native pour nos rôles applicatifs.

Elle ne doit jamais contourner :

```text
our access policy
field whitelist
Customer relationship validation
ERPNext data validation
```

---

# 37. Customer APIs

Conserver/adopter conceptuellement :

```text
create_customer
get_customer_details
save_customer_details
get_customer_options
list_customers
```

Mais les réponses deviennent basées sur capabilities.

---

# 38. DTO selon capability

### Admin

Peut recevoir :

```text
commercial fields
billing configuration context
contract context
```

### Technician

Ne reçoit pas inutilement :

```text
commercial-sensitive editable fields
```

### Operator

Réponse minimale :

```text
name
customer_name
```

plus données explicitement prévues.

La sécurité doit exister backend, pas uniquement par masquage React.

---

# 39. Customer Directory

Conserver l'idée.

Pour Technician :

```text
CUSTOMERS

ACME
126 users
83 devices
4 open requests

BETA
84 users
51 devices
1 open request
```

Lecture opérationnelle.

---

# 40. Customer list pour Admin

Peut inclure en plus :

```text
contract state
billing readiness
commercial status
```

selon nos futures décisions UX.

---

# 41. Company Profile côté Customer

Conserver.

Navigation portail :

```text
Company Profile
```

Pour Customer Manager :

```text
Company identity
Website
Addresses
Contacts
```

avec capacités d'édition limitées.

Pour Operator :

```text
Company identity
```

read-only.

---

# 42. Relation avec Phase 5 User 360

Ne pas confondre :

```text
Customer 360
```

avec :

```text
MSP Client User 360
```

Hiérarchie :

```text
CUSTOMER
├── Client Users
├── Devices
├── Requests
├── Contracts
└── Billing

CLIENT USER
├── Personal Services
├── Current Devices
├── Open Requests
└── History
```

---

# 43. Relation avec Phase 3 Requests

Ne pas merger directement les changements Request de l'addon.

Nos règles Phase 3 restent définitives.

---

# 44. Existing User + Device

Si le User possède exactement un Device pertinent :

```text
show directly
```

Ne pas demander un choix inutile.

---

# 45. Plusieurs Devices

Afficher uniquement :

```text
devices currently held by the selected user
```

avec :

```text
hostname
serial
device type
```

Le Customer ne navigue pas dans tout le parc.

---

# 46. Aucun Device

Pour un Device-scoped service :

```text
target_scope = Device
managed_device = NULL
is_new_device = 1
device_requirement_key = ...
```

Cela signifie :

> Device target required but not yet resolved.

---

# 47. Ne pas reprendre la transformation addon

Ne pas appliquer :

```text
is_new_device
→ target_scope = User
```

C'est conceptuellement faux.

Le service reste Device-scoped.

La cible Device sera résolue par Phase 4.

---

# 48. Phase 4 résout le besoin

Request Workbench :

```text
DEVICE REQUIRED

[ Use stock device ]
[ Register new device ]
```

puis propage :

```text
managed_device
```

sur les Request Lines concernées.

---

# 49. Service Scope cleanup

La simplification Hassan qui évite de transporter inutilement :

```text
service_scope
```

dans certains écrans Request est compatible avec nos specs.

Règle :

```text
Item.msp_service_scope
→ catalogue capability

RequestLine.target_scope
→ actual target
```

Les écrans de détail Request utilisent prioritairement :

```text
target_scope
```

---

# 50. Relation avec Phase 7 Billing

Ajouter à notre Billing Integrity spec le contexte Customer historique.

Billing Run approuvée doit également snapshotter ce qui est nécessaire de :

```text
Customer
Address
Contact
```

---

# 51. Snapshots Customer minimum

Selon les besoins Invoice :

```text
customer_name_snapshot
tax_id_snapshot
billing_address_snapshot
billing_contact_snapshot
```

Éviter un snapshot de 50 champs inutiles.

Snapshotter uniquement ce qui doit rester historiquement stable.

---

# 52. Customer profile update et Billing

Exemple :

```text
August Run approved

Billing address:
10 Old Street
```

Septembre :

```text
Customer Manager changes address:
40 New Street
```

August Run reste :

```text
10 Old Street
```

---

# 53. Invoice Draft

Une décision explicite est nécessaire.

Je recommande :

### Avant Invoice Draft creation

Utiliser le Customer/Billing context défini par la Run ou rafraîchissable avant freeze selon notre exact workflow.

### Après Invoice Draft creation

Ne jamais réécrire automatiquement l'Invoice à cause d'une modification Customer Profile.

Toute modification devient une action Invoice explicite.

---

# 54. Pas d'effet caché Customer → Invoice

Ne pas conserver une logique :

```text
save customer address
→ rewrite every draft Sales Invoice automatically
```

si elle contourne le Billing Workbench.

Le Billing Workbench doit contrôler les données financières.

---

# 55. Session timeout — REJECT

L'addon ne contient plus le mécanisme :

```text
refresh_live_sessions()
```

qui répercute les nouveaux timeouts sur les sessions déjà ouvertes.

Ne pas reprendre cette suppression.

---

# 56. Règle Session

Quand un administrateur modifie :

```text
portal session timeout
```

la politique doit s'appliquer selon la sécurité définie par le produit, y compris aux sessions live si c'est le comportement existant.

Ne pas assouplir implicitement la politique en mergeant l'addon.

---

# 57. Ajouter un test de sécurité

```text
Open session with timeout = 60 min

Admin changes timeout = 15 min

Existing session receives new policy
```

selon la sémantique actuelle attendue.

---

# 58. Vite allowedHosts — REJECT

Ne pas merger :

```typescript
allowedHosts: ['msp.local.com']
```

comme configuration produit.

Les hosts de développement appartiennent à :

```text
local environment
.env
deployment configuration
```

pas au repo produit sauf stratégie générique.

---

# 59. Tests Hassan — ADOPT

Importer/adapter les scénarios de :

```text
test_customer_creation.py
test_customer_profile.py
customerAccess.test.ts
CustomerModal.test.tsx
navigation.test.ts
```

et autres tests pertinents.

---

# 60. Scénarios sécurité obligatoires

Conserver notamment :

```text
Admin can create Customer

Technician cannot create Customer

Technician can inspect operational profile

Manager sees only authorized Customer

Operator sees only authorized identity

Manager cannot change commercial fields

Manager cannot change roles/accounts

Customer A cannot access Customer B

stale User Permission cannot grant access

Contact relationship without permission insufficient

Permission without Contact relationship insufficient

multi-customer account supports only intersection

mixed customer/staff role fails closed

shared Address cannot be edited by Manager

shared Contact cannot be edited by Manager

Contact email cannot escalate privileges

failed compound update rolls back

duplicate Customer follows ERPNext validation
```

---

# 61. Tests de non-régression avec nos Phases

Ajouter également :

```text
Customer changes do not bypass Department validation

Customer Manager cannot directly modify Client User lifecycle through profile

Customer profile cannot execute ServiceLifecycle

Customer profile cannot execute DeviceLifecycle

Customer profile cannot resolve Requests

Request Device selection follows Phase 3, not addon legacy flow

Billing snapshot survives Customer address change
```

---

# 62. Fichiers addon à traiter avec prudence

Ne pas copier aveuglément :

```text
RequestDetail.tsx
NewServiceRequest.tsx
useServiceRequestForm.ts
portal_service.py Request changes
vite.config.ts
session settings changes
```

Ces zones entrent directement en conflit potentiel avec nos travaux.

---

# 63. Fichiers à utiliser comme référence forte

Particulièrement :

```text
docs/customer-management.md
utils/customer_access.py
customer_service.py
CustomerModal.tsx
CustomerDirectory.tsx
CustomerProfile.tsx
customer access tests
customer creation/profile tests
```

Même eux doivent être adaptés au capability model final.

---

# 64. Pas de cherry-pick de gros commits fonctionnels

Stratégie d'intégration recommandée :

```text
do not:
git merge addon

do not:
copy entire frontend/src

do:

port feature by feature
```

Chaque Task Codex reçoit :

```text
base project current state
validated spec
addon files as reference
explicit allowed scope
```

---

# 65. Ordre d'intégration

## ADDON-1 — Access Policy Foundation

D'abord :

```text
customer access resolution
mixed role policy
contact + permission intersection
capability model
security tests
```

Aucune UI.

---

## ADDON-2 — Customer Service

Ensuite :

```text
create_customer
get_customer_details
save_customer_details
list_customers
get_customer_options

field whitelist
shared records
atomicity
```

---

## ADDON-3 — Customer 360 UI

Ensuite :

```text
Customer Directory
Customer 360
Company Profile
Customer modal/editing
role-sensitive sections
```

---

## ADDON-4 — Cross-spec adaptations

Ensuite :

```text
Request compatibility review
Billing customer snapshots
session timeout non-regression
navigation cleanup
```

---

## ADDON-5 — Regression Suite

Enfin :

```text
customer security
requests
billing
sessions
navigation
```

---

# 66. ADDON-1 — Codex instruction

### Customer Access Foundation

Agent :

```text
Senior Frappe Security Engineer
```

Reasoning :

```text
High
```

Task :

```text
Study Hassan:
utils/customer_access.py
related permission tests

Implement a centralized Customer access/capability layer.

Use:
Contact.user + Customer Dynamic Link
INTERSECTION
User Permission(Customer)

Support legitimate multi-company accounts.

Implement fail-closed role precedence.

Administrator exception explicit.

Do not modify Requests, Billing or React.

Replace duplicated customer-role checks only where safe.

Add all security tests before moving on.
```

---

# 67. ADDON-2 — Codex instruction

### Customer Management Domain

Agent :

```text
Senior Frappe / ERPNext Backend Engineer
```

Reasoning :

```text
High
```

Task :

```text
Use ERPNext Customer as sole Customer master.

Use ERPNext Address and Contact.

Port/adapt Hassan CustomerService.

Implement:
create
read projection
restricted profile save
directory

Preserve ERPNext validation.

Protect shared Address/Contact.

Prevent contact email account escalation.

Transactionally save Customer+Address+Contact.

Do not create new Customer DocType.

Do not touch Requests/Billing.
```

---

# 68. ADDON-3 — Codex instruction

### Customer 360

Agent :

```text
Senior React + Frappe Full-stack
```

Reasoning :

```text
High
```

Task :

```text
Create one Customer 360 route.

Do not route admins and technicians to unrelated page architectures.

Render sections based on backend capabilities.

Support:
Admin
Technician
Customer Manager
Customer Operator

Reuse useful Hassan components where appropriate.

Do not expose commercial data merely by hiding buttons.

Backend projections remain authoritative.
```

---

# 69. ADDON-4A — Phase 3 adaptation

Instruction :

```text
Review Hassan Request changes.

Do NOT port global Customer device picker.

Do NOT set target_scope=User for unresolved Device service.

Preserve our Phase 3:
contextual user devices
target_scope Device
device requirement unresolved
device_requirement_key
technician resolution in Phase 4.

Port only compatible cleanup/tests.
```

---

# 70. ADDON-4B — Phase 7 adaptation

Instruction :

```text
Extend Billing Run historical snapshot to Customer billing identity.

Ensure Customer/Address changes after approval cannot rewrite historical Billing Run.

No automatic hidden mutation of generated Invoice from Customer Profile.

Add regression tests.
```

---

# 71. ADDON-4C — Session adaptation

Instruction :

```text
Do not port Hassan removal of live-session timeout refresh.

Preserve existing security semantics.

Add test before touching session code.
```

---

# 72. Migration impact

Hassan's Customer feature itself needs no new Customer schema.

Our adaptation should also avoid Customer schema duplication.

Potential migrations are limited to our separately approved work such as:

```text
Departments
Request Line additions
Billing snapshots
Work Order additions
```

Those belong to their respective Phases.

---

# 73. Deployment requirement

Because Customer authorization changes are security-sensitive:

deploy in this sequence:

```text
backend access policy
        ↓
backend tests
        ↓
CustomerService
        ↓
frontend
```

Never deploy frontend capability assumptions before backend authorization exists.

---

# 74. Audit logging

Customer master modifications should produce an auditable record.

At minimum Frappe Version / activity must expose :

```text
who
when
Customer
fields changed
```

Security-relevant changes involving accounts/permissions remain handled by the Accounts workflow.

---

# 75. Customer access must be tested server-side

No test like only:

```text
button hidden for Manager
```

is sufficient.

Also test direct endpoint calls:

```text
Manager POST commercial field
→ 403

Operator POST address
→ 403

Manager GET other Customer
→ same authorization failure
```

---

# 76. Final architecture

After adaptation :

```text
                       ERPNext Customer
                              │
                  ┌───────────┴───────────┐
               Address                 Contact
                                          │
                                     Frappe User
                                          │
                                  User Permission
```

Access layer :

```text
Contact declaration
       ∩
User Permission
       ↓
Customer Access Policy
       ↓
Capabilities
```

Application :

```text
Customer 360
Requests
Users
Devices
Contracts
Billing
```

Each consumes the common policy.

---

# 77. Relationship with our global architecture

```text
Customer
│
├── User 360
│     ├ Personal Services
│     └ Devices
│
├── Requests
│     └ Request Workbench
│
├── Contract / Catalogue
│
└── Billing Workbench
```

Hassan's Customer work completes this architecture nicely.

It does not replace any Lifecycle.

---

# 78. Definition of Done

Nous considérons l'addon correctement intégré lorsque :

```text
ERPNext Customer remains master

Customer creation works

Customer Directory works

Customer 360 works

Company Profile works

Technician read-only works

Manager restricted editing works

Operator restriction works

Cross-customer access impossible

Mixed roles fail closed

Shared Contact/Address protected

No email-based implicit Customer authorization

No duplicate Customer model

Requests still obey Phase 3

Request Workbench still obeys Phase 4

Billing snapshots Customer data historically

Session security not weakened

No msp.local.com hardcoded product config
```

et que les tests Hassan pertinents ont été portés dans la suite principale.

---

# 79. Principe final de cette spec

> Hassan's addon is not a branch to merge.

> It is a feature implementation to mine selectively.

Nous conservons :

```text
the good domain ideas
security protections
ERPNext-native Customer design
tests
```

Nous remplaçons :

```text
conflicting Request UX
route architecture
scattered role assumptions
```

Nous rejetons :

```text
session security regression
environment-specific config
```

Et tout est intégré dans la roadmap existante plutôt que posé à côté.