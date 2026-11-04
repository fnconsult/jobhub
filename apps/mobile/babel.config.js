// Metro and Jest compile the app, and the @jobhub/shared sources it imports, with Expo's preset.
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
