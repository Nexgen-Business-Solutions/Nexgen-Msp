# Phase 1 — Device Lifecycle & Holder Management

## 1. Objectif

Refondre le cycle de vie des `MSP Managed Device` afin que l’application puisse représenter correctement et sans ambiguïté :

**Assign → Transfer → Repossess → Reassign → Retire → Reinstate**

Le `holder_log` doit devenir la seule source de vérité concernant la détention d’un device.

Le champ `assigned_client_user` reste dans le modèle, car de nombreuses requêtes l’utilisent et il est utile pour les performances, mais il devient strictement un **miroir calculé du holder courant**.

Aucun workflow ne doit plus écrire directement dans `assigned_client_user`.

---

# 2. Bugs confirmés à corriger

| Problème | Cause actuelle | Correction attendue |
|---|---|---|
| Impossible de redonner un device à son ancien détenteur | `device_holders.hand_over()` refuse de créer une nouvelle période si le dernier holder est le même utilisateur | Autoriser plusieurs périodes distinctes pour le même utilisateur |
| `assigned_client_user` ne suit pas toujours les actions | Certains workflows modifient directement `assigned_client_user`, puis `sync_current()` l’écrase | Toutes les modifications passent par `holder_log` |
| Un device `Stock` est considéré comme retired par certaines parties du code | `status != "Active"` est utilisé comme définition de retirement | Utiliser des catégories explicites d’état |
| Un device actif sans holder est possible | `Active` et holder sont gérés indépendamment | `Active` implique exactement un holder courant |
| Une repossession est pratiquement traitée comme un retirement | `Returned`/Retire ferme le holder et les services | Repossession → `Stock`, services inchangés |
| `assigned_date` est utilisé comme date d’assignation à une personne | Cette date appartient plutôt au cycle de vie du matériel | Conserver le champ mais le renommer visuellement `In Service Since` |
| Les devices hors service conservent parfois l’ancien utilisateur dans `assigned_client_user` | `sync_current()` copie le dernier holder lorsqu’il n’y a plus de holder ouvert | Hors période active : `assigned_client_user = NULL` |
| La résolution d’une Request écrit directement dans le cache | `_resolve_device()` affecte `device.assigned_client_user` | Appeler le lifecycle service |
| `Reinstate` crée `Active + Nobody` | Le statut passe à Active même sans nouveau holder | Sans holder : `Stock`; avec holder : `Active` |

---

# 3. Invariants métier définitifs

## 3.1 Ownership

Le **Customer possède le device**.

Le `MSP Client User` n’est jamais propriétaire du device. Il en est le **détenteur pendant une période donnée**.

Cela permet naturellement :

```text
Laptop DEV-0042

Alice
2026-01-10 → 2026-03-14

Bob
2026-03-14 → 2026-06-21

Alice
2026-06-21 → ...
```

Le retour chez Alice est parfaitement valide.

---

## 3.2 Holder history

Pour un device :

`holder_log` contient zéro ou plusieurs périodes historiques.

Une seule ligne au maximum peut avoir :

```text
to_date = NULL
is_current = 1
```

Cette ligne représente le détenteur actuel.

`assigned_client_user` doit toujours être :

```text
current_holder.client_user
```

ou :

```text
NULL
```

Il ne doit jamais représenter le dernier détenteur historique.

---

# 4. Nouvelle sémantique des statuts

Aucun nouveau statut n’est nécessaire.

| Status | Signification | Holder courant | Assignable |
|---|---|---:|---:|
| `Pending` | Device enregistré mais encore en staging | Non | Oui lors du premier déploiement |
| `Stock` | Device disponible chez le customer / en stock | Non | Oui |
| `Active` | Device actuellement déployé auprès d’un utilisateur | **Oui, obligatoire** | Non, sauf Transfer |
| `Damaged` | Device temporairement indisponible | Non | Non |
| `Lost` | Device déclaré perdu | Non | Non |
| `Retired` | Device définitivement sorti du parc | Non | Non |
| `Returned` | Ancien statut conservé pour compatibilité/historique | Non | Non |

`Returned` ne doit plus être utilisé pour représenter une repossession normale.

Une machine rendue par Alice mais restant dans le parc devient :

```text
Stock
```

et non :

```text
Returned
```

---

# 5. Machine à états

## Assign

