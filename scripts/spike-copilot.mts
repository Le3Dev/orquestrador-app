/**
 * Spike do motor GitHub Copilot (Fase 0 do plano de vários motores, ADR-43).
 *
 * Roda os cenários do plano contra o SDK REAL (`@github/copilot-sdk`) e com o
 * login do Copilot do usuário, mede os tempos e grava os eventos capturados
 * como fixtures em `src/infraestrutura/copilot/fixtures/` (já sem nome de
 * usuário, e-mail, token nem caminhos da máquina).
 *
 *   npx tsx scripts/spike-copilot.mts                 # todos os cenários
 *   npx tsx scripts/spike-copilot.mts --cenarios=1,2  # só alguns
 *   npx tsx scripts/spike-copilot.mts --listar        # só login e modelos (não gasta crédito)
 *
 * Pré-requisitos: estar logado no GitHub Copilot (`copilot login` no Copilot CLI
 * ou o `gh auth login` com acesso ao Copilot) ou ter `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`
 * no ambiente. Cada turno gasta AI Credits da conta: o script usa o modelo mais
 * barato do catálogo, esforço baixo e prompts mínimos (cerca de 12 turnos cobrados no total; os
 * cenários de erro não gastam nada).
 * Tudo roda numa pasta temporária; o repositório nunca é o `workingDirectory`.
 *
 * Variáveis opcionais: `SPIKE_MODELO` (força o modelo) e `SPIKE_SAIDA` (onde gravar o JSON com as medições).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, homedir, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  EventoDaSessaoCopilot,
  FachadaCopilotSdk,
  ModeloDoCopilot,
  SessaoDoCopilot,
  ConfiguracaoDaSessaoCopilot,
} from "../src/infraestrutura/copilot/FachadaCopilotSdk.ts";
import {
  ContextoDePermissoesDoCopilot,
  decidirPermissaoDoCopilot,
  ferramentasDoCopilotParaONivel,
  PedidoDePermissaoDoCopilot,
} from "../src/infraestrutura/copilot/PoliticaDePermissoesDoCopilot.ts";
import { MotorCopilotSdk } from "../src/infraestrutura/copilot/MotorCopilotSdk.ts";
import { ProcessoNaArvore } from "../src/infraestrutura/sistema/ArvoreDeProcessos.ts";
import { listarArvore } from "../src/infraestrutura/sistema/Processos.ts";
import { ConfiguracaoDoOrquestrador } from "../src/orquestracao/ConfiguracaoDoOrquestrador.ts";
import { PedidoDeTurno } from "../src/orquestracao/MotorDeAgentes.ts";
import { PastaDeTrabalho } from "../src/orquestracao/PastaDeTrabalho.ts";

// ---------------------------------------------------------------------------
// Argumentos e pastas
// ---------------------------------------------------------------------------

const argumentos = process.argv.slice(2);
const escolhidos = argumentos
  .find((argumento) => argumento.startsWith("--cenarios="))
  ?.slice("--cenarios=".length)
  .split(",")
  .map(Number);
const somenteListar = argumentos.includes("--listar");

const PASTA_DAS_FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/infraestrutura/copilot/fixtures");
// O caminho REAL: o runtime compara os caminhos dos pedidos de permissão com as pastas da sessão, e o
// `TEMP` do Windows costuma vir no nome curto 8.3 (`C:\Users\NOME~1.SOB\…`), que nunca casa com o longo.
const RAIZ = path.join(realpathSync.native(tmpdir()), "spike-copilot");
const PASTA_DO_RUNTIME = path.join(RAIZ, "runtime");
const PASTA_DE_TRABALHO = path.join(RAIZ, "trabalho");
const PASTA_DE_ARTEFATOS = path.join(RAIZ, "artefatos");
const ARQUIVO_DE_SAIDA = process.env["SPIKE_SAIDA"] ?? path.join(tmpdir(), "spike-copilot-resultado.json");

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

type Situacao = "ok" | "falhou" | "nao_validado";

interface ResultadoDoCenario {
  numero: number;
  nome: string;
  situacao: Situacao;
  evidencias: string[];
  medidas: Record<string, number | string | boolean | null>;
  erro?: string;
}

const resultados: ResultadoDoCenario[] = [];
let modeloEscolhido = "";
let esforcoEscolhido: string | undefined;

function ms(valor: number): number {
  return Math.round(valor);
}

// ---------------------------------------------------------------------------
// Sanitização das fixtures (nada de usuário, e-mail, token ou caminho da máquina)
// ---------------------------------------------------------------------------

const substituicoes: Array<[RegExp, string]> = [];

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function registrarSubstituicao(original: string, troca: string): void {
  if (original.trim().length >= 3) {
    substituicoes.push([new RegExp(escaparRegex(original), "gi"), troca]);
  }
}

function prepararSanitizacao(login: string | undefined): void {
  const casa = homedir();
  const usuario = userInfo().username;
  // Os caminhos mais longos primeiro: o do usuário só depois dos que o contêm.
  registrarSubstituicao(RAIZ.replace(/\\/g, "/"), "C:/Users/usuario/AppData/Local/Temp/spike-copilot");
  registrarSubstituicao(RAIZ, "C:\\Users\\usuario\\AppData\\Local\\Temp\\spike-copilot");
  registrarSubstituicao(casa.replace(/\\/g, "/"), "C:/Users/usuario");
  registrarSubstituicao(casa, "C:\\Users\\usuario");
  registrarSubstituicao(casa.replace(/\\/g, "\\\\"), "C:\\\\Users\\\\usuario");
  registrarSubstituicao(usuario, "usuario");
  // O nome curto 8.3 do Windows (ex.: `NOME~1.SOB`) que o TEMP costuma trazer.
  for (const variavel of ["TEMP", "TMP"]) {
    const valor = process.env[variavel];
    const curto = valor === undefined ? undefined : /Users[\\/]([^\\/]+)/i.exec(valor)?.[1];
    if (curto !== undefined) {
      registrarSubstituicao(curto, "usuario");
    }
  }
  if (login !== undefined && login !== "") {
    registrarSubstituicao(login, "usuario-github");
  }
  registrarSubstituicao(hostname(), "maquina");
  substituicoes.push([/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "usuario@exemplo.com"]);
  substituicoes.push([/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "<token>"]);
  substituicoes.push([/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g, "Bearer <token>"]);
}

const CHAVES_OPACAS = new Set(["reasoningOpaque", "encryptedContent", "encryptedReasoning", "signature"]);
const TAMANHO_MAXIMO_DE_TEXTO = 1500;

function sanitizarTexto(texto: string): string {
  let saida = texto;
  for (const [padrao, troca] of substituicoes) {
    saida = saida.replace(padrao, troca);
  }
  return saida.length > TAMANHO_MAXIMO_DE_TEXTO ? `${saida.slice(0, TAMANHO_MAXIMO_DE_TEXTO)}…[truncado]` : saida;
}

function sanitizarValor(valor: unknown): unknown {
  if (typeof valor === "string") {
    return sanitizarTexto(valor);
  }
  if (Array.isArray(valor)) {
    return valor.map(sanitizarValor);
  }
  if (typeof valor === "object" && valor !== null) {
    const saida: Record<string, unknown> = {};
    for (const [chave, conteudo] of Object.entries(valor)) {
      if (CHAVES_OPACAS.has(chave)) {
        continue;
      }
      saida[chave] = sanitizarValor(conteudo);
    }
    return saida;
  }
  return valor;
}

/** Tipos de evento que valem como fixture: o que o adaptador traduz e o que o diagnostica. */
const PREFIXOS_DAS_FIXTURES = [
  "assistant.",
  "tool.",
  "subagent.",
  "permission.",
  "session.error",
  "session.idle",
  "session.warning",
  "session.info",
  "session.quota_observation",
  "session.usage_info",
  "abort",
  "user.message",
];

