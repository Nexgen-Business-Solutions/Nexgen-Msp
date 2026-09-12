# Avancement — Refonte Nexgen MSP

> Fichier de suivi mis à jour en temps réel. Garde-le ouvert pour voir où j'en suis.

## Vue d'ensemble

| Phase | Sujet | État |
|---|---|---|
| 1 | Device Lifecycle & Holder Management | ✅ Terminée · commitée |
| 2 | Service Lifecycle & Ownership | ✅ Terminée · commitée |
| 2.5 | Global Managed Departments | ✅ Terminée · commitée |
| **3** | **Client Request Workflow** | **🔵 En cours** |
| 4 | Request Technician Workbench | ⬜ À faire |
| 5 | User 360° Operational View | ⬜ À faire |
| 6 | Settings & Managed References | ⬜ À faire |
| 7 | Billing Workbench | ⬜ À faire |
| 8 | Cross-System Audit & E2E | ⬜ À faire |
| — | Addon Hassan (Customer Mgmt & Security) | ⬜ À faire |

---

## Phase 3 — Client Request Workflow (en cours)

La spec découpe en 7 tâches. Ordre imposé : backend d'abord, React ensuite.

### Tâche 1 — Sémantique des intentions (backend) ✅ terminée

| # | Étape | État |
|---|---|---|
| 1.1 | Champs `source_service_assignment` + `requested_for_user` sur la ligne de demande | ✅ fait |
| 1.2 | Module de règles `request_intents.py` (action vs état réel, conflits, sujet) | ✅ fait |
| 1.3 | Branchement dans la validation du DocType | ✅ fait |
| 1.4 | Correction approbation par département (lignes Device + nouveaux utilisateurs) | ✅ fait |
| 1.5 | Le portail n'écrit plus username/serial à la soumission | ✅ fait |
| 1.6 | `requested_for_user` renseigné automatiquement côté portail | ✅ fait |
| 1.7 | Type de demande dérivé côté serveur uniquement | ✅ déjà couvert |
| 1.8 | Tests backend (24 tests, scénarios §58) | ✅ fait |
| 1.9 | Suite complète verte (459 tests) + commit | ✅ fait |

> ℹ️ Un autre agent a étendu la Phase 2.5 en parallèle (renommage de département
> propagé, département obligatoire pour un nouvel utilisateur). J'ai pris connaissance
> de son travail et aligné les deux tests qui ne fournissaient pas de département.

### Tâches suivantes

| # | Tâche | État |
|---|---|---|
| 2 | APIs de contexte (`get_request_subject_context`, disponibilité, conflits) | ✅ 20 tests |
| 3 | Nouveau Request Builder React (stepper 4 étapes) | ✅ 10 tests |
| 4 | Cartes services Current/Available + contexte Device | ✅ inclus en 3 |
| 5 | Brouillons / réouverture / correction d'une demande rejetée | 🔵 en cours |
| 6 | Recherche utilisateur backend (remplace le chargement de tous les users) | ✅ inclus en 2 |
| 7 | Tests portail + Vitest | ⬜ |

---

## Invariant de la Phase 3

> Soumettre une demande ne modifie **jamais** la réalité opérationnelle.
> Aucune écriture sur Client User, Managed Device, Device Holder, Service Assignment.
> Les mutations appartiennent à la Phase 4.
