import { EventoDoMotor, JanelaDaCota, SituacaoDaTarefa, TarefaDoOrquestrador } from "../../orquestracao/EventoDeOrquestracao";
import { FERRAMENTA_DE_DELEGACAO } from "../../orquestracao/InstrucoesDoOrquestrador";
import { epochEmIso, FalhaClassificada } from "../motores/ClassificadorDeFalhasDosMotores";
import { DetectorDeEnderecosLocais } from "../motores/DetectorDeEnderecosLocais";
import { ehObjeto, Objeto, numero, objeto, objetos, resumirEntrada, texto } from "../motores/LeituraDeJson";

const TAMANHO_DO_DETALHE = 160;
const INTERVALO_DO_SINAL_DE_VIDA_MS = 1_000;

const SITUACOES_DAS_TAREFAS: Readonly<Record<string, SituacaoDaTarefa>> = {
  pending: "pendente",
  inProgress: "em_andamento",
  completed: "concluida",
};

/** Como o fim de um turno do Codex termina (`turn/completed`). */
export interface FimDoTurnoDoCodex {
  status: "completed" | "interrupted" | "failed";
  /** O `error` do turno quando falhou (`message`, `codexErrorInfo`, `additionalDetails`). */
  erro: Objeto | null;
}

export interface OpcoesDoAdaptadorDoCodex {
  detector: DetectorDeEnderecosLocais;
  nomeDoTerminal?: string;
  agora?: () => number;
}

/** Nome da janela de limite pela duração dela (o Codex informa em minutos). */
function nomeDaJanela(minutos: number): string {
  if (minutos === 300) {
    return "5 horas";
  }
  if (minutos === 10_080) {
    return "7 dias";
  }
  if (minutos > 0 && minutos % 1_440 === 0) {
    return `${minutos / 1_440} dias`;
  }
  if (minutos > 0 && minutos % 60 === 0) {
    return `${minutos / 60} horas`;
  }
  return minutos > 0 ? `${minutos} min` : "limite";
}

function janelaDaCota(janela: unknown, atingiu: boolean): JanelaDaCota | null {
  if (!ehObjeto(janela)) {
    return null;
  }
  const usado = numero(janela, "usedPercent");
  const renovaEm = numero(janela, "resetsAt");
  return {
    nome: nomeDaJanela(numero(janela, "windowDurationMins")),
    utilizacao: Math.min(1, Math.max(0, usado / 100)),
    renovaEm: renovaEm > 0 ? epochEmIso(renovaEm) : null,
    situacao: atingiu || usado >= 100 ? "rejected" : "allowed",
  };
}

/**
 * Camada anticorrupção: traduz as notificações do `codex app-server` para os
 * eventos do domínio, no mesmo formato que o adaptador do Claude Code emite.
 * Uma instância por turno.
 *
 * - `item/completed` de uma mensagem do agente vira um `texto_do_orquestrador`; a
 *   resposta final é a última mensagem (a marcada `final_answer`, se houver);
 * - comandos, alterações de arquivo, ferramentas MCP e buscas na web viram
 *   `ferramenta_do_orquestrador` quando começam, menos a ferramenta de delegação
 *   do app (o executor emite os eventos dos subagentes);
 * - `turn/plan/updated` vira a lista de tarefas; o raciocínio, um sinal de vida;
 * - `thread/tokenUsage/updated` soma o uso (um por chamada ao modelo);
 * - `account/rateLimits/updated` vira o `uso_da_cota` e, se o limite foi atingido,
 *   a pista forte da causa da falha.
 */
export class AdaptadorDeEventosDoCodex {
  private readonly falas: string[] = [];
  private respostaMarcada: string | null = null;
  private tokensDeEntradaSomados = 0;
  private tokensDeSaidaSomados = 0;
  private fim: FimDoTurnoDoCodex | null = null;
  private erroDefinitivo: Objeto | null = null;
  private pistaDoLimite: FalhaClassificada | null = null;
  private semLogin = false;
  private readonly caminhosPorItem = new Map<string, string[]>();
  private readonly anunciados = new Set<string>();
  private caracteresDePensamento = 0;
  private ultimoSinalDeVida: number | null = null;
  private ferramentasUsadasNoTurno = 0;
  private ultimaFerramentaUsada: string | null = null;
  private ultimaAtividadeLida = "";

  constructor(private readonly opcoes: OpcoesDoAdaptadorDoCodex) {}

  get respostaFinal(): string {
    return this.respostaMarcada ?? this.falas.at(-1) ?? "";
  }

  get uso(): { tokensDeEntrada: number; tokensDeSaida: number } {
    return { tokensDeEntrada: this.tokensDeEntradaSomados, tokensDeSaida: this.tokensDeSaidaSomados };
  }

  /** Preenchido quando chega o `turn/completed`; nulo enquanto o turno roda. */
  get fimDoTurno(): FimDoTurnoDoCodex | null {
    return this.fim;
  }

