# LAB et onboarding — éléments de cadrage

Recherche acquise le **17 octobre 2026**, limitée au Task 6, F-LAB et F-ONBOARDING. Note de conception et de réception, sans avis juridique individualisé ni certification de conformité.

## Faits sourcés et limites documentaires

Les experts-comptables sont assujettis au dispositif LAB ; Tracfin distingue leur régime de celui des commissaires aux comptes et mentionne l'exception déclarative concernant certaines consultations juridiques. Les règles bancaires ACPR et les normes des commissaires aux comptes ne sont donc pas transposées à ce lot. [Tracfin, professions du chiffre](https://www.economie.gouv.fr/tracfin/les-professions-du-chiffre).

Le **référentiel OEC, édition 2025**, contient la NPLAB agréée le 7 décembre 2020, applicable le 14 décembre 2020. Elle vise toutes les missions (§3). La relation d'affaires commence avant la signature (§24) ; identification et vérification concernent client, représentant et bénéficiaires effectifs avant signature, avec report limité de la vérification avant travaux si risque faible (§25). Le réexamen du risque et de la vigilance est documenté (§23). Pour les entités françaises immatriculées au RCS, le registre des bénéficiaires effectifs est consulté même après une vérification par un autre moyen ; les informations collectées sont conservées et les divergences signalées (§31). PPE et certaines situations géographiques appellent une acceptation par l'organe exécutif ou son délégataire (§35–36). [OEC, NPLAB, pages imprimées 46–60](https://extranet.experts-comptables.org/download/publication/c2854c3d-bee6-46b5-85d8-dd67d62be9c0/pdf).

Identifier une personne agissant pour le client, vérifier son identité **et ses pouvoirs**, puis conserver les preuves sont des exigences distinctes. [CMF R561-5-4, version depuis le 14 février 2020](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041577234/2026-04-26).

Les modalités réglementaires distinguent données d'identification et moyens de vérification ; une pièce téléversée seule n'établit pas que la méthode applicable a été suivie. Les résultats d'un examen renforcé sont écrits et conservés. [CMF R561-5 à R561-5-2 et R561-22, version consultée au 11 juillet 2026](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006072026/LEGISCTA000006139674/2026-07-11/).

L'impossibilité de satisfaire aux diligences entraîne les conséquences de L561-8 ; ses exceptions relatives aux procédures juridictionnelles et consultations juridiques exigent une qualification professionnelle, pas une dérogation automatique. [CMF L561-8, version depuis le 14 février 2020](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041577826/2026-02-23).

L'INPI annonce un accès BE restreint depuis le 31 juillet 2024, notamment aux assujettis, après demande signée, justificatifs et examen. Cette page ne prouve ni l'habilitation du cabinet ni un accès API contracté. [INPI, demande d'accès BE](https://data.inpi.fr/content/editorial/acces_BE). Les règles réglementaires d'accès ont évolué en avril 2026 : éviter de figer la seule procédure de 2024. [CMF, accès RBE, version au 13 août 2026](https://eur-lex.europa.eu/legal-content/FR/TXT/PDF/?uri=NIM%3A202606430).

La conservation LAB est de cinq ans après cessation de relation pour documents/informations de relation et vigilance ; celle des opérations court depuis leur exécution, sous réserve de dispositions plus contraignantes. [CMF L561-12, version depuis le 14 février 2020](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041577784/2025-03-14). L'existence, le contenu et les suites d'une déclaration de soupçon sont confidentiels, avec exceptions encadrées. [CMF L561-18, version depuis le 1er juin 2019](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037825428/2020-01-09).

**Incertitudes explicites :** édition OEC 2026 non trouvée publiquement ; consolidation intégrale au 17 octobre et plusieurs liens Légifrance directs indisponibles pendant la recherche. Les versions ci-dessus sont celles effectivement obtenues. La procédure applicable et les textes actualisés restent à qualifier avant réception cabinet.

## Bornes proposées pour Memlia — choix produit

- Une décision humaine conserve cabinet, dossier/personne/mission, auteur et rôle, niveau de vigilance, motifs, pièces référencées et versions, date d'observation, date de décision, précédente décision, prochaine révision et périodicité choisie par le cabinet. Le risque CRM reste indépendant.
- Chaque preuve garde origine (client, saisie, import, registre), référence source, date d'acquisition, portée du contrôle, personne ayant examiné et résultat explicite : « à examiner », « examiné », « insuffisant ». Un résultat externe absent demeure inconnu. Une nouvelle preuve ne réécrit pas l'historique.
- Onboarding : identité, bénéficiaires effectifs, pouvoirs/mandat, lettre et accès fiscal sont des étapes distinctes. Pour un accès : système/source, titulaire, périmètre, dates, preuve d'habilitation observée et examinateur. Une case manuelle ne produit jamais « habilitation vérifiée ». Identité/mandat obligatoire manquant bloque l'activation avec motif précis ; expiration devient visible sans effacer la preuve antérieure.
- Révision échue, incohérence d'identité/BE, mandat insuffisant, changement de contrôle, alerte PPE/sanctions ou opération atypique signalée ouvrent une revue humaine selon la procédure du cabinet. Aucun soupçon, refus réglementaire ou classement automatique n'est déduit de ces événements. Les rappels exécutent les dates saisies, sans périodicité légale inventée.
- Accès et exports limités au cabinet, aux personnes et pièces autorisées ; aucun dossier LAB partagé par défaut au portail client. Export traçable : auteur, date, sélection, versions et restrictions. Pas de déclaration Tracfin ni transmission dans ce lot. Conservation, gel éventuel et suppression doivent suivre une politique validée, sans purge automatique sur simple expiration d'identité.

## Qualification terrain et cas fictifs de réception

À obtenir en dernière phase : procédure/version du cabinet, délégations, classification, périodicités, droits d'accès/export, politique de conservation et preuve des habilitations réellement accordées. Fournisseur PPE/sanctions/RBE, abonnement, couverture et API restent **non vérifiés**.

1. « Atelier Exemple » : case fiscale cochée manuellement ; habilitation toujours inconnue, provenance affichée.
2. Mandataire fictif avec identité mais sans pouvoir requis : activation bloquée, raison dédiée.
3. BE divergent entre deux pièces fictives : preuves conservées, revue humaine ouverte, aucun signalement envoyé.
4. Révision saisie au 20/10/2026 : rappel à échéance ; nouvelle décision motivée conservant l'ancienne.
5. Utilisateur d'un autre cabinet et client d'essai : consultation/export des preuves refusés ; export autorisé limité à sa sélection.