```text
Stock/Pending
      |
      | Assign to Alice
      v
Active / Alice
```

Effets :

```text
status = Active
assigned_client_user = Alice

holder_log:
Alice | from_date = D | to_date = NULL | is_current = 1
```

Les services du device ne sont pas modifiés.

---

## Transfer

```text
Active / Alice
       |
       | Transfer to Bob
       v
Active / Bob
```

Effets :

```text
Alice.to_date = D
Alice.is_current = 0

new row:
Bob.from_date = D
Bob.to_date = NULL
Bob.is_current = 1

assigned_client_user = Bob
status = Active
```

Les services device-scoped restent exactement les mêmes.

---

## Repossess

```text
Active / Alice
       |
       | Repossess
       v
Stock / Nobody
```

Effets :

```text
Alice.to_date = D
Alice.is_current = 0

assigned_client_user = NULL
status = Stock
```

**Aucun MSP Service Assignment n’est automatiquement fermé.**

La machine peut immédiatement être réattribuée.

---

## Reassign à un ancien détenteur

Exemple :

```text
Alice
↓
Repossess
↓
Stock
↓
Alice
```

Résultat :

```text
Alice | 2026-01-10 → 2026-03-14
Alice | 2026-04-02 → ...
```

Ceci doit être explicitement autorisé et couvert par les tests.

---

## Retire

```text
Active / Stock / Damaged / Lost
              |
              | Retire
              v
           Retired
```

Si un holder existe, sa période est fermée.

Ensuite :

```text
assigned_client_user = NULL
status = Retired
out_of_service_date = effective_date
```

Les `MSP Service Assignment` de scope Device encore ouverts sont terminés.

Cette terminaison doit cependant respecter les protections de facturation : un retirement backdaté ne doit jamais réécrire silencieusement une période déjà facturée.

La règle utilisée pour terminer un service doit être cohérente avec la logique déjà présente dans `UserService._end_date_for()`.

---

## Reinstate

Deux variantes sont nécessaires.

Sans utilisateur :

```text
Retired / Damaged / Lost / Returned
               |
               | Reinstate
               v
             Stock
```

Avec utilisateur :

```text
Retired
   |
   | Reinstate + Alice
   v
Active / Alice
```

Dans ce deuxième cas une nouvelle période de holder est créée.

Les anciens services terminés ne sont **jamais recréés automatiquement**.

---

# 6. Services et cycle de vie

La règle fondamentale est :

> Une Service Assignment de scope `Device` appartient au device, pas au détenteur du device.

Par conséquent :

| Action | Device services |
|---|---|
| Assign | Aucun changement |
| Transfer | Aucun changement |
| Repossess | Aucun changement |
| Reassign | Aucun changement |
| Reinstate | Aucun service n’est recréé |
| Retire | Fermer les assignments encore ouverts |

Cette distinction prépare correctement la phase suivante consacrée aux Services.

---

# 7. Dates

Le champ existant :

```text
assigned_date
```

ne doit plus représenter « depuis quand Alice possède la machine ».

Il doit représenter :

```text
In Service Since
```

Le fieldname reste `assigned_date` afin d’éviter une migration inutile.

Dans `msp_managed_device.json`, changer son label en :

```text
In Service Since
```

et ajouter une description expliquant que la date du holder courant est disponible dans `holder_log.from_date`.

Le champ :

```text
retired_date
```

peut également garder son fieldname mais son label UI doit devenir :

```text
Out of Service Date
```

Il représente la date de sortie du dernier état disponible lorsqu’elle est pertinente.

Un Transfer ou une Repossession ne doit jamais modifier `assigned_date`.

Un Reinstate ne doit plus remettre `assigned_date` à la date courante.

---

# 8. Backend — `device_holders.py`

Fichier :

```text
nexgen_msp/utils/device_holders.py
```

Ce fichier doit devenir le cœur de la gestion des périodes.

La logique suivante doit être supprimée :

```python
if not current:
    last = _last_row(doc)

    if last and last.client_user == client_user:
        return False
```

C’est elle qui empêche la réattribution à un ancien détenteur.

`sync_current()` doit également être réécrit.

Il ne doit plus utiliser :

```python
retired = doc.status != "Active"
```

car `Stock` et `Pending` ne sont pas des statuses retired.

Le résultat de `sync_current()` doit simplement dériver la vérité du holder history :