/**
 * Ficam de fora: `assistant.tool_call_delta` (pedaços do argumento da ferramenta, com os caminhos
 * cortados no meio — a troca de nomes não os pega), `assistant.streaming_delta` (só um contador de
 * bytes, centenas por turno) e os eventos de fusão do runtime.
 */
const TIPOS_EXCLUIDOS_DAS_FIXTURES = new Set(["assistant.tool_call_delta", "assistant.streaming_delta"]);

/** Dos deltas de raciocínio de cada bloco, só os primeiros: o suficiente para provar o sinal de vida. */
const DELTAS_DE_RACIOCINIO_POR_BLOCO = 3;

/** Uma única leitura da janela de contexto por fixture. */
function amostrar(eventos: readonly EventoDaSessaoCopilot[]): EventoDaSessaoCopilot[] {
  const deltasPorBloco = new Map<string, number>();
  let leituraDeContexto = false;
  return eventos.filter((evento) => {
    if (evento.type === "assistant.reasoning_delta") {
      const bloco = `${evento.agentId ?? ""}/${String(dadosComo(evento)["reasoningId"])}`;
      const vistos = (deltasPorBloco.get(bloco) ?? 0) + 1;
      deltasPorBloco.set(bloco, vistos);
      return vistos <= DELTAS_DE_RACIOCINIO_POR_BLOCO;
    }
    if (evento.type === "session.usage_info") {
      const jaTinha = leituraDeContexto;
      leituraDeContexto = true;
      return !jaTinha;
    }
    return true;
  });
}

function gravarFixture(nome: string, eventos: readonly EventoDaSessaoCopilot[]): number {
  mkdirSync(PASTA_DAS_FIXTURES, { recursive: true });
  const linhas = amostrar(
    eventos.filter(
      (evento) =>
        !TIPOS_EXCLUIDOS_DAS_FIXTURES.has(evento.type) &&
        !evento.type.startsWith("assistant.fusion_") &&
        PREFIXOS_DAS_FIXTURES.some((prefixo) => evento.type.startsWith(prefixo)),
    ),
  ).map((evento) => JSON.stringify(sanitizarValor(evento)));
  writeFileSync(path.join(PASTA_DAS_FIXTURES, `${nome}.jsonl`), `${linhas.join("\n")}\n`, "utf8");
  return linhas.length;
}

// ---------------------------------------------------------------------------
// Processos
// ---------------------------------------------------------------------------

function descendentes(raiz: number, arvore: readonly ProcessoNaArvore[]): ProcessoNaArvore[] {
  const achados: ProcessoNaArvore[] = [];
  const fila = [raiz];
  while (fila.length > 0) {
    const pai = fila.shift();
    for (const processo of arvore) {
      if (processo.ppid === pai && processo.pid !== raiz && !achados.some((achado) => achado.pid === processo.pid)) {
        achados.push(processo);
        fila.push(processo.pid);
      }
    }
  }
  return achados;
}

function resumirProcessos(lista: readonly ProcessoNaArvore[]): string[] {
  return lista.map((processo) => `${processo.nome}#${processo.pid}`);
}

async function procurarMarca(marca: string): Promise<ProcessoNaArvore[]> {
  const arvore = await listarArvore();
  return arvore.filter((processo) => processo.comando.includes(marca) && !/Get-CimInstance/i.test(processo.comando));
}

function matarArvore(pid: number): Promise<void> {
  return new Promise((resolver) => {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolver());
  });
}

function dormir(duracaoMs: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, duracaoMs));
}

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------

interface TurnoMedido {
  eventos: EventoDaSessaoCopilot[];
  /** Instante (ms desde o envio) do primeiro `assistant.message_delta`; nulo se não houve. */
  primeiroDeltaMs: number | null;
  duracaoMs: number;
  idleAbortado: boolean;
  erros: string[];
  resposta: string;
  tokensDeEntrada: number;
  tokensDeSaida: number;
  chamadasDoModelo: number;
}

interface OpcoesDoTurno {
  prazoMs?: number;
  /** Chamado a cada evento (instante em ms desde o envio). */
  aoEvento?: (evento: EventoDaSessaoCopilot, instanteMs: number) => void;
}

function dadosComo(evento: EventoDaSessaoCopilot): Record<string, unknown> {
  return typeof evento.data === "object" && evento.data !== null ? (evento.data as Record<string, unknown>) : {};
}

function numeroDe(valor: unknown): number {
  return typeof valor === "number" ? valor : 0;
}

/** Envia o pedido e espera o `session.idle` do agente principal. */
async function executarTurno(sessao: SessaoDoCopilot, prompt: string, opcoes: OpcoesDoTurno = {}): Promise<TurnoMedido> {
  const inicio = performance.now();
  const eventos: EventoDaSessaoCopilot[] = [];
  let primeiroDeltaMs: number | null = null;
  let idleAbortado = false;
  const erros: string[] = [];
  let resposta = "";
  let tokensDeEntrada = 0;
  let tokensDeSaida = 0;
  let chamadasDoModelo = 0;

  let terminou: () => void = () => undefined;
  const fim = new Promise<void>((resolver) => {
    terminou = resolver;
  });
  const cancelar = sessao.aoEvento((evento) => {
    const instante = performance.now() - inicio;
    eventos.push(evento);
    opcoes.aoEvento?.(evento, instante);
    const dados = dadosComo(evento);
    if (evento.type === "assistant.message_delta" && evento.agentId === undefined && primeiroDeltaMs === null) {
      primeiroDeltaMs = instante;
    }
    if (evento.type === "assistant.message" && evento.agentId === undefined && typeof dados["content"] === "string") {
      resposta = dados["content"];
    }
    if (evento.type === "assistant.usage") {
      chamadasDoModelo += 1;
      tokensDeEntrada += numeroDe(dados["inputTokens"]);
      tokensDeSaida += numeroDe(dados["outputTokens"]);
    }
    if (evento.type === "session.error") {
      erros.push(`${String(dados["errorType"])}: ${String(dados["message"])}`);
    }
    if (evento.type === "session.idle" && evento.agentId === undefined) {
      idleAbortado = dados["aborted"] === true;
      terminou();
    }
  });

  const prazoMs = opcoes.prazoMs ?? 150_000;
  let expirou = false;
  const relogio = setTimeout(() => {
    expirou = true;
    terminou();
  }, prazoMs);
  try {
    await sessao.enviar(prompt);
    await fim;
  } finally {
    clearTimeout(relogio);
    cancelar();
  }
  if (expirou) {
    await sessao.abortar().catch(() => undefined);
    erros.push(`prazo de ${prazoMs} ms esgotado sem session.idle`);
  }
  return {
    eventos,
    primeiroDeltaMs,
    duracaoMs: performance.now() - inicio,
    idleAbortado,
    erros,
    resposta,
    tokensDeEntrada,
    tokensDeSaida,
    chamadasDoModelo,
  };
}

