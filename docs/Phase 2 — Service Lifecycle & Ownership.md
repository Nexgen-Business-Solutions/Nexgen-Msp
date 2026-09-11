# Phase 2 — Service Lifecycle & Ownership

## 1. Objectif

Faire de `MSP Service Assignment` la source de vérité unique concernant :

**quel service est fourni, à quelle cible, depuis quand, jusqu’à quand, dans quel état, et sur quelles périodes il est réellement facturable.**

La Phase 2 doit rendre fiables les scénarios suivants :

```text
Add
Suspend
Resume
Close
Re-add
Change quantity
Change target
Device transfer
Device repossession
Device retirement
User deactivation
Billing
Request execution
```

La règle centrale est :

> Un Service Assignment appartient exactement à une cible métier.  
> Cette cible est soit un User, soit un Device.  
> Le détenteur courant d’un Device ne devient jamais propriétaire des services de ce Device.

---

# 2. Bugs confirmés dans le code actuel

| Problème | Cause |
|---|---|
| Un service Device sur le laptop A peut empêcher d’ajouter le même service au laptop B du même utilisateur | `AssignServiceModal` déduplique seulement par `service_item`, sans tenir compte de la cible |
| Un service `Both` déjà présent sur un Device peut empêcher le même service en scope User | `_find_open_assignment()` mélange `sa.client_user` et `device.assigned_client_user` |
| Après transfert Alice → Bob, l’historique des services Device est présenté comme appartenant à Bob | `get_user()` rattache les services Device au détenteur **actuel** |
| Alice perd visuellement les services historiques du laptop après transfert | même cause |
| `Both` demande parfois username + serial même lorsque l’assignment final est uniquement Device | la validation regarde le scope déclaré `Both`, pas `target_scope` réel |
| Un service Device-only peut techniquement être créé comme User Assignment en contournant l’API | `MSP Service Assignment.validate()` ne vérifie pas la compatibilité Item scope ↔ assignment scope |
| Le catalogue proposé depuis un User contient pratiquement tous les Items non-stock | il n’est pas limité au contrat du Customer |
| Un technicien peut créer un assignment `Billable` pour un service sans rate valide | validation commerciale absente au moment de l’activation |
| `Suspend` ne mémorise aucune date de suspension | seul le statut courant change |
| `Resume` efface de fait l’information historique de suspension | statut repasse à Active sans intervalle conservé |
| Une facture calculée pendant `Suspended` peut ignorer toute la période du service | Billing exclut actuellement les assignments Suspended |
| Après Resume, Billing peut au contraire recalculer toute la période comme active | aucune suspension historique n’existe |
| `billing_status` et `operational_status` peuvent être mis dans des combinaisons contradictoires | aucune validation de couple d’états |
| Un assignment terminé peut être suivi d’un nouvel assignment dont les dates chevauchent l’ancien | `validate_no_overlap()` ne compare que les assignments actuellement ouverts |
| Les notes sur un changement de service écrasent `internal_notes` | `change_service()` affecte directement la dernière note |
| `Change` existe dans Requests et Work Orders mais n’a pas encore une vraie sémantique métier | aucun lifecycle central ne l’implémente |

---

# 3. Distinction fondamentale : Service declaration vs Assignment scope

Le champ :

```text
Item.msp_service_scope
```

décrit **où un service a le droit d’être vendu**.

Les valeurs actuelles sont bonnes :

```text
User
Device
Both
```

`Both` ne signifie jamais qu’un Assignment possède simultanément un User et un Device.

Il signifie :

```text
This service MAY be assigned to User
OR
This service MAY be assigned to Device
```

Un `MSP Service Assignment` concret doit toujours avoir un scope réel unique :

```text
assignment_scope = User
client_user = John
managed_device = NULL
```

ou :

```text
assignment_scope = Device
managed_device = LAPTOP-0042
client_user = NULL
```

Jamais les deux.

---

# 4. Ownership définitif

## User-scoped service

Exemple :

```text
Microsoft 365
↓
John Doe
```

Ce service appartient à John.

Un transfert de laptop :

```text
John → laptop A
Bob  → laptop A
```

