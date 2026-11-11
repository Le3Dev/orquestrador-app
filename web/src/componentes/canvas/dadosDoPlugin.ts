import type { InventarioDoPlugin } from "../../shared/api/tipos";

/** "frontend-design" vira "FD"; um nome de uma palavra só usa as duas primeiras letras. */
export function iniciaisDe(nome: string): string {
  const partes = nome.split(/[-_ :]/).filter((parte) => parte !== "");
  const primeira = partes[0];
  const segunda = partes[1];
  if (primeira !== undefined && segunda !== undefined) {
    return `${primeira.charAt(0)}${segunda.charAt(0)}`.toUpperCase();
  }
  return nome.slice(0, 2).toUpperCase();
}

/** Um link para o código do plugin e o texto dele ("Ver no GitHub" só quando é mesmo do GitHub). */
export interface LinkDaFonte {
  url: string;
  rotulo: string;
}

/**
 * O endereço do código de um plugin, a partir da fonte que o catálogo informa: uma URL, "github.com/dono/repo"
 * ou "dono/repo". Qualquer outra coisa (um caminho local, por exemplo) não vira link.
 */
export function linkDaFonte(fonte: string | null): LinkDaFonte | null {
  const texto = fonte?.trim() ?? "";
  if (texto === "") {
    return null;
  }
  let url: string | null = null;
  if (/^https?:\/\//i.test(texto)) {
    url = texto;
  } else if (/^github\.com\//i.test(texto)) {
    url = `https://${texto}`;
  } else if (/^[\w.-]+\/[\w.-]+$/.test(texto)) {
    url = `https://github.com/${texto}`;
  }
  if (url === null) {
    return null;
  }
  const noGitHub = /^https?:\/\/(www\.)?github\.com\//i.test(url);
  return { url, rotulo: noGitHub ? "Ver no GitHub" : "Ver o código" };
}

/** "3 skills", "1 subagente": o singular quando for 1. */
export function contar(total: number, singular: string, plural: string): string {
  return `${total.toLocaleString("pt-BR")} ${total === 1 ? singular : plural}`;
}

/** O plugin espera o ok do usuário antes de ligar: hooks, pasta `bin/` ou inventário que não deu para provar. Igual ao do servidor. */
export function precisaDeConfirmacao(inventario: InventarioDoPlugin): boolean {
  return inventario.hooks > 0 || inventario.temBin || !inventario.verificado;
}

/** Um dos motivos para pedir o ok: o que vale para o plugin, em linguagem de gente, e o porquê em uma frase. */
export interface MotivoDeConfirmacao {
  chave: "hooks" | "bin" | "naoVerificado";
  titulo: string;
  explicacao: string;
}

/** Os motivos que valem para este plugin (vazio quando ele liga direto). */
export function motivosDeConfirmacao(inventario: InventarioDoPlugin): MotivoDeConfirmacao[] {
  const motivos: MotivoDeConfirmacao[] = [];
  if (inventario.hooks > 0) {
    motivos.push({
      chave: "hooks",
      titulo: `Roda comandos sozinho ao abrir sessões (${contar(inventario.hooks, "hook", "hooks")})`,
      explicacao: "Eles disparam em toda sessão do Claude Code, no app e no seu terminal, sem pedir licença a cada vez.",
    });
  }
  if (inventario.temBin) {
    motivos.push({
      chave: "bin",
      titulo: "Traz programas próprios que o terminal dos agentes pode chamar (pasta bin)",
      explicacao: "Eles ficam ao alcance do terminal enquanto o plugin estiver ligado.",
    });
  }
  if (!inventario.verificado) {
    motivos.push({
      chave: "naoVerificado",
      titulo: "Não conseguimos ler tudo o que vem nele",
      explicacao: "Por isso a contagem pode estar incompleta e pode haver algo que não aparece aqui.",
    });
  }
  return motivos;
}