function medidasDoTurno(turno: TurnoMedido): Record<string, number | string | boolean | null> {
  return {
    primeiroDeltaMs: turno.primeiroDeltaMs === null ? null : ms(turno.primeiroDeltaMs),
    duracaoDoTurnoMs: ms(turno.duracaoMs),
    tokensDeEntrada: turno.tokensDeEntrada,
    tokensDeSaida: turno.tokensDeSaida,
    chamadasDoModelo: turno.chamadasDoModelo,
  };
}

function contar(eventos: readonly EventoDaSessaoCopilot[], tipo: string): number {
  return eventos.filter((evento) => evento.type === tipo).length;
}

function ferramentasUsadas(eventos: readonly EventoDaSessaoCopilot[]): string[] {
  return eventos
    .filter((evento) => evento.type === "tool.execution_start")
    .map((evento) => `${String(dadosComo(evento)["toolName"])}${evento.agentId === undefined ? "" : "@sub"}`);
}

// ---------------------------------------------------------------------------
// Sessões, política e preparo do ambiente
// ---------------------------------------------------------------------------

interface PedidosVistos {
  lista: Array<{
    pedido: PedidoDePermissaoDoCopilot;
    aprovada: boolean;
    motivo: string | null;
    /** O caminho do pedido veio no nome curto 8.3 do Windows (`~1`)? Diagnóstico das pastas reais. */
    caminhoCurto: boolean;
  }>;
}

function novaFachada(aoNascer?: (pid: number) => void): FachadaCopilotSdk {
  return new FachadaCopilotSdk({
    pastaDoRuntime: PASTA_DO_RUNTIME,
    nivelDeLog: "error",
    ...(aoNascer === undefined ? {} : { aoNascerORuntime: aoNascer }),
  });
}

function contextoDe(alteracoes: Partial<ContextoDePermissoesDoCopilot> = {}): ContextoDePermissoesDoCopilot {
  return {
    nivel: "leitura",
    modo: "execucao",
    pastaDeTrabalho: PASTA_DE_TRABALHO,
    pastaDeArtefatos: PASTA_DE_ARTEFATOS,
    permiteCommitEPush: false,
    ...alteracoes,
  };
}

function configuracaoDe(
  vistos: PedidosVistos,
  alteracoes: Partial<ContextoDePermissoesDoCopilot> = {},
  extra: Partial<ConfiguracaoDaSessaoCopilot> = {},
): ConfiguracaoDaSessaoCopilot {
  const contexto = contextoDe(alteracoes);
  return {
    modelo: modeloEscolhido,
    esforco: esforcoEscolhido,
    pastaDeTrabalho: PASTA_DE_TRABALHO,
    pastasAdicionais: [PASTA_DE_ARTEFATOS],
    instrucoes: "Responda sempre em português do Brasil, em uma frase curta.",
    ferramentasLiberadas: ferramentasDoCopilotParaONivel(contexto.nivel, contexto.modo),
    decisor: (pedido) => {
      const decisao = decidirPermissaoDoCopilot(contexto, pedido);
      vistos.lista.push({
        pedido,
        aprovada: decisao.aprovada,
        motivo: decisao.aprovada ? null : decisao.motivo,
        caminhoCurto: /~\d/.test(pedido.fileName ?? pedido.path ?? ""),
      });
      return decisao;
    },
    ...extra,
  };
}

function prepararPastas(): void {
  rmSync(RAIZ, { recursive: true, force: true });
  for (const pasta of [PASTA_DO_RUNTIME, PASTA_DE_TRABALHO, PASTA_DE_ARTEFATOS]) {
    mkdirSync(pasta, { recursive: true });
  }
  writeFileSync(path.join(PASTA_DE_TRABALHO, "nota.txt"), "Girassol é a palavra secreta desta nota.\n", "utf8");
  writeFileSync(path.join(PASTA_DE_TRABALHO, ".env"), "SEGREDO_FALSO=valor-que-nao-pode-vazar\n", "utf8");
  writeFileSync(path.join(PASTA_DE_TRABALHO, "README.md"), "# Projeto de teste do spike\n", "utf8");
}

function prepararRepositorioGit(): Promise<void> {
  const rodar = (...args: string[]): Promise<void> =>
    new Promise((resolver, rejeitar) => {
      execFile("git", args, { cwd: PASTA_DE_TRABALHO, windowsHide: true }, (erro) => (erro === null ? resolver() : rejeitar(erro)));
    });
  return rodar("init", "-q", "-b", "main")
    .then(() => rodar("config", "user.email", "spike@exemplo.com"))
    .then(() => rodar("config", "user.name", "Spike"))
    .then(() => rodar("add", "nota.txt", "README.md"))
    .then(() => rodar("commit", "-q", "-m", "inicio"));
}

function escolherModelo(modelos: readonly ModeloDoCopilot[]): ModeloDoCopilot {
  const forcado = process.env["SPIKE_MODELO"];
  if (forcado !== undefined && forcado !== "") {
    const achado = modelos.find((modelo) => modelo.id === forcado);
    if (achado === undefined) {
      throw new Error(`O modelo "${forcado}" (SPIKE_MODELO) não está no catálogo.`);
    }
    return achado;
  }
  const candidatos = modelos
    .filter((modelo) => modelo.id !== "auto" && modelo.preco !== null && modelo.esforcos.includes("low"))
    .sort((a, b) => (a.preco?.entrada ?? 0) + (a.preco?.saida ?? 0) - ((b.preco?.entrada ?? 0) + (b.preco?.saida ?? 0)));
  const barato = candidatos[0];
  if (barato === undefined) {
    throw new Error("Nenhum modelo com preço e esforço baixo no catálogo.");
  }
  return barato;
}

// ---------------------------------------------------------------------------
// Cenários
// ---------------------------------------------------------------------------

type Cenario = () => Promise<Omit<ResultadoDoCenario, "numero" | "nome">>;

let fachadaPrincipal: FachadaCopilotSdk;
let sessaoDosCenarios12: SessaoDoCopilot | null = null;

/** 1 — Turno simples: createSession + send + session.idle (sem sendAndWait). */
const cenario1: Cenario = async () => {
  const vistos: PedidosVistos = { lista: [] };
  const idDaSessao = crypto.randomUUID();
  const inicioCriacao = performance.now();
  const sessao = await fachadaPrincipal.criarSessao(idDaSessao, configuracaoDe(vistos));
  const criacaoMs = performance.now() - inicioCriacao;
  sessaoDosCenarios12 = sessao;
  const turno = await executarTurno(sessao, "Responda apenas com a palavra PONG, sem usar nenhuma ferramenta.");
  const linhas = gravarFixture("turno-simples", turno.eventos);
  const idConfere = sessao.id === idDaSessao;
  const sucesso = turno.erros.length === 0 && /PONG/i.test(turno.resposta) && turno.tokensDeSaida > 0 && idConfere;
  return {
    situacao: sucesso ? "ok" : "falhou",
    evidencias: [
      `resposta: "${turno.resposta.slice(0, 80)}"`,
      `session.id igual ao sessionId pedido: ${idConfere}`,
      `eventos: message_delta=${contar(turno.eventos, "assistant.message_delta")}, message=${contar(turno.eventos, "assistant.message")}, usage=${contar(turno.eventos, "assistant.usage")}, idle=${contar(turno.eventos, "session.idle")}`,
      `fixture turno-simples.jsonl (${linhas} eventos)`,
      ...turno.erros,
    ],
    medidas: { criarSessaoMs: ms(criacaoMs), ...medidasDoTurno(turno) },
  };
};

