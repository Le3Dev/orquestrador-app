import type { AcaoQuePedeAutorizacao, AutorizacaoPendente } from "../../chat/MensagemDoChat";
import type { EventoDoMotorDeChat, ResultadoDaResposta, UsoDaResposta } from "../../chat/MotorDeChat";
import { descreverFalha, detalheDaChamada, janelasDaCota, SINAIS_DE_LIMITE_DE_USO } from "./AdaptadorDeEventosDoClaudeCode";
import { FERRAMENTAS_DE_COMANDO_DO_CHAT, FERRAMENTAS_DE_EDICAO_DO_CHAT } from "./ArgumentosDoChat";
import { FERRAMENTA_DE_SUBAGENTES } from "./ArgumentosDoClaudeCode";

type Objeto = Record<string, unknown>;

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function texto(origem: Objeto, campo: string): string {
  const valor = origem[campo];
  return typeof valor === "string" ? valor : "";
}

function numero(origem: Objeto, campo: string): number {
  const valor = origem[campo];
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

function objeto(origem: Objeto, campo: string): Objeto {
  const valor = origem[campo];
  return ehObjeto(valor) ? valor : {};
}

function objetos(origem: Objeto, campo: string): Objeto[] {
  const valor = origem[campo];
  return Array.isArray(valor) ? valor.filter(ehObjeto) : [];
}

/** Mensagem do agente principal: `parent_tool_use_id` nulo ou ausente. */
function ehDoAgentePrincipal(mensagem: Objeto): boolean {
  return typeof mensagem["parent_tool_use_id"] !== "string";
}

const TAMANHO_DO_DETALHE = 160;

/** Campo da entrada que melhor descreve cada ferramenta do chat. */
const CAMPO_DO_DETALHE: Readonly<Record<string, string>> = {
  WebSearch: "query",
  WebFetch: "url",
  Read: "file_path",
  Glob: "pattern",
  Grep: "pattern",
  Edit: "file_path",
  Write: "file_path",
  NotebookEdit: "notebook_path",
  PowerShell: "command",
  Bash: "command",
};

/** `nome:nome`: o prefixo do plugin repetindo o nome do subagente. */
const PREFIXO_REPETIDO = /^([^:]+):\1$/;

/**
 * Nome do subagente chamado pela ferramenta `Agent`: o `subagent_type` (um
 * subagente de plugin chega como `plugin:nome`; quando o prefixo só repete o
 * nome, como em `adhd-study-coach:adhd-study-coach`, fica `nome`) ou, sem ele,
 * a `description` da chamada.
 */
function nomeDoSubagente(entrada: Objeto): string {
  const tipo = texto(entrada, "subagent_type").trim();
  const nome = tipo.replace(PREFIXO_REPETIDO, "$1");
  return nome !== "" ? nome : texto(entrada, "description").trim();
}

function detalheDaFerramenta(ferramenta: string, entrada: Objeto, tamanho = TAMANHO_DO_DETALHE): string {
  if (ferramenta === FERRAMENTA_DE_SUBAGENTES) {
    const nome = nomeDoSubagente(entrada);
    if (nome !== "") {
      return nome.slice(0, tamanho);
    }
  }
  const campo = CAMPO_DO_DETALHE[ferramenta];
  const valor = campo === undefined ? "" : texto(entrada, campo);
  // O `Workflow` do `ultracode` traz um script inteiro: mostra só o nome dele.
  return valor === "" ? detalheDaChamada(ferramenta, entrada) : valor.slice(0, tamanho);
}

/** Um comando pode ser um script inteiro; a tela precisa só de o reconhecer. */
const TAMANHO_DO_DETALHE_DA_PENDENCIA = 500;

/**
 * O que cada ferramenta negada pede ao usuário: edição de arquivo ou comando.
 * As demais (leitura, pesquisa) nunca pedem autorização.
 */
function acaoQuePedeAutorizacao(ferramenta: string): AcaoQuePedeAutorizacao | null {
  if (FERRAMENTAS_DE_EDICAO_DO_CHAT.includes(ferramenta)) {
    return "editar";
  }
  if (FERRAMENTAS_DE_COMANDO_DO_CHAT.includes(ferramenta)) {
    return "rodar_comando";
  }
  return null;
}

/**
 * Motivo que o Claude Code dá numa negação (`system`/`permission_denied`,
 * campo `decision_reason_type`): `"mode"` quando a ferramenta não estava
 * liberada (o `dontAsk` nega em vez de perguntar) e `"rule"` quando uma regra
 * do `--disallowedTools` bloqueou — essa, autorizar não resolve.
 */
const NEGADA_POR_REGRA = "rule";

/** Uma ação que o Claude Code não deixou acontecer (`permission_denials` do `result`). */
interface Negacao {
  ferramenta: string;
  idDaChamada: string;
  entrada: Objeto;
}

/**
 * Motivo legível de uma resposta que falhou. O limite de uso da assinatura
 * chega em inglês ("Claude AI usage limit reached…"); vira uma frase em
 * português com o texto original junto, que costuma dizer quando renova.
 */
function motivoDaFalha(mensagem: Objeto, resposta: string): string {
  if (SINAIS_DE_LIMITE_DE_USO.test(resposta)) {
    return `Limite de uso da assinatura do Claude atingido; tente de novo quando a cota renovar (${resposta.trim()}).`;
  }
  return descreverFalha(mensagem, resposta);
}

/**
 * Consumo por modelo (ID → uso) de um `result`. Prefere
 * `model_usage_since_last_result`, o consumo desde o `result` anterior da
 * sessão: o `modelUsage` acumula a sessão inteira, inclusive as perguntas
 * anteriores retomadas com `--resume`.
 */
function usoPorModelo(mensagem: Objeto): { porModelo: Objeto; ehDelta: boolean } {
  const delta = objeto(mensagem, "model_usage_since_last_result");
  if (Object.keys(delta).length > 0) {
    return { porModelo: delta, ehDelta: true };
  }
  return { porModelo: objeto(mensagem, "modelUsage"), ehDelta: false };
}

interface UsoDoModelo {
  entrada: number;
  saida: number;
}

/**
 * Camada anticorrupção do chat rápido: traduz o `stream-json` (com mensagens
 * parciais) do Claude Code para os eventos do chat.
 *
 * Uma instância por pergunta. O texto chega em pedaços pelos `stream_event`
 * (`content_block_delta` com `text_delta`); deltas de raciocínio e do JSON de
 * entrada das ferramentas são descartados. As ferramentas usadas aparecem nas
 * mensagens `assistant` completas, com a entrada já fechada.
 *
 * Negações: cada ação que o Claude Code não deixou acontecer chega em
 * `permission_denials` no `result` (ferramenta e entrada) e, antes, numa
 * mensagem `system`/`permission_denied` com o motivo. Sem autorização, a
 * primeira edição ou comando negado por não estar liberado vira a
 * `autorizacaoPendente`; o resto (leitura de `.env*`, regra fixa do app,
 * qualquer negação com alterações já autorizadas) vira aviso.
 */
export class AdaptadorDeEventosDoChat {
  private ultimoResultado: Objeto | null = null;
  /** Soma dos consumos desde o último `result` de cada ciclo, por modelo. */
  private readonly usoDosCiclos = new Map<string, UsoDoModelo>();
  private algumCicloSemDelta = false;
  /** Modelo do agente principal em `message.model` da última mensagem `assistant` dele. */
  private modeloDoAgentePrincipal: string | null = null;
  /** Modelo da sessão informado no `system`/`init`. */
  private modeloDoInit: string | null = null;
  /** Na ordem em que aconteceram, sem repetir a mesma chamada. */
  private readonly negacoes: Negacao[] = [];
  /** `tool_use_id` → `decision_reason_type` das mensagens `permission_denied`. */
  private readonly motivoDaNegacao = new Map<string, string>();

  /** `alteracoesAutorizadas`: com elas, nenhuma negação vira pedido de autorização. */
  constructor(private readonly alteracoesAutorizadas = false) {}

  /** Preenchido quando chega a mensagem final (`result`); nulo se o processo parou antes. */
  get resultado(): ResultadoDaResposta | null {
    const mensagem = this.ultimoResultado;
    if (mensagem === null) {
      return null;
    }
    const resposta = texto(mensagem, "result");
    const uso = this.extrairUso(mensagem);
    const sucesso = texto(mensagem, "subtype") === "success" && mensagem["is_error"] !== true;
    if (!sucesso) {
      return { sucesso: false, motivo: motivoDaFalha(mensagem, resposta), uso };
    }
    return { sucesso: true, resposta, uso, ...this.separarNegacoes() };
  }

  traduzir(mensagem: unknown): EventoDoMotorDeChat[] {
    if (!ehObjeto(mensagem)) {
      return [];
    }
    switch (texto(mensagem, "type")) {
      case "system":
        // Os `task_*` e `background_tasks_changed` (comandos e workflows em
        // segundo plano) não têm lugar no chat: só a negação interessa.
        this.registrarMotivoDaNegacao(mensagem);
        if (texto(mensagem, "subtype") !== "init") {
          return [];
        }
        this.modeloDoInit = modeloValido(texto(mensagem, "model")) ?? this.modeloDoInit;
        return [{ tipo: "sessao_aberta" }];
      case "stream_event":
        return this.traduzirTrecho(mensagem);
      case "assistant":
        return this.traduzirAssistente(mensagem);
      case "rate_limit_event": {
        const janelas = janelasDaCota(mensagem);
        return janelas.length === 0 ? [] : [{ tipo: "uso_da_cota", janelas }];
      }
      case "result":
        this.registrarResultado(mensagem);
        return [];
      default:
        return [];
    }
  }

  private traduzirTrecho(mensagem: Objeto): EventoDoMotorDeChat[] {
    if (!ehDoAgentePrincipal(mensagem)) {
      return [];
    }
    const evento = objeto(mensagem, "event");
    const delta = objeto(evento, "delta");
    if (texto(evento, "type") !== "content_block_delta" || texto(delta, "type") !== "text_delta") {
      return [];
    }
    const trecho = texto(delta, "text");
    return trecho === "" ? [] : [{ tipo: "trecho_da_resposta", texto: trecho }];
  }

  private traduzirAssistente(mensagem: Objeto): EventoDoMotorDeChat[] {
    if (!ehDoAgentePrincipal(mensagem)) {
      return [];
    }
    this.modeloDoAgentePrincipal = modeloValido(texto(objeto(mensagem, "message"), "model")) ?? this.modeloDoAgentePrincipal;
    return objetos(objeto(mensagem, "message"), "content")
      .filter((bloco) => texto(bloco, "type") === "tool_use")
      .map((bloco): EventoDoMotorDeChat => {
        const ferramenta = texto(bloco, "name");
        return { tipo: "ferramenta_do_chat", ferramenta, detalhe: detalheDaFerramenta(ferramenta, objeto(bloco, "input")) };
      });
  }

  /**
   * Um processo pode emitir mais de um `result` (o Claude Code retoma o agente
   * quando um trabalho em segundo plano termina). `modelUsage` e
   * `total_cost_usd` de cada um já são acumulados: vale o último, nunca a
   * soma. Os deltas desde o último `result`, ao contrário, são por ciclo e
   * somam — é a única forma de contar só esta pergunta numa sessão retomada.
   */
  private registrarResultado(mensagem: Objeto): void {
    this.ultimoResultado = mensagem;
    this.registrarNegacoes(mensagem);
    const { porModelo, ehDelta } = usoPorModelo(mensagem);
    if (!ehDelta) {
      this.algumCicloSemDelta = true;
      return;
    }
    for (const [modelo, uso] of Object.entries(porModelo)) {
      if (!ehObjeto(uso)) {
        continue;
      }
      const anterior = this.usoDosCiclos.get(modelo) ?? { entrada: 0, saida: 0 };
      this.usoDosCiclos.set(modelo, {
        entrada: anterior.entrada + tokensDeEntrada(uso),
        saida: anterior.saida + numero(uso, "outputTokens"),
      });
    }
  }

  private registrarMotivoDaNegacao(mensagem: Objeto): void {
    const idDaChamada = texto(mensagem, "tool_use_id");
    if (texto(mensagem, "subtype") === "permission_denied" && idDaChamada !== "") {
      this.motivoDaNegacao.set(idDaChamada, texto(mensagem, "decision_reason_type"));
    }
  }

  /**
   * Não se sabe se cada `result` traz só as negações do seu ciclo ou todas
   * as do processo: junta as de todos, sem repetir a mesma chamada.
   */
  private registrarNegacoes(mensagem: Objeto): void {
    for (const negacao of objetos(mensagem, "permission_denials")) {
      const idDaChamada = texto(negacao, "tool_use_id");
      if (idDaChamada !== "" && this.negacoes.some((anterior) => anterior.idDaChamada === idDaChamada)) {
        continue;
      }
      this.negacoes.push({
        ferramenta: texto(negacao, "tool_name"),
        idDaChamada,
        entrada: objeto(negacao, "tool_input"),
      });
    }
  }

  /**
   * Sem autorização, a primeira edição ou comando negado por não estar
   * liberado é o pedido de autorização; as edições e comandos negados depois
   * dele são cobertos pela mesma autorização. O resto vira aviso.
   */
  private separarNegacoes(): { autorizacaoPendente: AutorizacaoPendente | null; avisos: string[] } {
    let autorizacaoPendente: AutorizacaoPendente | null = null;
    const avisos = new Set<string>();
    for (const { ferramenta, idDaChamada, entrada } of this.negacoes) {
      const acao = acaoQuePedeAutorizacao(ferramenta);
      const porRegra = this.motivoDaNegacao.get(idDaChamada) === NEGADA_POR_REGRA;
      if (acao !== null && !this.alteracoesAutorizadas && !porRegra) {
        autorizacaoPendente ??= {
          acao,
          detalhe: detalheDaFerramenta(ferramenta, entrada, TAMANHO_DO_DETALHE_DA_PENDENCIA),
        };
        continue;
      }
      avisos.add(`Bloqueado pelas permissões do chat: ${ferramenta} · ${detalheDaFerramenta(ferramenta, entrada)}`);
    }
    return { autorizacaoPendente, avisos: [...avisos] };
  }

  /**
   * Tokens e custo somam todos os modelos, subagentes inclusos. O modelo
   * mostrado é o do agente principal (`message.model`, depois o `init`); só sem
   * esses dados vale o de maior saída, que com subagentes pode ser o deles.
   */
  private extrairUso(ultimo: Objeto): UsoDaResposta {
    const porModelo = this.algumCicloSemDelta ? usoDoAcumulado(ultimo) : this.usoDosCiclos;
    let modeloDeMaiorSaida: string | null = null;
    let maiorSaida = -1;
    let tokensDeEntradaTotal = 0;
    let tokensDeSaidaTotal = 0;
    for (const [modelo, uso] of porModelo) {
      tokensDeEntradaTotal += uso.entrada;
      tokensDeSaidaTotal += uso.saida;
      if (uso.saida > maiorSaida) {
        maiorSaida = uso.saida;
        modeloDeMaiorSaida = modelo;
      }
    }
    return {
      duracaoMs: numero(ultimo, "duration_ms"),
      tokensDeEntrada: tokensDeEntradaTotal,
      tokensDeSaida: tokensDeSaidaTotal,
      modeloUsado: this.modeloDoAgentePrincipal ?? this.modeloDoInit ?? modeloDeMaiorSaida,
    };
  }
}

/** Ignora vazio e o `<synthetic>` que o Claude Code põe em mensagens que ele mesmo gera. */
function modeloValido(modelo: string): string | null {
  const limpo = modelo.trim();
  return limpo === "" || limpo === "<synthetic>" ? null : limpo;
}

function tokensDeEntrada(uso: Objeto): number {
  return numero(uso, "inputTokens") + numero(uso, "cacheCreationInputTokens") + numero(uso, "cacheReadInputTokens");
}

/** Sem deltas (versões antigas do Claude Code): o `modelUsage` do último `result`. */
function usoDoAcumulado(ultimo: Objeto): Map<string, UsoDoModelo> {
  const porModelo = new Map<string, UsoDoModelo>();
  for (const [modelo, uso] of Object.entries(objeto(ultimo, "modelUsage"))) {
    if (ehObjeto(uso)) {
      porModelo.set(modelo, { entrada: tokensDeEntrada(uso), saida: numero(uso, "outputTokens") });
    }
  }
  return porModelo;
}
