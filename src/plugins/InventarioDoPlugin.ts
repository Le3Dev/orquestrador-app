import { Dirent } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  ARQUIVO_DA_SKILL,
  cortar,
  ehObjeto,
  estaDentro,
  LIMITE_DE_SKILLS_POR_PASTA,
  LIMITE_DO_NOME,
  lerComeco,
  lerFrontmatter,
  Objeto,
  subpastas,
} from "../skills/LeitorDeSkills";

/** O que um plugin instalado traz, lido do disco. */
export interface InventarioDoPlugin {
  skills: { nome: string; descricao: string }[];
  subagentes: number;
  servidoresMcp: number;
  /** Comandos de hooks: os de `hooks.json`, os do `plugin.json` e os declarados no frontmatter de skills, agentes e comandos. */
  hooks: number;
  /**
   * `false` quando alguma leitura relevante falhou, foi truncada ou saiu da pasta
   * do plugin: o resultado não prova a ausência de hooks (falha fechada).
   */
  verificado: boolean;
  /** O plugin traz uma pasta `bin/`, que o Claude Code põe no PATH do Bash. */
  temBin: boolean;
}

/** O plugin precisa de confirmação antes de ligar: hooks, `bin/` ou inventário que não deu para provar. */
export function precisaDeConfirmacao(inventario: InventarioDoPlugin): boolean {
  return inventario.hooks > 0 || inventario.temBin || !inventario.verificado;
}

/** Os JSON do plugin (`.mcp.json`, `hooks.json`, `plugin.json`) são pequenos; acima disso não são lidos. */
const LIMITE_DE_BYTES_DO_JSON = 256 * 1024;
const LIMITE_DE_SUBAGENTES = 500;
const LIMITE_DE_ARQUIVOS_DO_FRONTMATTER = 500;

/** Acumula a dúvida: qualquer leitura que não provou o que há no disco marca o inventário como não verificado. */
interface Leitura {
  completa: boolean;
}

/** Inventário de quem não pôde ser lido: nada provado, então precisa de confirmação. */
export function inventarioVazio(): InventarioDoPlugin {
  return { skills: [], subagentes: 0, servidoresMcp: 0, hooks: 0, verificado: false, temBin: false };
}

function ausente(erro: unknown): boolean {
  const codigo = (erro as NodeJS.ErrnoException | null)?.code;
  return codigo === "ENOENT" || codigo === "ENOTDIR";
}

/**
 * Lê o inventário de um plugin instalado em `instalacao` (o `installPath` que o
 * Claude Code informa). Segurança: o caminho só vale dentro de
 * `<pastaDoClaude>/plugins`; links simbólicos que saem da pasta do plugin não são
 * seguidos; só o começo de cada SKILL.md é lido e o corpo nunca é devolvido.
 * Falha fechada: se uma leitura relevante para os hooks falhar (JSON grande,
 * inválido, link para fora, pasta ilegível, limite de arquivos), `verificado`
 * vira `false` em vez de contar como zero.
 */
export async function lerInventarioDoPlugin(pastaDoClaude: string, instalacao: string): Promise<InventarioDoPlugin> {
  let raiz: string;
  try {
    const raizDosPlugins = await realpath(path.join(pastaDoClaude, "plugins"));
    raiz = await realpath(instalacao);
    if (!estaDentro(raizDosPlugins, raiz)) {
      return inventarioVazio();
    }
  } catch {
    return inventarioVazio();
  }

  const leitura: Leitura = { completa: true };
  const manifesto = await lerJsonDentro(raiz, path.join(".claude-plugin", "plugin.json"), leitura);
  conferirCaminhosDoManifesto(manifesto, leitura);
  const skills = await lerSkills(raiz, leitura);
  const subagentes = await lerMarkdowns(raiz, "agents", leitura);
  const comandos = await lerMarkdowns(raiz, "commands", leitura);
  const servidoresMcp = await contarServidoresMcp(raiz, manifesto, leitura);
  const hooks = await contarHooks(raiz, manifesto, leitura);
  const temBin = await existeBin(raiz, leitura);
  return {
    skills: skills.skills,
    subagentes: subagentes.arquivos,
    servidoresMcp,
    hooks: hooks + skills.hooks + subagentes.hooks + comandos.hooks,
    verificado: leitura.completa,
    temBin,
  };
}

/** JSON de objeto dentro da pasta do plugin. Ausente é `null` sem dúvida; grande demais, fora da pasta, ilegível ou inválido é `null` com dúvida. */
async function lerJsonDentro(raiz: string, relativo: string, leitura: Leitura): Promise<Objeto | null> {
  try {
    const real = await realpath(path.join(raiz, relativo));
    if (!estaDentro(raiz, real)) {
      leitura.completa = false;
      return null;
    }
    const dados = await stat(real);
    if (!dados.isFile() || dados.size > LIMITE_DE_BYTES_DO_JSON) {
      leitura.completa = false;
      return null;
    }
    const conteudo: unknown = JSON.parse(await readFile(real, "utf8"));
    if (!ehObjeto(conteudo)) {
      leitura.completa = false;
      return null;
    }
    return conteudo;
  } catch (erro) {
    if (!ausente(erro)) {
      leitura.completa = false;
    }
    return null;
  }
}

