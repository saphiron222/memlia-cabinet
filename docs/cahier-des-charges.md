# Memlia Cabinet — cahier des charges complet

Version 1, 17 octobre 2026. Le cadrage fonctionnel a été validé par Kevin. Le présent document rend cette décision exploitable pour la construction : il conserve le périmètre complet, précise les contrats, organise les lots et sépare les choix techniques du constructeur des décisions de produit déjà prises.

## 1. Objet et résultat attendu

Memlia Cabinet est le poste de pilotage partagé du cabinet d’expertise comptable : dossiers, échéances, production, tâches, relation client, documents et collectes. L’installation, la base métier, la GED, les profils des robots et les traitements internes résident dans l’environnement du cabinet. Les postes autorisés utilisent une même installation et un historique commun.

La référence fonctionnelle est Teradion, étudiée par site public, guides, vidéo, démonstrations, compte autorisé et artefacts du client. La référence graphique est le code Twenty figé au commit `e7743ba77003f3eab957cfcca8e760d383cde550`. Le logiciel n’utilise pas le backend privé de Teradion. Les règles non observables de l’original ne deviennent pas des faits inventés : les choix Memlia sont explicitement spécifiés puis testés.

Il ne s’agit pas d’un MVP. Les lots sont un ordre de réalisation, sans suppression du périmètre. Le produit ne peut être déclaré complet qu’après couverture des exigences applicables, réception locale, installation/restauration et recette finale des connecteurs.

### Références normatives

- [Exigences et critères détaillés](exigences.json) : 171 entrées, dont dix exclues et une extension IA à décider ; identifiants conservés pour la traçabilité.
- [Accès et protocole final des connecteurs](validation-connecteurs.md).
- [Référence de design et matériaux réutilisés](design-twenty.md).
- [Glossaire](../GLOSSARY.md), [sources primaires](sources.md), [index des preuves conservées](../evidence/README.md).

## 2. Périmètre et exclusions

Le produit couvre les familles du tableau ci-dessous, y compris les fonctions seulement annoncées et les variantes nécessitant une conception propre. Leur présence dans le cahier ne signifie pas qu’elles sont déjà construites ou que le fournisseur possède une API publique.

| Ensemble | Fonctions et sorties attendues |
| --- | --- |
| Cabinet | Dossiers, contacts, établissements, utilisateurs, équipes, sites, affectations, rôles, recherche, champs personnalisés et imports |
| Fiscal/social | TVA, IS, CVAE, CFE/IFER, taxe foncière, DAS2, DSN, IRPP, RCM 2777, IFU 2561 ; DES conserve une exigence distincte à détailler |
| Production | Bilans par année/famille, étapes, approbations, dépôt des comptes, obligations personnalisées, tâches et checklists |
| Organisation | Calendrier, vues de synthèse, alertes, temps, forfaits, charge, process ponctuels et suivis périodiques |
| Démarches | Services, habilitations, attestations, formalités INPI, détection de dossiers manquants, anomalies et provenance |
| Finances suivies | Dettes, apurements, règlements, rapprochements, restes à payer et ambiguïtés ; aucune assimilation d’un ordre au débit bancaire |
| Relation | CRM, contacts, qualification, risque, reprise de cabinet, onboarding, lettre de mission, modèles, signature, relances et historique |
| Documents/échanges | GED, pièces, versions, génération PDF, email, messagerie fiscale/sociale et accès client contrôlé |
| Compléments | LAB, Brevo, annuaire de facturation électronique et connexions autorisées ; l’application ne se déclare pas plateforme agréée |
| Exploitation | Installation, mises à jour, migrations, sauvegarde, restauration, audit, diagnostic, sécurité et supervision locale |

Allo, Polyacte, application mobile, MCP externe et coffre-fort de mots de passe produit sont exclus. Les secrets nécessaires aux robots restent protégés comme mécanisme interne. D’autres connecteurs téléphoniques ne sont pas ajoutés par la seule présence d’une carte chez le fournisseur. La facturation d’un abonnement SaaS ne définit pas le modèle de livraison local.

