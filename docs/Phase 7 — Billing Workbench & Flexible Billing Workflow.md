# Phase 7 — Billing Workbench & Flexible Billing Workflow

## 1. Vision

La facturation devient un workflow guidé :

```text
1. SCOPE
      ↓
2. SELECTION
      ↓
3. VALIDATION
      ↓
4. REVIEW & APPROVAL
      ↓
5. INVOICE
      ↓
6. COMPLETE
```

L'objectif n'est pas de rigidifier Billing.

Au contraire :

> Le stepper structure le travail, tandis que l'étape Selection conserve une grande liberté sur ce qui sera facturé.

---

# 2. Ce qui fonctionne déjà et doit être conservé

Le système actuel possède déjà :

- sélection d'un Contract ;
- période libre ;
- presets temporels ;
- vérification des périodes déjà facturées ;
- filtres principaux et avancés ;
- sélection/désélection ligne par ligne ;
- persistance des exclusions lorsqu'on change les filtres ;
- discount global ;
- discount par ligne ;
- preview avant génération ;
- résumé par service ;
- exceptions ;
- approbation ;
- génération Sales Order + Sales Invoice ;
- gestion exchange rate ;
- accounting dimensions ;
- invoice draft ;
- submit invoice ;
- credit notes ;
- disputes.

On améliore donc cette base.

On ne recommence pas Billing à zéro.

---

# 3. Problème du workflow actuel

Aujourd'hui, le workflow est partagé entre :

```text
NewBillingRun
→ Period
→ Selection
→ Generate

puis

BillingRunDetail
→ Revalidate
→ Approve
→ Create invoice
→ Submit invoice
```

Fonctionnellement c'est déjà un workflow.

Mais visuellement et conceptuellement, ce sont deux expériences séparées.

Le nouveau Billing doit donner l'impression d'un seul processus continu.

---

# 4. Stepper global

Toujours afficher :

```text
SCOPE
SELECTION
VALIDATION
REVIEW
INVOICE
COMPLETE
```

Avec états :

```text
✓ completed
● current
○ upcoming
! needs attention
```

Exemple :

```text
Scope ✓
Selection ✓
Validation !
Review ○
Invoice ○
Complete ○
```

La personne sait immédiatement où se situe la Billing Run.

---

# 5. Mapping avec les statuts existants

Nous pouvons conserver quasiment tous les statuses existants.

| Workflow | Billing Run status |
|---|---|
| Scope / Selection | avant génération ou Draft |
| Validation running | Validating |
| Validation failed | Exception |
| Validation passed | Ready for Approval |
| Review approved | Approved |
| Invoice created | Invoice Drafted |
| Invoice submitted | Invoiced |
| Abandoned | Cancelled |

Pas besoin d'inventer une nouvelle machine à états.

---

# 6. Étape 1 — SCOPE

Elle répond seulement à :

> Qui facture-t-on et pour quelle période ?

Interface :

```text
BILLING SCOPE

Contract *
[ ACME Managed Services ▾ ]

Customer
ACME Corporation

Billing period
From [ 01/08/2026 ]
To   [ 31/08/2026 ]
```

---

# 7. Contract unique par Run

Conserver la règle existante :

> One contract → one Billing Run → one invoice.

Ne pas essayer de mettre plusieurs Customers ou Contracts dans le même Run.

Cela compliquerait :

```text
currency
price list
contract terms
accounting dimensions
customer invoice
discounts
payment terms
```

sans bénéfice réel.

---

# 8. Presets temporels

Conserver les presets existants :

```text
Last month
Last quarter
This quarter
This year
...
```

Mais les présenter comme shortcuts secondaires.

Je privilégierais en haut :

```text
Last month
Last quarter
Custom
```

et les autres dans :

```text
More periods
```

pour alléger l'interface.

---

# 9. Contrat immédiatement visible

Après sélection :

```text
ACME MANAGED SERVICES

Customer
ACME Corporation

Frequency
Monthly

Proration
Daily Actual Days

Currency
USD

Contract coverage
Jan 1, 2026 → Dec 31, 2026

Services covered
M365 · Sophos · RMM · Backup
```

Très bonne idée déjà présente dans l'écran actuel : à conserver.

---

# 10. Coverage check

Conserver :

```text
already billed
remaining to bill
fully billed
```

Mais le présenter comme une vraie validation de Scope.

Exemple :

```text
PERIOD COVERAGE

142 eligible assignments

120 already billed
22 remaining

Previous runs
BR-2026-08-001
BR-2026-08-002
```

