# Phase 5 — User 360° Operational View

## 1. Objectif

Transformer la fiche `MSP Client User` en une vue opérationnelle à 360° permettant de répondre immédiatement à :

```text
Qui est cette personne ?
Dans quel département travaille-t-elle ?
Quel est son statut ?
Quels services personnels possède-t-elle ?
Quels devices détient-elle actuellement ?
Quels services tournent sur chacun de ses devices ?
Y a-t-il quelque chose en attente ou en anomalie ?
Quelles Requests sont actuellement ouvertes pour elle ?
Quel est son historique récent ?
```

La page ne doit plus être une juxtaposition de tables techniques.

Elle devient une représentation de la **situation actuelle de la personne**.

---

# 2. Principe fondamental d'information

La hiérarchie devient :

```text
USER
│
├── PERSONAL SERVICES
│
├── CURRENT DEVICES
│     │
│     ├── Device A
│     │     └── Device Services
│     │
│     └── Device B
│           └── Device Services
│
├── OPEN REQUESTS
│
└── HISTORY
      ├── Past personal services
      ├── Past device holdings
      └── Completed requests
```

Ne plus utiliser :

```text
USER
├── Services mixed together
├── Devices table
└── Requests table
```

---

# 3. Bug d'ownership à supprimer définitivement

Le backend actuel récupère les services par :

```text
sa.client_user = John
OR
device.assigned_client_user = John
```

Cette logique doit disparaître de `UserDetail`.

Elle signifie implicitement :

> tout service appartenant à un device actuellement détenu par John appartient également à John.

C'est incorrect selon Phase 2.

---

# 4. Nouvelle séparation

Retourner séparément :

```text
personal_services
```

où :

```text
assignment_scope = User
client_user = John
```

et :

```text
current_devices[].services
```

où chaque service appartient exactement au device concerné.

---

# 5. Conséquence d'un Transfer

Exemple :

```text
January

LAPTOP-42
Alice
Sophos
```

Puis :

```text
September

LAPTOP-42
Bob
Sophos
```

La fiche Bob doit montrer :

```text
CURRENT DEVICE

LAPTOP-42
Sophos Active
```

parce que Sophos fonctionne actuellement sur son laptop.

Mais son historique personnel ne doit jamais dire :

```text
Bob had Sophos since January
```

Le service est historique du device, pas de Bob.

---

# 6. La fiche Alice après transfert

Alice ne doit plus avoir Laptop-42 dans :

```text
CURRENT DEVICES
```

Mais son History peut montrer :

```text
DEVICE HISTORY

LAPTOP-42
Held Jan 10 → Sep 02
```

Le service Sophos n'est pas transformé en ancien Personal Service d'Alice.

---

# 7. Nouvelle API

Refactorer :

```text
UserService.get_user()
```

ou créer une façade :

```text
User360Service.get_user()
```

Je recommande de conserver l'endpoint existant pour éviter une rupture inutile, mais de changer sa structure de réponse.

Conceptuellement :

```json
{
  "user": {},
  "summary": {},
  "personal_services": {},
  "devices": [],
  "open_requests": [],
  "history": {},
  "available_actions": {}
}
```

---

# 8. Header — Identity Card

Le haut doit devenir beaucoup plus lisible.

```text
┌─────────────────────────────────────────────────────────┐
│ JOHN DOE                              [ ACTIVE ]         │
│ Accounting                                              │
│ john.doe@acme.com                                       │
│ Username: jdoe                                          │
│                                                         │
│ ACME Corporation                                        │
│ In service since Jan 10, 2025                           │
│                                                         │
│ 2 devices    4 personal services    1 open request      │
│                                                         │
│ [ New Request ]                           [ Edit ]       │
└─────────────────────────────────────────────────────────┘
```

---

# 9. Ne pas mettre Billing au centre du header

Aujourd'hui :

```text
Billed up to
Last billed on
```

apparaît au même niveau que :

```text
Department
Email
Username
```

Ce n'est pas la priorité d'une fiche utilisateur opérationnelle.

Déplacer les informations financières dans une section :

