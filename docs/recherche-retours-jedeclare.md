# Retours jedeclare.com : contrat public acquis et limites

Recherche publique bornée au 17 octobre 2026 ; aucune connexion, émission ou opération sur un compte réel. Sources primaires ECMA, EDIFICAS, DGFiP et IETF.

## Conclusion

**Contrat de transport partiel acquis ; contrat de normalisation ADS/ACS/ARS manquant.** Un premier adaptateur local de récupération d'originaux POP3 est défendable et testable sur serveur fictif. Il ne prouverait ni la disponibilité actuelle de jedeclare.com, ni l'interprétation automatique de ses retours. Aucun contrat public ECMA suffisamment précis de récupération API et de parsing métier n'a été trouvé dans les sources consultées ci-dessous.

## Ce qu'ECMA publie effectivement

La [notice Outlook 2019, version 1, 22/09/2021, pp.3–5](https://ressources.ecma-solutions.com/plezi_file/6470c046d59cbc0740f156bf/notice_outlook_2019_jedeclare.pdf) configure une adresse `<votre_login>@jedeclare.com`, un compte POP, le serveur entrant `pop.jedeclare.com`, port **995**, chiffrement **SSL/TLS**, et le mot de passe de la boîte. La [notice Thunderbird 3, pp.4–5, non datée dans le texte consulté](https://ressources.ecma-solutions.com/plezi_file/6470c0edd59cbc0739f15bde/guide_thunderbird3_jedeclare.com.pdf) confirme ce serveur/port/chiffrement. Ces publications anciennes ne garantissent pas leur configuration ni leur disponibilité en 2026. Elles ne fixent pas la méthode d'authentification sur le fil, les capacités serveur, les versions TLS effectivement acceptées ou OAuth.

Le [guide cabinets, juillet 2024, pp.4–6 et 11–12](https://ecma-solutions.com/server-api/public/ressources-ecma/content/utiliser-services-jedeclare-com-cabinets) distingue compte de flux et compte personnel web. ADS atteste date/heure du dépôt ; ACS indique acceptation/rejet par jedeclare.com, un ACS négatif empêchant l'acheminement ; ARS rapporte le traitement du destinataire. Pour TDFC, les destinataires DGFiP/OGA et les retours partiels sont explicitement distingués ; l'objet peut comporter « ARS PARTIEL » ou « a reçu l'intégralité ». Ce sont des indications utilisateur, pas une grammaire versionnée exhaustive. En TVA, déclaration et télérèglement peuvent être acceptés/rejetés : **cela ne prouve aucun débit bancaire**.

## Standards disponibles, sans garantie supplémentaire de jedeclare.com

La [RFC 1939, mai 1996, §§5–7](https://www.rfc-editor.org/rfc/rfc1939) définit POP3 : authentification USER/PASS, LIST, RETR, réponses multilignes avec déséchappement des points, QUIT et DELE ; UIDL est **optionnel**. Un UIDL persiste entre sessions dans une boîte, contrairement à un simple numéro de message. POP3 ne définit pas une pagination HTTP. Le support concret d'UIDL/USER-PASS par jedeclare.com reste à vérifier, sans le déduire de la norme.

La [RFC 8314, janvier 2018, §3.1](https://www.rfc-editor.org/rfc/rfc8314) décrit TLS implicite dès connexion au port 995 et validation du certificat. C'est la référence d'implémentation proposée, pas une mesure du serveur ECMA. La [RFC 2045, novembre 1996](https://www.rfc-editor.org/rfc/rfc2045) permet de décoder MIME ; elle ne décrit aucun schéma ADS/ACS/ARS.

Le [volume IV DGFiP TDFC 2026, mise à jour 03/2026, §4.5.3, GUM INFENT CR version 26.01, décembre 2025, pp.222 suivantes](https://www.impots.gouv.fr/sites/default/files/media/1_metier/3_partenaire/edi/cdc_edi_tdfc/2026/volume_iv_tdfc_2026.pdf) fournit segments, identités, références et codes EDIFACT D00B/FR2601 pour les échanges **DGFiP–partenaire EDI**. Il distingue aussi CONTRL et INFENT CR. Il permet un parseur de ce sous-ensemble identifié ; il ne garantit pas que les pièces des courriels jedeclare reproduisent exactement ce format. Les [cahiers EDIFICAS EDI-PAIEMENT, par paliers](https://edificas.fr/teleprocedure/teleprocedure-edi-paiement) ne constituent pas davantage un contrat d'enveloppe ECMA. Ne pas transposer TDFC à toutes les procédures.

## Choix local défendable et inconnues

Prémisse proposée : lecteur POP3 sous TLS vérifié, récupération des messages bruts, archivage local et empreinte ; aucune commande DELE. UIDL, s'il existe, est qualifié par la boîte ; absence d'UIDL explicitement traitée, jamais masquée par une identité fiscale inventée. Une fixture de dialogue POP3 et des courriels synthétiques vérifient transport, doublons et interruptions ; leur contenu reste **inconnu/à examiner**, sans statut fiscal déduit de l'objet ou d'un XML inventé.

Restent à obtenir : contrat ECMA actuel/versionné, auth/capacités/rétention/limites, schémas et échantillons autorisés des enveloppes/signatures/pièces, codes, corrélations dépôt–déclaration–correctif–destinataire, complétude et retours tardifs. La [page partenaires](https://ecma-solutions.com/partenaires), rendue ici comme coquille JavaScript, n'a fourni aucun de ces contrats. La recherche infructueuse n'établit pas leur inexistence ni leur confidentialité. Récupérer un original, valider sa signature et interpréter son statut sont trois preuves distinctes.
