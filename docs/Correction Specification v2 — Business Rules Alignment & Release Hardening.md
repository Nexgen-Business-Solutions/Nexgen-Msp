# Correction Specification v2

## Business Rules Alignment & Release Hardening

---

# 0. STATUT DE CE DOCUMENT

Ce document remplace toute interprétation antérieure contradictoire.

Les catégories suivantes sont obligatoires :

```text
VALIDATED BUSINESS RULE
= décision métier explicitement confirmée par le propriétaire du produit.

TECHNICAL IMPLEMENTATION
= manière recommandée d'implémenter une règle validée.

FORBIDDEN
= comportement qui ne doit jamais exister.

REQUIRES OWNER VALIDATION
= impact métier/financier non encore suffisamment défini.
```

Codex/Claude ne doivent jamais transformer un point `REQUIRES OWNER VALIDATION` en règle métier par eux-mêmes.

---

# 1. MODÈLE MÉTIER GLOBAL

## VALIDATED BUSINESS RULE

Le MSP gère :

```text
Customer
│
├── Client Users
├── Devices
│
└── Services
│
├── Contracts
├── Portal Accounts
├── Requests
└── Billing
```

Les entités ont des responsabilités différentes.

---

# 2. CUSTOMER

Un `Customer` représente l'entreprise cliente.

Source de vérité :

```text
ERPNext Customer
```

Un Customer peut avoir :

```text
0..N Client Users
0..N Devices
0..N Contracts
0..N Portal Accounts
0..N Requests
0..N Billing Runs
```

---

# 3. CLIENT USER

## MANDATORY INVARIANT

```text
MSP Client User
=
personne métier gérée par Nexgen pour le Customer
```

Il sert pour :

```text
services
device holders
departments
requests
billing
history
```

---

# 4. CLIENT USER ≠ PORTAL USER

## FORBIDDEN

Il n'existe et il n'existera jamais de relation entre :

```text
MSP Client User
```

et :

```text
Frappe User / Portal Account
```

Interdit :

```text
portal_visible
portal_user
portal_access
needs_portal_access
```

Interdit également :

```text
matching by email
matching by username
automatic account creation
automatic invitation
automatic Contact creation
automatic User Permission creation
```

à partir d'un Client User.

---

# 5. PORTAL ACCOUNT

Les utilisateurs de l'application côté Customer sont créés séparément dans :

```text
/accounts
```

Ils peuvent avoir :

```text
MSP Customer Manager
```

ou :

```text
MSP Customer Operator
```

Ils sont assignés à leur Customer indépendamment des Client Users.

Exemple valide :

```text
MSP Client User
John Smith
john.smith@customer.com
```

et :

```text
Portal User
it.manager@gmail.com
Customer = ACME
```

Il n'existe aucun lien entre les deux.

---

# 6. PORTAL ACCOUNT REASSIGNMENT

Un Portal User peut changer d'entreprise autorisée sans modifier :

```text
Client Users
Devices
Services
Requests historiques
```

L'affectation Customer du compte portail est une problématique d'accès uniquement.

---

# 7. ROLE FAMILIES

## VALIDATED BUSINESS RULE

Customer roles :

```text
MSP Customer Manager
MSP Customer Operator
```

Internal roles :

```text
MSP System Admin
MSP Technician
```

---

# 8. MIXED ROLES

## FORBIDDEN

Un User normal ne peut jamais avoir simultanément :

```text
Customer role
+
Internal role
```

Exemple :

```text
Customer Manager + MSP Technician
→ INVALID
```

```text
Customer Operator + MSP System Admin
→ INVALID
```

Pas de système de priorité de rôles.

Le système refuse la combinaison.

---

# 9. CUSTOMER MANAGER

## VALIDATED BUSINESS RULE

Le Customer Manager voit tout ce qui concerne son entreprise.

Inclut :

```text
Users
Devices
Services
Requests
Invoice records
Invoice details
Billing supporting breakdown
```

Il peut :

```text
contester une facture
```

selon le workflow prévu.

---

# 10. CUSTOMER OPERATOR

## VALIDATED BUSINESS RULE

Le Customer Operator voit les informations opérationnelles du Customer :

```text
Users
Devices
Services
Requests
```

mais PAS :

```text
Invoices
Billing financial details
Invoice download
Invoice disputes
```

Le code actuel est déjà correctement aligné sur cette règle.

---

# 11. REQUEST AUTHORITY ≠ ROLE

## MANDATORY INVARIANT

Les droits :

```text
can_submit
can_approve
```

ne viennent jamais de :

```text
Manager
Operator
```

Les rôles définissent la visibilité générale.

La matrice d'autorité définit le pouvoir sur les Requests.

---

# 12. MATRICE D'AUTORITÉ

Pour chaque Portal Account d'un Customer :

```text
can_submit
can_approve
department optional
```

---

# 13. MATRICE — CAS POSSIBLES

### Aucun droit

```text
can_submit = 0
can_approve = 0
```

L'utilisateur :

```text
voit selon son rôle
ne crée pas de Request
n'approuve pas de Request
```

---

### Submit uniquement

```text
can_submit = 1
can_approve = 0
```

Il peut créer.

La Request devient :

```text
Awaiting Customer Approval
```

Elle n'arrive PAS encore chez Nexgen.

---

### Approve uniquement

```text
can_submit = 0
can_approve = 1
```

Il ne peut pas créer.

Il peut approuver les Requests correspondant à son périmètre.

---

### Submit + Approve

```text
can_submit = 1
can_approve = 1
```

Lorsqu'il crée sa propre Request :

```text
Request
→ customer approved immediately
→ Submitted
→ reaches Nexgen
```

Aucune seconde validation Customer nécessaire.

---

# 14. ÉCART ACTUEL — AUTHORITY

