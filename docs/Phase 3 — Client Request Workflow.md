# Phase 3 — Client Request Workflow

## 1. Objectif

Refondre complètement la création d’une `MSP Service Request` côté client afin qu’elle soit :

- guidée ;
- contextuelle ;
- beaucoup plus courte ;
- cohérente avec l’état réel des services ;
- cohérente avec le Device Lifecycle de Phase 1 ;
- cohérente avec le Service Lifecycle de Phase 2 ;
- exempte de saisie technique inutile.

Le client doit exprimer :

> **Pour qui ? Qu’est-ce que je veux changer ? Quand ?**

Le technicien déterminera ensuite :

> **Comment l’exécuter techniquement ?**

---

# 2. Problèmes confirmés dans le workflow actuel

Le formulaire actuel fonctionne comme un formulaire de données plutôt que comme un workflow métier.

Aujourd’hui on peut sélectionner indépendamment :

```text
Service
[ Microsoft 365 ]

Action
[ Add / Change / Suspend / Resume / Remove ]
```

sans que l’interface tienne réellement compte de l’état courant du service.

Cela permet conceptuellement :

```text
Microsoft 365 déjà Active
→ Add

Sophos jamais installé
→ Resume

VPN Suspended
→ Suspend
```

Ces combinaisons ne doivent même plus pouvoir être proposées.

---

Autre problème :

```text
Services = [A, B, C]
Action = Remove
```

Le formulaire groupe plusieurs services sous une action unique.

Or A peut être Active, B Suspended et C absent.

**Chaque intention métier doit devenir une Request Line indépendante.**

---

# 3. Principe fondamental

Le nouveau Request Builder ne demande plus :

```text
Choose service
Choose action
Choose scope
```

Il montre l’état réel et laisse l’utilisateur agir dessus.

Exemple :

```text
JOHN DOE
Accounting
john@acme.com

PERSONAL SERVICES

Microsoft 365
Active
[ Change ] [ Suspend ] [ Close ]

VPN
Suspended
[ Resume ] [ Close ]


AVAILABLE SERVICES

+ Adobe Acrobat
+ Nextcloud
```

Les actions sont **embarquées directement avec le service concerné**.

---

# 4. Le scope n’est plus choisi manuellement

Le client ne doit plus voir :

```text
Scope
○ User
○ Device
```

Le contexte détermine le scope.

Si l’utilisateur clique :

```text
PERSONAL SERVICES
+ Microsoft 365
```

alors :

```text
target_scope = User
```

S’il clique :

```text
LAPTOP-JDOE
+ Sophos Endpoint
```

alors :

```text
target_scope = Device
```

Pour un service catalogue `Both`, il peut apparaître dans les deux sections.

Le lieu où l’utilisateur clique détermine sa cible réelle.

---

# 5. Nouveau workflow global

Je recommande un stepper en quatre étapes :

```text
1. PERSON
      ↓
2. CHANGES
      ↓
3. WHEN & DETAILS
      ↓
4. REVIEW
```

La première expérience est optimisée pour une personne.

Il reste possible d’ajouter une deuxième personne à la même Request via :

```text
[ + Add another person ]
```

mais le chemin principal reste simple.

---

# 6. Étape 1 — Person

Écran :

```text
WHO IS THIS REQUEST FOR?

○ Existing user
○ New user
```

---

# 7. Existing User

Afficher un Select searchable :

```text
User
[ Search or select a user ]
```

Une fois John sélectionné, ne pas afficher simplement son nom.

Afficher immédiatement une vraie carte contexte :

```text
┌─────────────────────────────────────────────┐
│ JOHN DOE                                    │
│ Accounting                                  │
│ john.doe@acme.com                           │
│                                             │
│ Status: Active                              │
│                                             │
│ DEVICES                                     │
│ Laptop-JDOE                                 │
│ Serial: ABC-493022                          │
│ Dell Latitude 5450                          │
└─────────────────────────────────────────────┘
```

Cela répond directement au besoin :

