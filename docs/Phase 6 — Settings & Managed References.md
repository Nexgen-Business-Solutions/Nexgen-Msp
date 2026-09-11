# Phase 6 — Settings & Managed References

## 1. Objectif

Consolider les quelques données métier qui doivent réellement être administrées depuis l'application, sans transformer Settings en moteur de configuration universel.

Cette phase concerne uniquement :

```text
1. Departments
2. Request Actions
3. Import mappings liés à ces référentiels
4. Suppression des saisies libres correspondantes
5. Consolidation de l'interface Settings
```

Ne pas dynamiser :

```text
Device Types
Device statuses
User lifecycle statuses
Service statuses
Request statuses
Work Order statuses
User / Device / Both scopes
Billing statuses
Lifecycle transitions
Work Order types
```

Ces éléments sont des invariants applicatifs.

---

# 2. Architecture Settings cible

La page Settings existante reste la page centrale.

Organisation recommandée :

```text
SETTINGS

Portal

Organization
└── Departments

Requests
└── Request Actions

Import

Invoice
```

Il n'est pas nécessaire de créer plusieurs routes de Settings.

La navigation latérale existante convient.

---

# 3. Departments — référentiel global

Créer :

```text
MSP Department
```

Le référentiel est global.

Il n'existe aucun lien vers Customer.

Exemple :

```text
Accounting
Administration
Finance
Human Resources
IT
Legal
Management
Marketing
Operations
Procurement
Sales
Support
```

Une seule entrée :

```text
Accounting
```

sert à tous les Customers.

---

# 4. MSP Department

Champs :

| Field | Type | Règle |
|---|---|---|
| `department_name` | Data | Required |
| `enabled` | Check | Default 1 |
| `description` | Small Text | Optional |
| `sort_order` | Int | Optional |

Autoname :

```text
department_name
```

Le nom doit être globalement unique.

---

# 5. Unicité

Considérer comme identiques :

```text
Accounting
accounting
 ACCOUNTING
```

La vérification doit utiliser conceptuellement :

```python
department_name.strip().casefold()
```

Le label d'affichage conserve la casse officielle :

```text
Human Resources
```

---

# 6. Permissions

Modification :

```text
System Manager
MSP System Admin
```

Lecture interne :

```text
MSP Technician
MSP Customer Manager
MSP Customer Operator
```

Le portail client ne reçoit pas un accès DocType direct.

Il utilise une API filtrée.

---

# 7. DepartmentService

Créer :

```text
department_service.py
```

Responsabilités :

```python
list_departments()
save_department()
disable_department()
delete_department()
validate_department()
resolve_department()
```

`resolve_department()` est notamment utilisé par les Imports.

---

# 8. Active vs historique

Il faut distinguer deux usages.

Pour une nouvelle sélection :

```text
enabled = 1
```

uniquement.

Pour les filtres historiques :

les anciennes valeurs réellement utilisées doivent continuer à apparaître, même si le département est désactivé.

Exemple :

```text
New User
→ active departments only

Users filter
→ active + historical values

Billing filter
→ values present in historical records
```

---

# 9. Disable

`enabled = 0` signifie :

> Ne plus proposer ce département pour de nouvelles opérations.

Cela ne modifie pas les données existantes.

Exemple :

```text
Research & Development
Disabled
```

reste visible sur :

```text
existing users
historical requests
billing history
activity history
```

---

# 10. Delete

Un département utilisé ne doit pas pouvoir être supprimé.

Vérifier au minimum :

```text
MSP Client User.department
MSP Approver.department
open/draft MSP Service Request Lines
```

Message :

```text
"Accounting" is currently in use.
Disable it instead of deleting it.
```

Un département jamais utilisé peut être supprimé.

---

# 11. Rename

Le Rename doit rester contrôlé.

Si le département n'est jamais utilisé :

```text
normal rename
```

S'il est utilisé :

mettre à jour les références opérationnelles :

```text
MSP Client User.department
MSP Approver.department
Draft / open Request new_user_department
```

Ne pas réécrire les documents historiques terminés uniquement pour changer leur wording.

---

# 12. Champs Department existants

Ne pas imposer une migration massive vers des `Link`.

Conserver pour cette phase :

```text
MSP Client User.department
MSP Approver.department
MSP Service Request Line.new_user_department
```

comme chaînes de caractères.

Mais leur valeur doit désormais être contrôlée par `MSP Department`.