Ceci matérialise explicitement que Billing peut se faire **en plusieurs passes**.

---

# 11. Billing en plusieurs passes est une fonctionnalité

Ne jamais considérer ceci comme une anomalie :

```text
Run A
→ une partie du Customer

Run B
→ le reste
```

Le code actuel le supporte déjà par `_already_invoiced()`.

Il faut préserver cette flexibilité.

---

# 12. Étape 2 — SELECTION

C'est le cœur du workflow.

Principe :

> Tout ce qui est éligible dans la période forme la population candidate.  
> L'utilisateur choisit ensuite exactement ce qu'il veut inclure dans cette Run.

---

# 13. Summary de sélection

Toujours montrer :

```text
148 candidates

132 selected
10 excluded manually
6 blocked

Estimated total
28,430 USD
```

Ne plus afficher uniquement :

```text
132 / 148 matched
```

Il faut distinguer :

```text
matched by filter
selected for run
manually excluded
blocked
already billed
```

---

# 14. Filtres principaux

Conserver :

```text
Service
Billed to
Service status
```

Ajouter une recherche simple :

```text
Search
[ user, email, hostname, serial... ]
```

C'est particulièrement utile sur les gros Customers.

---

# 15. Billed To

Conserver la distinction :

```text
Person
Machine
```

mais dans le backend elle reste :

```text
User
Device
```

Le wording humain actuel est bon.

---

# 16. Filtres avancés

Conserver selon pertinence :

```text
Department
User lifecycle status
Device type
Service start date
Last billed date
```

On peut également ajouter :

```text
Never billed
Partial period
Has suspension in period
```

si les données Phase 2 les permettent facilement.

Ne pas surcharger le panneau principal.

---

# 17. Department — sémantique importante

Pour :

```text
User-scoped service
```

Department correspond au département du User.

Pour :

```text
Device-scoped service
```

le Department ne doit **pas** être dérivé du détenteur actuel pour déterminer l'ownership.

Je recommande donc que le filtre Department s'applique clairement aux lignes User.

Ne pas utiliser :

```text
device.assigned_client_user.department
```

comme vérité historique de Billing.

---

# 18. Grouping de sélection

Permettre d'afficher les candidats :

```text
Group by
[ Service ▾ ]
```

Options utiles :

```text
Service
User
Device
Department
None
```

Le grouping ne change jamais le calcul.

C'est uniquement une aide à la sélection.

---

# 19. Exemple Group by Service

```text
MICROSOFT 365                         52 selected

☑ John Doe                     1.0 month
☑ Marie Doe                    1.0 month
☐ Peter Doe                    0.5 month
...


SOPHOS ENDPOINT                       39 selected

☑ LAPTOP-JDOE · SN ABC123
☑ LAPTOP-MDUPONT · SN DELL9282
```

---

# 20. Bulk selection

Ajouter :

```text
[ Select all matching ]
[ Exclude all matching ]
```

Important :

> `matching` signifie les résultats du filtre actuel, pas toute la Run.

Cela permet par exemple :

```text
Filter Department = Accounting
→ Exclude all matching
```

en une opération.

---

# 21. Selection persistante

Conserver l'excellente règle déjà présente :

> Une désélection est une décision de facturation, pas une conséquence du filtre courant.

Donc :

```text
exclude John
→ filter Sophos
→ filter M365
→ John reste excluded
```

jusqu'à ce que l'utilisateur le réinclue.

---

# 22. Très important — bug de Revalidate

Le comportement actuel doit être corrigé.

Aujourd'hui :

```text
generate(include=[selected assignments])
```

crée correctement la sélection.

Mais :

```python
revalidate()
```

reconstruit ensuite toutes les lignes de la période.

Cela peut donc **réintroduire des assignments volontairement exclus**.

C'est incorrect.

---

# 23. Nouvelle invariant de sélection

Une Billing Run doit mémoriser son scope sélectionné.

Conceptuellement :

```text
selected_assignment_ids
```

Revalidate doit reconstruire uniquement :

```text
assignments belonging to this Run selection
```

Jamais tous les assignments du Contract.

---

# 24. Modifier la sélection après génération

Tant que :

```text
docstatus = 0
```

et aucune Sales Invoice n'existe :

l'utilisateur doit pouvoir revenir à :

```text
SELECTION
```

et :

```text
add assignments
remove assignments
```

Puis :

```text
Revalidate
```

---

# 25. Une fois Approved

Après :

```text
Approved
```

la sélection est figée.

Changer le périmètre nécessite :

