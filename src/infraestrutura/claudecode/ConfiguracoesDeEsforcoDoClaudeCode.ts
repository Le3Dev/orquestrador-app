import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ConsultaDeEsforcoHerdado, EsforcoDaMaquina } from "../../orquestracao/EsforcoDaMaquina";
import type { EsforcoDeRaciocinio } from "../../orquestracao/EsforcoDeRaciocinio";
import { EsforcoHerdado } from "../../orquestracao/EsforcoHerdado";
import type { ModeloClaude } from "../../orquestracao/ModeloClaude";
import { ehObjeto, Objeto, objeto, texto } from "./MedicaoDasTranscricoes";
import { pastaDoClaude } from "./TranscricoesDoClaudeCode";

/**
 * Descobre o esforço de raciocínio que o Claude Code usa quando o app não
 * manda `--effort` ("Padrão"). Regras da documentação oficial
 * (https://code.claude.com/docs/en/model-config#adjust-effort-level e
 * https://code.claude.com/docs/en/settings-reference#modelsettings):
 *
 * 1. `CLAUDE_CODE_EFFORT_LEVEL` vence tudo (`auto`/`unset` = não manda nível:
 *    vale o padrão do modelo);
 * 2. depois os arquivos, do mais forte ao mais fraco: `.claude/settings.local.json`
 *    do projeto, `.claude/settings.json` do projeto e `~/.claude/settings.json`.
 *    Cada modelo é resolvido à parte: vale o primeiro arquivo que define
 *    `modelSettings[<ID>].effortLevel` ou um `effortLevel` de topo que se
 *    aplique ao modelo; dentro do mesmo arquivo, `modelSettings` vence o topo;
 * 3. o `effortLevel` de topo do arquivo do USUÁRIO não vale para o Opus 5.5 e
 *    modelos lançados depois dele (nos do projeto vale para todos).
 *
 * Fora do alcance: configurações gerenciadas pela organização e `--settings`.
 */

type NivelDoClaudeCode = "low" | "medium" | "high" | "xhigh" | "max";
type NivelHerdado = Exclude<EsforcoDeRaciocinio, "padrao">;

const NIVEIS: Readonly<Record<NivelDoClaudeCode, NivelHerdado>> = {
  low: "baixo",
  medium: "medio",
  high: "alto",
  xhigh: "extra_alto",
  max: "maximo",
};

/** Nos arquivos de configuração `max` não é aceito (nem no topo, nem em `modelSettings`). */
const NIVEIS_DOS_ARQUIVOS: readonly NivelDoClaudeCode[] = ["low", "medium", "high", "xhigh"];
const NIVEIS_DA_VARIAVEL: readonly NivelDoClaudeCode[] = ["low", "medium", "high", "xhigh", "max"];
/** Valores da variável que fazem o Claude Code não mandar nível nenhum. */
const SEM_NIVEL = ["auto", "unset"];

const VARIAVEL_DE_ESFORCO = "CLAUDE_CODE_EFFORT_LEVEL";

/**
 * Para qual modelo cada apelido resolve hoje na API da Anthropic (tabela de
 * apelidos da doc). Usado só quando o modelo real não é conhecido.
 */
const ID_PADRAO_DO_APELIDO: Readonly<Record<ModeloClaude, string>> = {
  fable: "claude-fable-5-1",
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

/** Famílias em que o `effortLevel` de topo do usuário deixa de valer a partir desta versão. */
const VERSAO_QUE_IGNORA_O_TOPO_DO_USUARIO: Readonly<Record<string, readonly number[]>> = {
  opus: [5, 5],
  sonnet: [5, 5],
  haiku: [5, 5],
};

export function nivelDoClaudeCode(valor: unknown, aceitos: readonly NivelDoClaudeCode[]): NivelHerdado | null {
  if (typeof valor !== "string") {
    return null;
  }
  const nivel = valor.trim().toLowerCase();
  return (aceitos as readonly string[]).includes(nivel) ? NIVEIS[nivel as NivelDoClaudeCode] : null;
}

// ---------------------------------------------------------------------------
// IDs de modelo
// ---------------------------------------------------------------------------

export interface IdDoModelo {
  /** Nome canônico (ex.: `claude-opus-5-5`), sem sufixo de data nem `[1m]`. */
  canonico: string;
  familia: string;
  versao: readonly number[];
}

/**
 * Lê um ID de modelo (`claude-opus-5-5`, `claude-sonnet-4-5-20250929`,
 * `claude-opus-4-6[1m]`, `claude-3-5-haiku-20241022`). Nulo se não for um ID
 * de modelo Claude reconhecível.
 */
export function lerIdDoModelo(id: string): IdDoModelo | null {
  const canonico = id
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, "")
    .replace(/-\d{8}$/, "");
  const familiaPrimeiro = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(canonico);
  if (familiaPrimeiro !== null) {
    return { canonico, familia: familiaPrimeiro[1] ?? "", versao: (familiaPrimeiro[2] ?? "").split("-").map(Number) };
  }
  const versaoPrimeiro = /^claude-(\d+(?:-\d+)*)-([a-z]+)$/.exec(canonico);
  if (versaoPrimeiro !== null) {
    return { canonico, familia: versaoPrimeiro[2] ?? "", versao: (versaoPrimeiro[1] ?? "").split("-").map(Number) };
  }
  return null;
}

