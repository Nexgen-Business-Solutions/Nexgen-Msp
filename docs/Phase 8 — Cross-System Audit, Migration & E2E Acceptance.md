# Phase 8 — Cross-System Audit, Migration & E2E Acceptance

## 1. Objectif

La Phase 8 ne crée pas de nouvelle fonctionnalité métier.

Elle vérifie que toutes les phases précédentes fonctionnent comme **un seul produit cohérent** :

```text
Customer
   ↓
Client User
   ↓
Device / Holder
   ↓
Service Assignments
   ↓
Service Request
   ↓
Technician Workbench
   ↓
Billing
   ↓
Invoice
```

L’objectif est de détecter :

- contradictions entre modules ;
- anciens chemins métier encore actifs ;
- données historiques incohérentes ;
- contournements des Lifecycle Services ;
- permissions trop larges ;
- doubles sources de vérité ;
- workflows qui nécessitent encore des navigations inutiles ;
- régressions Billing ;
- problèmes de performance ;
- scénarios qui fonctionnent techniquement mais racontent une histoire métier fausse.

---

# 2. Principe général de release

La release n’est pas considérée prête parce que :

```text
unit tests pass
frontend builds
API returns 200
```

Elle est prête lorsque des scénarios métier complets passent de bout en bout et que :

```text
UI
backend state
history
permissions
billing
```

racontent tous la même histoire.

---

# 3. Architecture finale attendue

## Customer

Source :

```text
ERPNext Customer
```

Responsabilités :

```text
identity
contacts
addresses
commercial context
contract
billing context
```

---

## Client User

Source :

```text
MSP Client User
```

Représente :

> une personne gérée chez un Customer.

Il ne représente pas automatiquement un compte Frappe.

---

## Device

Source :

```text
MSP Managed Device
```

Le Customer possède le Device.

Le Client User en est détenteur par périodes.

---

## Device Holder

Source de vérité :

```text
MSP Device Holder
```

`assigned_client_user` n’est qu’un cache du holder courant.

---

## Service Assignment

Source :

```text
MSP Service Assignment
```

Ownership :

```text
User service
→ Client User

Device service
→ Managed Device
```

Jamais :

```text
Device service
→ current holder
```

---

## Request

Source :

```text
MSP Service Request
MSP Service Request Line
```

Représente :

> l’intention.

Elle ne modifie pas directement les ressources opérationnelles.

---

## Work Order

Source :

```text
MSP Service Work Order
```

Représente :

> une unité de travail backend.

Il n’est pas l’interface principale du technicien.

---

## Request Workbench

Interface :

```text
Request
→ Review
→ Prepare
→ Execute
→ Verify
→ Complete
```

Toute l’exécution est embarquée dans la Request.

---

## Billing

Source :

```text
MSP Billing Run
MSP Billing Run Line
```

Une Run approuvée constitue :

> un snapshot financier historique immuable.

---

# 4. Invariants transversaux à vérifier

## Device

Impossible d’obtenir :

```text
Active + no holder
Stock + current holder
Retired + current holder
two open holders
assigned_client_user != current holder
```

---

## Service

Impossible d’obtenir :

```text
User-only service on Device
Device-only service on User
two overlapping assignments for same target/service
Suspended without open suspension period
Active with open suspension
Ended + Billable
```

---

## Request

Impossible d’obtenir :

```text
Request submission mutates Device
Request submission mutates Service Assignment
Request submission creates User
Request submission changes holder
```

---

## Workbench

Impossible de :

```text
execute Device service before Device target exists
execute User service for unresolved New User
complete Request with open work
complete Request with failed unresolved work
execute same Work Order twice
```

---

## Billing

Impossible de :

```text
reintroduce manually excluded assignment on Revalidate
change historical holder after transfer
change historical department after User edit
change historical rate after rate update
approve Run with blockers
double bill overlapping coverage
```

---

# 5. Audit des écritures directes interdites

Faire une recherche globale des écritures sur :

```text
assigned_client_user
operational_status
billing_status
effective_end_date
managed_device
client_user
lifecycle_status
```

Chaque écriture doit être classifiée.

---

# 6. `assigned_client_user`

Aucune logique métier normale ne doit faire :

```python
device.assigned_client_user = user
```

ou :

```python
db_set("assigned_client_user", ...)
```

