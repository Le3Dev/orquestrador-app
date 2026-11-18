import { AcompanhamentoDeProcessos } from "../sistema/RastreadorDeProcessosDeixados";
import { RegistroDeProcessos } from "../sistema/RegistroDeProcessos";
import { ProcessoJsonRpc, SaidaDoProcessoJsonRpc } from "../motores/ProcessoJsonRpc";
import { ehObjeto, Objeto, objeto, texto } from "../motores/LeituraDeJson";

export interface ExecucaoDaFachadaCodex {
  executavel: string;
  /** Os argumentos fixos: `app-server`. */
  argumentos: readonly string[];
  pasta: string;
  ambiente: NodeJS.ProcessEnv;
  dono: { orquestradorId: string; sessaoId: string };
  informacoesDoCliente: { nome: string; titulo: string; versao: string };
}

export interface TratadoresDaFachadaCodex {
  /** Cada notificação do servidor (`turn/started`, `item/completed`...), na ordem de chegada. */
  aoNotificar(metodo: string, parametros: unknown): void;
  /** Cada pedido do servidor que espera resposta (aprovações, perguntas...). */
  aoPedir(metodo: string, parametros: unknown): Promise<unknown>;
  aoReceberLinha?: () => void;
}

/** O que o app envia ao abrir ou retomar uma thread (`thread/start`, `thread/resume`). */
export interface ParametrosDaThread {
  cwd: string;
  /** Ausente: o modelo do próprio Codex. */
  model?: string;
  approvalPolicy: string;
  sandbox: string;
  /** Regras fixas do agente, como prompt de desenvolvedor (não vão para o histórico de mensagens). */
  developerInstructions?: string;
  config?: Record<string, unknown>;
  /** Uma thread efêmera não grava a conversa em disco (as subtarefas). */
  ephemeral?: boolean;
}

export interface ThreadDoCodex {
  threadId: string;
  modelo: string | null;
}

/** O que o app envia ao começar um turno (`turn/start`). */
export interface ParametrosDoTurnoDoCodex {
  texto: string;
  caminhosDeImagens: readonly string[];
  cwd: string;
  approvalPolicy: string;
  sandboxPolicy: Record<string, unknown>;
  model?: string;
}

function lerThread(resposta: unknown): ThreadDoCodex {
  const thread = objeto(resposta, "thread");
  const threadId = texto(thread, "id");
  if (threadId === "") {
    throw new Error("O Codex não informou o id da thread.");
  }
  const modelo = texto(resposta, "model") || texto(thread, "model");
  return { threadId, modelo: modelo === "" ? null : modelo };
}

/**
 * Fachada do protocolo do Codex (`codex app-server`): ponto único de contato com
 * o executável. É o protocolo que o próprio Codex usa para a extensão do VS Code
 * e documenta para quem constrói clientes (https://developers.openai.com/codex/app-server):
 * JSON-RPC por stdio, uma mensagem por linha, sem o campo `"jsonrpc"`.
 *
 * O app usa quatro chamadas — `thread/start` ou `thread/resume`, `turn/start` e
 * `turn/interrupt` — e responde aos pedidos de aprovação do servidor. O formato
 * exato de cada mensagem vem do esquema gerado pelo próprio CLI
 * (`codex app-server generate-json-schema`), então muda junto com a versão
 * instalada: a leitura aqui é defensiva e só depende dos campos listados.
 *
 * Não usa o ACP: o Codex não o fala sozinho (só pelo adaptador `codex-acp`, um
 * pacote à parte, que por baixo conversa com este mesmo `app-server`).
 */
export class FachadaCodex {
  private readonly processo: ProcessoJsonRpc;

  constructor(
    private readonly execucao: ExecucaoDaFachadaCodex,
    tratadores: TratadoresDaFachadaCodex,
    registro: RegistroDeProcessos | null = null,
    acompanhamento: AcompanhamentoDeProcessos | null = null,
  ) {
    this.processo = new ProcessoJsonRpc(
      {
        executavel: execucao.executavel,
        argumentos: execucao.argumentos,
        pasta: execucao.pasta,
        ambiente: execucao.ambiente,
        dono: execucao.dono,
        versaoNoEnvelope: false,
        nomeDoCli: "Codex",
      },
      {
        aoReceberNotificacao: (metodo, parametros) => tratadores.aoNotificar(metodo, parametros),
        aoReceberRequisicao: (metodo, parametros) => tratadores.aoPedir(metodo, parametros),
        ...(tratadores.aoReceberLinha === undefined ? {} : { aoReceberLinha: tratadores.aoReceberLinha }),
      },
      registro,
      acompanhamento,
    );
  }

