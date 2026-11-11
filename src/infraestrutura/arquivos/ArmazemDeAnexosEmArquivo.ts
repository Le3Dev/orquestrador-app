import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Anexo } from "../../orquestracao/Anexo";
import { ArmazemDeAnexos } from "../../orquestracao/ArmazemDeAnexos";

/** Nome de arquivo de anexo: um id e uma extensão de imagem — nada de caminhos. */
const NOME_DE_ARQUIVO = /^[0-9a-zA-Z-]{1,64}\.(png|jpg|gif|webp)$/;

export function ehNomeDeAnexoValido(arquivo: string): boolean {
  return NOME_DE_ARQUIVO.test(arquivo);
}

/** dados/anexos/<orquestradorId>/<anexoId>.<extensão> */
export class ArmazemDeAnexosEmArquivo implements ArmazemDeAnexos {
  constructor(private readonly pasta: string) {}

  async guardar(orquestradorId: string, anexo: Anexo, conteudo: Uint8Array): Promise<void> {
    await mkdir(this.pastaDe(orquestradorId), { recursive: true });
    await writeFile(this.caminhoDe(orquestradorId, anexo.arquivo), conteudo);
  }

  caminhoDe(orquestradorId: string, arquivo: string): string {
    if (!ehNomeDeAnexoValido(arquivo)) {
      throw new Error(`Nome de anexo inválido: "${arquivo}".`);
    }
    return path.join(this.pastaDe(orquestradorId), arquivo);
  }

  pastaDe(orquestradorId: string): string {
    return path.join(this.pasta, path.basename(orquestradorId));
  }

  async removerTodos(orquestradorId: string): Promise<void> {
    await rm(this.pastaDe(orquestradorId), { recursive: true, force: true });
  }
}
