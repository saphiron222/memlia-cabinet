# Interface Memlia — Plane, Twenty et cal.diy

Direction demandée par Kevin le 17 octobre 2026, après rejet du rendu intermédiaire. Le produit est une application web auto-hébergée au cabinet, utilisée dans un navigateur. Le périmètre fonctionnel Teradion reste celui du cahier des charges. Le lot Task13 refond les surfaces actuellement montées ; sa revue indépendante et ses deux vérifications CI sont reçues sur `d1dc0d2`. La réception consolidée des futures pages reste au lot 12. Les captures antérieures ne valent pas acceptation de cette direction.

## Une référence principale, des rôles précis

| Surface | Référence principale | Application à Memlia |
| --- | --- | --- |
| Enveloppe de l’application | Plane | Navigation du cabinet et des espaces, groupes, repli, en-tête, fil d’Ariane, organisation des vues et barres d’actions |
| Listes de travail et Kanban | Plane | Vues, regroupements, filtres compacts, sélection, statuts, responsables, menus contextuels et ouverture d’une fiche |
| Grilles et fiches structurées | Twenty, dans l’enveloppe Plane | Colonnes lisibles, cellules typées, propriétés, relations, panneaux et modifications contextuelles |
| Calendrier et disponibilité | cal.diy | Navigation des dates, lisibilité des créneaux et paramètres de disponibilité ; dates métier conservées |
| Formulaires et paramètres | cal.diy et Plane | Navigation secondaire, sections courtes, libellés, validation proche du champ, actions persistantes |
| Contenu et déroulé métier | Teradion | Espaces, objets, données, étapes, actions, états et liens du périmètre validé |

Cette priorité évite trois styles concurrents. Une page garde la même navigation, le même système de couleurs, les mêmes commandes et la même hiérarchie que les autres. Le contenu détermine la composition : une grille de TVA, une messagerie et un écran de disponibilité ne deviennent pas un même formulaire générique.

## Sources complètes et réutilisation réelle

Les dépôts officiels complets sont conservés comme références figées, pas seulement quelques boutons :

