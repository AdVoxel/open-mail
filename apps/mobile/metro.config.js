const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// Expo detects the npm workspace, so the shared packages resolve without extra config.
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./globals.css" });
