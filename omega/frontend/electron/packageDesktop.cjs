const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

module.exports = async function beforePack(context) {
  const source = path.resolve(__dirname, '../..');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-desktop-package-'));
  const destination = path.join(staging, 'omega');
  execFileSync(process.env.OMEGA_BUILD_PYTHON || 'python', [path.join(source, 'scripts/build_desktop_payload.py'),
    '--source', source, '--destination', destination], { stdio: 'inherit', windowsHide: true });
  const anchor = fs.readFileSync(path.join(destination, 'frontend/electron/securityHardening.js'), 'utf8')
    .match(/TRUSTED_PUBLIC_KEY = '([^']+)'/)[1];
  context.packager.config.extraMetadata = { ...context.packager.config.extraMetadata, omegaIntegrityPublicKey: anchor };
  context.packager.config.extraResources = [
    { from: 'build', to: 'build', filter: ['icon.ico', 'icon.png'] },
    { from: destination, to: 'omega' },
  ];
};