```text
Reopen / Amendment
```

ou une nouvelle Billing Run.

Cela correspond déjà au principe actuel de freeze.

---

# 26. Les lignes bloquées doivent faire partie de la sélection

Actuellement l'UI construit pratiquement :

```text
kept = billable lines only
```

puis `generate()` uniquement avec ces assignments.

Cela signifie que les exceptions visibles en Preview peuvent ne jamais entrer dans la Run.

Le workflow d'Exception perd alors beaucoup de son utilité.

---

# 27. Nouvelle règle

Une ligne peut être :

```text
Selected + Valid
Selected + Blocked
Excluded
Already billed
```

Un candidat `Selected + Blocked` entre dans la Draft Run.

Puis :

```text
VALIDATION
```

explique pourquoi elle bloque.

---

# 28. Le blocked n'est pas facturé

Même présent dans la Run :

```text
exception_code != null
```

→ montant facturé = 0 / excluded from invoice total.

L'approbation reste impossible tant que :

```text
selected blocked lines > 0
```

---

# 29. L'utilisateur dispose alors de deux choix

Pour chaque exception :

```text
Fix
```

ou :

```text
Remove from this run
```

Cela offre beaucoup plus de flexibilité.

---

# 30. Étape 3 — VALIDATION

Écran :

```text
VALIDATION

132 selected assignments

128 ready
4 blocked
```

Puis groupes :

```text
MISSING RATE                       2
ALREADY INVOICED                   1
INVALID QUANTITY                   1
```

---

# 31. Exception cards

Exemple :

```text
MISSING RATE

Microsoft 365
John Doe
Accounting

Period
Aug 1 → Aug 31

No valid contract rate covers this period.

[ Resolve ]
[ Remove from run ]
```

Pas besoin d'aller chercher la ligne au milieu d'une table de 400 éléments.

---

# 32. Réparation inline quand elle est sûre

Comme pour le Request Workbench :

> éviter les navigations inutiles.

Certaines exceptions peuvent être corrigées directement depuis Billing.

Exemple :

```text
Missing Rate
```

peut offrir :

```text
Set contract rate
```

si une API ContractService existe déjà pour le faire correctement.

---

# 33. Mais pas de mutation dangereuse juste pour éviter une navigation

Exemple :

```text
Invalid historical service dates
```

ne doit pas être "réparé" automatiquement par Billing.

Afficher :

```text
This Service Assignment has invalid historical dates.
Correct the underlying service history before billing it.
```

Puis :

```text
Remove from this run
```

reste possible.

---

# 34. Pas de `Open profile`

Le Billing Workbench n'a aucune raison d'avoir :

```text
View profile
```

comme seule action de ligne, comme actuellement.

Afficher directement le contexte utile :

```text
John Doe
Accounting
john@acme.com
```

ou :

```text
LAPTOP-JDOE
Serial ABC123
```

---

# 35. Revalidate

Après correction :

```text
[ Revalidate ]
```

ne change ni :

```text
selected assignments
manual exclusions
manual discounts
```

sauf si une donnée devenue invalide exige explicitement une intervention.

---

# 36. Discounts manuels

Le système actuel permet :

```text
Run Discount %
```

et :

```text
line discount
```

C'est utile.

Conserver les deux.

---

# 37. Règles de discount

### Run discount

S'applique à toutes les lignes sélectionnées selon les règles actuelles.

### Rate discount

Vient du pricing.

### Manual line discount

Permet une exception sur une cible précise.

---

# 38. Revalidate ne doit pas effacer un Manual Line Discount

Aujourd'hui le rebuild complet des lignes peut également remettre les discounts à ceux calculés depuis le rate/run.

Nouvelle règle :

```text
manual line adjustment
```

doit survivre à une revalidation du Draft.

La Run doit distinguer :

```text
calculated_discount
manual_discount
```

ou au minimum préserver explicitement les lignes `discount_source = Manual`.

---

# 39. Pourquoi service_assignment seul n'est plus toujours une clé suffisante

Phase 7 doit anticiper un autre point.

Si un rate change au milieu de la période :

```text
Aug 1–15 = 10 USD
Aug 16–31 = 12 USD
```

un même `MSP Service Assignment` doit potentiellement produire deux segments de facturation.

Donc :

```text
service_assignment
```

n'est plus toujours une identité unique de Billing Run Line.

---

# 40. Selection au niveau Assignment

Le client sélectionne néanmoins :

```text
John / Microsoft 365
```

comme une unité.

Puis le moteur peut produire :

