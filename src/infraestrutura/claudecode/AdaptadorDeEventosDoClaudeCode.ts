import {
  EventoDoMotor,
  JanelaDaCota,
  SituacaoFinalDoSubagente,
  UsoDoTurno,
} from "../../orquestracao/EventoDeOrquestracao";
import { ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";

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

/** Ferramentas com que o Orquestrador lança Subagentes; usá-las é o trabalho dele. */
const FERRAMENTAS_DE_SUBAGENTE = new Set(["Agent", "Task"]);

/** Bloco que o Claude Code acrescenta ao resultado de um subagente; não é texto do subagente. */
const MARCA_DO_CLAUDE_CODE = "<tools-used-before-summary>";

const NOMES_DAS_JANELAS: Readonly<Record<string, string>> = {
  five_hour: "5 horas",
  seven_day: "7 dias",
  seven_day_opus: "7 dias (Opus)",
  seven_day_sonnet: "7 dias (Sonnet)",
};

const TAMANHO_DO_DETALHE = 160;

/**
 * Junta o consumo de dois ciclos do mesmo processo. Tokens e duração vêm por
 * ciclo e somam; `subagent_stats` já é acumulado no processo, então vale o maior.
 */
function somarUso(anterior: UsoDoTurno | null, atual: UsoDoTurno): UsoDoTurno {
  if (anterior === null) {
    return atual;
  }
  return {
    duracaoMs: anterior.duracaoMs + atual.duracaoMs,
    tokensDeEntrada: anterior.tokensDeEntrada + atual.tokensDeEntrada,
    tokensDeSaida: anterior.tokensDeSaida + atual.tokensDeSaida,
    subagentesLancados: Math.max(anterior.subagentesLancados, atual.subagentesLancados),
  };
}

function resumirEntrada(entrada: Objeto): string {
  for (const campo of ["command", "file_path", "path", "pattern", "url", "query"]) {
    const valor = texto(entrada, campo);
    if (valor !== "") {
      return valor.slice(0, TAMANHO_DO_DETALHE);
    }
  }
  return JSON.stringify(entrada).slice(0, TAMANHO_DO_DETALHE);
}

function situacaoDoSubagente(situacao: string): SituacaoFinalDoSubagente {
  if (situacao === "completed") {
    return "concluido";
  }
  if (situacao === "failed") {
    return "falhou";
  }
  return "cancelado";
}

const MOTIVOS_POR_SUBTIPO: Readonly<Record<string, string>> = {
  error_max_turns: "O orquestrador atingiu o limite de passos sem terminar.",
  error_during_execution: "O Claude Code encontrou um erro durante a execução.",
};

/**
 * Camada anticorrupção: traduz as mensagens `stream-json` do Claude Code para
 * os eventos do domínio.
 *
 * Uma instância por turno, porque guarda a ligação entre a chamada que lançou
 * cada Subagente (`tool_use_id`) e o Subagente (`task_id`) — o resultado final
 * de um Subagente chega referenciando a chamada, não o Subagente.
 *
 * Mensagens que não interessam à tela (thinking, contagem de tokens de
 * raciocínio, chamadas internas dos subagentes) são descartadas aqui; o
 * progresso dos Subagentes chega resumido pelos eventos `task_progress`.
 */
export class AdaptadorDeEventosDoClaudeCode {
  private readonly subagentePorChamada = new Map<string, string>();
  private resultadoDoTurno: ResultadoDoTurno | null = null;
  private usoAcumulado: UsoDoTurno | null = null;
  private sessaoAnunciada = false;

  /** Preenchido quando chega a mensagem final (`result`); nulo se o processo parou antes. */
  get resultado(): ResultadoDoTurno | null {
    return this.resultadoDoTurno;
  }

  traduzir(mensagem: unknown): EventoDoMotor[] {
    if (!ehObjeto(mensagem)) {
      return [];
    }
    switch (texto(mensagem, "type")) {
      case "system":
        return this.traduzirSistema(mensagem);
      case "assistant":
        return this.traduzirAssistente(mensagem);
      case "user":
        return this.traduzirRetorno(mensagem);
      case "rate_limit_event":
        return this.traduzirCota(mensagem);
      case "result":
        return this.traduzirResultado(mensagem);
      default:
        return [];
    }
  }

  private traduzirSistema(mensagem: Objeto): EventoDoMotor[] {
    const subagenteId = texto(mensagem, "task_id");

    switch (texto(mensagem, "subtype")) {
      case "init":
        // Cada ciclo do Orquestrador reenvia `init`; a sessão só nasce uma vez.
        if (this.sessaoAnunciada) {
          return [];
        }
        this.sessaoAnunciada = true;
        return [{ tipo: "sessao_iniciada" }];
      case "thinking_tokens":
        // Chega enquanto o Claude raciocina — às vezes por minutos, sem mais
        // nada acontecendo: é o que mostra que ele não travou.
        return [{ tipo: "sinal_de_vida", tokensPensando: numero(mensagem, "estimated_tokens") }];
      case "task_started":
        this.subagentePorChamada.set(texto(mensagem, "tool_use_id"), subagenteId);
        return [
          {
            tipo: "subagente_iniciado",
            subagenteId,
            descricao: texto(mensagem, "description"),
            tarefa: texto(mensagem, "prompt"),
          },
        ];
      case "task_progress": {
        const uso = objeto(mensagem, "usage");
        const ultimaFerramenta = texto(mensagem, "last_tool_name");
        return [
          {
            tipo: "progresso_do_subagente",
            subagenteId,
            atividade: texto(mensagem, "description"),
            ultimaFerramenta: ultimaFerramenta === "" ? null : ultimaFerramenta,
            tokens: numero(uso, "total_tokens"),
            ferramentasUsadas: numero(uso, "tool_uses"),
            duracaoMs: numero(uso, "duration_ms"),
          },
        ];
      }
      case "task_notification": {
        const uso = objeto(mensagem, "usage");
        return [
          {
            tipo: "subagente_concluido",
            subagenteId,
            situacao: situacaoDoSubagente(texto(mensagem, "status")),
            resumo: texto(mensagem, "summary"),
            tokens: numero(uso, "total_tokens"),
            duracaoMs: numero(uso, "duration_ms"),
          },
        ];
      }
      default:
        return [];
    }
  }

  private traduzirAssistente(mensagem: Objeto): EventoDoMotor[] {
    const blocos = objetos(objeto(mensagem, "message"), "content");
    const chamadaDeOrigem = mensagem["parent_tool_use_id"];

    if (typeof chamadaDeOrigem === "string") {
      const subagenteId =
        texto(mensagem, "agent_id") || this.subagentePorChamada.get(chamadaDeOrigem) || chamadaDeOrigem;
      return blocos
        .filter((bloco) => texto(bloco, "type") === "text" && texto(bloco, "text").trim() !== "")
        .map((bloco) => ({ tipo: "texto_do_subagente", subagenteId, texto: texto(bloco, "text") }));
    }

    const eventos: EventoDoMotor[] = [];
    for (const bloco of blocos) {
      const tipo = texto(bloco, "type");
      if (tipo === "text" && texto(bloco, "text").trim() !== "") {
        eventos.push({ tipo: "texto_do_orquestrador", texto: texto(bloco, "text") });
      }
      if (tipo === "tool_use" && !FERRAMENTAS_DE_SUBAGENTE.has(texto(bloco, "name"))) {
        eventos.push({
          tipo: "ferramenta_do_orquestrador",
          ferramenta: texto(bloco, "name"),
          detalhe: resumirEntrada(objeto(bloco, "input")),
        });
      }
    }
    return eventos;
  }

  /**
   * O retorno de cada chamada de Subagente traz o relatório final dele.
   *
   * Só quando a chamada terminou (`completed`): um Subagente lançado em
   * segundo plano devolve na hora um retorno vazio, e o relatório dele chega
   * depois, no resumo do `task_notification`.
   */
  private traduzirRetorno(mensagem: Objeto): EventoDoMotor[] {
    const estruturado = objeto(mensagem, "tool_use_result");
    if (mensagem["parent_tool_use_id"] !== null || texto(estruturado, "status") !== "completed") {
      return [];
    }

    const eventos: EventoDoMotor[] = [];

    for (const bloco of objetos(objeto(mensagem, "message"), "content")) {
      if (texto(bloco, "type") !== "tool_result") {
        continue;
      }
      const subagenteId = this.subagentePorChamada.get(texto(bloco, "tool_use_id"));
      if (subagenteId === undefined || texto(estruturado, "agentId") !== subagenteId) {
        continue;
      }
      const resultado = objetos(estruturado, "content")
        .map((parte) => texto(parte, "text"))
        .filter((parte) => !parte.startsWith(MARCA_DO_CLAUDE_CODE))
        .join("")
        .trim();
      if (resultado !== "") {
        eventos.push({ tipo: "resultado_do_subagente", subagenteId, resultado });
      }
    }
    return eventos;
  }

  private traduzirCota(mensagem: Objeto): EventoDoMotor[] {
    const janelas: JanelaDaCota[] = Object.entries(objeto(objeto(mensagem, "rate_limit_info"), "unifiedWindows"))
      .filter((entrada): entrada is [string, Objeto] => ehObjeto(entrada[1]))
      .map(([chave, janela]) => {
        const renovaEm = numero(janela, "resetsAt");
        return {
          nome: NOMES_DAS_JANELAS[chave] ?? chave,
          utilizacao: numero(janela, "utilization"),
          renovaEm: renovaEm > 0 ? new Date(renovaEm * 1000).toISOString() : null,
          situacao: texto(janela, "status"),
        };
      });
    return janelas.length === 0 ? [] : [{ tipo: "uso_da_cota", janelas }];
  }

  /**
   * Um mesmo processo pode emitir mais de um `result`: quando um Subagente em
   * segundo plano termina, o Claude Code retoma o Orquestrador num novo ciclo.
   * Vale a resposta do último; o consumo é a soma de todos.
   */
  private traduzirResultado(mensagem: Objeto): EventoDoMotor[] {
    const uso = somarUso(this.usoAcumulado, this.extrairUso(mensagem));
    this.usoAcumulado = uso;
    const resposta = texto(mensagem, "result");
    const sucesso = texto(mensagem, "subtype") === "success" && mensagem["is_error"] !== true;

    this.resultadoDoTurno = sucesso
      ? { sucesso: true, resposta, uso }
      : { sucesso: false, motivo: this.descreverFalha(mensagem, resposta), uso };

    return objetos(mensagem, "permission_denials").map((negacao) => ({
      tipo: "permissao_negada",
      ferramenta: texto(negacao, "tool_name"),
      detalhe: resumirEntrada(objeto(negacao, "tool_input")),
    }));
  }

  /**
   * Usa o consumo desde o último resultado: `modelUsage` acumula a sessão
   * inteira, e um turno retomado somaria os anteriores.
   */
  private extrairUso(mensagem: Objeto): UsoDoTurno {
    const doTurno = objeto(mensagem, "model_usage_since_last_result");
    const porModelo = Object.values(Object.keys(doTurno).length > 0 ? doTurno : objeto(mensagem, "modelUsage")).filter(
      ehObjeto,
    );

    return {
      duracaoMs: numero(mensagem, "duration_ms"),
      tokensDeEntrada: porModelo.reduce(
        (soma, modelo) =>
          soma +
          numero(modelo, "inputTokens") +
          numero(modelo, "cacheReadInputTokens") +
          numero(modelo, "cacheCreationInputTokens"),
        0,
      ),
      tokensDeSaida: porModelo.reduce((soma, modelo) => soma + numero(modelo, "outputTokens"), 0),
      subagentesLancados: numero(objeto(mensagem, "subagent_stats"), "spawned"),
    };
  }

  private descreverFalha(mensagem: Objeto, resposta: string): string {
    if (resposta.trim() !== "") {
      return resposta;
    }
    const subtipo = texto(mensagem, "subtype");
    return MOTIVOS_POR_SUBTIPO[subtipo] ?? `O Claude Code terminou com erro (${subtipo || "sem detalhes"}).`;
  }
}
