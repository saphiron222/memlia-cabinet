# Modifier les sources Propel distribuées

L’archive de source correspondant contient le paquet public exact `@makeplane/propel@0.7.3`, identifié par le verrou, ses CSS/assets et ses maps. Les1620modules JavaScript munis d’une map ont chacun une source originale complète (`sourcesContent`) : leurs textes TypeScript/TSX préférés sont récupérés sous `third-party/propel-0.7.3/recovered-source/src`. Les127modules sans map sont surtout des barrels d’exports générés ; leur JavaScript distribué reste fourni et éditable. Aucune source TS inexistante n’est inventée pour eux.

La reconstruction normale du frontend utilise ce paquet verrouillé. Pour modifier réellement les modules Propel, depuis la racine extraite après `npm ci --ignore-scripts` :

```sh
node scripts/prepare-propel-source.mjs
npm exec --workspace @memlia/web -- vite build --configLoader native --config vite.propel-source.config.ts
```

Le premier script crée une copie éditable sous `third-party/propel-0.7.3/editable-source`, remplace chaque module mappé par son source original exact et conserve les barrels, CSS et assets publiés. Il refuse d’écraser une copie déjà créée. Modifier ensuite les TS/TSX, CSS ou barrels dans cette copie, puis relancer seulement la deuxième commande. Le fichier de configuration généré raccorde les imports Propel au source éditable via Vite et garde les dépendances verrouillées du frontend. Le build redistribue cette copie éditée et sa configuration avec le source correspondant ; aucune modification de paquet ou du produit source extérieur n’est requise.

Cette commande a été exécutée dans une extraction isolée et compile effectivement les modules source utilisés par Memlia. Elle constitue un adaptateur de construction Memlia, **pas la reconstruction indépendante du paquet npm original** : son output peut différer. Le tarball officiel ne fournit pas la configuration `tsdown`, le `tsconfig` amont, les scripts de génération d’icônes ni les configurations Storybook mentionnés par ses scripts. Nous ne prétendons ni reproduire leur génération de déclarations/package ni leur campagne de tests. Les icônes/CSS/assets fournis restent utilisables et modifiables directement. Les notices AGPL d’origine et la provenance du paquet demeurent conservées.