> l'utilisateur, device et serial doivent apparaître dans un cadre visible.

---

# 8. Plusieurs Devices

Si John possède plusieurs devices :

```text
JOHN DOE

DEVICES

┌ Laptop-JDOE ─────────────────┐
│ SN: ABC123                   │
│ Dell Latitude 5450           │
└──────────────────────────────┘

┌ Phone-JDOE ──────────────────┐
│ SN: IPH92812                 │
│ iPhone                       │
└──────────────────────────────┘
```

Ils doivent tous être visibles.

Ne plus afficher simplement :

```text
Device: Laptop A, Laptop B
Serial: XXX, YYY
```

dans une chaîne agrégée comme actuellement.

---

# 9. New User

Le client remplit uniquement les informations réellement métier :

```text
NEW USER

Full name *
[ Marie Dupont ]

Department *
[ Accounting ▾ ]

Email
[ marie@acme.com ]
```

`Department` utilise la spec globale déjà validée :

```text
MSP Department
```

Aucune saisie libre.

---

# 10. Informations supprimées côté client

Supprimer du portail :

```text
Username
Hostname
Serial Number
MAC Address
Asset Number
technical identifiers
```

Le client ne doit plus fournir :

```text
new_user_username
new_device_label
new_device_serial
```

Le `Device Type` ne doit pas non plus être obligatoire.

Ces champs peuvent rester dans les DocTypes pour l’exécution technicien.

Mais ils ne font plus partie de la création normale d’une Request portail.

---

# 11. Effet important sur le backend

La méthode actuelle :

```python
PortalService._record_supplied_facts()
```

ne doit plus modifier :

```text
MSP Client User.username
MSP Managed Device.serial_number
```

au moment où le client soumet une Request.

Principe :

> Soumettre une Request ne modifie jamais directement la réalité opérationnelle.

Une Request peut créer :

```text
MSP Service Request
MSP Service Request Line
notifications
approval events
```

mais elle ne modifie pas encore :

```text
Client User
Managed Device
Service Assignment
Holder
```

Ces mutations appartiennent à la Phase 4.

---

# 12. Étape 2 — Changes

Pour un Existing User, le backend renvoie un contexte complet.

La page montre deux grands espaces :

```text
PERSONAL SERVICES

DEVICES & DEVICE SERVICES
```

---

# 13. Personal Services

Exemple :

```text
PERSONAL SERVICES

CURRENT

Microsoft 365
Active since Jan 10
[ Change ] [ Suspend ] [ Close ]

VPN
Suspended since Sep 02
[ Resume ] [ Close ]


AVAILABLE

[ + Adobe Acrobat ]
[ + Nextcloud ]
```

Cela remplace complètement le dropdown actuel :

```text
Services
[ Select service ]
```

---

# 14. Actions autorisées selon l’état

La Phase 2 devient la source de vérité.

Exemple de règles portail :

| Service state | Actions proposées |
|---|---|
| Absent / Ended / Cancelled | Add |
| Active | Change · Suspend · Remove |
| Suspended | Resume · Remove |
| Pending Setup | aucune nouvelle action |
| Pending Removal | aucune nouvelle action |

Les intitulés visibles ne doivent pas nécessairement être hardcodés.

Ils viennent des :

```text
MSP Request Action
```

actifs.

Leur :

```text
action_type
```

détermine la transition mécanique.

---

# 15. Exemple avec Request Actions configurables

Supposons :

```text
Title: Add service
action_type: Add

Title: Temporarily suspend
action_type: Suspend

Title: Terminate service
action_type: Remove
```

L’UI montre :

```text
Microsoft 365

[ Change ]
[ Temporarily suspend ]
[ Terminate service ]
```

Le client ne manipule jamais directement `action_type`.

---

# 16. Device Services

Sous les services personnels :

```text
DEVICES
```

Chaque Device possède sa propre zone.

Exemple :

