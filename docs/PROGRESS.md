# Mémoire commune — Refonte Nexgen MSP

> **À lire avant de commencer quoi que ce soit sur ce projet.**
> Ce fichier est la mémoire partagée de l'avancement. Plusieurs agents travaillent sur la
> même branche : chacun lit ce qui a déjà été fait, poursuit, et **met ce fichier à jour**
> avant de rendre la main.

Branche de travail : `idriss/projet-refont` · Site : `msp.localhost` · App : `nexgen_msp`

---

## 1. Règles de collaboration

| Règle | Détail |
|---|---|
| Specs | `/docs/Phase N — *.md`. À suivre strictement, sans initiative au-delà. |
| Langue | Specs en français, **application entièrement en anglais**. |
| Commits | Messages courts et simples (`after phase 2 done`). **Jamais de co-auteur.** |
| Vérification | Suite backend complète + `pyflakes` + `yarn build/lint/test` avant de committer. |
| Données de test | Tout enregistrement créé porte le préfixe `ZZTEST` et est nettoyé. Zéro résidu. |
| Ce fichier | Mis à jour à chaque étape terminée, par celui qui la termine. |

### Commandes utiles

```bash
cd /home/admindev1/frappe-bench
/home/admindev1/.local/bin/bench --site msp.localhost run-tests --app nexgen_msp
/home/admindev1/.local/bin/bench --site msp.localhost run-tests --app nexgen_msp --module nexgen_msp.tests.<module>
/home/admindev1/.local/bin/bench --site msp.localhost migrate
/home/admindev1/frappe-bench/env/bin/python -m pyflakes apps/nexgen_msp/nexgen_msp
/home/admindev1/.local/bin/bench --site msp.localhost execute nexgen_msp.utils.data_audit.print_report
/home/admindev1/.local/bin/bench --site msp.localhost execute nexgen_msp.utils.load_bench.run
cd apps/nexgen_msp/frontend && yarn build && yarn lint && yarn test
```

### Pièges déjà rencontrés (ne pas les redécouvrir)

- **`bench run-tests` exécute les méthodes de test en parallèle.** Une fixture au nom
  codé en dur partagé entre méthodes provoque des collisions intermittentes. Utiliser
  `frappe.generate_hash(length=6)` comme suffixe quand une classe crée des enregistrements
  lourds ou des demandes qui restent « en vol ».
- **Si `setUp()` échoue, `tearDown()` n'est pas appelé** : ce qui a déjà été committé en base
  reste orphelin. Suivre (`self.track`) au plus tôt.
- **Les tests tournent sur la vraie base du site**, pas sur une base jetable.
- Un test qui appelle un patch de migration l'exécute **sur les données réelles**.
- Pour obtenir un vrai diff `Version` dans un test : `doc.save(ignore_version=False)`.
- `make_department()` crée des départements partagés **volontairement non détruits** (sinon
  deux méthodes concurrentes se marchent dessus). Ils portent le préfixe : après une suite
  complète, balayer les `MSP Department` contenant `ZZTEST` pour ne pas les laisser dans le
  catalogue que voient les clients.
- Les règles d'intention de la Phase 3 ne sont rejouées que **quand la demande est écrite**
  (lignes modifiées, ou demande qui quitte Draft / Awaiting Customer Approval). Sinon une
  machine qui change de mains rendait la demande impossible à sauvegarder — alors que c'est
  précisément le cas que le transfert de la Phase 4 doit traiter.
- Un Work Order est committé dès la construction du plan : `MSPTestCase` les balaie avec la
  demande (`_purge_work`), sinon un test qui échoue après l'approbation les laisse orphelins
  et le numéro de demande réutilisé fait échouer le suivant.
- Les redis de bench (ports 11000 et 13000) doivent tourner, sinon **tous** les tests
  échouent sur `Should not fail silently in tests` à la première écriture indexée. Les
  relancer : `redis-server config/redis_cache.conf` et `redis-server config/redis_queue.conf`
  depuis `frappe-bench`.
- Une session portail porte une User Permission sur son `Customer` : Frappe la recopie
  automatiquement dans tout champ Link `customer` d'un document créé par cette session.
  `make_department()` insère donc en tant qu'`Administrator`, sinon le département partagé
  ressort marqué comme appartenant à une entreprise.

---

## 2. État général

| Phase | Sujet | État |
|---|---|---|
| 1 | Device Lifecycle & Holder Management | ✅ terminée |
| 2 | Service Lifecycle & Ownership | ✅ terminée |
| 2.5 | Global Managed Departments | ✅ terminée |
| 3 | Client Request Workflow | ✅ terminée |
| 4 | Request Technician Workbench & Execution Stepper | ✅ terminée |
| 5 | User 360° Operational View | ✅ terminée |
| 6 | Settings & Managed References | ✅ terminée |
| 7 | Billing Workbench & Flexible Billing Workflow | ✅ terminée |
| 8 | Cross-System Audit, Migration & E2E Acceptance | ✅ terminée |
| — | Addon Hassan — Customer Management & Security | ✅ terminée |
| P0 | Separate Client Users from Portal Accounts | ✅ terminée, périmètre réduit par Idriss |

Les huit phases des specs sont faites, et l'addon avec elles. Rien n'est en attente : la
suite complète est verte et les specs sont closes.

### P0 — Décision d'Idriss du 2026-09-13 (prime sur la spec)

**Un `MSP Client User` n'est qu'une donnée de notre système.** Il n'a aucune prétention à
devenir un User ni à avoir un accès. Un compte pour gérer une entreprise se crée directement
dans `/accounts`, et nulle part ailleurs.

**Annulé dans la spec P0, à ne pas construire :**

- le champ `MSP Client User.portal_user` et tout lien explicite Client User ↔ User ;
- `PortalAccountService.grant_access` / `revoke_access`, et toute invitation depuis la fiche
  utilisateur ;
- le panneau « PORTAL ACCESS » de User 360, le bouton « Grant access » et la mention
  « No portal account ».

**Fait :**

- `MSP Client User.portal_visible` supprimé du DocType, plus écrit ni à la création, ni à
  l'import Excel, ni par `load_bench`.
- User 360 ne renvoie plus `portal_access`, la carte d'identité n'affiche plus
  « Portal access enabled ».
