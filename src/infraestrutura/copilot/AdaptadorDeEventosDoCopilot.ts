import {
  EventoDoMotor,
  JanelaDaCota,
  SituacaoFinalDoSubagente,
  UsoDoTurno,
} from "../../orquestracao/EventoDeOrquestracao";
import { CausaDaFalha, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import type { EventoDaSessaoCopilot } from "./FachadaCopilotSdk";

/**
 * Camada anticorrupção entre os eventos da sessão do GitHub Copilot (SDK) e o
 * `EventoDoMotor` do domínio (ADR-6, mesmo papel do adaptador do Claude Code).
 *
 * Um adaptador vale por turno: guarda o que o turno viu (as ferramentas, os
 * pedidos de permissão, os subagentes, o consumo) e, no fim (`session.idle`),
 * o `resultado`. Os nomes de ferramenta ficam como o Copilot os escreve
 * (`view`, `create`, `powershell`…): traduzi-los para os do Claude é uma
 * decisão da Fase 1 (a tela depende deles — `iconesDeFerramenta.ts`).
 *
 * Fora desta fase: `endereco_local_detectado` e `tarefas_atualizadas` (o
 * `session.todos_changed` só avisa que a lista mudou; o conteúdo vem por RPC).
 */

type Objeto = Record<string, unknown>;

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function texto(origem: unknown, chave: string): string {
  const valor = ehObjeto(origem) ? origem[chave] : undefined;
  return typeof valor === "string" ? valor : "";
}

function numero(origem: unknown, chave: string): number {
  const valor = ehObjeto(origem) ? origem[chave] : undefined;
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

function objeto(origem: unknown, chave: string): Objeto {
  const valor = ehObjeto(origem) ? origem[chave] : undefined;
  return ehObjeto(valor) ? valor : {};
}

function instante(evento: EventoDaSessaoCopilot): number {
  const valor = Date.parse(evento.timestamp ?? "");
  return Number.isNaN(valor) ? 0 : valor;
}

const TAMANHO_DO_DETALHE = 160;

/** Resumo curto da entrada de uma ferramenta (o comando, o caminho, a URL…), para a tela. */
export function resumirEntradaDoCopilot(entrada: unknown): string {
  for (const campo of ["command", "path", "file_path", "pattern", "url", "query"]) {
    const valor = texto(entrada, campo);
    if (valor !== "") {
      return valor.slice(0, TAMANHO_DO_DETALHE);
    }
  }
  return JSON.stringify(entrada ?? {}).slice(0, TAMANHO_DO_DETALHE);
}

/** A ferramenta com que o agente principal delega a um subagente: não aparece como ferramenta comum. */
const FERRAMENTA_DE_SUBAGENTE = "task";

/** Estimativa de tokens a partir de caracteres: o Copilot não informa os tokens do raciocínio enquanto ele corre. */
const CARACTERES_POR_TOKEN = 4;

/** Intervalo mínimo entre dois `sinal_de_vida` (pelo relógio dos próprios eventos). */
const INTERVALO_DO_SINAL_DE_VIDA_MS = 1_000;

// ---------------------------------------------------------------------------
// Cota
// ---------------------------------------------------------------------------

const NOMES_DAS_JANELAS: Readonly<Record<string, string>> = {
  premium_interactions: "Requisições premium (mês)",
};

/** Abaixo disto o saldo da janela já é aviso. */
const SALDO_DE_AVISO_EM_PERCENTUAL = 10;

/**
 * As janelas de cota do `quotaSnapshots` de um `assistant.usage` (campo que o
 * SDK marca como interno, mas o runtime envia): `chat` e `completions` costumam
 * ser ilimitados e ficam de fora; `premium_interactions` traz o saldo do mês e
 * `resetDate`, quando renova.
 */
export function janelasDaCotaDoCopilot(snapshots: unknown): JanelaDaCota[] {
  if (!ehObjeto(snapshots)) {
    return [];
  }
  const janelas: JanelaDaCota[] = [];
  for (const [chave, snapshot] of Object.entries(snapshots)) {
    if (!ehObjeto(snapshot) || snapshot["isUnlimitedEntitlement"] === true) {
      continue;
    }
    const restante = snapshot["remainingPercentage"];
    if (typeof restante !== "number" || !Number.isFinite(restante)) {
      continue;
    }
    const renovaEm = texto(snapshot, "resetDate");
    const esgotada = restante <= 0 && snapshot["usageAllowedWithExhaustedQuota"] !== true;
    janelas.push({
      nome: NOMES_DAS_JANELAS[chave] ?? chave,
      utilizacao: Math.min(1, Math.max(0, (100 - restante) / 100)),
      renovaEm: renovaEm === "" ? null : renovaEm,
      situacao: esgotada ? "rejected" : restante <= SALDO_DE_AVISO_EM_PERCENTUAL ? "allowed_warning" : "allowed",
    });
  }
  return janelas;
}

// ---------------------------------------------------------------------------
// Falhas
// ---------------------------------------------------------------------------

/** O `session.error` do runtime, só com o que a classificação lê. */
export interface ErroDaSessaoCopilot {
  /** `quota`, `rate_limit`, `authentication`, `context_limit`, `query`… */
  errorType: string;
  errorCode?: string;
  message: string;
  statusCode?: number;
}

export interface FalhaDoCopilotClassificada {
  causa: CausaDaFalha;
  /** Só no limite de uso por cota, quando a janela esgotada diz quando renova (ISO). */
  liberaEm: string | null;
  /** Falta de login (ou de saldo: o runtime informa os dois do mesmo jeito, issue #2369): a frase própria vai no motivo. */
  semAutenticacao: boolean;
}

const SINAIS_DE_LIMITE_NA_MENSAGEM = /rate limit|too many requests|quota|usage limit|limit reached|\b429\b/i;
const SINAIS_DE_SOBRECARGA =
  /overloaded|\b529\b|\b50[0234]\b|internal server error|bad gateway|service unavailable|gateway timeout|high load|temporarily limiting requests|server error/i;
const SINAIS_DE_REDE =
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|socket hang up|network|connection (?:error|lost|dropped|refused|reset)|request timed out|unable to connect|socket is closed|stream idle timeout/i;
const SINAIS_DE_FALTA_DE_LOGIN =
  /not authenticated|no github oauth token|hmac key|authenticat|unauthori[sz]ed|\b401\b|bad credentials/i;
const SINAIS_DE_MODELO_INDISPONIVEL = /is not available|does not support reasoning effort|reasoning effort .* not supported/i;

/**
 * Classifica o `session.error`: `quota` e `rate_limit` (e o 429) são limite de
 * uso; 5xx e textos de sobrecarga são sobrecarga; falhas de conexão são rede.
 * O resto é "outro". `janelaEsgotada` é a janela de cota que acabou, vista nos
 * `assistant.usage` anteriores: no limite por cota, o `renovaEm` dela é o `liberaEm`.
 */
export function classificarFalhaDoCopilot(
  erro: ErroDaSessaoCopilot,
  janelaEsgotada: JanelaDaCota | null = null,
): FalhaDoCopilotClassificada {
  const junto = `${erro.errorCode ?? ""} ${erro.message}`;
  if (erro.errorType === "quota" || /quota/i.test(erro.errorCode ?? "")) {
    return { causa: "limite_de_uso", liberaEm: janelaEsgotada?.renovaEm ?? null, semAutenticacao: false };
  }
  if (erro.errorType === "rate_limit" || erro.statusCode === 429 || SINAIS_DE_LIMITE_NA_MENSAGEM.test(junto)) {
    return { causa: "limite_de_uso", liberaEm: null, semAutenticacao: false };
  }
  if (erro.errorType === "authentication" || erro.errorType === "authorization" || SINAIS_DE_FALTA_DE_LOGIN.test(junto)) {
    return { causa: "outro", liberaEm: null, semAutenticacao: true };
  }
  if ((erro.statusCode !== undefined && erro.statusCode >= 500) || SINAIS_DE_SOBRECARGA.test(junto)) {
    return { causa: "sobrecarga", liberaEm: null, semAutenticacao: false };
  }
  if (SINAIS_DE_REDE.test(junto)) {
    return { causa: "rede", liberaEm: null, semAutenticacao: false };
  }
  return { causa: "outro", liberaEm: null, semAutenticacao: false };
}

const TAMANHO_DO_DETALHE_DA_FALHA = 300;

function resumirDetalhe(original: string): string {
  const limpo = original.replace(/\s+/g, " ").trim();
  return limpo.length <= TAMANHO_DO_DETALHE_DA_FALHA ? limpo : `${limpo.slice(0, TAMANHO_DO_DETALHE_DA_FALHA - 1)}…`;
}

const FRASES_DAS_CAUSAS: Readonly<Record<"limite_de_uso" | "sobrecarga" | "rede", string>> = {
  limite_de_uso: "Limite de uso do GitHub Copilot atingido",
  sobrecarga: "Os servidores do GitHub Copilot estão sobrecarregados ou com erro",
  rede: "Falha de conexão com os servidores do GitHub Copilot",
};

const FRASE_SEM_LOGIN =
  "O GitHub Copilot não autenticou (sem login ou sem saldo de créditos: o runtime informa os dois do mesmo jeito). Entre com `copilot login` e confira o saldo";

const FRASE_DO_MODELO = "O modelo ou o esforço escolhido não está disponível no GitHub Copilot";

/** O resultado de falha de um `session.error`: causa, `liberaEm` e um motivo em português. */
export function falhaDoCopilot(
  erro: ErroDaSessaoCopilot,
  uso: UsoDoTurno | null,
  janelaEsgotada: JanelaDaCota | null = null,
): Extract<ResultadoDoTurno, { sucesso: false }> {
  const { causa, liberaEm, semAutenticacao } = classificarFalhaDoCopilot(erro, janelaEsgotada);
  const detalhe = resumirDetalhe(erro.message);
  const sufixo = detalhe === "" ? "." : ` (${detalhe}).`;
  if (causa === "limite_de_uso") {
    return { sucesso: false, motivo: `${FRASES_DAS_CAUSAS.limite_de_uso}${sufixo}`, uso, causa, liberaEm };
  }
  if (causa === "sobrecarga" || causa === "rede") {
    return { sucesso: false, motivo: `${FRASES_DAS_CAUSAS[causa]}${sufixo}`, uso, causa };
  }
  if (semAutenticacao) {
    return { sucesso: false, motivo: `${FRASE_SEM_LOGIN}${sufixo}`, uso, causa };
  }
  if (SINAIS_DE_MODELO_INDISPONIVEL.test(erro.message)) {
    return { sucesso: false, motivo: `${FRASE_DO_MODELO}${sufixo}`, uso, causa };
  }
  return {
    sucesso: false,
    motivo: detalhe === "" ? "O GitHub Copilot terminou com erro." : `O GitHub Copilot terminou com erro: ${detalhe}`,
    uso,
    causa,
  };
}

// ---------------------------------------------------------------------------
// O adaptador
// ---------------------------------------------------------------------------

interface EstadoDoSubagente {
  chamada: string;
  papel: string;
  inicioMs: number;
  tokens: number;
  ferramentasUsadas: number;
  ultimoTexto: string;
}

export class AdaptadorDeEventosDoCopilot {
  private readonly ferramentaPorChamada = new Map<string, string>();
  private readonly pedidosPorId = new Map<string, { ferramenta: string; detalhe: string }>();
  private readonly tarefaPorChamada = new Map<string, { descricao: string; tarefa: string }>();
  private readonly subagentePorChamada = new Map<string, string>();
  private readonly subagentes = new Map<string, EstadoDoSubagente>();
  private ultimaCota = "";
  private janelaEsgotada: JanelaDaCota | null = null;
  private caracteresDeRaciocinio = 0;
  private ultimoSinalDeVida = Number.NEGATIVE_INFINITY;
  private inicioDoTurnoMs: number | null = null;
  private fimDoTurnoMs: number | null = null;
  private tokensDeEntrada = 0;
  private tokensDeSaida = 0;
  private nanoAiu = 0;
  private subagentesLancados = 0;
  private resposta = "";
  private erro: ErroDaSessaoCopilot | null = null;
  private respondeuDepoisDoErro = false;
  private idle = false;
  private interrompido = false;

  /** O `session.idle` do agente principal chegou: o turno acabou (ou foi interrompido). */
  get terminou(): boolean {
    return this.idle;
  }

  /** O `session.idle` veio com `aborted`: alguém pediu `abort()` (ou a sessão cancelou sozinha). */
  get interrompidoPeloAbort(): boolean {
    return this.interrompido;
  }

  /** Consumo em créditos de IA (`copilotUsage.totalNanoAiu` ÷ 10⁹) dos chamados do agente principal. */
  get creditosDeIA(): number {
    return this.nanoAiu / 1_000_000_000;
  }

  /** O que o turno consumiu até agora, para um resultado de falha ou o `uso` do sucesso. */
  get uso(): UsoDoTurno {
    const inicio = this.inicioDoTurnoMs;
    const fim = this.fimDoTurnoMs;
    return {
      duracaoMs: inicio !== null && fim !== null ? Math.max(0, fim - inicio) : 0,
      tokensDeEntrada: this.tokensDeEntrada,
      tokensDeSaida: this.tokensDeSaida,
      subagentesLancados: this.subagentesLancados,
    };
  }

  /**
   * O resultado do turno, depois do `session.idle` (nulo antes). Um
   * `session.error` sem resposta depois dele é falha, com a causa classificada.
   */
  get resultado(): ResultadoDoTurno | null {
    if (!this.idle) {
      return null;
    }
    if (this.erro !== null && !this.respondeuDepoisDoErro) {
      return falhaDoCopilot(this.erro, this.uso, this.janelaEsgotada);
    }
    if (this.interrompido) {
      return { sucesso: false, motivo: "O turno foi interrompido antes de terminar.", uso: this.uso };
    }
    return { sucesso: true, resposta: this.resposta, uso: this.uso };
  }

  traduzir(evento: EventoDaSessaoCopilot): EventoDoMotor[] {
    const momento = instante(evento);
    if (momento > 0) {
      this.inicioDoTurnoMs ??= momento;
      this.fimDoTurnoMs = momento;
    }
    const subagenteId = evento.agentId;
    switch (evento.type) {
      case "assistant.message":
        return this.traduzirMensagem(evento, subagenteId);
      case "assistant.reasoning_delta":
        return subagenteId === undefined ? this.traduzirRaciocinio(evento, momento) : [];
      case "assistant.usage":
        return this.traduzirUso(evento, subagenteId);
      case "tool.execution_start":
        return this.traduzirInicioDeFerramenta(evento, subagenteId, momento);
      case "tool.execution_complete":
        return this.traduzirFimDeFerramenta(evento);
      case "permission.requested":
        this.guardarPedido(evento);
        return [];
      case "permission.completed":
        return this.traduzirDecisao(evento);
      case "subagent.started":
        return this.traduzirInicioDeSubagente(evento, subagenteId, momento);
      case "subagent.completed":
        return this.traduzirFimDeSubagente(evento, subagenteId, false);
      case "subagent.failed":
        return this.traduzirFimDeSubagente(evento, subagenteId, true);
      case "session.error":
        if (subagenteId === undefined) {
          this.erro = {
            errorType: texto(evento.data, "errorType"),
            message: texto(evento.data, "message"),
            ...(texto(evento.data, "errorCode") === "" ? {} : { errorCode: texto(evento.data, "errorCode") }),
            ...(numero(evento.data, "statusCode") === 0 ? {} : { statusCode: numero(evento.data, "statusCode") }),
          };
          this.respondeuDepoisDoErro = false;
        }
        return [];
      case "session.idle":
        if (subagenteId === undefined) {
          this.idle = true;
          this.interrompido = ehObjeto(evento.data) && evento.data["aborted"] === true;
        }
        return [];
      default:
        return [];
    }
  }

  private traduzirMensagem(evento: EventoDaSessaoCopilot, subagenteId: string | undefined): EventoDoMotor[] {
    const conteudo = texto(evento.data, "content");
    if (conteudo.trim() === "") {
      return [];
    }
    if (subagenteId !== undefined) {
      const estado = this.subagentes.get(subagenteId);
      if (estado !== undefined) {
        estado.ultimoTexto = conteudo;
      }
      return [{ tipo: "texto_do_subagente", subagenteId, texto: conteudo }];
    }
    this.resposta = conteudo;
    this.respondeuDepoisDoErro = true;
    return [{ tipo: "texto_do_orquestrador", texto: conteudo }];
  }

  /** O raciocínio chega aos pedaços: vira `sinal_de_vida` (no máximo um por segundo), com os tokens estimados. */
  private traduzirRaciocinio(evento: EventoDaSessaoCopilot, momento: number): EventoDoMotor[] {
    this.caracteresDeRaciocinio += texto(evento.data, "deltaContent").length;
    if (momento - this.ultimoSinalDeVida < INTERVALO_DO_SINAL_DE_VIDA_MS) {
      return [];
    }
    this.ultimoSinalDeVida = momento;
    return [{ tipo: "sinal_de_vida", tokensPensando: Math.ceil(this.caracteresDeRaciocinio / CARACTERES_POR_TOKEN) }];
  }

  private traduzirUso(evento: EventoDaSessaoCopilot, subagenteId: string | undefined): EventoDoMotor[] {
    const entrada = numero(evento.data, "inputTokens");
    const saida = numero(evento.data, "outputTokens");
    if (subagenteId !== undefined) {
      const estado = this.subagentes.get(subagenteId);
      if (estado !== undefined) {
        estado.tokens += entrada + saida;
      }
      return [];
    }
    this.tokensDeEntrada += entrada;
    this.tokensDeSaida += saida;
    this.nanoAiu += numero(objeto(evento.data, "copilotUsage"), "totalNanoAiu");

    const janelas = janelasDaCotaDoCopilot(objeto(evento.data, "quotaSnapshots"));
    this.janelaEsgotada = janelas.find((janela) => janela.situacao === "rejected") ?? null;
    const assinatura = JSON.stringify(janelas);
    if (janelas.length === 0 || assinatura === this.ultimaCota) {
      return [];
    }
    this.ultimaCota = assinatura;
    return [{ tipo: "uso_da_cota", janelas }];
  }

  private traduzirInicioDeFerramenta(
    evento: EventoDaSessaoCopilot,
    subagenteId: string | undefined,
    momento: number,
  ): EventoDoMotor[] {
    const nome = texto(evento.data, "toolName");
    const chamada = texto(evento.data, "toolCallId");
    const argumentos = objeto(evento.data, "arguments");
    this.ferramentaPorChamada.set(chamada, nome);

    if (subagenteId !== undefined) {
      const estado = this.subagentes.get(subagenteId);
      if (estado === undefined) {
        return [];
      }
      estado.ferramentasUsadas += 1;
      const titulo = texto(evento.data, "toolTitle");
      return [
        {
          tipo: "progresso_do_subagente",
          subagenteId,
          atividade: titulo === "" ? nome : `${titulo}: ${resumirEntradaDoCopilot(argumentos)}`.slice(0, TAMANHO_DO_DETALHE),
          ultimaFerramenta: nome,
          tokens: estado.tokens,
          ferramentasUsadas: estado.ferramentasUsadas,
          duracaoMs: Math.max(0, momento - estado.inicioMs),
        },
      ];
    }
    if (nome === FERRAMENTA_DE_SUBAGENTE) {
      const descricao = texto(argumentos, "description") || texto(argumentos, "name");
      this.tarefaPorChamada.set(chamada, { descricao, tarefa: texto(argumentos, "prompt") });
      return [];
    }
    return [{ tipo: "ferramenta_do_orquestrador", ferramenta: nome, detalhe: resumirEntradaDoCopilot(argumentos) }];
  }

  /** O retorno da chamada `task` traz o relatório final do subagente. */
  private traduzirFimDeFerramenta(evento: EventoDaSessaoCopilot): EventoDoMotor[] {
    const chamada = texto(evento.data, "toolCallId");
    const subagenteId = this.subagentePorChamada.get(chamada);
    if (subagenteId === undefined || this.ferramentaPorChamada.get(chamada) !== FERRAMENTA_DE_SUBAGENTE) {
      return [];
    }
    const resultado = texto(objeto(evento.data, "result"), "content").trim();
    return evento.agentId === undefined && resultado !== "" ? [{ tipo: "resultado_do_subagente", subagenteId, resultado }] : [];
  }

  private guardarPedido(evento: EventoDaSessaoCopilot): void {
    const requisicao = objeto(evento.data, "permissionRequest");
    const tipo = texto(requisicao, "kind");
    const chamada = texto(requisicao, "toolCallId");
    const detalhe =
      texto(requisicao, "fullCommandText") ||
      texto(requisicao, "fileName") ||
      texto(requisicao, "path") ||
      texto(requisicao, "url") ||
      texto(requisicao, "toolName");
    this.pedidosPorId.set(texto(evento.data, "requestId"), {
      ferramenta: this.ferramentaPorChamada.get(chamada) ?? tipo,
      detalhe: detalhe.slice(0, TAMANHO_DO_DETALHE),
    });
  }

  /** Uma recusa (`denied-*`) vira `permissao_negada`: o app negou pela política, ou o runtime pela dele. */
  private traduzirDecisao(evento: EventoDaSessaoCopilot): EventoDoMotor[] {
    const veredito = texto(objeto(evento.data, "result"), "kind");
    if (!veredito.startsWith("denied")) {
      return [];
    }
    const pedido = this.pedidosPorId.get(texto(evento.data, "requestId"));
    const ferramenta = pedido?.ferramenta ?? this.ferramentaPorChamada.get(texto(evento.data, "toolCallId")) ?? "desconhecida";
    return [{ tipo: "permissao_negada", ferramenta, detalhe: pedido?.detalhe ?? "" }];
  }

  private traduzirInicioDeSubagente(
    evento: EventoDaSessaoCopilot,
    subagenteId: string | undefined,
    momento: number,
  ): EventoDoMotor[] {
    const chamada = texto(evento.data, "toolCallId");
    // O id da instância vem no envelope; sem ele, a chamada que o lançou identifica o subagente.
    const id = subagenteId ?? chamada;
    const papel = texto(evento.data, "agentName") || "executor";
    this.subagentes.set(id, { chamada, papel, inicioMs: momento, tokens: 0, ferramentasUsadas: 0, ultimoTexto: "" });
    this.subagentePorChamada.set(chamada, id);
    this.subagentesLancados += 1;
    const pedido = this.tarefaPorChamada.get(chamada);
    const descricao = texto(evento.data, "agentDisplayName");
    const resumo = texto(evento.data, "agentDescription");
    return [
      {
        tipo: "subagente_iniciado",
        subagenteId: id,
        descricao: pedido?.descricao || descricao || resumo,
        tarefa: pedido?.tarefa || resumo,
        papel,
      },
    ];
  }

  private traduzirFimDeSubagente(
    evento: EventoDaSessaoCopilot,
    subagenteId: string | undefined,
    falhou: boolean,
  ): EventoDoMotor[] {
    const id = subagenteId ?? this.subagentePorChamada.get(texto(evento.data, "toolCallId")) ?? texto(evento.data, "toolCallId");
    const estado = this.subagentes.get(id);
    const cancelado = ehObjeto(evento.data) && evento.data["cancelled"] === true;
    const situacao: SituacaoFinalDoSubagente = falhou ? "falhou" : cancelado ? "cancelado" : "concluido";
    const informados = numero(evento.data, "totalTokens");
    return [
      {
        tipo: "subagente_concluido",
        subagenteId: id,
        situacao,
        resumo: falhou ? texto(evento.data, "error") : (estado?.ultimoTexto ?? ""),
        tokens: informados > 0 ? informados : (estado?.tokens ?? 0),
        duracaoMs: numero(evento.data, "durationMs"),
      },
    ];
  }
}
