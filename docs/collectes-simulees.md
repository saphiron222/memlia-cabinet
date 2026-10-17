# Collectes locales et file durable

Ce lot prépare les 17 collecteurs du [registre des accès du 17 octobre 2026](validation-connecteurs.md). Il exécute uniquement des fixtures inventées, sans compte ni trafic fournisseur. Le mode `real` est refusé avant mise en file. Les observations, photographies source, résultats et pièces portent `simulation` ; chaque PDF affiche « SIMULATION — SANS VALEUR FISCALE ». Une observation collectée ne crée aucune déclaration, obligation, transmission ou paiement métier.

Dans Collectes, choisir un dossier fictif avec le SIREN `001234567`, un collecteur et un scénario. La portée proposée est fictive : compte `COMPTE-FICTIF`, établissement `00123456700011`, cotisant `COTISANT-FICTIF`, service `consultation`, du 1er janvier au 31 décembre 2026. TI et PAM sélectionnent deux branches fictives d’échéancier Urssaf. Une identité ou période différente donne une intervention requise. La page expose progression, tentatives, dernier nombre de pages conservées, couverture, erreurs, observations et téléchargement des originaux. Le dernier traitement reste accessible après rechargement dans le même onglet ; l’UUID peut aussi être consulté par l’API avec les droits courants.

## Contrats et stockage

Les définitions exécutables sont exclusivement dans `@memlia/contracts` (`collections.ts`, `jobs.ts`, `documents.ts`). `CollectionExecutor.runCollection(input: CollectionInput): Promise<CollectionResult>` est invoqué par une définition de travail `collection`, avec contexte de lease et de checkpoint fourni par `JobRunner`. L’API est asynchrone : `POST /api/v1/collections` renvoie 202 et `CollectionRun`; `GET /api/v1/collections/:id` recharge le même contrat. `GET /api/v1/collections/catalogue` décrit les 17 IDs, les scénarios et la portée fictive. La référence de secret locale ne figure pas dans la réponse ni dans les événements.

Le résultat distingue `complete`, `partial`, `empty-observed`, `not-available`, `needs-human` et `failed`. Complet exige une identité vérifiée et une frontière de page démontrée pour la portée demandée. Vide exige le signal explicite du scénario vide ; page absente, attestation en attente ou document confidentiel restent visibles et ne deviennent pas des absences métier. Une panne technique du travail après trois tentatives produit `job.state=failed`, garde son checkpoint et son journal, et peut laisser `result=null` : aucun faux résultat source n’est fabriqué.

Migration additive 4 : `cabinet_jobs`, `cabinet_job_events`, `cabinet_job_gate`, `cabinet_collection_observations`, `cabinet_collection_links`, `cabinet_collection_snapshots`. Les migrations 1, 2 et 3 sont conservées. Le journal d’identité des commandes reste `cabinet_operations`, partagé par acteur et identifiant d’opération. Aucun second journal d’idempotence n’est créé.

La déduplication combine mode, collecteur, cabinet, compte, dossier, entreprise, établissement, cotisant, service/profil, période, référence et version source. Elle vérifie ensuite valeurs et empreintes des originaux : une même identité/version ne peut remplacer silencieusement un original. Un nouveau passage crée une photographie datée mais réutilise l’observation et les UUID GED identiques. Les nouvelles versions source sont conservées séparément, sans déduire une correction fiscale ou une tentative de dépôt. Deux contextes Urssaf contenant le même message sont normalisés en une observation avec les deux appartenances de portefeuille.

La GED utilise une instance `DocumentStore` par application. Chaque pièce est préautorisée dans une transaction courte, préparée hors transaction, puis engagée dans la même transaction que ses observations, relations, photographie et checkpoint. Son operationId déterministe est distinct de celui de la commande de collecte. `discard` est appelé en `finally`. Après rollback, la tentative suivante refait `prepare` ; aucun handle opaque n’est persisté. Les UUID sont les seules références de pièce exposées. Comme décrit dans [la GED locale](ged-locale.md), un rollback après déplacement des octets peut laisser un original privé orphelin, sans référence accessible.

## File commune et arrêt

`JobRunner.register({kind,input,checkpoint,result,initial,scope,authorize,execute})` enregistre des schémas Zod et un exécuteur typés ; il renvoie `enqueue(tx,actor,operationId,input)`. La file n’impose pas de payload métier parallèle aux contrats du module. Les valeurs sérialisées sont limitées à 512 Kio ; les collectes bornent aussi fenêtres, pages, observations, pièces, erreurs et événements. `get(tx,id)` est une interface interne : la route métier contrôle l’accès avant de sérialiser la réponse.