```text
┌──────────────────────────────────────────┐
│ LAPTOP-JDOE                              │
│ Serial: ABC123                           │
│ Dell Latitude 5450                       │
│ Held by John Doe                         │
│                                          │
│ SERVICES                                 │
│                                          │
│ Sophos Endpoint                          │
│ Active                                   │
│ [ Suspend ] [ Close ]                    │
│                                          │
│ RMM                                      │
│ Active                                   │
│ [ Suspend ] [ Close ]                    │
│                                          │
│ AVAILABLE                                │
│ + Backup Agent                           │
│ + BitLocker Management                   │
└──────────────────────────────────────────┘
```

Le service appartient toujours au Device, conformément à Phase 2.

---

# 17. Deuxième Device

Si John possède :

```text
Laptop A
Laptop B
```

et Sophos existe sur Laptop A :

```text
Laptop A
Sophos ✓
```

Laptop B doit toujours proposer :

```text
Laptop B
+ Sophos
```

La disponibilité est calculée par cible réelle.

---

# 18. Service scope `Both`

Un service `Both` peut apparaître :

```text
PERSONAL SERVICES
+ Service X
```

et :

```text
LAPTOP-JDOE
+ Service X
```

simultanément.

Cliquer sur le premier crée :

```text
target_scope = User
```

Cliquer sur le second :

```text
target_scope = Device
```

Aucun dropdown Scope.

---

# 19. Existing User sans Device

Afficher :

```text
DEVICES

No device currently assigned to John.
```

Pour les services Device disponibles :

```text
DEVICE SERVICES

+ Sophos Endpoint
+ RMM
```

Cliquer sur l’un d’eux produit :

```text
Device required
Technician will identify or provision the device.
```

Pas :

```text
Hostname *
Serial *
Device Type *
```

---

# 20. New User + Device Service

Même principe.

Exemple :

```text
MARIE DUPONT
Human Resources

SERVICES TO ADD

✓ Microsoft 365
✓ Sophos Endpoint
```

Sophos étant Device-scoped :

```text
DEVICE REQUIRED
A technician will prepare or identify the device.
```

Le client n’a rien d’autre à saisir.

---

# 21. Nouveau sens de `is_new_device`

Dans cette situation :

```text
target_scope = Device
is_new_device = 1
managed_device = NULL
```

doit être une combinaison valide.

Cela signifie :

> Cette Request nécessite un Device cible qui n’est pas encore déterminé.

La Phase 4 remplira :

```text
managed_device
serial
hostname
holder
```

pendant l’exécution.

---

# 22. Une intention = une Request Line

Quand l’utilisateur clique :

```text
+ Microsoft 365
```

cela crée une intention :

```text
Add
Microsoft 365
John
```

Puis :

```text
Suspend VPN
```

crée une deuxième intention.

Puis :

```text
Add Sophos
Laptop-JDOE
```

une troisième.

Le payload final contient donc trois Request Lines.

Pas :

```text
services = [Microsoft, VPN, Sophos]
action = ...
```

---

# 23. Nouvelle référence importante : Service Assignment

Ajouter sur `MSP Service Request Line` :

```text
source_service_assignment
Link → MSP Service Assignment
```

Ce champ est vide pour :

```text
Add
```

mais obligatoire conceptuellement pour :

```text
Change
Suspend
Resume
Remove
```

Exemple :

```text
Suspend Microsoft 365

source_service_assignment = SA-00042
requested_service = Microsoft 365
```

Cela évite de rechercher plus tard :

> Quel Microsoft 365 voulait-il suspendre exactement ?

---

# 24. Pourquoi cette référence est importante

Après Phase 2, on peut avoir :

```text
SA-001
Microsoft 365
Jan → May
Ended

SA-002
Microsoft 365
Jun → ...
Active
```

La Request doit cibler :

```text
SA-002
```

et non simplement :

```text
service_item = Microsoft 365
```

C’est beaucoup plus fiable pour la Phase 4.

---

# 25. Contexte humain d’une ligne Device

Ajouter également :

```text
requested_for_user
Link → MSP Client User
```

