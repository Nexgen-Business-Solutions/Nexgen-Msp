# Phase 4 — Request Technician Workbench

## 1. Vision produit

La page :

```text
/msp/requests/SR-2026-00125
```

devient le **poste de travail complet du technicien**.

Le technicien ne quitte jamais la Request pour l'exécuter.

Interdit dans le nouveau workflow :

```text
Open profile
Go to user
Open device
Register device elsewhere
Go to service assignment
Open work order
Complete details in another modal
```

Toutes les actions sont directement embarquées dans la Request.

---

# 2. Architecture UX globale

Le haut de la Request affiche un seul stepper métier :

```text
REVIEW
   ↓
PREPARE
   ↓
EXECUTE
   ↓
VERIFY
   ↓
COMPLETE
```

Ce ne sont pas cinq pages.

Ce sont cinq états/sections du même écran.

Le technicien travaille verticalement dans la Request.

---

# 3. Pourquoi ne pas faire une étape par Request Line

Une Request peut contenir :

```text
John
├── Add Microsoft 365
├── Resume VPN
├── Add RMM
├── Add Sophos
├── Change Backup
└── Close Adobe
```

Créer :

```text
Step 1 of 6
Step 2 of 6
...
```

serait mauvais.

Le stepper représente donc **les phases du travail**, pas les lignes.

À l'intérieur, les tâches sont regroupées intelligemment par :

```text
Person
→ Device
→ Service work
```

---

# 4. Exemple complet

Request :

```text
MARIE DUPONT
New User
Human Resources

+ Microsoft 365
+ VPN

DEVICE REQUIRED

+ Sophos Endpoint
+ RMM
```

Le technicien voit :

```text
1 REVIEW        ✓
2 PREPARE       ← current
3 EXECUTE
4 VERIFY
5 COMPLETE
```

Dans `PREPARE` :

```text
MARIE DUPONT

USER SETUP
[ Create user ]

DEVICE
[ Use stock device ]
[ Register new device ]
```

Une fois réalisé :

```text
MARIE DUPONT                         ✓ READY
CU-00482

DEVICE                              ✓ READY
LAPTOP-MDUPONT
SN: DELL-99283
```

Puis `EXECUTE` devient disponible.

---

# 5. La progression est dynamique

Les étapes inutiles sont automatiquement sautées.

### Existing User + existing Device

Request :

```text
John
Resume VPN
Add RMM to LAPTOP-JDOE
```

Aucune préparation nécessaire.

Stepper :

```text
Review      ✓
Prepare     ✓ No preparation required
Execute     ←
Verify
Complete
```

---

# 6. Stage 1 — REVIEW

Le Review actuel est conservé mais intégré au stepper.

Afficher :

```text
REVIEW REQUEST

ACME Corporation
SR-2026-00125
High Priority

JOHN DOE
Accounting

+ Adobe Acrobat
Rate configured
[ Approve ] [ Reject ]

VPN
Resume
Rate configured
[ Approve ] [ Reject ]

LAPTOP-JDOE
SN ABC123

+ RMM
Rate configured
[ Approve ] [ Reject ]
```

Les décisions sont faites directement ici.

---

# 7. Plus de barre globale remplie de boutons

Supprimer le modèle actuel :

```text
Start review
Approve request
Start work
Mark completed
```

dans le header.

Les actions apparaissent exactement au moment où elles sont utiles.

Exemple, après décision de toutes les lignes :

```text
3 approved
1 rejected

[ Approve request and prepare work ]
```

---

# 8. Transition Review automatique

Le premier :

```text
Approve line
```

ou :

```text
Reject line
```

peut automatiquement faire :

```text
Submitted
→
Under Review
```

Il n'est pas nécessaire de forcer un bouton supplémentaire :

```text
Start Review
```

---

# 9. Fin du Review

Quand toutes les lignes sont décidées :

```text
[ Approve request and prepare work ]
```

fait :

```text
Request.status = Approved
```

et génère immédiatement le plan d'exécution.

Si toutes les lignes sont rejetées :

```text
[ Reject request ]
```

avec raison obligatoire.

---

# 10. Work Orders : changement de rôle

`MSP Service Work Order` reste.

Mais il n'est plus une page vers laquelle le technicien est envoyé.

