import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { InformacoesDoCaminho, ItemDoDisco, SistemaDeArquivos } from "../../orquestracao/ArquivosDaPasta";

/** Erros de "não existe": arquivo sumido, parte do caminho que não é pasta ou symlink em laço. */
function naoExiste(erro: unknown): boolean {
  const codigo = (erro as NodeJS.ErrnoException | null)?.code;
  return codigo === "ENOENT" || codigo === "ENOTDIR" || codigo === "ELOOP";
}

function tipoDe(estatisticas: { isDirectory(): boolean; isFile(): boolean }): InformacoesDoCaminho["tipo"] {
  if (estatisticas.isDirectory()) {
    return "pasta";
  }
  return estatisticas.isFile() ? "arquivo" : "outro";
}

/** O disco de verdade, só leitura, para o visualizador de código. */
export class SistemaDeArquivosEmDisco implements SistemaDeArquivos {
  async caminhoReal(caminho: string): Promise<string | null> {
    try {
      return await realpath(caminho);
    } catch (erro) {
      if (naoExiste(erro)) {
        return null;
      }
      throw erro;
    }
  }

  async informacoes(caminho: string): Promise<InformacoesDoCaminho | null> {
    try {
      const estatisticas = await stat(caminho);
      return { tipo: tipoDe(estatisticas), tamanho: estatisticas.size };
    } catch (erro) {
      if (naoExiste(erro)) {
        return null;
      }
      throw erro;
    }
  }

  async listar(pasta: string): Promise<readonly ItemDoDisco[]> {
    const entradas = await readdir(pasta, { withFileTypes: true });
    return Promise.all(
      entradas.map(async (entrada): Promise<ItemDoDisco> => {
        const link = entrada.isSymbolicLink();
        // Pasta comum não precisa de `stat`; arquivo precisa do tamanho, e link, do alvo.
        if (!link && entrada.isDirectory()) {
          return { nome: entrada.name, tipo: "pasta", tamanho: 0, link };
        }
        if (!link && !entrada.isFile()) {
          return { nome: entrada.name, tipo: "outro", tamanho: 0, link };
        }
        const informacoes = await this.informacoes(path.join(pasta, entrada.name)).catch(() => null);
        return {
          nome: entrada.name,
          tipo: informacoes?.tipo ?? "outro",
          tamanho: informacoes?.tamanho ?? 0,
          link,
        };
      }),
    );
  }

  async ler(arquivo: string): Promise<Buffer> {
    return readFile(arquivo);
  }
}
