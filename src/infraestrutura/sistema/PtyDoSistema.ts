import { spawn } from "node-pty";

import { AberturaDoPty, ProcessoDoPty, PtyDoTerminal } from "../../terminais/PtyDoTerminal";
import { ambienteSemSessaoPai } from "../claudecode/ArgumentosDoClaudeCode";

/**
 * Variáveis do próprio app: um `npm run dev` deste projeto rodado no terminal
 * não pode herdar a porta, os dados reais nem a chave de acesso do app.
 */
const VARIAVEIS_DO_APP = ["PORTA", "PASTA_DADOS", "PASTA_DA_TELA", "PASTA_RAIZ_PROJETOS", "ELECTRON_RUN_AS_NODE"];

/**
 * Ambiente do shell do terminal: o do servidor sem as variáveis do app
 * (`ORQUESTRADOR_*` inclusive) nem as da sessão do Claude Code que o
 * `montarAmbiente` já tira dos agentes.
 */
export function ambienteDoTerminal(
  base: NodeJS.ProcessEnv,
  plataforma: NodeJS.Platform = process.platform,
): Record<string, string> {
  const limpo = ambienteSemSessaoPai(base);
  for (const variavel of VARIAVEIS_DO_APP) {
    delete limpo[variavel];
  }
  const ambiente: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(limpo)) {
    if (valor !== undefined && !nome.startsWith("ORQUESTRADOR_")) {
      ambiente[nome] = valor;
    }
  }
  ambiente.TERM = "xterm-256color";
  ambiente.COLORTERM = "truecolor";
  // Aberto pelo Finder, o app não traz LANG, e o zsh mostraria acentos como "?".
  if (plataforma !== "win32" && (ambiente.LANG === undefined || ambiente.LANG === "")) {
    ambiente.LANG = "en_US.UTF-8";
  }
  return ambiente;
}

/** O shell do usuário: login shell no macOS e Linux, para carregar o PATH do perfil. */
export function comandoDoShell(
  ambiente: NodeJS.ProcessEnv,
  plataforma: NodeJS.Platform = process.platform,
): { arquivo: string; argumentos: string[] } {
  if (plataforma === "win32") {
    return { arquivo: "powershell.exe", argumentos: [] };
  }
  const shell = ambiente.SHELL !== undefined && ambiente.SHELL !== "" ? ambiente.SHELL : undefined;
  return { arquivo: shell ?? (plataforma === "darwin" ? "/bin/zsh" : "/bin/bash"), argumentos: ["-l"] };
}

/** Adaptador do pseudoterminal sobre o node-pty. */
export class PtyDoSistema implements PtyDoTerminal {
  constructor(private readonly base: NodeJS.ProcessEnv = process.env) {}

  abrir({ pasta, colunas, linhas }: AberturaDoPty): ProcessoDoPty {
    const { arquivo, argumentos } = comandoDoShell(this.base);
    const pty = spawn(arquivo, argumentos, {
      name: "xterm-256color",
      cols: colunas,
      rows: linhas,
      cwd: pasta,
      env: ambienteDoTerminal(this.base),
    });

    let encerrado = false;
    return {
      escrever: (dados) => pty.write(dados),
      redimensionar: (novasColunas, novasLinhas) => pty.resize(novasColunas, novasLinhas),
      encerrar: () => {
        if (encerrado) {
          return;
        }
        encerrado = true;
        try {
          pty.kill();
        } catch {
          // Já tinha saído.
        }
      },
      aoReceber: (ouvinte) => {
        pty.onData(ouvinte);
      },
      aoTerminar: (ouvinte) => {
        pty.onExit(({ exitCode, signal }) => {
          encerrado = true;
          ouvinte(signal !== undefined && signal !== 0 ? null : exitCode);
        });
      },
    };
  }
}