- `MSP Service Request Line.needs_portal_access` supprimé (choix d'Idriss : option 1). Plus
  accepté par l'API, plus affiché — ni étiquette « Portal access », ni « Portal access was
  requested. » dans l'étape de création. L'e-mail d'un nouvel arrivant est facultatif.
- `test_client_users_are_not_accounts` (7) : créer une personne, lui mettre un e-mail, en
  importer 500 ou demander un nouvel arrivant ne crée aucun User, Contact, permission ni mail.

Les colonnes `portal_visible` et `needs_portal_access` restent en base : Frappe ne supprime
pas une colonne quand un champ disparaît, et elles ne sont plus lues nulle part.

**Échec préexistant, hors P0 :** `test_access_guards.test_generic_lists_return_no_msp_rows_to_a_customer_contact`,
ajouté par le commit `review code`, échoue aussi sans les changements P0 (vérifié en les
retirant). Le test attend une liste vide ; Frappe lève `PermissionError` pour un compte sans
droit de lecture sur le DocType. À trancher par l'auteur du test.

### Correction Specification v2 — NE PAS APPLIQUER telle quelle (Idriss, 2026-09-13)

Idriss a jugé cette spec incorrecte sur plusieurs points. Il teste lui-même l'application et
décidera au cas par cas de ce qu'on garde ou change. **Aucun agent ne l'implémente d'office.**

Déjà tranché, à l'encontre de la spec :

- **Départements par entreprise conservés** (contre §73 / P0-07) : le champ `customer` et le
  sélecteur « Customer » de Settings restent.
- **Données techniques client facultatives conservées** (contre §51 / P0-06) : le client peut
  toujours saisir nom de compte, nom d'hôte, numéro de série et type d'appareil s'il les connaît.

Tranché ensuite par Idriss, point par point, et implémenté :

| Point | Décision | Fait |
|---|---|---|
| Autorité des demandes | La matrice décide seule | Un compte absent de la matrice ne peut ni créer ni préparer un brouillon. Plus de « oui » par défaut. Le personnel Nexgen n'est pas concerné. |
| Invitations | E-mail envoyé par défaut | Rien changé |
| Statut d'un Client User | Désactivable, comme avant la refonte | « Disable » / « Reactivate » sur User 360 : date et motif, aucune cascade sur services, machines ou facturation. `test_client_user_status` (14). |
| Service de machine sans machine | Non tranché | Rien changé |
| Contrats | Pas deux contrats sur le même service aux mêmes dates | Exclusivité par chevauchement de dates (fin vide = infinie, brouillon libre). Ouverture, liste de prix, catalogue client et détail de demande choisissent le contrat qui couvre le jour. `test_contract_periods` (13). |
| Tarifs | Garder l'existant d'avant refonte | Rien changé : identique à avant la refonte |
| Prorata | Blocs de 5 jours sur 30 | Défaut `30-Day Convention`, les 10 contrats migrés (`thirty_day_proration`). Les Runs déjà tirées gardent leurs quantités. |
| Fin de service déjà facturé | Accepté après confirmation | Plus de refus. La fenêtre de clôture indique « Invoiced up to … » et que la facture reste inchangée, sans avoir. Suspendre / reprendre restent protégés. |

**Toujours ouvert :** un changement de tarif en milieu de mois arrondit chaque tranche de tarif
séparément (10 + 3 jours → 10 + 5). La spec §135 demande une décision explicite ; rien n'a été
inventé.

---

## 3. Ce qui a été construit

### Phase 1 — Cycle de vie des appareils ✅

L'historique de détention (`holder_log`) est la **source de vérité unique** : `assigned_client_user`
n'en est qu'un reflet dérivé à chaque sauvegarde.

- `nexgen_msp/utils/device_holders.py` — historique, invariants (une seule période ouverte,
  pas de chevauchement, la période ouverte est la dernière).
- `nexgen_msp/utils/device_status.py` — les statuts et leurs prédicats, côté Python.
- `frontend/src/features/internal/utils/deviceStatus.ts` — le même vocabulaire côté React.
- `nexgen_msp/api/internal/services/device_lifecycle_service.py` — **les cinq seuls actes** :
  `assign`, `transfer`, `repossess`, `retire`, `reinstate`.
- Invariant central : `status == "Active"` ⟺ exactement un détenteur courant.
- Patches : `normalize_device_lifecycle`, `backfill_holder_period_dates`.
- Interface : fiche appareil avec les cinq modales dédiées.

### Phase 2 — Cycle de vie des services ✅

Un `MSP Service Assignment` appartient à **exactement une cible** : un utilisateur **ou** un
appareil. Le détenteur d'une machine ne devient jamais propriétaire des services de celle-ci.

- Invariants du DocType : compatibilité scope catalogue/assignation, chevauchement vérifié
  **y compris sur l'historique**, `billing_status` **dérivé** de `operational_status`.
- `MSP Service Suspension` (table enfant `suspension_log`) + `nexgen_msp/utils/service_suspensions.py`.
- `nexgen_msp/api/internal/services/service_lifecycle_service.py` — les dix actes
  (`activate`, `create_pending`, `activate_pending`, `suspend`, `resume`, `schedule_removal`,
  `cancel_removal`, `end`, `cancel`, `change`). **Toute transition passe par là.**
- Facturation consciente des suspensions : les jours suspendus sont déduits, et un service
  suspendu n'est plus exclu de la facturation (il l'était : bug confirmé de la spec §2).
- `service_availability_service.py` — ce qu'une cible peut recevoir (contrat, tarif, scope).
  Méthodes `read_user` / `read_device` réutilisables **sans** le garde interne.
- Correction d'attribution : un service d'appareil clos sous un ancien détenteur ne remonte
  jamais chez le nouveau (`SERVICE_UNDER_USER` dans `user_service.py` et `portal_service.py`).
- Patch : `normalize_service_assignments`.

### Phase 2.5 — Départements globaux ✅

Référentiel **global MSP**, sans lien avec un client.

- DocType `MSP Department` + `department_service.py` (unicité insensible à la casse,
  suppression refusée si utilisé, renommage propagé aux références courantes).
- Migration `build_department_catalogue` : 20 départements réels consolidés depuis les
  anciennes saisies libres.
- Plus aucun champ texte libre : Réglages, portail, formulaires internes, droits
  d'approbation, import Excel passent tous par le catalogue.
- Un département peut exceptionnellement porter un `customer` : il n'est alors proposé qu'à
  cette entreprise. Sans client renseigné (le cas normal), il reste offert à tout le monde.
  Les noms restent uniques sur l'ensemble du catalogue, le libellé servant d'identifiant.

### Données techniques : proposées, jamais exigées

Le client n'est obligé de fournir ni nom de compte, ni nom d'hôte, ni numéro de série : un
technicien s'en charge. Mais s'il les connaît, il peut les saisir, et elles suivent la demande
de bout en bout.

- Saisie facultative : nom de compte sur la carte « nouvelle personne », nom d'hôte / numéro
  de série / type d'appareil sur chaque intention qui demande une machine à préparer.