```text
open row exists
→ is_current = 1
→ assigned_client_user = row.client_user

no open row
→ all is_current = 0
→ assigned_client_user = NULL
```

Le changement de statut appartient au lifecycle service et non à `sync_current()`.

---

# 9. Validation du holder history

Ajouter une validation centralisée.

Elle doit garantir :

| Contrôle | Règle |
|---|---|
| Current periods | Maximum 1 |
| `from_date` | Obligatoire pour toute nouvelle période |
| `to_date` | Jamais avant `from_date` |
| Chronologie | Une nouvelle période ne peut pas commencer avant la dernière transition enregistrée |
| Customer | Le holder doit appartenir au même Customer que le device |
| Current holder | Doit être la dernière période chronologique |
| `is_current` | Toujours dérivé, jamais saisi manuellement |

Une transition le même jour doit être autorisée :

```text
Alice → jusqu'au 11 septembre
Bob   → à partir du 11 septembre
```

La granularité actuelle est la journée, il ne faut donc pas essayer d’inventer une heure de transfert.

---

# 10. Nouveau Device Lifecycle Service

La logique métier ne doit plus être éparpillée entre :

```text
device_service.py
device_holders.py
request_service.py
user_service.py
MSPManagedDevice.validate()
```

Créer :

```text
nexgen_msp/api/internal/services/device_lifecycle_service.py
```

ou un module équivalent clairement isolé.

Il devient le seul endroit autorisé à effectuer une transition métier.

API interne proposée :

```python
DeviceLifecycleService.assign(...)
DeviceLifecycleService.transfer(...)
DeviceLifecycleService.repossess(...)
DeviceLifecycleService.retire(...)
DeviceLifecycleService.reinstate(...)
```

Chaque méthode doit faire la validation, modifier le holder history, modifier le statut, enregistrer les remarks/comments nécessaires, puis sauvegarder le device de façon atomique.

---

# 11. API publique interne

Les endpoints doivent devenir explicites.

```text
assign_device
transfer_device
repossess_device
retire_device
reinstate_device
```

Éviter une API générique du style :

```text
change_status(status="...")
```

pour les actions métier principales.

Une action comme `Transfer` contient beaucoup plus de règles qu’un simple changement de champ.

### Assign

Entrée :

```json
device
client_user
effective_date
note
```

### Transfer

Entrée :

```json
device
client_user
effective_date
note
```

### Repossess

Entrée :

```json
device
effective_date
note
```

### Retire

Entrée :

```json
device
effective_date
note
```

### Reinstate

Entrée :

```json
device
effective_date
client_user optional
note
```

Les anciennes fonctions `hand_over_device()` et `change_device_status()` peuvent temporairement rester comme wrappers de compatibilité, mais le frontend doit utiliser les nouvelles actions.

---

# 12. Règles de validation des actions

La date d’une transition ne peut pas être future.

Un Transfer ne peut pas être antérieur au `from_date` du holder courant.

Une Assign après une Repossession ne peut pas être antidatée avant la fin de la dernière période.

Un utilisateur d’un autre Customer est refusé.

Un utilisateur `Disabled` ou `Archived` est refusé comme nouveau détenteur.

Un utilisateur `Pending` ou `Active` peut recevoir une machine.

Assign vers le holder actuel est refusé.

Transfer vers le holder actuel est refusé.

Repossess sans holder courant est refusé.

Transfer sans holder courant est refusé.

Retire d’un device déjà `Retired` est refusé.

Reinstate d’un device déjà `Active` ou `Stock` est refusé.

---

# 13. `MSPManagedDevice.validate()`

Fichier :

```text
msp_managed_device.py
```

La validation doit devenir une dernière ligne de défense.

Après synchronisation du holder :

```text
status == Active
→ exactly one current holder
→ assigned_client_user != NULL

status != Active
→ no current holder
→ assigned_client_user == NULL
```

Une exception existe pendant une transition interne avant que toutes les mutations soient appliquées ; le service doit donc construire l’état cohérent avant le `save()`.

La validation doit empêcher qu’un futur code recrée :

```text
Active + Nobody
```

ou :

```text
Stock + Alice
```

---

# 14. Création d’un device

La fonction :

```text
DeviceService.create_device()
```

doit suivre cette règle.

Création sans holder :