Le code actuel contient encore une compatibilité legacy problématique.

Dans :

```text
portal_service.py
```

`_guard_may_submit()` autorise un compte non présent dans la matrice à créer une Request.

Et :

```text
my_approval_rights()
```

peut retourner :

```text
can_submit = True
```

si aucun droit n'est trouvé.

## FAIL

Cela contredit la règle métier.

---

# 15. CORRECTION AUTHORITY

Nouvelle règle :

```text
No matrix entry
=
no request authority
```

Jamais :

```text
no entry
→ allowed by default
```

---

# 16. CORRECTION CODE AUTHORITY

Modifier :

```text
nexgen_msp/utils/approval.py
nexgen_msp/api/internal/services/authority_service.py
nexgen_msp/api/portal/services/portal_service.py
```

`rights_of()` doit renvoyer :

```text
can_submit = false
can_approve = false
```

si aucun droit.

`_guard_may_submit()` doit exiger explicitement :

```text
rights.can_submit == true
```

`my_approval_rights()` ne doit jamais default `can_submit` à True.

---

# 17. REQUEST SANS APPROVER

Si quelqu'un possède :

```text
can_submit = 1
```

mais aucun compte n'est capable d'approuver la Request :

la Request peut être enregistrée en :

```text
Awaiting Customer Approval
```

mais elle ne doit pas atteindre Nexgen.

L'UI doit afficher clairement :

```text
This request is waiting for customer approval,
but no authorized approver currently covers it.
```

Les admins MSP reçoivent un warning de configuration.

---

# 18. DEPARTMENT AUTHORITY

La limitation :

```text
department
```

reste valable.

Exemple :

```text
Approver A
can_approve = 1
department = Accounting
```

ne peut approuver que les Requests dont tous les sujets sont couverts par Accounting.

---

# 19. PORTAL INVITATIONS

## MANDATORY SAFETY RULE

La création d'un véritable Portal Account ne doit PAS envoyer automatiquement un email.

Default :

```text
send_email = 0
```

---

# 20. INVITATION

L'envoi doit nécessiter une action explicite :

```text
☐ Send invitation now
```

décochée par défaut.

Ou après création :

```text
[ Send invitation ]
```

---

# 21. FICHIERS À CORRIGER POUR EMAIL

Actuellement :

```text
team_service.py
create_account(... send_email=1)
```

et :

```text
endpoints/v1.py
send_email=1
```

doivent devenir :

```text
send_email=0
```

Frontend :

```text
InviteTeamModal
```

checkbox par défaut :

```text
false
```

---

# 22. PHASE 1 — DEVICE / HOLDER

## VERDICT

Globalement conforme.

Les règles précédentes restent.

---

# 23. DEVICE OWNERSHIP

```text
Customer owns Device.
Client User holds Device for a period.
```

Holder history = source de vérité.

---

# 24. DEVICE TRANSFER

Support obligatoire :

```text
Alice
→ Laptop A

Transfer

Bob
→ Laptop A
```

Le Device service reste au Device.

---

# 25. CLIENT USER DISABLED + DEVICE

## VALIDATED BUSINESS RULE

Désactiver un Client User ne doit PAS automatiquement :

```text
repossess device
transfer device
retire device
close holder history
```

La désactivation du User est indépendante.

---

# 26. CONSÉQUENCE

Il est possible temporairement d'avoir :

```text
Client User = Disabled

Current Device Holder = same Client User
```

Cela doit produire une alerte :

```text
Attention:
Disabled user still holds a device.
```

mais pas une mutation automatique.

---

# 27. NOUVELLE ATTRIBUTION

Un Client User Disabled ne peut pas recevoir un nouveau Device.

Cela est déjà cohérent avec :

```text
HOLDABLE_LIFECYCLE
```

actuel.

---

# 28. PHASE 2 — SERVICE LIFECYCLE

## VERDICT APRÈS CLARIFICATION

⚠️ PARTIAL

Le lifecycle structurel est bon.

La protection contre les périodes déjà facturées est trop stricte pour l'action `End`.

---

# 29. SERVICE OWNERSHIP

Inchangé :

```text
User Service
→ Client User

Device Service
→ Device
```

---

# 30. DÉSACTIVATION CLIENT USER

## VALIDATED BUSINESS RULE

Désactiver un Client User :

```text
does NOT automatically end User Services
does NOT automatically end Device Services
does NOT remove Devices
```

---

# 31. NEW SERVICE ON DISABLED CU

Interdit.

```text
Disabled Client User
→ cannot receive new User-scoped Service
```

Le code actuel respecte déjà cette règle.

---

# 32. EXISTING SERVICE ON DISABLED CU

Peut rester :

```text
Active
Suspended
Pending Removal
Ended
```

indépendamment du lifecycle du CU.

---

# 33. REMOVE SERVICE AFTER BILLING

## VALIDATED BUSINESS RULE

Il doit être possible de terminer/enlever un service même s'il a déjà été facturé.

Exemple :

```text
M365 billed through March 31
```

puis :

```text
End service March 15
```

doit pouvoir être enregistré.

---

# 34. IMPORTANT

Cela ne signifie PAS :

```text
rewrite March invoice
```

Cela ne signifie PAS :

```text
automatic credit note
```

Cela ne signifie PAS nécessairement :

```text
the customer physically stopped using M365 on March 15
```

La modification MSP indique la limite opérationnelle/billing retenue dans notre suivi.

---

# 35. HISTORICAL INVOICE

Une Invoice déjà émise reste inchangée.

Toujours :

```text
historical Billing Run = immutable
```

---

# 36. ÉCART ACTUEL SERVICE LIFECYCLE

Le code bloque actuellement plusieurs actions lorsque :

```text
effective_date <= billed_to
```

avec :