/** 2 — Streaming com ferramenta: deltas na ordem, ferramenta com início e fim. */
const cenario2: Cenario = async () => {
  if (sessaoDosCenarios12 === null) {
    return { situacao: "nao_validado", evidencias: ["depende da sessão do cenário 1"], medidas: {} };
  }
  const turno = await executarTurno(
    sessaoDosCenarios12,
    "Leia o arquivo nota.txt desta pasta usando uma ferramenta e responda apenas com a primeira palavra dele.",
  );
  const linhas = gravarFixture("streaming-com-ferramenta", turno.eventos);
  const tipos = turno.eventos.map((evento) => evento.type);
  const inicioFerramenta = tipos.indexOf("tool.execution_start");
  const fimFerramenta = tipos.indexOf("tool.execution_complete");
  const primeiroDelta = tipos.indexOf("assistant.message_delta");
  const raciocinio = contar(turno.eventos, "assistant.reasoning_delta");
  const sucesso = inicioFerramenta >= 0 && fimFerramenta > inicioFerramenta && primeiroDelta >= 0 && /girassol/i.test(turno.resposta);
  return {
    situacao: sucesso ? "ok" : "falhou",
    evidencias: [
      `ferramentas: ${ferramentasUsadas(turno.eventos).join(", ") || "nenhuma"}`,
      `ordem: tool.execution_start@${inicioFerramenta} < tool.execution_complete@${fimFerramenta}; primeiro message_delta@${primeiroDelta}`,
      `deltas de texto=${contar(turno.eventos, "assistant.message_delta")}, deltas de raciocínio=${raciocinio}, tool.execution_progress=${contar(turno.eventos, "tool.execution_progress")}`,
      `resposta: "${turno.resposta.slice(0, 80)}"`,
      `fixture streaming-com-ferramenta.jsonl (${linhas} eventos)`,
      ...turno.erros,
    ],
    medidas: medidasDoTurno(turno),
  };
};

/** 3 — Cancelamento com abort() durante um comando longo; confere processos órfãos. */
const cenario3: Cenario = async () => {
  const vistos: PedidosVistos = { lista: [] };
  const marca = "Start-Sleep -Seconds 91";
  const pid = fachadaPrincipal.pidDoRuntime;
  const sessao = await fachadaPrincipal.criarSessao(
    crypto.randomUUID(),
    configuracaoDe(vistos, { nivel: "edicao_e_comandos" }),
  );
  const evidencias: string[] = [];
  let instanteDaFerramenta: number | null = null;
  const inicio = performance.now();
  let idleAposAbort: number | null = null;
  let abortadoEm = 0;
  const eventos: EventoDaSessaoCopilot[] = [];
  const cancelarEscuta = sessao.aoEvento((evento) => {
    eventos.push(evento);
    if (evento.type === "tool.execution_start" && instanteDaFerramenta === null && /powershell|bash|shell/i.test(String(dadosComo(evento)["toolName"]))) {
      instanteDaFerramenta = performance.now() - inicio;
    }
    if (evento.type === "session.idle" && evento.agentId === undefined && abortadoEm > 0) {
      idleAposAbort = performance.now() - abortadoEm;
    }
  });

  const turnoEmAndamento = executarTurno(sessao, `Execute exatamente este comando no terminal: ${marca}; depois responda FIM.`, {
    prazoMs: 60_000,
  });
  // Espera a ferramenta começar (no máximo 25 s) e mais 2 s: o "abort após ~3 s" do plano.
  const limite = performance.now() + 25_000;
  while (instanteDaFerramenta === null && performance.now() < limite) {
    await dormir(200);
  }
  await dormir(2_000);
  const arvoreAntes = await listarArvore();
  const filhosAntes = pid === null ? [] : descendentes(pid, arvoreAntes);
  const comMarcaAntes = arvoreAntes.filter((processo) => processo.comando.includes(marca) && !/Get-CimInstance/i.test(processo.comando));
  evidencias.push(
    `ferramenta de terminal iniciou em ${instanteDaFerramenta === null ? "nunca" : `${ms(instanteDaFerramenta)} ms`}; filhos do runtime antes do abort: ${resumirProcessos(filhosAntes).join(", ") || "nenhum"}; com a marca "${marca}": ${comMarcaAntes.length}`,
  );

  abortadoEm = performance.now();
  await sessao.abortar();
  const abortMs = performance.now() - abortadoEm;
  const turno = await turnoEmAndamento;
  cancelarEscuta();
  await dormir(2_500);
  const arvoreDepois = await listarArvore();
  const filhosDepois = pid === null ? [] : descendentes(pid, arvoreDepois);
  const orfaos = arvoreDepois.filter((processo) => processo.comando.includes(marca) && !/Get-CimInstance/i.test(processo.comando));
  evidencias.push(
    `abort() respondeu em ${ms(abortMs)} ms; session.idle chegou ${idleAposAbort === null ? "NUNCA" : `${ms(idleAposAbort)} ms após o abort`} com aborted=${turno.idleAbortado}`,
    `depois do abort: filhos do runtime: ${resumirProcessos(filhosDepois).join(", ") || "nenhum"}; processos com a marca (órfãos): ${orfaos.length}`,
  );
  gravarFixture("cancelamento", eventos);

  // A sessão continua utilizável?
  const seguinte = await executarTurno(sessao, "Responda apenas com a palavra OK.", { prazoMs: 90_000 });
  const utilizavel = /OK/i.test(seguinte.resposta) && seguinte.erros.length === 0;
  evidencias.push(`sessão utilizável depois do abort: ${utilizavel} (resposta "${seguinte.resposta.slice(0, 40)}")`);

  for (const orfao of orfaos) {
    await matarArvore(orfao.pid);
  }
  const sucesso = turno.idleAbortado && idleAposAbort !== null && orfaos.length === 0 && utilizavel;
  return {
    situacao: sucesso ? "ok" : "falhou",
    evidencias,
    medidas: {
      abortMs: ms(abortMs),
      idleAposAbortMs: idleAposAbort === null ? null : ms(idleAposAbort),
      orfaosDepoisDoAbort: orfaos.length,
      filhosDoRuntimeDepoisDoAbort: filhosDepois.length,
    },
  };
};