  /** O último erro sem nova tentativa (`error` com `willRetry: false`), para quando o turno acaba sem `error` no `turn/completed`. */
  get ultimoErro(): Objeto | null {
    return this.erroDefinitivo;
  }

  get pistaDeLimite(): FalhaClassificada | null {
    return this.pistaDoLimite;
  }

  /** O Codex avisou que a conta não está logada (HTTP 401/403 ou `unauthorized`): o turno não tem como seguir. */
  get faltaDeLogin(): boolean {
    return this.semLogin;
  }

  get atividade(): { ferramentasUsadas: number; ultimaFerramenta: string | null; ultimaAtividade: string } {
    return {
      ferramentasUsadas: this.ferramentasUsadasNoTurno,
      ultimaFerramenta: this.ultimaFerramentaUsada,
      ultimaAtividade: this.ultimaAtividadeLida,
    };
  }

  /** Os arquivos que uma alteração (`fileChange`) toca, para a política julgar o pedido de aprovação dela. */
  caminhosDoItem(itemId: string): string[] {
    return this.caminhosPorItem.get(itemId) ?? [];
  }

  traduzir(metodo: string, parametros: unknown): EventoDoMotor[] {
    switch (metodo) {
      case "item/started":
        return this.itemComecou(objeto(parametros, "item"));
      case "item/completed":
        return this.itemTerminou(objeto(parametros, "item"));
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta":
        return this.sinalDeVida(texto(parametros, "delta"));
      case "turn/plan/updated":
        return this.traduzirPlano(parametros);
      case "thread/tokenUsage/updated":
        this.somarUso(objeto(objeto(parametros, "tokenUsage"), "last"));
        return [];
      case "account/rateLimits/updated":
        return this.traduzirCota(objeto(parametros, "rateLimits"));
      case "error":
        // Com `willRetry` o Codex tenta de novo sozinho: só o erro final conta.
        if (ehObjeto(parametros) && parametros["willRetry"] !== true) {
          this.erroDefinitivo = objeto(parametros, "error");
        }
        // Sem login, as novas tentativas do Codex só gastam uns 25 segundos: nenhuma vai dar certo.
        if (erroDeFaltaDeLoginDoCodex(objeto(parametros, "error"))) {
          this.semLogin = true;
          this.erroDefinitivo = objeto(parametros, "error");
        }
        return [];
      case "turn/completed": {
        const turno = objeto(parametros, "turn");
        const status = texto(turno, "status");
        this.fim = {
          status: status === "completed" || status === "interrupted" ? status : "failed",
          erro: Object.keys(objeto(turno, "error")).length > 0 ? objeto(turno, "error") : null,
        };
        return [];
      }
      default:
        return [];
    }
  }

  private itemComecou(item: Objeto): EventoDoMotor[] {
    const id = texto(item, "id");
    const tipo = texto(item, "type");
    if (tipo === "fileChange") {
      this.caminhosPorItem.set(id, objetos(item, "changes").map((mudanca) => texto(mudanca, "path")).filter((caminho) => caminho !== ""));
    }
    if (id !== "" && this.anunciados.has(id)) {
      return [];
    }
    let ferramenta: string | null = null;
    let detalhe = "";
    switch (tipo) {
      case "commandExecution":
        ferramenta = this.opcoes.nomeDoTerminal ?? "Bash";
        detalhe = texto(item, "command");
        this.opcoes.detector.citar(detalhe);
        break;
      case "fileChange":
        ferramenta = "Edit";
        detalhe = this.caminhosDoItem(id)[0] ?? "";
        break;
      case "mcpToolCall":
        if (texto(item, "tool") === FERRAMENTA_DE_DELEGACAO) {
          return [];
        }
        ferramenta = `${texto(item, "server")}.${texto(item, "tool")}`;
        detalhe = resumirEntrada(item["arguments"]);
        break;
      case "webSearch":
        ferramenta = "WebSearch";
        detalhe = texto(item, "query");
        break;
      default:
        return [];
    }
    if (id !== "") {
      this.anunciados.add(id);
    }
    detalhe = detalhe.slice(0, TAMANHO_DO_DETALHE);
    this.ferramentasUsadasNoTurno += 1;
    this.ultimaFerramentaUsada = ferramenta;
    this.ultimaAtividadeLida = detalhe;
    return [{ tipo: "ferramenta_do_orquestrador", ferramenta, detalhe }];
  }

  private itemTerminou(item: Objeto): EventoDoMotor[] {
    switch (texto(item, "type")) {
      case "agentMessage": {
        const fala = texto(item, "text").trim();
        if (fala === "") {
          return [];
        }
        this.falas.push(fala);
        if (texto(item, "phase") === "final_answer") {
          this.respostaMarcada = fala;
        }
        this.opcoes.detector.citar(fala);
        return [{ tipo: "texto_do_orquestrador", texto: fala }];
      }
      case "commandExecution": {
        // A saída de um comando pode citar o servidor que acabou de subir; a de ler arquivo, não.
        const saida = texto(item, "aggregatedOutput");
        if (saida !== "") {
          this.opcoes.detector.citar(saida);
        }
        return [];
      }
      default:
        return [];
    }
  }

