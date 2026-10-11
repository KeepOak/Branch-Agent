// Expo's preset, plus TypeScript `declare` class fields: the engine's gateway client source uses them
// (engine-modules.js compiles it from source), and Babel strips them only when told to. The tests are
// functions, as in babel-preset-expo, because Metro also loads this config without a file name.
const isTs = (fileName) => !!fileName && fileName.endsWith('.ts');
const isTsx = (fileName) => !!fileName && fileName.endsWith('.tsx');

module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    overrides: [
      { test: isTs, plugins: [['@babel/plugin-transform-typescript', { allowDeclareFields: true, allowNamespaces: true }]] },
      { test: isTsx, plugins: [['@babel/plugin-transform-typescript', { allowDeclareFields: true, allowNamespaces: true, isTSX: true }]] },
    ],
  };
};
