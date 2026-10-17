# Sources Twenty — provenance conservée

La nouvelle instruction de Kevin du 17 octobre 2026 remplace la direction Twenty seule par Plane en référence principale, complétée par Twenty et cal.diy. Le contrat courant est [Design de l’interface](design-interface.md). Ce document conserve la provenance, les licences et les mesures du sous-ensemble Twenty ; ses décisions graphiques initiales ci-dessous ne prévalent plus sur la nouvelle direction. Les sources, captures et notices acquises restent conservées.

## Référence et décision

L'interface reprend le design de Twenty, conformément au cadrage validé : couleurs, typographie, densité, hiérarchie, formes, états et interactions. La marque et les objets métier sont ceux de Memlia Cabinet. Aucune direction graphique alternative n'est introduite.

Source : dépôt officiel `twentyhq/twenty`, commit `e7743ba77003f3eab957cfcca8e760d383cde550`, paquet `packages/twenty-ui`, version source `2.49.0`. Le checkout de recherche est conservé hors du dépôt produit. Les fichiers intégrés au produit doivent avoir un manifeste avec leur chemin amont, leur empreinte SHA-256 et leurs adaptations.

La version `twenty-ui@2.49.0` n'est pas publiée sur le registre npm officiel au contrôle du 17 octobre 2026 (réponse 404). Pour conserver cette révision exacte, le démarrage utilise un sous-ensemble de sources MIT vendoriées dans `packages/ui`, plutôt qu'une version npm différente.

## Frontière de licence

- `packages/twenty-ui/LICENSE` : MIT, copyright `2023-present Twenty.com, PBC`. Conserver ce texte intégral auprès des sources et dans la distribution.
- Les composants applicatifs `twenty-front` ne sont pas couverts par ce fichier MIT. Leurs sources AGPL ne sont pas copiées dans le paquet UI sous une licence MIT. La navigation, les vues métier, les tableaux et les panneaux Memlia seront composés localement à partir des primitives MIT et des mesures documentées.
- Ne pas réutiliser les marques, logos Twenty ou logos des prestataires comme identité Memlia.
- Inter et DM Mono proviennent de paquets Fontsource, sous OFL-1.1. Leurs fichiers et notices sont distribués localement ; aucun appel Google Fonts ou CDN n'est nécessaire.
- Tabler et Base UI sont des dépendances MIT. Le verrou de dépendances doit figer les versions et intégrités ; les notices tierces accompagnent le paquet d'installation.

## Plus petite intégration fidèle

Le premier sous-ensemble couvre `Button`, `MainButton`, `Input`, `Checkbox`, `Text`, ainsi que `Loader` et `Shortcut` requis par leurs compositions. Il contient 49 sources TS/TSX/SCSS, deux thèmes CSS, trois abstractions Sass, deux outils de couche CSS et la licence amont. Les petits fichiers de types et contextes sont des dépendances réelles, pas des fichiers générés décoratifs.

Deux imports sont resserrés sans modifier le comportement : `Loader` importe directement `theme/themeCssVariables` au lieu du barrel complet ; `CheckboxComponent` importe `IconCheck` et `IconMinus` directement depuis Tabler, qui est leur origine dans Twenty. Cela évite de transporter l'ensemble des marques, illustrations et fournisseurs du CRM. Les styles des composants sont conservés à l'identique.

Les autres composants s'ajoutent seulement quand un écran en a besoin, avec leur véritable composition. En particulier, `Tag` utilise les tooltips d'overflow : l'amputer de ce comportement pour réduire artificiellement les sources n'est pas une intégration fidèle.

Inventaire initial des 49 sources, chemins relatifs à `packages/twenty-ui` :

