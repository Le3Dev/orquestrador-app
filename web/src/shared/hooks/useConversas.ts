import { useEffect, useReducer, useRef, useState } from "react";

import { ConexoesDeEventos, type SituacaoDaConexao } from "../api/ConexoesDeEventos";
import type { EventoRegistrado, SinalDeVida } from "../api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../estado/aplicarEvento";
import { mesmoConteudo } from "./useReaproveitado";

export type { SituacaoDaConexao };

type ItemDaFila = { tipo: "evento"; id: string; evento: EventoRegistrado } | { tipo: "esquecer"; id: string };

/** Reserva da descarga quando o quadro não vem (janela oculta: o navegador não roda `requestAnimationFrame`). */
export const RESERVA_DA_DESCARGA_MS = 50;

/**
 * Aplica o lote na ordem em que chegou, a partir do mesmo estado, e cria o
 * mapa uma vez só (nenhum, se nada mudou).
 */
function reduzir(
  conversas: ReadonlyMap<string, EstadoDaConversa>,
  lote: readonly ItemDaFila[],
): ReadonlyMap<string, EstadoDaConversa> {
  let proximas: Map<string, EstadoDaConversa> | null = null;
  for (const item of lote) {
    const atuais = proximas ?? conversas;
    if (item.tipo === "esquecer") {
      if (atuais.has(item.id)) {
        proximas ??= new Map(conversas);
        proximas.delete(item.id);
      }
      continue;
    }
    const atual = atuais.get(item.id) ?? ESTADO_INICIAL;
    const proximo = aplicarEvento(atual, item.evento);
    if (proximo !== atual) {
      proximas ??= new Map(conversas);
      proximas.set(item.id, proximo);
    }
  }
  return proximas ?? conversas;
}

/**
 * Conversas ao vivo dos Orquestradores com terminal aberto no canvas.
 *
 * Fechar o terminal fecha a conexão; reabrir reconstrói a conversa a partir do
 * histórico do servidor. Quando o servidor volta depois de cair
 * (`servidorConectado` passa a verdadeiro), as conexões abandonadas são
 * reabertas na hora, retomando do último evento recebido.
 */
export function useConversas(
  ids: readonly string[],
  servidorConectado: boolean,
): {
  conversas: ReadonlyMap<string, EstadoDaConversa>;
  conexoes: ReadonlyMap<string, SituacaoDaConexao>;
  /** Último sinal de vida de cada Orquestrador (passageiro, fora do histórico). */
  sinais: ReadonlyMap<string, SinalDeVida>;
} {
  const [conversas, despachar] = useReducer(reduzir, new Map<string, EstadoDaConversa>());
  const [conexoes, setConexoes] = useState<ReadonlyMap<string, SituacaoDaConexao>>(new Map());
  const [sinais, setSinais] = useState<ReadonlyMap<string, SinalDeVida>>(new Map());
  const conversasAtuais = useRef(conversas);
  const gerenciador = useRef<ConexoesDeEventos | null>(null);
  // Chave estável: o conjunto de ids, não a ordem nem a identidade do array.
  const chave = [...new Set(ids)].sort().join("|");

  useEffect(() => {
    conversasAtuais.current = conversas;
  }, [conversas]);

  useEffect(() => {
    // Os eventos e os sinais esperam numa fila e entram na tela uma vez por
    // quadro, num commit só: ao abrir, o histórico chega em milhares de
    // mensagens, e uma atualização por mensagem renderizava o canvas inteiro
    // a cada uma. A ordem de chegada é mantida.
    let fila: ItemDaFila[] = [];
    let sinaisPendentes = new Map<string, SinalDeVida>();
    let quadro: number | null = null;
    let reserva: ReturnType<typeof setTimeout> | null = null;

    const cancelarDescarga = () => {
      if (quadro !== null) {
        cancelAnimationFrame(quadro);
        quadro = null;
      }
      if (reserva !== null) {
        clearTimeout(reserva);
        reserva = null;
      }
    };

    const descarregar = () => {
      cancelarDescarga();
      if (fila.length > 0) {
        const lote = fila;
        fila = [];
        despachar(lote);
      }
      if (sinaisPendentes.size > 0) {
        const pendentes = sinaisPendentes;
        sinaisPendentes = new Map();
        setSinais((atuais) => {
          let proximos: Map<string, SinalDeVida> | null = null;
          for (const [id, sinal] of pendentes) {
            if (!mesmoConteudo((proximos ?? atuais).get(id), sinal)) {
              proximos ??= new Map(atuais);
              proximos.set(id, sinal);
            }
          }
          return proximos ?? atuais;
        });
      }
    };

    // O quadro e, de reserva, um timer: o primeiro que vier descarrega e cancela o outro.
    const agendarDescarga = () => {
      if (quadro === null && typeof requestAnimationFrame === "function") {
        quadro = requestAnimationFrame(() => {
          quadro = null;
          descarregar();
        });
      }
      reserva ??= setTimeout(() => {
        reserva = null;
        descarregar();
      }, RESERVA_DA_DESCARGA_MS);
    };

    const conexoesDeEventos = new ConexoesDeEventos({
      aoReceber: (id, evento) => {
        fila.push({ tipo: "evento", id, evento });
        agendarDescarga();
      },
      // Só o último sinal de cada um importa: é o que a tela mostra.
      aoSinal: (id, sinal) => {
        sinaisPendentes.set(id, sinal);
        agendarDescarga();
      },
      aoMudarSituacao: (id, situacao) => {
        if (situacao === null) {
          // Esquecer vale na hora, como antes, e depois dos eventos que já chegaram dele.
          fila.push({ tipo: "esquecer", id });
          descarregar();
        }
        setConexoes((atuais) => {
          // Sem mudança (ex.: "reconectando" a cada nova tentativa), sem mapa novo.
          if ((atuais.get(id) ?? null) === situacao) {
            return atuais;
          }
          const proximas = new Map(atuais);
          if (situacao === null) {
            proximas.delete(id);
          } else {
            proximas.set(id, situacao);
          }
          return proximas;
        });
      },
      // Conta também o que ainda espera na fila, para não pedir de novo o que já chegou.
      ultimaSequencia: (id) =>
        fila.reduce(
          (maior, item) => (item.tipo === "evento" && item.id === id ? Math.max(maior, item.evento.sequencia) : maior),
          conversasAtuais.current.get(id)?.ultimaSequencia ?? 0,
        ),
    });
    gerenciador.current = conexoesDeEventos;
    return () => {
      cancelarDescarga();
      fila = [];
      sinaisPendentes = new Map();
      conexoesDeEventos.fecharTodas();
      gerenciador.current = null;
    };
  }, []);

  useEffect(() => {
    gerenciador.current?.sincronizar(new Set(chave === "" ? [] : chave.split("|")));
  }, [chave]);

  useEffect(() => {
    if (servidorConectado) {
      gerenciador.current?.reabrirAbandonadas();
    }
  }, [servidorConectado]);

  return { conversas, conexoes, sinais };
}
