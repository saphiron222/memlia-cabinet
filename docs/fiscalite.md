# Fiscalité — contrats locaux et réception

Les douze natures `TVA`, `IS`, `CVAE`, `CFE_IFER`, `TF`, `DAS2`, `DSN`, `IRPP`, `RCM_2777`, `IFU_2561`, `DES`, `CUSTOM` utilisent l’identité canonique de l’obligation dans `cabinet_records`. Le contrat public est `packages/contracts/src/fiscal.ts` ; les vues et résultats sont dans `fiscal-view.ts`. Aucun portail, dépôt, envoi ou paiement réel n’est exécuté. Les observations fournisseur saisies par HTTP sont déclarées, jamais attestées comme provenant d’un pilote acquis.

## Fournisseurs internes et prochaines intégrations

- `createFiscal`, `commandFiscal`, `fiscalDetail` et `fiscalTimeline` dans `apps/server/src/fiscal/service.ts` utilisent une connexion transactionnelle, un utilisateur courant et un instant. Le writer commun garde versions, opération rejouée, historique et validation des droits ; le chemin générique de modification refuse les obligations fiscales. Les commandes portent `operationId` et `expectedVersion`. Les commandes métier ne doivent pas écrire directement les tables.
- `deriveFiscalSituation(initialAmount, timeline)` sépare préparation, approbation cabinet, validation client IRPP, version de déclaration, tentative, retours, version acceptée applicable, montants, dette, apurement, règlement et candidat bancaire. La règle d’acceptation est explicitement `all-declared-recipients-accepted-no-platform-rejection/v1`. Une correction rejetée laisse l’ancienne version acceptée applicable. Les retours restent dans la chronologie, même contradictoires.
- Les pièces utilisent `DocumentStore`. Les commandes `evidence`, `notice`, `client_validation`, tentatives et observations gardent les identités GED. Les liens au contact IRPP, aux RCM sources et aux tâches propagent les droits courants jusque dans recherche, historique, GED et export. Les anciennes références ne sont pas supprimées lors d’une révision.
- Task3 intègre son service commun checklist/commentaires dans `FiscalDetail` (onglet Travail interne), en conservant `detail.record.id`. La commande fiscale `link_task` relie une tâche existante du même dossier ; elle n’est pas un service de création de tâche. Réutiliser `detail.capabilities.actions`, les droits historiques et le writer commun ; aucune seconde identité ni file fiscale.
- Task9 doit fournir le modèle de relance depuis le même contexte autorisé dossier/obligation/période/montant/destinataire. Aucune action email factice n’est présentée comme réalisée ici.
- Task10 doit transformer uniquement des contrats acquis en événements canoniques et brancher le contrôle de capacité réel. `realTransmission` et `certifiedExport` sont actuellement toujours `false`. `verifiedSupplier` n’est jamais acquis par une saisie HTTP ou une simulation. Les chemins/colonnes/retours non acquis ne sont pas déduits du modèle local.

## Valeurs et périodes

Les montants sont des chaînes décimales canoniques, calculés en centimes `bigint` ; la présentation française ajoute séparateurs et euro sans conversion flottante. Un paiement acquis sans montant rend le total et le reste indéterminés. Ordre, validation administrative, présentation et débit confirmé ne sont pas équivalents. Remises/dégrèvements/imputations réduisent la dette, sans augmenter les paiements. L’identité externe source/compte/référence déduplique les collectes, tout en conservant les versions et en refusant une affectation ambiguë à deux obligations.

Les observations brut, net, estimation, CA de référence et régime conservent leurs provenances. Une contradiction garde chaque observation et demande une résolution motivée ; une nouvelle contradiction réouvre le contrôle. Les projections IS/CVAE et CSV ne choisissent pas silencieusement un montant concurrent. Le montant suivi n’est pas une liquidation officielle. Les valeurs brutes approximatives et dates sans fuseau restent qualifiées comme telles.

Génération locale : fréquence TVA du dossier, exercice IS décalé (quatre acomptes et solde), trois occurrences CVAE, DSN/RCM/DES mensuelles, IRPP/IFU annuelles par année civile, fréquence CUSTOM explicite. Aucun avis CFE/TF n’est inventé depuis la campagne. Clé d’occurrence stable, version du profil et règle datée ; pas de date limite universelle déduite. Échéance observée, date de campagne sourcée et cible interne sont distinctes.

