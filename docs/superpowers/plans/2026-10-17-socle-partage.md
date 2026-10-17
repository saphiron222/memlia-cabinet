# Memlia Cabinet — plan du socle partagé

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Démarrer le produit complet avec une installation de développement persistante, des commandes protégées, une interface Twenty connectée, une GED et des collectes simulées vérifiables.

**Architecture:** Monolithe modulaire local partagé, PostgreSQL de référence et adaptateur PGlite pour les essais autonomes. Contrats TypeScript/Zod partagés au même build entre serveur et interface ; les sorties HTTP sont validées à la sérialisation. Les jobs et les pièces restent locaux.

**Tech Stack:** Node 22.22+, TypeScript strict, Fastify 5, React 19, Vite 8, PostgreSQL 17, PGlite, Vitest et Playwright. Versions installées exactement verrouillées ; sources MIT Twenty vendored à la révision du cahier.

**Spec:** `docs/cahier-des-charges.md`, `docs/exigences.json`, `docs/validation-connecteurs.md`.

## Global Constraints

- Le périmètre complet reste actif ; ce plan livre un lot et ne réduit pas les exigences à un MVP.
- « Toute dernière phase en cabinet sur les vrais portails ». Aucun secret, profil ou compte réel n’est nécessaire au développement de ce lot.
- « La référence graphique est le code Twenty figé au commit e7743ba77003f3eab957cfcca8e760d383cde550 ».
- « Les montants sont des valeurs décimales exactes » ; date civile et instant restent distincts.
- Le dépôt est public. `evidence/private`, les volumes et les secrets ne sont jamais ajoutés à Git.
- Les tests traversent les commandes/HTTP, le contrat de collecte, la GED ou l’UI ; aucun test de détail privé ou de mock qui se teste lui-même.

## Review Focus

- Requête directe et export d’un utilisateur sans droit : même refus que l’interface, sans fuite d’une ressource confidentielle.
- Nouvelle tentative de la même commande après perte de réponse : une ressource et un événement, pas de doublon.
- Deux modifications depuis la même version : une réussite et un conflit explicite, sans perte silencieuse.
- Date de fin de mois, valeur zéro et montant inconnu : conservation après fermeture/réouverture et export.
- Page HTML reçue à la place d’un document, identité de dossier inattendue ou source indisponible : résultat refusé/partiel explicite, sans fausse collecte complète.

---