```text
status = Stock
assigned_client_user = NULL
holder_log = []
```

Création avec Alice :

```text
status = Active
holder_log = [Alice]
assigned_client_user = Alice
```

Actuellement la création sans holder donne quand même :

```text
status = Active
```

Ceci doit être corrigé.

---

# 15. RequestService — correction obligatoire pendant cette phase

Fichier :

```text
request_service.py
```

Dans `_resolve_device()`, supprimer toute écriture du type :

```python
device.assigned_client_user = client_user
```

Pour un device existant :

```text
Stock + Alice requested
→ lifecycle.assign(device, Alice)
```

Si le device est déjà :

```text
Active / Bob
```

et que la Request tente de le donner à Alice, ne pas effectuer silencieusement le transfert.

Retourner une erreur métier explicite demandant un Transfer.

Le futur workflow Work Order pourra ensuite embarquer cette action correctement.

Cette phase ne doit pas encore refaire l’UX complète des Requests ; elle doit seulement empêcher les Requests de contourner le lifecycle.

---

# 16. UserService

`UserService.add_device()` peut continuer à déléguer à `DeviceService.create_device()`.

Mais toute réutilisation d’un device existant depuis la page User doit passer par :

```text
assign()
```

ou :

```text
transfer()
```

selon son état.

Aucun autre chemin ne doit écrire `assigned_client_user`.

---

# 17. Migration des données existantes

Créer un patch dédié, par exemple :

```text
normalize_device_lifecycle.py
```

Le patch doit normaliser tous les devices existants.

Règles :

| Situation existante | Après migration |
|---|---|
| `Active` + holder ouvert | Active + holder |
| `Active` sans holder ouvert | Stock |
| `Stock` sans holder | Stock |
| `Stock` + holder réellement ouvert | Active + holder |
| `Retired/Damaged/Lost/Returned` + holder ouvert | fermer la période |
| Aucun holder ouvert | `assigned_client_user = NULL` |
| Plusieurs holder rows ouvertes | conserver la plus récente comme current et fermer chronologiquement les précédentes |

Pour chaque device, reconstruire ensuite :

```text
is_current
assigned_client_user
```

depuis le `holder_log`.

Ne jamais reconstruire `assigned_client_user` à partir d’une ancienne valeur du champ lui-même.

`Returned` doit être conservé dans les anciennes données, mais aucun nouveau workflow normal ne doit produire ce status pour une repossession.

Le patch doit afficher un résumé :

```text
devices normalized
active → stock
holders closed
multiple-open histories repaired
assigned_client_user corrected
```

---

# 18. UX — Device Detail

Le frontend actuel utilise :

```typescript
const retired = device.status !== 'Active';
```

Cette logique doit disparaître.

`Stock` n’est pas retired.

Le haut du Device Detail doit afficher un bloc très visible :

```text
┌──────────────────────────────────────────┐
│ LAPTOP-JDOE                 [ ACTIVE ]   │
│ Serial: DELL-93K2-PQ                     │
│ Dell Latitude 5450                       │
│                                          │
│ CURRENT HOLDER                           │
│ John Doe                                 │
│ Accounting · since Sep 11, 2026          │
└──────────────────────────────────────────┘
```

Pour un device en stock :

```text
CURRENT HOLDER
Available in stock
```

Pour un retired device :

```text
CURRENT HOLDER
Nobody

Last holder
John Doe · until Sep 10, 2026
```

Le dernier holder est lu dans `holder_log`, jamais dans `assigned_client_user`.

---

# 19. Actions UI selon l’état

| État | Actions principales |
|---|---|
| Stock | `Assign to user` |
| Pending | `Assign to user` |
| Active | `Transfer` · `Repossess` |
| Damaged | `Reinstate` · `Retire` |
| Lost | `Reinstate` · `Retire` |
| Retired | `Reinstate` |
| Returned legacy | `Reinstate` |

Le bouton générique actuel :

```text
Hand over
```

doit disparaître au profit d’actions explicites.

L’utilisateur ne devrait jamais se demander si « Hand over to Nobody » signifie une repossession.

---

# 20. Modal Assign

Afficher d’abord le device :

```text
LAPTOP-042
Serial: SN-44923
Status: Stock
```

Puis :

```text
Assign to
[ Search/select user ]

Assignment date
[ 11/09/2026 ]

Internal note
[ ... ]
```

