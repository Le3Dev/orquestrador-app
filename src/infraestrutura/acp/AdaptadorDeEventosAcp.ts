import { EventoDoMotor, SituacaoDaTarefa, TarefaDoOrquestrador } from "../../orquestracao/EventoDeOrquestracao";
import { AcaoDoAgente } from "../motores/PoliticaDePermissao";
import { DetectorDeEnderecosLocais } from "../motores/DetectorDeEnderecosLocais";
import { ehObjeto, Objeto, objeto, objetos, resumirEntrada, texto, textos } from "../motores/LeituraDeJson";

/** Os tipos de chamada de ferramenta do ACP (`ToolKind`). */
export type TipoDeFerramentaAcp =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

/** Uma chamada de ferramenta do agente, como o ACP a descreve (`tool_call` e o pedido de permissão). */
export interface ChamadaDeFerramentaAcp {
  id: string;
  titulo: string;
  tipo: TipoDeFerramentaAcp;
  entrada: Objeto;
  /** Caminhos de arquivos que a chamada toca: `locations`, o diff e os campos de caminho da entrada. */
  caminhos: string[];
}

const TIPOS_CONHECIDOS: ReadonlySet<string> = new Set([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
]);

/** Campos da entrada de uma ferramenta que guardam o caminho do arquivo (cada CLI usa um). */
const CAMPOS_DE_CAMINHO = ["path", "file_path", "filePath", "fileName", "filename", "newPath", "oldPath", "destination", "source"];

/** Lê uma chamada de ferramenta de um `tool_call` ou do `toolCall` de um pedido de permissão. */
export function lerChamadaDeFerramenta(bruta: unknown): ChamadaDeFerramentaAcp {
  const tipoLido = texto(bruta, "kind");
  const entrada = objeto(bruta, "rawInput");
  const caminhos = new Set<string>();
  for (const local of objetos(bruta, "locations")) {
    if (texto(local, "path") !== "") {
      caminhos.add(texto(local, "path"));
    }
  }
  for (const conteudo of objetos(bruta, "content")) {
    if (texto(conteudo, "type") === "diff" && texto(conteudo, "path") !== "") {
      caminhos.add(texto(conteudo, "path"));
    }
  }
  for (const campo of CAMPOS_DE_CAMINHO) {
    if (texto(entrada, campo) !== "") {
      caminhos.add(texto(entrada, campo));
    }
  }
  return {
    id: texto(bruta, "toolCallId"),
    titulo: texto(bruta, "title"),
    tipo: TIPOS_CONHECIDOS.has(tipoLido) ? (tipoLido as TipoDeFerramentaAcp) : "other",
    entrada,
    caminhos: [...caminhos],
  };
}

/**
 * Se o título da chamada é o nome de uma das ferramentas dadas, com ou sem o
 * prefixo do servidor MCP (`orquestrador-delegar_subtarefas`,
 * `mcp__orquestrador__delegar_subtarefas`, `orquestrador.delegar_subtarefas`).
 */
export function ehFerramentaComONome(chamada: ChamadaDeFerramentaAcp, nomes: readonly string[]): boolean {
  const titulo = chamada.titulo.trim();
  return nomes.some((nome) => titulo === nome || [".", "-", "_", "/", ":"].some((separador) => titulo.endsWith(`${separador}${nome}`)));
}

/** O comando de uma chamada de terminal: o campo `command` ou a lista `commands`; sem nenhum, o título. */
export function comandoDaChamada(chamada: ChamadaDeFerramentaAcp): string {
  const comando = texto(chamada.entrada, "command");
  if (comando !== "") {
    return comando;
  }
  const lista = textos(chamada.entrada, "commands");
  return lista.length > 0 ? lista.join("\n") : chamada.titulo;
}

/** Traduz a chamada para a ação que a política de permissões julga. */
export function acaoDaChamada(
  chamada: ChamadaDeFerramentaAcp,
  ehFerramentaDoApp: (chamada: ChamadaDeFerramentaAcp) => boolean,
): AcaoDoAgente {
  if (ehFerramentaDoApp(chamada)) {
    return { tipo: "ferramenta_do_app" };
  }
  switch (chamada.tipo) {
    case "read":
    case "search":
    case "think":
      return { tipo: "leitura" };
    case "fetch":
      return { tipo: "web" };
    case "edit":
    case "delete":
    case "move":
      return { tipo: "escrita", caminhos: chamada.caminhos };
    case "execute":
      return { tipo: "comando", comando: comandoDaChamada(chamada) };
    case "switch_mode":
      return { tipo: "mudar_de_modo" };
    case "other":
      return { tipo: "outra", descricao: chamada.titulo === "" ? "ferramenta desconhecida" : chamada.titulo };
  }
}

