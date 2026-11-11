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