```text
This period has already been invoiced.
Issue a credit note / adjustment instead.
```

Pour `End`, cette règle est contraire au métier validé.

---

# 37. CORRECTION END

Dans :

```text
ServiceLifecycleService.end()
UserService._end_date_for()
```

supprimer le blocage :

```text
end_date < billed_to
→ reject
```

pour une fermeture de Service.

---

# 38. NO RETROACTIVE FINANCIAL MUTATION

Même lorsqu'un service est fermé avant sa dernière couverture facturée :

```text
Billing Run historical data
Invoice
Sales Invoice
```

ne sont jamais modifiés automatiquement.

---

# 39. SUSPEND / RESUME / CHANGE

## IMPORTANT

Le propriétaire du produit n'a explicitement autorisé la rétroactivité financière que pour :

```text
removing / ending a service
```

Donc, jusqu'à décision contraire :

```text
Suspend
Resume
Change
```

continuent à être protégés contre les modifications rétroactives d'une période déjà invoicée.

Ne pas élargir automatiquement la règle.

---

# 40. CLIENT USER LIFECYCLE

## GROS ÉCART ACTUEL

La UI dit actuellement :

```text
status follows the services themselves
```

et le status n'est même pas réellement gérable depuis User 360.

C'est contraire au métier.

---

# 41. CLIENT USER STATUS IS INDEPENDENT

Ajouter des opérations explicites :

```text
disable_client_user()
reactivate_client_user()
archive_client_user()
```

---

# 42. DISABLE CLIENT USER

Inputs :

```text
client_user
effective_date
reason optional/required according UX
```

Effet :

```text
lifecycle_status = Disabled
disabled_date = effective_date
```

Rien d'autre.

---

# 43. DISABLE MUST NOT

## FORBIDDEN

```text
close service assignments
repossess devices
close holder periods
change billing history
remove requests
```

---

# 44. REACTIVATE

```text
Disabled
→ Active
```

Effet :

```text
disabled_date = null
disabled_reason = null
```

Ne réactive aucun ancien Service automatiquement.

Ne réattribue aucun Device automatiquement.

---

# 45. USER 360

Ajouter :

```text
More
→ Disable user
```

ou action équivalente visible.

Disabled :

```text
[ Reactivate ]
```

---

# 46. USER 360 PORTAL

## DELETE ENTIRELY

Retirer :

```text
Portal access enabled
Portal access not enabled
Grant access
Manage portal access
```

User 360 ne connaît pas les Portal Accounts.

---

# 47. PHASE 3 — REQUEST BUILDER

## VERDICT

❌ P0 corrections required.

---

# 48. DEVICE REQUIREMENT

Invariant :

```text
Device service
=
target_scope Device
```

même lorsque Device inconnu.

---

# 49. NEW DEVICE REQUIREMENT

Correct :

```text
target_scope = Device
managed_device = NULL
is_new_device = 1
device_requirement_key = UUID
```

---

# 50. FORBIDDEN

```text
target_scope = User
because no Device exists yet
```

Actuellement présent dans :

```text
portal_service.py::_scoped_line()
useRequestBuilder.ts
```

À corriger.

---

# 51. CLIENT TECHNICAL DATA

## FORBIDDEN

Le Customer ne remplit pas :

```text
username
hostname
serial number
device type
MAC
asset number
```

dans Request Builder.

Ces informations appartiennent au technicien.

---

# 52. REQUEST PORTAL ACCESS

## DELETE ENTIRELY

Supprimer :

```text
needs_portal_access
```

de :

```text
MSP Service Request Line
Request Builder
Request Workbench
Portal API
Internal API
tests
```

Une Request concernant un Client User n'a aucune relation avec les comptes Portal.

---

# 53. REQUESTED_FOR_USER

Pour les lignes Device :

```text
requested_for_user
```

reste le contexte humain historique.

Il ne définit pas ownership.

---

# 54. REQUEST DETAIL

L'identité historique doit être :

```text
requested_for_user
```

avant :

```text
current holder
```

Le holder actuel ne doit jamais réécrire le sens d'une ancienne Request.

---

# 55. REQUEST AUTHORITY

Le Request Builder doit vérifier les droits de la matrice.

Si :

```text
can_submit = false
```

il ne doit pas permettre Submit.

---

# 56. CUSTOMER ROLE DOES NOT GRANT SUBMIT

## FORBIDDEN

```text
Manager → can submit
Operator → can submit
```

automatiquement.

Seule la matrix décide.

---

# 57. BOTH RIGHTS

Si :

```text
can_submit = true
can_approve = true
```

la Request est créée directement :

```text
Submitted
```

et :

```text
customer_approved_by = requester
customer_approved_at = now
```

Le code actuel est déjà aligné sur ce point.

---

# 58. REQUESTS ARRIVING AT MSP

MSP Technician/Admin ne voit dans sa queue de réalisation que :

```text
customer-approved Requests
```

Une Request :

```text
Awaiting Customer Approval
```

ne doit pas apparaître dans leur workload.

Le code actuel est bien orienté ainsi.

---

# 59. PHASE 4 — REQUEST WORKBENCH

## PORTAL ACCOUNT LOGIC

Supprimer entièrement toute section :

```text
Portal Access
needs_portal_access
create account
send invitation
```

du Workbench.

---

# 60. USER SETUP

User Setup doit uniquement créer :

```text
MSP Client User
```

avec :

```text
full name
department
email if known
technical username if technician needs it for service licensing
```

Le username ici est un identifiant technique métier, PAS un Frappe username.

---

# 61. USER SETUP MUST NEVER

```text
create Frappe User
create Contact
create User Permission
send invitation
```

---

# 62. DEVICE PROVISIONING

Reste conforme :

```text
Use stock Device
OR
Register new Device
```

