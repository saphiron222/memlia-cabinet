# Références et preuves

Les preuves utiles sont conservées. Elles ne sont pas des dépendances de production.

- `private/teradion/` : copie locale intégrale de l’étude (captures du compte, vidéo, 2 494 images, guides et artefacts). Exclue de Git : le dépôt est public. Aucun original n’est effacé.
- `private/twenty-reference-e7743ba/` : Storybook compilé et captures de CI officiels du SHA Twenty exact, récupérés avant expiration, avec métadonnées GitHub et empreintes/CRC vérifiés. Quelques scénarios de composants ont été observés dans un navigateur isolé ; leur portée et leurs limites restent consignées dans les preuves privées. Cela ne reçoit ni l’application entière ni la fidélité Memlia. Voir `docs/recherche-reference-twenty.md`.
- `private/design-reference-2026-10-17/` : sources complètes Plane et cal.diy figées, paquet Propel exact, archives, métadonnées et inventaires vérifiés. Aucun code amont exécuté par leur acquisition. Voir `docs/recherche-design-plane-cal.md` et le contrat courant `docs/design-interface.md`.
- `upstream/` : source publique Twenty à la révision figée, archive Git LFS, provenance et licences. Les composants MIT réutilisés vivent dans `packages/ui/vendor`.
- `index.json` : index partageable des corpus et règles de correspondance. Les données du compte, sources JavaScript propriétaires et captures authentifiées ne sont pas publiées automatiquement.

Les dépendances npm sont fixées dans `package-lock.json` ; `node_modules` est reconstruit par `npm ci`. L’archive Twenty conserve les sources récupérées, sans son historique Git ni ses dépendances installées.
