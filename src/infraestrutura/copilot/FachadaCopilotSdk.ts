import type {
  CopilotClient,
  CopilotClientOptions,
  CopilotSession,
  CustomAgentConfig,
  PermissionRequestResult,
  ResumeSessionConfig,
  SessionConfig,
} from "@github/copilot-sdk";

import { encerrarArvore } from "../sistema/Processos";
import { DecisaoDePermissaoDoCopilot, PedidoDePermissaoDoCopilot } from "./PoliticaDePermissoesDoCopilot";

/**
 * Fachada do SDK do GitHub Copilot (`@github/copilot-sdk`): o único arquivo do
 * app que o conhece. Os tipos daqui para fora são nossos (camada
 * anticorrupção, ADR-6) — o motor e o adaptador de eventos não importam o SDK.
 *
 * Diferente do Claude Code (um processo por turno), o Copilot roda UM runtime
 * vivo (`copilot-runtime`, filho do app, falando JSON-RPC por stdin/stdout) por
 * fachada; as sessões vivem dentro dele. Daí `iniciar`/`encerrar`, o `pid` do
 * runtime e o plano B de `derrubar`.
 *
 * O SDK é dependência de DESENVOLVIMENTO nesta fase: é carregado só quando o
 * primeiro cliente sobe (`import()` dinâmico), então nada do app em produção
 * exige o pacote para iniciar.
 */

// ---------------------------------------------------------------------------
// Tipos do nosso lado
// ---------------------------------------------------------------------------

/** Um evento da sessão como o runtime o emite (só o que o adaptador precisa ler). */
export interface EventoDaSessaoCopilot {
  type: string;
  id?: string;
  timestamp?: string;
  /** Presente nos eventos de um subagente; ausente nos do agente principal. */
  agentId?: string;
  data?: unknown;
}

/** O que o app responde a um pedido de permissão (ver `PoliticaDePermissoesDoCopilot`). */
export type DecisorDePermissaoDoCopilot = (
  pedido: PedidoDePermissaoDoCopilot,
) => DecisaoDePermissaoDoCopilot | Promise<DecisaoDePermissaoDoCopilot>;

export interface AgenteDoCopilot {
  nome: string;
  descricao: string;
  /** Instruções do agente (o `prompt` do SDK). */
  instrucoes: string;
  ferramentas?: readonly string[];
  modelo?: string;
  esforco?: string;
}

/** Tudo o que precisa ser (re)enviado ao criar OU retomar uma sessão. */
export interface ConfiguracaoDaSessaoCopilot {
  modelo: string;
  /** `low`, `medium`, `high`, `xhigh`, `max`…; ausente = o padrão do modelo. */
  esforco?: string | undefined;
  pastaDeTrabalho: string;
  /** Pastas liberadas além da de trabalho (artefatos, anexos): o SDK pede que sejam reenviadas na retomada. */
  pastasAdicionais: readonly string[];
  /** Instruções acrescentadas ao prompt de sistema do Copilot. */
  instrucoes?: string | undefined;
  /** Lista fechada de ferramentas (`availableTools`). */
  ferramentasLiberadas: readonly string[];
  agentes?: readonly AgenteDoCopilot[] | undefined;
  /** Quem decide cada pedido de permissão (sem decisor o SDK deixaria o pedido pendente e o turno travaria). */
  decisor: DecisorDePermissaoDoCopilot;
}

export type AnexoDaMensagemCopilot =
  | { tipo: "arquivo"; caminho: string; nome?: string }
  | { tipo: "imagem"; base64: string; tipoDeMidia: string; nome?: string };

