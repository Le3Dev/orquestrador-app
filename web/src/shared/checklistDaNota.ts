/**
 * Itens de checklist dentro do texto de uma nota, no formato do Markdown:
 * `[ ] comprar café`, `[x] feito` (ou `[X]`), com ou sem `- ` / `* ` antes.
 *
 * O texto da nota continua texto puro: marcar um item só troca o caractere
 * entre os colchetes daquela linha, e o resto (espaços, quebras `\r\n`) fica
 * como estava.
 */

/**
 * recuo · marcador de lista opcional · `[` · espaço ou x · `]` · espaço
 * opcional · texto. O texto é `[^\n]*`, e não `.*`: `.` não casa com o `\r`.
 */
const ITEM = /^([ \t]*(?:[-*][ \t]+)?\[)([ xX])(\]) ?([^\n]*)$/;

/** Uma linha da nota como o modo lista mostra. */
export type LinhaDaNota =
  | { tipo: "item"; marcado: boolean; texto: string }
  | { tipo: "texto"; texto: string }
  | { tipo: "vazia" };

/** A linha sem o `\r` do fim (texto vindo do Windows). */
function semRetorno(linha: string): string {
  return linha.endsWith("\r") ? linha.slice(0, -1) : linha;
}

export function ehItemDeChecklist(linha: string): boolean {
  return ITEM.test(semRetorno(linha));
}

/** Se o item está marcado; falso para linhas que não são de checklist. */
export function itemMarcado(linha: string): boolean {
  const partes = ITEM.exec(semRetorno(linha));
  return partes !== null && partes[2] !== " ";
}

/** O texto do item, sem o marcador; a linha que não é de checklist volta igual (sem o `\r`). */
export function textoDoItem(linha: string): string {
  const limpa = semRetorno(linha);
  const partes = ITEM.exec(limpa);
  return partes === null ? limpa : (partes[4] ?? "");
}

/** As linhas do texto, como o modo lista as mostra. */
export function linhasDaNota(texto: string): LinhaDaNota[] {
  return texto.split("\n").map((bruta): LinhaDaNota => {
    const linha = semRetorno(bruta);
    if (ehItemDeChecklist(linha)) {
      return { tipo: "item", marcado: itemMarcado(linha), texto: textoDoItem(linha) };
    }
    return linha.trim() === "" ? { tipo: "vazia" } : { tipo: "texto", texto: linha };
  });
}

/**
 * Marca ou desmarca o item da linha `indiceDaLinha` (a contar de 0) e devolve
 * o texto novo. Linha que não é de checklist, ou índice fora do texto: o
 * texto volta igual.
 */
export function alternarItem(texto: string, indiceDaLinha: number): string {
  const linhas = texto.split("\n");
  const linha = Number.isInteger(indiceDaLinha) ? linhas[indiceDaLinha] : undefined;
  // O `\r` do fim da linha fica no resto, intocado.
  const partes = linha === undefined ? null : ITEM.exec(linha);
  if (linha === undefined || partes === null) {
    return texto;
  }
  const antes = partes[1] ?? "";
  const marcado = partes[2] !== " ";
  linhas[indiceDaLinha] = `${antes}${marcado ? " " : "x"}${linha.slice(antes.length + 1)}`;
  return linhas.join("\n");
}