- [Plane](https://github.com/makeplane/plane), révision `879ce8b5c6b4fe21efff4789a7062747f46d6383`.
- [Twenty](https://github.com/twentyhq/twenty), révision `e7743ba77003f3eab957cfcca8e760d383cde550`.
- [cal.diy](https://github.com/calcom/cal.diy), révision `54343aa685ae8f33159d2f485ec4a57bad5c574a`.

Pour chaque reprise, conserver chemin, révision ou intégrité du paquet, licence, empreinte et adaptations. Les fichiers applicatifs ne sont pas supposés MIT parce qu’un autre paquet du dépôt l’est. Les marques des références ne deviennent pas la marque Memlia. Les archives et inventaires volumineux restent dans les références locales ignorées ; les notices des fichiers effectivement distribués accompagnent le produit.

Le frontend complet d’une référence dépend de son routage, de ses stores, de son authentification et de son API. Il est conservé intégralement ; les surfaces retenues sont étudiées puis adaptées aux contrats Memlia. Copier les trois applications et conserver leurs serveurs créerait des modèles métier concurrents. Les dossiers, permissions, pièces, historiques et opérations Memlia gardent leurs identités canoniques.

La demande humaine de reprise directe s’applique à chaque famille de composants, pas seulement à la navigation. Les composants convenant au besoin conservent leur structure, rendu et interactions ; les adaptations métier partent de leur vraie source et sont explicitées. La [carte exhaustive des surfaces construites](interface-source-map.md) relie chaque page et ses sous-écrans aux templates effectivement intégrés et aux fournisseurs canoniques. Le [manifeste de reprise](design-interface-provenance.json) distingue copies inchangées, extraits et ports structurels, avec empreintes originales et adaptées.

La distribution compatible AGPL du frontend combiné et de son code propre intégré est autorisée. Son [périmètre concret et l’accès au source correspondant](frontend-licensing.md) accompagnent chaque build ; aucune licence globale du backend n’est déduite de l’intégration frontend. Les notices MIT/OFL et la permission additionnelle Twenty restent intactes.

Le sous-ensemble Twenty existant reste tracé dans [sa provenance](design-twenty.md). Sa présence ne prouve pas une ressemblance de l’application entière. Les modalités de reprise des sources Plane et cal.diy doivent suivre le relevé des fichiers et licences acquis, sans les réétiqueter sous une autre licence.

Le [relevé des sources](recherche-design-plane-cal.md) donne les chemins exacts, dimensions, tokens, dépendances et frontières de licence. La [matrice Teradion → interface](matrice-interface-teradion.md) couvre les 66 familles et les parcours à préserver.

## Couleur, densité et hiérarchie

Le premier rendu monochrome a été rejeté. Reprendre la palette et les surfaces de Plane depuis ses sources réelles, avec accent visible pour les actions et indication sémantique des statuts, priorités et alertes. Les couleurs renseignent le travail ; elles ne remplacent jamais un libellé ou une icône accessible. Une somme inconnue n’a pas la présentation d’un zéro confirmé.

La navigation, les tableaux et les panneaux suivent les proportions de leurs références retenues. La taille de police, les interlignes, les espacements, les bordures, les rayons et les états sont mesurés et documentés. Ne pas ajouter arbitrairement une grande police, un fond décoratif ou un empilement de cartes pour produire un effet de refonte. Les polices et ressources nécessaires sont servies localement.

Les filtres courants restent compacts. Les réglages avancés et actions rares s’ouvrent au bon endroit. Les propriétés séparent visuellement leur nom et leur valeur. Les tables disposent de véritables en-têtes, alignements, largeurs, survols, sélections, défilement et actions de ligne ; les montants et dates sont immédiatement comparables. Les grands formulaires sont divisés selon la tâche, avec validation et résumé utiles, sans masquer une fonction derrière un onglet vide.

## Teradion, page par page

La matrice des espaces relie chaque famille du catalogue à sa page ou son panneau, au parcours Teradion conservé et au motif graphique retenu. Elle cite le guide, le site, la démonstration ou l’observation correspondante. Une information documentée n’est pas présentée comme une interaction exécutée. Les pages encore vides ou dépendantes d’une connexion sont identifiées.

Chaque réalisation doit conserver :

1. Le point d’entrée et le contexte : cabinet, dossier, personne, nature, campagne et période.
2. Les données et actions disponibles, y compris relations, pièces, recherche et export.
3. Le déroulé, ses conditions, décisions, conflits et possibilités de reprise.
4. Les droits et distinctions métier : préparation, approbation locale, observation fournisseur, dépôt et paiement restent différents.
5. Les états utiles : chargement, vide, refus, indisponibilité, erreur, lecture seule, sélection et succès.

Le compte Teradion et les preuves privées sont des sources d’observation, jamais un backend de Memlia. Les essais sur les administrations réelles restent la dernière phase en cabinet. Les exclusions et l’extension IA proposée ne changent pas avec le design.

La consultation interne en lecture du 17 octobre confirme notamment une **matrice TVA dossier × jours du mois**, avec année/mois, périmètre, filtres, densité et choix de référence entre date limite et fin de période. Ouvrir une cellule conserve ce contexte et présente le détail dans un panneau ou une fenêtre structurée : propriétés, état de récupération de la source, documents, checklist et commentaires internes. L’onglet source « Équipe » contient ces commentaires ; il ne justifie pas d’inventer une liste d’affectations. Les actions locales restent identifiées séparément des dépôts réels. La refonte doit reproduire cette composition de travail, pas remplacer toutes les natures fiscales par une liste et un formulaire communs.

## Réception exigée

La refonte commence par les surfaces déjà construites : enveloppe, dossiers/contacts, fiscalité, tâches, production, calendrier, documents/collectes, reprise et administration. Les lots métier suivants utilisent immédiatement ces compositions ; on ne reporte pas toute la qualité visuelle à la fin.

Comparer les références et Memlia dans un environnement documenté : même navigateur, dimensions, thème, zoom et polices chargées. Distinguer une capture de l’application originale, un scénario de composant isolé et une composition Memlia. Aucun scénario artificiel ne prouve le rendu complet d’une référence.

Inspecter les écrans réellement remplis, en clair et sombre, au format bureau et à 900 px, ainsi que les débordements, menus, panneaux et commandes. Tester les parcours existants et la persistance après modification. Vérifier clavier, focus conservé pendant la saisie, noms accessibles, contraste, zoom et réduction des animations. Les images sont conservées en privé avec leur provenance ; les seules empreintes de sources ou un build réussi ne clôturent pas cette réception.

L’identifiant historique `AUD-008` et la famille `F-TWENTY` sont conservés pour la traçabilité, avec leurs critères actualisés vers cette direction. Aucune exigence fonctionnelle n’est supprimée.

## Réception des surfaces construites — Task13

Le candidat fonctionnel `d1dc0d261abb2add4368014d525e28ca37043fdd` est reçu après revue indépendante, trois passes de correction et contre-relecture, sans constat critique ou important ouvert sur ce lot. La [CI de branche](https://github.com/saphiron222/memlia-cabinet/actions/runs/39077004305) et la [CI de pull request](https://github.com/saphiron222/memlia-cabinet/actions/runs/39077007429) sont réussies. Chaque exécution comporte 183 tests PGlite réussis et 3 cas réservés à PostgreSQL ignorés, 186 tests PostgreSQL 17 réussis et 40 parcours Chromium réussis. Contrôles, build, smoke compilé, test du contexte privé et cycle réel du conteneur passent. Le réglage PostgreSQL observé est JIT `on` ; cela ne prouve pas à lui seul la disponibilité du compilateur JIT distant.

Les surfaces montées sont reliées aux vrais templates dans la carte de reprise : navigation Plane, grilles/fiches Twenty, calendriers/formulaires cal.diy et primitives Propel 0.7.3. Les contrôles couvrent repli à 0 px et en-tête de 44 px, filtres/pagination fiscale y compris réponses retardées/double action, références de dates et CSV, panneaux/focus, calendrier annuel et semaines composés depuis leurs sources, droits/lecture seule et liens persistants. Le clic annuel Production retrouve directement sa fiche canonique, son année et sa configuration gelée après rechargement ; les tâches et obligations ordinaires conservent leur inspecteur annuel. Les 27 tests du fournisseur fiscal changé passent aussi localement sur PGlite et PostgreSQL 17 ; ces reçus ciblés restent distincts du passage CI complet.

L’archive frontend locale `a43dfb9739e3f9f97f11da8152c87edc3a44834d0a01b89f04473a3041041632` contient 8 449 fichiers inventoriés, dont 1 620 sources Propel récupérées. 198 fichiers courants concordent ; une extraction et reconstruction isolées produisent 74 actifs identiques. Le build alternatif des sources Propel éditables est vérifié séparément avec modification fictive ; il utilise l’adaptateur Vite documenté et ne reproduit pas le build tsdown amont absent. Les frontières communes de copie excluent données privées et liens. Le paquet Docker apporte explicitement les quatre documents normatifs nécessaires. Sa recette vérifie 13 ressources anonymes, les licences, le manifeste et les documents de l’archive : SHA-256 `35fecdd2c7276850221916b963a6d033c84f9e19f043cbfadb1d239a0870c1f6` pour l’image du passage de branche, `d61a384017fc2f685be99785c24a7d075d1eddc691189198afda2c249e0300a7` pour celui de la pull request. Chaque reçu identifie son propre artefact ; les métadonnées tar ne sont pas déclarées déterministes. Le cycle réel vérifie initialisation, rôle limité/base non publiée, recréation/crash, PDF et sauvegarde/restauration neuve, puis refus non destructif d’une seconde restauration.

Les captures du produit compilé couvrent 1440 × 1000 et 900 × 1000, clair/sombre, grilles/panneaux/calendriers/compte/repli et états utiles. La dernière série de régression mesure les URL réellement chargées `index-DYuyPa42.js` et `index-mONE0zKh.css` ; les anciennes séries et leurs limites de métadonnées restent conservées. Les références originales effectivement rendues sont des fixtures de navigation/primitives et des pages observées, pas les applications complètes Plane/cal. Aucune comparaison pixel complète n’est déduite des seuls imports ou empreintes.

F-TWENTY-AC-01 : reprise et raccordements des surfaces actuelles construits, revus et vérifiés en CI ; chaque futur lot étend la carte et ces mêmes composants. AC-02 : comparaison sur les références effectivement disponibles et captures remplies documentée ; réception consolidée de toutes les futures pages au lot 12. AC-03 : clavier/focus/retour/états et 900 px exercés, qualification complète du contraste, zoom, réduction du mouvement et des contrôles intérieurs au lot 12. Le JavaScript principal mesure 922,12 kB (261,89 kB gzip), le CSS 426,21 kB (104,69 kB gzip) ; l’avertissement 500 kB est conservé et les mesures/optimisations finales appartiennent aux lots 11/12. Cette réception ne déclare ni les 160 exigences terminées, ni la qualification globale d’exploitation/accessibilité, ni les vrais portails validés en cabinet.
