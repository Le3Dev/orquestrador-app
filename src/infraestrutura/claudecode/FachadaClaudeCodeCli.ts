import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { encerrarArvore } from "../sistema/Processos";
import { AcompanhamentoDeProcessos } from "../sistema/RastreadorDeProcessosDeixados";
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

/** De onde veio uma linha escrita pelo processo. */
export type OrigemDaLinha = "stdout" | "stderr";

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

function ehResultado(mensagem: unknown): boolean {
  return typeof mensagem === "object" && mensagem !== null && (mensagem as { type?: unknown }).type === "result";
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
 *
 * No Mac/Linux o processo nasce num grupo próprio (`detached`), para que
 * `encerrarArvore` derrube junto os comandos que ele lançou. Sem `unref()`:
 * o servidor continua esperando o `close`.
 */
export class FachadaClaudeCodeCli {
  constructor(
    private readonly caminhoDoExecutavel: string,
    private readonly registro: RegistroDeProcessos = new RegistroDeProcessos(),
    private readonly esperaEntreTentativasMs = ESPERA_ENTRE_TENTATIVAS_MS,
    /**
     * Quem procura o que o processo deixa rodando depois do turno (servidores
     * de desenvolvimento, watch...). Sem ele, nada é procurado: a melhoria de
     * prompt, que não tem ferramentas, não deixa nada.
     */
    private readonly acompanhamento: AcompanhamentoDeProcessos | null = null,
  ) {}

  async executar(
    execucao: ExecucaoDoClaudeCode,
    aoReceberMensagem: (mensagem: unknown) => void,
    sinal: AbortSignal,
    /** Chamado a cada linha do stdout ou do stderr, inclusive as que não são JSON: sinal de que o processo está vivo. */
    aoReceberLinha?: (linha: string, origem: OrigemDaLinha) => void,
  ): Promise<SaidaDoClaudeCode> {
    try {
      return await comNovasTentativas(() => this.executarUmaVez(execucao, aoReceberMensagem, sinal, aoReceberLinha), {
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
    aoReceberLinha?: (linha: string, origem: OrigemDaLinha) => void,
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
        // No Windows `detached` abriria um console novo; lá o `taskkill /T` já derruba a árvore.
        detached: process.platform !== "win32",
      });
      const pid = filho.pid;
      if (pid !== undefined) {
        this.registro.registrar({ pid, ...execucao.dono, iniciadoEm: new Date().toISOString() });
        this.acompanhamento?.iniciou({ pid, orquestradorId: execucao.dono.orquestradorId, pasta: execucao.pasta });
      }

      const aoAbortar = (): void => encerrarArvore(pid);
      sinal.addEventListener("abort", aoAbortar, { once: true });

      createInterface({ input: filho.stdout }).on("line", (linha) => {
        aoReceberLinha?.(linha, "stdout");
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
        // O `result` fecha o turno com o processo ainda vivo: hora de ver o que ele deixou rodando.
        if (pid !== undefined && ehResultado(mensagem)) {
          this.acompanhamento?.resultadoChegou(pid);
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
      if (aoReceberLinha !== undefined) {
        createInterface({ input: filho.stderr }).on("line", (linha) => aoReceberLinha(linha, "stderr"));
      }

      filho.on("error", (erro: NodeJS.ErrnoException) => {
        sinal.removeEventListener("abort", aoAbortar);
        if (pid !== undefined) {
          this.registro.remover(pid);
          this.acompanhamento?.terminou(pid);
        }
        rejeitar(new ErroAoIniciarProcesso(`Falha ao iniciar o Claude Code: ${erro.message}.`, erro.code));
      });

      filho.on("close", (codigoDeSaida) => {
        sinal.removeEventListener("abort", aoAbortar);
        if (pid !== undefined) {
          this.registro.remover(pid);
          this.acompanhamento?.terminou(pid);
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
