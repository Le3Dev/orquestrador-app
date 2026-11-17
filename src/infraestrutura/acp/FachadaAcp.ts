import { AcompanhamentoDeProcessos } from "../sistema/RastreadorDeProcessosDeixados";
import { RegistroDeProcessos } from "../sistema/RegistroDeProcessos";
import { ErroJsonRpc, ERRO_METODO_INEXISTENTE, ProcessoJsonRpc, SaidaDoProcessoJsonRpc } from "../motores/ProcessoJsonRpc";
import { ehObjeto, numero, objeto, objetos, texto } from "../motores/LeituraDeJson";

/** A versão do protocolo que o app fala: a 1, a estável (https://agentclientprotocol.com/protocol/overview). */
export const VERSAO_DO_PROTOCOLO_ACP = 1;

/** Um servidor MCP que o agente deve usar na sessão (ACP: `McpServer`, variante HTTP). */
export interface ServidorMcpParaAcp {
  nome: string;
  url: string;
  cabecalhos: ReadonlyArray<{ nome: string; valor: string }>;
}

export interface ImagemParaAcp {
  tipoDeMidia: string;
  base64: string;
}

/** O uso de tokens que o agente informa ao fim do `session/prompt`; ausente quando ele não informa. */
export interface UsoInformadoPeloAgente {
  tokensDeEntrada: number;
  tokensDeSaida: number;
}

export interface RespostaDoPrompt {
  /** `end_turn`, `max_tokens`, `max_turn_requests`, `refusal` ou `cancelled`. */
  motivoDeParada: string;
  uso: UsoInformadoPeloAgente | null;
}

export interface SessaoAcp {
  sessaoId: string;
  /** O modelo em uso, quando o agente o informa. */
  modeloAtual: string | null;
}

/** O pedido de permissão do agente (`session/request_permission`). */
export interface PedidoDePermissaoAcp {
  sessaoId: string;
  /** A chamada de ferramenta como veio (ver `lerChamadaDeFerramenta`). */
  chamada: unknown;
  opcoes: ReadonlyArray<{ id: string; tipo: string; nome: string }>;
}

/** A resposta ao pedido de permissão: o id da opção escolhida, ou `null` para cancelar a chamada. */
export type RespostaDePermissaoAcp = { opcaoId: string } | null;

export interface TratadoresDaFachadaAcp {
  /** Cada `session/update` (na ordem de chegada). */
  aoAtualizar(sessaoId: string, atualizacao: unknown): void;
  aoPedirPermissao(pedido: PedidoDePermissaoAcp): Promise<RespostaDePermissaoAcp>;
  aoReceberLinha?: () => void;
}

export interface ExecucaoDaFachadaAcp {
  executavel: string;
  argumentos: readonly string[];
  pasta: string;
  ambiente: NodeJS.ProcessEnv;
  dono: { orquestradorId: string; sessaoId: string };
  nomeDoCli: string;
  informacoesDoCliente: { nome: string; versao: string };
}

export interface CapacidadesDoAgenteAcp {
  /** Retoma sessões com `session/load`. Sem isso, cada turno abre uma sessão nova. */
  carregaSessao: boolean;
  aceitaImagens: boolean;
  aceitaMcpPorHttp: boolean;
  /** Nome e versão do agente, para as mensagens e o catálogo. */
  agente: { nome: string; versao: string } | null;
}

/** O método da autenticação que o agente exige, quando `session/new` recusa por falta de login. */
export const CODIGO_DE_AUTENTICACAO_ACP = -32000;

function paraServidorMcp(servidor: ServidorMcpParaAcp): Record<string, unknown> {
  return {
    type: "http",
    name: servidor.nome,
    url: servidor.url,
    headers: servidor.cabecalhos.map((cabecalho) => ({ name: cabecalho.nome, value: cabecalho.valor })),
  };
}

