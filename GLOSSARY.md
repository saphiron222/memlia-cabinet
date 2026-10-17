# Memlia Cabinet

Langage commun pour le pilotage du cabinet et les collectes documentaires.

## Language

**Cabinet** :
Organisation qui possède ses données et son installation partagée.
_Avoid_ : tenant pour parler à un utilisateur

**Dossier** :
Relation de travail suivie par le cabinet pour une entreprise ou une activité.
_Avoid_ : compte fiscal, personne

**Contact** :
Personne physique ou morale liée aux dossiers et aux échanges.
_Avoid_ : utilisateur

**Utilisateur** :
Personne autorisée à utiliser Memlia au titre du cabinet.
_Avoid_ : contact client

**Compte source** :
Identité et périmètre d’accès fournis par un organisme ou un fournisseur.
_Avoid_ : dossier

**Obligation** :
Travail fiscal, social ou personnalisé attendu pour un dossier et une période.
_Avoid_ : déclaration déposée

**Tentative de dépôt** :
Émission identifiée d’une déclaration dont les retours restent liés à cette tentative.
_Avoid_ : paiement, validation locale

**Apurement** :
Événement qui réduit une dette, dont la nature peut être un paiement, une remise ou une réimputation.
_Avoid_ : débit bancaire automatique

**Collecte** :
Lecture bornée d’un compte source qui produit des observations et des pièces avec une couverture explicitée.
_Avoid_ : synchronisation réussie pour un périmètre incomplet

**Robot** :
Routine locale qui suit une démarche précise, contrôle ses résultats et reprend après interruption.
_Avoid_ : agent autonome pour une routine déterministe

**Pièce** :
Original conservé et identifié avec sa provenance et sa version.
_Avoid_ : simple lien

**Tâche** :
Action interne affectée, suivie par étape et éventuellement liée à une checklist.
_Avoid_ : obligation fiscale

**Process** :
Suivi ponctuel structuré en étapes, portant sur des dossiers, contacts, utilisateurs ou lignes libres.
_Avoid_ : suivi récurrent

**Suivi récurrent** :
Grille périodique dont les colonnes ont chacune une fréquence et un type de valeur.
_Avoid_ : règle de tâches récurrentes

**Version applicable acceptée** :
Version d’une déclaration appuyée par les retours acceptés de ses destinataires attendus ; un correctif rejeté ne remplace pas l’initiale acceptée.
_Avoid_ : dernière version préparée

**Photographie de dette** :
Constat daté d’une créance et de son solde, sur une portée explicitée ; il reste distinct des événements d’apurement.
_Avoid_ : solde universel du dossier

**Candidat de rapprochement** :
Lien proposé entre une obligation et des éléments bancaires, avec motifs et confiance, qui ne prouve pas un débit.
_Avoid_ : paiement confirmé

**Préparation IFU** :
Proposition annuelle par payeur, bénéficiaire et catégorie, reliée aux versions des données RCM et à la couverture des mois.
_Avoid_ : somme des montants à payer des 2777

**Cadence opérationnelle** :
Politique datée d’appréciation de la fraîcheur d’une source, distincte d’une échéance fiscale ou d’un engagement du fournisseur.
_Avoid_ : délai réglementaire

**Configuration annuelle de bilan** :
Ensemble versionné des étapes, responsables, prévisions et forfait d’une famille pour un exercice.
_Avoid_ : bilan réalisé, preuve de dépôt

**Type d’étape** :
Liste réutilisable de statuts ordonnés, chacun avec identité, couleur, icône et caractère final.
_Avoid_ : validation humaine, reçu officiel