```text
Segment 1
Aug 1–15
10 USD

Segment 2
Aug 16–31
12 USD
```

Cela garde l'UX simple tout en rendant le calcul exact.

---

# 41. Rate historique — correction critique

Le code actuel essaie d'abord :

```python
ContractService.current_rate(...)
```

pour une période historique.

Cela signifie qu'une facture d'août peut finir par utiliser un rate entré en vigueur en septembre.

Ce n'est pas acceptable pour un moteur de facturation historique.

---

# 42. Nouvelle règle Rate

Toujours résoudre le rate **applicable à la période réellement facturée**.

Si le rate change pendant la période :

segmenter la charge.

Exemple :

```text
M365

Aug 1 → Aug 14
Rate 10

Aug 15 → Aug 31
Rate 12
```

Puis totaliser.

---

# 43. Invoice grouping existe déjà pour ça

Le code actuel groupe par :

```text
service_item
rate
discount
```

C'est très bien.

Avec les segments historiques, l'Invoice peut naturellement produire :

```text
Microsoft 365 @ 10 USD
Microsoft 365 @ 12 USD
```

si nécessaire.

---

# 44. Suspension-aware Billing

Phase 2 a introduit les périodes de suspension.

Billing doit travailler à partir de :

```text
assignment effective period
MINUS
suspension intervals
```

et non uniquement :

```text
effective_start_date
effective_end_date
```

---

# 45. Exemple suspension

```text
Assignment
Aug 1 → Aug 31

Suspended
Aug 10 → Aug 15
```

Live periods :

```text
Aug 1 → Aug 9
Aug 15 → Aug 31
```

selon la convention définie en Phase 2 pour `resumed_on`.

Le moteur facture uniquement les périodes live selon la méthode contractuelle.

---

# 46. Proration

Conserver :

```text
Daily Actual Days
30-Day Convention
Start Next Month
...
```

La méthode contractuelle continue de décider comment les jours live sont transformés en mois facturables.

Les suspensions réduisent d'abord le live coverage.

Ensuite le Proration Method est appliqué.

---

# 47. 5-day rounding

Pour les méthodes utilisant le block de 5 jours :

faire le rounding **une seule fois sur le total de jours live du mois**, pas une fois par segment.

Exemple :

```text
Aug 1–3 active = 3 days
Aug 20–22 active = 3 days

Total live August = 6
→ rounded to 10
```

Pas :

```text
3 → 5
3 → 5
```

même résultat ici, mais essentiel pour d'autres combinaisons.

Le principe est :

```text
aggregate live days per calendar month
→ then apply proration rounding
```

---

# 48. Covered From / To n'est plus suffisant

Avec une suspension :

```text
Aug 1–9
Aug 16–31
```

ces deux champs :

```text
covered_from = Aug 1
covered_to = Aug 31
```

font croire que le service a été live sans interruption.

---

# 49. Ajouter un snapshot de couverture

Conserver :

```text
covered_from
covered_to
```

comme limites générales.

Ajouter un snapshot structuré des segments :

```text
billable_segments
```

conceptuellement :

```json
[
  {"from": "2026-08-01", "to": "2026-08-09"},
  {"from": "2026-08-16", "to": "2026-08-31"}
]
```

Cela peut être un champ JSON/Long Text read-only si l'on veut éviter un Child DocType supplémentaire.

---

# 50. UI coverage

Afficher :

```text
Coverage

Aug 01 → Aug 09
Aug 16 → Aug 31

Suspended
Aug 10 → Aug 15
```

plutôt que simplement :

```text
Aug 01 → Aug 31
```

---

# 51. Historical Snapshot — correction majeure

Une Billing Run approuvée doit être indépendante des données opérationnelles futures.

Aujourd'hui `get_run()` reconstruit notamment :

```text
device holder
user name
department
email
hostname
service name
```

depuis les records actuels.

Ce n'est pas suffisamment historique.

---

# 52. Exemple du bug

Août :

```text
LAPTOP-42
Holder = Alice
```

Run générée.

Septembre :

```text
LAPTOP-42
Transfer → Bob
```

Lorsque la Billing Run d'août est relue, elle ne doit jamais afficher :

```text
Bob
```

parce que Bob détient le Device aujourd'hui.

---

# 53. Billing Run Line doit porter son snapshot

Ajouter sur la ligne les informations utiles au moment de la génération.

Pour User scope :

```text
target_name_snapshot
user_name_snapshot
email_snapshot
department_snapshot
```

Pour Device scope :

