# Phase 2.5 — Global Managed Departments

## Principe

Les départements sont un référentiel **global MSP**.

Ils sont créés et administrés uniquement par les administrateurs de la plateforme.

Ils ne sont liés à aucun Customer.

Exemple :

```text
DEPARTMENTS

Accounting
Administration
Commercial
Customer Service
Finance
Human Resources
IT
Legal
Management
Marketing
Operations
Procurement
Production
Sales
Support
```

Tous les Customers utilisent ce même catalogue.

---

# 1. Nouveau DocType

Créer :

```text
MSP Department
```

Champs :

| Field | Type | Required |
|---|---|---:|
| `department_name` | Data | Oui |
| `enabled` | Check | Oui |
| `description` | Small Text | Non |
| `sort_order` | Int | Non |

Valeur par défaut :

```text
enabled = 1
```

Il n'y a **aucun champ Customer**.

---

# 2. Unicité

Le nom est globalement unique, insensible à la casse et aux espaces périphériques.

Ces créations doivent être considérées comme identiques :

```text
Accounting
 accounting
ACCOUNTING
```

La comparaison peut utiliser conceptuellement :

```python
department_name.strip().casefold()
```

La casse choisie pour l'affichage reste conservée :

```text
Human Resources
```

---

# 3. Usage côté client

Dans tous les formulaires client :

```text
Department
[ Select department ▾ ]
```

avec les départements globaux actifs :

```text
Accounting
Administration
Finance
Human Resources
IT
Operations
Sales
...
```

Le client :

```text
peut sélectionner
```

mais ne peut jamais :

```text
saisir une valeur arbitraire
créer un département
modifier le catalogue
```

---

# 4. New User Request

Pour :

```text
Request with NEW USER
```

le formulaire devient par exemple :

```text
NEW USER

Full name *
[ John Doe ]

Email
[ john@example.com ]

Department *
[ Human Resources ▾ ]
```

Le backend valide que :

```text
Human Resources
```

existe dans `MSP Department` et est actif.

Il n'a pas à vérifier le Customer.

---

# 5. Utilisateur existant

Pour un utilisateur sélectionné :

```text
JOHN DOE

john@customer.com
Accounting
```

Le département est simplement affiché.

On ne redemande pas au client de le sélectionner dans la Request sauf si la Request concerne explicitement une modification d'utilisateur.

---

# 6. Administration

Ajouter dans Settings :

```text
Settings
├── Request Actions
├── Departments
└── ...
```

Interface :

```text
DEPARTMENTS

┌─────────────────────────────────────────┐
│ Department            Status            │
├─────────────────────────────────────────┤
│ Accounting            Active            │
│ Finance               Active            │
│ Human Resources       Active            │
│ IT                    Active            │
│ Operations             Active            │
│ Sales                  Active            │
└─────────────────────────────────────────┘

[ + Add department ]
```

Aucun sélecteur Customer.

---

# 7. Add Department

```text
ADD DEPARTMENT

Department name
[ Research & Development ]

Description
[ optional ]

Enabled
✓

[ Add department ]
```

Une seule création rend immédiatement le département disponible à tous les clients.

---

# 8. Disable

La suppression doit rester exceptionnelle.

Par exemple :

```text
Research & Development
Enabled = false
```

Le département :

- n'est plus proposé dans les nouvelles sélections ;
- reste visible sur les utilisateurs existants ;
- reste présent dans les anciennes Requests ;
- reste disponible dans les historiques et filtres appropriés.

C'est préférable à la suppression.

---

# 9. Delete

Un département utilisé par au moins :

```text
MSP Client User
MSP Approver
Request active/draft
```

ne doit pas être supprimable.

Afficher :

```text
This department is currently in use.
Disable it instead of deleting it.
```

Un département jamais utilisé peut être supprimé.

---

# 10. Rename

Le Rename est plus délicat.

Exemple :

```text
Human Ressources
→
Human Resources
```

Pour les données courantes :

```text
MSP Client User.department
MSP Approver.department
```

on peut propager le nouveau nom.

Pour les documents historiques terminés :

```text
Completed Requests
Billing history
```

ne pas réécrire les snapshots historiques inutilement.

Le système doit conserver l'histoire telle qu'elle existait au moment de l'opération.

---

# 11. Validation backend

Toute nouvelle création ou modification de Client User doit valider :

```python
DepartmentService.validate_department(department)
```

Règles :

```text
exists
enabled = 1
```

Même validation pour :

```text
new_user_department
```

dans une nouvelle Request.

Donc un appel API manuel avec :

```json
{
  "new_user_department": "Whatever I Want"
}
```

doit échouer.

---

# 12. DepartmentService

Créer :

```text
department_service.py
```

