"use strict";

// Calcula a próxima versão a publicar: maior tag vX.Y.Z (+1 no patch) ou a
// version do package.json quando ela for maior que a maior tag.

const ESTRITA = /^(\d+)\.(\d+)\.(\d+)$/;
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function comparar(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function proximaVersao(versaoDoPackage, tags) {
  const m = ESTRITA.exec(String(versaoDoPackage).trim());
  if (!m) {
    throw new Error(`Versão inválida no package.json: "${versaoDoPackage}" (esperado X.Y.Z)`);
  }
  const pkg = [Number(m[1]), Number(m[2]), Number(m[3])];

  let maior = null;
  for (const t of tags || []) {
    const r = TAG.exec(String(t).trim());
    if (!r) continue;
    const v = [Number(r[1]), Number(r[2]), Number(r[3])];
    if (!maior || comparar(v, maior) > 0) maior = v;
  }

  if (!maior || comparar(pkg, maior) > 0) return pkg.join(".");
  return [maior[0], maior[1], maior[2] + 1].join(".");
}

module.exports = { proximaVersao };

if (require.main === module) {
  const { execFileSync } = require("node:child_process");
  const path = require("node:path");
  const versao = require(path.join(process.cwd(), "package.json")).version;
  const saida = execFileSync("git", ["tag", "-l", "v*"], { encoding: "utf8" });
  const tags = saida.split(/\r?\n/).filter(Boolean);
  try {
    process.stdout.write(proximaVersao(versao, tags) + "\n");
  } catch (e) {
    process.stderr.write(e.message + "\n");
    process.exit(1);
  }
}
