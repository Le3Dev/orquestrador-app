/**
 * Leitura defensiva do JSON que os CLIs mandam: o protocolo muda de versão para
 * versão, e um campo que sumiu ou mudou de tipo não pode derrubar o turno.
 */
export type Objeto = Record<string, unknown>;

export function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

export function texto(origem: unknown, campo: string): string {
  const valor = ehObjeto(origem) ? origem[campo] : undefined;
  return typeof valor === "string" ? valor : "";
}

export function numero(origem: unknown, campo: string): number {
  const valor = ehObjeto(origem) ? origem[campo] : undefined;
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

export function objeto(origem: unknown, campo: string): Objeto {
  const valor = ehObjeto(origem) ? origem[campo] : undefined;
  return ehObjeto(valor) ? valor : {};
}

export function objetos(origem: unknown, campo: string): Objeto[] {
  const valor = ehObjeto(origem) ? origem[campo] : undefined;
  return Array.isArray(valor) ? valor.filter(ehObjeto) : [];
}

/** O valor, se for uma lista de textos; senão `[]`. */
export function textos(origem: unknown, campo: string): string[] {
  const valor = ehObjeto(origem) ? origem[campo] : undefined;
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string") : [];
}

const TAMANHO_DO_DETALHE = 160;

/** Resumo curto da entrada de uma ferramenta (o comando, o caminho, a URL...), para a tela. */
export function resumirEntrada(entrada: unknown): string {
  if (!ehObjeto(entrada)) {
    return typeof entrada === "string" ? entrada.slice(0, TAMANHO_DO_DETALHE) : "";
  }
  for (const campo of ["command", "file_path", "filePath", "path", "fileName", "pattern", "url", "query"]) {
    const valor = texto(entrada, campo);
    if (valor !== "") {
      return valor.slice(0, TAMANHO_DO_DETALHE);
    }
  }
  const comandos = textos(entrada, "commands");
  if (comandos.length > 0) {
    return comandos.join(" ; ").slice(0, TAMANHO_DO_DETALHE);
  }
  return JSON.stringify(entrada).slice(0, TAMANHO_DO_DETALHE);
}
