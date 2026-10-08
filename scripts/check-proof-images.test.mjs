import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockedAddedImages,
  checkAddedImagePaths,
  isAllowedImagePath,
  isDeniedProofImagePath,
  isRasterImagePath,
} from './check-proof-images.mjs';

test('isRasterImagePath matches common screenshot extensions', () => {
  assert.equal(isRasterImagePath('shot.png'), true);
  assert.equal(isRasterImagePath('shot.JPG'), true);
  assert.equal(isRasterImagePath('shot.jpeg'), true);
  assert.equal(isRasterImagePath('shot.gif'), true);
  assert.equal(isRasterImagePath('shot.webp'), true);
  assert.equal(isRasterImagePath('shot.svg'), false);
  assert.equal(isRasterImagePath('readme.md'), false);
});

test('isDeniedProofImagePath rejects docs/proof and any proof/ folder', () => {
  assert.equal(isDeniedProofImagePath('docs/proof/side-panel.png'), true);
  assert.equal(isDeniedProofImagePath('engine/.github/pr-proof/before.png'), true);
  assert.equal(isDeniedProofImagePath('proof/changed-panel.png'), true);
  assert.equal(isDeniedProofImagePath('assets/proof/hidden.png'), true);
  assert.equal(isDeniedProofImagePath('assets/logo/mark.png'), false);
});

test('isAllowedImagePath allowlists existing product asset folders', () => {
  assert.equal(isAllowedImagePath('assets/logo/mark.png'), true);
  assert.equal(isAllowedImagePath('desktop/assets/brand/keepoak-app-icon-32.png'), true);
  assert.equal(isAllowedImagePath('engine/docs/assets/branch-banner-dark.png'), true);
  assert.equal(isAllowedImagePath('engine/docs/images/feishu-get-group-id.png'), true);
  assert.equal(isAllowedImagePath('engine/docs/whatsapp-branch.jpg'), true);
  assert.equal(isAllowedImagePath('engine/extensions/browser/assets/icon.png'), true);
  assert.equal(isAllowedImagePath('engine/extensions/browser/chrome-extension/icons/16.png'), true);
  assert.equal(isAllowedImagePath('engine/extensions/whatsapp/src/__fixtures__/media.png'), true);
  assert.equal(isAllowedImagePath('engine/ui/public/app-art/hero.png'), true);
  assert.equal(isAllowedImagePath('window/public/pebble/talk-body-0.webp'), true);
  assert.equal(isAllowedImagePath('window/src/setup/art/hero.png'), true);
  assert.equal(isAllowedImagePath('window/src/places/office/pixel/upstream-assets/floors/wood.png'), true);
});

test('isAllowedImagePath rejects screenshots and other new image locations', () => {
  assert.equal(isAllowedImagePath('docs/proof/side-panel.png'), false);
  assert.equal(isAllowedImagePath('docs/screenshot.png'), false);
  assert.equal(isAllowedImagePath('engine/docs/my-proof.png'), false);
  assert.equal(isAllowedImagePath('window/src/composer/shot.png'), false);
  assert.equal(isAllowedImagePath('scripts/demo.png'), false);
});

test('checkAddedImagePaths fails added screenshots under docs/proof', () => {
  const result = checkAddedImagePaths(['docs/proof/side-panel-preview-vs-app.png']);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /docs\/proof\/side-panel-preview-vs-app\.png/);
  assert.match(result.message, /proof\/<head-branch>/);
  assert.match(result.message, /raw\.githubusercontent\.com\/KeepOak\/Branch-Agent/);
});

test('checkAddedImagePaths fails added images at unknown paths', () => {
  const result = checkAddedImagePaths([
    { filename: 'window/src/composer/Composer.tsx', status: 'modified' },
    { filename: 'notes/demo.png', status: 'added' },
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /notes\/demo\.png/);
});

test('checkAddedImagePaths allows additions under real asset folders', () => {
  const result = checkAddedImagePaths([
    { filename: 'assets/logo/new-mark.png', status: 'added' },
    { filename: 'window/public/pebble/new-pose.webp', status: 'added' },
    { filename: 'engine/extensions/slack/assets/icon.png', status: 'added' },
  ]);
  assert.equal(result.exitCode, 0);
});

test('checkAddedImagePaths ignores modifications of existing disallowed images', () => {
  const result = checkAddedImagePaths([
    { filename: 'docs/proof/side-panel-preview-vs-app.png', status: 'modified' },
  ]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(blockedAddedImages([
    { filename: 'docs/proof/side-panel-preview-vs-app.png', status: 'modified' },
  ]), []);
});

test('checkAddedImagePaths treats a rename onto a disallowed path as an addition', () => {
  const result = checkAddedImagePaths([
    { filename: 'docs/proof/moved.png', status: 'renamed', previous_filename: 'assets/logo/mark.png' },
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /docs\/proof\/moved\.png/);
});

test('checkAddedImagePaths ignores non-image additions', () => {
  const result = checkAddedImagePaths(['docs/proof/README.md', 'notes/demo.svg']);
  assert.equal(result.exitCode, 0);
});
