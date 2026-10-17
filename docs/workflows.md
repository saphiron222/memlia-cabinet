# Travail, calendrier et notifications

Les tâches restent des `cabinet_records` de type `tache`. Le calendrier, la liste, le Kanban et les semaines interrogent la même sélection autorisée ; la projection calendrier fournit les libellés des dossiers de cette sélection. Les natures fiscales choisies conservent l'identité de l'obligation. Les filtres de personne, type et période sont conservés lors du changement de vue. La pagination signale une période partielle. Un déplacement utilise la transition canonique, garde les relations et la date et produit un événement d'historique. Le sélecteur d'étape offre l'alternative clavier au glisser-déposer. Les modèles de type possèdent une couleur Twenty, des étapes ordonnées et une seule finale ; les références utilisées ne sont pas supprimées ni changées en finale implicitement.

## Récurrence civile et provenance

`previewOccurrences` est le calcul commun de l'aperçu et du JobRunner de génération : dates civiles, ancrage nominal indépendant de chaque résultat, dernier jour du mois, semaine, trimestre, année. Le jour 31 produit le 28 février 2027 et le 29 février 2028. UTC sert uniquement de support d'arithmétique grégorienne. L'heure des rappels est évaluée dans le fuseau configuré du cabinet.

Une occurrence est identifiée par modèle, dossier et période (semaine commençant le lundi, mois, trimestre ou année). Une nouvelle version de règle ne réécrit pas une occurrence déjà produite. Le modèle et la checklist sont figés dans l'entrée du traitement ; chaque lot conserve son point de reprise. La provenance `generated` distingue les champs générés des saisies manuelles. Le dernier résultat d'un modèle peut être retrouvé après fermeture de l'éditeur. Aucun reçu de télédéclaration n'est produit.

## Travail partagé et modèles

`/workflows/targets/:id` et sa commande versionnée servent les tâches et les obligations existantes, notamment TVA/DAS2. Une instance de checklist possède son identité, sa version de modèle et ses valeurs propres. Les anciennes checklists de tâches sont lues sans effacement. Une modification du modèle touche les futures instances ; la fusion explicite n'ajoute que les identités jamais vues et préserve cases cochées, suppressions, libellés et ordre. Une tâche terminée conserve sa checklist. Une version périmée rend 409 ; une opération rejouée ne crée pas de nouvel événement.

Les commentaires de ce service ont l'audience `internal`. Mentions et abonnements ne donnent aucun droit de lecture. Le service contrôle l'objet actuel et les anciens périmètres du travail avant lecture ou rejeu. Les pièces sont des identités GED ; la recherche et le téléchargement tiennent compte des tâches confidentielles qui les utilisent. Le travail commun n'écrit pas dans la déclaration fiscale approuvée.

La reprise annonce `memlia-checklists-1` : CSV UTF-8 avec séparateur `;` ou XLSX sans formule. Les colonnes mappées sont `modelId`, `name`, `targetKinds` (liste séparée par virgules), `itemId`, `label`, `order`. Les identifiants sont des UUID stables, les ordres sont des entiers. L'ImportParser existant applique les contrôles de fichier ; l'aperçu expose erreurs et colonnes non reprises, puis l'opérateur valide explicitement les modèles. Une identité existante produit une nouvelle version. Aucun format privé Teradion n'est présumé.

## Notifications et rappels

La boîte de réception propose lecture, masquage et préférences persistées pour mentions, abonnements et rappels dans l'application. Les droits actuels du destinataire sont vérifiés à la préparation et à la restitution, avant les compteurs. Le titre est relu sur l'objet autorisé ; les commentaires restent internes.

