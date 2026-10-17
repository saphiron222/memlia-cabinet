# Memlia Cabinet

Pilotage du cabinet comptable, installé dans son environnement : dossiers, obligations, production, documents et robots locaux. Le design part des sources Twenty.

## Commencer

- [Cahier des charges complet](docs/cahier-des-charges.md) et [exigences identifiées](docs/exigences.json).
- [Accès nécessaires aux connecteurs et recette finale](docs/validation-connecteurs.md).
- [Design Twenty et provenance](docs/design-twenty.md).
- [Captures et sources conservées](evidence/README.md).

Le périmètre complet reste actif. Le développement se fait par lots vérifiables ; les essais sur les vrais portails restent la dernière phase en cabinet. Aucun compte ou secret réel n’est nécessaire aux simulations.

Le dépôt est public. Les pièces, identités, profils et captures du compte connecté restent dans l’archive locale ignorée. Les sources amont publiques et licences réutilisées sont conservées. La publication du code original Memlia ne lui attribue pas automatiquement une licence libre ; les droits des tiers restent définis par leurs notices.

## Exécuter le socle

Node ≥22.22.0 : `npm ci`, `npm run check`, `npm test`, `npm run build`, puis `npm run test:e2e` après installation de Chromium Playwright. Le développement autonome autorise explicitement PGlite avec `ALLOW_EMBEDDED_DATABASE=true npm run dev:server` ; l’installation partagée emploie PostgreSQL 17.

[Installation Linux, HTTPS et restauration](docs/installation-locale.md) · [État de réalisation et preuves](docs/etat-realisation.md). L’interface, la GED et les 17 collectes fictives du socle ne clôturent pas les lots métier obligatoires. Aucun connecteur réel n’est encore qualifié.