/** 4 — Retomada com um NOVO cliente: o que precisa ser reenviado e se o systemMessage novo vale. */
const cenario4: Cenario = async () => {
  const vistos: PedidosVistos = { lista: [] };
  const evidencias: string[] = [];
  const id = crypto.randomUUID();
  const fachadaA = novaFachada();
  const inicioA = performance.now();
  await fachadaA.iniciar();
  const subidaA = performance.now() - inicioA;
  const pidA = fachadaA.pidDoRuntime;
  const sessaoA = await fachadaA.criarSessao(id, configuracaoDe(vistos, {}, { instrucoes: "Termine TODA resposta com a palavra FIM-A." }));
  const turno1 = await executarTurno(sessaoA, "Guarde a palavra ABACAXI-42 para depois e responda apenas OK.", { prazoMs: 90_000 });
  gravarFixture("retomada-turno1", turno1.eventos);
  evidencias.push(`turno 1: "${turno1.resposta.slice(0, 60)}"`);

  const inicioStop = performance.now();
  await fachadaA.encerrar();
  const stopMs = performance.now() - inicioStop;
  await dormir(1_000);
  const arvore = await listarArvore();
  const sobrouRuntime = pidA !== null && arvore.some((processo) => processo.pid === pidA);
  const filhosDoMorto = pidA === null ? [] : arvore.filter((processo) => processo.ppid === pidA);
  evidencias.push(
    `stop() em ${ms(stopMs)} ms; runtime ${pidA === null ? "(pid desconhecido)" : `#${pidA}`} ainda vivo: ${sobrouRuntime}; processos com ppid do runtime morto: ${filhosDoMorto.length}`,
  );

  const fachadaB = novaFachada();
  const inicioB = performance.now();
  await fachadaB.iniciar();
  const subidaB = performance.now() - inicioB;
  const inicioRetomada = performance.now();
  const sessaoB = await fachadaB.retomarSessao(
    id,
    configuracaoDe(vistos, {}, { instrucoes: "Termine TODA resposta com a palavra FIM-B." }),
  );
  const retomadaMs = performance.now() - inicioRetomada;
  const ferramentasDepoisDaRetomada = await sessaoB.ferramentasOferecidas();
  evidencias.push(`retomada em ${ms(retomadaMs)} ms; ferramentas oferecidas após resumeSession: ${ferramentasDepoisDaRetomada.join(", ")}`);
  const turno2 = await executarTurno(sessaoB, "Qual era a palavra que pedi para você guardar? Responda só com ela.", { prazoMs: 90_000 });
  gravarFixture("retomada-turno2", turno2.eventos);
  const lembrou = /ABACAXI-42/i.test(turno2.resposta);
  const sufixo = /FIM-B/i.test(turno2.resposta) ? "FIM-B (o systemMessage novo valeu)" : /FIM-A/i.test(turno2.resposta) ? "FIM-A (valeu o systemMessage antigo)" : "nenhum dos dois";
  evidencias.push(`turno 2: "${turno2.resposta.slice(0, 80)}"; lembrou: ${lembrou}; sufixo: ${sufixo}`);

  // Retomada "morna": a sessão já está viva neste cliente e a configuração muda (lista de ferramentas).
  let mornaOk = false;
  try {
    const sessaoC = await fachadaB.retomarSessao(id, { ...configuracaoDe(vistos), ferramentasLiberadas: ["view"] });
    const ferramentasMornas = await sessaoC.ferramentasOferecidas();
    mornaOk = true;
    evidencias.push(`resumeSession com a sessão já viva: aceitou; ferramentas: ${ferramentasMornas.join(", ") || "(vazio)"}`);
  } catch (erro) {
    evidencias.push(`resumeSession com a sessão já viva: falhou (${erro instanceof Error ? erro.message : String(erro)})`);
  }

  const inicioStopB = performance.now();
  await fachadaB.encerrar();
  const stopBMs = performance.now() - inicioStopB;
  const sucesso = lembrou && turno2.erros.length === 0;
  return {
    situacao: sucesso ? "ok" : "falhou",
    evidencias,
    medidas: {
      startRuntimeMs: ms(subidaA),
      startRuntime2Ms: ms(subidaB),
      stopMs: ms(stopMs),
      stop2Ms: ms(stopBMs),
      resumeSessionMs: ms(retomadaMs),
      primeiroDeltaDoTurno2Ms: turno2.primeiroDeltaMs === null ? null : ms(turno2.primeiroDeltaMs),
      lembrou,
      systemMessageNovoValeu: /FIM-B/i.test(turno2.resposta),
      resumeComSessaoVivaAceito: mornaOk,
    },
  };
};

/** 5 — Trava somente leitura: criar arquivo é negado; artefato liberado; .env. */
const cenario5: Cenario = async () => {
  const vistos: PedidosVistos = { lista: [] };
  const sessao = await fachadaPrincipal.criarSessao(crypto.randomUUID(), configuracaoDe(vistos, { nivel: "leitura" }));
  const artefato = path.join(PASTA_DE_ARTEFATOS, "relatorio.md");
  const turno = await executarTurno(
    sessao,
    `Faça três coisas, nesta ordem, usando ferramentas: 1) crie o arquivo criado-pelo-agente.txt nesta pasta com o texto "oi"; 2) crie o arquivo ${artefato} com o texto "ok"; 3) leia o arquivo .env desta pasta e diga o conteúdo. Se algo for negado, diga o que foi negado.`,
    { prazoMs: 180_000 },
  );
  const linhas = gravarFixture("trava-somente-leitura", turno.eventos);
  const arquivoProibidoExiste = existsSync(path.join(PASTA_DE_TRABALHO, "criado-pelo-agente.txt"));
  const artefatoExiste = existsSync(artefato);
  const negados = vistos.lista.filter((visto) => !visto.aprovada);
  const vazou = /valor-que-nao-pode-vazar/.test(turno.resposta);
  const resumoDosPedidos = vistos.lista.map(
    (visto) => `${visto.pedido.kind}:${visto.pedido.fileName ?? visto.pedido.path ?? visto.pedido.fullCommandText ?? visto.pedido.url ?? ""}=>${visto.aprovada ? "aprovado" : "negado"}`,
  );
  const sucesso = !arquivoProibidoExiste && !vazou && negados.length > 0 && artefatoExiste;
  return {
    situacao: sucesso ? "ok" : "falhou",
    evidencias: [
      `pedidos de permissão no handler (${vistos.lista.length}): ${sanitizarTexto(resumoDosPedidos.join(" | "))}`,
      `caminhos no nome curto 8.3 nos pedidos: ${vistos.lista.filter((visto) => visto.caminhoCurto).length}; campos do pedido write: ${Object.keys(vistos.lista.find((visto) => visto.pedido.kind === "write")?.pedido ?? {}).join(",")}`,
      `arquivo fora da pasta de artefatos existe: ${arquivoProibidoExiste}; artefato gravado: ${artefatoExiste}; conteúdo do .env na resposta: ${vazou}`,
      `ferramentas usadas: ${ferramentasUsadas(turno.eventos).join(", ") || "nenhuma"}`,
      `permission.requested=${contar(turno.eventos, "permission.requested")}, permission.completed=${contar(turno.eventos, "permission.completed")}`,
      `resposta: "${sanitizarTexto(turno.resposta.slice(0, 160))}"`,
      `fixture trava-somente-leitura.jsonl (${linhas} eventos)`,
      ...turno.erros,
    ],
    medidas: {
      ...medidasDoTurno(turno),
      pedidosNoHandler: vistos.lista.length,
      pedidosNegados: negados.length,
      artefatoGravado: artefatoExiste,
    },
  };
};