- Restituées partout où la demande est lisible : détail portail, détail interne, et le tableau
  par personne partagé entre les deux.
- Côté technicien, elles pré-remplissent le travail au lieu d'être à recopier : formulaires
  « Enregistrer l'appareil » et « Créer l'utilisateur », et le formulaire de clôture
  (`DeliveryDetailsModal`), qui affiche « Supplied by the customer — confirm or correct it. »

### Phase 3 — Workflow de demande client ✅

**Invariant de la phase : soumettre une demande ne modifie jamais la réalité opérationnelle.**
Aucune écriture sur Client User, Managed Device, Device Holder, Service Assignment. Les
mutations appartiennent à la Phase 4.

| # | Tâche | État |
|---|---|---|
| 1 | Sémantique des intentions (backend) | ✅ 24 tests |
| 2 | APIs de contexte + recherche utilisateur | ✅ 20 tests |
| 3 | Request Builder React (stepper 4 étapes) | ✅ 10 tests |
| 4 | Cartes services Current/Available + contexte appareil | ✅ inclus en 3 |
| 5 | Brouillons / réouverture / correction d'un refus | ✅ 2 tests |
| 6 | Recherche utilisateur backend | ✅ inclus en 2 |
| 7 | Tests portail + Vitest de bout en bout | ✅ §58 et §59 couverts |

**Déjà en place :**

- `MSP Service Request Line` porte `source_service_assignment` (quel service exactement) et
  `requested_for_user` (pour qui, même quand la ligne cible une machine).
- `nexgen_msp/utils/request_intents.py` — l'action demandée est confrontée à l'état réel du
  service ; une seule demande ouverte par service ; deux actes contradictoires dans une même
  demande sont refusés ; les brouillons ne bloquent personne.
- Approbation par département : couvre enfin les lignes « appareil » et « nouvel utilisateur »
  (`approval.covers_line`), qui échappaient au contrôle.
- `request_builder_service.py` + 4 endpoints portail : `search_request_users`,
  `get_request_subject_context`, `get_new_user_request_context`, `get_request_submission_context`.
- Nouveau formulaire : `NewServiceRequest.tsx` (stepper) + `RequestSubjectStep`,
  `RequestChangesStep`, `RequestScheduleStep`, `RequestReviewStep`, `RequestServiceCard`,
  et le modèle `useRequestBuilder.ts` (sujets → intentions → une ligne par intention).
- Supprimés : `useServiceRequestForm.ts` et `ServiceStateHint.tsx` (ancien modèle, §47).

Réouverture d'un brouillon et correction d'un refus : les sujets et intentions sont
reconstruits depuis les lignes, et tout élément que le monde a dépassé est signalé avec la
raison exacte (§33, §49, §50).

Les 30 scénarios backend de §58 et la liste frontend de §59 sont couverts.

### Phase 4 — Poste de travail du technicien ✅

**Règle de la phase : la Request est l'interface de travail, le Work Order le moteur de
traçabilité, le Lifecycle Service le moteur métier.** Le technicien ne quitte jamais la
demande : plus de `CreateUserModal`, `AddDeviceModal`, `DeliveryDetailsModal`, plus de bouton
« Open profile », aucune navigation vers un Work Order.

| # | Tâche | État |
|---|---|---|
| 1 | `subject_key` + `device_requirement_key` | ✅ 14 tests |
| 2 | Work Order étendu + `build_execution_plan()` | ✅ 28 tests |
| 3 | `RequestExecutionService` + orchestration | ✅ 36 tests |
| 4 | Préparation personne / machine | ✅ inclus en 3 |
| 5 | Exécution des actions de service | ✅ inclus en 3 |
| 6 | Workbench React + stepper | ✅ 20 tests Vitest |
| 7 | Vérification, checklists, complétion | ✅ inclus en 3 et 6 |
| 8 | Concurrence + E2E métier | ✅ inclus en 3 |

**Ce qui a changé, côté modèle :**

- `MSP Service Request Line` porte `subject_key` et `device_requirement_key`, **dérivés côté
  serveur** (jamais envoyés par l'écran) : une personne sur fiche donne `user:CU-00045`, une
  personne à créer donne son nom normalisé, une machine attendue est clé de la personne.
- `MSP Service Work Order` porte `work_type` (Service Action / User Setup / Device
  Provisioning), `plan_key` **unique**, `subject_key`, `device_requirement_key`,
  `request_line_name`, `request_line_idx`, `source_service_assignment`, et les trois
  résultats : `resulting_client_user`, `resulting_device`, `resulting_assignment`.
- `service_item` n'est plus obligatoire : seule une Service Action nomme un service.
- La cible (personne / machine) n'est exigée **qu'au moment où le travail est pris**, pas à
  la planification : c'est justement parce qu'elle n'existe pas encore qu'il y a du travail.

**Le plan (`request_execution_service.py`) :**

- Généré à l'approbation, **idempotent** : un Work Order par groupe, adressé par `plan_key`
  unique en base. Deux techniciens qui ouvrent la demande en même temps n'en créent qu'un.
- Un `User Setup` par personne à créer, un `Device Provisioning` par machine à régler, une
  `Service Action` par ligne approuvée. Une ligne rejetée ne produit aucun travail.
- `ready` / `waiting_on` sont **calculés**, jamais écrits : attendre l'étape précédente n'est
  pas un blocage, `Blocked` reste réservé à l'imprévu.
- Propagation : la personne créée et la machine réglée sont recopiées sur **toutes** les
  lignes et tous les Work Orders du même groupe.

**Ce qui a été supprimé, et pourquoi :**

- `RequestService.set_delivery_detail` et `_guard_delivery_details` : la clôture ne part plus
  à la pêche au numéro de série ou au nom de compte (§65). Le garde-fou existe toujours, mais
  au bon endroit : `_identify_target` le demande sur la carte qui met le service en service.
- `DeliveryDetailsModal` et `lib/delivery.ts` côté front.
- Les boutons du header : seuls Reject et Cancel y restent. Approuver, exécuter, vérifier et
  clôturer se font dans l'étape concernée.

**Décision signalée :** le portail access d'une nouvelle personne est *affiché* sur la carte
User Setup (« Portal access was requested ») mais **l'invitation n'est pas envoyée
automatiquement** : créer un compte avec des identifiants n'est pas un effet de bord acceptable
d'un clic sur « Create user ». À trancher avec Idriss si ce doit être automatisé.

### Phase 5 — Vue utilisateur à 360° ✅

**Règle de la phase : une personne possède ses services personnels et *détient* des machines ;
la machine possède les services qui tournent dessus.** L'ancien `get_user()` disait qu'un
service appartenait à qui détenait la machine ce jour-là. C'est cette confusion qui disparaît.

| # | Tâche | État |
|---|---|---|
| 1 | Refonte `get_user()` : ownership + DTO | ✅ 31 tests |
| 2 | Requêtes ouvertes + moteur d'alertes | ✅ inclus en 1 |
| 3 | Historique de détention + `holder_since` | ✅ inclus en 1 |
| 4 | Reconstruction de `UserDetail.tsx` | ✅ 17 tests Vitest |
| 5 | User 360 portail | ✅ 6 tests Vitest |
| 6 | Compteurs et filtres de la liste | ✅ |
| 7 | Chargement paresseux du passé | ✅ inclus en 1 et 4 |
| 8 | Tests de scénarios métier | ✅ inclus en 1 |

**Le service (`user_360_service.py`) :**

- `personal_services` = portée User, sur la personne. `devices[].services` = portée Device,
  sur la machine. Jamais mélangés, ni dans les comptes, ni dans l'historique.
- `holder_since` vient de la période de détention en cours, pas de `assigned_date`. Détenir
  deux fois la même machine donne deux périodes, jamais une.
- `open_requests` trouve une demande par `client_user` **ou** `requested_for_user` : une ligne
  qui vise une machine nomme la machine, et la personne à côté.
- `attention` renvoie des signaux structurés (code, gravité, entité, phrase). Le React
  n'invente aucune règle métier à partir de douze champs.
- La disponibilité vient de la Phase 2, lue **par machine** : un service sur un portable ne
  dit rien du suivant.
- Un service déjà visé par une demande en cours n'offre plus aucune action : la Phase 3 le
  refuserait de toute façon.
- Le portail lit exactement le même service (`read_user(internal=False)`) : mêmes règles de
  propriété, moins de données.

**Ce que la page ne charge plus** (§58) : le catalogue global, les 30 dernières demandes du
client, les types d'appareils et d'interfaces. Le passé (anciennes machines, services clos,
demandes closes, activité ancienne) est derrière `get_user_history`.

**Décision signalée :** la spec §19-21 recommandait de réserver les actions directes à un menu
« administratif ». Idriss a demandé de **conserver les actions comme avant** : ajouter un
service, assigner une machine, suspendre, reprendre, clôturer restent des boutons de premier
plan sur la fiche, et la voie « demande » s'ajoute à côté (menu par ligne, plus le bouton
« New request »).

