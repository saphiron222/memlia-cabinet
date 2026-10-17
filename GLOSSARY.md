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