Il devient :

> l'enregistrement backend d'une unité de travail exécutée depuis la Request.

Architecture :

```text
Request UI
    ↓
RequestExecutionService
    ↓
Work Orders
    ↓
Lifecycle Services
```

Le frontend travaille avec un :

```text
Execution Plan
```

et non avec des URLs Work Order.

---

# 11. Trois types de travail

Étendre `MSP Service Work Order` avec :

```text
work_type
```

Valeurs :

```text
User Setup
Device Provisioning
Service Action
```

Nous n'avons pas besoin d'un Work Order `Verification`.

La vérification est une phase de chaque Work Order.

---

# 12. User Setup Work Order

Créé lorsque la Request concerne :

```text
is_new_user = 1
```

Plusieurs services pour Marie créent **un seul User Setup Work Order**.

Exemple :

```text
Marie
+ M365
+ VPN
+ Adobe
```

ne doit jamais créer trois Users ni trois tâches de création.

Un seul :

```text
WO
User Setup
Marie Dupont
```

---

# 13. Device Provisioning Work Order

Créé lorsqu'un device nécessaire n'est pas encore déterminé.

Exemple :

```text
Marie
DEVICE REQUIRED

+ Sophos
+ RMM
+ Backup
```

Un seul :

```text
WO
Device Provisioning
Marie
```

Pas :

```text
3 devices
```

parce que trois services Device ont été demandés.

---

# 14. Service Action Work Order

Une Request Line approuvée concernant un service produit un Service Action Work Order.

Exemple :

```text
Line 1 Add M365
→ WO Service Action

Line 2 Resume VPN
→ WO Service Action

Line 3 Add Sophos
→ WO Service Action
```

C'est ici que :

```text
ServiceLifecycleService
```

sera réellement appelé.

---

# 15. Amendement Phase 3 indispensable — `subject_key`

Ajouter à `MSP Service Request Line` :

```text
subject_key
Data
read_only
```

Le Request Builder crée une clé stable par personne.

Existing User :

```text
user:CU-00045
```

New User :

```text
new-user:uuid-1234
```

Toutes les lignes de Marie portent exactement le même `subject_key`.

---

# 16. Pourquoi `subject_key`

Avec :

```text
Marie
+ M365
+ VPN
+ Adobe
```

les trois lignes savent qu'elles représentent **la même personne à créer**.

On peut donc créer Marie une seule fois puis propager :

```text
client_user = CU-00052
requested_for_user = CU-00052
```

sur toutes les lignes ayant ce `subject_key`.

---

# 17. `device_requirement_key`

Ajouter également :

```text
device_requirement_key
Data
read_only
```

Existing Device :

```text
device:DEV-0023
```

Device pas encore déterminé :

```text
new-device:uuid-9982
```

Ainsi :

```text
Sophos
RMM
Backup
```

destinés au même futur laptop partagent le même :

```text
device_requirement_key
```

Un seul Device est provisionné.

---

# 18. Stage 2 — PREPARE

Cette étape répond à :

> Est-ce que toutes les personnes et toutes les machines dont nous avons besoin existent et sont correctement préparées ?

Elle ne touche pas encore aux Service Assignments.

---

# 19. Carte New User directement embarquée

Pas de `CreateUserModal`.

Afficher directement :

```text
┌──────────────────────────────────────────────┐
│ USER SETUP                                   │
│                                              │
│ Marie Dupont                                 │
│ Human Resources                              │
│ marie@acme.com                               │
│                                              │
│ Technical username                          │
│ [ mdupont                    ]               │
│                                              │
│ Portal access                                │
│ ☑ Requested                                  │
│                                              │
│ [ Create user ]                              │
└──────────────────────────────────────────────┘
```

Tout est fait ici.

---

# 20. Après création

La carte se transforme sans navigation :

```text
USER SETUP                              ✓ DONE

Marie Dupont
CU-00482
mdupont
Human Resources
marie@acme.com
```

Puis les autres tâches dépendantes deviennent automatiquement disponibles.

---

# 21. Ne jamais créer le User à partir d'une seule ligne

L'action :

```text
Create user
```

travaille sur :

```text
subject_key
```

et non :

```text
line.idx
```

Elle :

