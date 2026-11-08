// O node-pty 1.1.0 publica o spawn-helper do macOS sem permissão de execução,
// e sem ela todo spawn falha com "posix_spawnp failed". Corrige depois do install
// e antes do dist:mac (o electron-builder copia o arquivo com a permissão que ele
// tiver). Idempotente e nunca derruba o install.
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') process.exit(0);

const prebuilds = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
for (const pasta of ['darwin-arm64', 'darwin-x64']) {
  const helper = path.join(prebuilds, pasta, 'spawn-helper');
  try {
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  } catch (erro) {
    console.warn(`[permissaoDoPty] Não deu para liberar ${helper}: ${erro.message}`);
  }
}