hors synchronisation interne du lifecycle.

Toutes les transitions passent par :

```text
DeviceLifecycleService
```

---

# 7. Service Assignment

Aucune logique extérieure ne doit modifier directement :

```text
Active
Suspended
Ended
```

en bricolant le DocType.

Toutes les transitions passent par :

```text
ServiceLifecycleService
```

---

# 8. Billing

Aucune mutation Customer/User/Device ne doit réécrire silencieusement une Run approuvée.

---

# 9. Audit des anciens workflows frontend

Rechercher et supprimer les anciens chemins désormais obsolètes.

Notamment :

```text
Open profile
Manage device
Register elsewhere
Create user modal from Request
Delivery details modal
generic Action dropdown
generic Service dropdown
manual Scope dropdown
```

dans les workflows qui ont été remplacés.

---

# 10. Attention aux composants encore utiles ailleurs

Ne pas supprimer aveuglément :

```text
AddDeviceModal
CreateUserModal
EditUserModal
```

s’ils sont encore utiles dans une opération administrative indépendante.

La règle est :

> ils ne doivent plus être utilisés pour exécuter une Request.

---

# 11. Audit de permissions

Construire une matrice unique.

| Capability | MSP System Admin | MSP Technician | Customer Manager | Customer Operator |
|---|---:|---:|---:|---:|
| View all Customers | ✓ | ✓ | ✗ | ✗ |
| Create Customer | ✓ | ✗ | ✗ | ✗ |
| Manage contracts | ✓ | ✗ | ✗ | ✗ |
| Manage pricing | ✓ | ✗ | ✗ | ✗ |
| Execute Requests | ✓ | ✓ | ✗ | ✗ |
| Edit own company profile | ✓ | ✗ | ✓ limited | ✗ |
| View own company | ✓ | ✓ | ✓ | ✓ |
| Create client Request | according to workflow | according to workflow | ✓ | ✓ if permitted |
| Manage Settings | ✓ | ✗ | ✗ | ✗ |

Les capacités exactes doivent être centralisées.

---

# 12. System Manager

Auditer chaque usage de :

```text
System Manager
```

Il ne doit pas être automatiquement équivalent à :

```text
MSP System Admin
```

pour les opérations commerciales MSP.

---

# 13. Cross-customer isolation

Tester systématiquement :

```text
Customer A user
→ cannot query Customer B users

→ cannot query Customer B devices

→ cannot query Customer B requests

→ cannot query Customer B billing

→ cannot query Customer B contracts
```

Même avec appel API direct.

---

# 14. Migration générale

Les migrations doivent être ordonnées.

Ne pas exécuter plusieurs patches qui se basent mutuellement sur des données encore incohérentes.

---

# 15. Ordre de migration recommandé

```text
1. Device Holder normalization
2. Service Assignment normalization
3. Service Suspension history
4. Departments global catalogue
5. Request Line semantic fields
6. Work Order extensions
7. Billing snapshots
8. Customer/security adaptations
```

L’ordre final peut être ajusté selon les dépendances réelles du code.

---

# 16. Migration Device

Vérifier :

```text
Active without holder
Stock with holder
multiple current holders
assigned_client_user stale
old Returned states
historical repeated holders
```

Produire un rapport.

---

# 17. Migration Services

Vérifier :

```text
invalid scope
duplicate open assignment
overlapping periods
billing/operational status mismatch
suspended services without known suspension date
```

Les données ambiguës doivent être signalées.

Ne jamais inventer des dates financières.

---

# 18. Migration Departments

Construire :

```text
MSP Department
```

à partir des valeurs historiques.

Normaliser la casse sûre.

Reporter :

```text
HR
Human Resources
Human Resource
```

comme alias potentiels.

---

# 19. Migration Requests

Ajouter/remplir si possible :

```text
source_service_assignment
requested_for_user
subject_key
device_requirement_key
```

Pour les anciennes Requests, ne fabriquer une valeur que lorsque la relation est certaine.

Les anciennes Requests peuvent rester lisibles même si elles ne possèdent pas tout le nouveau contexte d’exécution.

---

# 20. Migration Work Orders

Les anciens Work Orders existants doivent rester lisibles.

Ne pas supposer qu’ils correspondent automatiquement à une nouvelle Request Line.

Les nouveaux champs peuvent rester NULL pour l’historique legacy.