```text
src/components/input/MainButton/MainButton.module.scss
src/components/input/MainButton/MainButton.tsx
src/primitives/feedback/Loader/Loader.module.scss
src/primitives/feedback/Loader/Loader.tsx
src/primitives/feedback/Loader/types/LoaderProps.ts
src/primitives/input/Button/Button.module.scss
src/primitives/input/Button/Button.tsx
src/primitives/input/Button/types/ButtonColor.ts
src/primitives/input/Button/types/ButtonLoadingPosition.ts
src/primitives/input/Button/types/ButtonProps.ts
src/primitives/input/Button/types/ButtonSize.ts
src/primitives/input/Button/types/ButtonVariant.ts
src/primitives/input/ButtonGroup/internal/ButtonGroupContext.ts
src/primitives/input/Checkbox/Checkbox.module.scss
src/primitives/input/Checkbox/Checkbox.tsx
src/primitives/input/Checkbox/internal/CheckboxComponent.tsx
src/primitives/input/Checkbox/internal/CheckboxIndicator.tsx
src/primitives/input/Checkbox/internal/CheckboxRoot.tsx
src/primitives/input/Checkbox/types/CheckboxColor.ts
src/primitives/input/Checkbox/types/CheckboxIndicatorProps.ts
src/primitives/input/Checkbox/types/CheckboxProps.ts
src/primitives/input/Checkbox/types/CheckboxRootProps.ts
src/primitives/input/Checkbox/types/CheckboxShape.ts
src/primitives/input/Checkbox/types/CheckboxSize.ts
src/primitives/input/Checkbox/types/CheckboxVariant.ts
src/primitives/input/Input/Input.module.scss
src/primitives/input/Input/Input.tsx
src/primitives/input/Input/types/InputProps.ts
src/primitives/input/InputGroup/internal/InputGroupContext.ts
src/primitives/input/types/InputSize.ts
src/primitives/typography/Shortcut/Shortcut.module.scss
src/primitives/typography/Shortcut/Shortcut.tsx
src/primitives/typography/Shortcut/internal/getShortcutPresentation.ts
src/primitives/typography/Shortcut/types/ShortcutDefinition.ts
src/primitives/typography/Shortcut/types/ShortcutFormatOptions.ts
src/primitives/typography/Shortcut/types/ShortcutProps.ts
src/primitives/typography/Text/Text.module.scss
src/primitives/typography/Text/Text.tsx
src/primitives/typography/Text/internal/TextTruncationProps.ts
src/primitives/typography/Text/types/TextProps.ts
src/theme/themeCssVariables.ts
src/utilities/device/getUserDevice.ts
src/utilities/internal/doNotTranslate.ts
src/utilities/internal/mergeClassNames.ts
src/utilities/responsive/constants/MobileMediaQuery.ts
src/utilities/responsive/hooks/useIsMobile.ts
src/utilities/responsive/hooks/useMediaQuery.ts
src/utilities/responsive/internal/getMediaQueryStore.ts
src/utilities/utils/isDefined.ts
```

Fichiers de support à intégrer sans altération des valeurs : `src/theme/theme-light.css`, `src/theme/theme-dark.css`, `src/styles/abstracts/_functions.scss`, `_mixins.scss`, `_breakpoints.scss`, `build-tools/wrapInTwentyUiCascadeLayer.ts`, `build-tools/twentyUiCascadeLayerName.ts` et `LICENSE`.

## Contrat de build

- React 19 et TypeScript strict, application Vite ; aucune dépendance au serveur ou au modèle CRM de Twenty.
- Dépendances d'exécution exactes du sous-ensemble : `@base-ui/react@1.9.0`, `@sniptt/guards@0.2.0`, `@tabler/icons-react@3.41.1`, `clsx@2.1.1`, plus React partagé avec l'application.
- Polices : `@fontsource/inter@5.2.8`, poids 400/500/600/700 ; `@fontsource/dm-mono@5.2.7`, poids 400/500. Les versions et licences déclarées ont été vérifiées sur le registre officiel. Il reste à inspecter les notices des octets installés lors de l'intégration.
- Sass compile les modules `.module.scss`, avec convention CSS Modules `camelCaseOnly`. Injecter les abstractions `functions`, `mixins` et `breakpoints` comme dans le build amont, et garder la couche `twenty-ui`. La conversion des styles en classes CSS locales ne doit pas changer les tokens.
- Les chemins internes `@ui/` doivent être résolus vers le sous-ensemble vendorié, ou réécrits en chemins relatifs avec cette seule transformation enregistrée. Aucun alias vers le checkout de recherche sur le poste du développeur ne doit subsister.
- Le paquet n'exporte que sa surface publique ; les pages métier importent `@memlia/ui`, pas les chemins internes amont.
- Ne pas embarquer Storybook, Monaco, les scripts de génération de tokens, le monorepo Twenty ou ses exemples. Ils ne sont pas nécessaires à ce sous-ensemble.

