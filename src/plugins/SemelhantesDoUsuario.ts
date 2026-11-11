import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  ARQUIVO_DA_SKILL,
  ehObjeto,
  ehPastaReal,
  estaDentro,
  LIMITE_DE_SKILLS_POR_PASTA,
  LIMITE_DO_NOME,
  subpastas,
} from "../skills/LeitorDeSkills";

/** Nomes que o usuário já tem fora de plugins: skills avulsas e servidores MCP, só os nomes. */
export interface NomesDoUsuario {
  skills: string[];
  servidoresMcp: string[];
}

/** O que o catálogo mostra num plugin: o que o usuário já tem com nome parecido. */
export type JaTemDoPlugin = NomesDoUsuario;

/** Lê os nomes do usuário; injetado para os testes. Nunca lança. */
export type LeitorDeNomesDoUsuario = () => Promise<NomesDoUsuario>;

export interface OpcoesDoLeitorDeNomes {
  /** Pasta de configuração do Claude Code (`~/.claude`). */
  pastaDoClaude: string;
  /** `~/.claude.json` (ou `<CLAUDE_CONFIG_DIR>/.claude.json`): de lá só saem as chaves de `mcpServers`. */
  arquivoDeConfiguracao: string;
}

/** O de verdade tem uns 100 KB; acima disto o arquivo é ignorado em vez de lido. */
const LIMITE_DO_ARQUIVO_EM_BYTES = 5 * 1024 * 1024;
const LIMITE_DE_SERVIDORES = 500;
const TAMANHO_MINIMO_DO_NOME = 3;
const PASTA_DAS_SKILLS_SINCRONIZADAS = "synced";

/**
 * Onde o Claude Code guarda `.claude.json`: dentro de `CLAUDE_CONFIG_DIR` quando
 * a variável existe; senão, ao lado da pasta `.claude`, na pasta pessoal.
 */
export function arquivoDeConfiguracaoDoClaude(
  ambiente: NodeJS.ProcessEnv = process.env,
  pastaPessoal: string = homedir(),
): string {
  const configurada = ambiente["CLAUDE_CONFIG_DIR"];
  return configurada !== undefined && configurada.trim() !== ""
    ? path.join(configurada, ".claude.json")
    : path.join(pastaPessoal, ".claude.json");
}

/**
 * Minúsculas, `_` como `-`, sem o prefixo `mcp-` e sem os sufixos `-mcp`,
 * `-skill` e `-plugin`: `Context7_MCP` e `context7` viram `context7`.
 */
export function normalizarNomeParaComparar(nome: string): string {
  let atual = nome.trim().toLowerCase().replace(/_/g, "-");
  for (;;) {
    const proximo = atual.replace(/^mcp-/, "").replace(/-(mcp|skill|plugin)$/, "");
    if (proximo === atual) {
      return atual;
    }
    atual = proximo;
  }
}

/** Nomes (já com o original) cuja forma normalizada é igual à do plugin; formas com menos de 3 caracteres não comparam. */
function parecidos(nomeDoPlugin: string, nomes: readonly string[]): string[] {
  const alvo = normalizarNomeParaComparar(nomeDoPlugin);
  if (alvo.length < TAMANHO_MINIMO_DO_NOME) {
    return [];
  }
  return nomes.filter((nome) => normalizarNomeParaComparar(nome) === alvo);
}

/** O que o usuário já tem de parecido com o plugin `nome` (a parte do id antes do `@`). */
export function semelhantesAoPlugin(nome: string, usuario: NomesDoUsuario): JaTemDoPlugin {
  return {
    skills: parecidos(nome, usuario.skills),
    servidoresMcp: parecidos(nome, usuario.servidoresMcp),
  };
}

/** As pastas de skills avulsas do usuário que têm `SKILL.md`; `synced` e links que saem da pasta ficam fora. */
async function skillsAvulsas(pastaDoClaude: string): Promise<string[]> {
  const raiz = path.join(pastaDoClaude, "skills");
  if (!(await ehPastaReal(raiz))) {
    return [];
  }
  let raizReal: string;
  try {
    raizReal = await realpath(raiz);
  } catch {
    return [];
  }
  const candidatas = (await subpastas(raiz))
    .filter((nome) => nome !== PASTA_DAS_SKILLS_SINCRONIZADAS && nome.length <= LIMITE_DO_NOME)
    .slice(0, LIMITE_DE_SKILLS_POR_PASTA);
  const lidas = await Promise.all(
    candidatas.map(async (nome) => {
      try {
        const real = await realpath(path.join(raiz, nome, ARQUIVO_DA_SKILL));
        return estaDentro(raizReal, real) ? nome : null;
      } catch {
        return null;
      }
    }),
  );
  return lidas.filter((nome): nome is string => nome !== null);
}

/**
 * Só as chaves de `mcpServers` do nível de cima. Os valores (comando, URL,
 * variáveis, tokens) são descartados na hora e nunca saem daqui. Arquivo
 * ausente, grande demais ou inválido: lista vazia.
 */
async function servidoresMcp(arquivo: string): Promise<string[]> {
  let conteudo: string;
  try {
    const aberto = await open(arquivo, "r");
    try {
      const estado = await aberto.stat();
      if (!estado.isFile() || estado.size > LIMITE_DO_ARQUIVO_EM_BYTES) {
        return [];
      }
      conteudo = await aberto.readFile("utf8");
    } finally {
      await aberto.close();
    }
  } catch {
    return [];
  }
  try {
    const lido: unknown = JSON.parse(conteudo);
    const servidores = ehObjeto(lido) ? lido["mcpServers"] : undefined;
    return ehObjeto(servidores)
      ? Object.keys(servidores)
          .filter((nome) => nome.length <= LIMITE_DO_NOME)
          .slice(0, LIMITE_DE_SERVIDORES)
      : [];
  } catch {
    return [];
  }
}

/**
 * Lê, a cada chamada, os nomes das skills avulsas (`<claude>/skills/<nome>/SKILL.md`)
 * e dos servidores MCP do usuário. Sem cache de propósito: são uma listagem de
 * pasta e um JSON de uns 100 KB, baratos perto do `claude plugin list`, e assim
 * uma skill ou um servidor recém instalado aparece na hora.
 *
 * É só uma dica para a tela, então nunca lança: qualquer falha vira lista vazia.
 */
export function criarLeitorDeNomesDoUsuario(opcoes: OpcoesDoLeitorDeNomes): LeitorDeNomesDoUsuario {
  return async () => {
    try {
      const [skills, servidores] = await Promise.all([
        skillsAvulsas(opcoes.pastaDoClaude),
        servidoresMcp(opcoes.arquivoDeConfiguracao),
      ]);
      return { skills: skills.sort(), servidoresMcp: servidores.sort() };
    } catch {
      return { skills: [], servidoresMcp: [] };
    }
  };
}