export function compararVersoes(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diferenca = (a[i] ?? 0) - (b[i] ?? 0);
    if (diferenca !== 0) {
      return diferenca;
    }
  }
  return 0;
}

/** O `effortLevel` de topo do arquivo do usuário não vale para o Opus 5.5 e modelos posteriores. */
export function ignoraEsforcoDeTopoDoUsuario(modelo: IdDoModelo): boolean {
  const limite = VERSAO_QUE_IGNORA_O_TOPO_DO_USUARIO[modelo.familia];
  return limite !== undefined && compararVersoes(modelo.versao, limite) >= 0;
}

/**
 * Qual modelo o agente usa: o real, se conhecido; senão a versão mais alta da
 * família entre as chaves de `modelSettings` e o modelo para o qual o apelido
 * resolve hoje.
 */
export function modeloEfetivo(
  apelido: ModeloClaude,
  modeloReal: string | null,
  chavesDeModelSettings: readonly string[],
): IdDoModelo | null {
  const real = modeloReal === null ? null : lerIdDoModelo(modeloReal);
  if (real !== null) {
    return real;
  }
  const candidatos = [ID_PADRAO_DO_APELIDO[apelido], ...chavesDeModelSettings]
    .map(lerIdDoModelo)
    .filter((id): id is IdDoModelo => id !== null && id.familia === apelido);
  return candidatos.reduce<IdDoModelo | null>(
    (maior, id) => (maior === null || compararVersoes(id.versao, maior.versao) > 0 ? id : maior),
    null,
  );
}

// ---------------------------------------------------------------------------
// Resolução
// ---------------------------------------------------------------------------

export interface ArquivoDeConfiguracao {
  /** Rótulo legível, usado na `origem` (ex.: `~/.claude/settings.json`). */
  rotulo: string;
  doUsuario: boolean;
  /** Conteúdo já lido; nulo se ausente ou ilegível. */
  conteudo: Objeto | null;
}

export interface ResultadoDoEsforco {
  nivel: NivelHerdado;
  origem: string;
  modelo: string | null;
}

function nivelDaVariavel(valor: string | undefined, origem: string, modelo: string | null): ResultadoDoEsforco | "sem_nivel" | null {
  if (valor === undefined || valor.trim() === "") {
    return null;
  }
  if (SEM_NIVEL.includes(valor.trim().toLowerCase())) {
    return "sem_nivel";
  }
  const nivel = nivelDoClaudeCode(valor, NIVEIS_DA_VARIAVEL);
  return nivel === null ? null : { nivel, origem, modelo };
}

/**
 * Regra pura: dados o ambiente, os arquivos (do mais forte ao mais fraco) e o
 * modelo, qual esforço o Claude Code usa. Nulo se nada estiver definido.
 */