puis DeviceLifecycle.

---

# 63. PHASE 5 — USER 360

## STRUCTURE

Conserver :

```text
Identity
Attention
Personal Services
Current Devices
Open Requests
History
Billing summary
Internal Notes
```

---

# 64. LIFECYCLE ACTION

Ajouter un bloc explicitement indépendant :

```text
Status: Active

[ Disable ]
```

ou :

```text
Status: Disabled since 2026-08-12

[ Reactivate ]
```

---

# 65. DISABLED CU ATTENTION

Afficher par exemple :

```text
Disabled user still has 2 active User services.
```

```text
Disabled user still holds LAPTOP-42.
```

Ce sont des alerts.

Pas des blockers de désactivation.

---

# 66. DIRECT SERVICE ACTIONS

Le workflow normal reste :

```text
Request
```

Les actions directes internes peuvent éventuellement rester comme outil Admin secondaire si déjà validées opérationnellement.

Elles ne doivent pas remplacer Request Workbench dans le parcours standard.

---

# 67. PHASE 5B — CUSTOMER / ACCOUNTS

## ACCOUNTS PAGE

`/accounts` gère exclusivement :

```text
Frappe Users
roles
Customer assignment
enabled/disabled
invitation
```

---

# 68. NO CLIENT USER DATA

La page `/accounts` ne doit jamais rechercher :

```text
MSP Client User
```

pour créer ou lier un account.

---

# 69. CUSTOMER ASSIGNMENT

L'affectation :

```text
Portal User → Customer
```

peut être changée indépendamment.

---

# 70. MANAGER VISIBILITY

Manager :

```text
operational data
+
financial/invoice data
+
invoice dispute
```

---

# 71. OPERATOR VISIBILITY

Operator :

```text
operational data
```

sans :

```text
invoice
billing
dispute
```

Le code actuel est aligné.

---

# 72. PHASE 6 — DEPARTMENT

Règle précédente inchangée :

```text
MSP Department is GLOBAL.
```

---

# 73. FORBIDDEN

```text
Department.customer
```

Customer-specific Departments interdits.

Le code actuel doit être corrigé.

---

# 74. CONTRACT MODEL — VALIDATED BUSINESS RULES

Cette partie doit maintenant être considérée comme fondamentale.

Un Customer peut avoir :

```text
0..N Contracts
```

---

# 75. CONTRACT DURATION

Chaque Contract possède :

```text
start_date
end_date
```

Exemple :

```text
01/01/2026
→
31/12/2028
```

---

# 76. BILLING FREQUENCY

Le Contract définit également :

```text
billing_frequency
```

Exemples :

```text
Monthly
Quarterly
Annually
```

---

# 77. ONE CONTRACT → MANY RUNS

## VALIDATED

Exemple :

```text
Contract ACME
3 years
Monthly
```

produit :

```text
BR Jan 2026
BR Feb 2026
BR Mar 2026
...
BR Dec 2028
```

---

# 78. BILLING RUN

Chaque Billing Run appartient à :

```text
exactly one Contract
```

Le même Contract peut avoir :

```text
N Billing Runs
```

---

# 79. RUN → INVOICE

Le comportement actuel :

```text
1 Billing Run
→ 1 Sales Invoice
```

est conservé.

Ce n'est PAS :

```text
1 Contract → 1 Invoice
```

---

# 80. MULTIPLE CONTRACTS PER CUSTOMER

Exemple valide :

```text
Contract A
M365
Backup

Contract B
Firewall
SOC
```

sur la même période.

---

# 81. SAME SERVICE ON MULTIPLE CONTRACTS

Également valide si périodes non chevauchantes :

```text
Contract A
M365
Jan 2026 → Dec 2026

Contract B
M365
Jan 2027 → Dec 2027
```

---

# 82. CONTRACT CONFLICT

## FORBIDDEN

Même Customer + même Service + périodes contractuelles qui se chevauchent.

Exemple interdit :

```text
Contract A
M365
Jan → Dec 2026

Contract B
M365
Jun 2026 → May 2027
```

Overlap :

```text
Jun → Dec 2026
```

→ INVALID.

---

# 83. ÉCART ACTUEL CONTRACT EXCLUSIVITY

Actuellement :

```text
MSPContract.validate_service_exclusivity()
```

interdit simplement un même Service sur deux contracts `Active/Suspended`.

Il ne compare pas les dates.

Cela est trop strict et en même temps insuffisamment précis.

---

# 84. NOUVELLE VALIDATION CONTRACT

Pour chaque :

```text
customer + service_item
```

interdire uniquement si :

```text
contract_A.start <= contract_B.end
AND
contract_B.start <= contract_A.end
```

avec dates ouvertes traitées comme infinies.

---

# 85. DRAFT CONTRACT

Un Draft peut être préparé même s'il chevauche temporairement.

Mais :

```text
Draft → Active
```

doit obligatoirement passer la validation de conflits.

---

# 86. ENDED CONTRACT

Un Ended Contract conserve son histoire.

Ses dates contractuelles restent utilisées pour détecter les incohérences historiques.

Ne pas réécrire ses Services.

---

# 87. CONTRACT SERVICE RESOLUTION

À une date donnée `D` :

le système doit trouver le Contract :

```text
customer matches
service is listed
status allows service at D
start_date <= D
end_date >= D or NULL
```

---

# 88. ÉCART ACTUEL SERVICE LIFECYCLE

Actuellement :

```text
ServiceLifecycleService._contract()
```

cherche un Contract Active mais ignore :

```text
start_date
end_date
```

Donc un futur Contract ou un vieux Contract encore Active peut être utilisé incorrectement.

À corriger.

---

# 89. REQUEST CATALOGUE

Même correction pour :

```text
PortalService.list_catalogue()
```