---

# 21. Migration Billing

Les anciennes Billing Runs ne possèdent pas forcément tous les snapshots.

Stratégie :

### Draft Run

Peut être reconstruite/revalidée avec les nouvelles règles.

### Approved/Invoiced Run

Ne pas réécrire arbitrairement l’histoire.

Compléter seulement les snapshots pouvant être déterminés avec certitude.

Sinon conserver les anciennes données et signaler la limite.

---

# 22. Dry-run migrations

Pour les patches critiques, fournir un mode diagnostic ou au minimum une sortie détaillée.

Exemple :

```text
DEVICE NORMALIZATION

824 devices inspected
12 Active without holder
3 multiple current holders
18 stale assigned_client_user
0 unrecoverable
```

---

# 23. Backup / rollback

Avant migrations structurelles en production :

```text
database backup
files backup if relevant
migration report
```

et procédure de rollback définie.

---

# 24. E2E Scenario 1 — Existing User, Service Changes

Initial :

```text
John
Accounting

M365 Active
VPN Suspended

Laptop A
Sophos Active
RMM absent
```

Client Request :

```text
+ Adobe
Resume VPN
+ RMM on Laptop A
```

---

# 25. Expected Request

Trois lignes atomiques :

```text
Add Adobe → User John

Resume VPN
→ User John
→ source assignment VPN

Add RMM
→ Device Laptop A
→ requested_for_user John
```

---

# 26. Workbench

```text
Review
Prepare skipped
Execute:
  Add Adobe
  Resume VPN
  Add RMM
Verify
Complete
```

---

# 27. Final state

```text
John personal:
M365 Active
VPN Active
Adobe Active

Laptop A:
Sophos Active
RMM Active
```

Billing ultérieur comprend correctement ces périodes.

---

# 28. E2E Scenario 2 — New User + Device

Client demande :

```text
Marie Dupont
Human Resources

M365
VPN
Sophos
RMM
Needs Device
```

---

# 29. Request state

Toutes les lignes Marie partagent :

```text
subject_key = X
```

Les lignes Device partagent :

```text
device_requirement_key = Y
```

---

# 30. Workbench expected

Prepare :

```text
Create Marie once
Register/assign Device once
```

Puis Execute :

```text
M365
VPN
Sophos
RMM
```

---

# 31. Final state

```text
1 Client User
1 current holder period
1 Device
4 Service Assignments
```

Pas :

```text
4 users
2 devices
duplicate services
```

---

# 32. E2E Scenario 3 — Repossession

Initial :

```text
John
Laptop A
Sophos Active
```

Action admin/request :

```text
Repossess Laptop A
```

Résultat :

```text
Laptop A = Stock
assigned_client_user = NULL
John holder period closed
Sophos remains Active on Laptop A
```

User 360 John :

```text
Current Devices = none
Past Devices = Laptop A
```

---

# 33. E2E Scenario 4 — Reassign same person

Après repossession :

```text
Stock Laptop A
```

Réassigner à John.

Résultat :

```text
John
Jan → Mar

John
Sep → current
```

Deux périodes valides.

---

# 34. E2E Scenario 5 — Transfer

Initial :

```text
Alice
Laptop A
Sophos
```

Transfer vers Bob.

Résultat :

```text
Alice holder closed
Bob holder opened
Sophos remains same Device Assignment
```

User 360 :

```text
Alice → Past Device
Bob → Current Device + Sophos context
```

---

# 35. Billing après Transfer

Run August créée avant transfert.

Transfer en September.

August Billing doit conserver :

```text
August device snapshot
historical holder context
historical service data
```

et ne jamais afficher Bob comme si Bob était le contexte d’août.

---

# 36. E2E Scenario 6 — Service Suspend / Resume

```text
M365 Active Aug 1
Suspend Aug 10
Resume Aug 16
```

Billing doit utiliser :

```text
Aug 1–9
Aug 16–31
```

selon la convention exacte Phase 2.

---

# 37. E2E Scenario 7 — Rate change

```text
M365 rate:
Aug 1–15 = 10
Aug 16–31 = 12
```

Billing doit segmenter.

Jamais :

```text
all August @ current September rate
```

---

# 38. E2E Scenario 8 — Flexible Billing Selection

Population :

```text
100 candidates
```

Utilisateur exclut :

```text
20
```