1. crée le `MSP Client User` ;
2. valide le département ;
3. configure le username si fourni ;
4. traite le portal access si demandé ;
5. renseigne toutes les Request Lines du même sujet ;
6. complète le User Setup Work Order.

Transaction unique.

---

# 22. Device Preparation

Pour un Device non résolu :

```text
DEVICE REQUIRED

For
Marie Dupont

Required for
Sophos Endpoint
RMM
```

Afficher directement deux choix :

```text
○ Use an existing stock device
○ Register a new device
```

---

# 23. Use stock device

Si sélectionné :

```text
USE STOCK DEVICE

Search by hostname / serial
[ __________________ ]

LAPTOP-STOCK-14
Dell Latitude 5450
SN: DELL-99881
Stock

[ Assign this device ]
```

Le backend appelle :

```text
DeviceLifecycleService.assign(...)
```

Pas de modification directe de :

```text
assigned_client_user
```

---

# 24. Réassigner un ancien device

Puisque Phase 1 le permet :

Si Marie avait déjà eu :

```text
LAPTOP-14
```

auparavant et qu'il est désormais Stock, le device peut être sélectionné normalement.

L'historique devient :

```text
Marie
Jan → Mar

Marie
Sep → ...
```

Aucune restriction spéciale.

---

# 25. Device détenu par quelqu'un d'autre

Ne jamais le transférer silencieusement.

Si le technicien sélectionne :

```text
LAPTOP-14
Currently held by John Doe
```

afficher :

```text
This device is currently assigned to John Doe.

Transferring it will close John's current holding period.

[ Cancel ]
[ Transfer to Marie ]
```

Puis appeler explicitement :

```text
DeviceLifecycleService.transfer(...)
```

---

# 26. Register New Device

Toujours dans le même bloc Request :

```text
REGISTER DEVICE

For
Marie Dupont

Device type
[ Laptop ▾ ]

Hostname
[ LAPTOP-MDUPONT ]

Serial number
[ DELL-938828 ]

Network interfaces
[ + Add interface ]

Effective date
[ 11/09/2026 ]

[ Register and assign ]
```

Pas de `AddDeviceModal`.

Pas de nouvelle page.

---

# 27. Register + Assign atomique

L'action :

```text
Register and assign
```

doit :

1. créer le `MSP Managed Device` ;
2. valider le serial unique ;
3. créer le holder correctement via Device Lifecycle ;
4. remplir toutes les Request Lines du même `device_requirement_key` ;
5. terminer le Device Provisioning Work Order.

---

# 28. Device Context après résolution

La carte devient :

```text
DEVICE                               ✓ READY

LAPTOP-MDUPONT
Dell Latitude 5450
Serial: DELL-938828

CURRENT HOLDER
Marie Dupont
Since Sep 11, 2026
```

Cette carte reste visible pendant les étapes suivantes.

---

# 29. Existing User + Existing Device

Si tout existe :

```text
JOHN DOE                              ✓ READY

LAPTOP-JDOE                           ✓ READY
SN ABC123
```

La Phase Prepare ne demande rien.

---

# 30. Dépendances automatiques

Exemple :

```text
New Marie
↓
Needs Laptop
↓
Sophos on Laptop
```

Le système comprend :

```text
Create Marie
       ↓
Prepare Device
       ↓
Add Sophos
```

Avant création de Marie :

```text
DEVICE
Waiting for user setup
```

Avant Device :

```text
Sophos
Waiting for device preparation
```

Ce n'est pas une erreur.

C'est une dépendance normale.

---

# 31. Ne pas utiliser `Blocked` pour une dépendance normale

`Blocked` doit signifier :

> quelque chose d'imprévu empêche le travail.

Pas :

> il faut terminer l'étape précédente.

Les dépendances normales sont représentées par :

```text
Waiting
```

dans l'Execution Plan UI.

Le statut Work Order peut rester `Open`, avec :

```text
ready = false
```

calculé par le backend.

Pas nécessaire d'ajouter `Waiting` au DocType si cela reste une propriété dérivée.

---

# 32. Stage 3 — EXECUTE

Une fois les prérequis prêts, montrer les Service Action Work Orders.

Exemple :

