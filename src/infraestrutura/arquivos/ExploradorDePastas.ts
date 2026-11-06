import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface PastaDeProjeto {
  nome: string;
  caminho: string;
}

/** Uma pasta qualquer do computador e a navegação a partir dela. */
export interface NavegacaoDePastas {
  /** A pasta que está sendo listada. */
  caminho: string;
  /** A pasta acima; `null` quando `caminho` já é a raiz do disco. */
  pai: string | null;
  /** As subpastas visíveis, em ordem alfabética. */
  pastas: PastaDeProjeto[];
}

const PASTAS_IGNORADAS = new Set(["node_modules"]);

/** Lista as pastas de projeto disponíveis para os Orquestradores. */
export class ExploradorDePastas {
  constructor(private readonly raiz: string) {}

  async listarProjetos(): Promise<PastaDeProjeto[]> {
    return this.subpastas(this.raiz);
  }

  async existe(caminho: string): Promise<boolean> {
    try {
      return (await stat(caminho)).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Navega pelo sistema de arquivos para escolher uma pasta qualquer do
   * computador. Sem `caminho`, parte da pasta raiz dos projetos (ou da pasta do
   * usuário, se a raiz não existir). Caminhos relativos são resolvidos a partir
   * da raiz, como no resto do app.
   */
  async navegar(caminho?: string): Promise<NavegacaoDePastas> {
    const alvo = await this.pastaInicial(caminho);
    const pai = path.dirname(alvo);
    return {
      caminho: alvo,
      pai: pai === alvo ? null : pai,
      pastas: await this.subpastas(alvo),
    };
  }

  private async pastaInicial(caminho?: string): Promise<string> {
    const informado = (caminho ?? "").trim();
    if (informado !== "") {
      const absoluto = path.isAbsolute(informado) ? informado : path.resolve(this.raiz, informado);
      if (await this.existe(absoluto)) {
        return path.resolve(absoluto);
      }
    }
    if (await this.existe(this.raiz)) {
      return path.resolve(this.raiz);
    }
    return path.resolve(homedir());
  }

  /** Subpastas visíveis de uma pasta, ignorando ocultas e `node_modules`. */
  private async subpastas(pasta: string): Promise<PastaDeProjeto[]> {
    const entradas = await readdir(pasta, { withFileTypes: true });
    return entradas
      .filter((entrada) => entrada.isDirectory())
      .filter((entrada) => !entrada.name.startsWith(".") && !PASTAS_IGNORADAS.has(entrada.name))
      .map((entrada) => ({ nome: entrada.name, caminho: path.join(pasta, entrada.name) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }
}
