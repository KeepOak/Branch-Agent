// Fail a PR that adds raster images outside the app's real asset folders.
// Proof screenshots belong on an orphan proof/<head-branch> branch, not on the PR.

export const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp)$/i;

export const DENIED_IMAGE_PREFIXES = [
  'docs/proof/',
  'engine/.github/pr-proof/',
];

/** Folders that already ship product icons, art, and fixtures. */
export const ALLOWED_IMAGE_PREFIXES = [
  'assets/',
  'desktop/assets/',
  'engine/docs/assets/',
  'engine/docs/images/',
  'engine/test/fixtures/',
  'engine/ui/public/',
  'engine/ui/src/assets/',
  'window/public/',
  'window/src/places/office/pixel/',
  'window/src/setup/art/',
];

/** Existing top-level docs images that are not under assets/ or images/. */
export const ALLOWED_IMAGE_FILES = new Set([
  'engine/docs/whatsapp-branch.jpg',
]);

const PROOF_DIR = /(^|\/)proof\//;

export function posixPath(filePath) {
  return String(filePath ?? '').replaceAll('\\', '/');
}

export function isRasterImagePath(filePath) {
  return IMAGE_EXT.test(posixPath(filePath));
}

export function isExtensionAssetImage(filePath) {
  return /^engine\/extensions\/.+\/(?:assets|icons|__fixtures__)(?:\/|$)/.test(posixPath(filePath));
}

export function isDeniedProofImagePath(filePath) {
  const posix = posixPath(filePath);
  if (DENIED_IMAGE_PREFIXES.some((prefix) => posix.startsWith(prefix))) return true;
  return PROOF_DIR.test(posix);
}

export function isAllowedImagePath(filePath) {
  const posix = posixPath(filePath);
  if (!posix || isDeniedProofImagePath(posix)) return false;
  if (ALLOWED_IMAGE_FILES.has(posix)) return true;
  if (ALLOWED_IMAGE_PREFIXES.some((prefix) => posix.startsWith(prefix))) return true;
  return isExtensionAssetImage(posix);
}

export function addedPathsFromFiles(files) {
  return files.flatMap((file) => {
    if (typeof file === 'string') return [posixPath(file)];
    const status = file?.status;
    const name = posixPath(file?.filename);
    if (!name) return [];
    if (status == null || status === 'added' || status === 'renamed' || status === 'copied') {
      return [name];
    }
    if (typeof status === 'string' && /^(?:A|R\d*|C\d*)$/.test(status)) return [name];
    return [];
  });
}

export function blockedAddedImages(files) {
  return addedPathsFromFiles(files).filter((file) => isRasterImagePath(file) && !isAllowedImagePath(file));
}

export function checkAddedImagePaths(files) {
  const blocked = blockedAddedImages(files);
  if (blocked.length === 0) {
    return { exitCode: 0, message: 'No disallowed image additions.' };
  }
  return {
    exitCode: 1,
    message: [
      'This PR adds image files outside the allowed asset folders:',
      ...blocked.map((file) => `  - ${file}`),
      '',
      'Proof screenshots belong on a separate orphan branch named proof/<head-branch>,',
      'with files only under proof/. Embed a SHA-pinned raw URL in the PR body:',
      '  https://raw.githubusercontent.com/KeepOak/Branch-Agent/<40-char-sha>/proof/<file>.png',
      'GitHub attachment URLs (https://github.com/user-attachments/assets/...) are also accepted.',
      'Do not commit screenshots to the PR branch. See AGENTS.md.',
    ].join('\n'),
  };
}
