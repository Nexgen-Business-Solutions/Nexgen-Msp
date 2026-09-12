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

---

## 2. État général

| Phase | Sujet | État |
|---|---|---|
| 1 | Device Lifecycle & Holder Management | ✅ terminée |
| 2 | Service Lifecycle & Ownership | ✅ terminée |
| 2.5 | Global Managed Departments | ✅ terminée |
| **3** | **Client Request Workflow** | **🔵 en cours** |
| 4 | Request Technician Workbench & Execution Stepper | ⬜ |
| 5 | User 360° Operational View | ⬜ |
| 6 | Settings & Managed References | ⬜ |
| 7 | Billing Workbench & Flexible Billing | ⬜ |
| 8 | Cross-System Audit, Migration & E2E | ⬜ |
| — | Addon Hassan — Customer Management & Security | ⬜ |

Repères actuels : **479 tests backend**, **71 tests frontend**, `pyflakes` et `yarn lint` propres.

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

### Phase 3 — Workflow de demande client 🔵

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
| 7 | Tests portail + Vitest de bout en bout | 🔵 **en cours** |

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

**Reste à faire :** la passe finale de tests portail (§58 restants, §59).

---

## 4. Journal

| Date | Qui | Ce qui a été fait |
|---|---|---|
| 2026-09-11 | agent principal | Phases 1 et 2 terminées et commitées (`after phase 2 done`). |
| 2026-09-11 | agent principal | Phase 2.5 terminée (`after phase 2.5 done`). Correction d'une fuite de départements de test dans le catalogue réel. |
| 2026-09-12 | second agent | Extension Phase 2.5 : renommage propagé, département obligatoire pour un nouvel utilisateur. |
| 2026-09-12 | agent principal | Phase 3 tâche 1 (`after phase 3 request intents`) puis tâches 2–4 et 6 (`after phase 3 request builder`). |

> Ajoute ta ligne ici quand tu termines quelque chose.