```text
device_name_snapshot
hostname_snapshot
serial_snapshot
device_type_snapshot
```

Commun :

```text
service_name_snapshot
```

---

# 54. Device holder n'est pas le propriétaire de la Billing Line

Pour un Service Device :

```text
assignment_scope = Device
managed_device = Laptop-42
```

Cela suffit à déterminer l'identité facturée.

Ne jamais convertir cela en :

```text
client_user = current holder
```

---

# 55. Holder comme contexte seulement

On peut cependant afficher :

```text
HOLDER DURING PERIOD
```

à titre informatif.

Exemple :

```text
Alice
Aug 1 → Aug 14

Bob
Aug 14 → Aug 31
```

Source :

```text
MSP Device Holder
```

historique.

Pas :

```text
device.assigned_client_user
```

actuel.

---

# 56. Cela règle les transferts mid-period

Si le Device change de holder pendant le mois :

le Service Device reste une seule ownership :

```text
Sophos → Laptop-42
```

mais le contexte de Run explique :

```text
Alice → Bob
```

sans transférer artificiellement le Service Assignment.

---

# 57. Étape 4 — REVIEW & APPROVAL

Lorsque Validation est propre :

```text
128 lines ready
0 blocked

[ Continue to review ]
```

---

# 58. Review summary

Afficher d'abord la synthèse :

```text
ACME
August 2026

128 assignments
83 people
42 devices
7 services

Total months
117.5

Gross
31,100 USD

Discounts
- 2,670 USD

TOTAL
28,430 USD
```

---

# 59. Breakdown par Service

Conserver le très bon résumé déjà présent :

```text
M365
52 targets
48.5 months
12,400 USD

Sophos
39 targets
39 months
7,800 USD
```

---

# 60. Drill-down sans quitter Review

Cliquer sur :

```text
Microsoft 365
```

ouvre les lignes correspondantes dans le même écran.

Pas de navigation.

---

# 61. Review anomalies non bloquantes

Afficher également :

```text
12 partial-period charges
3 manually discounted lines
8 suspended-period adjustments
2 rate changes inside the period
```

Ce ne sont pas des erreurs.

Mais l'approver doit pouvoir les identifier facilement.

---

# 62. Review line display

Pour User :

```text
MICROSOFT 365

John Doe
Accounting
john@acme.com

Coverage
Aug 1 → Aug 31

1.0 month
Rate 20 USD
Discount 5%

19 USD
```

Pour Device :

```text
SOPHOS ENDPOINT

LAPTOP-JDOE
Serial ABC123
Dell Latitude

Holder during period
John Doe

1.0 month
15 USD
```

---

# 63. Prepared / Reviewed / Approved

Les champs existent déjà :

```text
prepared_by
reviewed_by
approved_by
```

Il faut enfin leur donner une vraie signification.

### Prepared By

Personne ayant généré la Draft sélectionnée.

### Reviewed By

Personne ayant validé le Review.

### Approved By

Personne qui freeze définitivement la Run.

Ils peuvent être identiques si les permissions le permettent.

Ne pas ajouter artificiellement un système four-eyes si le métier ne l'exige pas.

---

# 64. Action finale Review

```text
[ Approve billing run ]
```

doit clairement expliquer :

```text
128 lines
28,430 USD

After approval:
• selection is frozen
• rates are frozen
• discounts are frozen
• changes require amendment or credit note
```

---

# 65. Ne pas fusionner systématiquement Approval et Invoice

Le code actuel possède :

```text
finalise()
```

qui approve et crée l'Invoice en une opération.

C'est pratique.

On peut conserver :

```text
[ Approve and prepare invoice ]
```

comme action primaire.

Mais garder également :

```text
Approve only
```

si l'équipe veut une séparation.

---

# 66. Étape 5 — INVOICE

Une fois Approved :

le stepper passe automatiquement à :

```text
INVOICE
```

---

# 67. Accounting context directement intégré

Les données de :

```text
InvoiceAccountingModal
```

doivent être intégrées dans cette étape plutôt qu'apparaître comme une modal détachée du workflow.

Exemple :

```text
ACCOUNTING

Company
Nexgen

Cost Center
[ MSP ▾ ]

Other dimensions
[...]

Currency
USD

Company currency
XAF

Exchange rate
[ ... ]
```

---

# 68. Exchange Rate

Conserver la logique actuelle :

```text
ERPNext rate
or
manual override
```

mais montrer clairement :

```text
1 USD = 560 XAF
Source: Currency Exchange
Date: Sep 11, 2026
```