Avantages :

```text
moins de migration
snapshots historiques préservés
queries actuelles peu perturbées
```

---

# 13. Validation Client User

Toute nouvelle création ou modification de :

```text
MSP Client User.department
```

doit passer par :

```python
DepartmentService.validate_department(...)
```

Pour une nouvelle affectation :

```text
exists
enabled = 1
```

Un appel API direct ne doit pas pouvoir contourner le Select.

---

# 14. New User Request

La Phase 3 consomme simplement :

```text
MSP Department
```

Le portail affiche :

```text
Department *
[ Human Resources ▾ ]
```

Aucune saisie libre.

Le submit backend revalide la valeur.

---

# 15. Approval Authority

Le champ actuel :

```text
MSP Approver.department
Data
```

reste techniquement Data.

Mais l'interface devient obligatoirement :

```text
Limited to department

[ Accounting ▾ ]
```

Options provenant de `MSP Department`.

Aucune saisie libre.

---

# 16. Approver sans Department

Valeur vide signifie :

```text
Whole company
```

Donc :

```text
Department = NULL
→ unrestricted within the Customer

Department = Accounting
→ Accounting only
```

Cette sémantique ne change pas.

---

# 17. Create / Edit User interne

Toutes les interfaces internes doivent également utiliser le même Select.

Notamment :

```text
Create User
Edit User
User 360
Request Workbench → User Setup
```

Même API.

Même validation backend.

---

# 18. Aucune logique Customer

Supprimer toute logique :

```text
customer → departments
```

Il ne doit plus exister :

```text
load departments when customer changes
reset department because customer changed
```

Les mêmes options sont valides globalement.

---

# 19. Migration initiale Departments

Créer un patch qui collecte les valeurs distinctes existantes dans :

```text
MSP Client User.department
MSP Approver.department
MSP Service Request Line.new_user_department
```

et crée les `MSP Department` manquants.

Exemple :

```text
Customer A / Accounting
Customer B / Accounting
Customer C / IT
```

devient :

```text
Accounting
IT
```

---

# 20. Variantes de casse

La migration peut normaliser automatiquement :

```text
Accounting
ACCOUNTING
accounting
```

vers une entrée canonique.

Elle met à jour les références opérationnelles vers la valeur choisie.

---

# 21. Aliases sémantiques

Ne pas fusionner automatiquement :

```text
HR
Human Resources
Human Resource
```

Le système ne sait pas avec certitude qu'elles représentent la même chose.

Le patch doit produire un rapport :

```text
Potential department aliases:

HR
Human Resource
Human Resources
```

À corriger administrativement.

---

# 22. Request Actions — conserver le modèle existant

Le projet possède déjà :

```text
MSP Request Action
```

avec :

```text
title
action_type
description
enabled
```

C'est suffisant comme base.

Ne pas créer un second modèle.

---

# 23. Rôle de Request Action après Phase 3

Très important :

`MSP Request Action` n'est plus un énorme dropdown générique.

Phase 3 demande désormais au backend :

> quelles transitions sont valides pour ce service ?

Le backend peut répondre par exemple :

```text
Change
Suspend
Remove
```

et associer chaque type à son `MSP Request Action`.

Le référentiel fournit surtout :

```text
customer-facing title
description
enabled/disabled
display order
```

Le moteur continue de travailler avec :

```text
action_type
```

---

# 24. Action Types restent statiques

Conserver :

```text
Add
Change
Suspend
Resume
Remove
```

dans le code / DocType Select.

L'admin ne crée jamais :

```text
action_type = Whatever
```

Il configure seulement la présentation des transitions supportées par le moteur.

---

# 25. Une seule action active par Action Type

Le code actuel autorise théoriquement :

```text
"Terminate service" → Remove
"Delete service"    → Remove
"Close service"     → Remove
```

toutes activées.

Mais le moteur ferait exactement la même opération.

Cela donnerait trois choix différents sans différence métier.

Nouvelle invariant :

> Un seul `MSP Request Action` Enabled par `action_type`.

Exemple :

```text
Add
→ "Add service"

Change
→ "Change service"

Suspend
→ "Suspend temporarily"

Resume
→ "Resume service"

Remove
→ "Close service"
```

---

# 26. Actions historiques supplémentaires

Si les données existantes contiennent plusieurs Actions du même type :

elles peuvent rester pour l'historique.

Mais une seule peut être :

