import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Anexo, EXTENSOES_DE_ANEXO } from "../../orquestracao/Anexo";
import { ArmazemDeAnexos } from "../../orquestracao/ArmazemDeAnexos";
import { extrairTextoDoDocumento } from "./ExtratorDeTextoDeDocumentos";

/** Nome de arquivo de anexo: um id e uma extensão de anexo aceita — nada de caminhos. */
const NOME_DE_ARQUIVO = new RegExp(`^[0-9a-zA-Z-]{1,64}\\.(${EXTENSOES_DE_ANEXO.join("|")})$`);

/** O texto extraído de um documento fica ao lado dele, com este sufixo: `<id>.docx.txt`. */
const SUFIXO_DO_TEXTO_EXTRAIDO = ".txt";

export function ehNomeDeAnexoValido(arquivo: string): boolean {
  return NOME_DE_ARQUIVO.test(arquivo);
}

/** dados/anexos/<orquestradorId>/<anexoId>.<extensão> (e `<anexoId>.<extensão>.txt` com o texto extraído) */
export class ArmazemDeAnexosEmArquivo implements ArmazemDeAnexos {
  constructor(private readonly pasta: string) {}

  async guardar(orquestradorId: string, anexo: Anexo, conteudo: Uint8Array): Promise<void> {
    await mkdir(this.pastaDe(orquestradorId), { recursive: true });
    const caminho = this.caminhoDe(orquestradorId, anexo.arquivo);
    await writeFile(caminho, conteudo);
    if (anexo.textoExtraivel) {
      await this.guardarTextoExtraido(caminho, anexo, conteudo);
    }
  }

  caminhoDe(orquestradorId: string, arquivo: string): string {
    if (!ehNomeDeAnexoValido(arquivo)) {
      throw new Error(`Nome de anexo inválido: "${arquivo}".`);
    }
    return path.join(this.pastaDe(orquestradorId), arquivo);
  }

  caminhoDoTextoDe(orquestradorId: string, arquivo: string): string | null {
    const caminho = `${this.caminhoDe(orquestradorId, arquivo)}${SUFIXO_DO_TEXTO_EXTRAIDO}`;
    return existsSync(caminho) ? caminho : null;
  }

  pastaDe(orquestradorId: string): string {
    return path.join(this.pasta, path.basename(orquestradorId));
  }

  async removerTodos(orquestradorId: string): Promise<void> {
    await rm(this.pastaDe(orquestradorId), { recursive: true, force: true });
  }

  /** Uma falha aqui nunca derruba o envio: o anexo segue, só sem o texto extraído. */
  private async guardarTextoExtraido(caminho: string, anexo: Anexo, conteudo: Uint8Array): Promise<void> {
    try {
      const texto = extrairTextoDoDocumento(anexo.extensao, conteudo);
      if (texto !== null) {
        await writeFile(`${caminho}${SUFIXO_DO_TEXTO_EXTRAIDO}`, texto, "utf8");
      }
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      console.warn(`[anexos] Não deu para extrair o texto de "${anexo.nome}": ${motivo}`);
    }
  }
}