L’aide à l’utilisation est incluse. L’assistant IA local qui recherche et résume les dossiers est une extension proposée, isolée derrière une configuration désactivée par défaut ; ni moteur ni modèle matériel n’a été imposé par Kevin.

## 3. Acteurs, accès et confidentialité

Les acteurs sont utilisateur du cabinet, superviseur de dossier, responsable de cabinet, administrateur technique et interlocuteur client. Une personne peut cumuler des rôles métier, mais un privilège technique n’accorde pas implicitement la consultation des pièces métier.

Les autorisations sont définies par action et ressource : lecture, création, modification, affectation, approbation, transmission, export, paramétrage, gestion des modèles et consultation de l’audit. L’accès à une page et l’autorisation d’une commande sont distincts.

Pour une ressource dossier, un droit global applicable ou un droit local d’affectation peut autoriser l’action ; les restrictions de confidentialité et les conditions de l’action s’appliquent ensuite. Le cumul est explicite, sans refus implicite déduit d’une icône non cochée. Aucun rôle « Aucun rôle » ne donne un accès par accident. Les exceptions administratives sont des permissions explicites et auditées.

La confidentialité doit protéger liste, détail, recherche, compteurs, pièces, export, historique, notifications et assistant. Être abonné à une tâche ne donne aucun droit de consultation. Un changement d’affectation ou de permission prend effet lors de la commande suivante et lors de l’envoi d’une notification.

L’accès client a un périmètre propre : demandes, pièces et documents partagés avec cet interlocuteur, jamais l’ensemble de la GED ou les notes internes. Les accès distants sont configurés et authentifiés ; la base et les profils navigateur ne sont pas publiés directement.

## 4. Référentiel cabinet

### Dossiers et établissements

Un dossier possède identité, SIREN lorsque pertinent, établissements/SIRET, dates, forme juridique, capital, régimes, fréquence TVA, clôture, contacts, équipe et paramètres des obligations. SIREN/SIRET sont des chaînes ; les zéros initiaux et les identifiants spéciaux ne doivent pas être perdus. Un compte TI rattaché à une personne n’est pas identifié universellement par SIREN.

La fiche rassemble informations, affectations, notes, GED, échanges, onboarding, bilans, obligations, règlements et dettes. Le nom d’une colonne peut changer sans changer son identité. Une mise à jour de source ne remplace pas silencieusement une valeur validée manuellement : origine, date, version et règle de résolution sont visibles.

Créer/importer par fichier ou recherche d’entreprise est distinct d’une demande d’habilitation. L’import comporte aperçu, association des colonnes par nom, validation de chaque ligne, rapport d’erreurs et détection des doublons. Une relance d’import identique n’ajoute pas de doublon. Les lignes refusées restent identifiables.

### Contacts et utilisateurs

Contacts physiques et moraux ont des champs adaptés ; les données d’identité, adresses et informations fiscales sont limitées aux besoins autorisés. Les utilisateurs disposent de sessions et droits propres, d’équipes et d’affectations. Invitation, désactivation et récupération d’accès sont des actions séparées. Aucun compte partagé de production n’est une exigence de conception.

### Recherche et configuration

Recherche sur les objets autorisés, filtres combinables, tri stable, pagination, vues persistées et export du périmètre choisi. Les champs personnalisés couvrent texte court/long, nombre, date, booléen et liste de choix, dans l’en-tête, les informations ou les paramètres. Une modification de type exige une migration explicite des valeurs incompatibles.

## 5. Obligations fiscales et sociales

Une obligation lie dossier/contact/établissement, nature, période, échéance, source et responsable. Les axes sont séparés : préparation, validation locale, tentative de transmission, contrôle de plateforme, résultat destinataire et règlement. Le bouton « approuver » ne peut jamais produire une preuve de dépôt ou de paiement inventée.

Les montants sont des valeurs décimales exactes ; l’import conserve valeur brute et normalisée. Date civile et instant horodaté sont deux types différents. Inconnu, non applicable, non publié, non autorisé, incomplet et zéro confirmé ont des représentations distinctes.