## Géométrie et comportement de référence

| Élément | Référence |
| --- | --- |
| Racine | Inter, 13 px ; échelle utilisateur explicite |
| Espacement | multiples de 4 px, demi-pas 2 et 6 px |
| Navigation | 220 px ; bornes 180–350 px ; repli 48 px |
| Ligne de navigation | 28 px, états actif et survol distincts |
| Ligne de tableau | 32 px ; colonne de sélection 32 px ; padding horizontal 8 px |
| Panneau de fiche | 400 px par défaut ; bornes 320–600 px |
| En-tête applicatif | 48 px |
| Bouton | 32 px, petit 24 px ; styles et états amont |
| Modales | petits formats 300/360/400 px ; adaptation au contenu et au viewport |

Les thèmes `.light` et `.dark` gardent leurs couleurs Display-P3, transparences, ombres, textures encodées et tokens sémantiques. Aucun arrondi de palette vers des hex approximatifs. Les rayons changent lorsque le navigateur supporte `corner-shape: squircle` : conserver les règles `@supports` amont.

La navigation métier doit couvrir tout le périmètre validé : accueil, dossiers, contacts, équipe/affectations, échéances et campagnes, tâches, collecte/GED, échanges fiscaux et sociaux, onboarding, bilans/contrôles, CRM/lettres, temps/charge, robots, administration et assistant local. Les fonctions exclues au cadrage restent exclues. Le design ne réduit pas le périmètre.

## Vérification de fidélité

1. Contrôler les empreintes des sources vendoriées et limiter les différences aux adaptations déclarées.
2. Comparer composants et écrans aux références Twenty au même navigateur, viewport, échelle et police chargée ; contrôler clair et sombre.
3. Vérifier les états vides, chargement, erreur, sélection, survol, focus clavier, désactivation, débordement et réduction des animations.
4. Tester navigation clavier, noms accessibles, ordre de focus et limites des panneaux ; les seules captures ne prouvent pas ces comportements.
5. Ne déclarer la fidélité visuelle vérifiée qu'après observation du rendu. Les sources exactes sont un point de départ, pas une mesure de pixels déjà acquise.

## Provenance consultée

- [Licence MIT Twenty UI](https://github.com/twentyhq/twenty/blob/e7743ba77003f3eab957cfcca8e760d383cde550/packages/twenty-ui/LICENSE)
- [Paquet et exports](https://github.com/twentyhq/twenty/blob/e7743ba77003f3eab957cfcca8e760d383cde550/packages/twenty-ui/package.json)
- [Build Sass/CSS officiel](https://github.com/twentyhq/twenty/blob/e7743ba77003f3eab957cfcca8e760d383cde550/packages/twenty-ui/vite.config.ts)
- [Thème clair](https://github.com/twentyhq/twenty/blob/e7743ba77003f3eab957cfcca8e760d383cde550/packages/twenty-ui/src/theme/theme-light.css) et [thème sombre](https://github.com/twentyhq/twenty/blob/e7743ba77003f3eab957cfcca8e760d383cde550/packages/twenty-ui/src/theme/theme-dark.css)

Préparation le 17 octobre 2026. À ce stade de la préparation, aucun composant n'a encore été intégré et aucune fidélité de rendu exécuté n'est revendiquée.