Aujourd'hui il récupère les Services de contracts Active/Suspended sans contrôler leurs dates.

Le catalogue doit être date-aware.

---

# 90. PRICE MODEL

## VALIDATED BUSINESS RULE

Le prix d'un Service n'est PAS contenu dans le Contract.

Les deux concepts sont séparés.

---

# 91. CONTRACT ANSWERS

```text
Are we contractually allowed to provide/bill this service during this period?
```

---

# 92. RATE ANSWERS

```text
What is the unit price of this service for this Customer during this date?
```

---

# 93. BILLING RUN JOINS THEM

Pendant Billing :

```text
Contract coverage
        ∩
Service consumption
        ∩
Rate validity
        ∩
Billing Run interval
        ∩
Previously unbilled coverage
```

donne les lignes facturables.

---

# 94. RATE BUSINESS KEY

Conceptuellement :

```text
Customer
+
Service
+
valid_from
+
valid_upto
+
rate
```

---

# 95. RATE EXAMPLE

```text
ACME
M365
01/01/2026 → 30/06/2026
10 USD
```

puis :

```text
ACME
M365
01/07/2026 → 31/12/2026
12 USD
```

Le Contract peut rester exactement le même.

---

# 96. RATE OVERLAP

## FORBIDDEN

Pour :

```text
same Customer
same Service
```

deux Rate validity intervals ne doivent pas se chevaucher.

Sinon Billing ne saurait pas quel prix choisir.

---

# 97. ÉCART ACTUEL PRICE / CONTRACT

Actuellement :

```text
ContractService._price_list()
```

cherche la Price List depuis le Contract.

Et :

```text
save_rate()
```

refuse un rate si le Contract n'a pas de Price List.

C'est contraire au modèle métier.

---

# 98. CONTRACT PRICE FIELDS

Les champs métier :

```text
price_list
price_list_valid_upto
```

ne doivent plus être considérés comme des termes contractuels MSP.

---

# 99. TECHNICAL ITEM PRICE

ERPNext `Item Price` peut toujours être utilisé techniquement pour stocker les rates.

Mais sa `Price List` devient un détail d'infrastructure.

Le Contract ne la choisit pas.

---

# 100. RECOMMANDATION TECHNIQUE PRICE LIST

Créer/configurer une Selling Price List MSP dédiée, par exemple :

```text
MSP Services
```

ou utiliser une configuration globale.

Puis les vraies dimensions métier restent :

```text
Item Price.customer
Item Price.item_code
valid_from
valid_upto
price_list_rate
currency
```

---

# 101. PRICE SOURCE

Le label :

```text
Contract
```

comme `price_source` devient trompeur.

Pour les nouvelles données :

```text
Customer Rate
```

ou techniquement :

```text
Item Price
```

est plus juste.

Les données historiques `Contract` doivent être migrées sans modifier leurs montants.

---

# 102. CONTRACT UI

La fiche Contract doit gérer :

```text
title
customer
status
start/end
billing frequency
covered services
currency if needed for invoice
billing notes
```

Pas les Rate versions.

---

# 103. RATE UI

Les Rates se gèrent séparément :

```text
Customer
→ Pricing / Rates
```

avec :

```text
Service
Rate
Valid from
Valid until
Discount if applicable
```

---

# 104. PHASE 7 — BILLING CORE

## VALIDATED BUSINESS RULE

Le Billing est semi-automatique.

Le système connaît :

```text
when the Service started
when it stopped
suspensions
previous billed periods
Client User lifecycle
Contract coverage
Rates
```

Il doit donc calculer automatiquement ce qui reste à facturer.

---

# 105. SOURCE DE BILLING PRINCIPALE

La facturation se décide au niveau :

```text
MSP Service Assignment
```

Pas au niveau du Client User global.

Pas au niveau du Device global.

Les champs :

```text
Client User.last_billed_on
Device.last_billed_on
```

sont des résumés.

Ils ne remplacent pas l'historique de chaque Assignment.

---

# 106. PARTIAL MONTH RULE

## VALIDATED BUSINESS RULE

Les jours consommés sont arrondis au bloc supérieur de :

```text
5 days
```

sur une convention :

```text
30 days = 1 month
```

---

# 107. FORMULE

Pour un mois :

```text
actual_billable_days = N

rounded_days =
ceil(N / 5) * 5

rounded_days capped at 30

billable_months =
rounded_days / 30
```

---

# 108. EXAMPLES

```text
1 day
→ 5
→ 0.1667 month
```

```text
5 days
→ 5
→ 0.1667
```

```text
6 days
→ 10
→ 0.3333
```

```text
13 days
→ 15
→ 0.5
```

```text
16 days
→ 20
→ 0.6667
```

```text
28 days
→ 30
→ 1.0
```

```text
31-day full month
→ capped 30
→ 1.0
```

---

# 109. CURRENT BILLING DIFFERENCE

Le code actuel possède plusieurs proration modes :

```text
Daily Actual Days
30-Day Convention
...
```

et le défaut actuel est souvent :

```text
Daily Actual Days
```

Avec 13 jours dans un mois de 31 jours :

```text
15 / 31
!=
0.5
```

Donc ce défaut est contraire à la règle validée.

---

# 110. CORRECTION PRORATION

Pour le modèle MSP normal :

```text
5-day rounding
+
30-day denominator
```

doit être le calcul utilisé.

Ne pas utiliser `days_in_month` comme dénominateur.

---

# 111. MULTI-MONTH RUN

Calculer mois par mois.

Exemple :

```text
Run Jan → Mar
```

Le moteur calcule :

```text
January billable quantity
+
February billable quantity
+
March billable quantity
```

puis somme.

Ne jamais faire :

```text
total days across 3 months
→ one single rounding
```

---

