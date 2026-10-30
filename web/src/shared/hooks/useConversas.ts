import { useEffect, useReducer, useRef, useState } from "react";

import { ConexoesDeEventos, type SituacaoDaConexao } from "../api/ConexoesDeEventos";
import type { EventoRegistrado, SinalDeVida } from "../api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../estado/aplicarEvento";
import { mesmoConteudo } from "./useReaproveitado";

export type { SituacaoDaConexao };

type Acao = { tipo: "evento"; id: string; evento: EventoRegistrado } | { tipo: "esquecer"; id: string };

function reduzir(
  conversas: ReadonlyMap<string, EstadoDaConversa>,
  acao: Acao,
): ReadonlyMap<string, EstadoDaConversa> {
  if (acao.tipo === "esquecer") {
    if (!conversas.has(acao.id)) {
      return conversas;
    }
    const restantes = new Map(conversas);
    restantes.delete(acao.id);
    return restantes;
  }
  const atual = conversas.get(acao.id) ?? ESTADO_INICIAL;
  const proximo = aplicarEvento(atual, acao.evento);
  if (proximo === atual) {
    return conversas;
  }
  return new Map(conversas).set(acao.id, proximo);
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
    const conexoesDeEventos = new ConexoesDeEventos({
      aoReceber: (id, evento) => despachar({ tipo: "evento", id, evento }),
      aoSinal: (id, sinal) =>
        setSinais((atuais) => (mesmoConteudo(atuais.get(id), sinal) ? atuais : new Map(atuais).set(id, sinal))),
      aoMudarSituacao: (id, situacao) => {
        if (situacao === null) {
          despachar({ tipo: "esquecer", id });
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
      ultimaSequencia: (id) => conversasAtuais.current.get(id)?.ultimaSequencia ?? 0,
    });
    gerenciador.current = conexoesDeEventos;
    return () => {
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