ne change absolument rien au Microsoft 365 de John.

---

## Device-scoped service

Exemple :

```text
Sophos Endpoint
↓
LAPTOP-0042
```

Il appartient au device.

Si :

```text
LAPTOP-0042
Alice → Bob
```

le Service Assignment reste :

```text
Sophos
→ LAPTOP-0042
```

Il n’est ni fermé, ni transféré, ni recréé.

C’est uniquement le contexte humain du Device qui change.

---

# 5. Identité d’un Assignment

La clé métier d’un service ouvert devient :

```text
Customer
+ Service Item
+ Actual Assignment Scope
+ Actual Target
```

Ainsi les quatre situations suivantes sont valides simultanément :

```text
Sophos → Device A
Sophos → Device B
Sophos → Device C

Service Both → John
Service Both → Device A
```

Ce qui est interdit :

```text
Sophos → Device A
Sophos → Device A
```

sur deux périodes ouvertes en même temps.

Ou :

```text
Microsoft 365 → John
Microsoft 365 → John
```

sur deux périodes qui se chevauchent.

---

# 6. Réajout après fermeture

Un Assignment `Ended` n’est jamais rouvert.

Exemple :

```text
SA-001
Microsoft 365
John
2026-01-01 → 2026-05-31
Ended
```

Puis John reprend le service le 15 juin.

Créer :

```text
SA-002
Microsoft 365
John
2026-06-15 → ...
Active
```

Ne jamais modifier `SA-001`.

C’est indispensable pour conserver la vérité historique et la facturation.

---

# 7. Lifecycle opérationnel

Les statuts actuels peuvent être conservés.

| Status | Signification |
|---|---|
| `Draft` | Assignment incomplet, non opérationnel |
| `Pending Setup` | Service approuvé/préparé mais pas encore réellement activé |
| `Active` | Service réellement fourni |
| `Suspended` | Service temporairement arrêté |
| `Pending Removal` | Retrait demandé/programmé mais service encore actif |
| `Ended` | Service terminé définitivement |
| `Cancelled` | Setup annulé avant activation |

Transitions normales :

```text
Draft
  ↓
Pending Setup
  ↓
Active
  ├────→ Suspended ─────→ Active
  │
  └────→ Pending Removal ─────→ Ended
```

Et :

```text
Pending Setup → Cancelled
Suspended → Ended
Active → Ended
```

---

# 8. Billing Status devient dérivé

`billing_status` ne doit plus être considéré comme une deuxième machine à états indépendante.

Correspondance obligatoire :

| Operational | Billing |
|---|---|
| Draft | Not Billable |
| Pending Setup | Pending |
| Active | Billable |
| Suspended | On Hold |
| Pending Removal | Billable |
| Ended | Ended |
| Cancelled | Not Billable |

Le backend doit automatiquement synchroniser `billing_status`.

Un code futur ne doit plus pouvoir produire :

```text
Active + On Hold
Suspended + Billable
Ended + Pending
Cancelled + Billable
```

`billing_status` doit devenir read-only côté UI.

---

# 9. Problème du Suspend / Resume

Le modèle actuel ne suffit pas à répondre à :

> Pendant quels jours exacts ce service a-t-il été suspendu ?

Exemple :

```text
Active Jan 1
Suspend Mar 10
Resume Mar 21
Suspend Jun 5
Resume Jun 12
```

Le record courant ne contient que :

```text
status = Active
start = Jan 1
end = NULL
```

Les deux suspensions ont disparu.

Or elles modifient la facture.

---

# 10. Seule extension de modèle recommandée

Ajouter un Child DocType :

```text
MSP Service Suspension
```

dans une table :

```text
suspension_log
```

sur `MSP Service Assignment`.

Champs :

| Field | Type |
|---|---|
| `suspended_on` | Date |
| `resumed_on` | Date nullable |
| `suspended_by` | Link User |
| `resumed_by` | Link User |
| `source_request` | Link MSP Service Request |
| `note` | Small Text |

Sémantique :

```text
suspended_on = inclusif
resumed_on = jour où le service redevient actif
```

