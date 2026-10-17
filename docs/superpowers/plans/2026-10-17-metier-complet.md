# Memlia Cabinet — réalisation du périmètre métier complet

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achever les fonctions locales du cahier, puis livrer une installation vérifiée dont seules les recettes de comptes externes restent à mener en cabinet.

**Architecture:** Continuer le monolithe modulaire du socle partagé. Chaque domaine possède ses schémas canoniques, commandes transactionnelles, droits et écrans ; la GED, l'identité, les événements et les identités d'opération restent partagés. Un contrat externe non acquis reste explicitement indisponible, jamais remplacé par un faux succès.

**Tech Stack:** TypeScript strict, Fastify, PostgreSQL/PGlite, React, Vite, primitives MIT Twenty, Vitest et Playwright ; versions exactes dans le verrou.

**Spec:** `docs/cahier-des-charges.md`, `docs/exigences.json`, `docs/recette-fonctionnelle.md`, `docs/validation-connecteurs.md`, `docs/design-twenty.md`.

**Prerequisite:** Les cinq tâches du plan `2026-10-17-socle-partage.md` sont livrées et revues. Ce plan n'en duplique pas les interfaces.

## Global Constraints

- « Il ne s’agit pas d’un MVP. Les lots sont un ordre de réalisation, sans suppression du périmètre. »
- « Toute dernière phase en cabinet sur les vrais portails ». Les jeux de développement et notifications restent fictifs ; aucun envoi, déclaration ou paiement réel implicite.
- « Les montants sont des valeurs décimales exactes » ; les calculs de centimes ne passent pas par un flottant binaire.
- « La confidentialité doit protéger liste, détail, recherche, compteurs, pièces, export, historique, notifications et assistant. »
- « La référence graphique est le code Twenty figé au commit e7743ba77003f3eab957cfcca8e760d383cde550 ». Contrats dans `@memlia/contracts`, composants métier dans `apps/web`, primitives dans `@memlia/ui`.
- « Une commande rejouée ne crée pas de deuxième tâche ou événement. Les conflits de version demandent une résolution explicite ».
- Dépôt public : aucune donnée réelle, capture de compte, session ou secret dans Git ou les rapports CI.
- Allo, Polyacte, application mobile, MCP externe et coffre-fort produit exclus ; IA de dossier proposée désactivée, aide d'usage incluse.

## Review Focus

- Une action portant sur plusieurs dossiers ne doit ni exposer ni modifier les dossiers interdits, y compris via relations et pièces jointes.
- Une correction rejetée et une déclaration antérieure acceptée doivent rester deux versions lisibles ; aucun état unique n'efface les retours contradictoires.
- Une génération récurrente après panne ou changement de modèle ne doit pas doubler ou réécrire les occurrences traitées.
- Un aperçu de lettre ou d'email produit avant une modification des données doit devenir périmé et ne plus pouvoir être envoyé.
- Une restauration complète doit conserver pièces, relations et secrets protégés ; un test de sauvegarde sans restauration n'est pas une preuve.

---

### Task 1: Référentiel complet, équipes, configuration et reprise