| Nature | Traitement attendu et critères spécifiques |
| --- | --- |
| TVA | Grille dossier/période ; régime et fréquence ; préparation/néant/masquage motivé ; approbation ; tentative et retours ; pièce et règlement séparés |
| IS | Acomptes et solde avec période/clôture et références ; provenance des montants ; validation distincte des retours et du paiement |
| CVAE | Acomptes/solde et règles de campagne versionnées ; aucune règle réglementaire figée sans source datée |
| CFE/IFER | Tous avis/rôles/établissements et archives attendus ; contrôle de période et référence ; rapprochement de prélèvements avec raisons et ambiguïtés |
| Taxe foncière | Avis principal et suites, propriétés/établissements lorsque exposés ; conservation de toutes les pièces utiles, pas de première page seulement |
| DAS2 | Obligation liée à la clôture et à sa source ; saisie/preuve/retour distincts ; ne pas présenter une détection Pennylane comme un dépôt |
| DSN | Établissement, mois, tentative, destinataires, accusés et incidents ; enrichissement jedeclare distinct du logiciel qui produit la DSN |
| IRPP | Contact et année, étapes, prérempli et pièces ; le suivi annuel à neuf colonnes reste distinct du module fiscal et d’une émission réelle |
| RCM 2777 | Manuel/Pennylane/jedeclare avec provenance, tentative et version ; aucun transfert automatique de règles TVA |
| IFU 2561 | Agrégation annuelle reliée aux RCM sources ; changement de source signale la révision ; validation et dépôt sont distincts |
| DES | Nature explicitement couverte par une exigence ; procédure/contrat à acquérir avant adaptateur réel, sans inventer la démarche depuis une permission affichée |
| Personnalisées | Règle, population, échéance, groupe, type d’état, checklist et approbation ; occurrences identifiées de manière stable |

Les calculs déterministes devront avoir sources, campagne et exemples de référence indépendants. Lorsque le périmètre consiste à importer/suivre un montant externe, Memlia ne prétend pas réimplémenter le calcul fiscal officiel.

Les obligations archivées, masquées ou à néant conservent leur raison et leur historique. La régénération ne supprime pas une occurrence traitée. Une source contradictoire ouvre une anomalie avec résolution traçable.

## 6. Bilans, tâches et organisation

### Bilans et comptes annuels

Configuration des étapes par année et famille, ordre, types et responsables. Une étape peut exiger une permission de gestion et un rôle supplémentaire. Dupliquer une configuration ne recopie pas une validation ou un dépôt de l’année précédente. Les dates de liasse, assemblée et dépôt des comptes sont distinctes ; les pièces et reçus INPI/Infogreffe sont reliés lorsqu’ils existent.

### Tâches

Type, titre requis, description, urgence, étape, date civile, facturation, responsables, tags, relations dossier/prospect, pièces et checklists. Vues liste, Kanban, semaines et calendrier utilisent les mêmes objets et droits. Création, modification, déplacement, clôture et réouverture produisent un historique unique par opération réelle.

L’état effectivement enregistré est retourné après commande. La date acceptée doit être identique dans formulaire, fiche rechargée, liste, calendrier et export. Une commande rejouée ne crée pas de deuxième tâche ou événement. Les conflits de version demandent une résolution explicite au lieu d’écraser le dernier changement.

Les tâches récurrentes ont fréquence hebdomadaire, mensuelle, trimestrielle ou annuelle, règle de jour nominal/dernier jour, fuseau et horizon de génération borné. Le même calcul produit l’aperçu et les occurrences. Tester février, année bissextile, jour passé, changement de fréquence, heure d’été et panne. Modifier un modèle ne réécrit pas les réalisations déjà traitées.

### Process, suivi, charge et temps

Process ponctuel : lignes dossier/contact/utilisateur/libre, rattachement facultatif selon cible, plusieurs lignes par dossier si autorisé. Le changement de cible après saisie exige une migration explicite. Suivi récurrent : cible dossier/contact, fréquence propre à chaque colonne, valeurs par période et identité stable des colonnes.

Temps prévu/réalisé, forfaits, charge fixe et variable, affectations et capacité sont séparés. Un changement de taux ou forfait est versionné ; il ne réécrit pas silencieusement les périodes closes. Les tableaux de bord doivent exposer la période et la fraîcheur de leurs sources.