```text
EXECUTE

MARIE DUPONT

Microsoft 365
Add
User service
[ Execute ]

VPN
Add
User service
[ Execute ]


LAPTOP-MDUPONT
SN DELL-938828

Sophos Endpoint
Add
Device service
[ Execute ]

RMM
Add
Device service
[ Execute ]
```

---

# 33. Exécution directe

Cliquer :

```text
Execute
```

ne redirige nulle part.

Le backend appelle le bon service métier.

### Add

```text
ServiceLifecycleService.activate(...)
```

### Suspend

```text
ServiceLifecycleService.suspend(...)
```

### Resume

```text
ServiceLifecycleService.resume(...)
```

### Close

```text
ServiceLifecycleService.end(...)
```

### Change

```text
ServiceLifecycleService.change(...)
```

---

# 34. Exemple Add

Avant :

```text
Microsoft 365

Target
Marie Dupont

Action
Add

Effective date
Sep 15
```

Bouton :

```text
[ Activate service ]
```

Après :

```text
Microsoft 365                 ✓ EXECUTED

Active from Sep 15
Assignment SA-00492
```

Le lien vers `SA-00492` existe en backend.

Il n'est pas nécessaire d'envoyer le technicien vers sa page.

---

# 35. Suspend

```text
VPN

Current
Active since Jan 10

Requested action
Suspend

Effective date
Sep 15

[ Suspend service ]
```

Après :

```text
VPN                            ✓ EXECUTED

Suspended from Sep 15
```

---

# 36. Resume

```text
VPN

Suspended since
Sep 01

Resume from
Sep 15

[ Resume service ]
```

---

# 37. Close

```text
Microsoft 365

Active since
Jan 10

Requested close
Sep 30

[ Close service ]
```

Le backend respecte automatiquement les protections Billing de Phase 2.

---

# 38. Change

Afficher seulement les différences.

```text
MICROSOFT 365

Current
Quantity: 10

Requested
Quantity: 15

Effective
Sep 15

[ Apply change ]
```

Pas un formulaire complet du Service Assignment.

---

# 39. Exécution idempotente

Un double clic ou un retry réseau ne doit jamais :

```text
activate twice
create duplicate assignment
suspend twice
create duplicate device
```

Chaque action Work Order doit être idempotente.

Conceptuellement :

```text
if work already completed:
    return existing result
```

et les mutations doivent être transactionnelles.

---

# 40. Work Order → Request Line

Ajouter sur `MSP Service Work Order` :

```text
request_line_name
Data
read_only

request_line_idx
Int
read_only
```

`request_line_name` contient le `name` stable de la Child Row.

Ne pas utiliser uniquement `idx` comme identité métier.

`idx` est réservé à l'affichage.

---

# 41. Work Order shared setup

Pour :

```text
User Setup
```

le Work Order référence :

```text
subject_key
```

Pour :

```text
Device Provisioning
```

il référence :

```text
device_requirement_key
```

Ils ne sont donc pas obligatoirement attachés à une seule Service Request Line.

---

# 42. Modifications `MSP Service Work Order`

Ajouter :

```text
work_type
subject_key
device_requirement_key
request_line_name
request_line_idx
source_service_assignment
```

Et pour la traçabilité des résultats :

```text
resulting_client_user
resulting_device
resulting_assignment
```

---

# 43. `service_item` ne peut plus être toujours obligatoire

Actuellement le Work Order exige :

```text
service_item
```

Mais :

```text
User Setup
Device Provisioning
```

ne sont pas des services.

Nouvelle règle :

### Service Action

```text
service_item required
action required
```

### User Setup

```text
service_item empty
subject_key required
```

### Device Provisioning

```text
service_item empty
device_requirement_key required
```

---

# 44. Action Work Order

Étendre la sémantique :

### User Setup

```text
Create User
```

### Device Provisioning

```text
Assign Device
Register Device
Transfer Device
```

### Service Action

```text
Add
Change
Suspend
Resume
Remove
```

La décision `Assign/Register/Transfer` peut être choisie pendant l'exécution du Device Provisioning WO.

---

# 45. Technician assignment

Le Workbench peut avoir en haut :

```text
Execution

Lead technician
[ John Technician ▾ ]

Scheduled
[ Sep 11 ]

SLA
Today 17:00
```

Puis chaque tâche hérite du Lead Technician par défaut.