# 112. SUSPENSION

Avant rounding :

```text
live days
-
suspended days
```

Puis rounding sur le résultat du mois.

---

# 113. DISABLED CLIENT USER BILLING

## VALIDATED BUSINESS RULE

Un CU Disabled ne doit pas être présenté pour de la nouvelle consommation future.

Mais s'il existe :

```text
consumption before disabled_date
AND
not yet invoiced
```

il doit apparaître.

---

# 114. USER-SCOPED EFFECTIVE BILLING END

Pour User Service :

```text
effective_billable_end =
min(
  Run end,
  Service Assignment end if any,
  Client User disabled_date if Disabled/Archived
)
```

---

# 115. IMPORTANT

Le `disabled_date` ne modifie PAS :

```text
MSP Service Assignment.effective_end_date
```

Il sert comme borne de facturation User.

L'Assignment reste son propre historique.

---

# 116. DEVICE SERVICE

Pour :

```text
assignment_scope = Device
```

le lifecycle du current holder n'entre pas dans la facturation.

Si John devient Disabled mais Laptop A continue :

```text
Sophos on Laptop A
```

reste facturable selon Device/Service dates.

---

# 117. DISABLED USER BILLING CANDIDATE

Exemple :

```text
John disabled March 13
M365 active
last invoiced through Feb 28
```

Run March :

```text
March 1 → March 13
= 13 days

round → 15
→ 0.5 month
```

John apparaît dans Billing.

---

# 118. NEXT RUN

April :

aucune User-scoped consommation après March 13.

Donc John :

```text
not proposed
```

---

# 119. PREVIOUSLY BILLED COVERAGE

## IMPORTANT CORRECTION

Le moteur ne doit pas simplement demander :

```text
Does ANY existing Billing Run overlap this Assignment?
```

Il doit demander :

```text
Which exact live periods remain UNBILLED?
```

---

# 120. ÉCART ACTUEL

`BillingService._invoiced_in()` considère actuellement qu'un Assignment est :

```text
Already Invoiced
```

si une Billing Run précédente chevauche la période.

C'est trop grossier pour le modèle semi-automatique.

---

# 121. NOUVEAU BILLING PIPELINE

Pour chaque Assignment :

```text
1. Assignment live coverage
2. intersect Run period
3. intersect Contract coverage
4. cap with Client User disabled_date if User scope
5. subtract Service suspensions
6. subtract already invoiced/net billed intervals
7. calculate remaining days per calendar month
8. round remaining days to 5-day blocks
9. resolve applicable Rate
10. calculate amount
```

---

# 122. FULLY BILLED

Seulement si :

```text
remaining unbilled live coverage = 0
```

alors :

```text
Already billed / no candidate
```

---

# 123. PARTIALLY BILLED

Si :

```text
March 1 → March 10 already billed
March 11 → March 20 still unbilled
```

et Run couvre March :

le moteur doit proposer seulement :

```text
March 11 → March 20
```

Il ne doit pas bloquer tout l'Assignment.

---

# 124. CREDIT NOTES

Les périodes réellement nettes après Credit Note doivent être prises en compte.

Une période entièrement créditée peut redevenir :

```text
not financially covered
```

selon le modèle de crédit existant.

Ne jamais se baser uniquement sur `Billing Run.status`.

---

# 125. CONTRACT COVERAGE DURING BILLING

Pour une Billing Run :

```text
Run.contract = Contract A
```

seuls les Services :

```text
listed on Contract A
```

peuvent entrer.

---

# 126. RUN PERIOD

Doit être :

```text
inside Contract start/end
```

La logique actuelle est correcte sur ce point.

---

# 127. BILLING FREQUENCY

Le Contract définit la fréquence normale.

Exemple :

```text
Monthly
```

Le système suggère :

```text
next month after last invoiced coverage
```

---

# 128. DUE ENGINE

## ÉCART ACTUEL

`BillingService.due()` utilise actuellement les Billing Runs non annulées, y compris potentiellement les Drafts, pour calculer :

```text
covered_upto
```

Mais un Draft n'est pas une facture.

---

# 129. CORRECTION DUE

La prochaine période doit être basée sur les couvertures réellement :

```text
Invoiced
```

nettes de crédits.

Pas simplement :

```text
Draft Billing Run exists
```

---

# 130. EXAMPLE

Contract :

```text
3 years
Monthly
```

Last final billed period :

```text
August 2026
```

Next suggestion :

```text
Sep 1 → Sep 30
```

même s'il existe un Draft abandonné pour September.

---

# 131. RATE RESOLUTION

Pendant chaque morceau réellement consommé :

chercher le Rate :

```text
same Customer
same Service
valid_from <= date
valid_upto >= date
```

---

# 132. NO RATE

Si aucune rate :

```text
Selected + Blocked
Missing Rate
```

Pas de montant inventé.

---

# 133. MULTIPLE RATE MATCHES

Si deux Rates valides se chevauchent :

```text
BLOCK
Ambiguous Rate
```

et corriger les Rates.

Ne jamais prendre arbitrairement la plus récente.

---

# 134. RATE CHANGE MID-RUN

Support nécessaire.

Exemple :

```text
Jan → Jun = 10
Jul → Dec = 12
```

Une Run couvrant June/July utilise les deux rates.

---

# 135. MID-MONTH RATE CHANGE + 5-DAY ROUNDING

## REQUIRES OWNER VALIDATION

Cas :

```text
10 days consumed at old rate
3 days consumed at new rate

total consumption = 13
rounded consumption = 15
```

Il faut décider financièrement où placer les 2 jours d'arrondi.

Le code actuel reround chaque Rate segment séparément, ce qui peut surfacturer.

Ce comportement est interdit.

Mais Codex ne doit pas inventer l'allocation.

