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

/** O caminho digitado não leva a uma pasta que dê para abrir; a mensagem vai pronta para a tela. */
export class ErroDeCaminho extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeCaminho";
  }
}

export interface OpcoesDaNavegacao {
  /**
   * Recusa (com `ErroDeCaminho`) um caminho informado que não existe ou não é
   * pasta, em vez de voltar em silêncio para a raiz. Usado quando a pessoa
   * digita o caminho: ela precisa saber que ele não serve.
   */
  estrito?: boolean;
}

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
   * da raiz, como no resto do app; `~` e `~/…` partem da pasta do usuário.
   */
  async navegar(caminho?: string, { estrito = false }: OpcoesDaNavegacao = {}): Promise<NavegacaoDePastas> {
    const alvo = await this.pastaInicial(caminho, estrito);
    const pai = path.dirname(alvo);
    return {
      caminho: alvo,
      pai: pai === alvo ? null : pai,
      pastas: await this.subpastasLegiveis(alvo),
    };
  }

  private async pastaInicial(caminho: string | undefined, estrito: boolean): Promise<string> {
    const informado = (caminho ?? "").trim();
    if (informado !== "") {
      const absoluto = this.resolver(informado);
      const tipo = await this.tipoDoCaminho(absoluto);
      if (tipo === "pasta") {
        return absoluto;
      }
      if (estrito) {
        throw new ErroDeCaminho(
          tipo === "inexistente" ? `A pasta "${absoluto}" não existe.` : `"${absoluto}" não é uma pasta.`,
        );
      }
    }
    if (await this.existe(this.raiz)) {
      return path.resolve(this.raiz);
    }
    return path.resolve(homedir());
  }

  /** Absoluto como veio; `~` vira a pasta do usuário; relativo parte da raiz. */
  private resolver(informado: string): string {
    if (informado === "~" || informado.startsWith("~/")) {
      return path.resolve(homedir(), `.${informado.slice(1)}`);
    }
    return path.isAbsolute(informado) ? path.resolve(informado) : path.resolve(this.raiz, informado);
  }

  private async tipoDoCaminho(caminho: string): Promise<"pasta" | "arquivo" | "inexistente"> {
    try {
      return (await stat(caminho)).isDirectory() ? "pasta" : "arquivo";
    } catch {
      return "inexistente";
    }
  }

  /** Como `subpastas`, mas sem permissão de leitura vira `ErroDeCaminho` (e não um erro 500). */
  private async subpastasLegiveis(pasta: string): Promise<PastaDeProjeto[]> {
    try {
      return await this.subpastas(pasta);
    } catch (erro) {
      const codigo = (erro as NodeJS.ErrnoException).code;
      if (codigo === "EACCES" || codigo === "EPERM") {
        throw new ErroDeCaminho(`Sem permissão para abrir "${pasta}".`);
      }
      throw erro;
    }
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
