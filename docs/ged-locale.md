# GED locale : original, version et disponibilité

La page Documents et la section Pièces du dossier utilisent les mêmes routes et les mêmes droits courants. Ajouter une pièce exige lecture et modification du dossier ; télécharger exige lecture et export. Une pièce confidentielle exige aussi le droit confidentiel du dossier. La confidentialité du dossier s’applique à toutes ses pièces. Une version conserve dossier et confidentialité de sa chaîne ; un même nom de fichier peut désigner plusieurs originaux indépendants.

Les PDF lisibles sans mot de passe et les textes UTF-8 sont recherchables localement. Un PDF sans texte est marqué « OCR nécessaire » ; aucun OCR n’est exécuté. Les autres octets sont conservés comme `application/octet-stream`, avec extraction explicitement non prise en charge. Cela ne revendique ni lecture de DOCX, ni aperçu, ni antivirus. HTML présenté comme PDF, PDF incomplet/illisible, texte invalide, nom contenant un chemin et transfert interrompu sont refusés avant publication.

Limite initiale : 10 Mio par original, métadonnées 8 Kio. PDF.js 6.4.299 s’exécute dans un processus local séparé, 30 secondes maximum, tas V8 128 Mio, 500 pages et cinq millions de caractères maximum ; XFA, évaluation et récupération de ressources par worker sont désactivées. CMaps, polices standard et WASM sont résolus dans le paquet PDF.js installé localement, avec leurs notices distribuées. Ces limites ne sont pas un confinement OS ni une limite RSS. L’extraction sert la recherche, sans garantie de reconstruction de tableaux ou d’ordre visuel. Les PDF chiffrés nécessitant un mot de passe sont refusés explicitement, sans collecte de secret.

L’empreinte SHA-256 et la taille sont contrôlées à la lecture. Une pièce absente ou altérée garde ses métadonnées visibles aux personnes autorisées ; le téléchargement renvoie respectivement 410 ou 422. L’ajout d’une nouvelle version reste possible. Les erreurs de requête trop volumineuse restent des 413 structurés, JSON compris.

## Engagement pour les modules internes

`DocumentStore`, dans `apps/server/src/documents/store.ts`, utilise le répertoire privé `dataDirectory/documents`. Aucun nom fourni ne devient un chemin. L’appelant prépare les octets hors transaction, puis partage sa transaction avec `commit` :

```ts
const store = new DocumentStore(dataDirectory);
const prepared = await store.prepare(input, bytesOrAsyncIterable);
try {
  await db.transaction(async tx => {
    const actor = await authenticate(tx, sessionToken, now);
    const reference = await store.commit(tx, actor, prepared, now);
    // Engager ici les observations et relations qui utilisent reference.id.
  });
} finally {
  await store.discard(prepared);
}
```

`input` suit `DocumentInputSchema` : operationId, dossierId, filename, mediaType, source `{kind,reference,version}`, confidential et previousVersionId. `prepare` renvoie un handle opaque lié à cette instance. `commit` recharge l’utilisateur actif et ses droits ; il retourne `DocumentReference` (id, logicalId, previousVersionId, version, provenance, SHA-256, taille, type, dossier, auteur/date, état d’extraction). Le journal d’opération existant rend le rejeu idempotent. Employer un identifiant d’opération dédié à la pièce, différent de celui d’une commande englobante.

`get(tx,actor,id)`, `list(tx,actor,DocumentQuery)` et `download(tx,actor,id)` vérifient les mêmes droits ; le dernier retourne `{document,bytes}`. Référence stable : UUID `id`, consultable par `/api/v1/documents/:id`, téléchargeable par `/api/v1/documents/:id/download`. `logicalId` relie les versions, indépendamment du nom ; une ancienne version ne peut pas recevoir une deuxième suite concurrente.