IFU : règle locale `compatible-income-sum/1`, campagne/source/date/statut explicites. Les bénéficiaires, catégories, montants individuels et douze mois sont contrôlés ; manquant, incomplet, doublon et zéro confirmé sont distincts. Une proposition conserve les versions RCM ; un changement signale une révision, sans changer la pièce déjà générée. La pièce GED est une préparation texte non certifiée, pas un format fiscal EDI. Un contrat en brouillon ou une proposition incomplète interdit de constater une tentative IFU.

Fraîcheur : `deriveSourceFreshness` compare la véritable date de mise à jour avec une politique opérationnelle versionnée, datée et bornée, au calendrier du cabinet. L’heure de collecte ne rajeunit pas la source. Absence de date/politique, couverture partielle ou saisie manuelle restent indéterminées. Une fixture peut démontrer le calcul récent/ancien sans devenir une source fournisseur vérifiée. Accueil, détail et CSV appliquent le même contrat.

## Sortie et sauvegarde

Migration additive **7** : `cabinet_fiscal_events`, index unique des occurrences et type de ligne fiscale dans les sorties préparées. Elle ne donne aucun droit `transmit` et n’active pas le module chez les installations existantes. Un cabinet neuf reçoit le module et les droits administrateur explicites. Retirer le module garde la consultation mais interdit les commandes, y compris leur rejeu.

La sortie JSON complète contient `fiscalEvents` en plus des objets et pièces existants. Les sauvegardes PostgreSQL17 + GED incluent ces données ; restauration en cible neuve, contrôles d’intégrité et limites communes inchangés. Le plafond JSON par partie reste 8 Mio.

Les lots d’avis CFE/TF utilisent **TAR USTAR** (`application/x-tar`, `memlia-avis-originaux.tar`), préparés par Exports/JobRunner existants. Le filtre année/bien choisit l’avis puis toutes ses suites. La sélection et les versions sont figées, les métadonnées paginées et bornées ; un original GED de 10 Mio maximum est matérialisé à la fois, émis en blocs de 64 Kio hors transaction réseau. Aucun duplicata des originaux ni deuxième exporter.

Le TAR contient `manifest/record-N.json`, `manifest/fiscal-N.json`, `originals/<identité>-<nom-nettoyé>`, `reports/N.json`, `reports/final.json`. Les manifestes relient avis, originaux et suites ; les rapports donnent version, empreinte, chemin ou erreur et bilan final. Un nom source ne devient jamais un chemin hôte. Un manque/corruption découvert au téléchargement reste au rapport final. Un retrait de droits ou une panne interrompt le flux ; le statut signale la restitution interrompue et permet de recommencer. La préparation « terminée » ne prouve pas que chaque original est encore disponible.

## Matrice de réception métier

Les preuves locales sont les scénarios nommés de `apps/server/test/fiscal.test.ts`, `apps/server/test/backup.test.ts` et `tests/e2e/fiscal.spec.ts`. La CI de ce lot et la validation en cabinet restent distinctes ; la qualification complète de charge, exploitation et fidélité Twenty appartient aux Tasks11/12.

