import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export type OrigemDaSkill = "usuario" | "projeto" | "plugin";

/** O que a tela mostra de uma skill: nunca o corpo nem caminhos. */
export interface SkillCadastrada {
  /** `<plugin>:<skill>` nas de plugin; o nome da skill nas outras. */
  nome: string;
  descricao: string;
  origem: OrigemDaSkill;
  plugin: string | null;
}

export interface OpcoesDoLeitorDeSkills {
  /** Pasta de configuração do Claude Code (`~/.claude`); injetada para os testes. */
  pastaDoClaude: string;
}

/** Só o começo do arquivo é lido: o frontmatter fica no topo. */
const LIMITE_DE_BYTES_POR_ARQUIVO = 64 * 1024;
const LIMITE_DA_DESCRICAO = 500;
export const LIMITE_DO_NOME = 100;
/** Teto de skills por pasta, para uma pasta enorme não pesar na consulta. */
export const LIMITE_DE_SKILLS_POR_PASTA = 300;
export const ARQUIVO_DA_SKILL = "SKILL.md";

/** Plugin com o qual o Claude Code nomeia as skills sincronizadas da conta (`anthropic-skills:docx`). */
const PLUGIN_DAS_SKILLS_SINCRONIZADAS = "anthropic-skills";
const PASTA_DAS_SKILLS_SINCRONIZADAS = "synced";

const ORDEM_DAS_ORIGENS: Readonly<Record<OrigemDaSkill, number>> = { usuario: 0, projeto: 1, plugin: 2 };

export type Objeto = Record<string, unknown>;

export function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** `alvo` está dentro de `raiz` (e não é a própria raiz). */
export function estaDentro(raiz: string, alvo: string): boolean {
  const relativo = path.relative(raiz, alvo);
  return relativo !== "" && !relativo.startsWith("..") && !path.isAbsolute(relativo);
}

/** A pasta existe e não é um link simbólico (as raízes fixas nunca são links). */
export async function ehPastaReal(caminho: string): Promise<boolean> {
  try {
    return (await lstat(caminho)).isDirectory();
  } catch {
    return false;
  }
}

export async function subpastas(raiz: string): Promise<string[]> {
  try {
    const entradas = await readdir(raiz, { withFileTypes: true });
    return entradas
      .filter((entrada) => !entrada.name.startsWith(".") && (entrada.isDirectory() || entrada.isSymbolicLink()))
      .map((entrada) => entrada.name)
      .sort();
  } catch {
    return [];
  }
}