Avant implémentation finale, choisir explicitement entre par exemple :

```text
A. extra rounded days use last rate
B. pro-rata allocation
C. rate changes only take effect on billing block/month boundaries
```

C'est le seul point financier majeur de ce document encore non validé.

---

# 136. BILLING SELECTION

Règle précédente conservée :

```text
Filters are views.
Selection is a decision.
```

Les exclusions persistent.

---

# 137. BILLING REVALIDATE

Ne doit jamais réintroduire :

```text
manually excluded Assignment
```

---

# 138. DISABLED USERS IN SELECTION

UI candidate states :

```text
Active User
normal candidate

Disabled User + unbilled historical consumption
historical consumption candidate

Disabled User + no unbilled consumption
not candidate
```

---

# 139. BILLING LABEL

Pour Disabled User historical candidate :

```text
John Smith
Disabled March 13

Unbilled coverage
March 1 → March 13

13 actual days
15 billed days
0.5 month
```

Très explicite.

---

# 140. BILLING SNAPSHOT

Conserver les snapshots validés :

```text
User name
Department
Device
Serial
Service
Customer billing identity
Rate
Coverage
Amount
```

Après Approval :

immutable.

---

# 141. END SERVICE AFTER INVOICE

Exemple :

```text
March already invoiced
Service later marked Ended March 15
```

La March Billing Run reste telle quelle.

Aucun recalcul automatique.

---

# 142. CONTRACT RATE DECOUPLING TEST

Test obligatoire :

```text
Contract A
Jan 2026 → Dec 2028
M365

Rate:
Jan-Jun = 10
Jul-Dec = 12
```

Le Contract reste identique.

Billing June :

```text
10
```

Billing July :

```text
12
```

---

# 143. CONTRACT MULTIPLE RUN TEST

```text
Contract 3 years
Monthly
```

Créer :

```text
36 Billing Runs
```

possible, un par période.

Aucune contrainte `one run per contract`.

---

# 144. SAME SERVICE CONTRACT NON-OVERLAP TEST

Valide :

```text
C1 M365
2026

C2 M365
2027
```

---

# 145. SAME SERVICE CONTRACT OVERLAP TEST

Interdit :

```text
C1 M365
Jan-Dec 2026

C2 M365
Jun 2026-May 2027
```

---

# 146. PHASE 7 MANUAL DISCOUNT BUG

Correction précédente reste.

Si un Assignment produit plusieurs lignes de Rate :

`Revalidate` ne doit pas changer la portée de la remise manuelle.

---

# 147. MANUAL DISCOUNT SCOPE

Si le produit garde la remise manuelle au niveau Assignment :

elle doit s'appliquer à tous ses Rate segments immédiatement.

Avant et après Revalidate :

```text
same outcome
```

---

# 148. BILLING ACCOUNTING UI

Correction UX précédente reste :

Accounting doit idéalement être intégré dans :

```text
Invoice Stage
```

plutôt qu'une modal séparée.

Non blocker financier.

---

# 149. PHASE 8 — DATA AUDIT

Le Data Audit doit maintenant contrôler également :

```text
Disabled User with future User billing
overlapping Contract services
overlapping Customer rates
Portal-related fields on Client User
Portal-related fields on Request Line
mixed role families
authority gaps
```

---

# 150. RELEASE BLOCKERS

Release impossible si :

```text
portal_visible still exists on Client User
needs_portal_access still exists
Client User can create Portal Account
Client User creation can send invitation
mixed Customer/Internal roles possible
unnamed portal account can submit Requests
Device requirement is stored as User scope
Customer-specific Departments remain
same service has overlapping contracts
same Customer+Service has overlapping rates
Disabled User is billed after disabled_date
Already-billed overlap blocks remaining unbilled consumption
13-day billing does not produce 0.5 month
historical Invoice changes after operational edits
```

---

# 151. EXACT P0 CORRECTION ORDER

## P0-01 — Client User / Portal Separation

Files at minimum:

```text
MSP Client User DocType
user_service.py
user_360_service.py
UserIdentityCard.tsx
Request Line DocType
portal_service.py
Request Builder
Request Workbench
tests
```

Remove all portal coupling.

---

## P0-02 — Invitation Safety

```text
team_service.py
endpoints/v1.py
InviteTeamModal.tsx
tests
```

Default email OFF.

---

## P0-03 — Client User Lifecycle

Implement:

```text
disable
reactivate
archive
```

No cascade.

---

## P0-04 — Request Authority Strictness

Remove legacy implicit submit.

Authority matrix becomes authoritative.

---

## P0-05 — Device Requirement Semantics

Unresolved Device remains:

```text
target_scope Device
```

---

## P0-06 — Request Client Technical Fields

Remove technical input from Customer UI.

---

## P0-07 — Global Departments

Remove Customer-specific Department behavior.

---

## P0-08 — Contract Date-aware Exclusivity

Replace status-only service exclusivity with interval overlap.

---

## P0-09 — Contract / Rate Separation

Remove business dependency:

```text
Contract → Price List → Rate
```

Create independent Customer Service Rates.

---

## P0-10 — Date-aware Contract Coverage

Activation/catalogue/billing resolve Contract by actual date.

---

## P0-11 — Service End After Billing

Allow `End` regardless of past invoice coverage.

No historical invoice mutation.

---

## P0-12 — Billing Proration

Implement:

```text
ceil(days / 5) * 5 / 30
```

per calendar month.

---

## P0-13 — Disabled User Billing Cutoff

User Service billing stops at:

```text
disabled_date
```

while preserving any prior unbilled coverage.

---

## P0-14 — Exact Unbilled Coverage

Replace coarse:

```text
any overlap → Already Invoiced
```

with:

```text
bill only uncovered consumed intervals
```

---

