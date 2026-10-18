# Connexions locales : choix techniques proposés

Recherche documentaire du **17 octobre 2026**, Node 22, lots 9/10 du [plan métier](superpowers/plans/2026-10-17-metier-complet.md). Aucun paquet installé, aucun compte connecté, aucun message envoyé ; compatibilité documentaire, pas validation d’exécution.

## Portée et articulation documentaire

Le [cahier](cahier-des-charges.md), sections GED/échanges, installation et sécurité, fixe les exigences. [Validation connecteurs](validation-connecteurs.md), sections 3/5–8, reste la référence pour responsables, accès, secrets, recette cabinet et continuité des clés Brevo. Cette note ajoute les versions, APIs, frontières d’adaptateurs et contraintes de redirection ; elle ne redéfinit pas les schémas canoniques de `packages/contracts`.

## Bibliothèques : versions publiées vérifiées

Versions `latest` et métadonnées interrogées directement dans le registre npm le 17/10/2026 ; figer versions et intégrité dans le futur lockfile, sans importer une branche `main`.

| Paquet proposé | Version / licence déclarée | Node et API documentée |
| --- | --- | --- |
| `nodemailer` | **10.1.2**, MIT-0, publié le 16/10 ; [métadonnées versionnées](https://registry.npmjs.org/nodemailer/10.1.2). | `engines.node >=20.0.0`, exports ESM/CJS et types intégrés ; `createTransport`, `verify`, `sendMail` : [SMTP](https://nodemailer.com/smtp). |
| `smtp-server` — développement/test | **3.19.23**, MIT-0, publié le 16/10 ; [métadonnées](https://registry.npmjs.org/smtp-server/3.19.23). | `>=20.0.0`, CommonJS ; `SMTPServer`, `listen`, `onRcptTo`, `onData`, `close` : [API](https://nodemailer.com/extras/smtp-server). |
| `imapflow` | **2.5.2**, MIT, publié le 16/10 ; [métadonnées](https://registry.npmjs.org/imapflow/2.5.2). | `>=20.0.0`, ESM/CJS et types intégrés ; [installation](https://imapflow.com/docs/getting-started/installation/), [API](https://imapflow.com/docs/api/imapflow-client/). |
| `openid-client` | **6.8.8**, MIT, publié le 05/09 ; [métadonnées](https://registry.npmjs.org/openid-client/6.8.8). | Aucun champ `engines` ; documentation : Node 20 minimum, Fetch/WebCrypto, ESM ; [README versionné](https://github.com/panva/openid-client/tree/v6.8.8). |
| `jose` | **6.2.12**, MIT, publié le 05/09 ; [métadonnées](https://registry.npmjs.org/jose/6.2.12). | Aucun `engines` ; ESM, Fetch/WebCrypto ; `jwtVerify`, `createRemoteJWKSet`, `SignJWT` : [documentation versionnée](https://github.com/panva/jose/tree/v6.2.12). |

**Décision :** garder ces bibliothèques spécialisées et les imports ESM sur Node 22 maintenu. `jose` est déjà une dépendance d’`openid-client` : ne l’ajouter directement que pour une fonction JOSE propre, pas pour reconstruire OIDC. Le mode `require(esm)` des deux paquets panva exige notamment Node **22.12+** ; ESM évite cette dépendance à `require`. [openid-client](https://github.com/panva/openid-client/tree/v6.8.8), [jose](https://github.com/panva/jose/tree/v6.2.12).

Les versions mail du 16 octobre sont récentes : vérifier import/types et scénarios d’erreur sous le Node 22 exact retenu avant adoption. La licence actuelle Nodemailer/SMTP Server est **MIT-0**, pas une ancienne mention de licence recopiée.

## SMTP : capture locale et preuve d’acceptation

**Fait :** `verify()` contrôle DNS, TCP, TLS et authentification, sans envoyer ; il ne garantit pas l’acceptation d’un expéditeur. Le transport propose TLS direct (`secure:true`, typiquement 465) ou STARTTLS ; `requireTLS:true` permet d’exiger ce dernier. [SMTP Nodemailer](https://nodemailer.com/smtp).

**Contrat proposé :** une outbox persistante porte identifiant de commande, révision d’aperçu gelée, enveloppe, expéditeur autorisé, pièces contrôlées et statut par destinataire. Recontrôler droits, configuration active et aperçu au moment du départ. Les limites métier de 10 pièces / 15 728 640 octets précèdent le transport ; la taille MIME encodée est un autre plafond fournisseur.

**Recette locale proposée :** lancer `SMTPServer` sur `127.0.0.1`, port éphémère ; adresser Nodemailer explicitement à ce port sans résolution MX. `onRcptTo` simule rejet partiel ; `onData` capture enveloppe et flux MIME sans relais. Répondre positivement après persistance de la capture et contrôler taille/erreur de flux ; fermer serveur et transport après chaque scénario. Simuler 4xx, 5xx et coupure après DATA. [Hooks SMTP Server](https://nodemailer.com/extras/smtp-server).

L’essai doit passer réellement sur la socket SMTP locale : un transport JSON/stream seul ne vérifie pas SMTP. TLS peut être désactivé dans cette capture isolée ; la configuration réelle valide les certificats et impose le TLS choisi.

Le résultat Nodemailer expose `accepted`, `rejected`, `response`, `messageId` : conserver la réponse brute utile avec rédaction des secrets et afficher **accepté par le transport**, jamais « livré » sur cette seule preuve. [Résultat d’envoi](https://nodemailer.com/#response-object). RFC 5321 §6.1 distingue prise en charge SMTP et échec ultérieur : [norme](https://www.rfc-editor.org/rfc/rfc5321#section-6.1).

**Décision de reprise :** après coupure à résultat inconnu, ne pas réémettre aveuglément ; statut indéterminé et rapprochement humain/fournisseur. SMTP ne fournit pas une clé d’idempotence de bout en bout ; un `Message-ID` stable ne garantit pas la déduplication distante.

## Boîte IMAP et OAuth : lecture bornée

**Faits :** ImapFlow fournit `getMailboxLock(path,{readOnly:true})`, `search`, `fetch`, `download`, UID/UIDVALIDITY, flags et `logout`; le verrou se libère dans `finally`. `fetch` peut recevoir une plage d’UID et un sous-ensemble de champs ; `download` accepte `maxBytes`. `auth.accessToken` permet une authentification OAuth ; le paquet n’obtient pas lui-même le consentement fournisseur. [API ImapFlow](https://imapflow.com/docs/api/imapflow-client/).

**Contrat proposé :** sélection explicite d’une boîte/dossiers, dates, limite de messages, octets et durée ; métadonnées d’abord, corps/pièces à la demande ou par sélection approuvée. Aucun `fetch('1:*',{source:true})` par défaut ; préciser `{uid:true}` pour une plage d’UID. Un contenu plafonné/tronqué ne devient pas une pièce complète. Point de reprise `(connectionId,mailbox,uidValidity,uid)` ; changement UIDVALIDITY invalide le curseur et déclenche une nouvelle lecture bornée. Pas de clé fondée sur les numéros de séquence.

Les labels Memlia restent locaux ; flags, mots-clés IMAP, dossiers et éventuels labels Gmail sont des capacités séparées. Lire en mode sans modification et éprouver le non-lu sur fixtures ; marquer lu, déplacer ou supprimer exige une commande dédiée. Ne jamais assimiler une déconnexion Memlia à la suppression distante des messages.

**Manifeste proposé par connexion :** `identity.login`, `mailbox.read`, `mailbox.flags.write`, `mail.submit`, `campaign.manage`, `campaign.dispatch`, `feedback.receive` avec état disponible/indisponible, raison, protocole, scopes acquis, propriétaire, boîtes permises et échéance. Ces noms sont des propositions de contrat Memlia, pas des scopes fournisseur.

Nodemailer accepte `auth:{type:'OAuth2',user,accessToken,expires}` ; l’acquisition/rotation générique appartient à l’adaptateur fournisseur, pas aux helpers Gmail utilisés par accident. [OAuth Nodemailer](https://nodemailer.com/smtp/oauth2).

Google IMAP/SMTP requiert le scope large `https://mail.google.com/` ; si ce périmètre n’est pas justifié, étudier l’API Gmail et ses scopes plus fins dans un adaptateur distinct. Un filtrage local ne réduit pas les droits du jeton. [Contrat Google XOAUTH2](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol).

Microsoft distingue les scopes délégués `https://outlook.office.com/IMAP.AccessAsUser.All` et `https://outlook.office.com/SMTP.Send` ; `offline_access` sert au renouvellement. Boîte partagée, consentement administrateur, activation protocolaire et droits d’envoi restent à valider pour le compte choisi. Ne pas confondre ces jetons avec Microsoft Graph ou un ID token. [Microsoft Exchange OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth).

## Brevo : contrat HTTP explicite

**Décision :** adaptateur HTTP via Fetch natif Node 22, timeout et validation des réponses à la frontière ; pas de SDK supplémentaire nécessaire. Capturer les exemples du contrat utilisé et sa date avant implémentation. Clé locale dans l’en-tête `api-key` ; disponibilité, rotation et expiration restent régies par [validation connecteurs](validation-connecteurs.md). [Authentification officielle](https://developers.brevo.com/docs/api-key-authentication).

| Capacité documentée | Contrat à adapter |
| --- | --- |
| Contacts | `POST /v3/contacts` : création ; [guide](https://developers.brevo.com/docs/synchronise-contact-lists). `PUT /v3/contacts/{identifier}` : mise à jour, listes et `emailBlacklisted` ; ne jamais le remettre à `false` par synchronisation implicite. [Référence](https://developers.brevo.com/reference/update-contact). |
| Segments | `GET /v3/contacts/segments`, pagination `limit` (max 50)/`offset` ; lister des segments existants n’établit pas une API pour créer leurs règles. [Référence](https://developers.brevo.com/reference/get-segments). |
| Campagnes | `POST /v3/emailCampaigns` crée un brouillon avec expéditeur, contenu et destinataires/listes/segments ; garder l’ID fournisseur. [Création](https://developers.brevo.com/reference/create-email-campaign). |
| Départ séparé | `POST /v3/emailCampaigns/{campaignId}/sendNow`, réponse 204 : campagne programmée, pas preuve de réception. [Référence](https://developers.brevo.com/reference/send-email-campaign-now). |
| Rapport sortant | `GET /v3/emailCampaigns/{campaignId}`, statistiques globales et autres agrégats documentés ; ne prouve pas le traitement exhaustif des désinscriptions individuelles. [Référence](https://developers.brevo.com/reference/get-email-campaign). |
| Retours entrants | `POST /v3/webhooks`, `type:'marketing'` et événements exacts de la [création webhook](https://developers.brevo.com/reference/create-webhook). Les noms d’abonnement (`unsubscribed`, `hardBounce`) diffèrent des payloads (`unsubscribe`, `hard_bounce`) : [schémas marketing](https://developers.brevo.com/docs/marketing-webhooks). |

**Sécurité documentée des webhooks :** Brevo décrit `auth:{type:'bearer',token:...}`, authentification utilisateur/mot de passe dans l’URL et en-têtes configurés ; filtrage IP complémentaire possible. Retenir Bearer sur HTTPS avec secret dédié local, comparaison sûre et rotation. Aucune signature HMAC ni en-tête de signature n’est établi par ce contrat ; ne pas en inventer. La clé `api-key` authentifie la création du webhook, elle ne prouve pas l’origine de chaque callback. [Secure webhook calls](https://developers.brevo.com/docs/secured-webhooks).

**Frontière locale :** Brevo doit pouvoir joindre l’URL de notification. Un nom exclusivement interne n’est pas une route entrante acquise ; sans publication HTTPS limitée expressément choisie, `feedback.receive` reste indisponible. La lecture de rapports par requête sortante peut fonctionner séparément, avec couverture affichée ; elle ne remplace pas silencieusement chaque événement.

**Traitement proposé :** authentifier avant ingestion, limiter taille, enregistrer durablement avant 2xx, valider puis rapprocher campagne/destinataire. `id` des payloads email est documenté comme identifiant du webhook, pas clé universelle d’événement : dédupliquer par empreinte stable du payload normalisé et contexte ; accepter répétitions et ordre inversé. [Payloads marketing](https://developers.brevo.com/docs/marketing-webhooks).

Garder événements bruts utiles, états normalisés et consentement séparés ; désinscription/plainte bloque les prochains départs sans effacer l’historique. Recalculer segment/suppression avant approbation puis départ ; une évolution invalide l’aperçu. Pas de réémission automatique après résultat HTTP indéterminé sans rapprochement de l’ID fournisseur.

## OIDC cabinet : identité et session Memlia

**Décision :** `openid-client` 6 pour découverte de l’issuer **configuré**, code d’autorisation et PKCE S256. Utiliser `discovery`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge`, `randomState`, `randomNonce`, `buildAuthorizationUrl`, puis `authorizationCodeGrant` avec `pkceCodeVerifier`, `expectedState`, `expectedNonce`, `idTokenExpected:true`. Générer les trois valeurs à chaque tentative et stocker une transaction serveur courte, liée au navigateur et consommable une fois. Les exemples conditionnent parfois state/nonce ; Memlia les exige tous deux. [Exemple OIDC](https://github.com/panva/openid-client/blob/v6.8.8/examples/oidc.ts), [API](https://github.com/panva/openid-client/blob/v6.8.8/src/index.ts).

Activer explicitement `enableNonRepudiationChecks(config)` pour vérifier aussi les signatures JWS avec le JWKS de l’issuer : dans ce flux direct TLS, cette vérification n’est pas activée implicitement pour toute réponse. Ne pas remplacer la validation par `decodeJwt`. [Source et documentation de l’option](https://github.com/panva/openid-client/blob/v6.8.8/src/index.ts).

Exiger signature/algorithme autorisé, issuer exact, audience client et `azp` lorsque requis, expiration et nonce ; ne pas accepter un access token à la place de l’ID token. Refuser découverte arbitraire fournie au callback, issuer différent, callback non attendu et absence de PKCE local. [OIDC Core, validation ID token](https://openid.net/specs/openid-connect-core-1_0-errata2.html#IDTokenValidation).

L’identité externe est `(issuer,sub)` ; l’email est un attribut, jamais une clé de fusion automatique. [Stabilité des identifiants OIDC](https://openid.net/specs/openid-connect-core-1_0-errata2.html#ClaimStability). Une invitation ou un rattachement explicite autorisé associe cette identité à l’utilisateur local. Collision email : intervention, pas création privilégiée ni fusion.

**Règles Memlia à réaliser :** configuration OIDC active et utilisateur local actif au callback **et à chaque requête** ; permissions locales courantes, jamais rôle administrateur déduit d’un email. Désactivation utilisateur/configuration et révocation invalident les sessions correspondantes, même si la session IdP existe encore. Déconnexion locale certaine ; déconnexion IdP seulement si son contrat est configuré. Aucun jeton mail obtenu par le login `openid profile email` seul.

Invitation et récupération locale : jetons aléatoires à usage unique, empreinte stockée, expiration, audit rédigé, révocation des sessions après récupération ; reprise administrateur indépendante du fournisseur, sans mot de passe universel. Garder un moyen de récupération explicite pour le dernier administrateur actif. Ce sont les règles du lot 10, pas un service garanti par OIDC.

## Domaine cabinet et disponibilité des fournisseurs

| Fournisseur | Contraintes vérifiées et décision proposée |
| --- | --- |
| Google | Redirect URI enregistrée exactement, HTTPS hors localhost ; IP brute interdite hors loopback, suffixe public requis : un nom `.local` ne convient pas. Utiliser un sous-domaine réellement détenu avec DNS interne et certificat reconnu, puis recette finale de l’inscription. [Règles Google](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation), [OIDC](https://developers.google.com/identity/openid-connect/openid-connect). |
| Microsoft | Application Web enregistrée, HTTPS hors exception localhost, correspondance de casse/chemin. Proposer issuer du cabinet identifié, sans audience multitenant ouverte par défaut ; nom, certificat et politiques du tenant à vérifier. [Redirect URIs](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url). |
| Apple | Services ID lié à un App ID principal et configuration des domaines/retours ; URL absolue HTTPS, nom de domaine, sans IP ni localhost ; retour web `form_post`. Aucun bouton actif par défaut. Le support effectif PKCE requis par Memlia n’est pas établi ici : garder Apple indisponible tant que contrat et recette ne l’attestent pas. [Configuration web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web), [plateformes web](https://developer.apple.com/documentation/signinwithapple/incorporating-sign-in-with-apple-into-other-platforms). |

**Inférence d’architecture :** un retour OIDC par navigation du navigateur peut rejoindre un service cabinet accessible par LAN/VPN ; cela n’exige pas à lui seul l’exposition de la base ni du serveur à Internet. Le serveur Memlia doit néanmoins joindre les endpoints HTTPS de découverte, jetons et JWKS. Les webhooks Brevo ont une exigence d’accès entrant différente. `localhost` désigne le poste du navigateur, pas automatiquement la VM partagée.

## Déconnexion, rétention et preuve restante

**Politique proposée :** déconnecter bloque immédiatement tâches et nouveaux départs, ferme les connexions, retire les secrets locaux et tente révocation uniquement via un mécanisme fournisseur documenté ; échec distant visible, sans promesse de révocation universelle. Les copies déjà classées en GED, caches personnels, journaux et consentements ont des durées et droits distincts configurés par le cabinet ; suppression locale et conservation fournisseur sont séparées. Aucun nettoyage distant automatique.

Avant branchement réel : tests locaux des trois plans d’autorisation, capture SMTP, reprise indéterminée, UIDVALIDITY, limites de lecture, OAuth expiré/révoqué, feedback dupliqué/inversé, désinscription, faux issuer/audience/signature/state/nonce, callback rejoué et utilisateur désactivé avec session existante. Les fixtures n’attestent ni consentement fournisseur, ni délivrabilité, ni conformité du domaine réel.

Les comptes, droits effectifs, expéditeurs/DNS, quotas, callbacks réels et réception finale restent **accès à valider en dernière phase cabinet** conformément à [validation connecteurs](validation-connecteurs.md). Aucune absence de compte n’autorise à inventer endpoint, scope ou succès fournisseur.