/** Minúsculas e sem acento, para a busca achar "revisao" em "Revisão". */
export function normalizarParaBusca(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * O nome de uma skill sem o prefixo do plugin: "anthropic-skills:docx" vira "docx". Só tira o prefixo quando ele
 * é mesmo o plugin da skill (um nome declarado pode ter ":" no meio); skill do usuário ou do projeto fica como está.
 */
export function nomeAmigavel(skill: { nome: string; plugin: string | null }): string {
  if (skill.plugin !== null && skill.nome.startsWith(`${skill.plugin}:`) && skill.nome.length > skill.plugin.length + 1) {
    return skill.nome.slice(skill.plugin.length + 1);
  }
  return skill.nome;
}

/** Aberturas de descrição escritas para o modelo, que não dizem nada na lista. */
const ABERTURAS_DA_DESCRICAO = [/^Use this skill whenever the user wants to /i, /^Use this skill when the user wants /i];

/** O mais que a linha curta de uma skill guarda; o resto cairia nas reticências da própria linha. */
const LIMITE_DA_LINHA_CURTA = 170;

/**
 * A descrição de uma skill reduzida a uma linha: sem a abertura de boilerplate em inglês, sem o "nome (" do
 * começo e só até a primeira frase. É uma heurística: se nada casa, devolve a descrição original (achatada),
 * e o texto inteiro continua a um clique. Não traduz.
 */
export function linhaCurta(nome: string, descricao: string): string {
  const original = descricao.replace(/\s+/g, " ").trim();
  let texto = original;
  const abertura = ABERTURAS_DA_DESCRICAO.find((regra) => regra.test(texto));
  if (abertura !== undefined) {
    texto = texto.replace(abertura, "");
  } else if (texto.toLowerCase().startsWith(`${nome.toLowerCase()} (`)) {
    texto = texto.slice(nome.length + 2);
  }
  const fimDaFrase = texto.search(/[.!?](\s|$)/);
  if (fimDaFrase > 20 && fimDaFrase < 200) {
    texto = texto.slice(0, fimDaFrase + 1);
  }
  if (texto === "") {
    return original.slice(0, LIMITE_DA_LINHA_CURTA);
  }
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`.slice(0, LIMITE_DA_LINHA_CURTA);
}

/** Um texto partido em volta da palavra que a busca achou. */
export interface TrechoAchado {
  antes: string;
  achado: string;
  depois: string;
}

/**
 * Onde o termo aparece no texto (sem ligar para acento nem caixa). Com `margem`, o que vem antes do achado é
 * cortado para essa quantidade de caracteres, com reticências, para o achado caber na linha. Nulo se não achar,
 * ou se a normalização mudar o tamanho do texto (aí os índices não valem e o texto segue sem destaque).
 */
export function acharNoTexto(texto: string, termo: string, margem = Number.POSITIVE_INFINITY): TrechoAchado | null {
  const alvo = normalizarParaBusca(termo.trim());
  if (alvo === "") {
    return null;
  }
  const base = normalizarParaBusca(texto);
  if (base.length !== texto.length) {
    return null;
  }
  const inicio = base.indexOf(alvo);
  if (inicio < 0) {
    return null;
  }
  const corte = Math.max(0, inicio - margem);
  return {
    antes: `${corte > 0 ? "…" : ""}${texto.slice(corte, inicio)}`,
    achado: texto.slice(inicio, inicio + alvo.length),
    depois: texto.slice(inicio + alvo.length),
  };
}

/** A linha de resumo do que há dentro de um plugin instalado. Os hooks aparecem no selo, não aqui. */
export function resumoDoInventario(inventario: InventarioDoPlugin): string {
  const partes = [
    contar(inventario.skills.length, "skill", "skills"),
    contar(inventario.subagentes, "subagente", "subagentes"),
  ];
  if (inventario.servidoresMcp > 0) {
    partes.push(contar(inventario.servidoresMcp, "servidor MCP", "servidores MCP"));
  }
  return partes.join(" · ");
}