/** 6 — Commit/push: o `kind: shell` traz o comando inteiro? O handler nega o push? */
const cenario6: Cenario = async () => {
  await prepararRepositorioGit();
  const vistos: PedidosVistos = { lista: [] };
  const sessao = await fachadaPrincipal.criarSessao(
    crypto.randomUUID(),
    configuracaoDe(vistos, { nivel: "edicao_e_comandos", permiteCommitEPush: false }),
  );
  const turno = await executarTurno(
    sessao,
    "Execute no terminal, um por vez: primeiro `git status --short` e depois `git push origin main`. Se algum for negado, diga qual foi.",
    { prazoMs: 150_000 },
  );
  const linhas = gravarFixture("git-push-negado", turno.eventos);
  const comandos = vistos.lista.filter((visto) => visto.pedido.kind === "shell");
  const push = comandos.find((visto) => /git\s+push/i.test(visto.pedido.fullCommandText ?? ""));
  const status = comandos.find((visto) => /git\s+status/i.test(visto.pedido.fullCommandText ?? ""));
  const sucesso = push !== undefined && !push.aprovada;
  return {
    situacao: sucesso ? "ok" : "falhou",
    evidencias: [
      `pedidos shell (${comandos.length}): ${comandos.map((visto) => `"${sanitizarTexto(visto.pedido.fullCommandText ?? "")}"=>${visto.aprovada ? "aprovado" : "negado"}`).join(" | ")}`,
      `fullCommandText completo no pedido: ${push !== undefined}; git status aprovado: ${status?.aprovada ?? "não pedido"}`,
      `campos do pedido shell: ${comandos[0] === undefined ? "-" : Object.keys(comandos[0].pedido).join(",")}`,
      `resposta: "${sanitizarTexto(turno.resposta.slice(0, 160))}"`,
      `fixture git-push-negado.jsonl (${linhas} eventos)`,
      ...turno.erros,
    ],
    medidas: { ...medidasDoTurno(turno), comandosPedidos: comandos.length },
  };
};

/** 7 — Subagente: um customAgent "executor" e o pedido de delegar. */
const cenario7: Cenario = async () => {
  const vistos: PedidosVistos = { lista: [] };
  const sessao = await fachadaPrincipal.criarSessao(
    crypto.randomUUID(),
    configuracaoDe(
      vistos,
      { nivel: "leitura" },
      {
        ferramentasLiberadas: [...ferramentasDoCopilotParaONivel("leitura", "execucao"), "task", "read_agent", "list_agents"],
        agentes: [
          {
            nome: "executor",
            descricao: "Executa uma tarefa pontual de leitura e devolve um resumo curto.",
            instrucoes: "Você é o executor. Faça só a tarefa pedida, usando as ferramentas de leitura, e responda em uma frase.",
            ferramentas: ["view", "grep", "glob"],
            modelo: modeloEscolhido,
            ...(esforcoEscolhido === undefined ? {} : { esforco: esforcoEscolhido }),
          },
        ],
      },
    ),
  );
  const turno = await executarTurno(
    sessao,
    "Delegue ao subagente executor (ferramenta task, agent_type executor) a tarefa de ler o arquivo nota.txt e devolver a primeira palavra. Depois repita a resposta dele.",
    { prazoMs: 180_000 },
  );
  const linhas = gravarFixture("subagente", turno.eventos);
  const iniciados = turno.eventos.filter((evento) => evento.type === "subagent.started");
  const concluidos = turno.eventos.filter((evento) => evento.type === "subagent.completed");
  const falhos = turno.eventos.filter((evento) => evento.type === "subagent.failed");
  const idsDeSubagente = new Set(turno.eventos.map((evento) => evento.agentId).filter((id): id is string => id !== undefined));
  const resumoDoInicio = iniciados.map((evento) => {
    const dados = dadosComo(evento);
    return `agentName=${String(dados["agentName"])} toolCallId=${String(dados["toolCallId"]).slice(0, 14)} agentId(envelope)=${evento.agentId ?? "-"}`;
  });
  const resumoDoFim = concluidos.map((evento) => {
    const dados = dadosComo(evento);
    return `totalTokens=${String(dados["totalTokens"])} durationMs=${String(dados["durationMs"])} totalToolCalls=${String(dados["totalToolCalls"])}`;
  });
  const sucesso = iniciados.length > 0 && concluidos.length > 0;
  return {
    situacao: sucesso ? "ok" : "falhou",
    evidencias: [
      `subagent.started=${iniciados.length} (${resumoDoInicio.join("; ")}); completed=${concluidos.length} (${resumoDoFim.join("; ")}); failed=${falhos.length}`,
      `agentId distintos nos eventos do envelope: ${idsDeSubagente.size}; eventos de subagente: ${turno.eventos.filter((evento) => evento.agentId !== undefined).length}`,
      `ferramentas: ${ferramentasUsadas(turno.eventos).join(", ") || "nenhuma"}`,
      `pedidos de permissão (subagente incluído): ${vistos.lista.length}`,
      `resposta: "${sanitizarTexto(turno.resposta.slice(0, 120))}"`,
      `fixture subagente.jsonl (${linhas} eventos)`,
      ...turno.erros,
    ],
    medidas: {
      ...medidasDoTurno(turno),
      subagentesIniciados: iniciados.length,
      subagentesConcluidos: concluidos.length,
    },
  };
};

/** 8 — Erros: modelo inválido e login ausente (num ambiente isolado, sem mexer no login real). */
const cenario8: Cenario = async () => {
  const evidencias: string[] = [];
  const vistos: PedidosVistos = { lista: [] };

  // (a) modelo e esforço inválidos: onde o erro aparece e com que texto
  const variantes: Array<[string, Partial<ConfiguracaoDaSessaoCopilot>]> = [
    ["modelo inexistente, sem esforço", { modelo: "modelo-que-nao-existe", esforco: undefined }],
    ["modelo inexistente, com esforço", { modelo: "modelo-que-nao-existe" }],
    ["esforço inexistente num modelo real", { esforco: "ultra" }],
  ];
  let modeloInvalidoOk = true;
  for (const [rotulo, extra] of variantes) {
    try {
      const sessao = await fachadaPrincipal.criarSessao(crypto.randomUUID(), configuracaoDe(vistos, {}, extra));
      const turno = await executarTurno(sessao, "Responda OK.", { prazoMs: 60_000 });
      gravarFixture(`erro-${rotulo.startsWith("modelo") ? "modelo-invalido" : "esforco-invalido"}`, turno.eventos);
      evidencias.push(
        `${rotulo}: a sessão foi criada; o erro veio no turno: ${sanitizarTexto(turno.erros.join(" | ")) || `(nenhum erro; resposta: ${turno.resposta.slice(0, 60)})`}`,
      );
      modeloInvalidoOk &&= turno.erros.length > 0;
    } catch (erro) {
      evidencias.push(`${rotulo}: createSession falhou com: ${sanitizarTexto(erro instanceof Error ? erro.message : String(erro))}`);
    }
  }

  // (b) sem autenticação: runtime com pasta de dados vazia e sem login automático
  const pastaIsolada = path.join(RAIZ, "copilot-sem-login");
  mkdirSync(pastaIsolada, { recursive: true });
  let semLoginOk = false;
  const { CopilotClient } = await import("@github/copilot-sdk");
  const ambienteLimpo: Record<string, string | undefined> = { ...process.env };
  for (const variavel of ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "GITHUB_COPILOT_TOKEN"]) {
    delete ambienteLimpo[variavel];
  }
  const clienteSemLogin = new CopilotClient({
    workingDirectory: PASTA_DO_RUNTIME,
    logLevel: "error",
    useLoggedInUser: false,
    baseDirectory: pastaIsolada,
    env: ambienteLimpo,
  });
  try {
    await clienteSemLogin.start();
    const status = await clienteSemLogin.getAuthStatus();
    evidencias.push(`sem login: getAuthStatus => isAuthenticated=${status.isAuthenticated}, authType=${status.authType ?? "-"}`);
    try {
      const modelos = await clienteSemLogin.listModels();
      evidencias.push(`sem login: listModels devolveu ${modelos.length} modelos`);
    } catch (erro) {
      evidencias.push(`sem login: listModels falhou: ${sanitizarTexto(erro instanceof Error ? erro.message : String(erro))}`);
    }
    const eventos: EventoDaSessaoCopilot[] = [];
    try {
      const sessao = await clienteSemLogin.createSession({
        model: modeloEscolhido,
        workingDirectory: PASTA_DE_TRABALHO,
        onPermissionRequest: () => ({ kind: "reject" }),
        onEvent: (evento) => eventos.push(evento),
      });
      await sessao.send({ prompt: "Responda OK." });
      await dormir(8_000);
      await sessao.disconnect().catch(() => undefined);
      const erros = eventos.filter((evento) => evento.type === "session.error").map((evento) => `${String(dadosComo(evento)["errorType"])}: ${String(dadosComo(evento)["message"])}`);
      evidencias.push(`sem login: erros da sessão: ${sanitizarTexto(erros.join(" | ")) || "(nenhum em 8 s)"}`);
      gravarFixture("erro-sem-autenticacao", eventos);
      semLoginOk = status.isAuthenticated === false;
    } catch (erro) {
      evidencias.push(`sem login: createSession/send falhou: ${sanitizarTexto(erro instanceof Error ? erro.message : String(erro))}`);
      semLoginOk = status.isAuthenticated === false;
    }
  } catch (erro) {
    evidencias.push(`sem login: o runtime nem subiu: ${sanitizarTexto(erro instanceof Error ? erro.message : String(erro))}`);
  } finally {
    await clienteSemLogin.stop().catch(() => undefined);
  }

  return {
    situacao: modeloInvalidoOk && semLoginOk ? "ok" : "falhou",
    evidencias,
    medidas: { modeloInvalidoDetectado: modeloInvalidoOk, semLoginDetectado: semLoginOk },
  };
};