```text
Billing & Coverage
```

plus bas ou dans un panneau secondaire.

---

# 10. Primary Action

L'action principale devient :

```text
[ New Request ]
```

pré-seedée avec :

```text
client_user = John
```

Elle ouvre le Request Builder de Phase 3 directement avec John sélectionné.

---

# 11. Pas de `Open profile`

Évidemment ici nous sommes déjà sur la fiche User.

Et lorsque cette fiche est ouverte depuis une Request :

ne pas recréer l'ancien workflow :

```text
Request
→ User page
→ perform action
→ back to Request
```

Le Workbench de Phase 4 doit tout exécuter lui-même.

Le paramètre actuel :

```text
?ref=SR-...
```

utilisé pour transformer la User page en extension de la Request doit être retiré du nouveau workflow.

---

# 12. Important — indépendance Request / User 360

User 360 sert à :

```text
understand
manage
inspect
start a new request
```

Request Workbench sert à :

```text
execute an existing request
```

Ne plus mélanger les deux responsabilités.

---

# 13. Quick Health Summary

Sous le header :

```text
CURRENT SITUATION

Personal services      4
Devices                2
Device services        5
Open requests          1
Attention needed       2
```

Mais éviter une série de grosses KPI cards inutiles.

Ces informations peuvent être des compact stats.

---

# 14. `Attention Needed`

C'est plus utile qu'un simple compteur.

Exemples :

```text
ATTENTION

⚠ LAPTOP-JDOE has no serial number
⚠ VPN suspension request awaiting approval
⚠ User is Disabled but has 2 open personal services
```

---

# 15. Attention backend

Le backend doit retourner des alertes structurées.

Exemple :

```json
{
  "code": "DEVICE_SERIAL_MISSING",
  "severity": "warning",
  "entity_type": "Device",
  "entity": "DEV-001",
  "message": "Serial number is missing."
}
```

Le React ne doit pas analyser arbitrairement 12 champs pour inventer ses propres règles métier.

---

# 16. Personal Services — section dédiée

Affichage :

```text
PERSONAL SERVICES                                      3 active

Microsoft 365
Active
Since Jan 10, 2026
Quantity 1

[ Suspend ] [ Change ] [ Close ]


VPN
Suspended
Since Sep 02, 2026

[ Resume ] [ Close ]


Adobe
Active
Since Feb 15, 2026

[ Change ] [ Suspend ] [ Close ]


AVAILABLE

+ Nextcloud
+ Premium Support
```

---

# 17. Available Services

Après Phase 2, l'API de disponibilité doit être réutilisée.

Ne plus renvoyer simplement :

```text
all Item where is_stock_item = 0
```

comme catalogue.

Retourner :

```text
current_personal_services
available_personal_services
```

déjà déterminés par les règles métier.

---

# 18. Actions Personal Service

Les actions visibles viennent de :

```text
ServiceLifecycle domain
```

selon le statut.

### Active

```text
Change
Suspend
Close
```

### Suspended

```text
Resume
Close
```

### Pending Setup

```text
No lifecycle action
```

si une Request/Work Order est déjà en cours.

---

# 19. Direct actions ou Request ?

Deux chemins sont légitimes mais doivent être explicitement distingués.

### Standard operation

```text
Request change
```

crée une Request préconfigurée.

### Administrative override

Pour certains rôles internes seulement :

```text
Apply directly
```

peut appeler le Lifecycle Service sans Request.

---

# 20. UX recommandée

Action normale :

```text
Microsoft 365
[ Change ]
```

peut ouvrir :

```text
How do you want to process this?

○ Create a service request
○ Apply directly
```

Mais je recommande encore plus simple :

```text
[ Request change ]
```

comme comportement standard.

Et :

```text
More
└── Apply directly
```

réservé aux rôles autorisés.

---

# 21. Pourquoi ne pas transformer User 360 en second Workbench

Si toutes les actions deviennent immédiatement exécutables partout :

```text
User page
Device page
Request page
Service page
```

on recrée quatre workflows concurrents.