## 7. Relation client et documents

### CRM, risque et onboarding

Prospect, contact, société existante/future, source, honoraire, notes, hypothèses de travail, reprise de cabinet et ancien cabinet. Pipeline configurable ; conversion en dossier avec commande idempotente et trace de l’événement déclencheur. Le risque manuel et un score calculé sont distincts ; aucun classement automatique non défini n’est déduit d’un bouton.

Onboarding configurable : lettre signée, dates, interlocuteur, régime, identité, mandat, pièces initiales, paramétrage et blocages. Les deux libellés similaires d’accès fiscal sont distingués par identité/source ; l’habilitation observée n’est pas remplacée par une case manuelle sans provenance.

LAB : informations, justificatifs, niveau de vigilance, justification, révision et rappels ; décisions et preuves humaines conservées. Aucune décision réglementaire automatique n’est revendiquée sans sa règle et sa réception.

### Modèles, lettres et signature

Importer .docx, identifier variables connues/inconnues, données à compléter, lignes de missions et conditions. Un modèle générique ne déclenche pas obligatoirement une signature. Génération PDF locale, version des données et classement GED. Tout aperçu périmé rend l’envoi inactif jusqu’à régénération.

Lettre de mission : composition, aperçu, validation/gel, envoi, ouvert/signé/refusé/expiré selon contrat du prestataire, preuve et archivage. Les lots gèrent les réussites partielles. Modèle, version, PDF et preuve restent reliés. Signature ne vaut pas paiement.

### GED et échanges

Originaux conservés avec type, taille, empreinte, référence source, version, dossier et droits. Un nom de fichier n’est pas une identité. Le téléchargement vérifie la nature du contenu et détecte une page HTML de connexion à la place d’un PDF. Les pièces invalides restent en erreur et ne deviennent pas des documents définitifs.

Messageries fiscales/sociales : fils, messages, état de traitement, lu/non-lu, canal, dates et pièces séparés. L’état initial est acquis avant ouverture si visible. La politique de lecture précise les effets possibles de passage à lu ; aucune restauration n’est promise sans mécanisme établi. Répondre est une commande distincte, avec validation et journal adaptés.

Email et relances : expéditeur vérifié, modèle/version, destinataire, aperçu, résultat fournisseur et erreur. L’application ne transmet pas réellement pendant les tests fictifs. Brevo : segments et consentements, désinscriptions, campagnes/retours selon contrat ; la clé reste locale et n’est pas supposée active éternellement.

## 8. Collecteurs locaux et contrats fournisseurs

Les 17 collecteurs couvrent DGFiP CFE, taxe foncière, attestation, dettes, documents TVA/IS, messages et habilitations ; Urssaf attestations, échéanciers et messages ; INPI créations, actes et comptes ; retours jedeclare ; dossiers et données fiscales Pennylane.

L’interface commune reçoit référence de secret, cabinet, compte, portée dossier/contact/établissement, période, mode et point de reprise. Elle retourne statut, couverture demandée/observée, observations normalisées, originaux, événements, erreurs et dernier point durable. Statuts : complet, partiel, vide observé, non disponible, intervention requise ou échec. « Complet » est toujours relatif à une portée démontrée.

Un profil navigateur est verrouillé par compte. Après changement de contexte, le robot vérifie identité, activité, service et période. Engagement atomique des métadonnées et de la référence de pièce ; reprise seulement après conservation durable. Doublons par identité source/version, puis empreinte ; deux tentatives distinctes peuvent avoir les mêmes octets.

La lecture ne paie pas, n’envoie pas de déclaration, ne modifie pas les habilitations ni les associations de portefeuille pour élargir ses droits. MFA/CAPTCHA ou session expirée provoquent une intervention bornée. Une structure inconnue arrête le pilote concerné avec une preuve, au lieu d’essayer des clics aléatoires.