La préparation crée un temporaire privé, valide le contenu puis extrait le texte. L’engagement renomme atomiquement et synchronise l’original avant l’insertion SQL. Une panne SQL après ce renommage peut conserver un original privé orphelin ; aucune route ne l’expose sans référence SQL. Les originaux ne sont jamais automatiquement supprimés. L’opérateur peut rapprocher les UUID du volume avec `cabinet_documents.id` pour récupérer les orphelins lors d’une restauration contrôlée. Après interruption, refaire `prepare` avec les mêmes octets et la même commande, puis `commit`. Le handle de préparation n’est pas un point de reprise durable.

Les listes appliquent dans SQL les droits courants, la confidentialité du dossier et de la pièce, les filtres dossier/chaîne, la recherche, le total puis la pagination. Seules les métadonnées de la page sont transférées ; aucun texte intégral ne revient au serveur pour une liste. La vérification d’intégrité de ces seuls originaux utilise des blocs de 64 Kio ; seuls les téléchargements matérialisent les octets complets.

La migration 3 ajoute `search_text` et un index GIN `pg_trgm` (`cabinet_documents_search`). Les migrations 1 et 2 restent inchangées. Les anciennes pièces sont reprises une à une (lecture bornée à un original), en conservant la même normalisation JavaScript `toLocaleLowerCase("fr")` que les nouvelles pièces. La recherche garde la sous-chaîne exacte, accents et ponctuation compris ; `%`, `_` et `\` sont échappés comme caractères littéraux pour `LIKE`. Les recherches très courtes ou sans trigramme exploitable peuvent parcourir les candidats autorisés côté SQL, mais ne transfèrent jamais leurs textes complets à l’application. Les objectifs globaux de charge restent à mesurer au lot dédié.

`pg_trgm` 1.6 est un prérequis PostgreSQL vérifié localement. La migration le crée dans le schéma partagé `public` si nécessaire ; un rôle d’exploitation sans droit de création d’extension doit le faire provisionner auparavant par l’administrateur. Une extension déjà placée ailleurs ou d’une autre version bloque explicitement la migration plutôt que d’être déplacée silencieusement. L’opclass de l’index est qualifiée `public.gin_trgm_ops` : supprimer un schéma d’installation/test ne supprime pas l’extension ni les index d’un autre schéma. PGlite charge explicitement `contrib/pg_trgm`, déjà distribué dans sa version npm verrouillée, sans nouvelle dépendance. Le test sur deux installations vérifie la survie de l’index après nettoyage de la seconde.

Référence technique : [indexation des sous-chaînes par pg_trgm dans PostgreSQL 17](https://www.postgresql.org/docs/17/pgtrgm.html#PGTRGM-INDEX). Le choix de trigrammes conserve les résultats existants ; une recherche par mots et racines linguistiques aurait une autre sémantique.

## Dépendances et notices

Les dépendances nouvelles sont figées : `@fastify/multipart@10.1.4` (MIT), `pdfjs-dist@6.4.299` (Apache-2.0). Le verrou conserve leurs transitives et intégrités. Le build serveur copie le worker PDF et distribue les licences/notices des paquets d’exécution effectivement installés dans `dist/licenses`, avec inventaire des versions.

Deux notices complètes sont dans les README installés (`pg-types@2.2.0`, `pgpass@1.0.5`). Les binaires optionnels `@napi-rs/canvas-*` utilisent la licence livrée par le paquet parent de même origine. `abstract-logging@2.0.1` renvoie depuis son README à [la licence publiée par son auteur](https://jsumners.mit-license.org/license.txt) ; copie conservée dans `apps/server/licenses`, acquise le 17 octobre 2026. Le build échoue pour tout autre paquet sans notice identifiable.

## Traçabilité locale

`PUB-006-S1`, `REA-SC-12`, `F-GED-AC-01/02`, `TR-ACCESS`, `TR-PERSIST`, `TR-PROVENANCE` et la règle transversale Pièces : tests comportementaux dans `apps/server/test/documents.test.ts`, parcours dans `tests/e2e/documents.spec.ts`. Partage/demande client (`F-GED-AC-03`, `PUB-006-S2`), collecte fournisseur, sauvegarde cohérente et charge restent leurs lots propres. Aucune validation CI ni cabinet n’est déclarée par cette preuve locale.