export function resolverEsforcoHerdado(
  ambiente: NodeJS.ProcessEnv,
  arquivos: readonly ArquivoDeConfiguracao[],
  apelido: ModeloClaude,
  modeloReal: string | null,
): ResultadoDoEsforco | null {
  const chaves = arquivos.flatMap((arquivo) =>
    arquivo.conteudo === null ? [] : Object.keys(objeto(arquivo.conteudo, "modelSettings")),
  );
  const modelo = modeloEfetivo(apelido, modeloReal, chaves);
  const idDoModelo = modelo?.canonico ?? null;

  // 1. Variável de ambiente (do processo; ou do bloco `env` de um arquivo, que o Claude Code exporta).
  const daVariavel = nivelDaVariavel(ambiente[VARIAVEL_DE_ESFORCO], `variável ${VARIAVEL_DE_ESFORCO}`, idDoModelo);
  if (daVariavel === "sem_nivel") {
    return null;
  }
  if (daVariavel !== null) {
    return daVariavel;
  }
  for (const arquivo of arquivos) {
    if (arquivo.conteudo === null) {
      continue;
    }
    const valor = texto(objeto(arquivo.conteudo, "env"), VARIAVEL_DE_ESFORCO);
    const doBlocoEnv = nivelDaVariavel(valor, `variável ${VARIAVEL_DE_ESFORCO} (env de ${arquivo.rotulo})`, idDoModelo);
    if (doBlocoEnv === "sem_nivel") {
      return null;
    }
    if (doBlocoEnv !== null) {
      return doBlocoEnv;
    }
  }

  // 2. Arquivos, do mais forte ao mais fraco.
  for (const arquivo of arquivos) {
    if (arquivo.conteudo === null) {
      continue;
    }
    if (modelo !== null) {
      const porModelo = objeto(arquivo.conteudo, "modelSettings");
      for (const [chave, entrada] of Object.entries(porModelo)) {
        if (lerIdDoModelo(chave)?.canonico !== modelo.canonico || !ehObjeto(entrada)) {
          continue;
        }
        const nivel = nivelDoClaudeCode(entrada["effortLevel"], NIVEIS_DOS_ARQUIVOS);
        if (nivel !== null) {
          return { nivel, origem: `${arquivo.rotulo} (modelSettings › ${chave})`, modelo: idDoModelo };
        }
      }
    }
    const deTopo = nivelDoClaudeCode(arquivo.conteudo["effortLevel"], NIVEIS_DOS_ARQUIVOS);
    // 3. O topo do usuário não vale para o Opus 5.5 e posteriores (modelo desconhecido: vale).
    const topoIgnorado = arquivo.doUsuario && modelo !== null && ignoraEsforcoDeTopoDoUsuario(modelo);
    if (deTopo !== null && !topoIgnorado) {
      return { nivel: deTopo, origem: arquivo.rotulo, modelo: idDoModelo };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Adaptador
// ---------------------------------------------------------------------------

export type LeitorDeArquivo = (caminho: string) => Promise<string>;

export interface OpcoesDasConfiguracoesDeEsforco {
  ambiente?: NodeJS.ProcessEnv;
  pastaPessoal?: string;
  lerArquivo?: LeitorDeArquivo;
}

/** `EsforcoDaMaquina` que lê o ambiente e os arquivos de configuração do Claude Code. */
export class ConfiguracoesDeEsforcoDoClaudeCode implements EsforcoDaMaquina {
  private readonly ambiente: NodeJS.ProcessEnv;
  private readonly pastaPessoal: string;
  private readonly lerArquivo: LeitorDeArquivo;

  constructor(opcoes: OpcoesDasConfiguracoesDeEsforco = {}) {
    this.ambiente = opcoes.ambiente ?? process.env;
    this.pastaPessoal = opcoes.pastaPessoal ?? homedir();
    this.lerArquivo = opcoes.lerArquivo ?? ((caminho) => readFile(caminho, "utf8"));
  }

  async herdadoPara(consulta: ConsultaDeEsforcoHerdado): Promise<EsforcoHerdado | null> {
    const configurada = this.ambiente["CLAUDE_CONFIG_DIR"];
    const pastaDoUsuario = pastaDoClaude(this.ambiente, this.pastaPessoal);
    const rotuloDoUsuario =
      configurada !== undefined && configurada.trim() !== ""
        ? path.join(pastaDoUsuario, "settings.json")
        : "~/.claude/settings.json";
    const arquivos = await Promise.all([
      this.ler(path.join(consulta.pastaDoProjeto, ".claude", "settings.local.json"), ".claude/settings.local.json do projeto", false),
      this.ler(path.join(consulta.pastaDoProjeto, ".claude", "settings.json"), ".claude/settings.json do projeto", false),
      this.ler(path.join(pastaDoUsuario, "settings.json"), rotuloDoUsuario, true),
    ]);
    const resultado = resolverEsforcoHerdado(this.ambiente, arquivos, consulta.modelo, consulta.modeloReal);
    return resultado === null ? null : EsforcoHerdado.criar(resultado);
  }

  /** Arquivo ausente, ilegível ou com JSON inválido é ignorado (o Claude Code também o pula). */
  private async ler(caminho: string, rotulo: string, doUsuario: boolean): Promise<ArquivoDeConfiguracao> {
    try {
      const conteudo: unknown = JSON.parse(await this.lerArquivo(caminho));
      return { rotulo, doUsuario, conteudo: ehObjeto(conteudo) ? conteudo : null };
    } catch {
      return { rotulo, doUsuario, conteudo: null };
    }
  }
}