La Request doit rester le workflow standard.

Les actions directes hors Request doivent être considérées comme :

```text
administrative operations
```

et non le parcours normal.

---

# 22. Current Devices — pas une table

Les machines doivent être des cartes.

Exemple :

```text
┌────────────────────────────────────────────────────┐
│ LAPTOP-JDOE                              ACTIVE    │
│ Dell Latitude 5450                                 │
│ Serial: DELL-93821                                 │
│                                                     │
│ Held since Sep 11, 2026                            │
│                                                     │
│ NETWORK                                             │
│ Wi-Fi   00:11:22:33:44:55                          │
│ LAN     AA:BB:CC:DD:EE:FF                          │
│                                                     │
│ DEVICE SERVICES                                     │
│ Sophos Endpoint                     Active          │
│ RMM                                 Active          │
│ Backup                              Suspended       │
│                                                     │
│ AVAILABLE                                           │
│ + BitLocker Management                              │
│                                                     │
│ [ Request change ]                  [ Device menu ] │
└────────────────────────────────────────────────────┘
```

---

# 23. Serial Number très visible

Le serial ne doit plus être perdu dans une colonne.

Toujours montrer ensemble :

```text
Hostname
Device Type
Serial Number
Holder Since
```

comme contexte principal du device.

C'est cohérent avec la règle déjà posée dans Request et Workbench.

---

# 24. Holder Since

Ne plus utiliser :

```text
device.assigned_date
```

pour dire depuis quand John détient l'appareil.

Utiliser la ligne actuelle :

```text
holder_log.from_date
```

de Phase 1.

Afficher :

```text
Held by John since Sep 11, 2026
```

---

# 25. `In Service Since`

Si utile, afficher séparément :

```text
Device in service since:
Jan 05, 2025
```

à partir de l'ancien :

```text
assigned_date
```

renommé selon Phase 1.

Ne jamais confondre les deux.

---

# 26. Device Service directement sous le Device

Un service Device ne doit plus apparaître dans la section :

```text
Personal Services
```

Il apparaît exclusivement sous le device concerné.

---

# 27. Device actions

Menu contextuel :

```text
Device actions

Request service change
Transfer
Repossess
Report damaged
Retire
```

selon l'état.

Mais les actions normales doivent soit :

```text
seed a Request
```

soit être explicitement administratives.

---

# 28. Plus de `Manage device → Devices List?q=...`

Le comportement actuel :

```text
Manage device
→ /msp/devices?q=hostname
```

est particulièrement indirect.

Supprimer.

Si l'utilisateur veut inspecter plus profondément la machine :

```text
View full device record
```

peut aller directement :

```text
/msp/devices/DEV-001
```

si une Device Detail existe.

Mais le User 360 doit déjà fournir l'essentiel.

---

# 29. Device Availability

Chaque Device card peut afficher ses services disponibles directement.

Exemple :

```text
AVAILABLE DEVICE SERVICES

+ Sophos
+ Backup
```

La disponibilité est par Device.

Sophos présent sur Laptop A ne bloque pas Laptop B.

---

# 30. User avec plusieurs Devices

Exemple :

```text
CURRENT DEVICES

Laptop-JDOE
├ Sophos
├ RMM
└ Backup

Phone-JDOE
├ Mobile Security
└ MDM
```

La page doit rester naturellement compréhensible.

---

# 31. Aucun Device

Empty state :

```text
DEVICES

John currently holds no device.

[ Request a device ]
```

Pas seulement :

```text
No device assigned.
```

---

# 32. Device History

Séparer les anciens appareils.

```text
PAST DEVICES

LAPTOP-17
Held Jan 12 → Jun 04, 2025

LAPTOP-42
Held Aug 10 → Sep 02, 2026
```

Source :

```text
MSP Device Holder
```

et non `assigned_client_user`.

---

# 33. Repeated Holder periods

Si John a détenu le même device deux fois :

```text
LAPTOP-17

Jan 10 → Mar 15
Sep 11 → Current
```

l'historique doit le représenter correctement.

Ne pas dédupliquer seulement sur Device Name.