export async function lerComeco(caminho: string): Promise<string> {
  const arquivo = await open(caminho, "r");
  try {
    const buffer = Buffer.alloc(LIMITE_DE_BYTES_POR_ARQUIVO);
    const { bytesRead } = await arquivo.read(buffer, 0, LIMITE_DE_BYTES_POR_ARQUIVO, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await arquivo.close();
  }
}

function tirarAspas(valor: string): string {
  if (valor.length >= 2 && valor.startsWith('"') && valor.endsWith('"')) {
    return valor.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (valor.length >= 2 && valor.startsWith("'") && valor.endsWith("'")) {
    return valor.slice(1, -1).replace(/''/g, "'");
  }
  return valor.replace(/\s+#.*$/, "");
}

/**
 * Os campos de texto simples do frontmatter YAML (`chave: valor`), sem
 * dependência de YAML: valores entre aspas, em várias linhas (continuação
 * indentada) e em bloco (`>` e `|`, com ou sem `-`/`+`) viram uma linha só.
 * Sem frontmatter, nenhum campo.
 */
export function lerFrontmatter(conteudo: string): Record<string, string> {
  const linhas = conteudo.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (linhas[0]?.trim() !== "---") {
    return {};
  }
  const campos: Record<string, string> = {};
  let chave: string | null = null;
  let partes: string[] = [];
  let emBloco = false;

  const fechar = (): void => {
    if (chave === null) {
      return;
    }
    const junto = partes.join(" ").replace(/\s+/g, " ").trim();
    campos[chave] = emBloco ? junto : tirarAspas(junto);
    chave = null;
    partes = [];
    emBloco = false;
  };

  for (const linha of linhas.slice(1)) {
    if (linha.trim() === "---") {
      break;
    }
    const campo = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(linha);
    if (campo !== null) {
      fechar();
      chave = campo[1] ?? "";
      const inicio = (campo[2] ?? "").trim();
      emBloco = /^[>|][+-]?\d*$/.test(inicio);
      partes = emBloco ? [] : [inicio];
      continue;
    }
    if (chave !== null && (linha.trim() === "" || /^\s/.test(linha))) {
      partes.push(linha.trim());
    }
  }
  fechar();
  return campos;
}

export function cortar(descricao: string): string {
  return descricao.length > LIMITE_DA_DESCRICAO ? `${descricao.slice(0, LIMITE_DA_DESCRICAO - 1).trimEnd()}…` : descricao;
}

/** Desde onde as skills são lidas e como aparecem na lista. */
interface PastaDeSkills {
  /** `<raiz>/<skill>/SKILL.md`. */
  raiz: string;
  origem: OrigemDaSkill;
  plugin: string | null;
}

/**
 * Lê as skills cadastradas no Claude Code, só nos caminhos fixos onde ele as
 * procura: do usuário (`<claude>/skills`), do projeto (`<projeto>/.claude/skills`),
 * dos plugins instalados e habilitados (`installed_plugins.json` e
 * `enabledPlugins` das configurações) e as sincronizadas da conta
 * (`<claude>/skills/synced` e `<claude>/plugins/synced`). As embutidas no
 * Claude Code (`debug`, `simplify`...) ficam fora.
 *
 * Segurança: nenhum caminho vem de fora do disco do usuário; links simbólicos
 * que saem da pasta da skill são ignorados; só o começo de cada arquivo é lido
 * e só nome, descrição, origem e plugin são devolvidos, nunca o corpo.
 * Qualquer erro de leitura de uma skill a pula.
 */
export class LeitorDeSkills {
  private readonly pastaDoClaude: string;

  constructor(opcoes: OpcoesDoLeitorDeSkills) {
    this.pastaDoClaude = opcoes.pastaDoClaude;
  }

  /** As skills do usuário e dos plugins e, com `pastaDoProjeto`, as do projeto. Ordem: origem e nome. */
  async listar(pastaDoProjeto: string | null): Promise<SkillCadastrada[]> {
    const pastas: PastaDeSkills[] = [
      { raiz: path.join(this.pastaDoClaude, "skills"), origem: "usuario", plugin: null },
      ...(pastaDoProjeto === null
        ? []
        : [{ raiz: path.join(pastaDoProjeto, ".claude", "skills"), origem: "projeto" as const, plugin: null }]),
      ...(await this.pastasDosPlugins(pastaDoProjeto)),
      ...(await this.pastasSincronizadas()),
    ];
    const listas = await Promise.all(pastas.map((pasta) => this.lerPasta(pasta)));
    return listas
      .flat()
      .sort(
        (a, b) =>
          ORDEM_DAS_ORIGENS[a.origem] - ORDEM_DAS_ORIGENS[b.origem] || a.nome.localeCompare(b.nome, "pt-BR"),
      );
  }

  private async lerPasta(pasta: PastaDeSkills): Promise<SkillCadastrada[]> {
    if (!(await ehPastaReal(pasta.raiz))) {
      return [];
    }
    let raizReal: string;
    try {
      raizReal = await realpath(pasta.raiz);
    } catch {
      return [];
    }
    const nomes = (await subpastas(pasta.raiz)).filter(
      // `synced` é uma pasta de buckets, lida à parte (`pastasSincronizadas`).
      (nome) => !(pasta.origem === "usuario" && nome === PASTA_DAS_SKILLS_SINCRONIZADAS),
    );
    const lidas = await Promise.all(
      nomes.slice(0, LIMITE_DE_SKILLS_POR_PASTA).map((nome) => this.lerSkill(pasta, raizReal, nome)),
    );
    return lidas.filter((skill): skill is SkillCadastrada => skill !== null);
  }

  private async lerSkill(pasta: PastaDeSkills, raizReal: string, pastaDaSkill: string): Promise<SkillCadastrada | null> {
    try {
      const real = await realpath(path.join(pasta.raiz, pastaDaSkill, ARQUIVO_DA_SKILL));
      if (!estaDentro(raizReal, real)) {
        return null;
      }
      const conteudo = await lerComeco(real);
      const campos = lerFrontmatter(conteudo);
      const declarado = (campos["name"] ?? "").trim();
      const nome = declarado !== "" && declarado.length <= LIMITE_DO_NOME ? declarado : pastaDaSkill;
      return {
        nome: pasta.plugin === null ? nome : `${pasta.plugin}:${nome}`,
        descricao: cortar(campos["description"] ?? ""),
        origem: pasta.origem,
        plugin: pasta.plugin,
      };
    } catch {
      return null;
    }
  }

  /**
   * Plugins instalados (`plugins/installed_plugins.json`: `{ version, plugins:
   * { "<plugin>@<marketplace>": [{ scope, projectPath?, installPath, ... }] } }`)
   * e habilitados: o Claude Code só carrega os que estão `true` em
   * `enabledPlugins` das configurações do usuário, do projeto ou local.
   */
  private async pastasDosPlugins(pastaDoProjeto: string | null): Promise<PastaDeSkills[]> {
    const instalados = await this.lerJson(path.join(this.pastaDoClaude, "plugins", "installed_plugins.json"));
    const registro = instalados !== null && ehObjeto(instalados["plugins"]) ? instalados["plugins"] : {};
    const habilitados = await this.pluginsHabilitados(pastaDoProjeto);
    const raizDosPlugins = path.join(this.pastaDoClaude, "plugins");
    let raizReal: string;
    try {
      raizReal = await realpath(raizDosPlugins);
    } catch {
      return [];
    }

    const pastas: PastaDeSkills[] = [];
    for (const [chave, entradas] of Object.entries(registro)) {
      if (habilitados[chave] !== true) {
        continue;
      }
      const plugin = chave.split("@")[0] ?? "";
      const instalacao = (Array.isArray(entradas) ? entradas : [entradas])
        .filter(ehObjeto)
        .find((entrada) => typeof entrada["installPath"] === "string");
      if (plugin === "" || instalacao === undefined) {
        continue;
      }
      try {
        const instalada = await realpath(String(instalacao["installPath"]));
        // O caminho vem do JSON: só vale o que está na pasta de plugins do Claude Code.
        if (estaDentro(raizReal, instalada)) {
          pastas.push({ raiz: path.join(instalada, "skills"), origem: "plugin", plugin });
        }
      } catch {
        continue;
      }
    }
    return pastas;
  }

  private async pluginsHabilitados(pastaDoProjeto: string | null): Promise<Record<string, unknown>> {
    const arquivos = [
      path.join(this.pastaDoClaude, "settings.json"),
      ...(pastaDoProjeto === null
        ? []
        : [
            path.join(pastaDoProjeto, ".claude", "settings.json"),
            path.join(pastaDoProjeto, ".claude", "settings.local.json"),
          ]),
    ];
    const habilitados: Record<string, unknown> = {};
    for (const arquivo of arquivos) {
      const configuracao = await this.lerJson(arquivo);
      if (configuracao !== null && ehObjeto(configuracao["enabledPlugins"])) {
        Object.assign(habilitados, configuracao["enabledPlugins"]);
      }
    }
    return habilitados;
  }

  /**
   * As skills e os plugins que a conta do claude.ai sincroniza:
   * `skills/synced/<bucket>/<skill>` aparecem como `anthropic-skills:<skill>` e
   * `plugins/synced/<bucket>/<plugin>[~g3]/skills/<skill>` como `<plugin>:<skill>`.
   */
  private async pastasSincronizadas(): Promise<PastaDeSkills[]> {
    const pastas: PastaDeSkills[] = [];
    const dasSkills = path.join(this.pastaDoClaude, "skills", PASTA_DAS_SKILLS_SINCRONIZADAS);
    if (await ehPastaReal(dasSkills)) {
      for (const bucket of await subpastas(dasSkills)) {
        pastas.push({ raiz: path.join(dasSkills, bucket), origem: "plugin", plugin: PLUGIN_DAS_SKILLS_SINCRONIZADAS });
      }
    }
    const dosPlugins = path.join(this.pastaDoClaude, "plugins", PASTA_DAS_SKILLS_SINCRONIZADAS);
    if (await ehPastaReal(dosPlugins)) {
      for (const bucket of await subpastas(dosPlugins)) {
        for (const pasta of await subpastas(path.join(dosPlugins, bucket))) {
          const plugin = pasta.split("~")[0] ?? "";
          if (plugin !== "") {
            pastas.push({ raiz: path.join(dosPlugins, bucket, pasta, "skills"), origem: "plugin", plugin });
          }
        }
      }
    }
    return pastas;
  }

  /** JSON de objeto; ausente, ilegível ou inválido vira `null`. */
  private async lerJson(caminho: string): Promise<Objeto | null> {
    try {
      const conteudo: unknown = JSON.parse(await readFile(caminho, "utf8"));
      return ehObjeto(conteudo) ? conteudo : null;
    } catch {
      return null;
    }
  }
}
