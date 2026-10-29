import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { encerrarArvore } from "../sistema/Processos";
import { RegistroDeProcessos } from "../sistema/RegistroDeProcessos";

export interface ExecucaoDoClaudeCode {
  argumentos: readonly string[];
  pasta: string;
  ambiente: NodeJS.ProcessEnv;
  /** Enviado pelo stdin: a mensagem do turno (texto e imagens) em `stream-json`. */
  entrada: string;
  /** De quem é o processo — para medir a memória e encerrar órfãos depois de uma queda. */
  dono: { orquestradorId: string; sessaoId: string };
}

export interface SaidaDoClaudeCode {
  codigoDeSaida: number | null;
  erroPadrao: string;
}

const LIMITE_DO_ERRO_PADRAO = 20_000;

/**
 * Erros ao iniciar que costumam passar sozinhos. O principal: o Claude Code
 * se atualiza trocando o próprio executável, e durante alguns segundos o
 * arquivo não existe (ENOENT) ou está em uso (EBUSY).
 */
const ERROS_PASSAGEIROS = new Set(["ENOENT", "EBUSY", "EPERM", "EACCES", "ETXTBSY"]);
export const TENTATIVAS_AO_INICIAR = 6;
const ESPERA_ENTRE_TENTATIVAS_MS = 2_000;

export class ErroAoIniciarProcesso extends Error {
  constructor(
    mensagem: string,
    public readonly codigo: string | undefined,
  ) {
    super(mensagem);
    this.name = "ErroAoIniciarProcesso";
  }
}

function esperar(milissegundos: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    const espera = setTimeout(resolver, milissegundos);
    sinal.addEventListener(
      "abort",
      () => {
        clearTimeout(espera);
        resolver();
      },
      { once: true },
    );
  });
}

/** Tenta de novo, com espera, só quando a falha ao iniciar é passageira. */
export async function comNovasTentativas<Resultado>(
  tentar: () => Promise<Resultado>,
  opcoes: { tentativas: number; esperaMs: number; sinal: AbortSignal },
): Promise<Resultado> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await tentar();
    } catch (erro) {
      const passageiro =
        erro instanceof ErroAoIniciarProcesso && erro.codigo !== undefined && ERROS_PASSAGEIROS.has(erro.codigo);
      if (!passageiro || tentativa >= opcoes.tentativas || opcoes.sinal.aborted) {
        throw erro;
      }
      console.warn(`[claude-code] ${erro.message} Tentando de novo (${tentativa}/${opcoes.tentativas - 1})…`);
      await esperar(opcoes.esperaMs, opcoes.sinal);
    }
  }
}

/**
 * Fachada: ponto único de contato com o executável do Claude Code.
 *
 * Inicia `claude -p` direto pelo executável, sem shell — com shell, cada
 * argumento passaria por regras de aspas do cmd.exe. Lê a saída linha a linha
 * (cada linha é um JSON) e entrega ao chamador já decodificada.
 */
export class FachadaClaudeCodeCli {
  constructor(
    private readonly caminhoDoExecutavel: string,
    private readonly registro: RegistroDeProcessos = new RegistroDeProcessos(),
    private readonly esperaEntreTentativasMs = ESPERA_ENTRE_TENTATIVAS_MS,
  ) {}

  async executar(
    execucao: ExecucaoDoClaudeCode,
    aoReceberMensagem: (mensagem: unknown) => void,
    sinal: AbortSignal,
  ): Promise<SaidaDoClaudeCode> {
    try {
      return await comNovasTentativas(() => this.executarUmaVez(execucao, aoReceberMensagem, sinal), {
        tentativas: TENTATIVAS_AO_INICIAR,
        esperaMs: this.esperaEntreTentativasMs,
        sinal,
      });
    } catch (erro) {
      if (erro instanceof ErroAoIniciarProcesso) {
        throw new Error(
          `Não foi possível iniciar o Claude Code em "${this.caminhoDoExecutavel}" (${erro.codigo ?? erro.message}), ` +
            `mesmo depois de ${TENTATIVAS_AO_INICIAR} tentativas. Ele pode estar se atualizando ou não estar instalado — ` +
            "tente de novo em instantes ou confira a variável CLAUDE_CODE_BIN.",
        );
      }
      throw erro;
    }
  }

  private executarUmaVez(
    execucao: ExecucaoDoClaudeCode,
    aoReceberMensagem: (mensagem: unknown) => void,
    sinal: AbortSignal,
  ): Promise<SaidaDoClaudeCode> {
    return new Promise((resolver, rejeitar) => {
      if (sinal.aborted) {
        resolver({ codigoDeSaida: null, erroPadrao: "" });
        return;
      }

      const filho = spawn(this.caminhoDoExecutavel, [...execucao.argumentos], {
        cwd: execucao.pasta,
        env: execucao.ambiente,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const pid = filho.pid;
      if (pid !== undefined) {
        this.registro.registrar({ pid, ...execucao.dono, iniciadoEm: new Date().toISOString() });
      }

      const aoAbortar = (): void => encerrarArvore(pid);
      sinal.addEventListener("abort", aoAbortar, { once: true });

      createInterface({ input: filho.stdout }).on("line", (linha) => {
        if (linha.trim() === "") {
          return;
        }
        let mensagem: unknown;
        try {
          mensagem = JSON.parse(linha);
        } catch {
          console.warn("[claude-code] Linha ignorada (não é JSON):", linha.slice(0, 200));
          return;
        }
        aoReceberMensagem(mensagem);
      });

      let erroPadrao = "";
      filho.stderr.setEncoding("utf8");
      filho.stderr.on("data", (parte: string) => {
        if (erroPadrao.length < LIMITE_DO_ERRO_PADRAO) {
          erroPadrao += parte;
        }
      });

      filho.on("error", (erro: NodeJS.ErrnoException) => {
        sinal.removeEventListener("abort", aoAbortar);
        if (pid !== undefined) {
          this.registro.remover(pid);
        }
        rejeitar(new ErroAoIniciarProcesso(`Falha ao iniciar o Claude Code: ${erro.message}.`, erro.code));
      });

      filho.on("close", (codigoDeSaida) => {
        sinal.removeEventListener("abort", aoAbortar);
        if (pid !== undefined) {
          this.registro.remover(pid);
        }
        resolver({ codigoDeSaida, erroPadrao: erroPadrao.trim() });
      });

      // Se o processo morrer antes de ler o stdin, a escrita falha com EPIPE;
      // o motivo real aparece no código de saída e no stderr.
      filho.stdin.on("error", () => undefined);
      filho.stdin.end(execucao.entrada);
    });
  }
}