/** A pasta `bin/` do plugin entra no PATH do Bash quando ele está ligado. */
async function existeBin(raiz: string, leitura: Leitura): Promise<boolean> {
  try {
    await lstat(path.join(raiz, "bin"));
    return true;
  } catch (erro) {
    if (!ausente(erro)) {
      leitura.completa = false;
    }
    return false;
  }
}

/**
 * O manifesto pode apontar `skills`, `agents` e `commands` para outros lugares. O
 * inventário só olha as pastas padrão; um caminho fora delas não foi lido, então
 * não há prova.
 */
function conferirCaminhosDoManifesto(manifesto: Objeto | null, leitura: Leitura): void {
  if (manifesto === null) {
    return;
  }
  for (const pasta of ["skills", "agents", "commands"]) {
    const declarado = manifesto[pasta];
    if (declarado === undefined) {
      continue;
    }
    const itens = Array.isArray(declarado) ? (declarado as unknown[]) : [declarado];
    for (const item of itens) {
      const normalizado = typeof item === "string" ? path.normalize(item) : "";
      if (normalizado !== pasta && !normalizado.startsWith(`${pasta}${path.sep}`)) {
        leitura.completa = false;
      }
    }
  }
}

/**
 * O frontmatter de uma skill, agente ou comando. Um `hooks:` ali roda comandos
 * como os de `hooks.json`. Arquivo ilegível ou frontmatter que não fecha dentro do
 * trecho lido (truncado ou malformado) deixa a dúvida.
 */
async function lerCabecalho(caminho: string, leitura: Leitura): Promise<Record<string, string> | null> {
  try {
    const conteudo = await lerComeco(caminho);
    const linhas = conteudo.replace(/^\uFEFF/, "").split(/\r?\n/);
    if (linhas[0]?.trim() === "---" && !linhas.slice(1).some((linha) => linha.trim() === "---")) {
      leitura.completa = false;
      return null;
    }
    return lerFrontmatter(conteudo);
  } catch {
    leitura.completa = false;
    return null;
  }
}

function declaraHooks(campos: Record<string, string> | null): boolean {
  return campos !== null && Object.prototype.hasOwnProperty.call(campos, "hooks");
}

type TipoDaPasta = "ausente" | "pasta" | "outro";

async function tipoDaPasta(caminho: string, leitura: Leitura): Promise<TipoDaPasta> {
  try {
    return (await lstat(caminho)).isDirectory() ? "pasta" : "outro";
  } catch (erro) {
    if (!ausente(erro)) {
      leitura.completa = false;
    }
    return "ausente";
  }
}

async function lerSkills(raiz: string, leitura: Leitura): Promise<{ skills: InventarioDoPlugin["skills"]; hooks: number }> {
  const pasta = path.join(raiz, "skills");
  const tipo = await tipoDaPasta(pasta, leitura);
  if (tipo !== "pasta") {
    if (tipo === "outro") {
      // Um link (ou arquivo) no lugar da pasta: não foi lida.
      leitura.completa = false;
    }
    return { skills: [], hooks: 0 };
  }
  let pastaReal: string;
  try {
    pastaReal = await realpath(pasta);
  } catch {
    leitura.completa = false;
    return { skills: [], hooks: 0 };
  }
  const todas = await subpastas(pasta);
  if (todas.length > LIMITE_DE_SKILLS_POR_PASTA) {
    leitura.completa = false;
  }
  const lidas: { nome: string; descricao: string }[] = [];
  let hooks = 0;
  for (const nome of todas.slice(0, LIMITE_DE_SKILLS_POR_PASTA)) {
    try {
      const real = await realpath(path.join(pasta, nome, ARQUIVO_DA_SKILL));
      if (!estaDentro(pastaReal, real)) {
        leitura.completa = false;
        continue;
      }
      const campos = await lerCabecalho(real, leitura);
      if (campos === null) {
        continue;
      }
      if (declaraHooks(campos)) {
        hooks += 1;
      }
      const declarado = (campos["name"] ?? "").trim();
      lidas.push({
        nome: declarado !== "" && declarado.length <= LIMITE_DO_NOME ? declarado : nome,
        descricao: cortar(campos["description"] ?? ""),
      });
    } catch (erro) {
      // Pasta sem SKILL.md não é skill; qualquer outro erro deixa a dúvida.
      if (!ausente(erro)) {
        leitura.completa = false;
      }
    }
  }
  return { skills: lidas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), hooks };
}

