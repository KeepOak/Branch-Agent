// Expo config plugin that prevents fallback to debug signing in release builds.
// When REQUIRE_ANDROID_RELEASE_SIGNING=1, the release build fails with a clear message
// if the injected signing properties are missing, instead of silently using the debug keystore.
const { withAppBuildGradle } = require('@expo/config-plugins');

const withAndroidReleaseSigningRequired = (config) => {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Find the buildTypes block and inject the fail-closed check
    const buildTypesPattern = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?\n\s*\}[\s\S]*?\n\s*\})/;
    
    if (!buildTypesPattern.test(contents)) {
      throw new Error('Could not find buildTypes block in app/build.gradle');
    }

    // Inject afterEvaluate block that enforces release signing when required
    const injectedCheck = `

    // Fail-closed: no debug signing fallback when release signing is required (withAndroidReleaseSigningRequired.js)
    afterEvaluate {
        def requireReleaseSigning = (System.getenv('REQUIRE_ANDROID_RELEASE_SIGNING') ?: '') == '1'
        if (!requireReleaseSigning) {
            return
        }
        
        def storeFile = project.findProperty('android.injected.signing.store.file')
        def storePassword = project.findProperty('android.injected.signing.store.password')
        def keyAlias = project.findProperty('android.injected.signing.key.alias')
        def keyPassword = project.findProperty('android.injected.signing.key.password')
        
        def missing = [storeFile, storePassword, keyAlias, keyPassword].any { it == null || it.toString().trim().isEmpty() }
        if (missing) {
            throw new GradleException('Release signing is required (REQUIRE_ANDROID_RELEASE_SIGNING=1) but signing properties are missing. The build must fail and never fall back to debug signing.')
        }
        
        // Explicitly set release signing config and ensure it's not debug
        if (android.signingConfigs.hasProperty('release')) {
            android.buildTypes.release.signingConfig = android.signingConfigs.release
        } else {
            throw new GradleException('Release signing config not found but REQUIRE_ANDROID_RELEASE_SIGNING=1')
        }
    }
`;

    // Append after the android block
    const androidBlockPattern = /(android\s*\{[\s\S]*?\n\})/;
    contents = contents.replace(androidBlockPattern, (match) => `${match}${injectedCheck}`);

    config.modResults.contents = contents;
    return config;
  });
};

module.exports = withAndroidReleaseSigningRequired;