---

# 34. History architecture

Ne pas charger 1000 événements dans la page initiale.

Afficher :

```text
HISTORY

Recent activity
```

avec par exemple les 20 derniers événements.

Puis :

```text
[ Load older activity ]
```

---

# 35. Activity Timeline

Un timeline est plus pertinent que trois énormes tables historiques.

Exemple :

```text
SEP 11

Laptop-JDOE assigned
SN DELL-93821

RMM activated on Laptop-JDOE
via SR-2026-00125


SEP 02

VPN suspended
via SR-2026-00104


AUG 28

Request SR-2026-00104 submitted
```

---

# 36. Sources d'activité

La timeline peut combiner :

```text
Service lifecycle events
Device holder events
Requests
Work Order results
User lifecycle changes
Remarks
```

Ne pas reconstruire les événements depuis `modified` si une source métier existe déjà.

---

# 37. Open Requests — priorité opérationnelle

Les Requests ouvertes doivent apparaître **avant l'historique**.

Exemple :

```text
OPEN REQUESTS

SR-2026-00125                     IN PROGRESS
+ Microsoft 365
+ Sophos on LAPTOP-JDOE

Technician: Peter
3 / 5 work stages
Updated 24 min ago


SR-2026-00131                     AWAITING APPROVAL
Suspend VPN
```

---

# 38. Request detection doit utiliser Phase 3

L'actuelle query :

```text
where srl.client_user = John
```

n'est plus suffisante.

Une Request peut concerner John par :

```text
client_user
requested_for_user
subject_key
```

et une Device line possède :

```text
requested_for_user = John
managed_device = Laptop
```

Elle doit apparaître sur la User 360.

---

# 39. New User Request historique

Une fois un New User créé par Phase 4 :

les Request Lines correspondantes doivent avoir été propagées vers :

```text
requested_for_user = created user
```

Donc la Request apparaît naturellement dans son historique.

---

# 40. Requests ouvertes vs historiques

Séparer :

```text
OPEN REQUESTS
```

et :

```text
REQUEST HISTORY
```

Le premier est opérationnel.

Le second peut être dans la timeline / History.

---

# 41. Pending service action

Un service peut afficher directement :

```text
Microsoft 365
Active

Change requested
SR-2026-00125 · In Progress
```

et désactiver une action contradictoire.

Phase 3 avait déjà introduit la pending-request awareness.

User 360 doit réutiliser exactement la même information.

---

# 42. User lifecycle state

Les statuts :

```text
Pending
Active
Disabled
Archived
```

doivent réellement changer la page.

---

# 43. Pending User

Afficher :

```text
PENDING

User has not been fully activated yet.
```

Services disponibles peuvent exister selon Phase 2.

Actions adaptées.

---

# 44. Disabled User

Le header devient :

```text
JOHN DOE                       DISABLED
Disabled Sep 01, 2026
```

Et si des éléments actifs restent :

```text
ATTENTION

2 personal services are still open.
1 device is still assigned to this user.
```

Ce sont des anomalies métier importantes.

---

# 45. Archived User

Une personne Archived est surtout historique.

Masquer les CTA :

```text
Add service
Add device
```

du chemin normal.

Afficher :

```text
Archived users cannot receive new services or devices.
```

---

# 46. Lifecycle actions User

Il faut clarifier les vraies actions :

```text
Activate
Disable
Archive
Restore
```

si toutes existent dans le domaine actuel.

Ne pas laisser les changements de `lifecycle_status` être de simples dropdowns génériques.

---

# 47. Disable User — impacts visibles avant confirmation

Exemple :

```text
DISABLE JOHN DOE

Current personal services
Microsoft 365
VPN

Current devices
LAPTOP-JDOE

Disabling the user does NOT automatically close these resources.

[ Cancel ]
[ Disable user ]
```

ou, si une future règle décide le contraire, l'UI doit l'expliquer.

Aucun side effect implicite.

---

# 48. Edit Details

`EditClientUserModal` peut être simplifiée.

Champs métier :