### Task 1: Commandes métier persistantes et accès individuel

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`.
- Create: `packages/contracts/package.json`, `packages/contracts/src/index.ts`, `packages/contracts/src/records.ts`.
- Create: `apps/server/package.json`, `apps/server/src/app.ts`, `apps/server/src/index.ts`.
- Create: `apps/server/src/storage/database.ts`, `apps/server/src/storage/migrations.ts`.
- Create: `apps/server/src/identity/*`, `apps/server/src/records/*`.
- Test: `apps/server/test/application.test.ts`, `apps/server/test/persistence.test.ts`.

**Interfaces:**
- Produces: `createApplication(options: ApplicationOptions): Promise<FastifyInstance>` ; options `dataDirectory: string`, `publicOrigin: string`, `databaseUrl?: string`, `allowEmbeddedDatabase?: boolean`, `clock?: () => Date`.
- Produces: canonical Zod schemas and derived types `CabinetRecord`, `RecordKind`, `CreateRecordInput`, `UpdateRecordInput`, `ApiError`, `SessionUser` from `@memlia/contracts`.
- HTTP prefix `/api/v1`. Setup status and initialisation, session/login/logout, resource catalogue, dossier/contact/tache/obligation CRUD sans suppression définitive, transitions de tâche, historique, dashboard et export CSV.
- Record envelope: `id`, `kind`, `title`, `dossierId`, `confidential`, `data`, `version`, `createdAt`, `updatedAt`. `data` is validated by kind, not an unbounded JSON payload.
- Writes carry an operation identity; updates carry `expectedVersion`. Error envelope `{error:{code,message,details?}}` and meaningful 400/401/403/404/409 statuses.

- [ ] Write and run a failing HTTP test: an empty installation requires setup; bootstrap creates one administrator, no default credentials.
- [ ] Implement setup/session and durable migration; run the test and suite green.
- [ ] Add a failing lifecycle test for a dossier and task with date `2026-10-31`, checklist and state; implement validation, persistence, reload through a fresh application and CSV agreement.
- [ ] Add failing tests for unprivileged direct access/export, denied confidential resource and login/session revocation; implement server authorization and session protections.
- [ ] Add failing tests for duplicate operation identity, concurrent update from one version and unique history; implement transactions and version checks, run the whole suite.
- [ ] Verify the same persistence test against `DATABASE_URL` when supplied; embedded mode is explicit and not a production PostgreSQL claim.
- [ ] Commit the functioning module, contracts and necessary config; report real red/green evidence and any limitation.

### Task 2: Interface Twenty branchée aux commandes

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/src/index.ts`, `packages/ui/vendor/*`, `packages/ui/PROVENANCE.json`, `packages/ui/LICENSE.twenty-ui`.
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/*`.
- Test: `tests/e2e/cabinet.spec.ts`, `playwright.config.ts`.

**Interfaces:**
- Consumes the Task 1 HTTP contract and types from `@memlia/contracts`; no handwritten duplicate payload types.
- Produces setup/login, dashboard, dossiers, contacts, tasks and obligations pages with actual list/form/detail actions, filter/search, persistent edits, task checklist/transition/history and CSV export.
- Produces a Twenty frame: 220px navigation, 48px collapsed mode, 13px Inter, dense 32px table rows, 400px detail panel, exact light/dark CSS variables and accessible controls.

- [ ] Read `docs/design-twenty.md`; vendor the declared MIT files with notices and record deliberate import adaptations. Do not copy twenty-front under a MIT claim.
- [ ] Write/run the failing browser flow in an isolated fictitious data directory: setup, create dossier/task, edit date, close/reopen/reload, transition and export.
- [ ] Implement shared UI primitives from real Twenty source and the connected pages. Loading, empty, validation, denied, error and conflict states must have real branches.
- [ ] Add keyboard/form-error and theme/navigation checks; run the browser suite green and inspect screenshots visually.
- [ ] Run strict checking and production build; commit. Do not display an unimplemented command as working.

### Task 3: GED locale avec contrôle du contenu

**Files:**
- Create: `packages/contracts/src/documents.ts`, `apps/server/src/documents/*`.
- Modify: `apps/server/src/app.ts`, `apps/web/src/*` for the documents view and dossier attachment section.
- Test: `apps/server/test/documents.test.ts`, `tests/e2e/documents.spec.ts`.

**Interfaces:**
- `DocumentStore` accepts validated document bytes/stream and metadata, returns an immutable local document reference with SHA-256, size, media type, source and dossier.
- HTTP multipart upload/list/download uses authenticated dossier scope; filenames are display values, never filesystem paths.
- Logical documents have explicit version links independent of filenames; locally extracted supported PDF/text content is indexed for authorized search. Missing/corrupt content is distinguished from metadata visibility.

- [ ] Write a failing upload/list/download round-trip test with a fictitious PDF and a second-version document.
- [ ] Implement local temporary write, content validation and atomic commitment; retain provenance and versions.
- [ ] Write failing tests for HTML disguised as PDF, path traversal name, forbidden dossier, interrupted file and duplicate bytes with distinct source versions.
- [ ] Implement explicit outcomes, check that no invalid document is made definitive, and run the suite green.
- [ ] Add a failing two-document text search and version-chain test; extract supported local text, search only authorized documents, and return an explicit extraction/content-availability state for unsupported or damaged content. Same filenames never merge unrelated originals.
- [ ] Connect upload/download/list to the UI; browser test and build green; commit.

### Task 4: Contrat de collecte et 17 simulateurs explicites

**Files:**
- Create: `packages/contracts/src/collections.ts`, `apps/server/src/collections/*`, `apps/server/fixtures/*`.
- Modify: server routes and web collections page.
- Test: `apps/server/test/collections.test.ts`, `tests/e2e/collections.spec.ts`.

**Interfaces:**
- `runCollection(input: CollectionInput): Promise<CollectionResult>` behind the local job interface; result status, requested/observed coverage, records, artifacts, events, errors and checkpoint follow the spec.
- Connector IDs are exactly the 17 IDs in the archived collector catalogue. Real adapters remain unavailable until final validation; simulated mode is explicit in request, result and UI.
- Consumes `DocumentStore` from Task 3; no second document writer.

- [ ] Write a failing contract test for a nominal fictitious CFE acquisition with the right dossier/period/reference and stored PDF.
- [ ] Implement common execution/journal/checkpoint and adapter registration from fictitious scenarios, not live portal guesses.
- [ ] Add one meaningful variation per source family: debt apurement without payment, new message plus missing PJ, Urssaf multi-portfolio duplicate identity, distinct TI/PAM calendar axes, partial jedeclare recipient returns, Pennylane company versus tax source and INPI scope.
- [ ] Add failing interruption/retry, wrong identity, absent page boundary, HTML login and real-mode-disabled tests; implement conservative complete/partial/needs-human outcomes.
- [ ] Connect run/progress/result and proof links to the UI; test green, commit. No live portal traffic.

### Task 5: Installation, CI et réception du lot

**Files:**
- Create: `deploy/compose.yaml`, `Dockerfile`, `.env.example`, `deploy/install.sh`, `deploy/backup.sh`, `deploy/restore.sh`.
- Create: `.github/workflows/ci.yml`, `scripts/verify-scope.mjs`, `docs/etat-realisation.md`.
- Modify: `README.md`, `docs/exigences.json` implementation references.
- Test: PostgreSQL CI service, build/container smoke and restoration tests.

**Interfaces:**
- Production server serves the built interface and `/api/v1` from one origin. `DATABASE_URL`, `DATA_DIRECTORY`, `PUBLIC_ORIGIN` and binding config are explicit; embedded database requires an explicit development opt-in.
- PostgreSQL, GED and application configuration survive container recreation. Database is not exposed publicly. Initialisation uses a user-chosen password.

- [ ] Write/run checks for full 171-ID retention, excluded scope, no secrets/private evidence tracked and all implemented routes mapped to real tests.
- [ ] Configure Linux standard-runner CI: install locked dependencies, check, unit/integration tests, actual PostgreSQL lifecycle test, web build and isolated Playwright flow. Archive only diagnostic artifacts with short retention.
- [ ] Implement container/compose and installer preflight; test fresh start and restart persistence. If the local Docker daemon is unavailable, report that limit and use CI evidence without claiming local container success.
- [ ] Implement and verify coherent backup/restore and non-destructive preflight rules; protect paths and credentials.
- [ ] Run the complete checks/build/browser suite; fresh review against cahier and standards, fix important findings with regression tests, then publish the branch and attach its PR.
- [ ] Update realised/planned/CI/field statuses. The remaining lots in §13 of the cahier remain mandatory; this lot does not declare the full product complete.