---

# 69. Invoice Preview avant création

Afficher :

```text
INVOICE PREVIEW

Microsoft 365
48.5 months × 20 USD
970 USD

Sophos Endpoint
39 months × 15 USD
585 USD

...

TOTAL
28,430 USD
```

basé sur `_invoice_groups()`.

Le responsable voit donc exactement comment 128 Billing Lines vont devenir par exemple 7 Invoice Lines.

---

# 70. Create Draft Invoice

Action :

```text
[ Create invoice ]
```

crée :

```text
Sales Order
Sales Invoice Draft
```

comme aujourd'hui.

---

# 71. Draft Invoice dans le même Workbench

Une fois créée :

```text
INVOICE DRAFT
SINV-2026-00125

Customer
ACME

Total
28,430 USD

Posting date
Sep 11

Due date
Oct 11
```

et les lignes directement visibles.

---

# 72. Pas besoin d'Edit Invoice comme parcours normal

Le lien actuel :

```text
Edit invoice
```

vers ERPNext Desk peut rester comme :

```text
Advanced
→ Open ERPNext document
```

pour les administrateurs.

Mais le workflow normal doit pouvoir terminer l'Invoice sans quitter Billing.

---

# 73. Submit Invoice

```text
☑ Notify customer

[ Submit invoice ]
```

Puis :

```text
status = Invoiced
```

et le workflow passe à Complete.

---

# 74. Étape 6 — COMPLETE

Afficher :

```text
BILLING COMPLETE

ACME Corporation
August 2026

Invoice
SINV-2026-00125

Posted
Sep 11, 2026

128 assignments billed

Total
28,430 USD
```

Actions :

```text
[ View invoice ]
[ Download PDF ]
[ Download breakdown ]
```

---

# 75. Breakdown export

Le breakdown doit utiliser les **snapshots Billing Run Line**.

Pas les Users/Devices actuels.

C'est indispensable.

---

# 76. Billing Run freeze

Après Approval :

la Run doit pouvoir être relue dans cinq ans et raconter exactement la même chose.

Ne doivent plus changer :

```text
target
user/device labels
department snapshot
service label
rate
discount
coverage
holder context
quantity
amount
```

même si les données opérationnelles changent.

---

# 77. Amendments

Le mécanisme actuel `reopen()` / amendment reste pertinent.

Si Approved mais pas encore invoiced :

```text
Reopen
```

crée une amendment Draft.

Le stepper revient à :

```text
SELECTION / VALIDATION
```

selon ce qui doit être modifié.

---

# 78. Credit Notes

Conserver le mécanisme existant.

Une Credit Note n'est pas une modification de la Run historique.

Elle est un nouveau document lié :

```text
Credit Note Of
BR-...
```

C'est le bon modèle.

---

# 79. Credit Note comme workflow secondaire

Depuis Complete :

```text
[ Issue credit note ]
```

ouvre un sous-workflow :

```text
1. Select invoiced lines
2. Amount/reason
3. Review
4. Generate credit note
```

Le système existant semble déjà avoir une partie importante de cette fonctionnalité.

Ne pas la mélanger au workflow principal avant Invoice.

---

# 80. Disputes

Même principe.

Une dispute n'altère jamais silencieusement les chiffres de la Run.

Elle est :

```text
flag
reason
request
resolution
possible credit note
```

Le modèle actuel est sain.

---

# 81. Selection snapshot

Je recommande de conserver sur la Billing Run un snapshot de la décision de sélection.

Exemple conceptuel :

```json
{
  "filters": {
    "services": ["M365"],
    "departments": ["Accounting"]
  },
  "selected_assignments": ["SA-1", "SA-2"],
  "excluded_assignments": ["SA-3"]
}
```

Ce snapshot est surtout utile pour audit/debug.

La vérité financière reste :

```text
Billing Run Lines
```

---

# 82. Ne pas reconstruire une Run à partir des filtres

Les filtres disent :

> comment l'utilisateur est arrivé à sa sélection.

Ils ne disent pas :

> ce qui doit être facturé.

La sélection finale des assignments est la vérité.

---

# 83. Revalidation sûre

`revalidate()` doit donc :

1. charger les assignment IDs appartenant à la Run ;
2. recalculer uniquement ces assignments ;
3. préserver les exclusions ;
4. préserver les adjustments manuels valides ;
5. recalculer rates/proration/exceptions ;
6. actualiser les snapshots tant que la Run n'est pas Approved.

---

# 84. Ajout d'un assignment au Draft

