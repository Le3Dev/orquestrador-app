import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Anexo, arquivoDeTextoDe } from "../../orquestracao/Anexo";
import { ArmazemDeAnexos } from "../../orquestracao/ArmazemDeAnexos";
import { ExtratorDeTexto, extrairTextoDoDocumento } from "../documentos/extrairTextoDoDocumento";

/** Nome de arquivo de anexo: um id, a marca do texto extraído (opcional) e uma extensão aceita — nada de caminhos. */
const NOME_DE_ARQUIVO = /^[0-9a-zA-Z-]{1,64}(\.texto)?\.(png|jpg|gif|webp|pdf|docx|xlsx|xls|csv|txt|md)$/;

export function ehNomeDeAnexoValido(arquivo: string): boolean {
  return NOME_DE_ARQUIVO.test(arquivo);
}

/** dados/anexos/<orquestradorId>/<anexoId>.<extensão> e, nos documentos, <anexoId>.texto.txt */
export class ArmazemDeAnexosEmArquivo implements ArmazemDeAnexos {
  constructor(
    private readonly pasta: string,
    private readonly extrator: ExtratorDeTexto = extrairTextoDoDocumento,
  ) {}

  async guardar(orquestradorId: string, anexo: Anexo, conteudo: Uint8Array): Promise<void> {
    await mkdir(this.pastaDe(orquestradorId), { recursive: true });
    await writeFile(this.caminhoDe(orquestradorId, anexo.arquivo), conteudo);
    if (anexo.categoria === "documento") {
      await this.guardarTexto(orquestradorId, anexo, conteudo);
    }
  }

  caminhoDe(orquestradorId: string, arquivo: string): string {
    if (!ehNomeDeAnexoValido(arquivo)) {
      throw new Error(`Nome de anexo inválido: "${arquivo}".`);
    }
    return path.join(this.pastaDe(orquestradorId), arquivo);
  }

  async caminhoDoTexto(orquestradorId: string, anexoId: string): Promise<string | null> {
    const arquivo = arquivoDeTextoDe(anexoId);
    if (!ehNomeDeAnexoValido(arquivo)) {
      return null;
    }
    const caminho = this.caminhoDe(orquestradorId, arquivo);
    try {
      await access(caminho);
      return caminho;
    } catch {
      return null;
    }
  }

  pastaDe(orquestradorId: string): string {
    return path.join(this.pasta, path.basename(orquestradorId));
  }

  async removerTodos(orquestradorId: string): Promise<void> {
    await rm(this.pastaDe(orquestradorId), { recursive: true, force: true });
  }

  /** Falha na extração não derruba a mensagem: fica só o original, e o prompt avisa. */
  private async guardarTexto(orquestradorId: string, anexo: Anexo, conteudo: Uint8Array): Promise<void> {
    try {
      const texto = await this.extrator(conteudo, anexo.tipoDeMidia);
      if (texto.trim() === "") {
        throw new Error("o documento não tem texto (ex.: PDF de imagens escaneadas)");
      }
      await writeFile(this.caminhoDe(orquestradorId, arquivoDeTextoDe(anexo.id)), texto, "utf8");
    } catch (erro) {
      console.warn(`[anexos] Não foi possível extrair o texto de "${anexo.nome}":`, erro);
    }
  }
}
