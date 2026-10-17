# Lire et vérifier le registre fonctionnel

[exigences.json](exigences.json) version 2 est le registre produit. Il conserve les **171 identifiants**, les **66 familles**, les **160 exigences requises**, les **10 exclusions** et l'**extension proposée** du cadrage accepté. Le [cahier des charges](cahier-des-charges.md) reste l'autorité sur le périmètre ; les schémas d'exécution vivent dans `packages/contracts`.

Le registre comporte trois niveaux complémentaires :

- `commonRules` factorise les règles de droits, persistance, dates, preuves, pièces, reprise et exploitation ; elles s'appliquent aux opérations pertinentes.
- `families[].acceptanceCriteria` donne trois résultats métier numérotés par famille. `limits` conserve seulement les frontières qui conditionnent la conception ou la validation réelle.
- `requirements[].acceptance` décrit le résultat particulier attendu pour l'identifiant. `familyCriteria` le rattache aux critères partagés ; ce rattachement ne signifie pas qu'un test unique vérifie toute la famille.

Ces critères sont des **spécifications Memlia**. `sourceIds` conserve sans modification la justification dans le corpus de recherche ; ce ne sont ni des tests réussis, ni l'affirmation d'une règle serveur Teradion. Les répétitions d'audit et questions historiques restent dans le corpus privé, pas dans le registre produit.

Un test cite l'identifiant d'exigence et le ou les critères exercés, prépare un état et une action sur une interface publique, puis vérifie une valeur attendue indépendante de l'implémentation. Exemples : date identique après commande/rechargement/export ; correction rejetée conservant l'initiale acceptée ; seconde collecte sans second règlement ; retrait de droit bloquant aussi pièce et export. Ajouter les cas limites pertinents à l'opération plutôt qu'une copie générique de chaque test dans chaque famille.

`implementation.files` et `implementation.tests` reçoivent les chemins réellement concernés. Ne changer `implementation.status` qu'avec une réalisation et des preuves identifiables ; tous les états restent `planned` à cette révision documentaire. La construction, les tests locaux, la CI et la recette de comptes réels sont des preuves distinctes. Le marqueur de phase finale ne signifie pas qu'une fonction interne exige un accès à une administration.

Les dix exclusions sont conservées pour contrôler leur absence, sans obligation de les développer. `PUB-002-S1`, assistant dossier local, reste proposée et désactivée ; les critères conditionnels de cette extension n'empêchent pas la réception de l'aide d'usage incluse. Les anciens besoins d'abonnement SaaS sont traduits en information sur l'installation et ses capacités, sans inventer de modèle commercial ni de prélèvement.

Avant de recevoir un lot, vérifier les résultats propres aux exigences visées **et** les règles transversales applicables. Un menu, une fixture ou un test générique ne suffit pas à marquer une fonction terminée. Les adaptateurs simulés vérifient leurs contrats et reprises sur données fictives ; leurs accès, portées et preuves réelles sont validés seulement à la dernière phase en cabinet, suivant [la matrice des connecteurs](validation-connecteurs.md).
