# Description de construction — Memlia Cabinet

Le [cahier des charges](../../cahier-des-charges.md) est la description normative complète, appuyée par [les exigences identifiées](../../exigences.json). Ce fichier sert d’entrée au workflow Superpowers, sans dupliquer la spécification.

Le cadrage fonctionnel a été validé et Kevin a explicitement demandé sa mise en œuvre complète. Il a autorisé le nouveau dossier, la création du dépôt GitHub, puis sa visibilité publique. Cette autorisation prévaut sur une nouvelle demande d’approbation générique du même périmètre.

Choix laissés au constructeur et désormais explicités : nom Memlia Cabinet, TypeScript/React/Fastify/PostgreSQL, installation partagée locale, archive des preuves séparée du code. Les mécanismes de test des interfaces métier, collecte, GED et UI reprennent le cadrage validé. Les détails privés des portails sont différés à la toute dernière phase en cabinet, sans supprimer les simulateurs ni les fonctions.

Les questions matérielles propres à chaque cabinet sont des paramètres du lot d’installation. L’assistant IA dossier local reste une extension à valider et désactivée par défaut ; il n’empêche pas les autres fonctions de démarrer.