`JobContext` fournit `id`, `attempt`, `checkpoint`, `signal` et `commit(checkpoint,code,message,work)`. Chaque engagement recharge l’utilisateur actif et ses droits, contrôle le propriétaire et l’expiration de lease, puis conserve unité métier, checkpoint et événement ensemble. Le travailleur renouvelle sa lease de 60 secondes ; trois tentatives maximum. Plusieurs travailleurs partagent le verrou SQL transactionnel existant. Une même ressource compte/cabinet/famille ne peut avoir deux leases actives, y compris entre collecteurs de la même famille. Une lease expirée peut être reprise ; son ancien propriétaire ne peut plus engager.

`start()` lance le consommateur, `tick()` exécute au plus un travail, `stop()` arrête ce consommateur, annule son signal et attend sa sortie. `pause()` ferme durablement la porte aux producteurs et nouvelles leases, puis attend l’arrêt du consommateur local ; `resume()` rouvre cette porte et redémarre. Une future sauvegarde coordonnée devra appeler et attendre l’arrêt de **tous** les consommateurs de l’installation après fermeture de la porte, et suspendre aussi les écritures interactives des autres modules. Ces primitives ne prétendent pas réaliser une sauvegarde. Le signal est coopératif : l’exécuteur doit le respecter et terminer son opération bornée ; les handles GED en cours sont toujours libérés. Le hook de fermeture de l’application attend `stop()` avant de fermer la base.

## Scénarios et limites documentaires

| Collecteur | Fixture et distinction éprouvée |
| --- | --- |
| `dgfip-cfe` | Avis PDF, rôle, établissement, années d’imposition/recouvrement, montant et échéance ; prélèvement activé sans paiement observé. |
| `dgfip-taxe-fonciere` | Principal et suite attachés à la même référence. |
| `dgfip-attestation-fiscale` | Dates d’émission/appréciation séparées ; non-éligibilité en variante, sans conclusion de non-conformité. |
| `dgfip-dettes` | Dette ouverte, remise de dette sans paiement ; paiement rejeté distinct dans le nominal. |
| `dgfip-tva-documents` | Pièce TVA, dépôt et paiement inconnus séparés, rejet en variante. |
| `dgfip-is-documents` | Pièce IS, exercice décalé, état de dépôt distinct du paiement. |
| `dgfip-messages` | Nouveau message et pièce jointe manquante ; lu avant/après distincts, après inconnu. |
| `dgfip-habilitations` | Service, rôle, utilisateur et état ; aucune modification d’accès. |
| `urssaf-attestations` | Vigilance disponible ou attente explicite. |
| `urssaf-echeances` | TI prévisionnel et PAM appelé comme exemples distincts ; revenus, cotisations et régularisation sur millésimes séparés. Aucun échéancier ne prouve un paiement. |
| `urssaf-messages` | Deux lignes de portefeuilles pour une même identité de message, une seule observation conservée. |
| `inpi-creations` | Création ou modification RNE ; aucune formalité privée présumée. |
| `inpi-actes` | Métadonnée publique et original accessible ; document confidentiel en variante. |
| `inpi-comptes` | Clôture/dépôt distincts ; absence de PDF confidentiel conservée comme limite. |
| `jedeclare-retours` | ADS, ACS et ARS par destinataire ; attente de B sans transformer l’acceptation de A en acceptation générale. |
| `pennylane-dossiers` | Société visible par connexion Firm API fictive. |
| `pennylane-echeances` | Connexion de partage fiscal distincte, fraîcheur, `done` sans acceptation présumée, validation de paiement sans mouvement bancaire, entrepôt manquant. |

Les étapes et références documentaires sont celles de la matrice `validation-connecteurs.md` ; aucune route privée, selector, format partenaire ou quota réel n’est inventé. Les scénarios de frontière inconnue, mauvaise identité, HTML de connexion, challenge, source absente, panne et reprise sont bornés et locaux. Les fixtures n’implémentent pas un protocole réseau ni une pagination réelle : la page suivante manquante prouve le verdict conservateur, pas un pilote fournisseur. Les premiers pilotes documentés/portails locaux restent Task10 avant la réception finale cabinet.

## Traçabilité et preuve locale

`AUD-004`, `AUD-007`, `PUB-021-S1/S2`, `REA-SC-14` et préparations partielles `PAR-015/016/029/034`, `PUB-022-S1/S2` : code, périmètre limité et tests sont inscrits dans `exigences.json`. Tests publics : `apps/server/test/collections.test.ts`, `apps/server/test/jobs.test.ts`, `tests/e2e/collections.spec.ts`. Les tests vérifient aussi `TR-ACCESS`, `TR-PERSIST`, `TR-PROVENANCE` : refus direct, révocation pendant préparation, atomicité rollback, leases, reprise et mode simulation. Task3 M1 possède son parcours navigateur spécifique de nom de fichier avec espaces. Les résultats détaillés restent dans le rapport de lot local ; CI, charge et validation cabinet restent distinctes et non revendiquées.
