// Config plugin: give the generated android/app/build.gradle a real release signingConfig
// that reads ANDROID_KEYSTORE_* from the environment. android/ is produced by prebuild and
// never committed, so this has to live here. AGP's injected -P signing is all-or-nothing and
// the Expo template otherwise signs release with the debug keystore.
const { withAppBuildGradle } = require('expo/config-plugins');

const KEYSTORE_PATH_ENV = 'ANDROID_KEYSTORE_PATH';
const MISSING_RELEASE_SIGNING =
  'Release signing is not configured. The job must fail and never fall back to debug signing.';

function matchingCloseBrace(source, openBrace) {
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('withReleaseSigning: unbalanced braces in android/app/build.gradle');
}

function findNamedBlock(source, name, from = 0, until = source.length) {
  const re = new RegExp(String.raw`\b${name}\s*\{`, 'g');
  re.lastIndex = from;
  const match = re.exec(source);
  if (!match || match.index >= until) return null;
  const openBrace = match.index + match[0].length - 1;
  const closeBrace = matchingCloseBrace(source, openBrace);
  return { start: match.index, openBrace, closeBrace };
}

function indentOf(source, index) {
  let lineStart = index;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart -= 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, index));
  return match ? match[0] : '        ';
}

function releaseSigningConfigBlock(indent) {
  const p = `${indent}    `;
  return `${indent}release {
${p}def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
${p}def keystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
${p}def releaseKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
${p}def releaseKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")
${p}def requireReleaseSigning = System.getenv("REQUIRE_ANDROID_RELEASE_SIGNING") == "1"
${p}def hasReleaseKeystore = keystorePath != null && !keystorePath.isEmpty() && keystorePassword != null && !keystorePassword.isEmpty() && releaseKeyAlias != null && !releaseKeyAlias.isEmpty() && releaseKeyPassword != null && !releaseKeyPassword.isEmpty()
${p}if (requireReleaseSigning && !hasReleaseKeystore) {
${p}    throw new GradleException("${MISSING_RELEASE_SIGNING}")
${p}}
${p}if (hasReleaseKeystore) {
${p}    storeFile file(keystorePath)
${p}    storePassword keystorePassword
${p}    keyAlias releaseKeyAlias
${p}    keyPassword releaseKeyPassword
${p}    storeType "PKCS12"
${p}    enableV1Signing true
${p}    enableV2Signing true
${p}} else {
${p}    initWith signingConfigs.debug
${p}}
${indent}}`;
}

function insertReleaseSigningConfig(contents) {
  const signing = findNamedBlock(contents, 'signingConfigs');
  if (!signing) {
    throw new Error('withReleaseSigning: android/app/build.gradle has no signingConfigs block');
  }
  const existing = findNamedBlock(contents, 'release', signing.openBrace + 1, signing.closeBrace);
  if (existing && contents.slice(existing.openBrace, existing.closeBrace).includes(KEYSTORE_PATH_ENV)) {
    return contents;
  }
  const debug = findNamedBlock(contents, 'debug', signing.openBrace + 1, signing.closeBrace);
  const indent = debug ? indentOf(contents, debug.start) : `${indentOf(contents, signing.start)}    `;
  const block = releaseSigningConfigBlock(indent);
  if (existing) {
    return contents.slice(0, existing.start) + block + contents.slice(existing.closeBrace + 1);
  }
  const beforeClose = contents.slice(0, signing.closeBrace).replace(/\s*$/, '\n');
  return `${beforeClose}${block}\n${indentOf(contents, signing.closeBrace)}${contents.slice(signing.closeBrace)}`;
}

function rewriteReleaseBuildTypeSigning(contents) {
  const buildTypes = findNamedBlock(contents, 'buildTypes');
  if (!buildTypes) {
    throw new Error('withReleaseSigning: android/app/build.gradle has no buildTypes block');
  }
  const release = findNamedBlock(contents, 'release', buildTypes.openBrace + 1, buildTypes.closeBrace);
  if (!release) {
    throw new Error('withReleaseSigning: android/app/build.gradle has no buildTypes.release block');
  }
  const body = contents.slice(release.openBrace + 1, release.closeBrace);
  if (/\bsigningConfig\s+signingConfigs\.release\b/.test(body)
    && !/\bsigningConfig\s+signingConfigs\.debug\b/.test(body)) {
    return contents;
  }
  let nextBody = body.replace(
    /\bsigningConfig\s+signingConfigs\.debug\b/,
    'signingConfig signingConfigs.release',
  );
  if (nextBody === body) {
    const innerIndent = `${indentOf(contents, release.start)}    `;
    nextBody = `\n${innerIndent}signingConfig signingConfigs.release${body}`;
  }
  if (/\bsigningConfig\s+signingConfigs\.debug\b/.test(nextBody)) {
    throw new Error('withReleaseSigning: buildTypes.release still uses signingConfigs.debug');
  }
  if (!/\bsigningConfig\s+signingConfigs\.release\b/.test(nextBody)) {
    throw new Error('withReleaseSigning: buildTypes.release is missing signingConfigs.release');
  }
  return contents.slice(0, release.openBrace + 1) + nextBody + contents.slice(release.closeBrace);
}

function applyReleaseSigningGradle(contents) {
  return rewriteReleaseBuildTypeSigning(insertReleaseSigningConfig(String(contents ?? '')));
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = applyReleaseSigningGradle(mod.modResults.contents);
    return mod;
  });
}

module.exports = withReleaseSigning;
module.exports.applyReleaseSigningGradle = applyReleaseSigningGradle;
module.exports.MISSING_RELEASE_SIGNING = MISSING_RELEASE_SIGNING;