Donc :

```text
Suspend 10 March
Resume 21 March
```

donne une période non facturable :

```text
10 March → 20 March
```

Le 21 est à nouveau facturable.

---

# 11. Invariants des suspensions

Il ne peut exister qu’une suspension ouverte :

```text
resumed_on = NULL
```

à la fois.

`Suspended` implique exactement une suspension ouverte.

`Active` implique aucune suspension ouverte.

Une suspension ne peut commencer :

```text
avant effective_start_date
après effective_end_date
dans le futur
```

Un Resume ne peut être antérieur à `suspended_on`.

Un Suspend puis Resume le même jour est valide mais représente :

```text
0 jour non facturable
```

On garde néanmoins l’événement dans l’historique.

Un service Ended pendant qu’il est suspendu conserve sa dernière suspension sans `resumed_on`.

Billing la clippera à `effective_end_date`.

---

# 12. Billing doit utiliser les suspensions

Les fonctions :

```text
_billable_days()
_billable_months()
_covered_window()
```

doivent être adaptées.

Calcul conceptuel :

```text
assignment effective period
MINUS
all suspension intervals
=
billable intervals
```

Exemple :

```text
Assignment:
1 Sept → 30 Sept

Suspended:
10 Sept → Resume 16 Sept
```

Billable :

```text
1–9
16–30
```

et non :

```text
0 jours
```

ou :

```text
30 jours
```

comme le modèle actuel peut finir par le produire.

---

# 13. Protection des périodes déjà facturées

Toute mutation historique ayant un impact financier doit respecter les Billing Runs déjà soumises.

Règle :

> Une transition ne peut pas réécrire silencieusement une période déjà facturée.

Pour `End`, conserver la protection déjà présente dans `_end_date_for()`.

Pour `Suspend` et `Resume`, appliquer une protection équivalente.

Si une suspension devait commencer au milieu d’une période déjà facturée :

```text
Invoice jusqu'au 31 Aug
Suspend demandé au 20 Aug
```

refuser :

```text
This period has already been invoiced.
Issue a credit note / adjustment instead.
```

Ne jamais recalculer rétroactivement une invoice existante en modifiant simplement l’Assignment.

---

# 14. Activation

Créer une méthode centrale :

```python
ServiceLifecycleService.activate(...)
```

Elle reçoit conceptuellement :

```text
customer
service_item
target_scope
client_user OR managed_device
effective_date
quantity
source_request
notes
```

Elle doit :

```text
1. vérifier le service
2. vérifier son scope
3. vérifier la cible
4. vérifier le Customer
5. vérifier le contrat
6. vérifier la rate
7. vérifier les doublons / chevauchements
8. créer l'assignment
9. définir Active + Billable
10. tracer l'action
```

---

# 15. Service catalogue valide

Une activation ne doit pas accepter n’importe quel Item non-stock.

Le service doit :

```text
exister
disabled = 0
is_stock_item = 0
avoir un MSP service scope valide
```

Et idéalement appartenir au catalogue MSP géré par `CatalogueService`.

Les anciens Items historiques peuvent rester lisibles.

Mais aucune nouvelle activation ne doit naître d’un Item arbitraire.

---

# 16. Contrat et disponibilité

Le User/Device detail ne doit plus proposer tout le catalogue global.

Un service doit être marqué comme réellement `available` si :

```text
Service offered
+
Customer has an Active contract covering it
+
Target scope is allowed
+
A valid rate exists
+
Target does not already hold it
```

Pour un technicien :

```text
uniquement les services disponibles
```

Pour un administrateur, on peut éventuellement montrer :

```text
Unavailable
- Not covered by contract
- Missing rate
- Catalogue retired
```

mais pas permettre une activation silencieuse.

Si l’on veut un override administrateur plus tard, celui-ci devra être explicite avec une raison.

---

# 17. Suspended Contract

Un Contract `Suspended` peut continuer à servir à lire les assignments historiques et éventuellement les rates.

Mais il ne doit pas permettre une nouvelle activation normale.

Pour ajouter un service :

```text
Contract status = Active
```

doit être requis.

---