```text
Full name
Email
Department
Username
Portal access
```

Department utilise bien sûr :

```text
MSP Department Select
```

plus de texte libre.

---

# 49. Portal access

Le header peut afficher :

```text
Portal access
Enabled
```

ou :

```text
Not enabled
```

uniquement aux administrateurs internes.

Ne pas surcharger la vue client.

---

# 50. Remarks

Le `RemarkLog` actuel reste utile.

Mais ne pas lui consacrer systématiquement un grand panneau tout en haut.

Je recommande :

```text
Internal Notes
```

en sidebar/panneau secondaire.

Dernière note visible :

```text
Latest internal note
Needs special approval for premium licenses.

[ View all notes ]
```

---

# 51. Billing & Coverage

Section secondaire :

```text
BILLING & COVERAGE

Last billed through
Aug 31, 2026

Last invoice activity
Sep 01, 2026
```

Mais prudence :

la Phase 7 corrigera encore les snapshots historiques.

Phase 5 ne doit pas créer de nouvelle logique Billing.

---

# 52. Correction importante de `last_billed_on`

L'actuel fallback détermine certaines billing lines Device via :

```text
device.assigned_client_user = current user
```

C'est historiquement dangereux.

Ne plus utiliser le détenteur **actuel** pour décider qu'une ancienne Billing Run Line appartient à John.

Pour Phase 5 :

privilégier les champs déjà stockés/snapshotés.

Si la donnée fiable n'existe pas encore :

afficher uniquement le Billing personnel certain.

La Phase 7 fera la correction complète.

---

# 53. User Service counts

Même correction pour :

```text
active_services
inactive_services
```

dans la Users List.

Actuellement un Service Device est compté à partir du current holder.

Pour une vue opérationnelle :

on peut effectivement compter séparément :

```text
personal_services
device_services_on_current_devices
```

mais ne jamais les appeler indistinctement :

```text
John's services
```

---

# 54. Users List — petite extension de Phase 5

Même si la Phase concerne principalement User Detail, la liste doit refléter le nouveau modèle.

Colonnes recommandées :

```text
User
Department
Status
Current Devices
Personal Services
Device Services
Open Requests
Attention
```

Pas une colonne énorme contenant tous les noms de services concaténés.

---

# 55. Search

La recherche Users doit couvrir :

```text
Full name
Email
Username
Department
Current device hostname
Current device serial
```

Cela reste très utile.

---

# 56. Coverage filters

Remplacer progressivement les filtres ambigus actuels.

Exemples :

```text
No device
No personal service
Device without services
Disabled with active resources
Open requests
Needs attention
```

---

# 57. Backend DTO cible

Conceptuellement :

```json
{
  "user": {
    "name": "CU-001",
    "full_name": "John Doe",
    "email": "john@acme.com",
    "username": "jdoe",
    "department": "Accounting",
    "customer": "ACME",
    "lifecycle_status": "Active",
    "start_date": "2025-01-10"
  },

  "summary": {
    "current_devices": 2,
    "active_personal_services": 3,
    "active_device_services": 5,
    "open_requests": 1,
    "attention_count": 1
  },

  "personal_services": {
    "current": [],
    "available": [],
    "history": []
  },

  "devices": [
    {
      "device": {},
      "holder_since": "...",
      "interfaces": [],
      "services": {
        "current": [],
        "available": []
      }
    }
  ],

  "open_requests": [],

  "attention": [],

  "recent_activity": []
}
```

---

# 58. Pas de données inutiles

L'actuelle `get_user()` renvoie également :

```text
all catalogue Items
last 30 customer requests
all device types
all interface types
```

parce que ses modales ont besoin de tout.

Après refonte, ces données n'ont aucune raison d'être chargées au premier affichage.

Supprimer du payload initial :

```text
catalogue global
customer_requests
device_types
interface_types
```

Les actions qui en ont besoin appellent leurs APIs spécialisées.

---

# 59. Impact performance

Cette réduction est importante.

Actuellement ouvrir John peut charger des données concernant :

```text
whole service catalogue
30 unrelated customer requests
device configuration options
```