  private sinalDeVida(pensamento: string): EventoDoMotor[] {
    this.caracteresDePensamento += pensamento.length;
    const agora = (this.opcoes.agora ?? Date.now)();
    if (this.ultimoSinalDeVida !== null && agora - this.ultimoSinalDeVida < INTERVALO_DO_SINAL_DE_VIDA_MS) {
      return [];
    }
    this.ultimoSinalDeVida = agora;
    return [{ tipo: "sinal_de_vida", tokensPensando: Math.ceil(this.caracteresDePensamento / 4) }];
  }

  private traduzirPlano(parametros: unknown): EventoDoMotor[] {
    const tarefas: TarefaDoOrquestrador[] = [];
    for (const passo of objetos(parametros, "plan")) {
      const situacao = SITUACOES_DAS_TAREFAS[texto(passo, "status")];
      const conteudo = texto(passo, "step").trim();
      if (situacao === undefined || conteudo === "") {
        return [];
      }
      tarefas.push({ texto: conteudo.slice(0, TAMANHO_DO_DETALHE), situacao });
    }
    return tarefas.length === 0 ? [] : [{ tipo: "tarefas_atualizadas", tarefas }];
  }

  /** Cada atualização de uso traz o consumo da última chamada ao modelo (`last`): a soma é o do turno. */
  private somarUso(ultimaChamada: Objeto): void {
    this.tokensDeEntradaSomados += numero(ultimaChamada, "inputTokens");
    this.tokensDeSaidaSomados += numero(ultimaChamada, "outputTokens");
  }

  private traduzirCota(limites: Objeto): EventoDoMotor[] {
    const atingido = texto(limites, "rateLimitReachedType") !== "";
    const janelas = [janelaDaCota(limites["primary"], atingido), janelaDaCota(limites["secondary"], atingido)].filter(
      (janela): janela is JanelaDaCota => janela !== null,
    );
    if (atingido) {
      const reposicoes = janelas.map((janela) => janela.renovaEm).filter((momento): momento is string => momento !== null);
      this.pistaDoLimite = { causa: "limite_de_uso", liberaEm: reposicoes.sort().at(-1) ?? null };
    }
    return janelas.length === 0 ? [] : [{ tipo: "uso_da_cota", janelas }];
  }
}

const CODIGOS_DE_LIMITE = new Set(["usageLimitExceeded", "rateLimitExceeded", "sessionBudgetExceeded"]);
const CODIGOS_DE_SOBRECARGA = new Set(["serverOverloaded", "internalServerError", "flexUnavailable", "policyCapacityUnavailable"]);
const CODIGOS_DE_CONEXAO = [
  "httpConnectionFailed",
  "responseStreamConnectionFailed",
  "responseStreamDisconnected",
  "responseTooManyFailedAttempts",
];

/**
 * A causa de uma falha do Codex pelo `codexErrorInfo` do erro (o protocolo diz a
 * causa; o texto é só o apoio): limite de uso (`usageLimitExceeded`...),
 * sobrecarga (`serverOverloaded`, HTTP 5xx), rede (queda de conexão sem status)
 * ou nulo, quando o código não diz (o chamador usa o texto). `liberaEm` vem da
 * pista dos limites da conta (`account/rateLimits/updated`).
 */
export function causaDoErroDoCodex(erro: Objeto | null, pista: FalhaClassificada | null): FalhaClassificada | null {
  if (pista !== null) {
    return pista;
  }
  const info = erro === null ? undefined : erro["codexErrorInfo"];
  if (typeof info === "string") {
    if (CODIGOS_DE_LIMITE.has(info)) {
      return { causa: "limite_de_uso", liberaEm: null };
    }
    if (CODIGOS_DE_SOBRECARGA.has(info)) {
      return { causa: "sobrecarga", liberaEm: null };
    }
    return null;
  }
  if (!ehObjeto(info)) {
    return null;
  }
  for (const codigo of CODIGOS_DE_CONEXAO) {
    if (codigo in info) {
      const status = numero(objeto(info, codigo), "httpStatusCode");
      if (status === 429) {
        return { causa: "limite_de_uso", liberaEm: null };
      }
      if (status >= 500) {
        return { causa: "sobrecarga", liberaEm: null };
      }
      if (status === 401 || status === 403) {
        return null;
      }
      return { causa: "rede", liberaEm: null };
    }
  }
  return null;
}

/** O erro é de falta de login (`unauthorized` ou HTTP 401 na conexão). */
export function erroDeFaltaDeLoginDoCodex(erro: Objeto | null): boolean {
  const info = erro === null ? undefined : erro["codexErrorInfo"];
  if (info === "unauthorized") {
    return true;
  }
  if (!ehObjeto(info)) {
    return false;
  }
  return CODIGOS_DE_CONEXAO.some((codigo) => codigo in info && [401, 403].includes(numero(objeto(info, codigo), "httpStatusCode")));
}
