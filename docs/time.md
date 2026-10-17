# Temps, capacité et charge

Le module utilise les identités canoniques des dossiers, tâches/obligations et lignes de production. Il n'en crée aucune copie. `packages/contracts/src/time.ts` définit les commandes et projections ; `apps/server/src/time` fournit HTTP, calcul, chronomètres et sorties. Les écrans Temps et Charge consomment ces fournisseurs et l'onglet Temps de la fiche tâche les interroge avec son ID stable.

## Valeurs, héritage et périodes

Les durées persistées sont des secondes entières (saisie/chronomètre) ou minutes entières (prévision/capacité/forfait). Les tarifs/montants EUR restent des chaînes décimales exactes. La valorisation SQL utilise numeric et arrondit le total à deux décimales ; une durée sans tarif donne une valorisation inconnue. Une saisie conserve l'ID, la version et le montant du tarif applicable à sa date. Une correction hors période fermée prend le tarif courant applicable ; les versions antérieures restent dans l'historique.

Priorité : surcharge occurrence/production explicite, prévision canonique propre de la tâche/colonne gelée de production, dossier, cabinet, inconnu. Une valeur nulle de surcharge rétablit l'héritage ; zéro reste explicite. Un changement du parent ne réécrit pas les enfants explicites. Le scénario HTTP démontre cabinet120, dossier90, occurrence45, changement du parent conservant45, puis retour90 avec provenance.

Les horaires datés comportent sept minutes journalières lundi→dimanche ; la capacité individuelle prime sur le cabinet. Un jour sans horaire rend la capacité de la période inconnue. La surcharge est le dépassement positif de la capacité connue. La fermeture refuse un chronomètre actif et protège les saisies et configurations touchant la période ; la réouverture exige `time_lock` et un motif.

## Forfaits, porteurs et réaffectation

Un forfait daté lie dossier et rôle, début d'activité, minutes mensuelles, montant exact, prorata et version de politique. Le choix explicite est jours calendaires ou jours lundi→vendredi ; aucune règle fiscale/jour férié n'est déduite. Chaque segment est tronqué au mois, aux dates du forfait, à l'activité et à la période demandée. Les affectations datées apportent des poids positifs explicites ; la division rationnelle et les plus grands restes assurent un total entier déterministe. Les changements de forfait en cours de mois sont des segments distincts non chevauchants. Les tâches fixes sont déjà incluses au forfait et apportent zéro minute supplémentaire ; les variables ajoutent leur prévision une fois. Les objets canoniques déjà représentés par une ligne de production ne sont pas doublés.

Une allocation explicite répartit la prévision d'une tâche ou production. Sans allocation, une affectation canonique unique est utilisable ; plusieurs porteurs sans poids ne produisent pas une répartition devinée. La prévisualisation de réaffectation calcule avant/après sans écriture ; l'engagement vérifie les versions sources, réautorise, versionne l'allocation/affectation et met à jour le porteur canonique d'une tâche ou production. Le réalisé conserve toujours son auteur. Les réaffectations de rôle attendent un porteur unique par affectation datée.

La grille fournit mêmes contributions/totaux par période, personne, pôle/site et rôle porteur. Les capacités restent celles de la personne entière lorsque le rôle filtre la charge. Un salarié sans `time_read` conserve sa fraction calculée avec tous les poids autorisés du dossier sans exposer les identités et valeurs des autres collaborateurs.

## Autorisations, reprise et sorties

`time_read` autorise les données d'autres employés ; `time_manage` les configurations et corrections d'autrui ; `time_lock` les fermetures/réouvertures. Les autorisations de dossier, de confidentialité et d'objet canonique s'ajoutent à ces droits. La migration n'accorde pas de nouveaux droits aux comptes existants : un administrateur déjà autorisé à gérer les permissions doit les attribuer explicitement. Les nouveaux cabinets donnent ces capacités au créateur.