# 18. Scope validation dans le DocType

`MSPServiceAssignment.validate()` doit contrôler le scope déclaré du service.

Exemples :

```text
Item scope User
+ Assignment scope Device
→ ERROR
```

```text
Item scope Device
+ Assignment scope User
→ ERROR
```

```text
Item scope Both
+ Assignment scope User
→ OK
```

```text
Item scope Both
+ Assignment scope Device
→ OK
```

Le DocType doit protéger ces règles même lorsqu’on contourne les API.

---

# 19. Validation historique des périodes

L’actuel `validate_no_overlap()` vérifie uniquement les assignments ouverts.

Ce n’est pas suffisant.

Exemple invalide :

```text
SA-001 Ended
Jan 1 → Jun 30

SA-002 Active
Jun 15 → ...
```

Le deuxième chevauche l’histoire du premier.

Il faut vérifier contre tous les assignments non-Cancelled du même :

```text
customer
service
actual scope
actual target
```

ayant une période effective.

Puis empêcher tout chevauchement.

---

# 20. Suspend

API métier :

```python
ServiceLifecycleService.suspend(
    assignment,
    effective_date,
    source_request=None,
    notes=None,
)
```

Conditions :

```text
status == Active
date <= today
date >= effective_start_date
date outside protected billed history
```

Effets :

```text
operational_status = Suspended
billing_status = On Hold

new suspension row:
suspended_on = effective_date
resumed_on = NULL
```

L’Assignment lui-même reste le même.

---

# 21. Resume

API :

```python
ServiceLifecycleService.resume(...)
```

Conditions :

```text
status == Suspended
open suspension exists
resume date >= suspended_on
resume date <= today
```

Effets :

```text
open suspension.resumed_on = date
operational_status = Active
billing_status = Billable
```

Aucun nouvel Assignment n’est créé.

---

# 22. End / Close

Je recommande de remplacer dans l’UX :

```text
End service
```

par :

```text
Close service
```

Le backend peut garder `end()`.

Effets :

```text
operational_status = Ended
billing_status = Ended
effective_end_date = date
```

L’Assignment devient historique et ne peut plus être réactivé.

Pour remettre le service :

```text
create new assignment
```

---

# 23. Pending Removal

`Pending Removal` doit enfin avoir une vraie signification.

Il signifie :

> La fermeture a été approuvée ou planifiée, mais le service est encore fourni.

Donc :

```text
Operational = Pending Removal
Billing = Billable
```

jusqu’au retrait effectif.

Ce statut deviendra particulièrement utile avec les futurs Work Orders.

La Phase 2 doit supporter la transition dans le domaine, même si l’UI directe continue à faire un Close immédiat.

---

# 24. Change n’est jamais une mutation destructrice

Les champs financièrement significatifs ne doivent pas être réécrits au milieu de la vie d’un assignment :

```text
service_item
target
quantity
manual agreed rate
```

Un changement crée une nouvelle période.

Exemple :

```text
Microsoft 365
quantity 10
Jan 1 → Jun 14

Microsoft 365
quantity 15
Jun 15 → ...
```

Donc :

```python
ServiceLifecycleService.change(...)
```

fait conceptuellement :

```text
close old assignment
+
create replacement assignment
```

---

# 25. Change de quantité

Si :

```text
quantity 1
→
quantity 2 on 15 September
```

alors :

```text
old assignment ends 14 September
new assignment starts 15 September
```

Ceci garantit une facturation historique exacte.

---

# 26. Change de service / plan

Exemple :

```text
Microsoft Basic
→
Microsoft Premium
```

Même logique :

```text
Basic ends D-1
Premium starts D
```

Ne jamais transformer l’ancien record Basic en Premium.

---

# 27. Cas particulier : correction le jour du démarrage

Si un assignment :

```text
start = today
never billed
```

vient d’être créé avec une erreur de quantité ou de target, une correction administrative peut éventuellement le modifier en place.

Mais uniquement si :

```text
no billing line
effective date == initial start
```

Sinon utiliser le rollover normal.

---

# 28. Price changes

Un changement normal de rate contractuelle ne doit pas modifier l’Assignment.

