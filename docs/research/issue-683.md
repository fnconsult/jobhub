# Recherche #683 : socle `apps/mobile` (Expo)

Sources : métadonnées et code publiés des paquets npm (registre npm, 2026-11-04). Les sites docs.expo.dev et lucide.dev sont inaccessibles depuis la session (hôtes hors liste réseau) : les points de documentation non vérifiés sont listés en fin de fichier.

## Constat bloquant : iOS 15.1+ incompatible avec le SDK Expo courant

- `expo@latest` = 58.0.23 (`npm view expo`), avec `react-native` 0.88.1, `react` 19.3.0 (`bundledNativeModules.json` du paquet `expo`).
- `ExpoModulesCore.podspec` déclare `:ios => '16.4'` pour `expo-modules-core` 58.0.30, 57.0.24 et 56.0.27, mais `'15.1'` pour 55.0.27. Le dernier SDK compatible avec iOS 15.1 est donc le SDK 55.
- React Native 0.88.1 seul accepte iOS 15.1 (`scripts/cocoapods/helpers.rb` : `min_ios_version_supported` = `'15.1'`, Xcode 16.1 minimum), mais c'est Expo qui relève le plancher.
- Android : `minSdk` 24 pour React Native 0.88.1 (`gradle/libs.versions.toml`) et valeur par défaut 24 dans `ExpoModulesCorePlugin.gradle`. Android 7+ (API 24) est compatible.

Décision à prendre avant de coder : soit viser iOS 16.4+ avec le SDK courant (modifier le critère « iOS/iPadOS 15.1+ »), soit épingler le SDK 55 (et sa fin de support à surveiller). Ne pas fixer `ios.deploymentTarget: 15.1` sur le SDK 58 : le build échouerait.

## Versions alignées avec le SDK 58 (`bundledNativeModules.json`)

`expo-router ~58.0.30`, `expo-font ~58.0.11`, `expo-localization ~58.0.5`, `react-native-svg 15.16.0`.

## Lucide

`lucide-react-native` 1.68.0 : peerDependencies `react` (16.5 à 19), `react-native`, `react-native-svg ^12 à ^15` (registre npm). Il faut donc installer `react-native-svg` (version épinglée par Expo, ci-dessus). Compatible avec 15.16.0.

## Inter embarquée

`@expo-google-fonts/inter` 0.4.2 existe sur npm ; l'embarquement natif via le plugin de config `expo-font` n'a pas pu être confirmé dans la doc officielle.

## Non vérifié (docs inaccessibles)

- Configuration Metro automatique en monorepo npm workspaces (SDK 52+ d'après la mémoire, à confirmer).
- Syntaxe exacte du plugin `expo-font` et des options `orientation` / `supportsTablet` dans `app.json`.
- Comportement Dynamic Type / `fontScale` (API React Native `PixelRatio.getFontScale`, `useWindowDimensions`).
