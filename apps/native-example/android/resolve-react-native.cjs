const { createRequire } = require("node:module");
const path = require("node:path");

// Resolve from the example, then from React Native's own dependencies. This
// supports both hoisted installs and pnpm's isolated node_modules layout.
const appRequire = createRequire(path.resolve(__dirname, "../package.json"));
const reactNativePackage = appRequire.resolve("react-native/package.json");
const reactNativeRequire = createRequire(reactNativePackage);
const packageJson =
  process.argv[2] === "react-native"
    ? reactNativePackage
    : reactNativeRequire.resolve(`${process.argv[2]}/package.json`);
process.stdout.write(path.dirname(packageJson));