L’historique des prices appartient déjà à :

```text
Item Price
valid_from
valid_upto
```

C’est le bon modèle.

`agreed_rate` / Manual Override doit être traité différemment :

une modification après commencement doit produire un nouvel Assignment ou une nouvelle période, car sinon la valeur historique change.

---

# 29. ServiceLifecycleService

Créer :

```text
nexgen_msp/api/internal/services/service_lifecycle_service.py
```

API métier recommandée :

```python
ServiceLifecycleService.activate(...)
ServiceLifecycleService.create_pending(...)
ServiceLifecycleService.activate_pending(...)
ServiceLifecycleService.suspend(...)
ServiceLifecycleService.resume(...)
ServiceLifecycleService.schedule_removal(...)
ServiceLifecycleService.cancel_removal(...)
ServiceLifecycleService.end(...)
ServiceLifecycleService.cancel(...)
ServiceLifecycleService.change(...)
```

Toutes les transitions passent par ce service.

`UserService` et `DeviceService` deviennent des façades/context providers.

---

# 30. Compatibilité API existante

Les endpoints :

```text
assign_user_service
assign_device_service
change_user_service
```

peuvent rester temporairement.

Mais ils doivent devenir des wrappers sur :

```text
ServiceLifecycleService
```

Ils ne doivent plus construire eux-mêmes un `MSP Service Assignment`.

---

# 31. RequestService._find_open_assignment()

Cette fonction doit être complètement corrigée.

Actuellement elle demande conceptuellement :

```text
service belongs directly to John
OR
service belongs to any device currently held by John
```

Ceci mélange les ownerships.

Nouvelle signature conceptuelle :

```python
find_open_assignment(
    customer,
    service_item,
    assignment_scope,
    client_user=None,
    managed_device=None,
)
```

User :

```text
assignment_scope = User
client_user = John
```

Device :

```text
assignment_scope = Device
managed_device = LAPTOP-A
```

Aucune recherche par détenteur courant.

---

# 32. Correction du scope Both dans Requests

Actuellement certaines validations lisent :

```text
Item scope = Both
```

et concluent :

```text
need serial
AND
need username
```

C’est incorrect.

La validation doit utiliser :

```text
Request Line.target_scope
```

Si :

```text
service = Both
target_scope = User
```

alors seulement :

```text
username éventuellement requis
```

Si :

```text
service = Both
target_scope = Device
```

alors seulement :

```text
serial éventuellement requis
```

`Both` est une permission de ciblage, pas une cible réelle.

---

# 33. User Detail — restructuration

Le User Detail ne doit plus présenter tous les services dans une table aplatie.

Nouvelle organisation :

```text
JOHN DOE
Accounting
john@customer.com

PERSONAL SERVICES
────────────────────────

Microsoft 365
Active since Jan 10
[ Suspend ] [ Close ]

VPN
Suspended since Sep 1
[ Resume ] [ Close ]

AVAILABLE FOR JOHN
────────────────────────
+ Adobe
+ Nextcloud
```

Puis séparément :

```text
DEVICES CURRENTLY HELD
```

---

# 34. Services sur les devices du User

Chaque device devient un contexte propre :

```text
LAPTOP-JDOE
Serial: ABC123
Active · held since Jun 4

DEVICE SERVICES
Sophos Endpoint        Active
RMM                    Active

AVAILABLE
+ Backup
+ BitLocker Management
```

Si John possède deux machines :

```text
Laptop A
Laptop B
```

Sophos présent sur A ne doit absolument pas empêcher :

```text
+ Sophos
```

sur B.

Ceci corrige directement le problème actuel du deuxième device.

---

# 35. Ne plus attribuer l’historique Device à l’utilisateur actuel

`UserService.get_user()` ne doit plus faire :

```sql
where sa.client_user = user
   or device.assigned_client_user = user
```

pour produire une histoire unique de services.

Retourner plutôt conceptuellement :

```text
user_services
current_devices
device_services grouped by device
available_user_services
available_device_services
```

Un service historique Device reste dans le Device.