const NOME_NA_TELA: Readonly<Record<TipoDeFerramentaAcp, string>> = {
  read: "Read",
  edit: "Edit",
  delete: "Delete",
  move: "Move",
  search: "Grep",
  execute: "Bash",
  think: "Think",
  fetch: "WebFetch",
  switch_mode: "Mode",
  other: "",
};

/** Tipos cuja saída é conteúdo de arquivo ou página: um endereço local nela é só texto citado, não um servidor que subiu. */
const TIPOS_SEM_SERVIDOR: ReadonlySet<TipoDeFerramentaAcp> = new Set(["read", "edit", "delete", "move", "search", "fetch", "think"]);

const SITUACOES_DAS_TAREFAS: Readonly<Record<string, SituacaoDaTarefa>> = {
  pending: "pendente",
  in_progress: "em_andamento",
  completed: "concluida",
};

const TAMANHO_DO_DETALHE = 160;
const INTERVALO_DO_SINAL_DE_VIDA_MS = 1_000;

/** Um pedaço de fala que é só "Info: <uma linha>": aviso que o Copilot CLI mistura com a fala do modelo (visto no 1.0.83). */
const AVISO_DO_CLI = /^Info: [^\r\n]{1,400}$/;

export interface OpcoesDoAdaptadorAcp {
  detector: DetectorDeEnderecosLocais;
  /** Como a ferramenta de terminal aparece na tela ("PowerShell" no Windows, "Bash" no resto). */
  nomeDoTerminal?: string;
  /** Verdadeiro para a chamada da ferramenta de delegação do app: quem a conta é o executor, não o orquestrador. */
  ehFerramentaDeDelegacao?: (chamada: ChamadaDeFerramentaAcp) => boolean;
  agora?: () => number;
}

/** O que o agente usou neste turno, para o resumo de progresso de uma subtarefa. */
export interface ResumoDeAtividade {
  ferramentasUsadas: number;
  ultimaFerramenta: string | null;
  ultimaAtividade: string;
}

/**
 * Camada anticorrupção: traduz os `session/update` do ACP para os eventos do
 * domínio, no mesmo formato que o adaptador do Claude Code emite.
 *
 * Uma instância por turno. O ACP entrega a fala do agente aos pedaços
 * (`agent_message_chunk`); aqui os pedaços viram um `texto_do_orquestrador` por
 * trecho de fala, fechado quando o agente chama uma ferramenta ou o turno acaba
 * (`finalizar`). A resposta final é o último trecho de fala, como o `result` do
 * Claude Code. O raciocínio (`agent_thought_chunk`) vira só um sinal de vida.
 *
 * O uso de tokens não vem nos `session/update` (só `usage_update`, que mede a
 * janela de contexto): fica com o motor, que o lê da resposta do `session/prompt`
 * quando o CLI a informa.
 */
export class AdaptadorDeEventosAcp {
  private pedacoDaFala = "";
  private readonly falas: string[] = [];
  private caracteresDePensamento = 0;
  private ultimoSinalDeVida: number | null = null;
  private readonly chamadas = new Map<string, ChamadaDeFerramentaAcp>();
  private readonly anunciadas = new Set<string>();
  private ferramentasUsadasNoTurno = 0;
  private ultimaFerramentaUsada: string | null = null;
  private ultimaAtividadeLida = "";

  constructor(private readonly opcoes: OpcoesDoAdaptadorAcp) {}

  /** A resposta final: o último trecho de fala do agente; vazia se ele não falou. */
  get respostaFinal(): string {
    return this.falas.at(-1) ?? "";
  }

  get atividade(): ResumoDeAtividade {
    return {
      ferramentasUsadas: this.ferramentasUsadasNoTurno,
      ultimaFerramenta: this.ultimaFerramentaUsada,
      ultimaAtividade: this.ultimaAtividadeLida,
    };
  }

  /** Fecha a fala que ainda está em andamento. Chamar quando o turno termina. */
  finalizar(): EventoDoMotor[] {
    return this.fecharFala();
  }

  /** Traduz o `update` de um `session/update`. */
  traduzir(atualizacao: unknown): EventoDoMotor[] {
    if (!ehObjeto(atualizacao)) {
      return [];
    }
    switch (texto(atualizacao, "sessionUpdate")) {
      case "agent_message_chunk": {
        const pedaco = texto(objeto(atualizacao, "content"), "text");
        // O Copilot escreve "Info: <caminho>" como um pedaço de fala solto quando mexe num arquivo: é aviso do CLI, não do modelo.
        if (!AVISO_DO_CLI.test(pedaco)) {
          this.pedacoDaFala += pedaco;
        }
        return [];
      }
      case "agent_thought_chunk":
        return this.sinalDeVida(texto(objeto(atualizacao, "content"), "text"));
      case "tool_call":
        return this.traduzirChamada(atualizacao);
      case "tool_call_update":
        this.registrarSaidaDaChamada(atualizacao);
        return [];
      case "plan":
        return this.traduzirPlano(atualizacao);
      default:
        // available_commands_update, config_option_update, usage_update,
        // session_info_update, current_mode_update e as repetições do histórico: não interessam à tela.
        return [];
    }
  }