Puis filtre/change views/revalidate.

Résultat :

```text
80 selected
```

toujours.

---

# 39. E2E Scenario 9 — Billing blocker

Une ligne sélectionnée :

```text
Missing rate
```

Validation :

```text
Blocked
```

Utilisateur peut :

```text
fix
```

ou :

```text
remove from Run
```

Approval impossible tant que blocker présent.

---

# 40. E2E Scenario 10 — Customer address change

August Billing Run approuvée :

```text
Old Address
```

September Customer Manager change :

```text
New Address
```

August Run reste :

```text
Old Address
```

Aucune mutation rétroactive.

---

# 41. E2E Scenario 11 — Customer access

Customer Manager ACME tente :

```text
GET BETA
```

Refus.

Ajout d’une stale User Permission BETA :

toujours refus.

Ajout Contact relation BETA sans permission :

toujours refus.

Les deux présents :

accès BETA autorisé.

---

# 42. E2E Scenario 12 — Mixed role

Customer Manager avec rôle MSP System Admin accidentel.

Résultat :

```text
no global Customer access
```

pour un compte Customer-linked normal.

---

# 43. E2E Scenario 13 — Shared Contact

Contact lié ACME + BETA.

Manager ACME tente modification.

Refus.

MSP System Admin peut modifier.

---

# 44. E2E Scenario 14 — Department

Admin crée :

```text
Accounting
```

Une fois.

Customer A et Customer B sélectionnent :

```text
Accounting
```

dans leurs Users/Requests.

Aucun duplicate Customer-specific.

---

# 45. E2E Scenario 15 — Department disable

```text
Accounting
enabled = false
```

Résultat :

```text
not selectable for new User
existing users retain Accounting
historical requests retain Accounting
billing/filter history still readable
```

---

# 46. E2E Scenario 16 — Request Action disabled

Admin disable :

```text
Suspend
```

Nouvelles Requests :

```text
Suspend not offered
```

Mais :

```text
ServiceLifecycleService.suspend()
```

continue d’exister pour opérations internes légitimes.

---

# 47. E2E Scenario 17 — Request concurrency

Client ouvre Request Builder.

Service absent.

Entretemps autre processus active le service.

Submit :

```text
rejected as stale
```

Pas de duplicate Assignment.

---

# 48. E2E Scenario 18 — Technician concurrency

Technician A et B ouvrent même Work Item.

A exécute.

B exécute après.

Résultat :

```text
existing result returned / conflict message
no duplicate Device/User/Assignment
```

---

# 49. E2E Scenario 19 — Blocked Work

Request :

```text
M365
Sophos
```

Sophos bloqué fournisseur.

M365 peut être exécuté.

Request reste :

```text
In Progress
```

Completion impossible tant que Sophos non résolu/cancelled.

---

# 50. E2E Scenario 20 — Invoice immutability

Billing Approved.

Ensuite :

```text
User renamed
Department changed
Device transferred
Service renamed
Customer address changed
```

La Billing Run approuvée reste identique.

---

# 51. Performance audit

Tester au minimum des Customers avec :

```text
5,000 Client Users
3,000 Devices
10,000 Service Assignments
1,000 open/historical Requests
large Billing candidate population
```

Les écrans ne doivent pas charger tout le dataset inutilement.

---

# 52. User search

Request Builder doit utiliser :

```text
backend search
pagination/limited results
```

pas charger 5,000 Users au premier rendu.

---

# 53. User 360

Ne charge pas :

```text
whole customer catalogue
whole customer request history
all device types
```

au démarrage.

Lazy loading pour historique.

---

# 54. Billing selection

Pour plusieurs milliers de candidates :

```text
server-side filters
pagination or virtualization
global selection state
```

---

# 55. N+1 queries

Auditer notamment :

```text
User 360 devices → services
Request context services → availability
Billing target labels
Work Orders → checklist/results
```

Éviter un query par ligne lorsque les données peuvent être batchées.

---

# 56. Index audit

Vérifier les indexes utiles selon les requêtes réelles.

Candidats possibles :

```text
MSP Device Holder
managed_device + is_current

MSP Service Assignment
customer + assignment_scope + target + service_item

MSP Service Request
customer + status

MSP Service Work Order
service_request + status

Billing Run Line
service_assignment
billing_run
```