Un Work Order particulier peut être réassigné si nécessaire :

```text
Sophos
Assigned to: Peter
```

sans quitter la Request.

---

# 46. Claim work

Pour le technicien courant :

```text
[ Assign request to me ]
```

peut attribuer tous les Work Orders encore non assignés à lui.

C'est beaucoup plus pratique que modifier chaque tâche une par une.

---

# 47. Blocked

Chaque carte de travail dispose d'une action secondaire :

```text
[ Block ]
```

avec raison obligatoire.

Exemple :

```text
Sophos Endpoint

BLOCKED
Waiting for vendor license.

Blocked by Peter
Sep 11 14:32
```

Le Request reste :

```text
In Progress
```

---

# 48. Unblock

Directement dans la même carte :

```text
[ Resume work ]
```

Pas d'écran séparé.

---

# 49. Failed

Une tâche peut réellement échouer.

```text
[ Mark failed ]
```

raison obligatoire.

Mais `Failed` n'est pas considéré comme une fin silencieuse de la Request.

Le technicien ou superviseur doit ensuite :

```text
Retry
```

ou :

```text
Cancel this work item
```

avec justification.

---

# 50. Parent Request status

Les transitions deviennent largement automatiques.

### Request approved

```text
Approved
```

### Première vraie action de travail

```text
Approved
→
In Progress
```

Pas besoin du bouton global :

```text
Start work
```

---

# 51. Stage 4 — VERIFY

Après exécution :

```text
EXECUTE ✓
VERIFY ←
```

Le but est de vérifier les résultats, pas de collecter tardivement des informations qui auraient dû être saisies pendant Prepare.

Supprimer :

```text
DeliveryDetailsModal
```

---

# 52. Serial Number

Si un nouveau Device devait être enregistré :

le serial a déjà été saisi dans :

```text
PREPARE → Register Device
```

Donc Verify affiche :

```text
Device identity                ✓
LAPTOP-MDUPONT
SN DELL-938828
```

Il ne demande plus :

```text
Please enter serial to complete request.
```

---

# 53. Username

Même logique.

Si un compte technique est requis :

il a déjà été collecté pendant le User Setup ou le Service setup concerné.

Verify vérifie simplement :

```text
Technical account              ✓
mdupont
```

---

# 54. Les requirements techniques doivent être contextuels

Ne pas conserver éternellement la règle actuelle :

```text
User scoped service
→ username always required

Device scoped service
→ serial always required
```

À terme, le catalogue/service devrait indiquer ses requirements.

Mais pour cette Phase 4, les règles existantes peuvent être utilisées comme garde-fou tout en collectant l'information au bon moment.

---

# 55. Checklist

Le Child DocType existant :

```text
MSP Work Order Checklist Item
```

est utile ici.

Exemple Sophos :

```text
VERIFY SOPHOS ENDPOINT

✓ Assignment created
✓ Correct device
☐ Agent installed
☐ Device appears in Sophos console
☐ Protection status healthy
```

Les deux premiers peuvent être automatiques.

Les suivants peuvent être manuels.

---

# 56. Checklist spécifique au travail

Ne pas créer une gigantesque checklist générique pour toutes les actions.

Les étapes peuvent dépendre :

```text
work_type
service_item
action
```

Exemple M365 :

```text
☐ Account provisioned
☐ License visible
☐ User can authenticate
```

Sophos :

```text
☐ Agent installed
☐ Device reporting healthy
```

Device :

```text
☐ Serial verified
☐ Device assigned to correct user
```

---

# 57. Checklist templates

Une évolution intéressante est de permettre au catalogue de définir des templates de checklist.

Mais si ce modèle n'existe pas encore, ne pas bloquer Phase 4 dessus.

On peut initialement générer des checks standards selon :

```text
work_type
action
```

et utiliser le `checklist` existant.

---

# 58. Verification automatique

Le backend doit vérifier automatiquement ce qu'il peut prouver.

### User Setup

```text
Client User exists
department correct
```

### Device Provisioning

```text
Device exists
serial present
current holder correct
```

### Add Service

```text
resulting assignment exists
status Active
target correct
```

### Suspend

```text
assignment Suspended
```

### Resume

```text
assignment Active
```

### Close

```text
assignment Ended
```

