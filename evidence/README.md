# Références et preuves

Les preuves utiles sont conservées. Elles ne sont pas des dépendances de production.

- `private/teradion/` : copie locale intégrale de l’étude (captures du compte, vidéo, 2 494 images, guides et artefacts). Exclue de Git : le dépôt est public. Aucun original n’est effacé.
- `upstream/` : source publique Twenty à la révision figée, archive Git LFS, provenance et licences. Les composants MIT réutilisés vivent dans `packages/ui/vendor`.
- `index.json` : index partageable des corpus et règles de correspondance. Les données du compte, sources JavaScript propriétaires et captures authentifiées ne sont pas publiées automatiquement.

Les dépendances npm sont fixées dans `package-lock.json` ; `node_modules` est reconstruit par `npm ci`. L’archive Twenty conserve les sources récupérées, sans son historique Git ni ses dépendances installées.
