import { extrairEnderecosLocais } from "../../orquestracao/EnderecoLocal";
import {
  EventoDoMotor,
  JanelaDaCota,
  SituacaoDaTarefa,
  SituacaoFinalDoSubagente,
  TarefaDoOrquestrador,
  UsoDoTurno,
} from "../../orquestracao/EventoDeOrquestracao";
import { NOME_DO_SUBAGENTE } from "../../orquestracao/InstrucoesDoOrquestrador";
import { CausaDaFalha, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";

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

/**
 * Ferramentas com que o Orquestrador lança Subagentes: viram eventos de
 * Subagente. As demais (ler, buscar, rodar um comando curto) também são
 * atividade normal dele — o trivial que ele faz sem delegar — e viram
 * `ferramenta_do_orquestrador`.
 */
const FERRAMENTAS_DE_SUBAGENTE = new Set(["Agent", "Task"]);

/**
 * Ferramentas que leem ou escrevem arquivos e páginas: um endereço local no
 * retorno delas é só texto citado (um README, um vite.config), não um
 * servidor que acabou de subir. Não anunciam endereço.
 */
const FERRAMENTAS_SEM_SERVIDOR = new Set([
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
]);

/**
 * Arquivo onde o Claude Code guarda a saída de um comando em segundo plano
 * (`.../tasks/<id>.output`). Ler este arquivo é ler a saída do comando.
 */
const SAIDA_DE_COMANDO = /[\\/]tasks[\\/][^\\/]+\.output$/;

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

/** Resumo curto da entrada de uma ferramenta (o comando, o caminho, a URL…), para a tela. */
export function resumirEntrada(entrada: Objeto): string {
  for (const campo of ["command", "file_path", "path", "pattern", "url", "query"]) {
    const valor = texto(entrada, campo);
    if (valor !== "") {
      return valor.slice(0, TAMANHO_DO_DETALHE);
    }
  }
  return JSON.stringify(entrada).slice(0, TAMANHO_DO_DETALHE);
}

/** Ferramenta dos workflows dinâmicos do esforço `ultracode`. */
const FERRAMENTA_DE_WORKFLOW = "Workflow";

/** O `name` do `export const meta = { name: '...' }` no início do script de um workflow. */
const NOME_NO_META = /\bmeta\s*=\s*\{[\s\S]*?\bname\s*:\s*(["'`])([^"'`\r\n]+)\1/;

/**
 * Nome legível de uma chamada do `Workflow` (a entrada é `{ script }`, um
 * programa inteiro): o `name` do `meta` do script ou, sem ele, a descrição.
 */
export function nomeDoWorkflow(entrada: Objeto): string {
  const nome = NOME_NO_META.exec(texto(entrada, "script"))?.[2]?.trim() ?? "";
  if (nome !== "") {
    return nome.slice(0, TAMANHO_DO_DETALHE);
  }
  const descricao = texto(entrada, "description").trim();
  return descricao === "" ? "workflow sem nome" : descricao.slice(0, TAMANHO_DO_DETALHE);
}

/** Resumo da entrada de uma chamada, para a tela: o `Workflow` mostra só o nome, não o script. */
export function detalheDaChamada(ferramenta: string, entrada: Objeto): string {
  return ferramenta === FERRAMENTA_DE_WORKFLOW ? nomeDoWorkflow(entrada) : resumirEntrada(entrada);
}

/** Ferramenta com que o Claude Code mantém a lista de tarefas do trabalho. */
const FERRAMENTA_DE_TAREFAS = "TodoWrite";

const SITUACOES_DAS_TAREFAS: Readonly<Record<string, SituacaoDaTarefa>> = {
  pending: "pendente",
  in_progress: "em_andamento",
  completed: "concluida",
};

/**
 * A lista de uma chamada do `TodoWrite` (`{ todos: [{ content, status,
 * activeForm }] }`). A tarefa em andamento usa o `activeForm` ("Rodando os
 * testes"), se houver; as demais, o `content`. Nula se a lista vier vazia ou
 * com algum item sem texto ou com situação desconhecida.
 */
export function tarefasDoTodoWrite(entrada: Objeto): TarefaDoOrquestrador[] | null {
  const todos = entrada["todos"];
  if (!Array.isArray(todos) || todos.length === 0) {
    return null;
  }
  const tarefas: TarefaDoOrquestrador[] = [];
  for (const item of todos) {
    if (!ehObjeto(item)) {
      return null;
    }
    const situacao = SITUACOES_DAS_TAREFAS[texto(item, "status")];
    const conteudo = texto(item, "content").trim();
    if (situacao === undefined || conteudo === "") {
      return null;
    }
    const emAndamento = situacao === "em_andamento" ? texto(item, "activeForm").trim() : "";
    tarefas.push({ texto: (emAndamento || conteudo).slice(0, TAMANHO_DO_DETALHE), situacao });
  }
  return tarefas;
}

/** Papel com que um workflow aparece entre os Subagentes. */
const PAPEL_DO_WORKFLOW = "workflow";

/** Um `task_started` de workflow (`task_type: local_workflow`, com `workflow_name`). */
function ehWorkflow(mensagem: Objeto): boolean {
  return texto(mensagem, "task_type") === "local_workflow" || texto(mensagem, "workflow_name") !== "";
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

/** As janelas de cota da assinatura de um `rate_limit_event`; vazio se não vierem. */
export function janelasDaCota(mensagem: Objeto): JanelaDaCota[] {
  return Object.entries(objeto(objeto(mensagem, "rate_limit_info"), "unifiedWindows"))
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
}

/** Motivo de um `result` com erro: o texto do Claude Code ou, sem texto, a explicação do subtipo. */
export function descreverFalha(mensagem: Objeto, resposta: string): string {
  if (resposta.trim() !== "") {
    return resposta;
  }
  const subtipo = texto(mensagem, "subtype");
  return MOTIVOS_POR_SUBTIPO[subtipo] ?? `O Claude Code terminou com erro (${subtipo || "sem detalhes"}).`;
}

/**
 * Textos do limite de uso da assinatura, como o Claude Code os escreve:
 * "Claude AI usage limit reached|<epoch>", "You've hit your session limit",
 * "out of extra usage"… Também usado pelo chat.
 */
export const SINAIS_DE_LIMITE_DE_USO =
  /usage limit|rate limit|limit reached|out of extra usage|hit your (?:[\w'’]+ )*limit|request rejected \(429\)/i;

/** Servidores da Anthropic sobrecarregados ou com erro interno (5xx, 529 `overloaded_error`, `api_error`). */
const SINAIS_DE_SOBRECARGA =
  /overloaded|\b529\b|\b(?:api error|error|status(?: code)?|http(?:\/[\d.]+)?)\W{0,3}50[0234]\b|api_error|internal server error|bad gateway|service unavailable|gateway timeout|high load|temporarily limiting requests|no response from api|server error mid-response/i;

/** A conexão com os servidores caiu ou nem se estabeleceu. */
const SINAIS_DE_REDE =
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|socket hang up|network|connection error|request timed out|unable to connect|connection (?:lost|dropped|refused)|can't reach the api|socket is closed|stream idle timeout|no internet route/i;

/** "Claude AI usage limit reached|1793221200": quando o limite libera, em segundos (ou milissegundos) desde 1970. */
const LIMITE_COM_EPOCH = /limit reached\|(\d{9,13})/i;

/** De um epoch em segundos (ou milissegundos, com 13 dígitos) para ISO; nulo se não fizer sentido. */
function epochEmIso(epoch: number): string | null {
  if (!Number.isFinite(epoch) || epoch <= 0) {
    return null;
  }
  const data = new Date(epoch >= 1e12 ? epoch : epoch * 1000);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/** Uma causa de falha já classificada e, no limite de uso, quando ele libera. */
export interface FalhaClassificada {
  causa: CausaDaFalha;
  liberaEm: string | null;
}

/**
 * O que o processo deixou escapar sobre a falha antes do texto final: um
 * `rate_limit_event` recusado (`forte`, vale sobre o texto) ou o tipo de erro
 * de uma mensagem do assistente ou de uma nova tentativa (`fraca`, só quando
 * o texto não diz nada).
 */
export interface PistasDaFalha {
  forte: FalhaClassificada | null;
  fraca: FalhaClassificada | null;
}

const SEM_PISTAS: PistasDaFalha = { forte: null, fraca: null };

/** Classifica uma falha pelos textos (o `result`, o stderr…) e pelas pistas do processo. */
export function classificarFalha(textos: readonly string[], pistas: PistasDaFalha = SEM_PISTAS): FalhaClassificada {
  const junto = textos.join("\n");
  if (pistas.forte !== null) {
    return pistas.forte;
  }
  if (SINAIS_DE_LIMITE_DE_USO.test(junto)) {
    const epoch = LIMITE_COM_EPOCH.exec(junto)?.[1];
    const liberaEm = epoch === undefined ? null : epochEmIso(Number(epoch));
    return { causa: "limite_de_uso", liberaEm: liberaEm ?? pistas.fraca?.liberaEm ?? null };
  }
  if (SINAIS_DE_SOBRECARGA.test(junto)) {
    return { causa: "sobrecarga", liberaEm: null };
  }
  if (SINAIS_DE_REDE.test(junto)) {
    return { causa: "rede", liberaEm: null };
  }
  return pistas.fraca ?? { causa: "outro", liberaEm: null };
}

const TAMANHO_DO_DETALHE_DA_FALHA = 300;

/** O texto original da falha, numa linha só, sem o epoch e cortado. */
function resumirDetalhe(original: string): string {
  const limpo = original
    .replace(/(limit reached)\|\d{9,13}/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return limpo.length <= TAMANHO_DO_DETALHE_DA_FALHA ? limpo : `${limpo.slice(0, TAMANHO_DO_DETALHE_DA_FALHA - 1)}…`;
}

const FRASES_DAS_CAUSAS: Readonly<Record<Exclude<CausaDaFalha, "outro" | "silencio">, string>> = {
  limite_de_uso: "Limite de uso da assinatura do Claude atingido",
  sobrecarga: "Os servidores do Claude estão sobrecarregados ou com erro",
  rede: "Falha de conexão com os servidores do Claude",
};

/**
 * Resultado de falha com causa: nas causas conhecidas, o motivo vira uma
 * frase em português com o detalhe original resumido; em "outro", fica o
 * motivo de sempre. `liberaEm` só vai no limite de uso.
 */
export function falhaComCausa(
  motivoBase: string,
  textos: readonly string[],
  pistas: PistasDaFalha,
  uso: UsoDoTurno | null,
): Extract<ResultadoDoTurno, { sucesso: false }> {
  const { causa, liberaEm } = classificarFalha(textos, pistas);
  if (causa === "outro" || causa === "silencio") {
    return { sucesso: false, motivo: motivoBase, uso, causa };
  }
  const detalhe = resumirDetalhe(textos.find((parte) => parte.trim() !== "") ?? motivoBase);
  const motivo = detalhe === "" ? `${FRASES_DAS_CAUSAS[causa]}.` : `${FRASES_DAS_CAUSAS[causa]} (${detalhe}).`;
  return causa === "limite_de_uso"
    ? { sucesso: false, motivo, uso, causa, liberaEm }
    : { sucesso: false, motivo, uso, causa };
}

/** Pista pelo tipo de erro (`error` de uma mensagem do assistente ou de um `api_retry`). */
function pistaPeloTipoDeErro(tipo: string, status: number | null): FalhaClassificada | null {
  if (tipo === "rate_limit" || status === 429) {
    return { causa: "limite_de_uso", liberaEm: null };
  }
  if (tipo === "server_error" || (status !== null && status >= 500)) {
    return { causa: "sobrecarga", liberaEm: null };
  }
  return null;
}

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
  private readonly enderecosAnunciados = new Set<string>();
  /** Nome da ferramenta de cada chamada (`tool_use_id`), do Orquestrador e dos Subagentes. */
  private readonly ferramentaPorChamada = new Map<string, string>();
  /**
   * Endereços locais citados num comando, na saída dele ou na fala de um
   * agente: ainda não se sabe se há um servidor neles. O motor confere cada um
   * (`retirarCandidatos`) e anuncia os que respondem (`confirmarEndereco`).
   */
  private readonly candidatos = new Set<string>();
  /** O que o processo já contou sobre uma falha antes do `result` (ou sem ele). */
  private pistas: PistasDaFalha = { forte: null, fraca: null };

  /** Preenchido quando chega a mensagem final (`result`); nulo se o processo parou antes. */
  get resultado(): ResultadoDoTurno | null {
    return this.resultadoDoTurno;
  }

  /** Pistas da falha vistas até aqui, para classificar um processo que parou sem `result`. */
  get pistasDaFalha(): PistasDaFalha {
    return this.pistas;
  }

  /** Os endereços citados desde a última retirada que ainda não foram anunciados. */
  retirarCandidatos(): string[] {
    const novos = [...this.candidatos].filter((url) => !this.enderecosAnunciados.has(url));
    this.candidatos.clear();
    return novos;
  }

  /** Um endereço citado que respondeu: vira o anúncio, uma vez por turno. */
  confirmarEndereco(url: string): EventoDoMotor[] {
    if (this.enderecosAnunciados.has(url)) {
      return [];
    }
    this.enderecosAnunciados.add(url);
    return [{ tipo: "endereco_local_detectado", url }];
  }

  private citarEnderecos(texto: string): void {
    for (const url of extrairEnderecosLocais(texto)) {
      this.candidatos.add(url);
    }
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
      case "api_retry": {
        // Nova tentativa depois de um erro da API: guarda o tipo como pista.
        const status = mensagem["error_status"];
        const pista = pistaPeloTipoDeErro(texto(mensagem, "error"), typeof status === "number" ? status : null);
        if (pista !== null) {
          this.pistas = { ...this.pistas, fraca: pista };
        }
        return [];
      }
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
        // Um workflow do `ultracode` aparece como um Subagente: o progresso
        // dele (`task_progress`, ex.: "Revisar: revisor:fuzz") e o fim
        // (`task_notification`) seguem o mesmo caminho. A tarefa é a
        // descrição, não o script inteiro que vem em `prompt`.
        if (ehWorkflow(mensagem)) {
          const descricao = texto(mensagem, "description");
          return [
            {
              tipo: "subagente_iniciado",
              subagenteId,
              descricao: `Workflow: ${texto(mensagem, "workflow_name") || descricao || "sem nome"}`,
              tarefa: descricao,
              papel: PAPEL_DO_WORKFLOW,
            },
          ];
        }
        return [
          {
            tipo: "subagente_iniciado",
            subagenteId,
            descricao: texto(mensagem, "description"),
            tarefa: texto(mensagem, "prompt"),
            papel: texto(mensagem, "subagent_type") || NOME_DO_SUBAGENTE,
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
        // `task_updated` e `background_tasks_changed` (tarefas em segundo
        // plano, como os workflows do `ultracode`) repetem o que os outros
        // `task_*` já contam: descartados, como os demais subtipos.
        return [];
    }
  }

  private traduzirAssistente(mensagem: Objeto): EventoDoMotor[] {
    const pista = pistaPeloTipoDeErro(texto(mensagem, "error"), null);
    if (pista !== null) {
      this.pistas = { ...this.pistas, fraca: pista };
    }
    const blocos = objetos(objeto(mensagem, "message"), "content");
    const chamadaDeOrigem = mensagem["parent_tool_use_id"];
    for (const bloco of blocos) {
      if (texto(bloco, "type") === "tool_use") {
        const nome = texto(bloco, "name");
        const lendoSaida = nome === "Read" && SAIDA_DE_COMANDO.test(texto(objeto(bloco, "input"), "file_path"));
        // A leitura da saída de um comando conta como o próprio comando.
        this.ferramentaPorChamada.set(texto(bloco, "id"), lendoSaida ? "Bash" : nome);
        // `open http://127.0.0.1:4173`, `curl localhost:3000`: o comando cita o servidor.
        if (nome === "Bash") {
          this.citarEnderecos(texto(objeto(bloco, "input"), "command"));
        }
      }
      if (texto(bloco, "type") === "text") {
        this.citarEnderecos(texto(bloco, "text"));
      }
    }

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
      // A lista de tarefas do Orquestrador vira progresso na tela, não uma
      // linha "usando TodoWrite". Malformada, segue como ferramenta comum.
      const tarefas =
        tipo === "tool_use" && texto(bloco, "name") === FERRAMENTA_DE_TAREFAS
          ? tarefasDoTodoWrite(objeto(bloco, "input"))
          : null;
      if (tarefas !== null) {
        eventos.push({ tipo: "tarefas_atualizadas", tarefas });
        continue;
      }
      if (tipo === "tool_use" && !FERRAMENTAS_DE_SUBAGENTE.has(texto(bloco, "name"))) {
        eventos.push({
          tipo: "ferramenta_do_orquestrador",
          ferramenta: texto(bloco, "name"),
          detalhe: detalheDaChamada(texto(bloco, "name"), objeto(bloco, "input")),
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
   *
   * O retorno de qualquer ferramenta também pode citar um endereço local.
   */
  private traduzirRetorno(mensagem: Objeto): EventoDoMotor[] {
    this.detectarEnderecosLocais(mensagem);
    const eventos: EventoDoMotor[] = [];
    const estruturado = objeto(mensagem, "tool_use_result");
    if (mensagem["parent_tool_use_id"] !== null || texto(estruturado, "status") !== "completed") {
      return eventos;
    }

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
        this.citarEnderecos(resultado);
        eventos.push({ tipo: "resultado_do_subagente", subagenteId, resultado });
      }
    }
    return eventos;
  }

  /**
   * Procura endereços locais no retorno das ferramentas do Orquestrador e
   * dos Subagentes (ex.: o `npm run dev` que subiu um servidor), menos as de
   * ler e escrever arquivos. Cada endereço vira candidato: uma saída pode só
   * citar um valor de configuração, então o motor confere se há servidor nele
   * antes de anunciar.
   */
  private detectarEnderecosLocais(mensagem: Objeto): void {
    const textos: string[] = [];
    for (const bloco of objetos(objeto(mensagem, "message"), "content")) {
      if (texto(bloco, "type") !== "tool_result") {
        continue;
      }
      const ferramenta = this.ferramentaPorChamada.get(texto(bloco, "tool_use_id"));
      if (ferramenta !== undefined && FERRAMENTAS_SEM_SERVIDOR.has(ferramenta)) {
        continue;
      }
      const conteudo = bloco["content"];
      if (typeof conteudo === "string") {
        textos.push(conteudo);
      } else {
        textos.push(...objetos(bloco, "content").map((parte) => texto(parte, "text")));
      }
    }
    // stdout e stderr estruturados só existem no retorno de comandos (Bash).
    const estruturado = objeto(mensagem, "tool_use_result");
    textos.push(texto(estruturado, "stdout"), texto(estruturado, "stderr"));

    this.citarEnderecos(textos.join("\n"));
  }

  private traduzirCota(mensagem: Objeto): EventoDoMotor[] {
    // Recusado: a assinatura bateu no limite. `resetsAt` (segundos) diz quando libera.
    const info = objeto(mensagem, "rate_limit_info");
    if (texto(info, "status") === "rejected") {
      const liberaEm = epochEmIso(numero(info, "resetsAt"));
      this.pistas = { ...this.pistas, forte: { causa: "limite_de_uso", liberaEm } };
    }
    const janelas = janelasDaCota(mensagem);
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
    this.citarEnderecos(resposta);
    const sucesso = texto(mensagem, "subtype") === "success" && mensagem["is_error"] !== true;

    this.resultadoDoTurno = sucesso
      ? { sucesso: true, resposta, uso }
      : falhaComCausa(descreverFalha(mensagem, resposta), [resposta], this.pistas, uso);

    return objetos(mensagem, "permission_denials").map((negacao) => ({
      tipo: "permissao_negada",
      ferramenta: texto(negacao, "tool_name"),
      detalhe: detalheDaChamada(texto(negacao, "tool_name"), objeto(negacao, "tool_input")),
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
}
