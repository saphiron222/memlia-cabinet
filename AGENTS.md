# Travail dans Memlia Cabinet

- Lire `GLOSSARY.md`, `docs/cahier-des-charges.md` et le plan du lot avant de modifier son interface.
- Le périmètre complet vit dans `docs/exigences.json`. Un lot livré ne le réduit pas à un MVP.
- TypeScript strict. Des modules métier profonds, interfaces courtes, règles au même endroit que leurs tests. Aucun type de payload recopié : `packages/contracts` fait autorité.
- Tests aux interfaces approuvées par le cadrage : commandes métier et HTTP, contrat de collecte, stockage de pièces, parcours UI. Tests comportementaux, données fictives et cycle rouge/vert pour les règles.
- Vraies administrations et comptes du cabinet : toute dernière phase seulement. Aucun endpoint ou sélecteur inventé présenté comme fonctionnel.
- Interface web auto-hébergée au cabinet. Design : `docs/design-interface.md` fait autorité ; Plane dirige navigation et composition, Twenty les grilles/fiches, cal.diy les calendriers/formulaires. Sources complètes figées, réutilisations et licences tracées ; aucun mélange arbitraire de thèmes.
- Ne jamais committer `evidence/private`, `var`, `.env`, cookies, identités ou pièces réelles. Le dépôt GitHub est public. Les originaux locaux ne sont pas des fichiers à nettoyer.
- Conserver uniquement documentation normative, décisions utiles et preuves de vérification. Pas de fichiers vides, boilerplate de générateur, README redondants ou tests qui recopient l’implémentation.
- Avant une livraison : `npm run check`, `npm test`, `npm run build` ; citer ce qui a réellement tourné.
- Chaque lot met à jour la traçabilité des exigences. Distinguer construit, testé localement, vérifié en CI et validé en cabinet.