Ce champ représente :

> La personne pour laquelle cette Request a été formulée.

Pour un User service :

```text
requested_for_user = John
client_user = John
```

Pour un Device service :

```text
requested_for_user = John
client_user = NULL
managed_device = LAPTOP-JDOE
```

La target métier reste donc propre.

---

# 26. Pourquoi `requested_for_user` est nécessaire

Aujourd’hui une ligne Device perd la personne dès que :

```text
target_scope = Device
```

car `client_user` doit devenir NULL.

Cela pose au moins trois problèmes :

```text
affichage historique
groupement du workflow
approval par département
```

Après transfert du Device John → Bob, la Request historique doit toujours pouvoir dire :

> Cette demande avait été formulée pour John.

Elle ne doit pas devenir implicitement une Request pour Bob.

---

# 27. Approval par département — bug à corriger

Aujourd’hui le contrôle fait essentiellement :

```text
if row.client_user:
    verify department
```

Donc une ligne Device :

```text
client_user = NULL
managed_device = Laptop
```

échappe au contrôle départemental.

Un New User échappe également au contrôle puisqu’il n’existe pas encore comme `MSP Client User`.

Nouvelle règle :

Pour un Existing User :

```text
requested_for_user
```

est utilisé pour déterminer le département.

Pour un New User :

```text
new_user_department
```

est utilisé.

Un approver limité à `Accounting` ne peut donc approuver que les lignes destinées à Accounting, qu’elles soient :

```text
User service
Device service
New User
```

---

# 28. Une Request multi-départements

Si une Request contient :

```text
John / Accounting
Marie / Sales
```

et que l’approver est limité à Accounting :

il ne doit **pas pouvoir approuver toute la Request**.

Pour cette Phase 3, garder la règle simple :

> l’approver doit couvrir toutes les personnes de la Request.

Sinon afficher :

```text
This request also contains people outside your approval scope.
```

Une approbation partielle pourra être étudiée plus tard si réellement nécessaire.

---

# 29. Current / Available ne doit pas être calculé dans React

Créer un contexte backend dédié.

Conceptuellement :

```python
get_request_subject_context(client_user)
```

Retour :

```text
user
personal_services
available_personal_services
devices
device_services
available_device_services
pending_requests
```

Le frontend ne doit pas reconstruire cette logique à partir de :

```text
catalogue
+
users
+
devices
+
sets
+
service_state calls
```

comme aujourd’hui.

---

# 30. Réponse API conceptuelle

Exemple :

```json
{
  "user": {
    "name": "CU-001",
    "full_name": "John Doe",
    "department": "Accounting",
    "email": "john@acme.com",
    "lifecycle_status": "Active"
  },

  "personal_services": {
    "current": [],
    "available": []
  },

  "devices": [
    {
      "name": "DEV-001",
      "hostname": "LAPTOP-JDOE",
      "serial_number": "ABC123",
      "device_type": "Laptop",
      "status": "Active",
      "services": {
        "current": [],
        "available": []
      }
    }
  ]
}
```

Chaque `current service` doit fournir :

```text
assignment
service
label
status
since
quantity
allowed_request_actions
pending_request
```

---

# 31. Pending Request awareness

Le builder doit savoir si une modification est déjà demandée.

Exemple :

```text
Microsoft 365
Active

Suspend requested
SR-2026-0014
Awaiting approval
```

Dans ce cas ne pas proposer immédiatement :

```text
Suspend
Close
Change
```

comme si rien n’était en cours.

---

# 32. Détection backend des conflits

À la soumission, vérifier les Requests ouvertes :

```text
Awaiting Customer Approval
Submitted
Under Review
Approved
In Progress
```

Pour :

```text
source_service_assignment
```

une seule modification ouverte à la fois.

Pour `Add`, vérifier :

```text
customer
service
actual target
```

afin d’éviter deux demandes simultanées d’activation du même service.

Les Drafts ne bloquent pas les autres utilisateurs.

---

# 33. Stale Draft