qui n'ont rien à voir avec l'affichage de John.

User 360 ne charge que :

```text
John
current resources
open work
small recent history
```

---

# 60. Lazy loading

Charger au départ :

```text
identity
summary
current personal services
current devices + current device services
open requests
attention
```

Charger à la demande :

```text
full service history
past devices
full request history
remarks history
billing history
```

---

# 61. Internal vs Portal

Le Portal User Detail doit utiliser la même structure métier.

Mais avec moins d'actions et moins de données internes.

---

# 62. Portal User 360

Exemple :

```text
JOHN DOE
Accounting

CURRENT SERVICES
Microsoft 365
VPN

DEVICES

LAPTOP-JDOE
SN ABC123

Sophos
RMM

OPEN REQUESTS
SR-00125 · In progress

[ Request a change ]
```

---

# 63. Portal : ne pas afficher

Masquer :

```text
internal notes
delete controls
raw billing metadata
admin override actions
technical DB identifiers
internal work order details
```

---

# 64. Portal : même ownership

Il faut corriger également :

```text
PortalService.get_user_detail()
```

qui utilise encore :

```text
sa.client_user = user
OR
device.assigned_client_user = user
```

Même séparation que l'interne :

```text
personal_services
devices[].services
```

---

# 65. Request CTA Portal

Depuis un Personal Service :

```text
[ Request change ]
```

seed :

```text
client_user
source_service_assignment
```

Depuis Device :

```text
[ Request change ]
```

seed :

```text
client_user
managed_device
```

Le Request Builder Phase 3 comprend ensuite le contexte.

---

# 66. Device CTA Portal

Pour :

```text
LAPTOP-JDOE
```

afficher par exemple :

```text
[ Request service/change ]
```

Pas :

```text
Manage device
```

Le client exprime un besoin ; il n'administre pas l'asset.

---

# 67. Mobile

La page doit être pensée d'abord comme une succession de cartes.

Ordre mobile :

```text
Identity
Attention
Open Requests
Personal Services
Devices
History
```

Les services Device restent à l'intérieur de leurs Device cards.

---

# 68. Pas de tables horizontales sur mobile

Éviter :

```text
Service | Device | Since | End | Billing | Status | ...
```

Le contenu métier fonctionne mieux sous forme de cartes compactes.

---

# 69. Business scenario A

John possède :

```text
Personal
M365 Active
VPN Suspended

Laptop A
Sophos Active
RMM Active

Laptop B
Sophos Active

1 open Request
```

La page doit rendre cette structure exactement telle quelle.

---

# 70. Business scenario B — Transfer

Avant :

```text
Alice
Laptop A
Sophos
```

Transfer vers Bob.

Après :

### Alice

```text
Current Devices
none

Past Devices
Laptop A
until Sep 11
```

### Bob

```text
Current Devices
Laptop A

Device Services
Sophos
```

Aucun historique Sophos n'est déplacé dans l'histoire personnelle.

---

# 71. Business scenario C — Repossession

John :

```text
Laptop A
Sophos
```

Repossession.

Après :

```text
John
Current Devices: none

Past Devices
Laptop A
until Sep 11
```

Sophos continue d'exister sur :

```text
Laptop A / Stock
```

mais ne figure plus comme service actuel visible sous John.

---

# 72. Business scenario D — Same holder again

```text
John
Laptop A Jan → Mar

Stock

John
Laptop A Sep → current
```

User 360 :

```text
Current Device
Laptop A
Held since Sep

Device History
Laptop A
Jan → Mar
```

Parfaitement valide.

---

# 73. Business scenario E — Disabled User

John devient Disabled mais possède encore :

```text
M365 Active
Laptop A Active holder
```

Afficher immédiatement :

```text
ATTENTION

John is disabled but still has:
1 personal service
1 current device
```

Ne pas cacher le problème.

---

# 74. Business scenario F — Open Request

M365 est Active.

Une Request :

```text
Close M365
Approved
In Progress
```

La carte montre :

```text
Microsoft 365
Active

Closure in progress
SR-00125

[ View request ]
```

