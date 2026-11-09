import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { DadosDoModeloDeCanvas, esquemaDoConteudoDoModelo } from "../../modelos/ModeloDeCanvas";
import { RepositorioDeModelosDeCanvas } from "../../modelos/RepositorioDeModelosDeCanvas";
import { gravarAtomicamente } from "./RepositorioDeNotasEmArquivo";

const ARQUIVO = "modelos-de-canvas.json";
/** Para onde vai um arquivo ilegível, para não ser sobrescrito no próximo salvar. */
const ARQUIVO_ILEGIVEL = "modelos-de-canvas.ilegivel.json";

/** Cada modelo gravado: o conteúdo validado como na rota, mais a identidade e as datas. */
const esquemaDoArquivo = z.object({
  modelos: z.array(
    esquemaDoConteudoDoModelo.extend({
      id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
      criadoEm: z.iso.datetime({ offset: true }),
      atualizadoEm: z.iso.datetime({ offset: true }),
    }),
  ),
});

function copia(modelo: DadosDoModeloDeCanvas): DadosDoModeloDeCanvas {
  return structuredClone(modelo);
}

/**
 * Repositório em arquivo único:
 *
 * dados/modelos-de-canvas.json   { "modelos": [ … ] }
 *
 * Carregado na abertura e mantido em memória (cópias, nunca o objeto de quem
 * salvou). Sem o arquivo, a lista começa vazia. Ilegível, ele é guardado como
 * `modelos-de-canvas.ilegivel.json` e a lista começa vazia. As gravações são
 * atômicas e vão numa fila: duas seguidas chegam ao disco na ordem pedida.
 */
export class RepositorioDeModelosDeCanvasEmArquivo implements RepositorioDeModelosDeCanvas {
  private modelos: DadosDoModeloDeCanvas[] = [];
  private filaDeGravacao: Promise<void> = Promise.resolve();

  private constructor(private readonly pasta: string) {}

  static async abrir(pastaDeDados: string): Promise<RepositorioDeModelosDeCanvasEmArquivo> {
    const repositorio = new RepositorioDeModelosDeCanvasEmArquivo(pastaDeDados);
    await mkdir(pastaDeDados, { recursive: true });
    await repositorio.carregar();
    return repositorio;
  }

  todos(): DadosDoModeloDeCanvas[] {
    return this.modelos.map(copia);
  }

  salvar(modelos: readonly DadosDoModeloDeCanvas[]): Promise<void> {
    this.modelos = modelos.map(copia);
    const conteudo = JSON.stringify({ modelos: this.modelos }, null, 2);
    const gravacao = this.filaDeGravacao.then(async () => {
      await mkdir(this.pasta, { recursive: true });
      await gravarAtomicamente(path.join(this.pasta, ARQUIVO), conteudo);
    });
    this.filaDeGravacao = gravacao.catch((erro: unknown) => {
      console.error("[modelos] Falha ao gravar os modelos de canvas no disco:", erro);
    });
    return gravacao;
  }

  /** Resolve quando tudo o que foi pedido até agora estiver no disco. */
  async aguardarGravacoes(): Promise<void> {
    await this.filaDeGravacao;
  }

  private async carregar(): Promise<void> {
    const caminho = path.join(this.pasta, ARQUIVO);
    let conteudo: string;
    try {
      conteudo = await readFile(caminho, "utf8");
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw erro;
    }
    try {
      this.modelos = esquemaDoArquivo.parse(JSON.parse(conteudo)).modelos;
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message.slice(0, 300) : String(erro);
      await rename(caminho, path.join(this.pasta, ARQUIVO_ILEGIVEL)).catch(() => undefined);
      console.warn(
        `[modelos] "${ARQUIVO}" ilegível (${detalhe}); guardado como "${ARQUIVO_ILEGIVEL}" e a lista começa vazia.`,
      );
    }
  }
}