Lorsque l'utilisateur revient à Selection :

```text
+ Include John / M365
```

le nouvel Assignment est ajouté au selection scope.

Puis Validate le construit.

---

# 85. Suppression d'une ligne Draft

```text
Remove from run
```

ne modifie pas le `MSP Service Assignment`.

Cela modifie uniquement le scope de cette Billing Run.

---

# 86. Already Invoiced

Cette exception mérite une UX particulière.

```text
ALREADY BILLED

John Doe
Microsoft 365

Covered by
BR-2026-08-001

[ Remove from this run ]
```

Pas besoin d'essayer de "réparer".

---

# 87. Double billing protection

La protection actuelle :

```text
same Service Assignment
+
overlapping period
```

reste essentielle.

Elle doit continuer à tenir compte :

```text
Draft runs
Approved runs
Invoiced runs
```

hors Cancelled/Credit Notes selon les règles existantes.

---

# 88. Current-holder joins à supprimer

Chercher notamment :

```text
device.assigned_client_user
```

dans Billing.

Aucun de ces usages ne doit décider :

```text
ownership
eligibility
historical user identity
historical department
```

d'une Device Billing Line.

---

# 89. Device Billing identity

La ligne est :

```text
Sophos Endpoint
→ DEV-0042
```

et non :

```text
Sophos Endpoint
→ current holder of DEV-0042
```

---

# 90. Tests critiques — historique

### Test A

```text
August Run
Laptop A holder = Alice
```

Puis après Approval :

```text
Transfer Laptop A → Bob
```

August Run doit rester identique.

---

### Test B

```text
August Run
John department = Accounting
```

Puis :

```text
John → Finance
```

August Run doit toujours afficher :

```text
Accounting
```

---

### Test C

```text
Service label
Microsoft 365
```

renommé ensuite dans Item :

August Run conserve son snapshot original.

---

# 91. Tests critiques — suspension

```text
M365
Aug 1–31

Suspended Aug 10
Resumed Aug 16
```

Le calcul doit exclure la période suspendue selon la méthode de proration.

---

# 92. Tests critiques — rate change

```text
Aug 1–15
Rate = 10

Aug 16–31
Rate = 12
```

Le Run doit produire deux segments/rates corrects.

Il ne doit pas facturer tout le mois au rate actuel de septembre.

---

# 93. Tests critiques — selection

```text
100 assignments

Exclude 20 manually
Generate run
Revalidate
```

Résultat :

```text
80 assignments
```

Pas :

```text
100
```

---

# 94. Tests critiques — filters

```text
Exclude John

Filter = Sophos
Filter = M365
Clear filters
```

John reste excluded.

---

# 95. Tests critiques — blocked selection

```text
John M365
Missing Rate
Selected
```

La Run contient :

```text
John M365
Exception = Missing Rate
```

Approval impossible.

Puis :

```text
Remove from run
```

→ Approval devient possible si aucun autre blocker.

---

# 96. Tests critiques — manual discount

```text
John M365
Manual discount = 15%
```

Puis :

```text
Revalidate
```

15 % reste en place.

---

# 97. Tests frontend essentiels

Tester :

```text
six-step Billing stepper

selection survives filters

bulk select matching

bulk exclude matching

selected/excluded/blocked counters

group by Service
group by User
group by Device

blocked lines visible

remove blocker from run

return to Selection before approval

manual discount

validation summary

review summary

invoice grouping preview

accounting fields embedded

invoice draft embedded

submit from same workflow
```

---

# 98. Billing Run Line — champs snapshot recommandés

Ajouter au minimum des champs read-only tels que :

```text
service_name_snapshot

user_name_snapshot
email_snapshot
department_snapshot

hostname_snapshot
serial_snapshot
device_type_snapshot

holder_context_snapshot

billable_segments_json
```

Les noms exacts peuvent être adaptés à la convention du projet.

---

# 99. Snapshot versus Links

Conserver également les Links :

```text
service_assignment
service_item
client_user
managed_device
```

Ils sont utiles pour navigation/audit.

Mais le Link ne remplace jamais le snapshot historique.

---

# 100. prepared_by

Lors de la création de la Run :

```text
prepared_by = current user
```

automatiquement.

Pas à sélectionner manuellement.

---

# 101. reviewed_by

Lorsque la personne termine Review et demande Approval :

```text
reviewed_by = current user
```

---

# 102. approved_by

Lors de `approve()` :

```text
approved_by = current user
approved_at = now
```

comme logique financière finale.

---

