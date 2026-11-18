import { criarComandoDoNavegador } from "./ComandoDoNavegador";
import { ControleDoNavegador } from "./ControleDoNavegador";
import { ErroDoNavegador } from "./ErroDoNavegador";
import { ResultadoDoComando } from "./ResultadoDoComando";

const PADRAO_DO_ID_DO_ORQUESTRADOR = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Casos de uso do navegador do agente: valida o comando e o repassa ao
 * controle. Não guarda estado (cada Orquestrador tem o seu navegador, mantido
 * por quem implementa o controle).
 */
export class ServicoDoNavegador {
  constructor(private readonly controle: ControleDoNavegador) {}

  /**
   * @param comando o que o agente pediu, ainda sem validar.
   * @throws ErroDoNavegador `comando_invalido` ou `recusado` antes de tocar o
   * navegador; os demais motivos vêm do controle.
   */
  async executar(orquestradorId: string, comando: unknown, sinal: AbortSignal): Promise<ResultadoDoComando> {
    if (!PADRAO_DO_ID_DO_ORQUESTRADOR.test(orquestradorId)) {
      throw new ErroDoNavegador("comando_invalido", "Orquestrador inválido para o navegador.");
    }
    const validado = criarComandoDoNavegador(comando);
    return this.controle.executar(orquestradorId, validado, sinal);
  }
}