Le rappel conserve événement (fréquence ou échéance à cette date), fréquence, heure, période, objets, destinataires et version du contenu. Le planificateur vérifie le jour civil courant après l'heure choisie, toutes les trente secondes. Une occurrence déjà engagée garde son job et sa clé unique ; les doublons sont neutralisés à la notification. Un arrêt reprend les jobs engagés au dernier point durable ; les journées où aucun traitement n'a été engagé ne sont pas rejouées rétroactivement. Le suivi par modèle présente date, version, état, tentatives et journal. Le JobRunner existant réalise au plus trois tentatives, conserve l'échec et participe à l'arrêt/maintenance. Les horloges et destinataires des recettes sont fictifs. Aucun email n'est envoyé.

Les charges restent bornées : cent éléments de checklist, deux cents commentaires et cent abonnés par travail, 400 Kio pour une version de travail ; une reprise traite au plus vingt modèles et 400 Kio de résultat ; les pages de modèles et d'événements de calendrier comportent au plus deux cents éléments, les notifications cent, le suivi de rappels cinquante. Les producteurs parcourent les pages, sans masquer les modèles suivants. Les refus de capacité restent explicites. Le journal JobRunner reste limité à 500 événements.

## Sortie, restauration et réception

La migration additive 8 introduit modèles/historiques, travail/événements, notifications/préférences et rapports de reprise. La sauvegarde restaure ces tables. La sortie complète exporte également ces entités avec identifiants, versions et relations, par pages bornées et contrôlées à nouveau au téléchargement. Les préférences et notifications sont celles du demandeur autorisé.

| Critères                                     | Recette locale couvrante                                                                                     | Portion ultérieure                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| F-TACHES-AC-01, PAR-042, PAR-066             | HTTP étapes finales/conflits ; navigateur création, changement de type, clôture/réouverture et quatre vues   | Qualification globale Tasks11/12                            |
| F-TACHES-AC-02, PAR-043                      | Dates littérales, reprise et versions mensuelles/hebdomadaires ; aperçu/génération navigateur                | Charge globale Task11                                       |
| F-TACHES-AC-03, INT-SC-08                    | Mentions/abonnements, droits retirés, compteurs, audience interne                                            | Portail client et mail Task9                                |
| F-CHECKLIST-AC-01–03, PAR-067, REA-SC-07/08  | Instances tâche/TVA/DAS2, ordre/suppression/fusion/conflit, reprise CSV et modèles réels                     | Formats privés non présumés                                 |
| F-CALENDRIER-AC-01–03, PAR-028               | Même tâche/obligation, natures sélectionnées, dates/dossier/état, sélection commune                          | Occurrences personnalisées Task4                            |
| F-ALERTS-AC-01–03, PAR-054                   | Heure cabinet, version/résultat, unicité/restart, boîte de réception/préférences navigateur                  | Canaux mail réels Task9                                     |
| PUB-016-S1                                   | Relation fiscale/tâche idempotente                                                                           | Aucune suppression de périmètre                             |
| PUB-016-S2                                   | Mention autorisée, temps prévu et lien permanent de tâche                                                    | Saisies de temps réalisé et rapports Task5                  |
| PAR-006, PAR-020 / F-TVA-AC-03, F-DAS2-AC-03 | Checklist/commentaires/pièces au même ID, rechargement/changement d'onglet, retrait de droits navigateur     | Email contextualisé Task9 ; fournisseurs Task10             |
| F-STATES-AC-01–03, AUD-012                   | Chargement/vide/refus/erreur et reprise, valeurs inconnues explicites, aucun succès avant écriture confirmée | Toutes pages hors Task3 et qualification globale Tasks11/12 |

Les reçus exacts locaux sont consignés dans le rapport privé du lot. Aucune CI Task3 ni validation en cabinet n'est déclarée ici. La comparaison consolidée Twenty, le zoom/contraste/a11y exhaustifs restent Task12 ; les grilles/fiches du lot sont inspectées sur captures réelles desktop et 900 px, thèmes clair/sombre et parcours clavier. Le navigateur de recette utilise la locale native en-US pour ses contrôles de date ; les valeurs civiles ISO ne sont pas converties.