Tous les users `Active` et `Pending` du Customer doivent apparaître.

Un ancien détenteur doit apparaître normalement.

---

# 21. Modal Transfer

Afficher :

```text
LAPTOP-042
SN-44923

CURRENT HOLDER
Alice Martin
Since 02/06/2026

TRANSFER TO
[ Bob Smith ]

Transfer date
[ 11/09/2026 ]

Internal note
[ ... ]
```

Le holder actuel est exclu de la liste.

Les anciens holders ne le sont pas.

---

# 22. Modal Repossess

Pas de dropdown utilisateur.

Afficher directement :

```text
REPOSSESS DEVICE

LAPTOP-042
SN-44923

FROM
Alice Martin

DESTINATION
Available stock

Repossession date
[ 11/09/2026 ]

Internal note
[ ... ]

[ Repossess device ]
```

Le texte de confirmation doit préciser :

```text
Device services will remain unchanged.
```

---

# 23. Modal Retire

Afficher clairement les conséquences.

```text
RETIRE DEVICE

LAPTOP-042
Serial: SN-44923

Current holder:
Alice Martin

3 open device services will be ended.

Effective date
[ 11/09/2026 ]

Reason / internal note
[ ... ]

[ Retire device ]
```

C’est une opération destructive métier, contrairement à Repossess.

---

# 24. Modal Reinstate

Le comportement par défaut est :

```text
Return to stock
```

Option secondaire :

```text
Assign immediately to:
[ Alice ]
```

Sans personne :

```text
status = Stock
```

Avec personne :

```text
status = Active
new holder period created
```

Afficher :

```text
Previously ended services will NOT be restarted automatically.
```

---

# 25. Devices List

La liste doit distinguer clairement :

```text
Active
Stock
Damaged
Lost
Retired
```

Un Stock ne doit plus être présenté comme un device retired.

La notion actuelle :

```text
Unassigned Active Devices
```

doit disparaître car l’état devient incohérent par définition.

Le KPI doit devenir :

```text
Devices in stock
```

avec :

```sql
status = 'Stock'
```

Le filtre technique `coverage=unassigned` peut être maintenu temporairement comme alias pour compatibilité URL, mais le frontend doit employer `stock`.

---

# 26. Impacts transversaux à auditer

Après la correction, rechercher toutes les occurrences de :

```text
status != "Active"
status !== "Active"
assigned_client_user
```

Les endroits déjà identifiés comprennent notamment :

```text
device_service.py
user_service.py
request_service.py
dashboard_service.py
portal_service.py
DeviceDetail.tsx
DevicesList.tsx
AddDeviceModal.tsx
AssignServiceModal.tsx
useServiceRequestForm.ts
```

Il ne faut pas remplacer aveuglément chaque comparaison.

Chaque occurrence doit être classée selon ce qu’elle cherche réellement à savoir :

```text
deployed?
available?
out of service?
has current holder?
can receive services?
```

La réponse doit alors employer le bon prédicat.

---

# 27. Prédicats backend recommandés

Centraliser des constantes/helpers afin d’éviter de refaire l’erreur.

Exemple conceptuel :

```python
DEPLOYED_STATUSES = ("Active",)
AVAILABLE_STATUSES = ("Pending", "Stock")
UNAVAILABLE_STATUSES = ("Returned", "Damaged", "Retired", "Lost")
TERMINAL_STATUSES = ("Retired",)
```

Puis utiliser des fonctions nommées plutôt que :

```python
status != "Active"
```

---

# 28. Tests backend obligatoires

Les tests de `MSP Managed Device` sont actuellement pratiquement vides. Cette phase doit réellement construire la couverture du domaine.

Scénarios indispensables :

