import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { ErroDeOrquestracao } from "../../orquestracao/ErroDeOrquestracao";
import { comBarraNaUnidade } from "../../orquestracao/PastaDeTrabalho";

export interface PastaDeProjeto {
  nome: string;
  caminho: string;
}

/** Uma pasta aberta no navegador de pastas da tela: o caminho, a pasta acima e as subpastas. */
export interface ConteudoDaPasta {
  atual: string;
  /** Nula na raiz do disco. */
  acima: string | null;
  pastas: PastaDeProjeto[];
}

/** Pastas ocultas (começam com ".") também ficam de fora; dá para chegar nelas digitando o caminho. */
const PASTAS_IGNORADAS = new Set(["node_modules", "System Volume Information"]);

function ehIgnorada(nome: string): boolean {
  // "$Recycle.Bin", "$WinREAgent"… são pastas de sistema na raiz das unidades do Windows.
  return nome.startsWith(".") || nome.startsWith("$") || PASTAS_IGNORADAS.has(nome);
}

/** Unidade que não responde nesse tempo (rede fora do ar) fica de fora dos atalhos. */
const TEMPO_PARA_A_UNIDADE_MS = 1_000;
/** As unidades mudam pouco: a lista vale por um tempo, sem refazer 26 consultas a cada clique. */
const VALIDADE_DAS_UNIDADES_MS = 30_000;

interface OpcoesDoExplorador {
  pastaPessoal?: string;
  plataforma?: NodeJS.Platform;
  agora?: () => number;
}

/**
 * Navega pelas pastas do computador para a escolha da pasta de trabalho. A
 * pasta dos projetos é só o ponto de partida: qualquer pasta pode ser aberta.
 */
export class ExploradorDePastas {
  private readonly pastaPessoal: string;
  private readonly plataforma: NodeJS.Platform;
  private readonly agora: () => number;
  private unidades: { em: number; lista: Promise<PastaDeProjeto[]> } | null = null;

  constructor(
    private readonly raiz: string,
    { pastaPessoal = homedir(), plataforma = process.platform, agora = Date.now }: OpcoesDoExplorador = {},
  ) {
    this.pastaPessoal = pastaPessoal;
    this.plataforma = plataforma;
    this.agora = agora;
  }

  /** As subpastas de `caminho` (relativo à pasta dos projetos; sem ele, a própria). */
  async listar(caminho?: string): Promise<ConteudoDaPasta> {
    const atual = path.resolve(this.raiz, comBarraNaUnidade(caminho?.trim() || "."));
    let entradas;
    try {
      entradas = await readdir(atual, { withFileTypes: true });
    } catch (erro) {
      throw new ErroDeOrquestracao("dados_invalidos", mensagemDaFalha(atual, erro));
    }

    const acima = path.dirname(atual);
    return {
      atual,
      acima: acima === atual ? null : acima,
      pastas: (
        await Promise.all(
          entradas
            .filter((entrada) => !ehIgnorada(entrada.name))
            .map(async (entrada) => {
              const pasta = { nome: entrada.name, caminho: path.join(atual, entrada.name) };
              // Link simbólico ou junction (comum no Windows, e /tmp no macOS)
              // entra se apontar para uma pasta; link quebrado fica de fora.
              const ehPasta =
                entrada.isDirectory() || (entrada.isSymbolicLink() && (await this.existe(pasta.caminho)));
              return ehPasta ? pasta : null;
            }),
        )
      )
        .filter((pasta): pasta is PastaDeProjeto => pasta !== null)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    };
  }

  /** Atalhos do navegador: a pasta dos projetos, a pasta pessoal e, no Windows, as unidades. */
  async atalhos(): Promise<PastaDeProjeto[]> {
    const atalhos: PastaDeProjeto[] = [
      { nome: "Projetos", caminho: this.raiz },
      { nome: "Pasta pessoal", caminho: this.pastaPessoal },
    ];
    return this.plataforma === "win32" ? [...atalhos, ...(await this.unidadesDoWindows())] : atalhos;
  }

  /** Consulta as 26 letras em paralelo, cada uma com limite de tempo, e guarda por um tempo. */
  private unidadesDoWindows(): Promise<PastaDeProjeto[]> {
    const agora = this.agora();
    if (this.unidades === null || agora - this.unidades.em > VALIDADE_DAS_UNIDADES_MS) {
      const consultas = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(async (letra) => {
        const caminho = `${letra}:\\`;
        const existe = await Promise.race([
          this.existe(caminho),
          new Promise<false>((resolver) => setTimeout(() => resolver(false), TEMPO_PARA_A_UNIDADE_MS).unref()),
        ]);
        return existe ? { nome: `${letra}:`, caminho } : null;
      });
      this.unidades = {
        em: agora,
        lista: Promise.all(consultas).then((lista) => lista.filter((unidade) => unidade !== null)),
      };
    }
    return this.unidades.lista;
  }

  async existe(caminho: string): Promise<boolean> {
    try {
      return (await stat(caminho)).isDirectory();
    } catch {
      return false;
    }
  }
}

function mensagemDaFalha(caminho: string, erro: unknown): string {
  const codigo = (erro as NodeJS.ErrnoException).code;
  if (codigo === "ENOENT" || codigo === "ENOTDIR") {
    return `A pasta "${caminho}" não existe.`;
  }
  if (codigo === "EACCES" || codigo === "EPERM") {
    return `Sem permissão para abrir a pasta "${caminho}".`;
  }
  return `Não foi possível abrir a pasta "${caminho}".`;
}