# 103. Billing Workbench frontend

Je remplacerais progressivement :

```text
NewBillingRun.tsx
BillingRunDetail.tsx
```

par une architecture partagée :

```text
BillingWorkbench
BillingProgressStepper

BillingScopeStage
BillingSelectionStage
BillingValidationStage
BillingReviewStage
BillingInvoiceStage
BillingCompleteStage

BillingCandidateTable
BillingExceptionGroup
BillingLineCard
BillingSummary
InvoicePreview
```

---

# 104. Pas forcément une seule énorme page

Les stages peuvent continuer à être rendus conditionnellement.

Le point important est :

```text
one workflow
one visual language
one state progression
```

pas nécessairement un seul fichier React.

---

# 105. Mobile

Selection sur mobile doit devenir des cartes.

Exemple :

```text
☑ Microsoft 365

John Doe
Accounting

1 month
20 USD
```

Les gros tableaux restent acceptables Desktop.

---

# 106. Performance

Pour de très gros Customers :

ne pas charger des milliers de lignes DOM.

Prévoir :

```text
server-side search/filter
pagination or virtualization
```

tout en conservant un selection state global par assignment ID.

---

# 107. Selection globale avec pagination

Très important.

Si :

```text
5000 assignments
```

et l'utilisateur fait :

```text
Select all matching
```

il ne faut pas dépendre uniquement des 50 lignes chargées dans React.

Le backend doit pouvoir exprimer une sélection bulk basée sur les filtres ou retourner les IDs correspondants.

---

# 108. Definition of Done

Le scénario suivant doit fonctionner naturellement :

```text
New Billing Run

SCOPE
ACME
August 2026

SELECTION
142 candidates

Filter:
Accounting

Exclude 3 users

Filter:
Sophos

Exclude 2 devices

Clear filters

137 selected


VALIDATION

134 valid
3 blocked

Fix 1 Missing Rate

Remove 2 exceptions from Run

132 valid


REVIEW

132 assignments
28,430 USD

Apply 10% discount to one line

Review totals


APPROVE

Freeze Run


INVOICE

Accounting dimensions
Exchange rate
Preview grouped invoice

Create Invoice

Submit


COMPLETE

SINV-2026-00125
Posted
132 assignments
Final amount 28,390 USD
```

Le tout sans perdre les décisions de sélection entre les étapes.

---

# 109. Invariant principal

> **Filters are temporary views.**

> **Selection is a billing decision.**

> **Billing Run Lines are a historical snapshot.**

> **Approved Run is immutable financial history.**

C'est la base de toute la Phase 7.

---

# 110. Découpage Codex recommandé

| Ordre | Travail | Agent | Reasoning |
|---:|---|---|---|
| 1 | Historical snapshots + suppression current-holder dependency | Senior Frappe/Billing Backend | High |
| 2 | Suspension-aware + historical-rate calculations | Senior Billing Engineer | High |
| 3 | Persistent selection model + safe revalidation | Senior Frappe Backend | High |
| 4 | Flexible selection APIs/bulk operations | Senior Backend | High |
| 5 | Billing Workbench stepper | Senior React/UX | High |
| 6 | Validation & exceptions stage | Senior Full-stack | High |
| 7 | Review + embedded accounting/invoice stage | Senior Full-stack/ERPNext | High |
| 8 | Credit/dispute regression | Senior ERPNext Billing | High |
| 9 | Historical/business/E2E tests | QA + Billing specialist | High |

---

# 111. Première Task Codex

## Billing Integrity Foundation

Avant le stepper React, traiter les erreurs historiques.

L'agent doit :

```text
remove current-holder dependency from Billing ownership

make Device lines belong strictly to managed_device

introduce Billing Run Line snapshots

freeze:
service label
user details
device details
department
coverage context

make get_run read snapshots instead of current operational data

make billing suspension-aware

resolve historical rates by billed period

support rate segmentation

add regression tests for:
device transfer after invoice
user department change
service rename
suspension
rate change
```

Ne pas encore refaire l'interface.

---

# 112. Deuxième Task Codex

## Persistent Flexible Selection

Corriger ensuite :

```text
generate(include)
revalidate()
```

afin que la sélection soit une propriété durable du Draft.

L'agent doit garantir :

```text
manual exclusions survive revalidation
manual inclusions survive revalidation
manual discounts survive revalidation
blocked selected lines stay visible
blocked lines can be removed from run
selection can be edited until approval
approval freezes selection
```

Ce n'est qu'après cela que le nouveau stepper Billing doit être construit.