Les prédicats SQL matérialisent les objets lisibles et vérifient les liens courants **et historiques** avant pagination/compteurs/export. Un objet devenu confidentiel masque également son temps ancien. Les commandes, relectures d'opération et restitutions d'exports revérifient les droits courants. Un libellé libre identique au titre d'une tâche reste indépendant. La saisie depuis une tâche préremplit sa relation ; seules les natures actives sont proposées pour nouveau temps, les anciennes restent lisibles.

Un seul chronomètre actif par utilisateur (contrainte SQL et transaction). Démarrage et arrêt dédupliqués par opération ; un autre arrêt est refusé. Il conserve les secondes écoulées et produit exactement une saisie. Les configurations/historiques sont versionnés ; la borne de durée d'une saisie est sept jours.

CSV via job durable : pages100, maximum100000 saisies et période367jours, données conservées par partie, colonnes de provenance/tarif, échappement de formules. Les droits et versions sont revérifiés à l'exécution et à la restitution. La sortie complète bornée ajoute configurations, temps, chronomètres, historiques, métadonnées CSV et lignes préparées (pages100 /2MiB). La sauvegarde native capture ces tables avec tout le cabinet.

Migration additive11 : `cabinet_time`, `cabinet_time_history`, `cabinet_time_csv`, `cabinet_time_csv_rows`, contrainte chronomètre actif, extension des types de sortie. Aucun changement destructif des occurrences existantes. Une restauration doit utiliser une version acceptant le schéma11 ; retour au code antérieur incompatible.

Les rapports retournent100 lignes par page, les sélecteurs100 résultats avec recherche, configurations maximum20000 et charge maximum10000 objets par famille/200personnes ; au-delà, refus explicite invitant à réduire le périmètre. La période est bornée367jours. Les seuils protègent les ressources locales ; ils ne déclarent pas complet un résultat tronqué.

## Critères et réception

| Critère | Fournisseur et preuve locale |
|---|---|
| PAR-048 / F-TEMPS-AC-01 | `shared.tsx` formulaire typé, test navigateur durée90 Tab/Entrée/reload ; HTTP durée/date/auteur/nature |
| PAR-049 / F-TEMPS-AC-02 | relation discriminée libre/record/production, HTTP même titre libre exclu du réalisé de la tâche |
| PAR-050 / F-TEMPS-AC-03 | report/CSV mêmes requêtes scoping/totaux ; test CSV, confidentialité retirée et restitution/replay refusés |
| PAR-051 | TaskTime préremplit la tâche ; nature inactive retenue dans historique et rejetée à la nouvelle saisie |
| PAR-052 / F-CHARGE-AC-01 | capacités cabinet9240/individuelle4620 minutes avec origine dans HTTP ; éditeur7jours dans navigateur |
| REA-SC-09 / F-CHARGE-AC-02 | test120→90→45→90 et conservation de l'enfant explicite |
| REA-SC-10 / F-CHARGE-AC-03 | forfait310 puis620, début tardif, deux porteurs190+190 et tâche45 :425 total, part propre190 sans fuite |
| PUB-018-S1 | preview/commit/replay et historique, porteur canonique conservant ID ; navigateur réaffectation confirmée |
| PUB-018-S2 | filtres personne/groupe/rôle ; totaux rôle380 conformes aux contributions ; lecture seule et identité employé filtrée |
| PUB-016-S2 portion Task5 | fiche tâche onglet Temps réel lié à son ID, prévu avec provenance et réalisé, lien permanent conservé au reload ; mentions restent fournies par Task3 |
| TR-PERSIST / TR-LOCAL / TR-TESTS | HTTP PGlite puis PostgreSQL17 réel, deux restores natifs (public/schéma configuré) peuplés de toutes les familles de temps, historiques, chronomètre actif et CSV identique |

Les ports réellement utilisés et adaptations sont dans `interface-source-map.md` et `design-interface-provenance.json`. Captures fictives inspectées en1440/900, clair/sombre, panneaux remplis, clavier/focus/défilement, chargement/vide/erreur/lecture seule. Les premières captures et erreurs restent privées avec les reçus. La qualification locale ne vaut ni CI exacte du contrôleur ni réception globale Task12, ni essais réels en cabinet (dernière phase seulement). Le rapport privé Task5 recense commandes/résultats et empreintes de la livraison.
