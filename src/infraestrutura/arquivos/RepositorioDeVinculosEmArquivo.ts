import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { DadosDoVinculo, Vinculo } from "../../vinculos/Vinculo";
import { RepositorioDeVinculos } from "../../vinculos/RepositorioDeVinculos";
import { gravarAtomicamente } from "./RepositorioDeNotasEmArquivo";

const EXTENSAO = ".json";

/** Só identidades geradas por nós: nada de "..\" escapando da pasta dos vínculos. */
const IDENTIDADE_VALIDA = /^[A-Za-z0-9_-]{1,100}$/;

const esquemaDoArquivo = z.object({
  id: z.string().regex(IDENTIDADE_VALIDA),
  orquestradorAId: z.string().min(1),
  orquestradorBId: z.string().min(1),
  notas: z.string(),
  criadoEm: z.iso.datetime({ offset: true }),
  atualizadoEm: z.iso.datetime({ offset: true }),
});

function compararPorCriacao(a: DadosDoVinculo, b: DadosDoVinculo): number {
  return Date.parse(a.criadoEm) - Date.parse(b.criadoEm) || a.id.localeCompare(b.id);
}

/**
 * Repositório em arquivos, um por Vínculo:
 *
 * dados/vinculos/<id>.json
 *
 * Mesmo molde das Notas: tudo é carregado na abertura e mantido em memória
 * (cópias dos dados), e o disco recebe as gravações numa fila por Vínculo.
 */
export class RepositorioDeVinculosEmArquivo implements RepositorioDeVinculos {
  private readonly vinculos = new Map<string, DadosDoVinculo>();
  private readonly filasDeGravacao = new Map<string, Promise<void>>();

  private constructor(private readonly pasta: string) {}

  static async abrir(pastaDeDados: string): Promise<RepositorioDeVinculosEmArquivo> {
    const repositorio = new RepositorioDeVinculosEmArquivo(path.join(pastaDeDados, "vinculos"));
    await mkdir(repositorio.pasta, { recursive: true });

    const entradas = await readdir(repositorio.pasta, { withFileTypes: true });
    for (const entrada of entradas) {
      if (entrada.isFile() && entrada.name.endsWith(EXTENSAO)) {
        await repositorio.carregar(entrada.name);
      }
    }
    return repositorio;
  }

  todos(): readonly Vinculo[] {
    return [...this.vinculos.values()].sort(compararPorCriacao).map((dados) => Vinculo.reconstituir(dados));
  }

  buscar(id: string): Vinculo | null {
    const dados = this.vinculos.get(id);
    return dados === undefined ? null : Vinculo.reconstituir(dados);
  }

  salvar(vinculo: Vinculo): Promise<void> {
    const dados = vinculo.paraDados();
    const caminho = this.caminhoDe(dados.id);
    this.vinculos.set(dados.id, dados);
    const conteudo = JSON.stringify(dados, null, 2);
    return this.enfileirar(dados.id, async () => {
      await mkdir(this.pasta, { recursive: true });
      await gravarAtomicamente(caminho, conteudo);
    });
  }

  remover(id: string): Promise<void> {
    const caminho = this.caminhoDe(id);
    this.vinculos.delete(id);
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
      console.error(`[vinculos] Falha ao gravar o vínculo "${id}" no disco:`, erro);
    });
    this.filasDeGravacao.set(id, cauda);
    void cauda.then(() => {
      if (this.filasDeGravacao.get(id) === cauda) {
        this.filasDeGravacao.delete(id);
      }
    });
    return gravacao;
  }

  private caminhoDe(id: string): string {
    if (!IDENTIDADE_VALIDA.test(id)) {
      throw new Error(`Identidade de vínculo inválida: "${id}".`);
    }
    return path.join(this.pasta, `${id}${EXTENSAO}`);
  }

  /** Um Vínculo com arquivo ilegível é pulado (e o arquivo, mantido), para não impedir que os outros abram. */
  private async carregar(arquivo: string): Promise<void> {
    try {
      const conteudo = await readFile(path.join(this.pasta, arquivo), "utf8");
      const dados = esquemaDoArquivo.parse(JSON.parse(conteudo));
      if (`${dados.id}${EXTENSAO}` !== arquivo) {
        throw new Error(`o arquivo guarda o vínculo "${dados.id}".`);
      }
      this.vinculos.set(dados.id, dados);
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      console.warn(`[vinculos] Arquivo "${arquivo}" ignorado: não foi possível ler o vínculo (${detalhe}).`);
    }
  }
}