Un Draft peut rester ouvert plusieurs jours.

Exemple :

```text
Monday:
Microsoft 365 absent

John saves draft:
+ Microsoft 365

Tuesday:
another request activates Microsoft 365

Friday:
John reopens draft
```

Le formulaire doit afficher :

```text
This change is no longer available because Microsoft 365 is now active.
Review this item before submitting.
```

Et le backend doit refuser une soumission obsolète.

Le frontend ne constitue jamais la seule validation.

---

# 34. `Change` doit devenir explicite

Cliquer :

```text
Change
```

sur un service existant ouvre un petit panneau.

Exemple :

```text
CHANGE MICROSOFT 365

Current service
Microsoft 365

Requested service
[ Microsoft 365 ▾ ]

Quantity
[ 20 ]

Requested date
[ 15/09/2026 ]

Details
[ optional ]
```

Si seul le nombre change :

```text
requested_service = current service
requested_quantity = new quantity
```

Si le plan change :

```text
source_service_assignment = old assignment
requested_service = new service
```

La Phase 4 appellera ensuite le `ServiceLifecycleService.change()` de Phase 2.

---

# 35. Suspend / Resume / Close

Ces actions ne demandent plus de choisir le service.

Le service est déjà connu.

Exemple :

```text
SUSPEND VPN

VPN
John Doe
Active since Jan 10

Requested date
[ 15/09/2026 ]

Reason / details
[ optional ]

[ Add to request ]
```

Même principe pour :

```text
Resume
Close
```

---

# 36. Étape 3 — When & Details

Au lieu de répéter la même date sur toutes les lignes dès le début :

```text
Default requested date
[ 15/09/2026 ]
```

Cette date s’applique à toutes les intentions.

Chaque ligne peut avoir :

```text
Use a different date
```

si nécessaire.

Le backend continue à stocker :

```text
requested_effective_date
```

sur chaque Request Line.

---

# 37. Priority

Déplacer `Priority` vers cette étape.

```text
Priority

Low
No rush

Medium
Standard

High
Important

Urgent
Business blocked
```

Valeur par défaut :

```text
Medium
```

Le client ne doit pas choisir la priorité avant même d’avoir expliqué ce qu’il demande.

---

# 38. Commentaires

Conserver :

```text
comment
```

sur chaque Request Line.

Mais le champ n’est pas affiché comme un grand textarea obligatoire sous chaque bloc.

Afficher plutôt :

```text
[ + Add details ]
```

sur une intention.

Cela ouvre :

```text
Additional details
[ ... ]
```

La plupart des demandes simples ne nécessitent donc aucune saisie supplémentaire.

---

# 39. Étape 4 — Review

La Review doit être humaine, pas une copie du formulaire.

Exemple :

```text
REQUEST SUMMARY

JOHN DOE
Accounting

PERSONAL
+ Microsoft 365
  Add from Sep 15

VPN
  Suspend from Sep 20

DEVICE

LAPTOP-JDOE
SN: ABC123

+ Sophos Endpoint
  Add from Sep 15


MARIE DUPONT
Human Resources
New user

+ Microsoft 365

DEVICE REQUIRED
+ RMM

Priority: Medium
```

---

# 40. Approval preview

Avant Submit, afficher aussi ce qui va se passer.

Si la Request va directement à Nexgen :

```text
After submission
This request will be sent to Nexgen for review.
```

Si elle doit être approuvée chez le Customer :

```text
After submission
This request will first wait for approval inside your company.
```

Le portail possède déjà une bonne partie de cette logique via Approval Authority.

Il faut simplement l’exposer au Review step.

---

# 41. Request Type

Le client ne choisit plus :

```text
Add
Change
Suspend
Mixed
```

comme type de Request.

Le backend le calcule depuis les lignes.

Exemple :

```text
Add
Add
Add
→ Request Type = Add
```

```text
Add
Suspend
→ Request Type = Mixed
```

Le champ existant reste.

Mais le payload client ne doit pas pouvoir dicter arbitrairement `request_type`.

