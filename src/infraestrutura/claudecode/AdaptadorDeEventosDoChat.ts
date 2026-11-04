import type { EventoDoMotorDeChat, ResultadoDaResposta, UsoDaResposta } from "../../chat/MotorDeChat";
import { descreverFalha, janelasDaCota, resumirEntrada } from "./AdaptadorDeEventosDoClaudeCode";

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
};

function detalheDaFerramenta(ferramenta: string, entrada: Objeto): string {
  const campo = CAMPO_DO_DETALHE[ferramenta];
  const valor = campo === undefined ? "" : texto(entrada, campo);
  return valor === "" ? resumirEntrada(entrada) : valor.slice(0, TAMANHO_DO_DETALHE);
}

const SINAIS_DE_LIMITE_DE_USO = /usage limit|rate limit|limit reached|out of extra usage/i;

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
 */
export class AdaptadorDeEventosDoChat {
  private ultimoResultado: Objeto | null = null;
  /** Soma dos consumos desde o último `result` de cada ciclo, por modelo. */
  private readonly usoDosCiclos = new Map<string, UsoDoModelo>();
  private algumCicloSemDelta = false;

  /** Preenchido quando chega a mensagem final (`result`); nulo se o processo parou antes. */
  get resultado(): ResultadoDaResposta | null {
    const mensagem = this.ultimoResultado;
    if (mensagem === null) {
      return null;
    }
    const resposta = texto(mensagem, "result");
    const uso = this.extrairUso(mensagem);
    const sucesso = texto(mensagem, "subtype") === "success" && mensagem["is_error"] !== true;
    return sucesso ? { sucesso: true, resposta, uso } : { sucesso: false, motivo: motivoDaFalha(mensagem, resposta), uso };
  }

  traduzir(mensagem: unknown): EventoDoMotorDeChat[] {
    if (!ehObjeto(mensagem)) {
      return [];
    }
    switch (texto(mensagem, "type")) {
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

  private extrairUso(ultimo: Objeto): UsoDaResposta {
    const porModelo = this.algumCicloSemDelta ? usoDoAcumulado(ultimo) : this.usoDosCiclos;
    let modeloUsado: string | null = null;
    let maiorSaida = -1;
    let tokensDeEntradaTotal = 0;
    let tokensDeSaidaTotal = 0;
    for (const [modelo, uso] of porModelo) {
      tokensDeEntradaTotal += uso.entrada;
      tokensDeSaidaTotal += uso.saida;
      if (uso.saida > maiorSaida) {
        maiorSaida = uso.saida;
        modeloUsado = modelo;
      }
    }
    return {
      duracaoMs: numero(ultimo, "duration_ms"),
      tokensDeEntrada: tokensDeEntradaTotal,
      tokensDeSaida: tokensDeSaidaTotal,
      modeloUsado,
    };
  }
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