```text
enabled = 1
```

Les autres deviennent Disabled.

---

# 27. Request Action sort order

Ajouter :

```text
sort_order
Int
```

Ceci permet de contrôler l'ordre visuel sans dépendre de :

```text
alphabetical action_type
```

Exemple :

```text
Change    10
Suspend   20
Resume    30
Remove    40
```

---

# 28. Ce qui ne doit PAS être configurable par Request Action

Ne pas ajouter des options du genre :

```text
requires confirmation
changes billing
requires device
requires username
closes assignment
creates assignment
allowed from status
```

Ces règles appartiennent au lifecycle.

Sinon Settings pourrait casser le moteur métier.

Exemple :

```text
Remove
```

reste toujours une terminaison selon `ServiceLifecycleService`.

L'administrateur ne peut pas changer ce comportement.

---

# 29. Request Action UI

Section :

```text
REQUEST ACTIONS

Action                 Engine Type      Offered
------------------------------------------------
Add service            Add              Yes
Change service         Change           Yes
Suspend temporarily    Suspend          Yes
Resume service         Resume           Yes
Close service          Remove           Yes
```

Actions administratives :

```text
Edit wording
Enable / Disable
Reorder
```

---

# 30. Modal Request Action

Formulaire :

```text
Title
[ Close service ]

Action type
[ Remove ]

Description
[ Permanently end this service. ]

Display order
[ 40 ]

Offered
✓
```

---

# 31. Changement d'Action Type

Si une Request Action n'a jamais été utilisée :

l'Action Type peut être modifié.

Si elle est déjà utilisée :

je recommande de rendre :

```text
action_type
```

read-only.

Parce que changer :

```text
"Close service"
Remove → Suspend
```

changerait rétroactivement la signification d'un objet utilisé dans des Requests.

---

# 32. Rename d'une Request Action

Le title peut rester modifiable.

Le moteur continue de se baser sur :

```text
action_type
```

et les Requests historiques conservent également leur champ technique `action`.

Si l'audit exact du wording client devient juridiquement important plus tard, on pourra introduire un snapshot.

Pas nécessaire dans cette phase.

---

# 33. Disable Request Action

Désactiver :

```text
Suspend temporarily
```

signifie :

> Le portail ne propose plus de nouvelle Request Suspend.

Cela ne signifie PAS :

```text
ServiceLifecycleService.suspend() n'existe plus
```

Un administrateur ou une opération interne peut toujours avoir besoin du lifecycle.

Settings contrôle l'offre Request, pas le moteur.

---

# 34. Import — supprimer `department_prefix`

Le code actuel possède dans :

```text
MSP Customer Mapping
```

le champ :

```text
department_prefix
```

et peut produire :

```text
Subsidiary A — Accounting
```

Cela devient contraire au modèle global.

Supprimer cette logique.

---

# 35. MSP Customer Mapping

Le nouveau modèle devient simplement :

```text
excel_label
customer_id
create_as
```

Supprimer :

```text
department_prefix
```

du DocType et du frontend.

---

# 36. ExcelImportService

Supprimer :

```python
_department(record, prefix)
```

et :

```python
prefix = customer_mapping.department_prefix
```

Remplacer par :

```python
DepartmentService.resolve_department(record["department"])
```

---

# 37. Import — résolution canonique

Exemple catalogue :

```text
Human Resources
Accounting
IT
```

Spreadsheet :

```text
accounting
```

Peut être résolu case-insensitive vers :

```text
Accounting
```

Mais :

```text
HR
```

ne doit pas être deviné comme :

```text
Human Resources
```

---

# 38. Unknown Department

Si un Excel contient :

```text
Special Projects
```

mais que le référentiel ne le contient pas :

ne jamais créer automatiquement le Department.

Dry Run :

```text
Row 48
Unknown department "Special Projects".

Create it in Settings before importing this user.
```

L'import réel refuse la ligne concernée.

---

# 39. Blank Department dans les imports historiques

Pour ne pas casser des imports legacy :

un département vide peut continuer à produire :

```text
department = NULL
```

mais doit apparaître dans le rapport :

```text
users_without_department
```

ou équivalent.

Pour les nouveaux workflows interactifs, Department reste obligatoire selon la règle produit validée.

---

# 40. Import Settings UI

Supprimer la colonne :

```text
Department Prefix
```

de `UserImportPanel`.

La table Customer Mapping devient plus simple :

