import { ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { encerrarArvore } from "../sistema/Processos";
import { AcompanhamentoDeProcessos } from "../sistema/RastreadorDeProcessosDeixados";
import { RegistroDeProcessos } from "../sistema/RegistroDeProcessos";
import { comandoParaProcesso } from "./ExecutavelDoCli";

type Objeto = Record<string, unknown>;

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Código de erro do JSON-RPC para "método não existe". */
export const ERRO_METODO_INEXISTENTE = -32601;
export const ERRO_INTERNO = -32603;

/** Um erro devolvido pelo outro lado do JSON-RPC. */
export class ErroJsonRpc extends Error {
  constructor(
    mensagem: string,
    public readonly codigo: number,
    public readonly dados: unknown,
  ) {
    super(mensagem);
    this.name = "ErroJsonRpc";
  }
}

/** O processo terminou (ou nunca iniciou) antes de responder à chamada. */
export class ProcessoEncerradoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ProcessoEncerradoError";
  }
}

export interface ExecucaoDoProcessoJsonRpc {
  executavel: string;
  argumentos: readonly string[];
  pasta: string;
  ambiente: NodeJS.ProcessEnv;
  /** De quem é o processo — para medir a memória e encerrar órfãos depois de uma queda. */
  dono: { orquestradorId: string; sessaoId: string };
  /** O ACP escreve `"jsonrpc": "2.0"` em cada mensagem; o Codex a omite. */
  versaoNoEnvelope: boolean;
  /** Nome do CLI, para as mensagens de erro ("GitHub Copilot CLI", "Codex"). */
  nomeDoCli: string;
}

export interface TratadoresDoProcessoJsonRpc {
  /** Mensagem sem `id` vinda do processo (`session/update`, `turn/started`...). Chamada na ordem de chegada. */
  aoReceberNotificacao(metodo: string, parametros: unknown): void;
  /**
   * Chamada do processo que espera resposta (pedido de permissão, de aprovação...).
   * O que for devolvido vai como `result`; um erro lançado vira o `error` do JSON-RPC.
   */
  aoReceberRequisicao(metodo: string, parametros: unknown): Promise<unknown>;
  /** Chamado a cada linha escrita pelo processo (stdout ou stderr): sinal de que está vivo. */
  aoReceberLinha?: () => void;
}

export interface SaidaDoProcessoJsonRpc {
  codigoDeSaida: number | null;
  erroPadrao: string;
  /** Preenchido quando o processo nem chegou a iniciar (executável inexistente...). */
  erroDeInicio: string | null;
}

const LIMITE_DO_ERRO_PADRAO = 20_000;
/** Quanto esperar o processo sair sozinho, depois de fechar a entrada dele, antes de derrubá-lo. */
export const ESPERA_PELA_SAIDA_MS = 5_000;

/**
 * Um processo que fala JSON-RPC por stdio, uma mensagem por linha (NDJSON):
 * o `copilot --acp` e o `codex app-server`. Cuida do que é igual nos dois:
 * iniciar sem shell (menos no `.cmd` do Windows), registrar o processo, casar
 * respostas com chamadas, responder às chamadas do processo e derrubar a
 * árvore ao cancelar.
 *
 * Sem `detached` no Windows (abriria um console): o `taskkill /T` derruba a
 * árvore. No Mac/Linux o processo lidera um grupo, que `encerrarArvore` derruba.
 */
export class ProcessoJsonRpc {
  private readonly filho: ChildProcess;
  private proximoId = 1;
  private readonly pendentes = new Map<
    number,
    { resolver: (resultado: unknown) => void; rejeitar: (erro: Error) => void; metodo: string }
  >();
  private erroPadraoLido = "";
  private encerrado = false;
  private foiEncerradoPorNos = false;
  /** Resolve quando o processo termina; nunca rejeita. */
  readonly saida: Promise<SaidaDoProcessoJsonRpc>;

