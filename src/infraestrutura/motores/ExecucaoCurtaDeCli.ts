import { spawn } from "node:child_process";

import { encerrarArvore } from "../sistema/Processos";
import { comandoParaProcesso } from "./ExecutavelDoCli";

export interface SaidaCurta {
  /** Nulo quando o processo não chegou a terminar (tempo esgotado) ou nem iniciou. */
  codigoDeSaida: number | null;
  saida: string;
  erro: string;
  /** Verdadeiro se o tempo acabou e o processo foi derrubado. */
  tempoEsgotado: boolean;
  /** O motivo, quando o processo nem iniciou (executável inexistente...). */
  falhaAoIniciar: string | null;
}

export interface OpcoesDaExecucaoCurta {
  ambiente?: NodeJS.ProcessEnv;
  pasta?: string;
  limiteMs: number;
}

/** Roda um comando de consulta (`--version`, `login status`) e devolve o que ele escreveu. */
export type ExecutorDeComandoCurto = (
  executavel: string,
  argumentos: readonly string[],
  opcoes: OpcoesDaExecucaoCurta,
) => Promise<SaidaCurta>;

const LIMITE_DA_SAIDA = 20_000;

/**
 * Roda um comando curto sem shell (menos no `.cmd` do Windows), com tempo
 * máximo: o catálogo de motores consulta os CLIs, e um CLI travado não pode
 * travar a tela.
 */
export const executarComandoCurto: ExecutorDeComandoCurto = (executavel, argumentos, opcoes) =>
  new Promise<SaidaCurta>((resolver) => {
    let saida = "";
    let erro = "";
    let tempoEsgotado = false;
    let concluido = false;
    const concluir = (resultado: SaidaCurta): void => {
      if (concluido) {
        return;
      }
      concluido = true;
      clearTimeout(limite);
      resolver(resultado);
    };

    let filho;
    try {
      const comando = comandoParaProcesso(executavel, argumentos);
      filho = spawn(comando.comando, comando.argumentos, {
        cwd: opcoes.pasta,
        env: opcoes.ambiente ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: comando.verbatim,
        detached: process.platform !== "win32",
      });
    } catch (falha) {
      resolver({
        codigoDeSaida: null,
        saida: "",
        erro: "",
        tempoEsgotado: false,
        falhaAoIniciar: falha instanceof Error ? falha.message : String(falha),
      });
      return;
    }
    const limite = setTimeout(() => {
      tempoEsgotado = true;
      encerrarArvore(filho.pid);
    }, opcoes.limiteMs);

    filho.stdout.setEncoding("utf8");
    filho.stderr.setEncoding("utf8");
    filho.stdout.on("data", (parte: string) => {
      if (saida.length < LIMITE_DA_SAIDA) saida += parte;
    });
    filho.stderr.on("data", (parte: string) => {
      if (erro.length < LIMITE_DA_SAIDA) erro += parte;
    });
    filho.on("error", (falha: NodeJS.ErrnoException) =>
      concluir({ codigoDeSaida: null, saida, erro, tempoEsgotado, falhaAoIniciar: falha.code ?? falha.message }),
    );
    filho.on("close", (codigoDeSaida) =>
      concluir({ codigoDeSaida, saida: saida.trim(), erro: erro.trim(), tempoEsgotado, falhaAoIniciar: null }),
    );
  });
