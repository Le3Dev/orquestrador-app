// Vigia do servidor: sobe o Orquestrador de agentes e o religa sozinho se ele
// cair por erro. Fechar a janela ou apertar Ctrl+C desliga de vez.
//
// Uso: node scripts/manter-no-ar.cjs   (o iniciar-orquestrador.cmd já usa)
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const PASTA_DO_APP = path.resolve(__dirname, "..");
const ESPERA_INICIAL_MS = 2_000;
const ESPERA_MAXIMA_MS = 30_000;
// Quedas demais em pouco tempo indicam um problema que religar não resolve
// (porta ocupada, build quebrado): melhor parar e mostrar o erro.
const JANELA_DE_QUEDAS_MS = 2 * 60_000;
const QUEDAS_PARA_DESISTIR = 5;

let encerrando = false;
let servidor = null;
const quedas = [];

const hora = () => new Date().toLocaleTimeString("pt-BR");

function subir() {
  servidor = spawn(process.execPath, ["--env-file-if-exists=.env", "dist/root.js"], {
    cwd: PASTA_DO_APP,
    stdio: "inherit",
  });

  servidor.on("exit", (codigo, sinal) => {
    servidor = null;
    // Código 0 é desligamento pedido (Ctrl+C trata o SIGINT e sai limpo).
    if (encerrando || codigo === 0) {
      process.exit(codigo ?? 0);
    }

    const agora = Date.now();
    quedas.push(agora);
    while (quedas.length > 0 && agora - quedas[0] > JANELA_DE_QUEDAS_MS) {
      quedas.shift();
    }
    if (quedas.length >= QUEDAS_PARA_DESISTIR) {
      console.error(
        `[vigia ${hora()}] O servidor caiu ${quedas.length} vezes em 2 minutos. Parei de religar: veja os erros acima.`,
      );
      process.exit(1);
    }

    const espera = Math.min(ESPERA_MAXIMA_MS, ESPERA_INICIAL_MS * 2 ** (quedas.length - 1));
    console.warn(
      `[vigia ${hora()}] O servidor caiu (${sinal ?? `código ${codigo}`}). Religando em ${espera / 1000}s…`,
    );
    setTimeout(subir, espera);
  });
}

function encerrar() {
  encerrando = true;
  if (servidor === null) {
    process.exit(0);
  }
  // No Windows o Ctrl+C já chega a todos os processos da janela; nos outros
  // sistemas, repassamos.
  if (process.platform !== "win32") {
    servidor.kill("SIGINT");
  }
}

process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);

console.log(`[vigia ${hora()}] Subindo o servidor. Se ele cair por erro, eu religo sozinho.`);
subir();