function lerSessao(resposta: unknown, sessaoPedida: string | null): SessaoAcp {
  const sessaoId = texto(resposta, "sessionId") || sessaoPedida;
  if (sessaoId === null || sessaoId === "") {
    throw new Error("O agente não informou o id da sessão.");
  }
  const modelo = texto(objeto(resposta, "models"), "currentModelId");
  return { sessaoId, modeloAtual: modelo === "" ? null : modelo };
}

function lerUso(resposta: unknown): UsoInformadoPeloAgente | null {
  const uso = objeto(resposta, "usage");
  if (Object.keys(uso).length === 0) {
    return null;
  }
  const entrada = numero(uso, "inputTokens");
  const saida = numero(uso, "outputTokens");
  return entrada === 0 && saida === 0 ? null : { tokensDeEntrada: entrada, tokensDeSaida: saida };
}

/**
 * Fachada do Agent Client Protocol: ponto único de contato com um CLI que fala
 * ACP por stdio (`copilot --acp`). Inicia o processo, faz o `initialize` e expõe
 * só o que o app usa — abrir ou retomar sessão, enviar o prompt, cancelar —,
 * escondendo o JSON-RPC. As chamadas do agente ao app chegam nos tratadores.
 *
 * O ACP é JSON-RPC 2.0 por stdio, uma mensagem por linha. O app implementa o
 * cliente à mão, sem o SDK oficial (`@agentclientprotocol/sdk`): o app usa seis
 * métodos, o SDK é só ESM (o app é CommonJS) e exige o zod como peer, e a API
 * dele mudou de formato entre versões (0.26 para 0.27; hoje na 2.x). O formato
 * do protocolo (versão 1) é estável.
 *
 * O app não implementa `fs/*` nem `terminal/*` do cliente: o agente usa as
 * próprias ferramentas, e o app só decide as permissões.
 */
export class FachadaAcp {
  private readonly processo: ProcessoJsonRpc;
  private capacidadesLidas: CapacidadesDoAgenteAcp | null = null;

  constructor(
    private readonly execucao: ExecucaoDaFachadaAcp,
    private readonly tratadores: TratadoresDaFachadaAcp,
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
        versaoNoEnvelope: true,
        nomeDoCli: execucao.nomeDoCli,
      },
      {
        aoReceberNotificacao: (metodo, parametros) => this.aoReceberNotificacao(metodo, parametros),
        aoReceberRequisicao: (metodo, parametros) => this.aoReceberRequisicao(metodo, parametros),
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

  get capacidades(): CapacidadesDoAgenteAcp | null {
    return this.capacidadesLidas;
  }

  /** `initialize`: negocia a versão e lê o que o agente sabe fazer. */
  async inicializar(): Promise<CapacidadesDoAgenteAcp> {
    const resposta = await this.processo.requisitar("initialize", {
      protocolVersion: VERSAO_DO_PROTOCOLO_ACP,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: this.execucao.informacoesDoCliente.nome, version: this.execucao.informacoesDoCliente.versao },
    });
    const capacidades = objeto(resposta, "agentCapabilities");
    const informacoes = objeto(resposta, "agentInfo");
    this.capacidadesLidas = {
      carregaSessao: capacidades["loadSession"] === true,
      aceitaImagens: objeto(capacidades, "promptCapabilities")["image"] === true,
      aceitaMcpPorHttp: objeto(capacidades, "mcpCapabilities")["http"] === true,
      agente: texto(informacoes, "name") === "" ? null : { nome: texto(informacoes, "name"), versao: texto(informacoes, "version") },
    };
    return this.capacidadesLidas;
  }

  /**
   * `authenticate`: confere o login do CLI sem abrir sessão. Responde vazio
   * quando há login e falha com "Authentication required" (-32000) quando não.
   */
  async autenticar(metodoId: string): Promise<void> {
    await this.processo.requisitar("authenticate", { methodId: metodoId });
  }