| # | Scénario | Résultat |
|---:|---|---|
| 1 | Create sans holder | Stock / aucun current holder |
| 2 | Create avec Alice | Active / Alice current |
| 3 | Assign Stock → Alice | Active / Alice |
| 4 | Repossess Alice | Stock / NULL |
| 5 | Reassign même device à Alice | nouvelle période Alice créée |
| 6 | Transfer Alice → Bob | Alice fermée / Bob current |
| 7 | Transfer Bob → Alice | troisième période valide |
| 8 | Transfer vers holder actuel | erreur |
| 9 | User d’un autre Customer | erreur |
| 10 | Disabled/Archived user | erreur |
| 11 | Future date | erreur |
| 12 | Transfer avant `current.from_date` | erreur |
| 13 | Assign antidaté avant dernière période | erreur |
| 14 | Retire Active | holder fermé + assignments terminés |
| 15 | Retire Stock | Retired sans holder |
| 16 | Reinstate sans holder | Stock |
| 17 | Reinstate avec Alice | Active + nouvelle période |
| 18 | Reinstate ne recrée pas les services | assignments restent ended |
| 19 | Save device ne peut pas désynchroniser cache/history | cache corrigé |
| 20 | RequestService utilise lifecycle | aucune écriture directe du cache |
| 21 | Stock n’est jamais compté comme Retired | régression portal/dashboard |
| 22 | Multiple open holder rows migration | historique réparé |

---

# 29. Tests frontend obligatoires

Utiliser Vitest sur les composants/actions concernés.

Vérifier :

```text
Stock → Assign visible
Stock → Retire/Reinstate incorrects non proposés comme action principale

Active → Transfer + Repossess visibles

Retired → Reinstate visible

ancien holder disponible dans Assign/Transfer

Repossess affiche destination Stock

Repossess indique que les services restent inchangés

Retire indique que les services sont terminés

Reinstate sans holder produit Stock

Serial number + hostname + holder toujours visibles dans les modales
```

---

# 30. Non-régression critique

Le système possède déjà un test indiquant explicitement :

```text
"stock is not retired"
```

Cette règle doit rester vraie partout, pas uniquement dans `PortalService`.

Il faut également conserver la logique :

```text
device-scoped service follows the device
```

Le changement de holder ne doit jamais recréer ou déplacer le Service Assignment.

---

# 31. Definition of Done

La phase est terminée uniquement lorsque ces scénarios peuvent être exécutés depuis l’interface sans intervention directe dans Frappe :

```text
Register → Stock
Stock → Alice
Alice → Bob
Bob → Stock
Stock → Bob
Bob → Alice
Alice → Retired
Retired → Stock
Stock → Alice
```

Et à chaque étape :

```text
status
assigned_client_user
holder_log
services
UI
```

doivent raconter exactement la même histoire.

Il ne doit plus être possible d’obtenir :

```text
Active + no holder
Stock + current holder
Retired + assigned_client_user
two current holders
assigned_client_user different from holder_log
```

---

# 32. Découpage d’implémentation Codex

| Ordre | Task | Profil recommandé | Niveau |
|---:|---|---|---|
| 1 | Lifecycle domain + `device_holders.py` + invariants | **Codex Senior Backend / Frappe, High reasoning** | Très élevé |
| 2 | Migration patch + backend integration tests | **Codex Senior Backend / Data migration, High reasoning** | Très élevé |
| 3 | Refactor des callers `DeviceService`, `RequestService`, `UserService` | **Codex Senior Full-stack / Frappe, High reasoning** | Élevé |
| 4 | Device Detail + Assign/Transfer/Repossess/Retire/Reinstate modals | **Codex Full-stack React/TypeScript, Medium–High reasoning** | Élevé |
| 5 | Audit des prédicats `status != Active` + régressions portal/dashboard | **Codex Senior Full-stack Reviewer, High reasoning** | Très élevé |
| 6 | Suite Vitest + tests de parcours | **Codex QA/Full-stack, Medium–High reasoning** | Élevé |

La tâche **1 ne doit pas être mélangée avec l’UI**. Le backend doit être rendu cohérent et testé avant que Codex commence les composants React.

---

# 33. Instruction générale à Codex

Ne pas résoudre les problèmes en ajoutant de nouveaux champs ou DocTypes sans nécessité démontrée.

Réutiliser :

```text
MSP Managed Device
MSP Device Holder
MSP Service Assignment
```

Ne jamais contourner le lifecycle service avec un :

```python
db_set("assigned_client_user", ...)
```

ou :

```python
device.assigned_client_user = ...
```

La seule source de vérité de la détention est `holder_log`.

Le champ `assigned_client_user` est uniquement un index/cache dérivé.

Préserver les données historiques.

Ne jamais transformer une action métier en simple changement de champ de status.

Toutes les transitions doivent avoir des tests de domaine avant adaptation UI.