| Critères | Portion locale construite et exercée | Restant obligatoire hors Task2 |
| --- | --- | --- |
| F-TVA-AC-01 | Grille/filtres communs, profil/période, source et cadence ; CSV mêmes valeurs | Pilotes acquis Task10 ; qualification11/12 |
| F-TVA-AC-02 | Préparation/approbation/tentative/retours indépendants ; rejet DGFiP/banque en attente | Retours acquis Task10 |
| F-TVA-AC-03 | Identité stable, détail, pièces, liens de tâche et checklist/commentaires communs persistés ; recette locale Task3 | Relance modélisée Task9 ; qualification Tasks11/12 |
| F-IS-AC-01 | Exercice décalé et génération stable acomptes/solde | Qualification11/12 |
| F-IS-AC-02 | Brut/net/estimation/inconnu, chaînes exactes en grille/détail/CSV | Sources acquises Task10 |
| F-IS-AC-03 | Initiale acceptée/correctif rejeté, preuves et classement motivé | Retours acquis Task10 |
| F-CVAE-AC-01 | CA de référence, campagne, solde/acomptes et provenance | Sources acquises Task10 |
| F-CVAE-AC-02 | Saisie/observations concurrentes/classement conservés | Sources acquises Task10 |
| F-CVAE-AC-03 | Aucun calcul fiscal sans règle ; montant à déterminer explicite | Acquisition d’une règle fiscale avant toute activation |
| F-CFE-AC-01 | Avis distincts, rôle/établissement/année/référence/montant/date/original | Acquisition réelle Task10 |
| F-CFE-AC-02 | Prélèvement/rapprochement/paiement distincts ; quatre causes de candidat | Source bancaire acquise Task10 |
| F-CFE-AC-03 | Original et TAR filtré ; manquants/corruptions après préparation rapportés | Qualification charge11/12 |
| F-FONCIER-AC-01 | Avis/année/biens/communes et références distinctes | Acquisition réelle Task10 |
| F-FONCIER-AC-02 | Principal/suites, manque explicite et métadonnées | Acquisition réelle Task10 |
| F-FONCIER-AC-03 | Filtre année/bien → toutes suites, noms identiques sans collision | Qualification charge11/12 |
| F-DAS2-AC-01 | Année/clôture/état/montant et provenance | Acquisition réelle Task10 |
| F-DAS2-AC-02 | Mention puis annulation avec auteur/date/motif ; aucun reçu inventé | Qualification11/12 |
| F-DAS2-AC-03 | Pièces, checklist/commentaires communs et identité persistés ; recette locale Task3 après rechargement/vue/retrait de droits | Qualification Tasks11/12 ; docs/workflows.md |
| F-DETTES-AC-01 | Photographies compte/impôt/période/référence, date source/collecte | Couverture tous impôts acquise Task10 |
| F-DETTES-AC-02 | Dette/apurement/paiement/échéancier séparés | Qualification11/12 |
| F-DETTES-AC-03 | Historique, apurement et zéro source explicite complet | Couverture réelle Task10 |
| F-ANOMALIES-AC-01 | Valeurs et dates concurrentes, source absente qualifiée | Observations acquises Task10 |
| F-ANOMALIES-AC-02 | Résolution motivée, auteur, observations conservées | Qualification11/12 |
| F-ANOMALIES-AC-03 | Nouvelle contradiction réouvre ; aucun fournisseur modifié | Qualification11/12 |
| F-PAYMENTS-AC-01 | Référence/source/date/montant et relation dette/obligation | Preuves acquises Task10 |
| F-PAYMENTS-AC-02 | 100.00−30.01−69.99=0.00 ; recollecte sans doublon, ambiguïté refusée | Qualification11/12 |
| F-PAYMENTS-AC-03 | Ordre/validation/présentation/débit séparés ; preuve manuelle requise | Preuves acquises Task10 |
| F-SOCIAL-AC-01 | DSN établissement/mois/production/tentative distincts | Pilote jedeclare acquis Task10 |
| F-SOCIAL-AC-02 | Retours URSSAF/retraite, preuve, rejet mauvaise tentative | Pilote jedeclare acquis Task10 |
| F-SOCIAL-AC-03 | Contrats DSN/DES/RCM/IFU distincts, aucune émission déduite | Pilotes acquis Task10 |
| F-IRPP-AC-01 | Contact/année/étapes/dates/intervenants | Qualification11/12 |
| F-IRPP-AC-02 | Prérempli versionné GED, droits transitifs contact jusqu’au fichier | Acquisition réelle Task10 |
| F-IRPP-AC-03 | Validation client/cabinet/marque/tentative séparées | Preuve externe acquise Task10 |
| F-RCM-AC-01 | Période/montant/version/origine conservés | Pennylane/jedeclare acquis Task10 |
| F-RCM-AC-02 | Manuel100/source120 contradictoires, aucune origine effacée | Pilotes acquis Task10 |
| F-RCM-AC-03 | Dépôt/acceptation/paiement séparés, aucune formule TVA | Pilotes acquis Task10 |
| F-IFU-AC-01 | RCM et versions, ventilation bénéficiaires et couverture annuelle | Contrats source acquis Task10 |
| F-IFU-AC-02 | Source modifiée → périmée ; document figé inchangé | Qualification11/12 |
| F-IFU-AC-03 | Agrégation versionnée, approbation/pièce/tentative séparées | Format fiscal certifié uniquement après acquisition Task10 |
| F-DES-AC-01 | Nature/dossier/période/responsable/dates/pièces | Qualification11/12 |
| F-DES-AC-02 | Préparation/mention/résultat distincts | Preuve transmission acquise Task10 |
| F-DES-AC-03 | Capacité réelle désactivée, simulation explicitée | Démarche/contrat Douanes acquis Task10 |
| PAR-001 / F-DASHBOARD-AC-01 | Fraîcheur temporelle commune source/collecte/politique versionnée, accueil/détail/CSV | Attestation par pilotes acquis Task10 ; qualification11/12 |

