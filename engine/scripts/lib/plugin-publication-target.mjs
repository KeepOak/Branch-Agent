/** The source manifest owns publication eligibility, including bundled-only deferral. */
export function isPluginPublicationEnabled(packageJson, target) {
  return (
    packageJson.branch?.build?.bundledDist !== true &&
    (target === "npm"
      ? packageJson.branch?.release?.publishToNpm === true
      : packageJson.branch?.release?.publishToClawHub === true)
  );
}