---

# 42. Validation stricte d’une Add Request

Pour `Add` :

le backend doit vérifier auprès du Service Lifecycle / availability API :

```text
service exists
service enabled
contract allows it
target scope allowed
target valid
service not already live
no conflicting pending request
```

Ne jamais faire confiance au fait que le bouton n’était pas visible côté React.

---

# 43. Validation d’une modification existante

Pour :

```text
Change
Suspend
Resume
Remove
```

valider :

```text
source_service_assignment exists
belongs to customer
belongs to requested target
action allowed from current operational_status
Request Action still enabled
no conflicting open request
```

Exemple :

```text
request says Resume
assignment is currently Active
→ reject
```

---

# 44. Validation Device/User context

Si :

```text
requested_for_user = John
managed_device = Laptop A
```

le backend vérifie à la soumission que Laptop A est actuellement détenu par John.

Si le device a entretemps été transféré :

```text
This device is no longer assigned to John.
Review the request before submitting.
```

Cela évite les Requests incohérentes.

---

# 45. Client Device picker

Le client ne doit plus voir tous les devices de toute l’entreprise comme aujourd’hui.

Pour une Request formulée pour John, afficher prioritairement et normalement uniquement :

```text
devices currently held by John
```

Pas :

```text
all devices
all stock devices
devices belonging to colleagues
```

L’attribution d’un device de stock est le travail du technicien.

---

# 46. Cas plusieurs devices

Pour ajouter un Device service :

Si John a un seul Device :

```text
LAPTOP-JDOE
```

il est automatiquement ciblé et affiché.

Si John en possède plusieurs :

l’utilisateur choisit parmi **ses devices actuels**, avec :

```text
hostname
serial number
device type
```

Si aucun :

```text
is_new_device = 1
managed_device = NULL
```

---

# 47. Nouveau `FormLine`

Le modèle React actuel :

```text
action
services[]
managed_device
username
hostname
serial
...
```

doit disparaître.

Le frontend devrait manipuler conceptuellement :

```typescript
RequestIntent {
  key
  subject
  action
  requestAction
  sourceServiceAssignment?
  targetScope
  clientUser?
  requestedForUser?
  managedDevice?
  isNewDevice
  requestedService
  requestedQuantity
  requestedEffectiveDate
  comment
}
```

Une intention = une Request Line.

---

# 48. Subject model React

Conceptuellement :

```typescript
RequestSubject {
  key
  kind: 'existing' | 'new'
  clientUser?
  fullName?
  department?
  email?
  intents: RequestIntent[]
}
```

Cela permettra enfin de représenter naturellement :

```text
John
 ├ Add Microsoft
 ├ Suspend VPN
 └ Add Sophos to Laptop A

Marie (new)
 ├ Add Microsoft
 └ Add Sophos / device required
```

---

# 49. Drafts

Conserver le fonctionnement actuel :

```text
Save Draft
Reopen
Discard
```

Un Draft :

```text
n’est pas soumis
n’est pas visible par les autres
ne déclenche aucune notification
```

Mais le nouveau builder doit reconstruire ses Subjects et Intents depuis les Request Lines.

---

# 50. Correct & Resubmit

Conserver également le mécanisme :

```text
Rejected Request
→ Correct and submit as new
```

Cependant, lors de l’ouverture :

le contexte doit être recalculé.

Si une ancienne action n’est plus valable :

```text
VPN was suspended when the old request was created,
but it is now Active.
```

afficher une alerte et demander une nouvelle action.

Ne pas reproduire aveuglément une Request ancienne.

---

# 51. Nouvelles APIs recommandées

Créer conceptuellement :

```text
search_request_users
get_request_subject_context
get_new_user_request_context
get_request_submission_context
```

`get_request_subject_context` concentre l’intelligence.

`get_new_user_request_context` retourne notamment :

```text
departments
available user services
available device services
```

`get_request_submission_context` explique :

```text
direct submission
or
customer approval first
```

---