## Résultats locaux du lot

Le 17 octobre 2026 : contrôle TypeScript/59 sources Twenty/171 exigences/84 routes réussi ; suite générale PGlite **112 PASS, 2 tests PostgreSQL ignorés** (216,57 s). Sur PostgreSQL17 réel : **31 PASS** (21,02 s), couvrant les18scénarios fiscaux,2restaurations,9testsGED/migrations et2exports. Navigateur complet **25 PASS**, puis scénario fiscal enrichi de résolution d’une révision **1 PASS** (23,9 s) sur le dernier formulaire. Build réussi ; avertissement web **589,49 kB** minifié, **168,44 kB** gzip, conservé pour qualification. Aucun de ces résultats locaux ne vaut CI du lot ou validation en cabinet. Les captures et reçus détaillés restent privés.

## Corrections de revue Task2 — round 1

Une demande d’approbation ne rouvre jamais une version approuvée : une révision explicite est requise. Une modification de l’état de préparation invalide la demande en cours ; la décision exige à nouveau une préparation terminée et une demande active. Les droits de préparation et d’approbation restent distincts.

La création manuelle et la génération héritent du régime TVA pour la TVA et du régime d’imposition pour l’IS. Les autres natures, dont DES, ne reçoivent aucun de ces régimes implicitement.

Pour CFE/TF, la grille et le lot TAR choisissent les dernières versions de chaque avis ; les filtres bien **et** année doivent correspondre au même avis courant. Les anciennes versions restent dans l’historique. Les propriétés et années projetées sont recalculées lors d’une correction d’avis. Un lot sans avis sélectionné rend `emptySelection: true` et `complete: false` dans son rapport final ; une sélection effectuée (`selectionComplete`) ne signifie pas que des originaux ont été restitués.

Un événement `payment` peut conserver `attemptId` et `declarationVersion`, tous deux nuls lorsque le rattachement est inconnu. Un rattachement renseigné doit désigner une tentative de la même obligation et sa propre version, y compris une version historique après correction. Les événements anciens sans ces champs se lisent avec des valeurs nulles. Le détail et l’historique restituent le lien ; l’interface affiche référence de dépôt, version de déclaration et date. Ce lien ne prouve ni acceptation ni débit et ne change pas les règles de calcul du paiement acquis.

Réception locale du round 1, 17 octobre 2026 : suites fiscalité/export **23 PASS sur PGlite** et **23 PASS sur PostgreSQL17**, puis complément de génération et rôles **2 PASS sur chaque base** ; navigateur fiscal **3 PASS** ; contrôle et build réussis. Bundle actuel **590,99 kB** minifié / **168,84 kB** gzip (advisory existant conservé). Contre-revue et CI du candidat restent à effectuer par le contrôleur.

## Travail commun Task3

La fiche fiscale utilise `/workflows/targets/:id` sur son `detail.record.id`, avec checklist versionnée, commentaires internes et abonnement. TVA et DAS2 conservent leurs pièces GED et le même objet ; le navigateur vérifie rechargement, onglets, retrait de droits et notifications. Aucun payload fiscal approuvé n’est modifié. La relation « Ouvrir ou créer la tâche liée » est idempotente. Voir [Travail, calendrier et notifications](workflows.md) pour les critères et frontières Task5/Task9.