Il ne devient jamais une ligne historique personnelle de Bob simplement parce que Bob détient maintenant la machine.

---

# 36. User service availability

L’API doit pouvoir répondre :

```text
For John:

CURRENT
Microsoft 365
VPN

AVAILABLE
Adobe
Nextcloud

BLOCKED
Sophos Endpoint — Device only
Premium Backup — not in contract
```

Le frontend ne doit plus reconstruire lui-même cette logique à partir de Sets de `service_item`.

C’est une règle métier backend.

---

# 37. Device Detail

Même modèle :

```text
LAPTOP-042
Serial ABC123

CURRENT SERVICES

Sophos
Active
[ Suspend ] [ Close ]

RMM
Suspended
[ Resume ] [ Close ]

AVAILABLE SERVICES

+ Backup
+ Endpoint Encryption
```

Le backend retourne directement la bonne disponibilité pour **ce Device précis**.

---

# 38. Device status et service activation

Après la Phase 1, un Device service peut parfaitement continuer sur une machine `Stock`.

C’est volontaire.

Une repossession :

```text
Active/Alice → Stock
```

ne ferme pas les services.

Il faut donc autoriser la présence d’assignments sur :

```text
Active
Stock
```

Pour une nouvelle activation directe de Device service :

```text
Active → allowed
Stock → allowed
```

Et refuser :

```text
Lost
Damaged
Retired
Returned legacy
```

`Pending` pourra être utilisé avec `Pending Setup`, mais pas immédiatement `Active` sans réelle activation.

---

# 39. User lifecycle

Un nouvel User service ne peut être accordé qu’à :

```text
Pending
Active
```

Refuser :

```text
Disabled
Archived
```

La future action de désactivation User devra proposer explicitement le traitement des services personnels encore ouverts.

Ne pas fermer automatiquement aujourd’hui sans interaction, car cela créerait des dates financières implicites.

---

# 40. Internal notes

Une action :

```text
Suspend
Resume
Close
Change
```

ne doit jamais écraser une note historique.

`internal_notes` doit représenter au mieux la note d’origine / synthèse courante.

Les événements suivants doivent être enregistrés par commentaires structurés ou dans leurs logs associés :

```text
action
date
operator
source request
note
```

Les futures Work Orders fourniront ensuite la trace opérationnelle principale.

---

# 41. `source_request`

Le champ existant doit signifier :

> Request ayant provoqué la création de CET Assignment.

Ne pas le remplacer lors d’un Suspend ou Close ultérieur.

Le nouveau `suspension_log.source_request` enregistre éventuellement les Requests de suspension.

Pour End/Change, les Work Orders et commentaires fourniront la traçabilité additionnelle.

---

# 42. Migration des assignments existants

Créer un patch de normalisation.

Il doit vérifier :

```text
scope compatibility
target links
billing/operational status pair
duplicate open assignments
overlapping historical assignments
invalid dates
disabled catalogue services
```

Correction automatique uniquement lorsque la vérité est certaine.

Exemples sûrs :

```text
Active + On Hold
sans autre indication
→ Active + Billable
```

```text
Suspended + Billable
→ Suspended + On Hold
```

```text
Ended + Billable
→ Ended + Ended
```

Les conflits historiques importants doivent être reportés plutôt qu’inventés.

---

# 43. Migration des services actuellement Suspended

Leur vraie date de suspension n’existe pas dans `MSP Service Assignment`.

Ne jamais inventer :

```text
suspended_on = effective_start_date
```

Cela casserait Billing.

La migration peut essayer de retrouver la transition dans les `Version` Frappe puisque le DocType suit les modifications.

Si elle peut identifier sans ambiguïté :

```text
Active → Suspended
```

utiliser la date correspondante.

Sinon :

```text
flag assignment for manual review
```

avec rapport de migration.

C’est préférable à une donnée financière fausse.

---

# 44. AssignServiceModal actuel à supprimer/refactorer

La modal actuelle fait trop de choses simultanément :

```text
service
scope
existing/new device
hostname
serial
device type
network interfaces
username
request
notes
```

La Phase 2 ne doit plus permettre qu’“Add Service” devienne indirectement un formulaire complet de création Device.