Le technicien ne doit pas cocher manuellement ce que le système sait déjà.

---

# 59. Customer visible note

Chaque Work Item peut avoir :

```text
Customer note
[ ... ]
```

Exemple :

```text
Microsoft 365 activated successfully.
Credentials sent securely to the user.
```

Cette note reste dans le Work Order et peut alimenter la synthèse finale.

---

# 60. Internal execution notes

Séparément :

```text
Internal notes
[ ... ]
```

Le client ne voit pas ces informations.

---

# 61. Verify Work Item

Lorsque les validations automatiques sont correctes et les checks manuels terminés :

```text
[ Verify ]
```

fait :

```text
WO.status = Completed
completed_by
completed_at
```

---

# 62. `Awaiting Verification`

Après exécution technique :

```text
WO.status = Awaiting Verification
```

L'appel Lifecycle a donc déjà réussi.

Puis :

```text
Verify
→ Completed
```

Cela exploite enfin correctement le status déjà présent dans le DocType.

---

# 63. Stage 5 — COMPLETE

Lorsque tous les travaux approuvés sont Completed :

```text
COMPLETE REQUEST

3 people prepared
2 devices provisioned
7 service changes completed

JOHN DOE
✓ VPN resumed
✓ RMM activated

MARIE DUPONT
✓ User created
✓ Laptop assigned
✓ Microsoft 365 activated
✓ Sophos activated
```

---

# 64. Pas de `Mark completed` dans le header

Le bouton final se trouve uniquement ici :

```text
[ Complete request ]
```

Il représente réellement :

> j'ai vérifié l'ensemble du résultat et je clôture le dossier.

---

# 65. Garde de completion

Le backend refuse si :

```text
open work order
blocked work order
failed unresolved work order
unchecked mandatory verification
unresolved user/device target
```

Il ne doit plus faire une recherche tardive spécifique :

```text
missing serial
missing username
```

comme actuellement.

Ces exigences font partie du plan de travail.

---

# 66. Completion transaction

Finaliser :

1. vérifie tous les Work Orders ;
2. calcule la synthèse ;
3. passe Request → Completed ;
4. ajoute les timestamps ;
5. envoie la notification client ;
6. conserve toutes les traces.

---

# 67. Request Execution Plan API

Créer un service :

```text
request_execution_service.py
```

Responsabilités :

```text
build_execution_plan()
get_execution_plan()
execute_user_setup()
execute_device_provisioning()
execute_service_action()
block_work_item()
resume_work_item()
verify_work_item()
complete_request()
assign_technician()
```

Il orchestre.

Il ne réimplémente pas les lifecycles.

---

# 68. Orchestration correcte

Exemple Device :

```text
RequestExecutionService
        ↓
DeviceLifecycleService
```

Service :

```text
RequestExecutionService
        ↓
ServiceLifecycleService
```

User :

```text
RequestExecutionService
        ↓
UserService / dedicated creation domain
```

Puis il met à jour les Work Orders et les Request Lines.

---

# 69. Execution Plan creation idempotente

Appeler :

```text
build_execution_plan(SR-001)
```

deux fois doit toujours produire le même plan.

Pas :

```text
WO x 2
WO x 2
```

Créer une clé métier par Work Order.

Exemples :

```text
SR-001:user:new-user-uuid

SR-001:device:new-device-uuid

SR-001:service:<request-line-name>
```

---

# 70. Plan généré seulement pour les lignes Approved

Une ligne :

```text
Rejected
```

n'a aucun Service Action Work Order.

Elle apparaît dans la Request comme :

```text
Rejected during review
Reason: ...
```

et reste historique.

---

# 71. Propagation New User

Une fois Marie créée :

toutes les lignes :

```text
subject_key = new-user:X
```

reçoivent :

```text
client_user / requested_for_user
```

selon leur scope.

Les Work Orders dépendants deviennent `ready`.

---

# 72. Propagation Device

Une fois Laptop A déterminé :

toutes les lignes :

```text
device_requirement_key = new-device:Y
```

reçoivent :

```text
managed_device = DEV-0042
```

Les Service Actions Device deviennent `ready`.

---

# 73. Atomicité

Chaque action critique doit être transactionnelle.

Exemple Register Device :