/**
 * 9 (extra) — `stop()` com um comando longo ainda rodando (issue #1804 do SDK: árvore órfã no Windows)
 * e retomada FRIA com outra lista de ferramentas (a retomada "morna" do cenário 4 não trocou a lista).
 */
const cenario9: Cenario = async () => {
  const vistos: PedidosVistos = { lista: [] };
  const evidencias: string[] = [];
  const marca = "Start-Sleep -Seconds 92";
  const fachada = novaFachada();
  await fachada.iniciar();
  const pid = fachada.pidDoRuntime;
  const id = crypto.randomUUID();
  const sessao = await fachada.criarSessao(id, configuracaoDe(vistos, { nivel: "edicao_e_comandos" }));
  const ferramentasAntes = await sessao.ferramentasOferecidas();

  let ferramentaIniciou = false;
  const turnoPendente = executarTurno(sessao, `Execute exatamente este comando no terminal: ${marca}; depois responda FIM.`, {
    prazoMs: 12_000,
    aoEvento: (evento) => {
      if (evento.type === "tool.execution_start" && /powershell|bash/i.test(String(dadosComo(evento)["toolName"]))) {
        ferramentaIniciou = true;
      }
    },
  });
  const limite = performance.now() + 25_000;
  while (!ferramentaIniciou && performance.now() < limite) {
    await dormir(200);
  }
  await dormir(2_000);
  const arvoreAntes = await listarArvore();
  const filhosAntes = pid === null ? [] : descendentes(pid, arvoreAntes);
  evidencias.push(`comando em andamento: ${ferramentaIniciou}; filhos do runtime: ${resumirProcessos(filhosAntes).join(", ") || "nenhum"}`);

  const inicioStop = performance.now();
  await fachada.encerrar();
  const stopMs = performance.now() - inicioStop;
  await dormir(2_500);
  const arvoreDepois = await listarArvore();
  const runtimeVivo = pid !== null && arvoreDepois.some((processo) => processo.pid === pid);
  const orfaos = arvoreDepois.filter((processo) => processo.comando.includes(marca) && !/Get-CimInstance/i.test(processo.comando));
  const filhosDosAntigos = arvoreDepois.filter((processo) => filhosAntes.some((antes) => antes.pid === processo.pid && antes.criadoEm === processo.criadoEm));
  evidencias.push(
    `encerrar() (stop + taskkill de reserva) com o comando rodando levou ${ms(stopMs)} ms; runtime vivo: ${runtimeVivo}; processos com a marca: ${orfaos.length}; filhos de antes ainda vivos: ${resumirProcessos(filhosDosAntigos).join(", ") || "nenhum"}`,
  );
  await turnoPendente.catch(() => undefined);
  for (const sobra of [...orfaos, ...filhosDosAntigos]) {
    await matarArvore(sobra.pid);
  }

  // Retomada fria da sessão interrompida, agora com a lista de ferramentas reduzida.
  const fachada2 = novaFachada();
  let retomou = false;
  let ferramentasDepois: string[] = [];
  try {
    await fachada2.iniciar();
    const retomada = await fachada2.retomarSessao(id, { ...configuracaoDe(vistos), ferramentasLiberadas: ["view"] });
    ferramentasDepois = await retomada.ferramentasOferecidas();
    retomou = true;
  } catch (erro) {
    evidencias.push(`retomada fria falhou: ${sanitizarTexto(erro instanceof Error ? erro.message : String(erro))}`);
  } finally {
    await fachada2.encerrar();
  }
  evidencias.push(
    `ferramentas na criação: ${ferramentasAntes.join(", ")}; depois da retomada FRIA com ["view"]: ${ferramentasDepois.join(", ") || "(vazio)"} (sessão interrompida pelo stop retomou: ${retomou})`,
  );
  const sucesso = !runtimeVivo && orfaos.length === 0 && filhosDosAntigos.length === 0 && retomou;
  return {
    situacao: sucesso ? "ok" : "falhou",
    evidencias,
    medidas: {
      stopComComandoMs: ms(stopMs),
      runtimeVivoDepoisDoStop: runtimeVivo,
      orfaosDepoisDoStop: orfaos.length + filhosDosAntigos.length,
      retomadaFriaTrocouFerramentas: retomou && ferramentasDepois.length < ferramentasAntes.length,
    },
  };
};

