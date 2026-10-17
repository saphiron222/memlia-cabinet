# État de réalisation

Le registre conserve **171 exigences : 160 requises, 10 exclusions et 1 proposition**. Les identités/périmètres sont vérifiés par `scripts/verify-scope.mjs` contre `docs/scope-baseline.json` ; les exclusions ne deviennent pas des fonctionnalités à développer. Le cahier complet et les douze lots du plan métier restent obligatoires. Cette livraison est le socle partagé.

| Ensemble | Construit | Vérification locale | CI | Cabinet |
| --- | --- | --- | --- | --- |
| Identité, droits, dossiers/contacts, tâches et premières obligations | Socle persisté et contrats canoniques | HTTP, PGlite, PostgreSQL 17, parcours navigateur fictifs | Workflow candidat, résultat à joindre après exécution | À réaliser en dernière phase |
| Interface Twenty | Sources MIT figées, 59 fichiers vérifiés, notices distribuées | Build et parcours ; comparaison visuelle limitée, pas réception pixel complète | À confirmer | Accessibilité/zoom/fidélité complète à recevoir |
| GED | Originaux immuables, versions, recherche autorisée et téléchargements | PDF/textes, intégrité, droits, index partagé | À confirmer | Corpus hostile/charge et stockage réels à qualifier |
| File et 17 collectes simulées | File durable, reprise et fixtures normalisées | Scénarios bornés, droits, saturation du journal | À confirmer | Aucun fournisseur réel connecté |
| Installation et restauration | Paquet Compose, UI/API même origine, rôle DB limité, arrêt/drain, dump+GED/config et restauration neuve | PostgreSQL 17, refus de cibles/manifestes invalides ; Colima/Linux ARM64 : build, recréation/crash, PDF sauvegardé/restauré en cible neuve | Recette Docker/Linux définie, **en attente d’exécution** | HTTPS, Windows, reboot, chiffrement, récupération des clés, rotation, charge et bascule à recevoir |

Les résultats détaillés des essais courants sont conservés localement dans les rapports ignorés du lot ; aucune capture privée, volume, secret ou journal de coordination n’est publié. Le workflow conserve uniquement les diagnostics navigateur fictifs en cas d’échec, trois jours.

La matrice `docs/http-test-map.json` relie chaque route construite à un test comportemental nommé ; cela ne remplace pas la réception de chaque critère métier. Le plan métier complet couvre encore référentiel/imports, identité approfondie, obligations/retours/dettes, tâches et production, CRM/onboarding, modèles/signature, échanges, données sociales/entreprises, pilotes fournisseurs documentés, exploitation et réception finale. Les comptes et portails réels demeurent la dernière phase en cabinet.