Sur la page User :

```text
+ service personnel
```

ouvre une modal simple.

Sur une carte Device :

```text
+ device service
```

ouvre une modal simple.

La création d’un nouveau device appartient au lifecycle Device et, plus tard, au Work Order.

---

# 45. Modal Add User Service

```text
ADD SERVICE

John Doe
Accounting
john@company.com

Service
[ Microsoft 365 ]

Effective date
[ 11/09/2026 ]

Request reference
[ optional ]

Internal note
[ ... ]

[ Activate service ]
```

Si aucune option :

```text
John already has every service currently available to him.
```

---

# 46. Modal Add Device Service

Toujours montrer le contexte matériel très visiblement :

```text
ADD DEVICE SERVICE

LAPTOP-JDOE
Serial: ABC123
Dell Latitude 5450

Current holder
John Doe

Service
[ Sophos ]

Effective date
[ 11/09/2026 ]

[ Activate service ]
```

Ceci répond directement à la demande :

> user, device, serial number apparaître en cadre visible.

---

# 47. Modal Suspend

```text
SUSPEND SERVICE

Microsoft 365
John Doe

Active since
10/01/2026

Suspend from
[ 11/09/2026 ]

Billing
Paused from this date.

Request
[ optional ]

Reason
[ ... ]

[ Suspend ]
```

Si la date traverse une invoice déjà postée :

afficher l’erreur financière explicitement.

---

# 48. Modal Resume

```text
RESUME SERVICE

Microsoft 365
John Doe

Suspended since
02/09/2026

Resume on
[ 11/09/2026 ]

Billing resumes on this date.

[ Resume ]
```

---

# 49. Modal Close

```text
CLOSE SERVICE

Microsoft 365
John Doe

Active since
10/01/2026

Close on
[ 11/09/2026 ]

Last invoiced through
31/08/2026

This service will remain in history.
Re-adding it later creates a new service period.

[ Close service ]
```

---

# 50. Portal

Les mêmes ownership rules doivent être appliquées aux queries Portal.

Particulièrement :

```text
PortalService.get_user_detail()
list_users_with_services()
list_service_rows()
```

Ne pas utiliser le current holder pour prétendre qu’un Device Assignment appartient historiquement à une personne.

Pour une ligne Device :

```text
Target = Device
Hostname = authoritative
User = contextual current holder only
```

---

# 51. Billing display des Device services

Un Device Assignment est facturé **au Device**, même si l’on souhaite afficher son détenteur à titre de contexte.

Billing ne doit donc jamais utiliser :

```text
current device holder
```

pour déterminer l’identité du Service Assignment.

La facture peut afficher :

```text
Sophos Endpoint
LAPTOP-042
SN ABC123
```

Le détenteur est une information secondaire.

La Phase 7 Billing traitera le snapshot complet des labels/personnes.

Mais dès la Phase 2, aucun calcul de quantité, d’éligibilité ou d’ownership ne doit dépendre du holder actuel.

---

# 52. Tests backend obligatoires

| # | Test |
|---:|---|
| 1 | User service peut être assigné à User |
| 2 | User-only service refusé sur Device |
| 3 | Device-only service refusé sur User |
| 4 | Both accepté en User |
| 5 | Both accepté en Device |
| 6 | Même Both User + Device simultanément autorisé |
| 7 | Même Device service sur Device A + Device B autorisé |
| 8 | Duplicate sur même Device refusé |
| 9 | Duplicate sur même User refusé |
| 10 | Re-add après End crée nouvelle période |
| 11 | Nouvelle période chevauchant une historique refusée |
| 12 | Disabled catalogue service refusé |
| 13 | Service hors contrat refusé au technicien |
| 14 | Service sans rate signalé/refusé |
| 15 | Disabled/Archived User refuse nouvelle activation |
| 16 | Device Stock accepte Device service |
| 17 | Device Retired refuse activation |
| 18 | Transfer Device ne modifie aucun assignment |
| 19 | Repossess ne modifie aucun assignment |
| 20 | Retire ferme les Device assignments |
| 21 | Suspend crée suspension row |
| 22 | Deux suspensions ouvertes refusées |
| 23 | Resume ferme la suspension courante |
| 24 | Resume d’un Active refusé |
| 25 | Suspend d’un Suspended refusé |
| 26 | End d’un Suspended fonctionne |
| 27 | Suspend backdaté dans période facturée refusé |
| 28 | Billing retire les jours suspendus |
| 29 | Multiple Suspend/Resume correctement facturé |
| 30 | Change quantity produit deux assignments non chevauchants |
| 31 | Both/Device Request ne demande pas username |
| 32 | Both/User Request ne demande pas serial |
| 33 | `_find_open_assignment` ne traverse plus le current holder |
| 34 | User detail ne récupère pas l’historique Device d’un nouveau holder |