```text
create device
assign holder
propagate request lines
complete WO
```

Si la propagation échoue :

aucun Device orphelin ne doit être laissé comme si l'action avait réussi.

---

# 74. Concurrency

Deux techniciens ne doivent pas pouvoir exécuter simultanément :

```text
Add M365
```

sur le même Work Order.

Utiliser verrouillage / état vérifié avant mutation.

Le deuxième reçoit :

```text
This work item was already completed by Peter at 14:32.
```

et la page se rafraîchit.

---

# 75. Request Workbench frontend

Remplacer l'organisation actuelle de `RequestDetail.tsx`.

Composants proposés :

```text
RequestWorkbench
RequestProgressStepper

ReviewStage
PreparationStage
ExecutionStage
VerificationStage
CompletionStage

SubjectWorkGroup
UserSetupWorkCard
DeviceProvisioningWorkCard
ServiceWorkCard
VerificationChecklist
RequestCompletionSummary
```

---

# 76. Aucun des composants suivants dans le nouveau Workbench

Supprimer de ce parcours :

```text
CreateUserModal
AddDeviceModal
DeliveryDetailsModal
Open profile button
```

Ces composants peuvent rester utilisés ailleurs si nécessaire.

Mais `RequestDetail` ne les utilise plus.

---

# 77. Structure visuelle

Sur desktop :

```text
┌─────────────────────────────────────────────────────────┐
│ SR-2026-00125   ACME   High                In Progress  │
│ Due today · Technician Peter                            │
├─────────────────────────────────────────────────────────┤
│ Review ✓ — Prepare ✓ — Execute ● — Verify — Complete    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ JOHN DOE                                                │
│ Accounting                                              │
│                                                         │
│ LAPTOP-JDOE · SN ABC123                                 │
│                                                         │
│ Microsoft 365                          ✓ Done            │
│ VPN Resume                              [ Execute ]       │
│ RMM · LAPTOP-JDOE                      [ Execute ]       │
│                                                         │
│ MARIE DUPONT                                             │
│ Human Resources                                          │
│                                                         │
│ User Setup                              ✓ Done            │
│ Device Setup                            ✓ Done            │
│ Microsoft 365                          [ Execute ]         │
│ Sophos · LAPTOP-MDUPONT                Waiting            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

# 78. User / Device / Serial restent toujours visibles

Quand une Service Action concerne un Device :

```text
SOPHOS ENDPOINT

Marie Dupont

LAPTOP-MDUPONT
Serial: DELL-938828

Action
Add

[ Activate service ]
```

Jamais simplement :

```text
Sophos
[ Execute ]
```

sans contexte.

---

# 79. Mobile

Sur mobile :

le stepper devient compact :

```text
3 / 5
Execute
```

Les Subject Groups s'empilent.

Chaque Work Card reste autonome.

Les actions restent dans la carte.

Aucune navigation secondaire n'est nécessaire.

---

# 80. Historique

Sous le stepper, prévoir un onglet/accordion :

```text
Activity
```

Exemple :

```text
14:02 Peter created Marie Dupont
14:07 Peter assigned LAPTOP-MDUPONT
14:12 Peter activated Microsoft 365
14:18 Sophos blocked — vendor license unavailable
14:52 Peter resumed Sophos
15:03 Sophos activated
```

L'historique est généré par les Work Orders + commentaires.

---

# 81. Scénario E2E critique A

Request :

```text
NEW MARIE
Accounting

M365
VPN
Needs Laptop
Sophos
```

Le technicien doit pouvoir faire **sans quitter la Request** :

```text
Review
↓
Approve

Prepare
↓
Create Marie
↓
Register Laptop
↓
Assign Laptop to Marie

Execute
↓
Activate M365
↓
Activate VPN
↓
Activate Sophos on Laptop

Verify
↓
Verify user
↓
Verify device
↓
Verify services

Complete
```

Zéro navigation.

---

# 82. Scénario E2E critique B

```text
John already exists
Laptop exists