Ne pas ajouter des indexes à l’aveugle : profiler les requêtes.

---

# 57. Security audit

Tester explicitement :

```text
direct whitelisted API calls
role spoof assumptions
customer IDs modified client-side
request line IDs from another Customer
managed_device from another Customer
service assignment from another Customer
billing run from another Customer
```

Chaque service backend doit vérifier le contexte.

---

# 58. IDOR

Tout endpoint recevant :

```text
customer
client_user
device
request
work_order
billing_run
```

doit être audité pour IDOR.

Ne jamais considérer le fait qu’un ID vient du frontend comme une autorisation.

---

# 59. CSRF / mutation semantics

Toutes les mutations doivent utiliser les mécanismes Frappe appropriés.

Les GET ne doivent pas produire d’effets métier.

---

# 60. Atomicité audit

Les opérations suivantes doivent être transactionnelles :

```text
Create User from Workbench
Register + Assign Device
Transfer Device
Service Change rollover
Request Work execution
Billing approval/freeze
Invoice creation
Customer profile compound save
```

---

# 61. Idempotency audit

Au minimum :

```text
execution plan creation
User Setup execution
Device Provisioning execution
Service Action execution
Billing finalise
invoice creation
```

doivent résister aux retries.

---

# 62. Audit UX transversal

Les mêmes concepts doivent avoir les mêmes labels.

Exemple :

```text
Close
```

ne doit pas s’appeler ailleurs :

```text
Delete
Remove permanently
Terminate
End
```

sans raison.

---

# 63. Vocabulaire recommandé

### Device

```text
Assign
Transfer
Repossess
Retire
Reinstate
```

### Service

```text
Add
Change
Suspend
Resume
Close
```

### Request

```text
Review
Prepare
Execute
Verify
Complete
```

### Billing

```text
Scope
Selection
Validation
Review
Invoice
Complete
```

---

# 64. Context cards

Règle UI globale :

Lorsqu’une action concerne un User ou Device, toujours afficher suffisamment de contexte.

User :

```text
Full Name
Department
Email
```

Device :

```text
Hostname
Serial
Device Type
Current Holder when relevant
```

---

# 65. Navigation audit

Le workflow principal ne doit pas exiger :

```text
open profile
go back
search device
return to request
```

Request Workbench et Billing Workbench doivent être complets.

---

# 66. Mobile audit

Tester au minimum :

```text
Request Builder
Request Workbench
User 360
Customer 360
Billing Review
```

sur largeur mobile.

Les grandes tables doivent avoir une alternative cartes/scroll maîtrisé.

---

# 67. Empty states

Tous les écrans doivent avoir des états explicites :

```text
No device
No personal service
No available service
No open requests
No billing candidates
No blockers
No history
```

Pas des zones blanches.

---

# 68. Error states

Les erreurs métier doivent être compréhensibles.

Pas seulement :

```text
ValidationError
```

Exemple :

```text
LAPTOP-42 is currently assigned to Alice.
Use Transfer to assign it to Bob.
```

---

# 69. Observability

Les actions critiques doivent produire une trace exploitable.

Au minimum :

```text
actor
action
entity
timestamp
result
source request/work order when applicable
```

---

# 70. Audit Activity

Les activités importantes doivent pouvoir être retracées :

```text
Device assigned/transferred/repossessed
Service activated/suspended/resumed/closed
Request approved/executed/completed
Billing approved/invoiced
Customer profile changed
```

---

# 71. Release smoke tests

Avant chaque release :

```text
Login Admin
Login Technician
Login Customer Manager
Login Customer Operator

Create Customer
Create/Edit User
Assign Device
Transfer Device
Add Service
Suspend/Resume
Create Request
Execute Request
Create Billing Run
Create Invoice
```

sur une base de test réaliste.

---

# 72. Automated test layers

Construire trois niveaux.

## Unit/domain

```text
lifecycles
validators
calculations
permissions
```

## Integration

```text
Request → Work Order
Device → Holder
Service → Billing
Customer access
```

## E2E

```text
full UI/business workflows
```

---

# 73. Ne pas tout tester par snapshots frontend

Les scénarios métier critiques doivent vérifier l’état backend final.

Exemple :

Après Transfer :

```text
holder_log
assigned_client_user
device.status
services
```

pas seulement :

```text
“Bob” appears on screen
```

---

# 74. Release blockers