  private fecharFala(): EventoDoMotor[] {
    const fala = this.pedacoDaFala.trim();
    this.pedacoDaFala = "";
    if (fala === "") {
      return [];
    }
    this.falas.push(fala);
    this.opcoes.detector.citar(fala);
    return [{ tipo: "texto_do_orquestrador", texto: fala }];
  }

  private sinalDeVida(pensamento: string): EventoDoMotor[] {
    this.caracteresDePensamento += pensamento.length;
    const agora = (this.opcoes.agora ?? Date.now)();
    if (this.ultimoSinalDeVida !== null && agora - this.ultimoSinalDeVida < INTERVALO_DO_SINAL_DE_VIDA_MS) {
      return [];
    }
    this.ultimoSinalDeVida = agora;
    // Estimativa de tokens: ~4 caracteres por token.
    return [{ tipo: "sinal_de_vida", tokensPensando: Math.ceil(this.caracteresDePensamento / 4) }];
  }

  private nomeNaTela(chamada: ChamadaDeFerramentaAcp): string {
    if (chamada.tipo === "execute") {
      return this.opcoes.nomeDoTerminal ?? NOME_NA_TELA.execute;
    }
    const nome = NOME_NA_TELA[chamada.tipo];
    return nome === "" ? chamada.titulo || "ferramenta" : nome;
  }

  private traduzirChamada(atualizacao: Objeto): EventoDoMotor[] {
    const chamada = lerChamadaDeFerramenta(atualizacao);
    if (chamada.id !== "") {
      this.chamadas.set(chamada.id, chamada);
      if (this.anunciadas.has(chamada.id)) {
        return [];
      }
      this.anunciadas.add(chamada.id);
    }
    const eventos = this.fecharFala();
    if (this.opcoes.ehFerramentaDeDelegacao?.(chamada) === true) {
      return eventos;
    }
    const nome = this.nomeNaTela(chamada);
    const detalhe =
      chamada.tipo === "execute"
        ? resumirEntrada(chamada.entrada) || chamada.titulo
        : chamada.caminhos[0] ?? (resumirEntrada(chamada.entrada) || chamada.titulo);
    this.ferramentasUsadasNoTurno += 1;
    this.ultimaFerramentaUsada = nome;
    this.ultimaAtividadeLida = detalhe.slice(0, TAMANHO_DO_DETALHE);
    // `open http://127.0.0.1:4173`, `curl localhost:3000`: o comando cita o servidor.
    if (chamada.tipo === "execute") {
      this.opcoes.detector.citar(detalhe);
    }
    eventos.push({ tipo: "ferramenta_do_orquestrador", ferramenta: nome, detalhe: detalhe.slice(0, TAMANHO_DO_DETALHE) });
    return eventos;
  }

  /** A saída de um comando pode citar o servidor que acabou de subir; a de ler arquivo, não. */
  private registrarSaidaDaChamada(atualizacao: Objeto): void {
    const chamada = this.chamadas.get(texto(atualizacao, "toolCallId"));
    if (chamada !== undefined && TIPOS_SEM_SERVIDOR.has(chamada.tipo)) {
      return;
    }
    const partes: string[] = [];
    for (const conteudo of objetos(atualizacao, "content")) {
      if (texto(conteudo, "type") === "content") {
        partes.push(texto(objeto(conteudo, "content"), "text"));
      }
    }
    const saida = objeto(atualizacao, "rawOutput");
    partes.push(texto(saida, "content"));
    this.opcoes.detector.citar(partes.join("\n"));
  }

  private traduzirPlano(atualizacao: Objeto): EventoDoMotor[] {
    const tarefas: TarefaDoOrquestrador[] = [];
    for (const entrada of objetos(atualizacao, "entries")) {
      const situacao = SITUACOES_DAS_TAREFAS[texto(entrada, "status")];
      const conteudo = texto(entrada, "content").trim();
      if (situacao === undefined || conteudo === "") {
        return [];
      }
      tarefas.push({ texto: conteudo.slice(0, TAMANHO_DO_DETALHE), situacao });
    }
    return tarefas.length === 0 ? [] : [{ tipo: "tarefas_atualizadas", tarefas }];
  }
}