# 52. Réutiliser Phase 2

Ne pas recoder la disponibilité d’un service dans `PortalService`.

Le Request Builder doit utiliser les règles déjà définies par la Phase 2 :

```text
service ownership
target scope
availability
contract
rate
current assignment
allowed lifecycle actions
```

Si l’agent Phase 2 a déjà créé une API de disponibilité, la réutiliser.

Ne pas maintenir deux implémentations.

---

# 53. Search user

Le code actuel charge volontairement tous les Client Users.

À terme, remplacer cela par un Select avec recherche backend :

```text
Search John...
```

et retourner par exemple les 25 ou 50 meilleurs résultats.

Chaque résultat :

```text
John Doe
john@acme.com · Accounting
```

Cela évite que le nouveau workflow se dégrade sur un Customer possédant plusieurs milliers d’utilisateurs.

---

# 54. `MSP Service Request Line` — changements recommandés

Conserver le modèle existant.

Ajouter uniquement :

```text
source_service_assignment
Link → MSP Service Assignment

requested_for_user
Link → MSP Client User
```

Les champs techniques existants :

```text
new_user_username
new_device_label
new_device_type
new_device_serial
```

peuvent rester pour Phase 4 / compatibilité historique.

Ils ne sont simplement plus remplis par le portail.

---

# 55. Validation du DocType

`MSPServiceRequest.validate_lines()` doit intégrer :

```text
source assignment consistency
requested_for_user ownership
service scope compatibility
action/state compatibility
duplicate intent detection
```

Le contrôle de duplicate ne doit plus être seulement :

```text
scope + target + service
```

Il doit également comprendre les actions.

Mais deux actions contradictoires sur le même Assignment dans la même Request doivent être refusées :

```text
Suspend VPN
Close VPN
```

dans la même Request.

---

# 56. Approval department

Remplacer la logique actuelle limitée à :

```python
if row.client_user:
```

par une résolution du sujet.

Conceptuellement :

```text
Existing User:
requested_for_user or client_user

New User:
new_user_department

Device request without person:
requires unrestricted company approver
```

Cela doit être testé avant la Phase 4.

---

# 57. Aucun effet opérationnel au Submit

Après :

```text
Submit request
```

vérifier qu’aucune modification n’a été faite sur :

```text
MSP Client User
MSP Managed Device
MSP Device Holder
MSP Service Assignment
```

La Request est une intention.

C’est un invariant de la Phase 3.

---

# 58. Tests backend critiques

Scénarios obligatoires :

| # | Scénario |
|---:|---|
| 1 | Selecting John returns his identity |
| 2 | Current devices include hostname + serial |
| 3 | Personal current services are returned |
| 4 | Available personal services exclude services already live |
| 5 | Device A service does not disappear from availability for Device B |
| 6 | `Both` appears as User and Device option |
| 7 | Active service allows Change/Suspend/Remove |
| 8 | Suspended service allows Resume/Remove |
| 9 | Pending Setup exposes no contradictory action |
| 10 | Disabled Request Action is not offered |
| 11 | Add creates one Request Line |
| 12 | Three actions create three Request Lines |
| 13 | Request Type is derived automatically |
| 14 | `source_service_assignment` required for Suspend |
| 15 | Resume Active assignment rejected |
| 16 | Add already-active service rejected |
| 17 | Pending conflicting Request blocks second request |
| 18 | Draft does not block another user |
| 19 | Stale Draft is rejected at Submit |
| 20 | Device line keeps `requested_for_user` |
| 21 | Device transfer before Submit invalidates stale device selection |
| 22 | User with no device can request Device service with `is_new_device=1` |
| 23 | New User can request Device service without hostname/serial |
| 24 | Portal submission does not write username |
| 25 | Portal submission does not write serial |
| 26 | Department-limited approver validates User line |
| 27 | Department-limited approver validates Device line |
| 28 | Department-limited approver validates New User line |
| 29 | Multi-department Request rejected for narrow approver |
| 30 | Existing approval flow statuses remain unchanged |