```text
Company in file
Customer
Create as
```

---

# 41. Les Services Mapping restent

Ne pas profiter de cette phase pour refaire :

```text
MSP Service Mapping
```

ou les Device Types d'import.

Ce sont d'autres problématiques.

Cette phase ne touche que le Department mapping concerné.

---

# 42. User list filters

Le backend actuel construit :

```sql
select distinct department
from `tabMSP Client User`
```

Ceci reste pertinent pour un **filtre historique**.

Ne pas remplacer aveuglément ce query par :

```text
all enabled MSP Departments
```

sinon le filtre montrerait des valeurs ne correspondant à aucun utilisateur.

Règle :

```text
forms → MSP Department
filters → actual data
```

---

# 43. Billing filters

Même principe.

Les filtres Billing doivent représenter les données effectivement présentes.

Un Department Disabled doit toujours être filtrable dans l'historique.

Ne pas lier un rapport historique uniquement au catalogue actif.

---

# 44. Portal Request context

Phase 3 doit obtenir les départements via son :

```text
get_new_user_request_context()
```

ou API équivalente.

Il n'est pas nécessaire que React appelle directement :

```text
list_departments()
```

si son context API les fournit déjà.

Éviter les appels supplémentaires inutiles.

---

# 45. Workbench Phase 4

Lors du :

```text
USER SETUP
```

le Department demandé est affiché :

```text
Marie Dupont
Human Resources
```

Il doit être considéré comme déjà validé par la Request.

S'il a été désactivé entre la Request et l'exécution :

ne pas bloquer automatiquement une Request approuvée historique.

Afficher éventuellement :

```text
Human Resources
Department is no longer offered for new users.
```

et laisser le technicien/superviseur décider si le traitement peut continuer.

---

# 46. Distinction validation nouvelle vs historique

C'est important.

### Nouvelle opération

```text
Department must exist
Department must be enabled
```

### Request déjà approuvée / donnée historique

```text
Department must remain readable
```

mais ne doit pas devenir invalide simplement parce qu'il a été désactivé hier.

---

# 47. Settings page UX

La navigation actuelle est correcte.

Je la réorganiserais en :

```text
Portal
Departments
Request Actions
Import
Invoice
```

ou avec petits groupes visuels si nécessaire.

Pas besoin d'un redesign architectural lourd.

---

# 48. Departments UI

```text
DEPARTMENTS

Search
[ __________________ ]

Department             Status       Used by
------------------------------------------------
Accounting             Active       112 users
Finance                Active        24 users
Human Resources        Active        63 users
Legacy Department      Disabled       8 users

[ + Add department ]
```

---

# 49. Usage counts

Afficher au minimum :

```text
Users
Approvers
```

ou un usage global.

Cela explique pourquoi Delete peut être bloqué.

---

# 50. Department modal

```text
ADD DEPARTMENT

Name *
[ Human Resources ]

Description
[ ... ]

Display order
[ 30 ]

Enabled
✓

[ Save ]
```

---

# 51. Search / Sort

Departments :

```text
sort_order
department_name
```

Request Actions :

```text
sort_order
title
```

Ne pas dépendre uniquement de `modified`.

---

# 52. Settings permissions frontend

L'entrée Settings doit rester réservée aux rôles administratifs.

Un Technician peut lire les référentiels nécessaires à ses workflows via les APIs métier, mais ne doit pas nécessairement voir :

```text
Settings → Departments
Settings → Request Actions
```

si son rôle ne permet pas l'administration.

---

# 53. API Departments interne

Ajouter :

```text
list_departments
save_department
delete_department
```

`save_department` gère également :

```text
enable / disable
rename
sort order
```

---

# 54. API Portal

Ne pas exposer CRUD Department.

Le portail reçoit seulement :

```text
enabled options
```

via les APIs métier.

---

# 55. Validation DocType directe

Même si toute l'UI utilise des Selects, une insertion Frappe directe doit être protégée.

Ajouter les validations appropriées sur :

```text
MSP Client User
MSP Service Request
MSP Approval Authority
```

ou dans leurs services de domaine.

L'interface ne constitue jamais la sécurité métier.

---

# 56. Tests Departments obligatoires

Tester :

```text
global department usable by Customer A and B

case-insensitive duplicate rejected

active department selectable

disabled department not selectable for new operation

disabled department remains readable historically

used department cannot be deleted

unused department can be deleted

new Client User with unknown department rejected

new Request with unknown department rejected

Approver with unknown department rejected

rename updates operational references

completed historical Request not rewritten unnecessarily
```