  constructor(
    private readonly execucao: ExecucaoDoProcessoJsonRpc,
    private readonly tratadores: TratadoresDoProcessoJsonRpc,
    private readonly registro: RegistroDeProcessos | null = null,
    private readonly acompanhamento: AcompanhamentoDeProcessos | null = null,
  ) {
    const comando = comandoParaProcesso(execucao.executavel, execucao.argumentos);
    this.filho = spawn(comando.comando, comando.argumentos, {
      cwd: execucao.pasta,
      env: execucao.ambiente,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: comando.verbatim,
      detached: process.platform !== "win32",
    });
    const pid = this.filho.pid;
    if (pid !== undefined) {
      this.registro?.registrar({ pid, ...execucao.dono, iniciadoEm: new Date().toISOString() });
      this.acompanhamento?.iniciou({ pid, orquestradorId: execucao.dono.orquestradorId, pasta: execucao.pasta });
    }

    this.saida = new Promise<SaidaDoProcessoJsonRpc>((resolver) => {
      let erroDeInicio: string | null = null;
      this.filho.once("error", (erro: NodeJS.ErrnoException) => {
        erroDeInicio = `Falha ao iniciar o ${execucao.nomeDoCli}: ${erro.code ?? erro.message}.`;
        this.finalizar(erroDeInicio, resolver, null, erroDeInicio);
      });
      this.filho.once("close", (codigoDeSaida) => {
        this.finalizar(
          `O ${execucao.nomeDoCli} encerrou antes de responder${codigoDeSaida === null ? "" : ` (código ${codigoDeSaida})`}.`,
          resolver,
          codigoDeSaida,
          erroDeInicio,
        );
      });
    });

    createInterface({ input: this.filho.stdout! }).on("line", (linha) => this.aoReceberLinha(linha));
    this.filho.stderr!.setEncoding("utf8");
    this.filho.stderr!.on("data", (parte: string) => {
      if (this.erroPadraoLido.length < LIMITE_DO_ERRO_PADRAO) {
        this.erroPadraoLido += parte;
      }
    });
    createInterface({ input: this.filho.stderr! }).on("line", () => this.tratadores.aoReceberLinha?.());
    // Se o processo morrer antes de ler o stdin, a escrita falha com EPIPE; o motivo real vem na saída.
    this.filho.stdin!.on("error", () => undefined);
  }

  get pid(): number | undefined {
    return this.filho.pid;
  }

  get erroPadrao(): string {
    return this.erroPadraoLido.trim();
  }

  get terminou(): boolean {
    return this.encerrado;
  }

  /** Chama um método do processo e espera a resposta. */
  requisitar<Resultado = unknown>(metodo: string, parametros?: unknown): Promise<Resultado> {
    return new Promise<Resultado>((resolver, rejeitar) => {
      if (this.encerrado) {
        rejeitar(new ProcessoEncerradoError(`O ${this.execucao.nomeDoCli} já encerrou.`));
        return;
      }
      const id = this.proximoId++;
      this.pendentes.set(id, { resolver: (valor) => resolver(valor as Resultado), rejeitar, metodo });
      this.escrever({ id, method: metodo, ...(parametros === undefined ? {} : { params: parametros }) });
    });
  }

  /** Avisa o processo, sem esperar resposta. */
  notificar(metodo: string, parametros?: unknown): void {
    this.escrever({ method: metodo, ...(parametros === undefined ? {} : { params: parametros }) });
  }

  /** Avisa que o turno acabou: a árvore de processos do próprio agente, e só ela, não é derrubada à força. */
  fecharEntrada(): void {
    this.filho.stdin?.end();
  }

  /** Avisa o rastreador de processos deixados que o resultado já chegou, com o processo ainda vivo. */
  resultadoChegou(): void {
    if (this.filho.pid !== undefined) {
      this.acompanhamento?.resultadoChegou(this.filho.pid);
    }
  }

  /**
   * Derruba o processo e tudo o que ele abriu. Não faz nada se o processo já
   * terminou: o pid pode ter sido reaproveitado por outro programa.
   */
  encerrarArvore(): void {
    if (this.encerrado) {
      return;
    }
    this.foiEncerradoPorNos = true;
    encerrarArvore(this.filho.pid);
  }

