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
| **7** | **Billing Workbench & Flexible Billing Workflow** | **⬜ à faire — prochaine** |
| 5 | User 360° Operational View | ⬜ |
| 6 | Settings & Managed References | ⬜ |
| 7 | Billing Workbench & Flexible Billing | ⬜ |
| 8 | Cross-System Audit, Migration & E2E | ⬜ |
| — | Addon Hassan — Customer Management & Security | ⬜ |

Repères actuels : **485 tests backend**, **76 tests frontend**, `pyflakes` et `yarn lint` propres.

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

> Ajoute ta ligne ici quand tu termines quelque chose.