La release est bloquée si l’un de ces cas existe :

```text
cross-customer data leakage

duplicate active holders

duplicate open service assignments

Request mutates operational data before execution

Work Order double execution

Billing historical data changes after operational mutation

manual Billing exclusions lost

double billing possible

Customer Manager can edit commercial fields

Department free-text remains in new workflow

Request Workbench still requires Open Profile navigation
```

---

# 75. Migration blockers

Bloquer production si la migration trouve des données irrécupérables telles que :

```text
multiple holder periods impossible to order
service overlaps with contradictory billing history
ambiguous Customer ownership
submitted Billing history impossible to reconstruct safely
```

Les corriger manuellement avant continuation.

---

# 76. Release acceptance report

À la fin, produire un rapport structuré :

```text
PHASE 8 ACCEPTANCE

Device Lifecycle
PASS / FAIL

Service Lifecycle
PASS / FAIL

Request Builder
PASS / FAIL

Request Workbench
PASS / FAIL

User 360
PASS / FAIL

Customer Access
PASS / FAIL

Settings
PASS / FAIL

Billing
PASS / FAIL

Security
PASS / FAIL

Performance
PASS / FAIL

Migrations
PASS / FAIL
```

---

# 77. Final implementation order

Avec toutes nos specs finalisées, l’ordre global recommandé devient :

```text
1. Device Lifecycle
2. Service Lifecycle
3. Global Departments prerequisite
4. Request Intent / Client Builder
5. Request Execution Workbench
6. User 360
7. Customer Access Foundation
8. Customer 360
9. Remaining Settings cleanup
10. Billing Integrity
11. Billing Workbench
12. Phase 8 audit / migrations / E2E hardening
```

L’ordre peut chevaucher certains fronts React lorsque les APIs backend sont stabilisées.

---

# 78. Règle Codex générale

Chaque agent reçoit :

```text
exact task scope
relevant validated specs
dependencies already completed
files/modules expected
tests required
explicit non-goals
```

Ne jamais envoyer :

> “Implement Phase 4”

en une seule grosse tâche.

Les specs sont suffisamment détaillées pour travailler en unités petites et reviewables.

---

# 79. Review de chaque Task

Aucune Task Codex n’est considérée terminée simplement parce que l’agent dit :

```text
done
```

Pour chaque task :

```text
inspect diff
run relevant tests
review invariants
check migrations
check permissions
check old workflow removal
```

Puis seulement passer à la suivante.

---

# 80. Source de vérité des décisions

À partir de cette Phase 8 :

> les specs validées deviennent la référence du projet.

Le code legacy n’est pas une spécification.

L’addon Hassan n’est pas une spécification.

Les comportements accidentels actuels ne sont pas une spécification.

En cas de divergence :

```text
validated spec
→ wins
```

sauf décision explicite de modifier la spec.

---

# 81. Definition of Done globale du projet

Le projet est fonctionnellement considéré refondu lorsque :

### Customer

```text
Customer access is safe and coherent
```

### User

```text
User 360 tells the current truth
```

### Device

```text
holder history is authoritative
```

### Services

```text
ownership and periods are authoritative
```

### Requests

```text
client expresses intent simply
```

### Technician

```text
executes entirely inside Request Workbench
```

### Settings

```text
only real managed references are configurable
```

### Billing

```text
selection is flexible
history is immutable
calculation is period-correct
```

### Security

```text
no cross-customer leakage
```

### UX

```text
no unnecessary navigation between entities to finish a workflow
```

---

# 82. Final architectural statement

Le produit final doit suivre cette logique :

```text
CUSTOMER
   │
   ├── USERS
   │      │
   │      ├── USER SERVICES
   │      │
   │      └── HOLDS DEVICES
   │               │
   │               └── DEVICE SERVICES
   │
   ├── REQUESTS
   │      │
   │      └── EXECUTION WORKBENCH
   │
   └── CONTRACT
          │
          └── BILLING WORKBENCH
```

Et chaque domaine possède exactement une source de vérité.

---

# 83. Fin du cadrage

À partir de cette Phase 8, le travail principal ne doit plus être :

```text
brainstorm architecture
```

mais :

```text
implement
test
review
migrate
validate
```

Toute nouvelle idée découverte pendant l’implémentation doit être évaluée contre ces invariants avant d’être ajoutée.