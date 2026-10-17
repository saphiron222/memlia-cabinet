# Interface Memlia — Plane, Twenty et cal.diy

Direction demandée par Kevin le 17 octobre 2026, après rejet du rendu intermédiaire. Le produit est une application web auto-hébergée au cabinet, utilisée dans un navigateur. Le périmètre fonctionnel Teradion reste celui du cahier des charges. La refonte est à construire et à recevoir ; les captures antérieures ne valent pas acceptation de cette direction.

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

Le sous-ensemble Twenty existant reste tracé dans [sa provenance](design-twenty.md). Sa présence ne prouve pas une ressemblance de l’application entière. Les modalités de reprise des sources Plane et cal.diy doivent suivre le relevé des fichiers et licences acquis, sans les réétiqueter sous une autre licence.

Le [relevé des sources](recherche-design-plane-cal.md) donne les chemins exacts, dimensions, tokens, dépendances et frontières de licence. La [matrice Teradion → interface](matrice-interface-teradion.md) couvre les 66 familles et les parcours à préserver.

## Couleur, densité et hiérarchie

Le rendu monochrome actuel est rejeté. Reprendre la palette et les surfaces de Plane depuis ses sources réelles, avec accent visible pour les actions et indication sémantique des statuts, priorités et alertes. Les couleurs renseignent le travail ; elles ne remplacent jamais un libellé ou une icône accessible. Une somme inconnue n’a pas la présentation d’un zéro confirmé.

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