  /** `session/new`: abre uma sessão nova na pasta. */
  async novaSessao(pasta: string, servidoresMcp: readonly ServidorMcpParaAcp[]): Promise<SessaoAcp> {
    const resposta = await this.processo.requisitar("session/new", {
      cwd: pasta,
      mcpServers: servidoresMcp.map(paraServidorMcp),
    });
    return lerSessao(resposta, null);
  }

  /**
   * `session/load`: retoma uma sessão que o agente guardou. O agente repete o
   * histórico em `session/update` ANTES de responder: quem chama ignora as
   * atualizações até esta promessa resolver (ver `aoAtualizar`).
   */
  async carregarSessao(sessaoId: string, pasta: string, servidoresMcp: readonly ServidorMcpParaAcp[]): Promise<SessaoAcp> {
    const resposta = await this.processo.requisitar("session/load", {
      sessionId: sessaoId,
      cwd: pasta,
      mcpServers: servidoresMcp.map(paraServidorMcp),
    });
    return lerSessao(resposta, sessaoId);
  }

  /** `session/prompt`: envia a mensagem e espera o agente terminar o turno. */
  async enviarPrompt(sessaoId: string, textoDoPrompt: string, imagens: readonly ImagemParaAcp[] = []): Promise<RespostaDoPrompt> {
    const resposta = await this.processo.requisitar("session/prompt", {
      sessionId: sessaoId,
      prompt: [
        { type: "text", text: textoDoPrompt },
        ...imagens.map((imagem) => ({ type: "image", data: imagem.base64, mimeType: imagem.tipoDeMidia })),
      ],
    });
    return { motivoDeParada: texto(resposta, "stopReason") || "end_turn", uso: lerUso(resposta) };
  }

  /** `session/cancel`: pede ao agente para parar; ele responde o `session/prompt` com `cancelled`. */
  cancelar(sessaoId: string): void {
    this.processo.notificar("session/cancel", { sessionId: sessaoId });
  }

  /** `session/close`, se o agente sabe fechar a sessão (não deixa sessão vazia para trás); ignora a falha. */
  async fecharSessao(sessaoId: string): Promise<void> {
    try {
      await this.processo.requisitar("session/close", { sessionId: sessaoId });
    } catch {
      // Sem suporte ou já fechado: não muda nada para quem chama.
    }
  }

  resultadoChegou(): void {
    this.processo.resultadoChegou();
  }

  derrubar(): void {
    this.processo.encerrarArvore();
  }

  get foiDerrubada(): boolean {
    return this.processo.foiDerrubado;
  }

  encerrarComCalma(): Promise<SaidaDoProcessoJsonRpc> {
    return this.processo.encerrarComCalma();
  }

  private aoReceberNotificacao(metodo: string, parametros: unknown): void {
    if (metodo === "session/update") {
      this.tratadores.aoAtualizar(texto(parametros, "sessionId"), objeto(parametros, "update"));
    }
  }

  private async aoReceberRequisicao(metodo: string, parametros: unknown): Promise<unknown> {
    if (metodo !== "session/request_permission") {
      // fs/*, terminal/*: o app não os oferece (ver `inicializar`).
      throw new ErroJsonRpc(`Método não suportado pelo app: ${metodo}`, ERRO_METODO_INEXISTENTE, undefined);
    }
    const opcoes = objetos(parametros, "options").map((opcao) => ({
      id: texto(opcao, "optionId"),
      tipo: texto(opcao, "kind"),
      nome: texto(opcao, "name"),
    }));
    const chamada = ehObjeto(parametros) ? parametros["toolCall"] : undefined;
    const escolha = await this.tratadores.aoPedirPermissao({ sessaoId: texto(parametros, "sessionId"), chamada, opcoes });
    return escolha === null
      ? { outcome: { outcome: "cancelled" } }
      : { outcome: { outcome: "selected", optionId: escolha.opcaoId } };
  }
}