  /**
   * Encerramento normal depois do turno: fecha a entrada e espera o processo sair
   * sozinho, para não derrubar um servidor de desenvolvimento que o agente deixou
   * no ar. Se ele não sair a tempo, derruba a árvore.
   */
  async encerrarComCalma(esperaMs: number = ESPERA_PELA_SAIDA_MS): Promise<SaidaDoProcessoJsonRpc> {
    this.fecharEntrada();
    let temporizador: NodeJS.Timeout | undefined;
    const limite = new Promise<"limite">((resolver) => {
      temporizador = setTimeout(() => resolver("limite"), esperaMs);
    });
    const resultado = await Promise.race([this.saida, limite]);
    clearTimeout(temporizador);
    if (resultado === "limite") {
      this.encerrarArvore();
      return this.saida;
    }
    return resultado;
  }

  get foiDerrubado(): boolean {
    return this.foiEncerradoPorNos;
  }

  private finalizar(
    motivo: string,
    resolver: (saida: SaidaDoProcessoJsonRpc) => void,
    codigoDeSaida: number | null,
    erroDeInicio: string | null,
  ): void {
    if (this.encerrado) {
      return;
    }
    this.encerrado = true;
    const pid = this.filho.pid;
    if (pid !== undefined) {
      this.registro?.remover(pid);
      this.acompanhamento?.terminou(pid);
    }
    for (const pendente of this.pendentes.values()) {
      pendente.rejeitar(new ProcessoEncerradoError(motivo));
    }
    this.pendentes.clear();
    resolver({ codigoDeSaida, erroPadrao: this.erroPadrao, erroDeInicio });
  }

  private escrever(mensagem: Objeto): void {
    const envelope = this.execucao.versaoNoEnvelope ? { jsonrpc: "2.0", ...mensagem } : mensagem;
    try {
      this.filho.stdin?.write(`${JSON.stringify(envelope)}\n`);
    } catch {
      // A entrada fechou: o `close` do processo rejeita as chamadas pendentes.
    }
  }

  private aoReceberLinha(linha: string): void {
    this.tratadores.aoReceberLinha?.();
    if (linha.trim() === "") {
      return;
    }
    let mensagem: unknown;
    try {
      mensagem = JSON.parse(linha);
    } catch {
      console.warn(`[${this.execucao.nomeDoCli}] Linha ignorada (não é JSON):`, linha.slice(0, 200));
      return;
    }
    if (!ehObjeto(mensagem)) {
      return;
    }
    const metodo = mensagem["method"];
    const id = mensagem["id"];
    if (typeof metodo === "string") {
      if (id === undefined || id === null) {
        this.tratarNotificacao(metodo, mensagem["params"]);
      } else {
        void this.responderRequisicao(id, metodo, mensagem["params"]);
      }
      return;
    }
    if (typeof id === "number") {
      this.tratarResposta(id, mensagem);
    }
  }

  private tratarNotificacao(metodo: string, parametros: unknown): void {
    try {
      this.tratadores.aoReceberNotificacao(metodo, parametros);
    } catch (erro) {
      console.error(`[${this.execucao.nomeDoCli}] Falha ao tratar ${metodo}:`, erro);
    }
  }

  private tratarResposta(id: number, mensagem: Objeto): void {
    const pendente = this.pendentes.get(id);
    if (pendente === undefined) {
      return;
    }
    this.pendentes.delete(id);
    const erro = mensagem["error"];
    if (ehObjeto(erro)) {
      const texto = typeof erro["message"] === "string" ? erro["message"] : "erro sem mensagem";
      pendente.rejeitar(
        new ErroJsonRpc(texto, typeof erro["code"] === "number" ? erro["code"] : ERRO_INTERNO, erro["data"]),
      );
      return;
    }
    pendente.resolver(mensagem["result"]);
  }

  private async responderRequisicao(id: unknown, metodo: string, parametros: unknown): Promise<void> {
    try {
      const resultado = await this.tratadores.aoReceberRequisicao(metodo, parametros);
      this.escrever({ id, result: resultado === undefined ? null : resultado });
    } catch (erro) {
      const inexistente = erro instanceof ErroJsonRpc && erro.codigo === ERRO_METODO_INEXISTENTE;
      this.escrever({
        id,
        error: {
          code: inexistente ? ERRO_METODO_INEXISTENTE : ERRO_INTERNO,
          message: erro instanceof Error ? erro.message : String(erro),
        },
      });
    }
  }
}
