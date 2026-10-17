# Installation partagée et monolithe modulaire

Date : 17 octobre 2026. Décision du constructeur pour appliquer le cadrage validé.

Une application indépendante par poste simplifierait un exécutable, mais multiplierait les bases, profils et conflits. Des microservices ajouteraient déploiement et diagnostic sans avantage établi pour une installation de cabinet.

Nous retenons un monolithe modulaire TypeScript, PostgreSQL et GED locale, avec une interface React partagée et des travaux durables. Les règles métier sont testées aux commandes et aux contrats, pas aux détails des composants visuels. Un adaptateur PGlite sert au développement autonome ; le vrai PostgreSQL reste la référence de réception multiutilisateur.

L’installation cible un service Linux local ou une VM du cabinet ; les postes Windows utilisent l’interface partagée. Le coût de ce choix est un hôte commun à administrer. Il évite de prétendre qu’une simple fenêtre installable suffit aux besoins de données et de collaboration.

Les administrations et fournisseurs restent derrière des adaptateurs explicites. Les données fictives et les pilotes réels ont le même contrat ; aucun sélecteur ou droit privé inconnu n’est transformé en intégration fonctionnelle.
