import { type Dispatch, type SetStateAction, useCallback, useEffect } from "react";

import { TAMANHO_DO_NAVEGADOR, type Ponto } from "../canvas/layout";
import { comNavegadorAberto, idDoNoDoNavegador, navegadorAberto, type NoDoCanvas, semNavegador } from "../canvas/nos";
import { apiDoNavegadorDoAgente } from "../canvas/ponteDoNavegador";

export interface DependenciasDosNavegadores {
  setNos: Dispatch<SetStateAction<NoDoCanvas[]>>;
  /** Os nós do canvas agora (lidos na hora, para as ações e o aviso do app não mudarem a cada arraste). */
  lerNos: () => readonly NoDoCanvas[];
  /** Onde abrir a janela quando o terminal do Orquestrador não está no canvas (o centro da área visível). */
  posicaoNoCentroVisivel: (atuais: readonly NoDoCanvas[], tamanho: { largura: number; altura: number }) => Ponto;
  /** Leva a câmera até os nós, sem aproximar além do zoom atual. */
  enquadrarSemAproximar: (ids: readonly string[]) => void;
}

export interface AcoesDosNavegadores {
  /** Abre (ou, já aberto, seleciona e leva a câmera até) o navegador do agente de um Orquestrador. */
  abrirNavegador: (orquestradorId: string) => void;
  /** Fecha a janela no canvas: a vista desce, e o agente segue podendo usar o navegador. */
  fecharNavegador: (orquestradorId: string) => void;
}

/**
 * O navegador do agente no canvas (app desktop): um nó por Orquestrador, ligado ao terminal dele.
 *
 * - O app avisa (`aoAtivar`) quando o agente usa o navegador pela primeira vez (ou de novo, depois de fechado):
 *   o nó abre sozinho, ao lado do terminal e num lugar livre, e a câmera vai até ele.
 * - Ao carregar a tela, o app diz quais navegadores já estão abertos (`estados`) e os nós que faltam abrem em
 *   silêncio (sem mexer na seleção nem na câmera).
 * - O botão do terminal abre ou foca o nó; o ✕ do nó fecha só a janela.
 *
 * Fora do app desktop (sem a ponte), não há o que ouvir: só as duas ações, que a tela usa à vontade.
 */
export function useNavegadoresDoAgente({
  setNos,
  lerNos,
  posicaoNoCentroVisivel,
  enquadrarSemAproximar,
}: DependenciasDosNavegadores): AcoesDosNavegadores {
  const posicaoDeReserva = useCallback(
    (atuais: readonly NoDoCanvas[]) => posicaoNoCentroVisivel(atuais, TAMANHO_DO_NAVEGADOR),
    [posicaoNoCentroVisivel],
  );

  const abrirNavegador = useCallback(
    (orquestradorId: string) => {
      setNos((atuais) => comNavegadorAberto(atuais, orquestradorId, posicaoDeReserva, true));
      enquadrarSemAproximar([orquestradorId, idDoNoDoNavegador(orquestradorId)]);
    },
    [enquadrarSemAproximar, posicaoDeReserva, setNos],
  );

  const fecharNavegador = useCallback(
    (orquestradorId: string) => setNos((atuais) => semNavegador(atuais, orquestradorId)),
    [setNos],
  );

  useEffect(() => {
    const api = apiDoNavegadorDoAgente();
    if (api === null) {
      return undefined;
    }
    let ativo = true;
    const cancelar = api.aoAtivar(({ orquestradorId }) => {
      // Já aberto, o usuário já o tem à vista (ou o fechou de propósito: o botão do terminal o traz de volta).
      if (navegadorAberto(lerNos(), orquestradorId)) {
        return;
      }
      abrirNavegador(orquestradorId);
    });
    api
      .estados()
      .then((abertos) => {
        if (!ativo || abertos.length === 0) {
          return;
        }
        setNos((atuais) =>
          abertos.reduce(
            (restantes, aberto) => comNavegadorAberto(restantes, aberto.orquestradorId, posicaoDeReserva, false),
            atuais,
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
      cancelar();
    };
  }, [abrirNavegador, lerNos, posicaoDeReserva, setNos]);

  return { abrirNavegador, fecharNavegador };
}