Et ne propose pas une deuxième fermeture.

---

# 75. Tests backend obligatoires

Tester notamment :

| Scenario | Expected |
|---|---|
| User service | apparaît dans Personal Services |
| Device service | apparaît uniquement sous son Device |
| Two devices | services correctement séparés |
| Device transfer | service apparaît sous nouveau current holder context |
| Previous holder | service Device absent des current services |
| Repossession | Device quitte Current Devices |
| Reassignment same user | holder_since correspond à nouvelle période |
| Past device | apparaît dans History |
| Request User line | apparaît sur User |
| Request Device line + `requested_for_user` | apparaît sur User |
| Open Request | apparaît séparément de History |
| Pending service request | action contradictoire non proposée |
| Disabled + active resources | attention générée |
| Archived | nouvelles actions refusées |
| Personal service availability | Phase 2 respectée |
| Device availability | calculée par Device |
| Portal | même ownership rules |
| Portal cross-customer | refus |
| Initial payload | ne contient plus tout le catalogue Customer |

---

# 76. Tests frontend obligatoires

Vérifier :

```text
Identity visible immediately

Department prominent

Personal Services separate

Current Devices as cards

Serial visible

Holder since correct

Device Services nested

Available Device services nested

Open Requests above history

Attention visible only when needed

Past Devices separated

No generic mixed Services table

No "Manage device → search list"

No Request ref workflow back-and-forth

Mobile cards readable
```

---

# 77. Definition of Done

On doit pouvoir ouvrir John et comprendre sa situation sans naviguer ailleurs :

```text
JOHN DOE
Accounting
Active

PERSONAL
M365 Active
VPN Suspended

DEVICES

LAPTOP-JDOE
SN ABC123
Held since Sep 11

Sophos Active
RMM Active

PHONE-JDOE
SN XYZ998
Held since Aug 4

MDM Active

OPEN REQUEST
SR-00125
Close VPN
In Progress

ATTENTION
None
```

Cette information doit être compréhensible en quelques secondes.

---

# 78. Règle architecturale finale

La User 360 ne possède pas les Services Device.

Elle ne fait que les afficher dans le contexte des Devices actuellement détenus.

Donc :

```text
User
→ owns User Service
```

et :

```text
User
→ currently holds Device
→ Device owns Device Service
```

Cette distinction doit être visible dans :

```text
backend
API
UI
history
filters
counts
Portal
```

---

# 79. Ce que Phase 5 ne doit pas faire

Ne pas modifier :

```text
Device Lifecycle
Service Lifecycle
Request Workbench
Department catalogue
Billing engine
```

Elle consomme ces systèmes.

Ne pas recréer leurs règles.

---

# 80. Découpage Codex recommandé

| Ordre | Travail | Agent | Reasoning |
|---:|---|---|---|
| 1 | Refactor `UserService.get_user()` ownership + DTO | Senior Frappe Backend | High |
| 2 | Request/open-work aggregation + attention engine | Senior Backend | High |
| 3 | Device holding history + current holder dates | Senior Frappe Backend | Medium–High |
| 4 | Rebuild Internal `UserDetail.tsx` | Senior React/UX | High |
| 5 | Portal User 360 | Senior React/Full-stack | Medium–High |
| 6 | Users List counters/filters cleanup | Full-stack | Medium–High |
| 7 | Performance/lazy loading | Senior Full-stack | Medium |
| 8 | Business scenario tests | QA/Full-stack | High |

---

# 81. Première Task Codex

## User 360 Backend Foundation

L'agent commence uniquement par le backend.

Il doit :

```text
refactor UserService.get_user()

separate:
personal_services
current_devices[].services

derive holder_since from holder history

return open_requests using:
client_user
requested_for_user

add device history

add attention signals

remove unrelated global catalogue/customer request payload

reuse Service Lifecycle availability

preserve permissions

add backend regression tests
```

Ne pas encore refaire `UserDetail.tsx`.

Le frontend doit être construit seulement lorsque la nouvelle représentation métier est stable.