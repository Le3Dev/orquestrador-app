import type { SituacaoDoOrquestrador } from "../../shared/api/tipos";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** "1,9 GB", "16 GB" (uma casa decimal só quando faz diferença). */
export function formatarGb(bytes: number): string {
  return `${(bytes / GB).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
}

/** "820 MB", "1.230 MB": a memória de cada orquestrador, sempre em MB. */
export function formatarMb(bytes: number): string {
  return `${Math.round(bytes / MB).toLocaleString("pt-BR")} MB`;
}

export interface OrquestradorDaTabela {
  id: string;
  nome: string;
  situacao: SituacaoDoOrquestrador;
}

/** Trabalhando primeiro, depois mais memória, depois o nome. */
export function ordenarOrquestradores(
  orquestradores: readonly OrquestradorDaTabela[],
  porOrquestrador: Record<string, number>,
): (OrquestradorDaTabela & { bytes: number })[] {
  return orquestradores
    .map((orquestrador) => ({ ...orquestrador, bytes: porOrquestrador[orquestrador.id] ?? 0 }))
    .sort(
      (a, b) =>
        Number(b.situacao === "trabalhando") - Number(a.situacao === "trabalhando") ||
        b.bytes - a.bytes ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );
}

/**
 * O nome que o Claude manda ("5 horas", "7 dias", "7 dias (Opus)") com o
 * rótulo do protótipo: a janela de 5 horas é a da sessão, a de 7 dias é a da
 * semana, e o modelo, se houver, vem entre parênteses.
 */
export function nomeLegivelDaCota(nome: string): string {
  const limpo = nome.trim();
  const modelo = /\(([^)]+)\)\s*$/.exec(limpo)?.[1];
  const sufixo = modelo === undefined ? "" : ` (${modelo})`;
  if (/^5\s*horas?\b/i.test(limpo)) {
    return `Cota da sessão${sufixo}`;
  }
  if (/^7\s*dias?\b/i.test(limpo)) {
    return `Cota da semana${sufixo}`;
  }
  return limpo === "" ? "Cota" : `Cota de ${limpo}`;
}
