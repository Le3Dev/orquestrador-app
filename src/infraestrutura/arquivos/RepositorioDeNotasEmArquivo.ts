import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";

import { z } from "zod";

import { DadosDaNota, Nota } from "../../notas/Nota";
import { RepositorioDeNotas } from "../../notas/RepositorioDeNotas";

const EXTENSAO = ".json";

/** Só identidades geradas por nós: nada de "..\" escapando da pasta das notas. */
const IDENTIDADE_VALIDA = /^[A-Za-z0-9_-]{1,100}$/;

const esquemaDoArquivo = z.object({
  id: z.string().regex(IDENTIDADE_VALIDA),
  titulo: z.string(),
  texto: z.string(),
  criadaEm: z.iso.datetime({ offset: true }),
  atualizadaEm: z.iso.datetime({ offset: true }),
});

/** No Windows, antivírus e indexador seguram o arquivo por instantes e o rename falha. */
const ERROS_PASSAGEIROS = new Set(["EPERM", "EACCES", "EBUSY"]);
const TENTATIVAS_DE_RENOMEAR = 5;

async function renomearComNovasTentativas(origem: string, destino: string): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await rename(origem, destino);
      return;
    } catch (erro) {
      const codigo = (erro as NodeJS.ErrnoException).code ?? "";
      if (tentativa >= TENTATIVAS_DE_RENOMEAR || !ERROS_PASSAGEIROS.has(codigo)) {
        throw erro;
      }
      await esperar(25 * tentativa);
    }
  }
}

/** Grava num arquivo temporário e renomeia: um desligamento no meio não deixa JSON pela metade. */
async function gravarAtomicamente(caminho: string, conteudo: string): Promise<void> {
  const temporario = `${caminho}.tmp`;
  await writeFile(temporario, conteudo, "utf8");
  await renomearComNovasTentativas(temporario, caminho);
}

function compararPorCriacao(a: DadosDaNota, b: DadosDaNota): number {
  return Date.parse(a.criadaEm) - Date.parse(b.criadaEm) || a.id.localeCompare(b.id);
}

/**
 * Repositório em arquivos, um por Nota:
 *
 * dados/notas/<id>.json
 *
 * Tudo é carregado na abertura e mantido em memória (como cópias dos dados,
 * nunca a instância de quem salvou). O disco recebe as gravações numa fila
 * por Nota: duas edições seguidas da mesma Nota são gravadas na ordem em que
 * foram pedidas, e a última vence; Notas diferentes gravam em paralelo.
 */
export class RepositorioDeNotasEmArquivo implements RepositorioDeNotas {
  private readonly notas = new Map<string, DadosDaNota>();
  private readonly filasDeGravacao = new Map<string, Promise<void>>();

  private constructor(private readonly pasta: string) {}

  static async abrir(pastaDeDados: string): Promise<RepositorioDeNotasEmArquivo> {
    const repositorio = new RepositorioDeNotasEmArquivo(path.join(pastaDeDados, "notas"));
    await mkdir(repositorio.pasta, { recursive: true });

    const entradas = await readdir(repositorio.pasta, { withFileTypes: true });
    for (const entrada of entradas) {
      if (entrada.isFile() && entrada.name.endsWith(EXTENSAO)) {
        await repositorio.carregar(entrada.name);
      }
    }
    return repositorio;
  }

  todas(): readonly Nota[] {
    return [...this.notas.values()].sort(compararPorCriacao).map((dados) => Nota.reconstituir(dados));
  }

  buscar(id: string): Nota | null {
    const dados = this.notas.get(id);
    return dados === undefined ? null : Nota.reconstituir(dados);
  }

  salvar(nota: Nota): Promise<void> {
    const dados = nota.paraDados();
    const caminho = this.caminhoDa(dados.id);
    this.notas.set(dados.id, dados);
    const conteudo = JSON.stringify(dados, null, 2);
    return this.enfileirar(dados.id, async () => {
      await mkdir(this.pasta, { recursive: true });
      await gravarAtomicamente(caminho, conteudo);
    });
  }

  remover(id: string): Promise<void> {
    const caminho = this.caminhoDa(id);
    this.notas.delete(id);
    return this.enfileirar(id, () => rm(caminho, { force: true }));
  }

  /** Resolve quando tudo o que foi pedido até agora estiver no disco. */
  async aguardarGravacoes(): Promise<void> {
    await Promise.all(this.filasDeGravacao.values());
  }

  private enfileirar(id: string, tarefa: () => Promise<void>): Promise<void> {
    const anterior = this.filasDeGravacao.get(id) ?? Promise.resolve();
    const gravacao = anterior.then(tarefa);
    const cauda = gravacao.catch((erro: unknown) => {
      console.error(`[notas] Falha ao gravar a nota "${id}" no disco:`, erro);
    });
    this.filasDeGravacao.set(id, cauda);
    // Fila vazia some do mapa, para não acumular uma entrada por Nota já gravada.
    void cauda.then(() => {
      if (this.filasDeGravacao.get(id) === cauda) {
        this.filasDeGravacao.delete(id);
      }
    });
    return gravacao;
  }

  private caminhoDa(id: string): string {
    if (!IDENTIDADE_VALIDA.test(id)) {
      throw new Error(`Identidade de nota inválida: "${id}".`);
    }
    return path.join(this.pasta, `${id}${EXTENSAO}`);
  }

  /** Uma Nota com arquivo ilegível é pulada (e o arquivo, mantido), para não impedir que as outras abram. */
  private async carregar(arquivo: string): Promise<void> {
    try {
      const conteudo = await readFile(path.join(this.pasta, arquivo), "utf8");
      const dados = esquemaDoArquivo.parse(JSON.parse(conteudo));
      if (`${dados.id}${EXTENSAO}` !== arquivo) {
        throw new Error(`o arquivo guarda a nota "${dados.id}".`);
      }
      this.notas.set(dados.id, dados);
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      console.warn(`[notas] Arquivo "${arquivo}" ignorado: não foi possível ler a nota (${detalhe}).`);
    }
  }
}