---

# 59. Tests frontend critiques

Vérifier :

```text
Stepper 1 → 2 → 3 → 4

Existing User selected
→ identity card visible

Device
→ hostname + serial visibly framed

Current service
→ actions embedded

Available service
→ + Add

No independent Action dropdown

No independent Scope dropdown

No generic Service dropdown

New User
→ Department Select
→ no Username field

New Device required
→ no Hostname
→ no Serial

One Device
→ automatically targeted

Several Devices
→ device choice with serial

No Device
→ technician will determine device

Review
→ grouped human-readable summary

Draft save/reopen

Rejected request correction

Pending existing request visible
```

---

# 60. UX mobile

Le stepper doit également fonctionner correctement sur téléphone.

Sur mobile :

```text
Person card
Services
Device cards
```

s’empilent verticalement.

Les actions deviennent des boutons simples sous chaque service.

Ne jamais construire un tableau horizontal complexe pour le portail.

---

# 61. Definition of Done

Le parcours suivant doit être possible sans que le client voie une seule donnée technique inutile :

```text
New Request

Who?
→ John Doe

John appears with:
Accounting
email
Laptop-JDOE
SN ABC123

Personal Services
Microsoft 365 — Active
VPN — Suspended

Available
+ Adobe

Device
Laptop-JDOE

Sophos — Active
+ RMM

User clicks:
+ Adobe
Resume VPN
+ RMM

Date:
15 Sep

Review

Submit
```

Le backend doit produire exactement :

```text
Line 1
Add Adobe
User → John

Line 2
Resume VPN
User → John
source assignment → VPN assignment

Line 3
Add RMM
Device → LAPTOP-JDOE
requested_for_user → John
```

Aucune mutation opérationnelle n’a encore lieu.

---

# 62. New User Definition of Done

```text
Who?
→ New User

Marie Dupont
Human Resources
marie@acme.com

Services
+ Microsoft 365
+ Sophos

Sophos requires a device
→ Technician will prepare/identify it

Review
Submit
```

Aucun champ :

```text
username
hostname
serial
MAC
```

n’est demandé au client.

---

# 63. Boundary avec Phase 4

Cette Phase 3 s’arrête lorsque la Request est correctement exprimée.

Elle ne doit pas encore :

```text
create the Client User
assign/repossess a Device
activate a Service Assignment
suspend a Service
create/execute Work Orders
```

Tout cela appartient à :

```text
Phase 4 — Technician Execution / Work Orders
```

Cette séparation est essentielle.

---

# 64. Découpage Codex recommandé

| Ordre | Task | Agent | Reasoning |
|---:|---|---|---|
| 1 | Request Line semantics + `source_service_assignment` + `requested_for_user` + validations | Senior Frappe Backend | High |
| 2 | Request context APIs + availability + conflict detection | Senior Frappe Backend | High |
| 3 | Fix department approval for Device/New User lines | Senior Backend / Security Logic | High |
| 4 | New React Request Builder + stepper | Senior React/TypeScript | High |
| 5 | Current/Available service cards + Device context | Senior Full-stack | Medium–High |
| 6 | Draft / reopen / correct rejected requests | Senior Full-stack | High |
| 7 | Portal regression + backend + Vitest suite | QA / Full-stack | High |

---

# 65. Première tâche à dispatcher

Je commencerais encore une fois par le backend.

### Task 1 — Request Intent Semantics

L’agent doit :

```text
add source_service_assignment
add requested_for_user
strengthen request line validation
remove portal operational side effects
derive request_type server-side
validate action against current Service Lifecycle state
implement pending-request conflict detection
fix approval subject resolution
```

Il ne doit pas refaire React dans cette première task.

### Agent recommandé

**Codex Senior Frappe Backend — High reasoning**

C’est la tâche qui transforme `MSP Service Request Line` en vraie **intention métier fiable**.

Une fois qu’elle est stabilisée par les tests, le nouvel écran React devient essentiellement une représentation propre de ces règles.