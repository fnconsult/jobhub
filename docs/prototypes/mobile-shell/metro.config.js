// PROTOTYPE (throwaway, branch prototype/mobile-shell): lets Metro read the real design tokens from packages/shared.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.join(repoRoot, "packages/shared/src/design")];
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];
module.exports = config;
