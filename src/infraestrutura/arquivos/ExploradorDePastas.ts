import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface PastaDeProjeto {
  nome: string;
  caminho: string;
}

const PASTAS_IGNORADAS = new Set(["node_modules"]);

/** Lista as pastas de projeto disponíveis para os Orquestradores. */
export class ExploradorDePastas {
  constructor(private readonly raiz: string) {}

  async listarProjetos(): Promise<PastaDeProjeto[]> {
    const entradas = await readdir(this.raiz, { withFileTypes: true });
    return entradas
      .filter((entrada) => entrada.isDirectory())
      .filter((entrada) => !entrada.name.startsWith(".") && !PASTAS_IGNORADAS.has(entrada.name))
      .map((entrada) => ({ nome: entrada.name, caminho: path.join(this.raiz, entrada.name) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  async existe(caminho: string): Promise<boolean> {
    try {
      return (await stat(caminho)).isDirectory();
    } catch {
      return false;
    }
  }
}