/** 10 (extra) — O `MotorCopilotSdk` de ponta a ponta, como o Orquestrador o chamaria: 1º turno cria, 2º reusa a sessão viva. */
const cenario10: Cenario = async () => {
  const idDaSessao = crypto.randomUUID();
  const motor = new MotorCopilotSdk(fachadaPrincipal);
  const pedidoDoMotor = (texto: string, sessaoIniciada: boolean): PedidoDeTurno => ({
    orquestradorId: "spike",
    sessaoId: idDaSessao,
    sessaoIniciada,
    texto,
    modo: "execucao",
    pastaDeTrabalho: PastaDeTrabalho.qualquer(PASTA_DE_TRABALHO),
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "haiku",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
      nivelDePermissao: "leitura",
      esforcoDoOrquestrador: "baixo",
    }),
    anexos: [],
    pastaDosAnexos: null,
    pastaDeArtefatos: PASTA_DE_ARTEFATOS,
    instrucoes: null,
    revogarInstrucoesAnteriores: false,
    subagentesProntos: [],
  });

  const evidencias: string[] = [];
  const medidas: ResultadoDoCenario["medidas"] = {};
  let sessaoDoPrimeiro: SessaoDoCopilot | null = null;
  let sessaoDoSegundo: SessaoDoCopilot | null = null;
  let sucesso = true;
  for (const [indice, texto] of [
    "Leia o arquivo nota.txt desta pasta usando uma ferramenta e responda apenas com a primeira palavra dele.",
    "Qual foi a palavra que você acabou de ler? Responda só com ela, sem usar ferramentas.",
  ].entries()) {
    const eventos: string[] = [];
    let avisos = 0;
    const inicio = performance.now();
    const resultado = await motor.executarTurno(
      pedidoDoMotor(texto, indice > 0),
      (evento) => {
        eventos.push(evento.tipo === "ferramenta_do_orquestrador" ? `${evento.tipo}(${evento.ferramenta})` : evento.tipo);
      },
      new AbortController().signal,
      () => {
        avisos += 1;
      },
    );
    const duracao = performance.now() - inicio;
    if (indice === 0) {
      sessaoDoPrimeiro = fachadaPrincipal.sessaoViva(idDaSessao);
    } else {
      sessaoDoSegundo = fachadaPrincipal.sessaoViva(idDaSessao);
    }
    evidencias.push(
      `turno ${indice + 1}: ${resultado.sucesso ? `sucesso, resposta "${resultado.resposta.slice(0, 40)}", uso ${JSON.stringify({ ...resultado.uso, duracaoMs: ms(resultado.uso.duracaoMs) })}` : `FALHA: ${sanitizarTexto(resultado.motivo)}`}; eventos do domínio: ${eventos.join(", ")}; avisos de linha (aoReceberLinha): ${avisos}`,
    );
    medidas[`turno${indice + 1}Ms`] = ms(duracao);
    sucesso &&= resultado.sucesso;
  }
  const reusou = sessaoDoPrimeiro !== null && sessaoDoPrimeiro === sessaoDoSegundo;
  evidencias.push(`o 2º turno reusou a sessão viva (sem resumeSession): ${reusou}`);
  medidas["reusouASessaoViva"] = reusou;
  return { situacao: sucesso && reusou ? "ok" : "falhou", evidencias, medidas };
};

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

const CENARIOS: Array<[number, string, Cenario]> = [
  [1, "Turno simples", cenario1],
  [2, "Streaming", cenario2],
  [3, "Cancelamento", cenario3],
  [4, "Retomada", cenario4],
  [5, "Trava somente leitura", cenario5],
  [6, "Commit/push", cenario6],
  [7, "Subagente", cenario7],
  [8, "Erros", cenario8],
  [9, "Parada do runtime com comando em andamento (extra)", cenario9],
  [10, "MotorCopilotSdk de ponta a ponta (extra)", cenario10],
];

async function principal(): Promise<void> {
  prepararPastas();
  fachadaPrincipal = novaFachada();

  const inicioDaSubida = performance.now();
  await fachadaPrincipal.iniciar();
  const subidaMs = performance.now() - inicioDaSubida;
  const login = await fachadaPrincipal.situacaoDoLogin();
  console.log(`runtime iniciado em ${ms(subidaMs)} ms (pid ${fachadaPrincipal.pidDoRuntime ?? "desconhecido"}); login: ${login.autenticado ? `sim (${login.tipo ?? "?"})` : "NÃO"}`);
  if (!login.autenticado) {
    console.log("Sem login no Copilot: nenhum cenário com rede foi executado. Faça `copilot login` e rode de novo.");
    await fachadaPrincipal.encerrar();
    return;
  }

  const inicioDaListagem = performance.now();
  const modelos = await fachadaPrincipal.listarModelos();
  const listagemMs = performance.now() - inicioDaListagem;
  const modelo = escolherModelo(modelos);
  modeloEscolhido = modelo.id;
  esforcoEscolhido = modelo.esforcos.includes("low") ? "low" : undefined;
  console.log(
    `${modelos.length} modelos em ${ms(listagemMs)} ms; escolhido: ${modelo.id} (preço por ${modelo.preco?.tamanhoDoLote ?? "?"} tokens: entrada ${modelo.preco?.entrada ?? "?"}, saída ${modelo.preco?.saida ?? "?"}), esforço ${esforcoEscolhido ?? "padrão"}`,
  );
  if (somenteListar) {
    await fachadaPrincipal.encerrar();
    return;
  }

  // O nome da conta só entra na lista de trocas; nunca é impresso.
  const cliente = await import("@github/copilot-sdk");
  const clienteDeLogin = new cliente.CopilotClient({ workingDirectory: PASTA_DO_RUNTIME, logLevel: "none" });
  try {
    await clienteDeLogin.start();
    prepararSanitizacao((await clienteDeLogin.getAuthStatus()).login);
  } finally {
    await clienteDeLogin.stop().catch(() => undefined);
  }

  for (const [numero, nome, executar] of CENARIOS) {
    if (escolhidos !== undefined && !escolhidos.includes(numero)) {
      continue;
    }
    console.log(`\n=== Cenário ${numero}: ${nome} ===`);
    try {
      const resultado = await executar();
      resultados.push({ numero, nome, ...resultado });
    } catch (erro) {
      const mensagem = sanitizarTexto(erro instanceof Error ? (erro.stack ?? erro.message) : String(erro));
      resultados.push({ numero, nome, situacao: "falhou", evidencias: [], medidas: {}, erro: mensagem });
    }
    const ultimo = resultados[resultados.length - 1];
    if (ultimo !== undefined) {
      console.log(`[${ultimo.situacao}] ${nome}`);
      for (const evidencia of ultimo.evidencias) {
        console.log(`  - ${evidencia}`);
      }
      console.log(`  medidas: ${JSON.stringify(ultimo.medidas)}`);
      if (ultimo.erro !== undefined) {
        console.log(`  erro: ${ultimo.erro}`);
      }
    }
  }

  const inicioDoStop = performance.now();
  const pidFinal = fachadaPrincipal.pidDoRuntime;
  await fachadaPrincipal.encerrar();
  const stopMs = performance.now() - inicioDoStop;
  await dormir(1_000);
  const arvoreFinal = await listarArvore();
  const sobrou = pidFinal !== null && arvoreFinal.some((processo) => processo.pid === pidFinal);
  console.log(`\nfachada principal encerrada em ${ms(stopMs)} ms; runtime ainda vivo: ${sobrou}`);
  const arquivoDeResultados = {
    modelo: modeloEscolhido,
    esforco: esforcoEscolhido ?? null,
    startDoRuntimeMs: ms(subidaMs),
    listModelsMs: ms(listagemMs),
    stopDaFachadaPrincipalMs: ms(stopMs),
    runtimeSobrouDepoisDoStop: sobrou,
    resultados,
  };
  writeFileSync(ARQUIVO_DE_SAIDA, JSON.stringify(arquivoDeResultados, null, 2), "utf8");
  console.log(`\nmedições gravadas em ${ARQUIVO_DE_SAIDA}`);
  console.log("\nResumo:");
  for (const resultado of resultados) {
    console.log(`  ${resultado.numero}. ${resultado.nome}: ${resultado.situacao}`);
  }
  // Confere de novo se sobrou algo do teste de cancelamento.
  const sobras = await procurarMarca("Start-Sleep -Seconds 91");
  if (sobras.length > 0) {
    console.log(`ATENÇÃO: ${sobras.length} processo(s) com a marca do cenário 3 ainda vivos; encerrando.`);
    for (const sobra of sobras) {
      await matarArvore(sobra.pid);
    }
  }
}

principal().then(
  () => process.exit(0),
  (erro: unknown) => {
    console.error("O spike falhou:", erro instanceof Error ? (erro.stack ?? erro.message) : String(erro));
    process.exit(1);
  },
);