Les cinq démarches difficiles restent détaillées dans le corpus et la matrice d’accès : dette générale DGFiP actuelle, lecture fiscale, calendrier Urssaf par profil, portefeuille/messages Urssaf et export des retours jedeclare. Les sources connues et branches inconnues sont séparées. Le parcours PAS 2019 n’est pas universel ; 50 clients Urssaf par page ne signifie pas 50 messages ; la publicité d’une API n’est pas sa spécification.

Pennylane Firm API et partage fiscal sont deux connexions distinctes. Les évolutions Redshift/ClickHouse exigent un adaptateur versionné. DATA INPI public n’est pas l’espace privé de formalités. Pour jedeclare, l’API partenaire reste optionnelle et conditionnée par l’admission et un contrat technique acquis.

Les simulateurs produisent exactement le même contrat normalisé et des pièces fictives. Un mode réel non validé reste désactivé et affiché comme tel ; un simulateur ne se déguise jamais en compte connecté.

## 9. Design et accessibilité

Reprendre les sources MIT Twenty, thèmes clair/sombre intacts, Inter local 400/500/600/700, DM Mono, racine 13 px, pas de grille 4 px altérée, navigation 220 px/repli 48 px, lignes de grille 32 px et panneaux à partir de 400 px. Respecter les rayons et leur variante squircle, Display-P3, ombres, séparateurs et états.

Les listes, tableaux, Kanban, filtres, panneaux, formulaires, modales et menus adaptent les contenus métier. Les états chargement, vide, erreur, lecture seule, sélection, focus, conflit et succès existent. Tous les contrôles affichés doivent avoir un comportement réel ; une action non construite n’est pas présentée comme opérationnelle.

Navigation clavier, focus visible, noms accessibles, contraste, réduction des animations et zoom sont vérifiés. Les données sensibles ne sont pas rendues dans des éléments cachés pour simuler un masquage. La comparaison visuelle s’effectue à thème, police, zoom et dimensions identiques ; la seule copie de tokens n’est pas une preuve 1:1 du rendu final.

## 10. Architecture et installation

Choix du constructeur pour la réalisation initiale : TypeScript strict, React 19, Vite, Fastify 5 et PostgreSQL 17, sous forme de monolithe modulaire. Un contrat partagé versionné relie interface et serveur. Les règles métier n’habitent pas les composants visuels.

L’installation de référence est un service local sur machine/VM Linux du cabinet avec volumes persistants et interface HTTPS. Un cabinet sous Windows peut héberger cette VM selon son infrastructure. Les clients accèdent par navigateur ou lanceur ; aucun service SaaS Memlia n’est requis. L’installation n’expose pas directement PostgreSQL ou le répertoire des profils.

Un adaptateur PostgreSQL embarqué PGlite peut servir aux essais/développement autonomes. Il ne vaut pas réception de l’installation multiutilisateur PostgreSQL. La CI exerce aussi le vrai PostgreSQL. Le format des pièces et les migrations sont identiques aux interfaces métier retenues.

Le paquet d’installation doit fournir configuration minimale, initialisation sans mot de passe universel, contrôle des ports/volumes, démarrage/arrêt et diagnostic. Installation nouvelle et mise à jour d’une installation existante sont deux parcours testés. Les versions de schéma et d’application sont contrôlées ; pas de migration destructive silencieuse.

Sauvegarde cohérente base/GED/configuration, chiffrement selon l’infrastructure, rotation et copie contrôlée par le cabinet. Une sauvegarde n’est recevable qu’après restauration vérifiée. Profils et secrets ont une sauvegarde/restauration documentée distincte, sans export en clair dans les journaux.

## 11. Sécurité, intégrité et performance

Sessions individuelles révocables, cookies protégés en HTTPS, protections contre les requêtes intersites, limitation des tentatives et mots de passe dérivés par une fonction adaptée. Premier administrateur créé par une procédure d’initialisation limitée ; aucun utilisateur de démonstration actif par défaut en production.

Les commandes autorisées sont validées à l’entrée et leurs sorties à la sérialisation. Refus structurés : validation, session absente, droit insuffisant, ressource inaccessible, conflit de version, indisponibilité de source, pièce invalide, périmètre incomplet. Les messages de diagnostic ne révèlent ni secret ni existence d’un dossier inaccessible.

