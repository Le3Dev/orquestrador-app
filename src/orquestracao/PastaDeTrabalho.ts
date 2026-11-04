import path from "node:path";

import { ErroDeOrquestracao } from "./ErroDeOrquestracao";

/**
 * Pasta em que um Orquestrador e seus Subagentes trabalham. Objeto de valor.
 *
 * Pode ser qualquer pasta do computador. Caminho relativo parte da pasta dos
 * projetos (`PASTA_RAIZ_PROJETOS`); a tela sempre manda o caminho absoluto,
 * escolhido no navegador de pastas. Que a pasta exista, quem confere é a rota.
 */
export class PastaDeTrabalho {
  private constructor(public readonly caminho: string) {}

  static resolver(base: string, caminho: string): PastaDeTrabalho {
    const informado = caminho.trim();
    if (informado === "") {
      throw new ErroDeOrquestracao("dados_invalidos", "Informe a pasta de trabalho.");
    }
    return new PastaDeTrabalho(path.resolve(base, comBarraNaUnidade(informado)));
  }

  /** Recria a partir do histórico salvo, que já passou pela validação ao ser criado. */
  static reconstituir(caminho: string): PastaDeTrabalho {
    return new PastaDeTrabalho(caminho);
  }

  get nome(): string {
    return path.basename(this.caminho);
  }
}

/**
 * No Windows, "C:" sozinho é "a pasta atual da unidade C" e resolve para a
 * pasta dos projetos quando ela está em C:. Quem digita "C:" quer a raiz.
 */
export function comBarraNaUnidade(caminho: string): string {
  return path.sep === "\\" && /^[A-Za-z]:$/.test(caminho) ? `${caminho}\\` : caminho;
}