avec conceptuellement :

```python
list_departments()
create_department()
update_department()
disable_department()
delete_department()
validate_department()
```

`list_departments()` côté formulaires retourne uniquement :

```text
enabled = 1
```

---

# 13. Portal API

Le Portal n'a plus besoin de contexte Customer pour obtenir les options.

Endpoint :

```text
list_departments()
```

renvoie simplement :

```json
[
  {
    "value": "Accounting",
    "label": "Accounting"
  },
  {
    "value": "Human Resources",
    "label": "Human Resources"
  },
  {
    "value": "IT",
    "label": "IT"
  }
]
```

Aucune information administrative supplémentaire n'est nécessaire côté client.

---

# 14. Create User interne

La modal interne doit également abandonner le texte libre :

```text
Customer
[ ACME ]

Name
[ John Doe ]

Department
[ Accounting ▾ ]
```

Contrairement à la précédente proposition :

```text
le changement de Customer ne change PAS les options de Department
```

puisque le catalogue est global.

C'est plus simple et plus cohérent.

---

# 15. Approval Authority

Même principe.

Au lieu d'un texte libre :

```text
Can approve for

○ Whole company
○ Department

Department
[ Finance ▾ ]
```

Tous les départements actifs sont disponibles.

L'autorité d'approbation reste évidemment liée au Customer dans son propre modèle.

Seule la **définition du département** est globale.

---

# 16. Migration

Récupérer les valeurs distinctes actuellement présentes dans :

```text
MSP Client User.department
MSP Approver.department
```

et construire un catalogue global.

Exemple existant :

```text
Customer A / Accounting
Customer B / Accounting
Customer C / Accounting
Customer B / IT
```

devient simplement :

```text
Accounting
IT
```

Pas quatre enregistrements.

C'est précisément l'intérêt du changement.

---

# 17. Doublons existants

La migration doit détecter :

```text
Accounting
ACCOUNTING
accounting
```

comme variantes potentielles.

Dans ce cas, on peut raisonnablement les normaliser vers une seule entrée globale après comparaison case-insensitive, tout en conservant un nom d'affichage canonique.

Pour des variations moins certaines :

```text
HR
Human Resources
Human Resource
```

ne pas fusionner automatiquement.

Produire un rapport :

```text
Potential department aliases:

HR
Human Resources
Human Resource
```

et laisser l'administrateur décider.

---

# 18. Imports Excel

Même règle.

Si le fichier contient :

```text
Accounting
```

et que le département existe :

```text
OK
```

Si :

```text
Special Whatever Team
```

n'existe pas :

```text
ERROR
```

avec :

```text
Department "Special Whatever Team" is not configured.
Create it in Settings before importing this user.
```

L'import ne crée jamais silencieusement un nouveau département.

---

# 19. Select vs historique

Deux listes peuvent être utiles.

### Pour créer/modifier

```text
enabled departments only
```

### Pour filtrer l'historique

```text
departments currently present in records
```

Ainsi un département désactivé reste utilisable dans les filtres historiques sans être proposé pour de nouveaux utilisateurs.

---

# 20. Important : ne pas utiliser automatiquement le Department ERPNext

Même s'il existe déjà un DocType `Department` dans ERPNext, je ne recommande pas de le réutiliser automatiquement.

Le Department ERPNext peut porter des concepts de :

```text
Company
hierarchy
accounting/HR organization
```

alors qu'ici nous avons besoin d'un référentiel MSP extrêmement simple :

```text
label
enabled
sort order
```

`MSP Department` évite de coupler notre workflow MSP à la structure organisationnelle interne d'ERPNext.

---

# 21. Definition of Done

À la fin :

```text
ADMIN
Settings → Departments
→ crée "Accounting" UNE FOIS
```

Puis :

```text
Customer A → New User → Accounting
Customer B → New User → Accounting
Customer C → New User → Accounting
```

Tous utilisent exactement le même département global.

Il ne doit exister aucun :

```text
Customer A / Accounting
Customer B / Accounting
Customer C / Accounting
```

dans le référentiel.

Et aucun nouveau workflow ne doit accepter :

```text
department = arbitrary free text
```

---

# 22. Dispatch Codex corrigé

## Task — Global Managed Departments

**Agent : Senior Full-stack Frappe + React/TypeScript**

**Reasoning : Medium–High**

Travail :

```text
MSP Department DocType
DepartmentService
migration
Settings UI
Portal Select API
Client User forms
New User Request
Approver forms
Excel import validation
tests
```

Ne pas toucher au Service Lifecycle de Phase 2.

Ne pas encore refaire le workflow Request complet.

Cette task prépare simplement :

```text
Department
→ global managed catalogue
→ reusable Select everywhere
```