  get saida(): Promise<SaidaDoProcessoJsonRpc> {
    return this.processo.saida;
  }

  get erroPadrao(): string {
    return this.processo.erroPadrao;
  }

  get terminou(): boolean {
    return this.processo.terminou;
  }

  /** `initialize` e a notificação `initialized`: sem elas o servidor recusa as outras chamadas. */
  async inicializar(): Promise<void> {
    await this.processo.requisitar("initialize", {
      clientInfo: {
        name: this.execucao.informacoesDoCliente.nome,
        title: this.execucao.informacoesDoCliente.titulo,
        version: this.execucao.informacoesDoCliente.versao,
      },
      capabilities: { experimentalApi: false },
    });
    this.processo.notificar("initialized");
  }

  /**
   * `account/read`, sem renovar o token: diz se há conta (ChatGPT ou chave de
   * API) ou se falta o login. Sem conta e sem exigir autenticação da OpenAI (um
   * provedor próprio configurado no Codex), vale como logado.
   */
  async lerConta(): Promise<{ logado: boolean }> {
    const resposta = await this.processo.requisitar("account/read", { refreshToken: false });
    const conta = ehObjeto(resposta) ? resposta["account"] : null;
    const exigeLogin = ehObjeto(resposta) ? resposta["requiresOpenaiAuth"] !== false : true;
    return { logado: ehObjeto(conta) || !exigeLogin };
  }

  async iniciarThread(parametros: ParametrosDaThread): Promise<ThreadDoCodex> {
    return lerThread(await this.processo.requisitar("thread/start", paraParametros(parametros)));
  }

  /** `thread/resume`: retoma a thread guardada em disco, sem trazer o histórico de volta (`excludeTurns`). */
  async retomarThread(threadId: string, parametros: ParametrosDaThread): Promise<ThreadDoCodex> {
    const resposta = await this.processo.requisitar("thread/resume", {
      threadId,
      excludeTurns: true,
      ...paraParametros(parametros),
    });
    const lida = lerThread(resposta);
    return { threadId: lida.threadId === "" ? threadId : lida.threadId, modelo: lida.modelo };
  }

  /** `turn/start`: devolve o id do turno. As notificações do turno chegam em `aoNotificar`. */
  async iniciarTurno(threadId: string, parametros: ParametrosDoTurnoDoCodex): Promise<string> {
    const resposta = await this.processo.requisitar("turn/start", {
      threadId,
      input: [
        { type: "text", text: parametros.texto },
        ...parametros.caminhosDeImagens.map((caminho) => ({ type: "localImage", path: caminho })),
      ],
      cwd: parametros.cwd,
      approvalPolicy: parametros.approvalPolicy,
      sandboxPolicy: parametros.sandboxPolicy,
      ...(parametros.model === undefined ? {} : { model: parametros.model }),
    });
    return texto(objeto(resposta, "turn"), "id");
  }

  /** `turn/interrupt`: o turno termina com `status: "interrupted"`. */
  async interromper(threadId: string, turnoId: string): Promise<void> {
    await this.processo.requisitar("turn/interrupt", { threadId, turnId: turnoId });
  }

  resultadoChegou(): void {
    this.processo.resultadoChegou();
  }

  derrubar(): void {
    this.processo.encerrarArvore();
  }

  encerrarComCalma(): Promise<SaidaDoProcessoJsonRpc> {
    return this.processo.encerrarComCalma();
  }
}

function paraParametros(parametros: ParametrosDaThread): Objeto {
  return {
    cwd: parametros.cwd,
    approvalPolicy: parametros.approvalPolicy,
    sandbox: parametros.sandbox,
    ...(parametros.model === undefined ? {} : { model: parametros.model }),
    ...(parametros.developerInstructions === undefined ? {} : { developerInstructions: parametros.developerInstructions }),
    ...(parametros.config === undefined || Object.keys(parametros.config).length === 0 ? {} : { config: parametros.config }),
    ...(parametros.ephemeral === undefined ? {} : { ephemeral: parametros.ephemeral }),
  };
}
