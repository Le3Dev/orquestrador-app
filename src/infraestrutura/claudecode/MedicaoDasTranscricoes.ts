import type { DadosDoUso } from "../../orquestracao/UsoDeTokens";

/**
 * Núcleo puro da medição de consumo pelas transcrições do Claude Code
 * (`<pasta do Claude>/projects/<slug>/<sessao>.jsonl` e
 * `.../<sessao>/subagents/agent-*.jsonl`). Trazido do benchmark local, que
 * passa a importar daqui; o que é só do benchmark (stream-json, comparação
 * com o informado) ficou lá.
 */

// ---------------------------------------------------------------------------
// Leitura defensiva de JSON sem tipo
// ---------------------------------------------------------------------------

export type Objeto = Record<string, unknown>;

export function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

export function texto(origem: Objeto, campo: string): string {
  const valor = origem[campo];
  return typeof valor === "string" ? valor : "";
}

export function numero(origem: Objeto, campo: string): number {
  const valor = origem[campo];
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

export function objeto(origem: Objeto, campo: string): Objeto {
  const valor = origem[campo];
  return ehObjeto(valor) ? valor : {};
}

export function objetos(origem: Objeto, campo: string): Objeto[] {
  const valor = origem[campo];
  return Array.isArray(valor) ? valor.filter(ehObjeto) : [];
}

/** Uma linha JSON; vazia ou inválida (ex.: truncada no meio da escrita) vira `undefined`. */
export function lerLinhaJson(linha: string): unknown {
  if (linha.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(linha) as unknown;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Uso de tokens (dados simples, no formato do domínio)
// ---------------------------------------------------------------------------

export function usoVazio(): DadosDoUso {
  return { entrada: 0, criacaoDeCache: 0, leituraDeCache: 0, saida: 0 };
}

export function somarUso(a: DadosDoUso, b: DadosDoUso): DadosDoUso {
  return {
    entrada: a.entrada + b.entrada,
    criacaoDeCache: a.criacaoDeCache + b.criacaoDeCache,
    leituraDeCache: a.leituraDeCache + b.leituraDeCache,
    saida: a.saida + b.saida,
  };
}

function maiorUso(a: DadosDoUso, b: DadosDoUso): DadosDoUso {
  return {
    entrada: Math.max(a.entrada, b.entrada),
    criacaoDeCache: Math.max(a.criacaoDeCache, b.criacaoDeCache),
    leituraDeCache: Math.max(a.leituraDeCache, b.leituraDeCache),
    saida: Math.max(a.saida, b.saida),
  };
}

export function totalDeTokens(uso: DadosDoUso): number {
  return uso.entrada + uso.criacaoDeCache + uso.leituraDeCache + uso.saida;
}

/**
 * Custo em "tokens de entrada equivalentes": criação de cache custa 1,25×,
 * leitura de cache 0,1× e saída 5× o token de entrada (mesmos pesos de
 * `UsoDeTokens.indiceDeCusto`).
 */
export function indiceDeCusto(uso: DadosDoUso): number {
  return Math.round(uso.entrada + 1.25 * uso.criacaoDeCache + 0.1 * uso.leituraDeCache + 5 * uso.saida);
}

// ---------------------------------------------------------------------------
// Recorte por período
// ---------------------------------------------------------------------------

export interface JanelaDeTempo {
  inicio: Date;
  fim: Date;
}

/** Folgas do recorte do turno: o processo pode gravar um pouco antes/depois do que o app registrou. */
export const FOLGA_ANTES_DO_TURNO_MS = 2_000;
export const FOLGA_DEPOIS_DO_TURNO_MS = 5_000;

/** Janela de um turno com as folgas: `inicio - 2 s` até `fim + 5 s`. */
export function janelaDoTurno(inicio: Date, fim: Date): JanelaDeTempo {
  return {
    inicio: new Date(inicio.getTime() - FOLGA_ANTES_DO_TURNO_MS),
    fim: new Date(fim.getTime() + FOLGA_DEPOIS_DO_TURNO_MS),
  };
}

/**
 * A linha tem `timestamp` dentro da janela (inclusive)? Linhas sem
 * `timestamp` válido ficam de fora — com `--resume` a transcrição acumula a
 * conversa inteira e não dá para saber de qual turno elas são.
 */
export function linhaNaJanela(linha: unknown, janela: JanelaDeTempo): boolean {
  if (!ehObjeto(linha)) {
    return false;
  }
  const instante = Date.parse(texto(linha, "timestamp"));
  return Number.isFinite(instante) && instante >= janela.inicio.getTime() && instante <= janela.fim.getTime();
}

// ---------------------------------------------------------------------------
// Medição
// ---------------------------------------------------------------------------

export type PapelDaTranscricao = "principal" | "subagente";

export interface TranscricaoLida {
  papel: PapelDaTranscricao;
  /** Id do subagente (nome do arquivo `agent-<id>.jsonl`); nulo na principal. */
  agenteId: string | null;
  /** `agentType` do `.meta.json` do subagente (ex.: `executor`, `general-purpose`). */
  tipoDeAgente: string | null;
  /** `toolUseId` do `.meta.json`: id da chamada `Agent` que lançou o subagente. */
  chamadaId?: string | null;
  linhas: readonly unknown[];
}

export interface MedicaoDasTranscricoes {
  total: DadosDoUso;
  principal: DadosDoUso;
  subagentes: DadosDoUso;
  porModelo: Record<string, DadosDoUso>;
  ferramentas: Record<string, number>;
  /** Subagentes com linhas lidas (sem contar a compactação). */
  subagentesLancados: number;
  subagentesPorTipo: Record<string, number>;
  /** Subagentes cujo `toolUseId` (meta.json) não casa com nenhuma chamada `Agent`/`Task` das transcrições. */
  subagentesSemChamada: string[];
  /** Chamadas `Agent`/`Task` sem transcrição de subagente correspondente (recusadas, interrompidas…). */
  chamadasSemSubagente: string[];
  /** Mensagens distintas (por `message.id`) contadas. */
  mensagens: number;
  /** Modelo com mais tokens de saída no agente principal (sem compactação nem `<synthetic>`); nulo se nenhum. */
  modeloDoPrincipal: string | null;
}

export const MODELO_SINTETICO = "<synthetic>";

/** Ferramenta que lança subagentes (`Task` em versões antigas). */
const FERRAMENTAS_DE_SUBAGENTE = new Set(["Agent", "Task"]);

/**
 * Arquivos `agent-acompact-*.jsonl` são a compactação automática do contexto,
 * não subagentes lançados: o consumo conta para a sessão principal.
 */
export function ehCompactacao(agenteId: string | null): boolean {
  return agenteId !== null && /^acompact/i.test(agenteId);
}

function usoDaMensagem(uso: Objeto): DadosDoUso {
  return {
    entrada: numero(uso, "input_tokens"),
    criacaoDeCache: numero(uso, "cache_creation_input_tokens"),
    leituraDeCache: numero(uso, "cache_read_input_tokens"),
    saida: numero(uso, "output_tokens"),
  };
}

function incrementar(contagem: Record<string, number>, chave: string): void {
  contagem[chave] = (contagem[chave] ?? 0) + 1;
}

interface MensagemContada {
  papel: PapelDaTranscricao;
  /** Do próprio agente principal (não da compactação nem de linha lateral). */
  doPrincipal: boolean;
  modelo: string;
  uso: DadosDoUso;
}

/**
 * Soma `message.usage` por modelo e por papel (principal × subagentes).
 *
 * Cada resposta da API aparece em várias linhas (uma por bloco de conteúdo),
 * todas com o mesmo `message.id` e o mesmo `usage`: conta-se uma vez por id
 * (o maior valor de cada campo, por segurança). Linhas `isSidechain` no
 * arquivo principal (versões antigas) contam como subagente. Transcrições
 * sem nenhuma linha não contam como subagente lançado (útil quando as linhas
 * já vêm recortadas por período).
 */
export function medirTranscricoes(transcricoes: readonly TranscricaoLida[]): MedicaoDasTranscricoes {
  const comLinhas = transcricoes.filter((transcricao) => transcricao.linhas.length > 0);
  const mensagens = new Map<string, MensagemContada>();
  const chamadas = new Map<string, string>();
  const agentes = new Map<string, string>();
  /** agenteId → toolUseId do meta.json (nulo se ausente). */
  const chamadaDoAgente = new Map<string, string | null>();
  const temArquivosDeSubagente = comLinhas.some(
    (transcricao) => transcricao.papel === "subagente" && !ehCompactacao(transcricao.agenteId),
  );
  let semId = 0;

  comLinhas.forEach((transcricao, indice) => {
    const compactacao = transcricao.papel === "subagente" && ehCompactacao(transcricao.agenteId);
    if (transcricao.papel === "subagente" && !compactacao) {
      const agenteId = transcricao.agenteId ?? `arquivo-${indice}`;
      agentes.set(agenteId, transcricao.tipoDeAgente ?? "desconhecido");
      chamadaDoAgente.set(agenteId, transcricao.chamadaId ?? null);
    }
    for (const linha of transcricao.linhas) {
      if (!ehObjeto(linha) || texto(linha, "type") !== "assistant") {
        continue;
      }
      const lateral = linha["isSidechain"] === true;
      const papel: PapelDaTranscricao = compactacao
        ? "principal"
        : transcricao.papel === "subagente" || lateral
          ? "subagente"
          : "principal";
      if (transcricao.papel === "principal" && lateral && !temArquivosDeSubagente) {
        const agenteId = texto(linha, "agentId") || "lateral";
        if (!agentes.has(agenteId)) {
          agentes.set(agenteId, "desconhecido");
        }
      }

      const mensagem = objeto(linha, "message");
      for (const bloco of objetos(mensagem, "content")) {
        if (texto(bloco, "type") === "tool_use") {
          chamadas.set(texto(bloco, "id") || `sem-id-${semId++}`, texto(bloco, "name") || "desconhecida");
        }
      }

      const modelo = texto(mensagem, "model") || "desconhecido";
      if (modelo === MODELO_SINTETICO) {
        continue;
      }
      const uso = usoDaMensagem(objeto(mensagem, "usage"));
      const id = texto(mensagem, "id") || `sem-id-${semId++}`;
      const anterior = mensagens.get(id);
      mensagens.set(
        id,
        anterior === undefined
          ? { papel, doPrincipal: transcricao.papel === "principal" && !lateral, modelo, uso }
          : { ...anterior, uso: maiorUso(anterior.uso, uso) },
      );
    }
  });

  let principal = usoVazio();
  let subagentes = usoVazio();
  const porModelo: Record<string, DadosDoUso> = {};
  const saidaDoPrincipalPorModelo = new Map<string, number>();
  for (const { papel, doPrincipal, modelo, uso } of mensagens.values()) {
    if (papel === "principal") {
      principal = somarUso(principal, uso);
    } else {
      subagentes = somarUso(subagentes, uso);
    }
    porModelo[modelo] = somarUso(porModelo[modelo] ?? usoVazio(), uso);
    if (doPrincipal && modelo !== "desconhecido") {
      saidaDoPrincipalPorModelo.set(modelo, (saidaDoPrincipalPorModelo.get(modelo) ?? 0) + uso.saida);
    }
  }

  let modeloDoPrincipal: string | null = null;
  let maiorSaida = -1;
  for (const [modelo, saida] of saidaDoPrincipalPorModelo) {
    if (saida > maiorSaida) {
      modeloDoPrincipal = modelo;
      maiorSaida = saida;
    }
  }

  const ferramentas: Record<string, number> = {};
  for (const nome of chamadas.values()) {
    incrementar(ferramentas, nome);
  }
  const subagentesPorTipo: Record<string, number> = {};
  for (const tipo of agentes.values()) {
    incrementar(subagentesPorTipo, tipo);
  }

  // Associação subagente ↔ chamada `Agent` pelo `toolUseId` do meta.json.
  const chamadasDeSubagente = [...chamadas].filter(([, nome]) => FERRAMENTAS_DE_SUBAGENTE.has(nome)).map(([id]) => id);
  const idsDasChamadas = new Set(chamadasDeSubagente);
  const subagentesSemChamada = temArquivosDeSubagente
    ? [...chamadaDoAgente].filter(([, chamada]) => chamada === null || !idsDasChamadas.has(chamada)).map(([agente]) => agente)
    : [];
  const chamadasAssociadas = new Set(
    [...chamadaDoAgente.values()].filter((chamada): chamada is string => chamada !== null),
  );
  const chamadasSemSubagente =
    temArquivosDeSubagente || agentes.size === 0 ? chamadasDeSubagente.filter((id) => !chamadasAssociadas.has(id)) : [];

  return {
    total: somarUso(principal, subagentes),
    principal,
    subagentes,
    porModelo,
    ferramentas,
    subagentesLancados: agentes.size,
    subagentesPorTipo,
    subagentesSemChamada,
    chamadasSemSubagente,
    mensagens: mensagens.size,
    modeloDoPrincipal,
  };
}