/** Os `.md` de uma pasta do plugin (`agents`, `commands`): quantos são e quantos declaram `hooks:` no frontmatter. */
async function lerMarkdowns(raiz: string, nomeDaPasta: string, leitura: Leitura): Promise<{ arquivos: number; hooks: number }> {
  const pasta = path.join(raiz, nomeDaPasta);
  const tipo = await tipoDaPasta(pasta, leitura);
  if (tipo !== "pasta") {
    if (tipo === "outro") {
      leitura.completa = false;
    }
    return { arquivos: 0, hooks: 0 };
  }
  let entradas: Dirent[];
  try {
    entradas = await readdir(pasta, { withFileTypes: true });
  } catch {
    leitura.completa = false;
    return { arquivos: 0, hooks: 0 };
  }
  const markdowns = entradas.filter((entrada) => entrada.name.endsWith(".md"));
  if (markdowns.length > Math.min(LIMITE_DE_SUBAGENTES, LIMITE_DE_ARQUIVOS_DO_FRONTMATTER)) {
    leitura.completa = false;
  }
  let arquivos = 0;
  let hooks = 0;
  for (const entrada of markdowns.slice(0, LIMITE_DE_SUBAGENTES)) {
    if (!entrada.isFile()) {
      // Link simbólico ou pasta com nome de .md: não foi lido.
      leitura.completa = false;
      continue;
    }
    arquivos += 1;
    if (declaraHooks(await lerCabecalho(path.join(pasta, entrada.name), leitura))) {
      hooks += 1;
    }
  }
  return { arquivos, hooks };
}

/**
 * Os campos `mcpServers` e `hooks` do `plugin.json` podem ser o conteúdo em si,
 * o caminho de um JSON dentro do plugin ou uma lista de um e de outro.
 * `jaLido` é o arquivo que o Claude Code carrega sozinho e que já foi contado.
 * Item que não deu para resolver (caminho ausente, fora da pasta, formato
 * estranho ou lista longa demais) deixa a dúvida.
 */
async function resolverCampo(raiz: string, campo: unknown, jaLido: string, leitura: Leitura): Promise<Objeto[]> {
  const itens = Array.isArray(campo) ? (campo as unknown[]) : [campo];
  if (itens.length > 20) {
    leitura.completa = false;
  }
  const objetos: Objeto[] = [];
  for (const item of itens.slice(0, 20)) {
    if (ehObjeto(item)) {
      objetos.push(item);
    } else if (typeof item === "string" && item.trim() !== "") {
      if (path.normalize(item) === jaLido) {
        continue;
      }
      const lido = await lerJsonDentro(raiz, item, leitura);
      if (lido !== null) {
        objetos.push(lido);
      } else {
        leitura.completa = false;
      }
    } else {
      leitura.completa = false;
    }
  }
  return objetos;
}

/** `.mcp.json` vem como `{ mcpServers: {...} }` ou direto como `{ <servidor>: {...} }`. */
function nomesDosServidores(conteudo: Objeto): string[] {
  const servidores = ehObjeto(conteudo["mcpServers"]) ? conteudo["mcpServers"] : conteudo;
  return Object.entries(servidores)
    .filter(([, definicao]) => ehObjeto(definicao))
    .map(([nome]) => nome);
}

async function contarServidoresMcp(raiz: string, manifesto: Objeto | null, leitura: Leitura): Promise<number> {
  const nomes = new Set<string>();
  const arquivo = await lerJsonDentro(raiz, ".mcp.json", leitura);
  if (arquivo !== null) {
    nomesDosServidores(arquivo).forEach((nome) => nomes.add(nome));
  }
  if (manifesto !== null && manifesto["mcpServers"] !== undefined) {
    for (const definicao of await resolverCampo(raiz, manifesto["mcpServers"], ".mcp.json", leitura)) {
      nomesDosServidores(definicao).forEach((nome) => nomes.add(nome));
    }
  }
  return nomes.size;
}

/**
 * Hooks: `{ hooks: { <Evento>: [{ matcher?, hooks: [{ type, command }] }] } }`.
 * Conta cada comando declarado (um grupo sem lista `hooks` conta como um). Formato
 * que não bate com o esperado, mas não está vazio, conta como um: na dúvida, há hook.
 */
function hooksDe(conteudo: Objeto): number {
  const eventos = ehObjeto(conteudo["hooks"]) ? conteudo["hooks"] : conteudo;
  let total = 0;
  for (const grupos of Object.values(eventos)) {
    if (!Array.isArray(grupos)) {
      if (grupos !== null && grupos !== undefined && grupos !== false && grupos !== "" && !(ehObjeto(grupos) && Object.keys(grupos).length === 0)) {
        total += 1;
      }
      continue;
    }
    for (const grupo of grupos as unknown[]) {
      if (!ehObjeto(grupo)) {
        total += 1;
        continue;
      }
      total += Array.isArray(grupo["hooks"]) ? (grupo["hooks"] as unknown[]).length : 1;
    }
  }
  return total;
}

async function contarHooks(raiz: string, manifesto: Objeto | null, leitura: Leitura): Promise<number> {
  const arquivo = await lerJsonDentro(raiz, path.join("hooks", "hooks.json"), leitura);
  let total = arquivo === null ? 0 : hooksDe(arquivo);
  if (manifesto !== null && manifesto["hooks"] !== undefined) {
    for (const definicao of await resolverCampo(raiz, manifesto["hooks"], path.join("hooks", "hooks.json"), leitura)) {
      total += hooksDe(definicao);
    }
  }
  return total;
}