**Ajustement hors spec, demandé par Idriss :** une interface réseau est désormais une **clé
libre et une valeur** (`interface_type` passe de Select à Data). Le technicien écrit ce qu'il
veut, les quatre libellés habituels restant proposés en suggestion.

### Phase 6 — Référentiels administrés ✅

**Règle de la phase : deux petits référentiels globaux et contrôlés, et rien d'autre.**
Départements et actions de demande s'administrent. Les types d'appareils, les statuts, les
portées et tous les cycles de vie restent des constantes du produit : Settings ne peut pas
les atteindre.

La moitié « départements » avait déjà été faite en Phase 2.5 (catalogue, service, migration,
Selects partout, rapport d'alias). Ce qui restait :

| # | Travail | État |
|---|---|---|
| 1 | `resolve_department()` pour l'import | ✅ |
| 2 | Comptes d'usage détaillés (users / approvers / demandes) | ✅ |
| 3 | Suppression de `department_prefix` | ✅ |
| 4 | `sort_order` sur les actions de demande | ✅ |
| 5 | Une seule action offerte par acte moteur | ✅ |
| 6 | `action_type` figé dès qu'une action est utilisée | ✅ |
| 7 | UI Settings : ordre des sections, ordre d'affichage, « Used by » | ✅ |
| 8 | Tests | ✅ 30 backend, 9 Vitest |

**Ce qui a changé :**

- `resolve_department()` fait correspondre ce que la feuille Excel a écrit au catalogue, à la
  casse près, et **n'y ajoute jamais rien**. « HR » n'est pas deviné comme « Human Resources ».
  Un mot inconnu refuse la ligne en disant quoi créer dans Settings d'abord.
- `department_prefix` disparaît du DocType, du service d'import, des mappings livrés et de
  l'UI : « Accounting » de deux entreprises est le même département.
- Un département vide dans une feuille ancienne laisse la personne sans département et est
  compté dans `users_without_department`.
- `MSP Request Action` : une seule action **offerte** par acte moteur. Plusieurs libellés
  peuvent coexister pour l'historique, un seul est activé.
- Ce qu'une action fait est figé dès qu'une demande a été levée dessus : changer
  « Close service » de Remove vers Suspend réécrirait ce que des clients ont demandé.
- Désactiver une offre ne retire rien au moteur : `ServiceLifecycleService.suspend()`
  fonctionne toujours pour une opération administrative.

**Nouvelle validation / ancienne donnée (§45-46) :** un département retiré après l'approbation
d'une demande ne bloque plus l'exécution. La carte « User setup » du workbench le signale
(« n'est plus proposé pour de nouvelles personnes ») et laisse le technicien décider.

**Conflit de spec signalé :** le §3 dit qu'un département n'a aucun lien vers Customer. Idriss
a demandé l'inverse en Phase 2.5 : un département peut exceptionnellement appartenir à une
entreprise. La demande d'Idriss prime, le champ `customer` reste.

**Filtres (§42-43) :** les listes utilisateurs et facturation lisent toujours les valeurs
réellement présentes dans les données, pas le catalogue actif. Un département désactivé reste
filtrable dans l'historique. Vérifié, rien à changer.

### Phase 7 — Poste de travail de facturation ✅

**Invariants de la phase :** un filtre est une vue, une sélection est une décision de
facturation, une Billing Run Line est un instantané historique, et une Run approuvée est de
l'histoire financière immuable.

| # | Travail | État |
|---|---|---|
| 1 | Instantanés historiques + fin de la dépendance au détenteur actuel | ✅ 22 tests |
| 2 | Facturation consciente des suspensions + tarif historique | ✅ inclus |
| 3 | Sélection persistante + revalidation sûre | ✅ inclus |
| 4 | APIs de sélection (retirer / ajouter) | ✅ |
| 5 | Stepper Billing en six phases | ✅ 10 tests Vitest |
| 6 | Étape Validation et cartes d'exception | ✅ inclus |
| 7-9 | Review / Invoice / régressions | ✅ existants conservés |

**Trois erreurs de fond corrigées, pas seulement du design :**

1. **Le détenteur actuel décidait de l'identité facturée.** `build_lines` joignait
   `device.assigned_client_user` pour donner un nom, un email et un département à une ligne
   d'appareil, et joignait la machine détenue à une ligne personnelle. Transférer un
   portable en septembre réécrivait donc la facture d'août. Les jointures sont supprimées :
   une ligne d'appareil appartient à la machine, une ligne personnelle à la personne.
2. **Le tarif du jour servait à facturer le passé.** `_rate_for` essayait d'abord
   `current_rate(customer, item)` sans date : une facture d'août pouvait être tirée au tarif
   entré en vigueur en septembre. Le tarif est désormais résolu **sur la période facturée**,
   et si le tarif change en cours de mois la ligne est **segmentée** (une charge par tarif).
3. **`revalidate()` reconstruisait toute la période.** Il ramenait donc les affectations
   volontairement exclues et écrasait les remises saisies à la main. Il ne recalcule plus
   que le périmètre de la Run, et une remise `Manual` y survit.

**Instantanés (`MSP Billing Run Line`) :** `service_name_snapshot`, `user_name_snapshot`,
`email_snapshot`, `department_snapshot`, `hostname_snapshot`, `serial_snapshot`,
`device_type_snapshot`, `holder_context_snapshot`, `billable_segments_json`. `get_run` et
donc l'export lisent ces champs, plus jamais les enregistrements courants.

**Ce que la Run dit maintenant :** les tranches réellement live (`billable_segments`), au
lieu de deux dates qui masquent une suspension au milieu ; et qui détenait la machine pendant
la période, en contexte, jamais comme partie facturée.

**Sélection :** les lignes bloquées entrent dans la Run (le filtre « masquer les bloquées »
n'est plus actif par défaut) et sont traitées à l'étape Validation, qui les regroupe par cause
avec leur contexte et un bouton « Remove from this run ». `add_to_run` / `remove_from_run`
modifient le périmètre du brouillon sans toucher aux services.

**Correction annexe :** `_already_invoiced` ne comparait pas le client. Une Run d'une autre
entreprise pouvait bloquer une affectation. La jointure est ajoutée.

**Écarts signalés :**

- §67 demandait d'intégrer les champs comptables dans l'étape Invoice plutôt qu'en modale.
  La modale existante est conservée, ouverte depuis l'étape ; le workflow se lit d'un bloc
  grâce au stepper mais le formulaire reste une modale. À reprendre si Idriss le souhaite.
- §47 (arrondi 5 jours agrégé par mois) et §42 (segmentation par tarif) se contredisent quand
  un tarif change en cours de mois. Choix retenu : l'agrégation par mois calendaire se fait
  **à l'intérieur de chaque segment de tarif**, ce qui est la seule lecture qui préserve les
  deux prix.

### Phase 8 — Audit transverse, migration et recette ✅

**Cette phase ne crée pas de fonctionnalité.** Elle demande si les sept précédentes forment un
seul produit. Le verdict se lit dans les enregistrements laissés, pas sur un écran.

| # | Travail | État |
|---|---|---|
| 1 | Audit des écritures directes interdites (§5-8) | ✅ propre |
| 2 | Audit des anciens parcours frontend (§9-10) | ✅ propre |
| 3 | Isolation inter-clients / IDOR (§13, §57-58) | ✅ 18 tests |
| 4 | Diagnostic de migration (§16-22) | ✅ `data_audit`, 10 tests |
| 5 | Backfill des clés de ligne de demande (§19) | ✅ patch |
| 6 | Recette de bout en bout (§24-50) | ✅ 11 parcours |
| 7 | Vocabulaire, états vides, messages (§62-68) | ✅ 1 correction |
| 8 | Rapport de recette (§76) | ✅ ci-dessous |

**Audit des écritures directes (§5-8) : rien à corriger.**
`assigned_client_user` n'est écrit que par `device_holders.sync_current`, qui le dérive de
l'historique — c'est le miroir prévu, pas un contournement. Toutes les écritures de
`operational_status` sont dans `service_lifecycle_service.py`. `effective_end_date` n'est écrit
qu'à la clôture. `billing_status` est dérivé par le DocType.

**Audit des anciens parcours (§9-10) : rien à corriger.**
« Open profile » et « View profile » ne subsistent que sur des listes, où aller d'une liste à
une fiche est de la navigation normale, pas l'aller-retour interdit depuis une Request.
`DeliveryDetailsModal` a disparu en Phase 4. `AddDeviceModal`, `CreateUserModal` et
`EditClientUserModal` restent utilisés pour des opérations administratives, ce que le §10
autorise explicitement.

**Diagnostic de migration.** `nexgen_msp/utils/data_audit.py`, à lancer avant toute migration
ou mise en production :

```
bench --site msp.localhost execute nexgen_msp.utils.data_audit.print_report
```

Il lit machines, services, départements, demandes et facturation, compte ce qui contredit une
règle, et distingue ce qui **bloque une release** (deux détenteurs courants, deux périodes
ouvertes sur une même cible, un historique de détention impossible à ordonner) de ce qui est
seulement à savoir. Il ne répare rien : inventer une date ou un propriétaire pour rendre un
rapport propre, c'est ainsi qu'on écrit un mauvais historique.

**Correction trouvée par l'audit :** `get_run` lisait les instantanés de Phase 7, donc une Run
antérieure s'affichait vide. Elle retombe désormais sur les enregistrements, ce qu'elle a
toujours eu (§21 : « conserver les anciennes données »).

**Correction trouvée par l'audit UI :** la liste des entreprises n'avait pas d'état vide (§67).

---

### Addon Hassan — Gestion des entreprises et sécurité ✅

L'addon ne rajoute pas un module : il déplace la frontière d'accès. Jusque-là un compte
atteignait une entreprise parce qu'une User Permission le disait. Désormais il faut **deux
preuves qui concordent** — un Contact qui nomme le compte et lie l'entreprise, *et* la
permission. Une permission oubliée derrière quelqu'un qui a changé d'entreprise n'ouvre plus
rien, ce qui est la façon la plus banale dont un accès survit à sa raison d'être.

| # | Travail | État |
|---|---|---|
| ADDON-1 | Politique d'accès centrale (`utils/access.py`) | ✅ 27 tests |
| ADDON-2 | `CustomerService` : lecture, écriture, annuaire, création | ✅ 27 tests |
| ADDON-3 | Customer 360 : une page, des sections selon la capacité | ✅ 9 tests Vitest |
| ADDON-4A | Phase 3 préservée, rien du parcours addon repris | ✅ 6 tests |
| ADDON-4B | Identité de facturation figée sur la Run | ✅ 5 tests |
| ADDON-4C | Timeout de session : refresh live conservé | ✅ 12 tests |
| ADDON-5 | Suite de non-régression inter-phases | ✅ `test_addon_regression` 18 |

**`utils/access.py` est la seule autorité.** Neuf capacités y sont déclarées ; demander une
capacité inconnue lève une erreur au lieu de répondre oui. Les rôles échouent fermés : un rôle
interne collé par erreur sur un compte client n'élargit rien, et `Administrator` est
l'exception écrite noir sur blanc plutôt qu'un rôle parmi d'autres.

**Un trou de sécurité réel a été trouvé et bouché.** Le contrôleur Contact de Frappe relie
automatiquement le champ `user` dès qu'une adresse e-mail correspond à un compte existant, et
notre hook accordait ensuite la permission entreprise correspondante. Taper l'e-mail d'un
collègue dans « qui appeler » lui donnait donc l'accès à l'entreprise. Le lien est désormais
rétabli après sauvegarde et `revoke_undeclared_customer_permissions` nettoie ce que Frappe a
cru bien faire.

**Ce qui a été explicitement refusé de l'addon**, comme la spec le demande : le sélecteur
global d'appareils, la transformation d'une ligne Device non résolue en ligne User, la
suppression du rafraîchissement des sessions vivantes, et `allowedHosts` dans Vite.

**Identité de facturation (§51-52).** Quatre champs figés sur la Run au moment où elle est
tirée : nom, numéro fiscal, adresse et contact de facturation. Une entreprise qui déménage en
septembre ne réécrit pas la facture d'août. Une Run tirée avant l'existence de ces champs
retombe sur les enregistrements courants plutôt que d'afficher un en-tête vide, et un avoir
reprend l'identité de la Run qu'il crédite, pas celle du jour.

---

### Performance (§51-56) ✅ mesurée

Le jeu de données n'existait pas, donc il est fabriqué, mesuré, puis supprimé :

```
bench --site msp.localhost execute nexgen_msp.utils.load_bench.run
```

`nexgen_msp/utils/load_bench.py` construit une entreprise de **5 000 personnes, 3 000 machines,
10 000 services et 1 000 demandes** — les volumes exacts du §51 — prend chaque mesure deux fois
en gardant la seconde, puis efface tout ce qu'il a écrit, y compris si une mesure échoue. Tout
porte le préfixe `ZZBENCH`.

Deux chiffres par écran : le temps, et le **nombre de requêtes**, qui est le seul des deux à
prédire ce qui se passera sur une base plus grosse.

| Écran | ms | requêtes |
|---|---|---|
| Registre utilisateurs, première page | 303 | 2 |
| Registre utilisateurs, recherche | 31 | 2 |
| Une personne, lecture complète | 14 | 31 |
| Historique de cette personne | 2 | 7 |
| Request Builder, recherche | 9 | 2 |
| File des demandes, première page | 2 | 2 |
| Candidats de facturation du mois | 489 | 7 |

**Le nombre de requêtes ne bouge pas** entre 150 personnes et 5 000 : aucun écran ne pose une
requête par ligne affichée.

**N+1 corrigés (§55).** Quatre, trouvés en comptant :

- `request_execution_service._orders` — libellés d'articles, noms de techniciens et
  checklists, trois requêtes au lieu de trois par ligne.
- `user_360_service` — les demandes en cours sur les services d'une personne et de ses
  machines, une requête groupée au lieu d'une par service.
- `billing_service._holder_contexts` — qui détenait la machine pendant la période, en lot.
- `billing_service._invoiced_in` — « cette ligne est-elle déjà facturée ». C'était **une
  requête par candidat** : 406 requêtes pour 400 services, et 10 000 pour 10 000. Désormais
  une seule. La preview est passée de 123 ms à 26 ms sur 400 lignes.

**Index (§56).** Profilés avant d'être posés, jamais à l'aveugle : `EXPLAIN` montrait
`type: ALL` sur la table des services, sur les lignes de demande et sur le registre.
`nexgen_msp/patches/index_hot_lookups.py` en pose **17**. Après : `type: ref`, `rows: 1`.
Le registre est passé de 518 ms à 303 ms, la lecture d'une personne de 36 ms à 14 ms.

Les quatre derniers viennent du registre : ses compteurs interrogent une personne seule, donc
un index qui commence par l'entreprise ne peut pas les servir.

**Sélection de facturation (§54).** Filtres serveur déjà en place. Le tableau ne dessinait
en revanche **aucune limite** : dix mille lignes de DOM d'un coup. Il en dessine maintenant
200 avec un « Show more ». Les décisions de décochage sont tenues par nom d'affectation, donc
ce qui est hors écran garde ce qu'on a décidé pour lui — six tests le vérifient.

---

### Rapport de recette (§76)

Lancé le 2026-09-12 sur `msp.localhost`, **758 tests backend et 144 Vitest, tous verts**,
`pyflakes` et `yarn lint` propres, `yarn build` passant, zéro résidu `ZZTEST` sur la base.

| Domaine | Verdict | Preuve |
|---|---|---|
| Device Lifecycle | PASS | `test_device_lifecycle` 30 |
| Service Lifecycle | PASS | `test_service_lifecycle` 31 |
| Request Builder | PASS | `test_request_intents` 25, `test_request_builder_context` 20 |
| Request Workbench | PASS | `test_execution_plan` 28, `test_request_execution` 36 |
| User 360 | PASS | `test_user_360` 31 |
| Customer Access | PASS | `test_cross_customer` 18, `test_portal_scope` |
| Settings | PASS | `test_managed_references` 30 |
| Billing | PASS | `test_billing_history` 22, `test_billing_rules`, `test_billing_suspensions` |
| Security | PASS | `test_cross_customer`, `test_roles`, `test_accounts_and_roles` |
| Migrations | PASS | `data_audit` : aucun bloqueur sur la base réelle |
| E2E métier | PASS | `test_e2e_acceptance` 11 parcours |
| Accès entreprise | PASS | `test_customer_access` 27, `test_customer_profile` 27 |
| Non-régression addon | PASS | `test_addon_regression` 18 |
| Sessions | PASS | `test_session_timeout` 12 |
| Performance | PASS | `load_bench` aux volumes du §51 |

**Ce qui restait ouvert au moment du premier rapport est fermé.**

- **Performance (§51-56).** Mesurée, chiffres relevés, quatre N+1 corrigés et dix-sept index
  posés après profilage. Le détail est dans la section Performance ci-dessus.
- **Scénarios §41-43 et §77 items 7-8 (accès entreprise, Customer 360).** Livrés par l'addon :
  l'accès demande désormais un Contact *et* une User Permission qui concordent.

**Bloqueurs de release (§74) : aucun.** Vérifiés un par un — pas de fuite inter-clients, pas de
double détenteur, pas de double période ouverte, une demande ne modifie rien avant exécution,
un Work Order ne s'exécute pas deux fois, une Run approuvée ne bouge plus, les exclusions
manuelles survivent, la double facturation est refusée, un Customer Manager n'atteint pas les
champs commerciaux, aucun département en texte libre, le workbench n'exige aucune navigation.

---

## 4. Journal

| Date | Qui | Ce qui a été fait |
|---|---|---|
| 2026-09-11 | agent principal | Phases 1 et 2 terminées et commitées (`after phase 2 done`). |
| 2026-09-11 | agent principal | Phase 2.5 terminée (`after phase 2.5 done`). Correction d'une fuite de départements de test dans le catalogue réel. |
| 2026-09-12 | second agent | Extension Phase 2.5 : renommage propagé, département obligatoire pour un nouvel utilisateur. |
| 2026-09-12 | agent principal | Phase 3 tâche 1 (`after phase 3 request intents`) puis tâches 2–4 et 6 (`after phase 3 request builder`). |
| 2026-09-12 | agent principal | Phase 3 terminée : brouillons/corrections et couverture §58–§59 (`after phase 3 done`). |
| 2026-09-12 | agent principal | Départements : champ `customer` facultatif, options filtrées par entreprise. |
| 2026-09-12 | agent principal | Données techniques rendues facultatives mais saisissables, visibles partout, pré-remplies côté technicien. |
| 2026-09-12 | agent principal | Phase 4 tâche 1 : clés de regroupement (`after phase 4 execution keys`). |
| 2026-09-12 | agent principal | Phase 4 tâche 2 : Work Order étendu et plan d'exécution (`after phase 4 execution plan`). |
| 2026-09-12 | agent principal | Phase 4 terminée : exécution, vérification, clôture et workbench React. |
| 2026-09-12 | agent principal | Phase 5 terminée : ownership corrigé, DTO 360, workbench utilisateur interne et portail. |
| 2026-09-12 | agent principal | Interfaces réseau : clé libre et valeur (demande d'Idriss). |
| 2026-09-12 | agent principal | Phase 6 terminée : import sans préfixe, une offre par acte, ordre d'affichage, Settings réorganisé. |
| 2026-09-12 | agent principal | Phase 7 terminée : instantanés historiques, tarif de la période, sélection persistante, stepper Billing. |
| 2026-09-12 | agent principal | Phase 8 terminée : audits, `data_audit`, isolation inter-clients, recette de bout en bout. Les huit phases sont faites. |
| 2026-09-12 | agent principal | Addon Hassan terminé : politique d'accès à deux preuves, Customer 360, escalade par e-mail de contact bouchée. |
| 2026-09-12 | agent principal | Performance mesurée (`load_bench`), quatre N+1 corrigés, dix-sept index, sélection Billing fenêtrée. Specs closes. |
| 2026-09-13 | agent principal | P0 réduit par Idriss : aucune relation Client User ↔ User, `portal_visible`, `portal_access` et `needs_portal_access` retirés. |
| 2026-09-13 | agent principal | Réglages → Départements : sélecteur « Customer » (All customers par défaut), refusé si des personnes d'une autre entreprise portent déjà ce département. |
| 2026-09-13 | agent principal | Correction Spec v2 lue, mise en attente : Idriss teste et décide point par point. Rien implémenté. |
| 2026-09-13 | agent principal | Décisions d'Idriss appliquées : matrice d'autorité stricte, désactivation Client User, contrats par dates, prorata 5 jours sur 30, fin de service déjà facturé acceptée. |
| 2026-09-13 | agent principal | Steppers unifiés sur le design « Add Item » de trixapos_retail_core : `WorkflowStepper` et `WorkflowHeader` partagés, utilisés par la demande, la Run de facturation, le workbench et la 2FA. |
| 2026-09-13 | agent principal | Demande : un seul champ « Details » pour toute la demande (`MSP Service Request.details`) à l'étape 3, plus de commentaire par ligne. Les anciens commentaires de ligne restent lisibles et sont regroupés à la réouverture d'un brouillon. |
| 2026-09-13 | agent principal | UX-UI-ADAPTATION-SPEC, écran C (réalisation technicien) : 4 étapes Review lines / Execute / Verify / Final validation, contexte et note du demandeur toujours visibles, décisions et exécutions groupées avec résultat par ligne, « More actions » servies par le backend (`origin = Technician` + raison sur le Work Order), Verify = récapitulatif persistant, plus de checklist de vérification bloquante. Écrans A et B non commencés. |
| 2026-09-13 | agent principal | Demande d'Idriss : une période déjà facturée n'empêche plus aucune action. Suspendre / reprendre derrière une facture renvoie un avertissement (code `BILLED_PERIOD`), et l'action passe avec `confirm_billed=1` ; la facture émise reste inchangée et l'historique le note. Confirmation ajoutée sur la fiche utilisateur, la fiche appareil et le workbench (y compris l'exécution groupée). Boutons du workbench nommés d'après l'action exacte ; en-tête personne en libellé / valeur avec les vrais libellés des champs. |
| 2026-09-13 | agent principal | Fiche utilisateur interne revenue en tableaux (services personnels et de machine, appareils) avec actions directes dans le menu ⋯ : Suspend, Resume, Change (bascule vers un autre service), Close ; Transfer, Repossess, Add service sur les appareils. Aucun lien de création de demande côté Nexgen. « Account name » renommé Username partout (username sur les services, pas un compte de l'app). Quantité retirée de l'interface (toujours 1) ; colonne Last billed à la place. |
| 2026-09-13 | agent principal | Execute (technicien) : « More actions » et sa raison obligatoire remplacés par des menus ⋯. Sur la personne : Add service, Assign device, Edit, Disable / Reactivate user, Stop all services (nouveau `stop_all_client_user_services`, services personnels seulement), mêmes modales que la fiche utilisateur, rattachées à la demande. Sur chaque ligne qui n'est pas un Add : Suspend / Resume / Change / Close — le technicien décide de l'acte réel (`execute_service_action` accepte `action` et `service_item`, la note garde ce que la demande demandait). Actes directs repris dans le récapitulatif. |
| 2026-09-13 | agent principal | Customers : `/customers/:customer` revient à la page contrats / tarifs (CustomerContract) comme avant la refonte ; section « Who to call » retirée de Customer360 (qui n'est plus routée). Bouton New customer sur /customers : la modale Customer details sert aussi à la création (identité, adresse de facturation, préférences), puis ouvre la fiche. |
| 2026-09-13 | agent principal | Recherche d'appareil par Serial Number partout : sélecteur d'appareil existant (Add device), recherche de lignes Billing (front et back), recherche services du portail. Les listes appareils / utilisateurs le faisaient déjà. |
| 2026-09-13 | agent principal | Execute : le menu ⋯ de la personne propose aussi, par appareil détenu, « Add service on … » et « Repossess … ». Username / Serial Number exigés à l'ajout d'un service, au backend (`identifiers.require_username` / `require_serial`, partagés avec l'exécution) et dans les modales : Username pour un service personnel, Serial pour un service machine, les deux pour un service Both posé sur une machine détenue. `needs_username` des lignes de demande suit la même règle. |
| 2026-09-13 | agent principal | Décision d'Idriss : un service sans scope est « Both » partout (`_service_scope`, disponibilités, request builder, portail, catalogue, activation) — proposé pour la personne et pour la machine. Conséquence : les Items non stockés sans scope (ex. `9000-0012-Month`) apparaissent désormais dans les offres. |
| 2026-09-13 | agent principal | Nouveau module `test_end_to_end_journeys` (34 scénarios) : demande acceptée en partie puis clôturée, refus de ligne / de demande, annulation, acte réel différent de la demande, Stop all services, blocage/reprise, identifiants requis, service sans scope, données erronées / incomplètes / ambiguës, demande avec seulement un commentaire (refusée), départ / retour, appareil passé de main en main avec historique et fil d'activité. Suite complète : restent en échec `test_access_guards` (connu), `test_user_360.test_the_offer_comes_from_the_service_rules_and_not_from_the_catalogue` et `test_device_callers.test_retiring_a_held_machine_closes_its_spell_and_its_services` — tous deux déjà en échec avant ces changements (offre non couverte proposée avec avertissement ; Retire ne ferme les services qu'avec `end_services=1`). |
| 2026-09-14 | agent principal | Portail, nouvelle demande, personne sans appareil : les services machine du contrat sont proposés (`new_device_services` dans le contexte), avec le choix Not specified (défaut, le technicien prépare la machine) / One of our machines (machines en stock sans détenteur, `stock_devices`) / A new machine (détails facultatifs à l'étape suivante). Les lignes partent en `is_new_device` ; la machine choisie en stock voyage en hostname / serial / type, et le Prepare Device du technicien la présélectionne si elle est toujours en stock sans détenteur. |
| 2026-09-14 | agent principal | Portail, personne sans appareil : « One of our machines » liste toutes les machines non retirées de l'entreprise avec leur détenteur (`assignable_devices`, remplace `stock_devices`). Une machine détenue demande « … is held by … » + Confirm transfer : le client confirme la volonté, rien ne bouge à l'envoi ; le technicien voit la machine présélectionnée et confirme le transfert réel. « Raise a request for this machine » ouvre la demande sur son détenteur (`client_user`), ou sur une personne nouvelle si elle n'est à personne (`new_user=1`) ; l'étape Person permet de changer. |
| 2026-09-14 | agent principal | Portail, étape Person : la personne choisie est décrite en libellé / valeur (Department, Email, Username, Lifecycle Status, Start Date), avec ses services personnels et leur date, ses appareils (Serial Number, Device Type, In Service Since, services qui y tournent) et ses demandes ouvertes (`open_requests` : statuts ouverts hors Draft + Awaiting Customer Approval). |
| 2026-09-14 | agent principal | Étape Person condensée : cartes en grille (2 à 3 par ligne), faits en petit sur deux colonnes, services et appareils en lignes courtes. Partie « Open requests » retirée à la demande d'Idriss (`open_requests` supprimé du contexte). |
| 2026-09-14 | agent principal | Portail, étape Changes condensée : pour un service existant, l'action de retrait est le seul bouton visible, les autres (Change, Suspend, Resume) passent dans le menu ⋯ ; nom et statut sur une ligne, en-têtes de section sur une ligne. |
| 2026-09-14 | agent principal | Choix de machine (personne sans appareil) : seules « Existing device » et « A new machine » sont présentées ; sans choix, le défaut reste la machine préparée par le technicien, et recliquer le choix sélectionné y revient. |
| 2026-09-14 | agent principal | Portail, étape Changes : une personne à la fois. Liste des personnes à gauche (nom, nombre de changements), la personne choisie à droite, bouton « Next: … » pour passer à la suivante ; sans liste quand il n'y a qu'une personne. Le choix de machine est gardé sur la personne (`machineChoice`, `machineDevice`). Lignes encore resserrées. |
| 2026-09-14 | agent principal | Étape Changes : barre Previous / « Person n of N » / Next entre les personnes, liste numérotée avec coche quand la personne a des changements. Bloc Devices d'une personne sans appareil fusionné en un seul composant (icône, message, choix Existing device / A new machine, puis Device services). « Repossess » renommé « Return to stock » partout où l'utilisateur le voit (fiche appareil, menu ⋯ de la fiche utilisateur, menu de la personne en Execute, modale, entrée d'historique « Returned to stock ») ; le code garde `repossess`. Fiche appareil : « Who has held it » du plus récent au plus ancien. |
| 2026-09-14 | agent principal | Étape Changes : une seule carte par personne (nom, Personal services, Devices, puis Previous / Next en pied de carte) ; les rubriques sont des sections de la carte et non plus des boîtes séparées. |
| 2026-09-14 | agent principal | Étape Changes : la liste des personnes fait partie de la même carte (colonne de gauche grisée), la personne choisie à droite. |
| 2026-09-14 | agent principal | Étape Changes allégée : Previous / Next sans nom, plus de sous-titres de rubrique, « No service yet », « No device » ; seul message restant pour la machine : « Transfer from … » quand une machine détenue est choisie. |
| 2026-09-14 | agent principal | « A new machine » affiche Serial Number, Hostname et Device Type, facultatifs : gardés sur la personne (`machineSerial`, `machineHostname`, `machineType`) et reportés sur chaque service machine en `new_device_serial` / `new_device_label` / `new_device_type` ; le client continue qu'il les remplisse ou non. |
| 2026-09-14 | agent principal | Étape When & details : plus de champs Hostname / Serial / Device type à remplir ; ils se saisissent une seule fois à l'étape Changes (personne sans appareil → A new machine ; nouvelle personne → sous « Device required »). Chaque service machine dit sa machine (`machineSource`) : « · PRIMS-PC » pour un appareil existant, « · new device … » pour une nouvelle machine, « · device to be identified » sinon ; même chose à l'étape Review. |

> Ajoute ta ligne ici quand tu termines quelque chose.