---

# 53. Tests frontend obligatoires

Scénarios essentiels :

```text
John possède Laptop A + Laptop B

Sophos actif sur Laptop A
→ Sophos reste disponible sur Laptop B

Both actif sur Laptop A
→ même Both reste disponible comme User service pour John

User service actif
→ affiché sous Personal Services

Device service actif
→ affiché sous la carte du Device

Suspend
→ Resume apparaît

Active
→ Suspend + Close apparaissent

Ended
→ aucune action lifecycle
→ service redevient disponible pour Add

Serial / Device / User visibles dans chaque action Device
```

---

# 54. Definition of Done

La Phase 2 est terminée lorsque ce parcours fonctionne :

```text
John
 ├── Microsoft 365 Active
 ├── VPN Active
 ├── Laptop A
 │    ├── Sophos Active
 │    └── RMM Active
 │
 └── Laptop B
      └── Sophos Active
```

Puis :

```text
Suspend Microsoft 365
Resume Microsoft 365
Close VPN
Re-add VPN
Transfer Laptop A to Bob
Repossess Laptop B
```

et que :

```text
Microsoft 365 reste à John
VPN history reste à John
Sophos Laptop A reste au Laptop A
Bob ne devient pas propriétaire de son historique
Sophos Laptop B reste au Laptop B en stock
Billing respecte les périodes de suspension
```

---

# 55. Découpage Codex recommandé

| Ordre | Task | Agent recommandé | Reasoning |
|---:|---|---|---|
| 1 | Service domain invariants + `ServiceLifecycleService` + scope validation | Senior Frappe Backend | High |
| 2 | `MSP Service Suspension` + migration + historique | Senior Frappe/Data Migration | High |
| 3 | Billing suspension-aware + protections périodes facturées | Senior Billing/Backend | High |
| 4 | Refactor UserService/DeviceService wrappers + Request target lookup | Senior Frappe Backend | High |
| 5 | User Detail : Personal / Device / Available services | Senior React/Full-stack | Medium–High |
| 6 | Device Detail + nouvelles modales lifecycle | React/TypeScript Full-stack | Medium–High |
| 7 | Portal query ownership corrections | Senior Full-stack | High |
| 8 | Suite tests métier + E2E | QA/Full-stack | High |

---

# 56. Ordre d’exécution impératif

Ne pas commencer par refaire `UserDetail.tsx`.

L’ordre doit rester :

```text
1. invariants Service Assignment
2. suspension history
3. lifecycle service
4. billing calculations
5. callers backend
6. APIs de disponibilité
7. UI
8. tests E2E
```

Sinon le frontend continuera simplement à masquer les incohérences backend.

---

# 57. Instruction générale à Codex

`MSP Service Assignment` représente une période réelle de fourniture d’un service à une cible réelle.

Ne jamais :

```text
déduire son propriétaire depuis le holder actuel d’un Device
réouvrir un assignment Ended
muter l'histoire pour représenter un Change
dédupliquer seulement par service_item
modifier billing_status indépendamment
écraser une période déjà facturée
```

Toujours utiliser :

```text
service
+
actual scope
+
actual target
+
effective period
```

comme identité métier.

Pour les Device services :

```text
the device owns the service
```

Pour les User services :

```text
the user owns the service
```

Et `Both` signifie uniquement :

```text
the catalogue allows either ownership model.
```