export interface SessaoDoCopilot {
  readonly id: string;
  /** Envia o pedido e volta assim que o runtime o aceita; o fim do turno vem no evento `session.idle`. */
  enviar(prompt: string, anexos?: readonly AnexoDaMensagemCopilot[]): Promise<void>;
  /** Escuta os eventos da sessão; devolve quem cancela a escuta. */
  aoEvento(ouvinte: (evento: EventoDaSessaoCopilot) => void): () => void;
  /** Troca quem decide as permissões (a política muda de turno para turno na mesma sessão). */
  trocarDecisor(decisor: DecisorDePermissaoDoCopilot): void;
  /** Pede ao runtime que interrompa o turno em andamento; a sessão continua utilizável. */
  abortar(): Promise<void>;
  /** Solta a sessão da memória do runtime; o estado em disco fica e dá para retomar. */
  desconectar(): Promise<void>;
  /** Ferramentas que o runtime oferece nesta sessão (resolve a lista antes do primeiro envio; não gasta crédito). */
  ferramentasOferecidas(): Promise<string[]>;
}

export interface ModeloDoCopilot {
  id: string;
  nome: string;
  /** Níveis aceitos em `esforco`; vazio quando o modelo não tem esforço configurável. */
  esforcos: readonly string[];
  esforcoPadrao: string | null;
  aceitaImagens: boolean;
  contextoMaximo: number;
  /** Preço por lote de tokens (em créditos de IA); nulo quando o catálogo não informa. */
  preco: { entrada: number; saida: number; tamanhoDoLote: number } | null;
}

export interface SituacaoDoLogin {
  autenticado: boolean;
  /** `user` (login do Copilot CLI), `env` (variável de ambiente), `gh-cli`, `token`… */
  tipo: string | null;
}

export interface OpcoesDaFachadaCopilot {
  /** Pasta em que o runtime nasce (as sessões têm a sua). Padrão: a pasta temporária do sistema. */
  pastaDoRuntime: string;
  /** Token explícito; sem ele vale o login do Copilot CLI ou as variáveis de ambiente do usuário. */
  tokenDoGitHub?: string;
  nivelDeLog?: "none" | "error" | "warning" | "info" | "debug" | "all";
  /** O runtime nasceu: o pid vai para o `RegistroDeProcessos` (ADR-38). */
  aoNascerORuntime?: (pid: number) => void;
  /** O runtime terminou (por `encerrar`, `derrubar` ou por conta própria). */
  aoMorrerORuntime?: (pid: number) => void;
  /** Quanto esperar o `stop()` gracioso antes de partir para a força. */
  esperaDoEncerramentoMs?: number;
}

export const ESPERA_DO_ENCERRAMENTO_MS = 8_000;

// ---------------------------------------------------------------------------
// Acesso ao SDK
// ---------------------------------------------------------------------------

type ModuloDoSdk = typeof import("@github/copilot-sdk");

let moduloEmCarga: Promise<ModuloDoSdk> | null = null;

/**
 * Carrega o SDK na primeira vez. O pacote traz um build CommonJS (`exports.require`),
 * então o `import()` compilado para `require` funciona neste projeto e no Electron.
 */
export function carregarOSdkDoCopilot(): Promise<ModuloDoSdk> {
  moduloEmCarga ??= import("@github/copilot-sdk").catch((erro: unknown) => {
    moduloEmCarga = null;
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    throw new Error(
      `Não foi possível carregar o SDK do GitHub Copilot (@github/copilot-sdk): ${detalhe}. ` +
        "Ele é dependência de desenvolvimento e precisa estar instalado (npm install).",
    );
  });
  return moduloEmCarga;
}

/** Só o que lemos do campo privado `cliProcess` do `CopilotClient` (o SDK não expõe o pid). */
interface ClienteComProcesso {
  cliProcess?: { pid?: number; exitCode?: number | null } | null;
}

function pidDoProcessoDoCliente(cliente: CopilotClient): number | null {
  const processo = (cliente as unknown as ClienteComProcesso).cliProcess;
  return typeof processo?.pid === "number" ? processo.pid : null;
}

function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    // EPERM: existe, mas não é nosso para sinalizar.
    return (erro as NodeJS.ErrnoException).code === "EPERM";
  }
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

