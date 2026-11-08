import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";

import { DadosDasPreferencias, PreferenciasGlobais } from "../../orquestracao/PreferenciasGlobais";
import { RepositorioDePreferencias } from "../../orquestracao/RepositorioDePreferencias";
import { gravarAtomicamente } from "./RepositorioDeNotasEmArquivo";

const ARQUIVO = "preferencias.json";
/** Para onde vai um arquivo ilegível, para não ser sobrescrito no próximo salvar. */
const ARQUIVO_ILEGIVEL = "preferencias.ilegivel.json";

/**
 * Repositório em arquivo único:
 *
 * dados/preferencias.json
 *
 * Carregado na abertura e mantido em memória. Sem o arquivo, valem as
 * Preferências vazias (o comportamento de antes de elas existirem). As
 * gravações vão numa fila: duas seguidas chegam ao disco na ordem pedida.
 */
export class RepositorioDePreferenciasEmArquivo implements RepositorioDePreferencias {
  private preferencias = PreferenciasGlobais.vazias();
  private filaDeGravacao: Promise<void> = Promise.resolve();

  private constructor(private readonly pasta: string) {}

  static async abrir(pastaDeDados: string): Promise<RepositorioDePreferenciasEmArquivo> {
    const repositorio = new RepositorioDePreferenciasEmArquivo(pastaDeDados);
    await mkdir(pastaDeDados, { recursive: true });
    await repositorio.carregar();
    return repositorio;
  }

  atuais(): PreferenciasGlobais {
    return this.preferencias;
  }

  salvar(preferencias: PreferenciasGlobais): Promise<void> {
    this.preferencias = preferencias;
    const conteudo = JSON.stringify(preferencias.paraDados(), null, 2);
    const gravacao = this.filaDeGravacao.then(async () => {
      await mkdir(this.pasta, { recursive: true });
      await gravarAtomicamente(path.join(this.pasta, ARQUIVO), conteudo);
    });
    this.filaDeGravacao = gravacao.catch((erro: unknown) => {
      console.error("[preferencias] Falha ao gravar as preferências no disco:", erro);
    });
    return gravacao;
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
      this.preferencias = PreferenciasGlobais.de(JSON.parse(conteudo) as DadosDasPreferencias);
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      await rename(caminho, path.join(this.pasta, ARQUIVO_ILEGIVEL)).catch(() => undefined);
      console.warn(
        `[preferencias] "${ARQUIVO}" ilegível (${detalhe}); guardado como "${ARQUIVO_ILEGIVEL}" e substituído pelas preferências vazias.`,
      );
    }
  }
}
