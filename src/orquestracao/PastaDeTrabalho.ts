import path from "node:path";

import { ErroDeOrquestracao } from "./ErroDeOrquestracao";

/**
 * Pasta em que um Orquestrador e seus Subagentes trabalham. Objeto de valor.
 *
 * Só é criada dentro da pasta raiz dos projetos: os agentes podem editar
 * arquivos e rodar comandos, e um caminho como `..\..\Windows` não pode virar
 * área de trabalho deles por um erro de digitação.
 */
export class PastaDeTrabalho {
  private constructor(public readonly caminho: string) {}

  static dentroDe(raiz: string, caminho: string): PastaDeTrabalho {
    const informado = caminho.trim();
    if (informado === "") {
      throw new ErroDeOrquestracao("dados_invalidos", "Informe a pasta de trabalho.");
    }

    const raizResolvida = path.resolve(raiz);
    const alvo = path.resolve(raizResolvida, informado);
    const relativo = path.relative(raizResolvida, alvo);

    const saiDaRaiz =
      relativo === ".." || relativo.startsWith(`..${path.sep}`) || path.isAbsolute(relativo);
    if (saiDaRaiz) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        `A pasta "${alvo}" fica fora de "${raizResolvida}". Escolha uma pasta dentro da raiz dos projetos.`,
      );
    }

    return new PastaDeTrabalho(alvo);
  }

  /** Recria a partir do histórico salvo, que já passou pela validação ao ser criado. */
  static reconstituir(caminho: string): PastaDeTrabalho {
    return new PastaDeTrabalho(caminho);
  }

  get nome(): string {
    return path.basename(this.caminho);
  }
}