---

# 57. Tests Request Actions obligatoires

Tester :

```text
one enabled Request Action per action_type

second enabled action of same type rejected

disabled historical duplicate accepted

used action cannot change action_type

unused action may change action_type

disabled action absent from new Request context

disabled action does not disable ServiceLifecycle method

sort_order respected

used action cannot be deleted

unused action can be deleted
```

---

# 58. Tests Import obligatoires

Tester :

```text
department_prefix no longer used

canonical department exact match

canonical department case-insensitive match

unknown department fails row

unknown department is not automatically created

blank legacy department handled

Customer A + Accounting
Customer B + Accounting
→ both store "Accounting"

dry run reports unknown departments
```

---

# 59. Tests frontend obligatoires

Vérifier :

```text
Settings contains Departments

Department CRUD works

Department disable works

used Department delete disabled/error explained

Request Actions remain manageable

no duplicate enabled engine actions

Department is Select in:
Create User
Edit User
New User Request
Approval Authority

department_prefix removed from Import UI

Device Type remains unchanged/static
```

---

# 60. Audit final free-text

À la fin de la phase, rechercher :

```text
department
new_user_department
approver.department
```

dans tout le frontend.

Chaque **nouvelle saisie** doit être classée comme :

```text
Select from MSP Department
```

ou :

```text
historical/read-only display
```

Il ne doit plus rester un simple :

```html
<input type="text">
```

permettant d'inventer un Department.

---

# 61. Ce qui reste volontairement statique

Cette Phase doit explicitement garantir qu'on ne modifie pas :

```text
Managed Device.device_type
Request Line.new_device_type
Asset import device type handling
```

La liste actuelle :

```text
PC
Laptop
Mini PC
Mac
Phone
Tablet
Server
Firewall
VM
Other
```

reste une constante du produit.

Même règle pour tous les lifecycles.

---

# 62. Definition of Done

Après cette phase :

### Admin

```text
Settings
→ Departments
→ crée "Accounting" une seule fois
```

### Customer A

```text
New User
Department → Accounting
```

### Customer B

```text
New User
Department → Accounting
```

### Approval

```text
Approver limited to Accounting
```

utilise exactement la même valeur.

### Import

```text
Accounting
```

est résolu vers le même Department global.

Et il n'existe plus :

```text
Customer A — Accounting
Customer B — Accounting
Accounting 
ACCOUNTING
arbitrary free-text department
```

créés par les nouveaux workflows.

---

# 63. Architecture finale

```text
MSP Department
        ↓
DepartmentService
        ↓
 ┌─────────────┬───────────────┬──────────────┐
 Client User   Requests        Approval       Import
```

Et :

```text
MSP Request Action
        ↓
Request context / allowed actions
        ↓
Client Request Builder
```

Les deux référentiels restent petits, globaux et contrôlés.

---

# 64. Hors scope

Ne pas toucher dans cette Phase à :

```text
Billing workflow
Invoice generation
Device lifecycle
Service lifecycle
Request execution
Work Orders
Device Types
Service catalogue architecture
```

---

# 65. Découpage Codex recommandé

| Ordre | Travail | Agent | Reasoning |
|---:|---|---|---|
| 1 | `MSP Department` + DepartmentService + migration | Senior Frappe Backend | High |
| 2 | Validations Client User / Request / Approver | Senior Backend | High |
| 3 | Import cleanup + suppression `department_prefix` | Senior Backend/Data | Medium–High |
| 4 | Department Settings UI + Select consumers | Senior Full-stack | Medium–High |
| 5 | Request Action invariants + sort order | Senior Frappe Backend | Medium–High |
| 6 | Request Action Settings cleanup | React/Full-stack | Medium |
| 7 | Regression/import/business tests | QA/Full-stack | High |

---

# 66. Première Task Codex

## Global Department Foundation

Commencer par le backend :

```text
create MSP Department
create DepartmentService

implement:
list
save
disable
delete
validate
resolve

create migration from existing department strings

case-insensitive canonicalization

report ambiguous aliases

validate MSP Client User

validate new user Request department

validate Approval Authority department

add backend tests
```

Ne pas encore modifier Import et React dans cette première Task.

Quand cette fondation est stable, les formulaires peuvent tous basculer sur le même référentiel.