Une opération identifiée rejouée est idempotente. Historique, objet et relations restent cohérents après panne. La GED utilise des identifiants locaux contrôlés, sans traversée de chemin ni exécution de pièces. Les contenus de document/email/portail ne sont jamais des instructions privilégiées pour un assistant ou un robot.

Base de mesure proposée : 10 000 dossiers, 100 000 échéances actives, 20 utilisateurs concurrents, matériel documenté. Au 95e percentile après démarrage : grille filtrée/paginée < 1,5 s, recherche courante < 1 s, accusé d’action interne < 1 s. Les travaux lourds sont asynchrones et montrent leur progression. Ces objectifs restent à mesurer ; aucune performance n’est annoncée comme acquise par le cadrage.

## 12. Réception et définition de terminé

Les interfaces d’essai retenues par le cadrage sont les commandes métier/HTTP, le contrat de collecte, le stockage/récupération de pièces et les parcours utilisateurs. Les tests ont des valeurs attendues indépendantes de l’implémentation, utilisent des données fictives et exercent les interfaces publiques.

Chaque lot garde la chaîne exigence → code → test → résultat. Un test de sauvegarde compare commande, fiche rechargée et export. Un test de droit tente aussi l’accès direct, la recherche, la pièce et l’export. Un test de robot compare compte, dossier, période, original, couverture et reprise. Les cas de panne, doublon, correction, conflit de source, droit retiré, date courte et fichier invalide font partie de la réception locale.

Ordre imposé : contrats et modèle → constructions par lots → simulations et tests locaux → CI PostgreSQL et paquet d’installation → restauration/charge/fidélité visuelle → **toute dernière phase en cabinet sur les vrais portails**. Le détail des accès et preuves finales se trouve dans la matrice dédiée. Aucune tentative réelle de déclaration ou paiement n’est nécessaire pour provoquer artificiellement un cas de test.

Une fonction n’est terminée que si son comportement demandé existe, ses erreurs et droits sont vérifiés, sa documentation d’usage est juste et sa traçabilité est à jour. « Présent dans le menu », « simulé » et « validé en cabinet » ne sont pas des synonymes.

## 13. Organisation du dépôt et du développement

`apps/server` porte les interfaces HTTP, modules métier, stockage et travaux locaux ; `apps/web` porte l’interface ; `packages/contracts` porte les contrats canoniques ; `packages/ui` porte les briques Twenty réutilisées ; `deploy` porte l’installation ; `docs` porte les spécifications et la traçabilité.

Les captures et sources récupérées restent conservées dans le projet. L’archive locale `evidence/private` est exclue du dépôt public ; l’archive amont publique Twenty et les sources MIT réutilisées gardent version, empreinte et licence. Les dépendances installées sont reproduites par verrouillage, sans versionner `node_modules`.

Le dépôt ne contient pas de scaffolding de démonstration inutilisé, fichiers vides, inventaires de skills copiés ou prose de suivi répétée. Le glossaire décrit les concepts, les ADR justifient les choix coûteux à inverser, le cahier décrit le produit et les plans décrivent les lots. Les journaux temporaires sont ignorés ; les résultats utiles restent traçables.

### Ordre des lots, sans réduction de périmètre

1. Installation de développement, contrats, identité/droits, dossier/contact, tâche et audit persistés.
2. Base Twenty complète et interface connectée aux fonctions construites.
3. Obligations, retours, dettes/paiements, collecte normalisée et simulateurs des 17 collecteurs.
4. GED, pièces/version, import/export, recherche et configuration.
5. CRM/onboarding, modèles/lettres/signature, email et accès client.
6. Bilans, process/suivi, récurrence, calendrier, temps/charge et fonctions complémentaires.
7. Installation cabinet, sauvegarde/restauration, mise à jour, charge, sécurité et fidélité visuelle.
8. Recette des vrais connecteurs en cabinet, en dernier, puis levée des réserves.

Les fonctionnalités non encore réalisées restent explicitement dans le registre. La livraison d’un lot ne clôt pas le projet complet et ne change pas les exigences.
