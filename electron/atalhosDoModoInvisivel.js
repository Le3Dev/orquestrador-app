"use strict";

// Atalhos globais do modo invisível ("modo fantasma"). Regras puras, sem
// Electron: globalShortcut e os tratadores são injetados para permitir teste.
//
// Escopo "sempre": registrado do ready até o will-quit (alternar visibilidade).
// Escopo "modo": registrado ao entrar no modo invisível e solto ao sair.
// Enquanto o overlay está oculto, os atalhos "modo" não fazem nada, exceto
// `sair` (Ctrl+Shift+I), que sempre funciona.
//
// Teclas conforme o Accelerator do Electron: "Plus"/"=" , "numadd", "numsub",
// "Space", "PageUp", "PageDown", "Up"... e o "\\" é pontuação aceita.

const ACOES_DO_ATALHO = Object.freeze([
  "responder-agora",
  "focar-campo",
  "mover-cima",
  "mover-baixo",
  "mover-esquerda",
  "mover-direita",
  "rolar-acima",
  "rolar-abaixo",
  "opacidade-mais",
  "opacidade-menos",
]);

// tipo: "alternar" | "sair" | "capturar" | "focar" | "acao" (envia `acao` à tela)
const TABELA_DE_ATALHOS = Object.freeze(
  [
    { acelerador: "CommandOrControl+\\", tipo: "alternar", escopo: "sempre" },
    { acelerador: "CommandOrControl+Shift+I", tipo: "sair", escopo: "modo" },
    { acelerador: "CommandOrControl+Shift+S", tipo: "capturar", escopo: "modo" },
    { acelerador: "CommandOrControl+Shift+Enter", tipo: "acao", acao: "responder-agora", escopo: "modo" },
    { acelerador: "CommandOrControl+Shift+Space", tipo: "focar", acao: "focar-campo", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+Up", tipo: "acao", acao: "mover-cima", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+Down", tipo: "acao", acao: "mover-baixo", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+Left", tipo: "acao", acao: "mover-esquerda", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+Right", tipo: "acao", acao: "mover-direita", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+PageUp", tipo: "acao", acao: "rolar-acima", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+PageDown", tipo: "acao", acao: "rolar-abaixo", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+=", tipo: "acao", acao: "opacidade-mais", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+numadd", tipo: "acao", acao: "opacidade-mais", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+-", tipo: "acao", acao: "opacidade-menos", escopo: "modo" },
    { acelerador: "CommandOrControl+Alt+numsub", tipo: "acao", acao: "opacidade-menos", escopo: "modo" },
  ].map((item) => Object.freeze(item)),
);

// tratadores: { alternar, sair, capturar, focar, enviarAcao(acao), estaOculto() }
function criarAtalhosDoModoInvisivel({ globalShortcut, tratadores, registrarNoLog = () => undefined, tabela = TABELA_DE_ATALHOS }) {
  function tratadorDe(item) {
    if (item.tipo === "alternar") return () => tratadores.alternar();
    if (item.tipo === "sair") return () => tratadores.sair();
    return () => {
      if (tratadores.estaOculto()) return;
      if (item.tipo === "capturar") tratadores.capturar();
      else if (item.tipo === "focar") tratadores.focar();
      else tratadores.enviarAcao(item.acao);
    };
  }

  function registrar(escopo) {
    for (const item of tabela) {
      if (item.escopo !== escopo) continue;
      try {
        if (!globalShortcut.register(item.acelerador, tratadorDe(item))) {
          registrarNoLog("app", `Não foi possível registrar o atalho ${item.acelerador} (em uso por outro app?).`);
        }
      } catch (erro) {
        registrarNoLog("app", `Falha ao registrar o atalho ${item.acelerador}: ${erro.message || erro}`);
      }
    }
  }

  function desregistrar(escopo) {
    for (const item of tabela) {
      if (item.escopo !== escopo) continue;
      try {
        globalShortcut.unregister(item.acelerador);
      } catch {
        /* ignora */
      }
    }
  }

  return {
    registrarPermanentes: () => registrar("sempre"),
    registrarDoModo: () => registrar("modo"),
    desregistrarDoModo: () => desregistrar("modo"),
  };
}

module.exports = { criarAtalhosDoModoInvisivel, TABELA_DE_ATALHOS, ACOES_DO_ATALHO };