Préparation technique : `docs/recherche-imports-referentiel.md` (contrat public de recherche d'entreprise, lecteurs CSV/XLSX, limites et contrôles à construire) et `docs/recherche-traitements-isoles.md` (isolation des traitements, alternatives et limites à qualifier). Ces recherches ne constituent aucune preuve d'exécution ou de confinement.

**Files:** Extend `packages/contracts/src/records.ts`; create `packages/contracts/src/administration.ts`, `apps/server/src/administration/*`, `apps/server/src/imports/*`, `apps/web/src/features/administration/*`, `apps/web/src/features/imports/*`; tests `apps/server/test/administration.test.ts`, `apps/server/test/imports.test.ts`, `tests/e2e/administration.spec.ts`.

**Interfaces:** Extend the canonical resource catalogue with explicitly validated dossier/contact fields, établissements, équipes, sites, affectations, custom-field definitions, saved views and installation preferences. Routes under `/api/v1/administration` and `/api/v1/imports`. `previewImport` returns stable line identities, column mapping, normalized values, duplicate candidates and errors; `commitImport` consumes the preview identity/version, authorized accepted line IDs and operation ID. It rechecks permissions and source hashes.

**Coverage:** F-DOSSIERS, F-EQUIPES, F-CUSTOMFIELDS, F-IMPORT, F-COMPTE, F-DROITS, F-MODULES, F-ABONNEMENT, F-ENTERPRISE, F-EXPORT, F-DASHBOARD. Multi-cabinets means separately isolated installations with explicit installation identity and export/import boundaries; no shared implicit tenant.

**Shared criterion ownership:** notification event/channel preferences finish in Task3; reusable ordered stage types in Task4; assisted pipeline/checklist/stage-model reprise in Tasks3/4/6; password/invitation/recovery and real supplier connection states in Task10. PAR-001 exposes absent verified/manual/simulated source and known dates/coverage here; temporal source freshness is completed by Task2 and actual source wiring by Task10. A family touched here is not automatically complete.

- [ ] RED then GREEN: mapped CSV with reordered headers, SIREN `001234567`, invalid SIRET, duplicate contact, unknown enum, empty date; accepted rows survive reopening, rejected rows have an exportable report, replay creates no duplicate.
- [ ] Support actual local XLSX as well as UTF-8 CSV for dossier/contact/assignment preview and commit. Bound archive expansion, rows and columns; preserve textual identifiers and distinguish blank from zero; never evaluate a formula or follow an external relationship. Verify a real XLSX fixture, errors and updates, rather than accepting renamed CSV. Research primary contracts/libraries before choosing the parser.
- [ ] Implement full dossier/contact forms, establishments, source/manual conflict resolution, archive/reactivate, teams/sites, explicit rights and user administration. Display archived records only when selected. Bulk commands return per-line results and recheck rights at execution.
- [ ] Implement company search from a documented public contract, with local HTTP fixture tests and explicit unavailable/error states; selecting a result only proposes creation/merge, never a fiscal habilitation. Implement detected-company create/hide/restore, automatic versus manual decision and stable source-to-dossier reconciliation without duplicates. Supplier-derived detections retain their real/simulated provenance.
- [ ] Implement named ordered roles, persisted permissions and team/site assignments with immediate effective-right recalculation; a shared team grants no implicit access to unrelated dossiers. Test direct, list and export after removal as well as the editor UI.
- [ ] RED then GREEN: custom number/date/boolean/choice fields preserve unknown versus zero; changing a field type with incompatible values is rejected until an explicit migration; renaming a field preserves its ID and values.
- [ ] RED then GREEN: reassignment/removal changes direct/list/export visibility immediately; a batch containing an unauthorized dossier changes only authorized rows and returns a non-disclosing refusal. Build actual UI import preview/mapping/commit and saved filter/sort/pagination views.
- [ ] Extend the dashboard with period/scope filters, actual task/obligation progress charts and personal widget ordering. RED then GREEN: counters, chart, opened detail and filtered export agree; user A's arrangement survives login and never changes user B's arrangement.
- [ ] Verify installation identity, account preferences, local delivery information and explicit enabled module list without inventing a SaaS billing system; browser checks, check/test/build, commit and report.

### Task 2: Fiscalité, tentatives, retours, dettes et règlements

Préparation technique : `docs/recherche-suivi-fiscal.md` (campagnes datées, IFU/RCM, apurement et limites des échéances déduites).

**Files:** Create `packages/contracts/src/fiscal.ts`, `apps/server/src/fiscal/*`, `apps/web/src/features/fiscal/*`; tests `apps/server/test/fiscal.test.ts`, `tests/e2e/fiscal.spec.ts`; extend canonical obligation schema and catalogue.

**Interfaces:** `/api/v1/fiscal` commands for occurrence generation, preparation, local approval, manual observation/cancellation, transmission attempts, platform/recipient returns, debts, apurements, payments and reconciliations. All commands carry operation identity and version when amending an existing object. Pure `deriveFiscalSituation` returns separate axes, provenance, applicable accepted version, exact paid/remaining totals and ambiguities. Twelve natures are explicit: TVA, IS, CVAE, CFE_IFER, TF, DAS2, DSN, IRPP, RCM_2777, IFU_2561, DES, CUSTOM. Imported amounts are not claimed to be official tax calculations.

**Coverage:** F-TVA, F-IS, F-CVAE, F-CFE, F-FONCIER, F-DAS2, F-DETTES, F-PAYMENTS, F-SOCIAL, F-IRPP, F-RCM, F-IFU, F-DES, F-ANOMALIES.

**Shared criterion ownership:** fiscal detail, evidence and stable obligation links belong here; Task3 supplies and wires the common checklists/comments into those fiscal details (PAR-006, PAR-020 / F-TVA-AC-03, F-DAS2-AC-03). Task9 completes the modeled email reminder from the selected authorized obligation context (PAR-007 / F-TVA-AC-03). These criteria remain partial until those integrations are exercised; touching a family here does not complete them.

- [ ] RED then GREEN: TVA approved locally, one recipient rejected and another pending; retain every return and show no fictitious payment or globally accepted state. Accepted original IS plus rejected correction preserves original applicable version.
- [ ] RED then GREEN: unknown amount differs from `0.00`; `100.00` due with `30.01` and `69.99` distinct payments gives `0.00`; recollecting the first payment does not duplicate it. Apurement reduces a debt with amount/reason/provenance; an instalment schedule is a separate object, and neither proves a bank debit.
- [ ] Implement grids/filters per nature/campaign, detail timelines, manual state reasons, bulk preparation/approval, archive/néant/masquage reasons, obligation-to-task and GED links. Permission to approve does not imply permission to transmit.
- [ ] RED then GREEN: CFE candidates distinguish absent bank account, unparsed PDF, ambiguous masked IBAN and order older than twelve months; preserve candidates, dated rule and confidence, never infer confirmed payment. IFU aggregation links RCM versions and marks a previously approved aggregate stale when a source changes.
- [ ] RED then GREEN: identical RCM monthly totals with missing beneficiary identities/category allocation cannot produce a complete IFU; missing months differ from confirmed zero. Show preparation coverage and dated campaign status; a draft supplier specification cannot enable transmission or certify an export. Individual observed due date, sourced campaign rule and internal target date stay distinct.
- [ ] Complete the temporal freshness portion of PAR-001 on the canonical obligations and dashboard/detail/export: separate observation time from actual source-update time, retain source/version/coverage and an explicit versioned operational cadence policy. Exercise fresh/stale/unknown with configured fictitious policies; no source date or applicable policy means indeterminate, and manual/simulated or partial evidence does not become a verified fresh supplier source. No universal fiscal threshold or supplier SLA is invented.
- [ ] Test DSN per establishment/month/recipient, IRPP per contact/year, source conflicts and DES manual evidence without inventing private adapter paths; browser checks, check/test/build, commit and report.

### Task 3: Tâches avancées, récurrence, calendrier et notifications

**Files:** Create `packages/contracts/src/workflows.ts`, `apps/server/src/workflows/*`, `apps/server/src/notifications/*`, `apps/web/src/features/workflows/*`; tests `apps/server/test/workflows.test.ts`, `tests/e2e/workflows.spec.ts`.

**Interfaces:** Versioned checklist and recurrence templates; `previewOccurrences` and `generateOccurrences` share one pure civil-date rule engine. Occurrence identity is template+target+period; one job transaction never recreates processed history. API `/api/v1/workflows` and `/api/v1/notifications`; calendar/list/Kanban/week query the same task IDs. Comments, mentions, subscriptions and reminders remain authenticated and scoped.

**Coverage:** F-TACHES, F-CHECKLIST, F-CALENDRIER, F-ALERTS, F-STATES.

- [ ] RED then GREEN: monthly nominal day 31 gives 2027-02-28 and 2028-02-29; quarter/year/week rules, past start and DST respect civil dates and configured zone; repeat generation after interruption yields identical IDs without duplicates.
- [ ] Implement full task fields (type, billing, urgency, assignees, tags, dossier/prospect, files), drag actions with keyboard alternative, list/Kanban/week/calendar, saved views and time links.
- [ ] Apply the common checklist/comment commands to both tasks and the existing canonical fiscal obligations, and wire them into the fiscal detail. Verify a TVA and a DAS2 retain the same checklist, comments and evidence after reload/view change and permission revocation, using the Task2 obligation identity rather than parallel fiscal-comment storage.
- [ ] RED then GREEN: editing a checklist model affects future occurrences only unless an explicit merge is requested; existing checked/removed/reordered items and completed tasks remain unchanged; conflicting concurrent edits return 409.
- [ ] Complete the assisted reprise criterion for supplied checklist models: announced exchange format, preview/mapping, explicit model validation and report of unmapped elements. Reuse the import boundary and create real versioned models, not a claimed private Teradion importer.
- [ ] RED then GREEN: a subscription or mention grants no read access; after permission removal, pending notifications omit protected content; client messages and internal comments with identical text never cross their audiences.
- [ ] Implement in-app notification read/dismiss/preferences and deterministic reminder scheduling, test reload consistency through browser, check/test/build, commit and report.

### Task 4: Bilans, étapes, obligations personnalisées, process et suivi

**Files:** Create `packages/contracts/src/production.ts`, `apps/server/src/production/*`, `apps/web/src/features/production/*`; tests `apps/server/test/production.test.ts`, `tests/e2e/production.spec.ts`.

**Interfaces:** `/api/v1/production` versioned annual configurations, balance instances, custom obligation models, one-off processes and recurring follow-ups. Columns have stable IDs, typed values, frequency and role requirements. Targets are dossier/contact/utilisateur/libre for process, dossier/contact for suivi; changing a populated target requires a migration command.

**Coverage:** F-BILANS, F-DCA, F-CUSTOM, F-SUIVI.

- [ ] RED then GREEN: duplicate 2026 balance configuration to 2027 keeps steps/order/types but no previous approvals, deposit receipts or dates. Role-specific approval checks both action and extra role.
- [ ] Implement year/family balance grids, dates liasse/AG/deposit, stage model editor/reorder, progress and documents/receipts; a locally completed step does not create an INPI receipt.
- [ ] Implement reusable stage types with ordered stable statuses, color/icon and consistent grid/form/preview rendering (F-CUSTOMFIELDS-AC-03 / PAR-079). Supplied stage-model reprise has preview, explicit validation and unmapped-element report, sharing the import boundary.
- [ ] RED then GREEN: custom obligation generation and one-off processes allow the configured duplicate-dossier policy, preserve rows on column rename and reject a target change without explicit migration.
- [ ] Implement process/suivi template/row/column editors, typed cell commands with expectedVersion, per-column periods and export; nine annual IRPP contact columns are distinct from the fiscal IRPP occurrence.
- [ ] Test concurrent cell editing, rights, replay and browser reload; check/test/build, commit and report.

### Task 5: Temps, capacité, charge et forfaits

**Files:** Create `packages/contracts/src/time.ts`, `apps/server/src/time/*`, `apps/web/src/features/time/*`; tests `apps/server/test/time.test.ts`, `tests/e2e/time.spec.ts`.

**Interfaces:** `/api/v1/time` entries, timer start/stop, rates, capacities, dated assignments and forfaits; `calculateWorkload` exposes cabinet→dossier→occurrence inheritance and provenance, fixed/variable components, realized/planned totals and period. Duration uses integer minutes/seconds; money uses exact decimals. Closed periods retain versioned rates.

**Coverage:** F-TEMPS, F-CHARGE.

- [ ] RED then GREEN: inheritance 120 minutes, dossier override 90, occurrence override 45, return-to-inheritance restores 90 with explanation; changing a parent doesn't rewrite explicit children.
- [ ] Implement manual and timer time entry, week report, task/dossier links, lock/reopen periods, filtering and export; prevent two active timers for one user and double stop/replay. Wire realized time and planned-versus-realized reporting into the existing Task3 task detail/report through its canonical task identity (PUB-016-S2); Task3 links alone do not complete that reporting criterion.
- [ ] RED then GREEN: forfait change mid-month, activity starts late, two collaborators on one role and extra task do not double-count; allocation weights and prorating basis are explicit versioned choices, never guessed fiscal rules.
- [ ] Implement workload grid by user/team/site/period, capacity and overload, reassignment preview/commit, actual-versus-planned, dated forfait/rate editors; test unauthorized employee data and browser workflow, check/test/build, commit and report.

### Task 6: CRM, onboarding et LAB

**Files:** Create `packages/contracts/src/relationship.ts`, `apps/server/src/relationship/*`, `apps/web/src/features/relationship/*`; tests `apps/server/test/relationship.test.ts`, `tests/e2e/relationship.spec.ts`.

**Interfaces:** `/api/v1/relationship` prospect/pipeline/model/mission, onboarding requirements and LAB reviews. Prospect conversion returns one dossier and one triggering event per operation. Pipeline temperature/manual risk remain distinct from a calculated score. Onboarding checks have provenance and cannot masquerade as verified portal rights.

**Coverage:** F-CRM, F-ONBOARDING, F-LAB.

- [ ] RED then GREEN: move prospect through configurable pipeline, keep manual temperature separate, convert twice with same operation and obtain one dossier; separately configured stage/quote/letter trigger fires once.
- [ ] Implement company/person/future-company prospect, source/honoraires/notes/missions, former cabinet, pipeline/list/detail, conversion review and linked dossier; full onboarding model/checklist/blockers, manual/import/INPI creation origins.
- [ ] Complete assisted reprise for supplied pipeline models: preview stage correspondences and unmapped values, explicit validation and a report, then persist an actual editable pipeline model. No automatic private supplier connector is implied.
- [ ] RED then GREEN: two differently sourced fiscal access steps stay distinct; a manual checkbox creates no verified habilitation. A missing required identity/mandate blocks activation with a specific reason.
- [ ] Implement LAB evidence, justified human vigilance level, revisions/reminders and export; do not invent an automated regulatory assessment. Test permissions, partial bulk results and browser conversion/onboarding, check/test/build, commit and report.

### Task 7: Modèles Word, génération PDF, lettres et signature

Préparation technique : `docs/recherche-documents-locaux.md` et `docs/recherche-signature-locale.md` (sources, versions et limites ; aucune proposition n'y vaut preuve d'exécution). L'adaptateur optionnel Documenso v2.20.0 permet de construire une prémisse sur un protocole publié ; il ne choisit ni n'active le prestataire du cabinet.

**Files:** Create `packages/contracts/src/templates.ts`, `apps/server/src/templates/*`, `apps/web/src/features/templates/*`; extend GED for generated outputs; tests `apps/server/test/templates.test.ts`, `tests/e2e/templates.spec.ts`; conversion runtime in `Dockerfile` when needed.

**Interfaces:** `/api/v1/templates` accepts DOCX with bounded archive size/entries, known/unknown variables and required input; rendering consumes a frozen canonical data snapshot, produces a local PDF in GED plus model/version/data hashes. Signature requests are distinct provider jobs with explicit simulation/configured mode, statuses sent/opened/signed/refused/expired and proof documents.

**Coverage:** F-DOCMODELS, F-LM, F-SIGNATURE.

- [ ] RED then GREEN: variable split across Word runs resolves; unknown variables become named fields to complete, and missing required values block generation; malicious archive paths or oversized expanded content are refused. Use real local rendering/conversion, not a PDF-named HTML file.
- [ ] Implement DOCX import/variables/form/mission lines/conditions, versioned template and document generation/preview/GED. Generic models need not trigger signature; keep exact original and generated artifacts.
- [ ] RED then GREEN: change a dossier field after preview; send is blocked as stale until regenerated. Editing a frozen letter creates a new version, never mutates the document already sent.
- [ ] Implement signature provider contract and deterministic fixture transitions/proof import, explicit sender/recipient/approval, partial batch results and idempotent callbacks with authenticated verification; real provider connection awaits final access matrix. Browser flow, check/test/build, commit and report.
- [ ] Exercise the published optional Documenso v2.20.0 protocol against a local HTTP fixture, disabled by default: multipart preparation, provider-original retrieval, explicit approval of that immutable PDF version before separate distribution, status and evidence retrieval. Preserve both generated and provider-normalized artifacts and their hashes; a transformation invalidates the previous approval. Authenticate the actual static-secret webhook and reconcile authenticated provider state, without inventing an HMAC or a stable event identifier. Only `COMPLETED` plus the required matching artifacts can complete the local signature proof; a downloadable PDF/certificate or an individual signature is insufficient. Lost create/distribute responses remain uncertain until reconciliation or human resolution, never a blind retry. No provider installation, real signature or legal qualification is implied.

### Task 8: Échanges fiscaux et sociaux, habilitations et formalités

**Files:** Create `packages/contracts/src/communications.ts`, `apps/server/src/communications/*`, `apps/web/src/features/communications/*`; tests `apps/server/test/communications.test.ts`, `tests/e2e/communications.spec.ts`; consume collection observations rather than parallel connector storage.

**Interfaces:** `/api/v1/communications` threads/messages/attachment coverage/processing and read observations, `/api/v1/authorizations` explicit request lifecycle, `/api/v1/formalities` INPI observations/anomalies. Reads and reply requests are separate commands. Portfolios and account context are part of external message identity.

**Coverage:** F-MESSAGERIE_FISCALE, F-SOCIAL_MESSAGES, F-HABILITATION, F-INPI, F-ANOMALIES.

- [ ] RED then GREEN: the same cotisant account reached through two portfolios retains one source message with both contexts; identical references from distinct cotisant accounts remain distinct. Pagination and missing attachments produce explicit incomplete coverage; initial unread observation remains in history after a read-side effect.
- [ ] Implement scoped thread/inbox/detail/search/attachments/treatment, source freshness, source unread versus local processed state and human-intervention queue. Reply preview/approval and configured capability are separate from read-only collection.
- [ ] RED then GREEN: request→code-awaited→refused/activated lifecycle retains evidence; collecting a SEPA B2B mandate does not activate Payer or transmit the mandate to the bank. Show distinct statuses and actions.
- [ ] Implement habilitation/attestation dashboards, missing dossier/service detection, formalities creation/acts/accounts tracking and source-conflict resolution; no invented live submit action. Browser checks, check/test/build, commit and report.

### Task 9: Email, campagnes Brevo et accès client

Préparation technique : `docs/recherche-connexions-locales.md` (SMTP réel local, bornes IMAP, API Brevo, retours et limites des reprises).

**Files:** Create `packages/contracts/src/messaging.ts`, `apps/server/src/messaging/*`, `apps/server/src/client-access/*`, `apps/web/src/features/messaging/*`, `apps/web/src/features/client-access/*`; tests `apps/server/test/messaging.test.ts`, `apps/server/test/client-access.test.ts`, `tests/e2e/messaging.spec.ts`.

**Interfaces:** `/api/v1/messaging` mailbox/message/label/template/outbox and campaigns/segments/consent/feedback; `/api/v1/client-access` authenticated limited client accounts, shares, requests and uploads. Shared documents are always reauthorized; no direct local filesystem URL. Mailbox ownership differs from cabinet permissions. Test transport captures a durable outbox and never sends externally.

**Coverage:** F-EMAIL, F-BREVO, F-GED, F-ONBOARDING client portal.

- [ ] RED then GREEN: exactly 10 files totaling 15,728,640 bytes can be previewed; file 11 or one extra byte is refused before provider submission. Changed recipient/template/data/attachments invalidate the frozen preview.
- [ ] Implement compose/preview/approval/queued/result/error, sender verification config, mailbox labels/read/disconnect and mail→task conversion; personal mailbox content isn't exposed by general cabinet rights. Disconnect revokes access and follows configured local retention.
- [ ] Complete the fiscal reminder integration from the selected obligation: actual applicable message model, authorized dossier/period/amount/recipient and immutable preview, with current-rights/source-version rechecks before queued dispatch. Verify PAR-007 and the email portion of F-TVA-AC-03 through this end-to-end flow; an earlier fiscal-context proposal alone is not a completed email feature.
- [ ] Add configured SMTP submission and standard mailbox adapter boundaries with provider OAuth capabilities represented explicitly; test SMTP against an isolated local capture server, never a real recipient. Unsupported provider operations stay unavailable with a reason; simulation and transport acceptance do not claim final delivery.
- [ ] RED then GREEN: permission revoked between preview and queued send prevents dispatch; internal comment and client message with same text remain separately authorized. Campaign segment change, unsubscribe and duplicate feedback retain consent and don't resend.
- [ ] Implement Brevo segments/campaign/feedback via canonical provider contract, explicit simulation when not configured, no unbounded inactive-key assumption; actual provider configuration is local with final validation deferred.
- [ ] RED then GREEN: client A can list/download only documents shared with A, cannot guess B's ID or internal note, and revocation affects an existing session; requests/upload statuses and browser client workflow, check/test/build, commit and report.

### Task 10: Connexions, identité fédérée, annuaire et aide

Préparation technique : `docs/recherche-connexions-locales.md` (OIDC, vérification JWS explicite, domaine cabinet et disponibilité des méthodes).

**Files:** Create `packages/contracts/src/integrations.ts`, `apps/server/src/integrations/*`, `apps/server/src/help/*`, `apps/web/src/features/integrations/*`, `apps/web/src/features/help/*`; extend identity with configured OIDC; tests `apps/server/test/integrations.test.ts`, `apps/server/test/oidc.test.ts`, `tests/e2e/integrations.spec.ts`.

**Interfaces:** Local encrypted secret references, capability manifests, health/expiry and profile locks consumed by the 17 collectors. Pennylane company API versus fiscal share and public INPI versus private formalities have distinct configurations/permissions. OIDC uses discovered configured issuer endpoints, authorization code+PKCE, state/nonce, verified claims and explicit invitation/account linkage; disabled configuration cannot grant a session. FE stores directory/provider observations without claiming accredited platform status. Help is searchable local usage documentation with exportable redacted support bundle.

**Coverage:** F-PENNYLANE, F-ADAPTERS, F-MODULES, F-SSO, F-FE, F-ASSISTANT usage, F-COMPTE, F-SECURITY, F-ENTERPRISE.

- [ ] RED then GREEN: missing/expired/revoked source config cannot be marked connected; replacing a secret never reveals it through API/log/export. Lock prevents two sessions driving the same browser account and releases after bounded failed worker recovery.
- [ ] Implement source account/capability/scopes/period/preflight screens, local credential entry and expiry/revocation, distinct pending-field-validation state. Keep unacquired private contracts and unauthorized portal writes unavailable with a specific reason.
- [ ] Verify all 17 source adapters, each with a nominal fixture and its own interruption/checkpoint/replay case, through the common collection contract and GED. Correct missing source-specific behavior; a family-wide generic success test cannot stand in for all 17.
- [ ] Build the first real-driver implementations from the documented procedures: browser acquisition stages and bounded downloads, documented API requests/parsers, identity checks and checkpoints. Exercise them against local fixture portals/HTTP servers. Mark unconfirmed selectors, private formats or missing supplier contracts explicitly; a simulator alone does not satisfy a real-driver premise. Live activation and confirmation remain the final cabinet phase.
- [ ] Wire the common PAR-001 freshness contract to actual acquired source timestamps, versions, coverage and documented/configured cadence policy in these local fixture drivers; collection time alone is not source freshness. Verify the dashboard/detail/export subset stays consistent, preserving unknown when the supplier timestamp or policy is absent.
- [ ] RED then GREEN: wrong issuer/audience/nonce/state or missing PKCE fails OIDC; disabled user cannot regain access from an existing IdP login, email collision never auto-links. Show provider availability as configured, not a fabricated Apple availability promise.
- [ ] Implement individual invitation, expiry/refusal, first password, own password change, session revocation and administrator-assisted recovery with hashed one-use tokens and an audit event; no token in list/export/log. RED then GREEN: replay/expired recovery fails, password reset revokes old sessions, last active administrator retains an explicit recovery method.
- [ ] Implement facturation électronique directory/provider status and evidence with dated source, help by module/workflow/import/export, support bundle preview/redaction; dossier AI remains proposed and off. Browser checks, check/test/build, commit and report.

### Task 11: Exploitation complète, reprise après panne et performance

Préparation technique : `docs/recherche-installation-locale.md` (maintenance, sauvegarde cohérente, bascule et limites du rollback).

**Files:** Extend `deploy/*`, `.github/workflows/ci.yml`, `apps/server/src/storage/*`; create `scripts/benchmark.mjs`, `apps/server/test/operations.test.ts`, `docs/exploitation.md`; tests deployment backup/restore/update scripts and PostgreSQL CI.

**Interfaces:** Versioned migrations with advisory installation lock, health/readiness/diagnostic without sensitive data, maintenance-aware jobs, coherent backup manifest for DB/GED/config and separately encrypted secrets/profiles. Restore refuses a non-empty target unless an explicit restoration operation is selected and verified; update requires a verified backup and migration compatibility check.

**Coverage:** F-INSTALLATION, F-UPDATE, F-BACKUP, F-SHARED, F-DIAGNOSTIC, F-SECURITY, F-ENTERPRISE.

- [ ] RED then GREEN: fresh installation, restart, upgrade from a prior schema fixture and two concurrent migration starts preserve all records; failed migration returns an actionable health error without partially applying a migration.
- [ ] Verify actual backup→fresh restore of representative linked records, documents and encrypted configuration; compare counts, hashes and authorized download; corrupt/missing archive member and path traversal are refused.
- [ ] Qualify the complete Linux execution confinement for CSV/XLSX imports, PDF extraction and DOCX conversion, using `docs/recherche-traitements-isoles.md` as preparation rather than proof: actual memory/RSS, CPU, PID, scratch and time bounds; no external network or cabinet secrets, reduced filesystem access, bounded input/output and termination of descendants. Exercise controlled sentinel, resource-exhaustion, interruption and cleanup cases against the deployed topology. Do not expose Docker's socket to the application or count Node heap limits as OS confinement; all producers join the existing maintenance/stop protocol.
- [ ] Implement HTTPS/local network preflight, startup/stop/diagnostic/update/rollback instructions, backup rotation and operational log redaction. No public database, universal password, production embedded fallback or unprotected secret export.
- [ ] Measure a documented synthetic 10,000-dossier/100,000-occurrence dataset with 20 concurrent users against actual PostgreSQL; retain p95 read/search/action measurements and indexes/bounds, improve failed objectives without hiding results. Exercise the complete multipart exit export at that volume too: all authorized objects/references, stable identity/count/hash checks, bounded work/files and no saturated progress journal or giant in-memory assembly. Docker absent locally is a reported limitation, not a passed container test.
- [ ] Run PostgreSQL CI, production build/container smoke, restoration and permission checks; commit with exact evidence and remaining field accesses.

### Task 12: Réception transversale, fidélité Twenty et traçabilité complète

Préparation de la référence indépendante : `docs/recherche-reference-twenty.md` et les deux artefacts officiels du SHA exact préservés localement avant expiration. Leur intégrité est vérifiée ; leur couverture et leur rendu restent à qualifier.

**Files:** Extend browser suites by real workflow, `scripts/verify-scope.mjs`, `docs/exigences.json`, `docs/etat-realisation.md`, `docs/recette-fonctionnelle.md`, `README.md`; add only useful visual baseline artifacts with fictitious content.

**Interfaces:** Requirement traceability records code/tests/local result/CI result/field status independently. A requirement can have several artifacts; a menu entry or a shared generic test alone cannot mark it implemented. Source provenance checks compare Twenty vendored file hashes/adaptations. Functional receipt runs against the production build with an isolated fictional cabinet.

**Coverage:** Every one of the 160 required entries, all 66 family identities retained, 10 exclusions and one unapproved IA extension unchanged. F-TWENTY, F-STATES, F-EXPORT and every cross-cutting right/replay rule.

- [ ] Compare every applicable acceptance criterion with actual behavior; add missing domain regression tests and implementation through their owning modules rather than marking planned behavior complete.
- [ ] Exercise full end-to-end cabinet paths: initial identity→import/team→obligation/attempt/return/payment→task/recurrence→balance/process→prospect/onboarding/letter→document/client→time/charge→collection/messaging→backup/restore. Assert independent expected values and direct access refusals.
- [ ] Inspect light/dark rendered UI at identical viewport/font/zoom against Twenty references; verify native token hashes, 220/48px navigation, 32px grid rows, 400px panel, keyboard, focus, zoom, reduced motion, empty/loading/error/conflict states. Record observed differences honestly and correct important ones.
- [ ] Run check/test/build and browser suite once at the final code, inspect standard-runner CI and installation artifacts, fresh whole-branch review and one reviewed fix wave; publish branch/PR and attach the PR to this chat.
- [ ] Update README with actual installation/use and final access checklist. Report complete local capabilities separately from external account receipt; do not declare real connectors validated before cabinet trials.