function comPrazo<T>(promessa: Promise<T>, prazoMs: number): Promise<T | "prazo"> {
  return new Promise<T | "prazo">((resolver, rejeitar) => {
    const relogio = setTimeout(() => resolver("prazo"), prazoMs);
    promessa.then(
      (valor) => {
        clearTimeout(relogio);
        resolver(valor);
      },
      (erro: unknown) => {
        clearTimeout(relogio);
        rejeitar(erro);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Tradução para o SDK
// ---------------------------------------------------------------------------

function respostaDoSdk(decisao: DecisaoDePermissaoDoCopilot): PermissionRequestResult {
  return decisao.aprovada ? { kind: "approve-once" } : { kind: "reject", feedback: decisao.motivo };
}

function agentesDoSdk(agentes: readonly AgenteDoCopilot[]): CustomAgentConfig[] {
  return agentes.map((agente) => ({
    name: agente.nome,
    description: agente.descricao,
    prompt: agente.instrucoes,
    ...(agente.ferramentas === undefined ? {} : { tools: [...agente.ferramentas] }),
    ...(agente.modelo === undefined ? {} : { model: agente.modelo }),
    ...(agente.esforco === undefined ? {} : { reasoningEffort: agente.esforco }),
  }));
}

/** Os campos que valem tanto na criação quanto na retomada (`SessionConfigBase`). */
function configuracaoComum(
  configuracao: ConfiguracaoDaSessaoCopilot,
  ponte: { decisor: DecisorDePermissaoDoCopilot },
): Omit<SessionConfig, "sessionId"> {
  return {
    model: configuracao.modelo,
    ...(configuracao.esforco === undefined ? {} : { reasoningEffort: configuracao.esforco }),
    streaming: true,
    workingDirectory: configuracao.pastaDeTrabalho,
    additionalDirectories: [...configuracao.pastasAdicionais],
    ...(configuracao.instrucoes === undefined || configuracao.instrucoes === ""
      ? {}
      : { systemMessage: { mode: "append" as const, content: configuracao.instrucoes } }),
    availableTools: [...configuracao.ferramentasLiberadas],
    ...(configuracao.agentes === undefined || configuracao.agentes.length === 0
      ? {}
      : { customAgents: agentesDoSdk(configuracao.agentes) }),
    // A política do usuário proíbe o trailer Co-authored-by nos commits dos agentes.
    coauthorEnabled: false,
    onPermissionRequest: async (pedido) => respostaDoSdk(await ponte.decisor(pedido)),
  };
}

class SessaoNoSdk implements SessaoDoCopilot {
  constructor(
    private readonly sessao: CopilotSession,
    private readonly ponte: { decisor: DecisorDePermissaoDoCopilot },
  ) {}

  get id(): string {
    return this.sessao.sessionId;
  }

  async enviar(prompt: string, anexos: readonly AnexoDaMensagemCopilot[] = []): Promise<void> {
    await this.sessao.send({
      prompt,
      ...(anexos.length === 0
        ? {}
        : {
            attachments: anexos.map((anexo) =>
              anexo.tipo === "arquivo"
                ? { type: "file" as const, path: anexo.caminho, ...(anexo.nome === undefined ? {} : { displayName: anexo.nome }) }
                : {
                    type: "blob" as const,
                    data: anexo.base64,
                    mimeType: anexo.tipoDeMidia,
                    ...(anexo.nome === undefined ? {} : { displayName: anexo.nome }),
                  },
            ),
          }),
    });
  }

  aoEvento(ouvinte: (evento: EventoDaSessaoCopilot) => void): () => void {
    return this.sessao.on((evento) => ouvinte(evento));
  }

  trocarDecisor(decisor: DecisorDePermissaoDoCopilot): void {
    this.ponte.decisor = decisor;
  }

  abortar(): Promise<void> {
    return this.sessao.abort();
  }

  desconectar(): Promise<void> {
    return this.sessao.disconnect();
  }

  async ferramentasOferecidas(): Promise<string[]> {
    await this.sessao.rpc.tools.initializeAndValidate();
    const resultado = await this.sessao.rpc.tools.getCurrentMetadata();
    return (resultado.tools ?? []).map((ferramenta) => ferramenta.name);
  }
}

// ---------------------------------------------------------------------------
// A fachada
// ---------------------------------------------------------------------------

export class FachadaCopilotSdk {
  private cliente: CopilotClient | null = null;
  private iniciando: Promise<CopilotClient> | null = null;
  private pid: number | null = null;
  private readonly sessoesVivas = new Map<string, SessaoNoSdk>();

  constructor(private readonly opcoes: OpcoesDaFachadaCopilot) {}

  /** O pid do `copilot-runtime`, depois de `iniciar`; nulo se o SDK deixar de expô-lo. */
  get pidDoRuntime(): number | null {
    return this.pid;
  }

  /** Sobe o runtime (uma vez; chamadas simultâneas esperam a mesma subida). */
  iniciar(): Promise<void> {
    return this.garantirCliente().then(() => undefined);
  }

  private garantirCliente(): Promise<CopilotClient> {
    if (this.cliente !== null) {
      return Promise.resolve(this.cliente);
    }
    this.iniciando ??= this.subir().finally(() => {
      this.iniciando = null;
    });
    return this.iniciando;
  }

  private async subir(): Promise<CopilotClient> {
    const { CopilotClient: Cliente } = await carregarOSdkDoCopilot();
    const opcoesDoCliente: CopilotClientOptions = {
      workingDirectory: this.opcoes.pastaDoRuntime,
      logLevel: this.opcoes.nivelDeLog ?? "error",
      ...(this.opcoes.tokenDoGitHub === undefined ? {} : { gitHubToken: this.opcoes.tokenDoGitHub }),
    };
    const cliente = new Cliente(opcoesDoCliente);
    try {
      await cliente.start();
    } catch (erro) {
      await cliente.forceStop().catch(() => undefined);
      throw new Error(`Não foi possível iniciar o runtime do GitHub Copilot: ${descreverErro(erro)}`);
    }
    this.cliente = cliente;
    this.pid = pidDoProcessoDoCliente(cliente);
    if (this.pid !== null) {
      this.opcoes.aoNascerORuntime?.(this.pid);
    }
    return cliente;
  }

  /** Se o usuário está logado no Copilot, sem expor o nome da conta nem o token. */
  async situacaoDoLogin(): Promise<SituacaoDoLogin> {
    const cliente = await this.garantirCliente();
    try {
      const status = await cliente.getAuthStatus();
      return { autenticado: status.isAuthenticated, tipo: status.authType ?? null };
    } catch (erro) {
      throw new Error(`Não foi possível consultar o login do GitHub Copilot: ${descreverErro(erro)}`);
    }
  }

  async listarModelos(): Promise<ModeloDoCopilot[]> {
    const cliente = await this.garantirCliente();
    try {
      const modelos = await cliente.listModels();
      return modelos.map((modelo) => {
        const precos = modelo.billing?.tokenPrices;
        return {
          id: modelo.id,
          nome: modelo.name,
          esforcos: modelo.supportedReasoningEfforts ?? [],
          esforcoPadrao: modelo.defaultReasoningEffort ?? null,
          aceitaImagens: modelo.capabilities.supports.vision,
          contextoMaximo: modelo.capabilities.limits.max_context_window_tokens,
          preco:
            precos?.inputPrice === undefined || precos.outputPrice === undefined
              ? null
              : { entrada: precos.inputPrice, saida: precos.outputPrice, tamanhoDoLote: precos.batchSize ?? 1_000_000 },
        };
      });
    } catch (erro) {
      throw new Error(`Não foi possível listar os modelos do GitHub Copilot: ${descreverErro(erro)}`);
    }
  }

  /** Cria a sessão com o id escolhido pelo app (`sessaoId`). */
  async criarSessao(id: string, configuracao: ConfiguracaoDaSessaoCopilot): Promise<SessaoDoCopilot> {
    const cliente = await this.garantirCliente();
    const ponte = { decisor: configuracao.decisor };
    try {
      const sessao = new SessaoNoSdk(
        await cliente.createSession({ sessionId: id, ...configuracaoComum(configuracao, ponte) }),
        ponte,
      );
      this.sessoesVivas.set(id, sessao);
      return sessao;
    } catch (erro) {
      throw new Error(`Não foi possível criar a sessão do GitHub Copilot: ${descreverErro(erro)}`);
    }
  }

  /**
   * Retoma a sessão gravada em disco (`~/.copilot/session-state/<id>`). Os
   * callbacks, as ferramentas e as pastas NÃO vêm de volta sozinhos: a
   * configuração completa é reenviada.
   */
  async retomarSessao(id: string, configuracao: ConfiguracaoDaSessaoCopilot): Promise<SessaoDoCopilot> {
    const cliente = await this.garantirCliente();
    const ponte = { decisor: configuracao.decisor };
    try {
      const retomada: ResumeSessionConfig = configuracaoComum(configuracao, ponte);
      const sessao = new SessaoNoSdk(await cliente.resumeSession(id, retomada), ponte);
      this.sessoesVivas.set(id, sessao);
      return sessao;
    } catch (erro) {
      throw new Error(`Não foi possível retomar a sessão ${id} do GitHub Copilot: ${descreverErro(erro)}`);
    }
  }

  /** A sessão que já está viva neste runtime (aberta ou retomada antes), se houver. */
  sessaoViva(id: string): SessaoDoCopilot | null {
    return this.sessoesVivas.get(id) ?? null;
  }

  esquecerSessao(id: string): void {
    this.sessoesVivas.delete(id);
  }

  /**
   * Encerra o runtime com educação (`stop()`, que solta as sessões e fecha o
   * stdin) e, se ele não sair no prazo ou ficar vivo, derruba a árvore inteira
   * (`taskkill /T /F` no Windows): o `stop()` já deixou filhos órfãos no Windows
   * (issue #1804 do SDK).
   */
  async encerrar(): Promise<void> {
    const cliente = this.cliente;
    const pid = this.pid;
    this.cliente = null;
    this.pid = null;
    this.sessoesVivas.clear();
    if (cliente === null) {
      return;
    }
    try {
      const prazo = this.opcoes.esperaDoEncerramentoMs ?? ESPERA_DO_ENCERRAMENTO_MS;
      const erros = await comPrazo(cliente.stop(), prazo);
      if (erros === "prazo") {
        console.warn("[copilot] O runtime não encerrou no prazo; forçando.");
        await comPrazo(cliente.forceStop(), prazo).catch(() => undefined);
      } else if (erros.length > 0) {
        console.warn("[copilot] Erros ao encerrar o runtime:", erros.map((erro) => erro.message).join("; "));
      }
    } catch (erro) {
      console.warn("[copilot] stop() falhou:", descreverErro(erro));
    } finally {
      this.garantirQueMorreu(pid);
    }
  }

  /**
   * Plano B do cancelamento: o runtime não respondeu ao `abort()`. Derruba a
   * árvore do runtime à força e esquece o cliente; o próximo turno sobe outro
   * (as sessões continuam em disco e são retomadas).
   */
  async derrubar(): Promise<void> {
    const cliente = this.cliente;
    const pid = this.pid;
    this.cliente = null;
    this.pid = null;
    this.sessoesVivas.clear();
    if (pid !== null) {
      encerrarArvore(pid);
      this.opcoes.aoMorrerORuntime?.(pid);
    }
    if (cliente !== null) {
      await comPrazo(cliente.forceStop(), ESPERA_DO_ENCERRAMENTO_MS).catch(() => undefined);
    }
  }

  private garantirQueMorreu(pid: number | null): void {
    if (pid === null) {
      return;
    }
    if (processoVivo(pid)) {
      encerrarArvore(pid);
    }
    this.opcoes.aoMorrerORuntime?.(pid);
  }
}