## P0-15 — Billing Due From Final Financial Coverage

Draft Runs must not move the next billing date.

---

# 152. MANDATORY E2E — CLIENT USER DISABLE

Initial:

```text
John Active
M365 Active since March 1
Laptop A current
```

March 13:

```text
Disable John
```

Expected:

```text
John = Disabled
M365 still Active record
Laptop A still held by John
```

No automatic mutation.

---

# 153. BILLING AFTER DISABLE

No previous March Invoice.

Run March:

```text
M365 live March 1 → March 13
13 days
→ 15
→ 0.5 month
```

Included.

---

# 154. BILLING NEXT MONTH

Run April:

```text
John's User Service
→ not candidate
```

because disabled March 13.

---

# 155. DEVICE SERVICE AFTER USER DISABLE

Laptop A has Sophos.

John Disabled.

Laptop remains deployed.

April:

```text
Sophos Device Service
→ still candidate
```

because Device owns the service.

---

# 156. END ALREADY-BILLED SERVICE

March already invoiced.

Admin ends M365 effective March 15.

Expected:

```text
End accepted
March invoice unchanged
no automatic credit
future billing stops according to recorded end
```

---

# 157. REQUEST MATRIX E2E

Manager:

```text
can_submit = 0
can_approve = 1
```

Cannot create.

Can approve.

---

Operator:

```text
can_submit = 1
can_approve = 0
```

Can create.

Request waits.

---

Operator or Manager:

```text
can_submit = 1
can_approve = 1
```

Own Request:

```text
Submitted immediately
customer_approved_by = self
```

---

# 158. ROLE DOES NOT MATTER FOR AUTHORITY

Tests:

```text
Manager can_submit=0
→ cannot submit
```

```text
Operator can_submit=1
→ can submit
```

```text
Operator can_approve=1
→ can approve
```

```text
Manager can_approve=0
→ cannot approve
```

---

# 159. MANAGER INVOICE TEST

Manager:

```text
list invoices ✓
view invoice ✓
download invoice ✓
download breakdown ✓
dispute invoice ✓
```

Operator:

```text
all above ✗
```

---

# 160. NO CLIENT USER ACCOUNT TEST

Create:

```text
500 MSP Client Users
```

Expected:

```text
0 Frappe Users created
0 Contacts created
0 User Permissions created
0 invitation emails queued
```

---

# 161. ACCOUNT CREATION TEST

Admin explicitly creates:

```text
manager@example.com
Customer Manager
ACME
send_email = 0
```

Expected:

```text
User created
Customer assignment created
no email queued
```

Only:

```text
explicit Send Invitation
```

may generate email.

---

# 162. CONTRACT / RATE BILLING E2E

Customer ACME.

Contract:

```text
Jan 2026 → Dec 2028
Monthly
M365
```

Rates:

```text
Jan-Jun 2026 = 10
Jul-Dec 2026 = 12
```

John:

```text
M365 begins June 18
```

June run:

Consumption:

```text
June 18 → June 30
13 days
```

Billing:

```text
15 days
0.5 month
10 × 0.5
= 5
```

July full month:

```text
1.0 month
12
```

---

# 163. CONTRACT CONFLICT E2E

Contract A:

```text
M365
Jan-Dec
```

Attempt Contract B:

```text
M365
Jun-Nov
```

Must fail before activation.

---

# 164. TWO DIFFERENT SERVICES

Contract A:

```text
M365
Jan-Dec
```

Contract B:

```text
Sophos
Jan-Dec
```

Valid.

---

# 165. TWO NON-OVERLAPPING SAME SERVICES

Contract A:

```text
M365
Jan-Jun
```

Contract B:

```text
M365
Jul-Dec
```

Valid.

---

# 166. DEFINITION OF DONE — BUSINESS ALIGNMENT

The project is only considered aligned when all of the following are true.

### Client User

```text
pure internal managed person
independent lifecycle
no portal relationship
```

### Device

```text
Customer-owned
holder-history authoritative
```

### Services

```text
User or Device ownership explicit
may be ended independently of prior invoices
```

### Contracts

```text
multiple per Customer
date-bounded
billing frequency
services covered
same service cannot overlap in time
```

### Rates

```text
Customer + Service + validity
independent from Contract
```

### Billing

```text
Contract coverage
×
actual consumption
×
unbilled time
×
valid Rate

partial month:
5-day rounding
30-day convention
```

### Portal

```text
Manager sees finance
Operator does not
```

### Authority

```text
submit/approve explicit per account
independent from role
```

### Requests

```text
Customer approval occurs before MSP execution
```

### Historical finance

```text
immutable
```

---

# 167. FINAL ARCHITECTURE

```text
CUSTOMER
│
├── CLIENT USERS
│      ├── User Services
│      └── Device holdings
│
├── DEVICES
│      └── Device Services
│
├── CONTRACTS
│      ├── validity interval
│      ├── billing frequency
│      └── covered Services
│
├── RATES
│      └── Customer + Service + validity
│
├── PORTAL ACCOUNTS
│      ├── Manager / Operator
│      └── Request Authority Matrix
│
├── REQUESTS
│      └── Customer approval → MSP Workbench
│
└── BILLING
       └── Contract
            × Consumption
            × Rate
            × Unbilled coverage
```

---

# 168. ONE REMAINING FINANCIAL DECISION

Tout est suffisamment précis pour démarrer les corrections sauf un cas :

```text
Rate change inside a partial month
+
5-day rounding
```

Il faut encore décider explicitement comment répartir les jours d'arrondi entre deux prices différents.

Jusqu'à cette décision :

```text
DO NOT LET AN AGENT INVENT THE RULE.
```

Le moteur doit traiter ce cas comme :

```text
Billing Review Required
```

plutôt que calculer arbitrairement.