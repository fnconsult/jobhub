// Metro bundles the app (ADR-0076) with Sentry's additions, so a release's crash reports map back to its sources (#703).
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
