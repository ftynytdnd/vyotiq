/**
 * electron-builder `afterPack` hook — flip Electron fuses on the packaged
 * binary BEFORE code signing / notarization.
 */

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPackFlipFuses(context) {
  const { appOutDir, packager } = context;
  const name = packager.appInfo.productFilename;
  let binary;

  if (packager.platform.name === 'mac') {
    binary = path.join(appOutDir, `${name}.app`, 'Contents', 'MacOS', name);
  } else if (packager.platform.name === 'windows') {
    binary = path.join(appOutDir, `${name}.exe`);
  } else {
    binary = path.join(appOutDir, name);
  }

  if (!existsSync(binary)) {
    throw new Error(`[afterPackFlipFuses] Packaged binary not found: ${binary}`);
  }

  const script = path.join(__dirname, 'flipFuses.mjs');
  const result = spawnSync(process.execPath, [script, binary], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`[afterPackFlipFuses] flipFuses exited with code ${result.status ?? 'unknown'}`);
  }
};
