import { ComandoDoNavegador } from "./ComandoDoNavegador";
import { ResultadoDoComando } from "./ResultadoDoComando";

/**
 * Porta do navegador do agente: executa um comando no navegador (um por
 * Orquestrador) e espera o resultado. A implementação real fala com o
 * aplicativo desktop; os testes usam um falso.
 *
 * @throws ErroDoNavegador quando o comando falha, o navegador está pausado,
 * o tempo acaba, o `sinal` é abortado ou o app desktop não está presente.
 */
export interface ControleDoNavegador {
  executar(orquestradorId: string, comando: ComandoDoNavegador, sinal: AbortSignal): Promise<ResultadoDoComando>;
}