VPN Suspended
RMM absent
```

Workflow :

```text
Review
↓
Prepare automatically skipped
↓
Resume VPN
↓
Add RMM
↓
Verify
↓
Complete
```

---

# 83. Scénario E2E critique C

```text
Marie
3 User services
4 Device services
```

Résultat :

```text
1 User created
1 Device created/assigned
7 Service Actions
```

Jamais :

```text
3 users
4 devices
```

---

# 84. Scénario E2E critique D

Device choisi :

```text
LAPTOP-17
Current holder = John
Request person = Bob
```

Le workflow doit afficher explicitement :

```text
Transfer John → Bob
```

avant toute Service Action.

Aucun changement silencieux de holder.

---

# 85. Scénario E2E critique E

Même Device déjà détenu historiquement par Bob :

```text
Bob
Jan → Mar

Stock

Request Bob
```

Assign :

```text
Bob
Sep → ...
```

fonctionne normalement.

C'est une régression obligatoire de Phase 1.

---

# 86. Scénario E2E critique F — Block

Sophos ne peut pas être activé.

Le technicien :

```text
Block
Reason: License unavailable from vendor
```

Le reste de la Request continue.

M365 peut être exécuté.

La Request reste :

```text
In Progress
```

Sophos est clairement visible comme blocker.

---

# 87. Tests backend minimum

Tester notamment :

```text
execution plan idempotent
one user WO per subject_key
one device WO per device_requirement_key
one service WO per approved service line

rejected lines create no WO

new user propagation
device propagation

service WO cannot run before dependencies
first execution changes Request to In Progress

DeviceLifecycle used for assign/transfer
ServiceLifecycle used for service actions

double execution doesn't duplicate records

blocked work can resume

verify refuses incomplete checklist
request completion refuses open work

completion succeeds when all work verified
```

---

# 88. Tests frontend minimum

Vérifier :

```text
No Open profile
No CreateUserModal
No AddDeviceModal
No DeliveryDetailsModal
No Work Order navigation

Review actions inside Review stage

User creation embedded

Device registration embedded

Stock device assignment embedded

Transfer confirmation embedded

Service action embedded

Block/resume embedded

Verification embedded

Final completion embedded
```

---

# 89. Definition of Done

Un technicien ouvre :

```text
SR-2026-00125
```

et peut terminer toute la Request sans ouvrir une autre page.

La Request contient tout ce qu'il lui faut :

```text
who
department
email
device
hostname
serial
current holder
current service state
requested action
dates
technical fields
checklist
results
notes
history
```

Et toutes les mutations métier se font via les services de domaine appropriés.

---

# 90. Règle produit définitive

> **La Request est l'interface de travail.**

> **Le Work Order est le moteur de traçabilité.**

> **Le Lifecycle Service est le moteur métier.**

Donc :

```text
REQUEST WORKBENCH
        ↓
WORK ORDER / EXECUTION PLAN
        ↓
DOMAIN LIFECYCLE
        ↓
DATA
```

Jamais :

```text
Request
→ Open Profile
→ Device page
→ Service page
→ Work Order page
→ back to Request
```

---

# 91. Découpage Codex recommandé

| Ordre | Travail | Agent | Reasoning |
|---:|---|---|---|
| 1 | Amend Phase 3 avec `subject_key` + `device_requirement_key` | Senior Frappe Backend | High |
| 2 | Étendre Work Order + Execution Plan generator | Senior Frappe Architect | High |
| 3 | RequestExecutionService + orchestration Lifecycle | Senior Backend | High |
| 4 | User + Device preparation actions | Senior Full-stack/Frappe | High |
| 5 | Service execution actions | Senior Backend | High |
| 6 | Nouveau Request Workbench + macro stepper | Senior React/UX | High |
| 7 | Verification/checklists/completion | Senior Full-stack | High |
| 8 | Concurrency + E2E métier | Senior QA/Backend | High |

---

# 92. Première Task Codex

Commencer par :

## Execution Plan Foundation

L'agent doit :

```text
add subject_key
add device_requirement_key

extend MSP Service Work Order

add work_type
add stable request-line reference
add resulting_client_user
add resulting_device
add source_service_assignment

create RequestExecutionService.build_execution_plan()

generate:
1 User Setup WO / new subject
1 Device Provisioning WO / unresolved device
1 Service Action WO / approved service line

make generation idempotent

implement readiness/dependency computation
```

Ne pas toucher encore au gros React.

Une fois ce moteur correct, le stepper React pourra afficher exactement le plan que le backend lui donne.