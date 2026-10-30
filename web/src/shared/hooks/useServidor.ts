import { useEffect, useRef, useState } from "react";

import { api } from "../api/cliente";
import type { LeituraDeMemoria } from "../api/tipos";
import { mesmoConteudo } from "./useReaproveitado";

export const INTERVALO_DA_VERIFICACAO_MS = 3_000;

export interface EstadoDoServidor {
  conectado: boolean;
  /** Quando a queda foi percebida; nulo enquanto conectado. */
  caiuEm: Date | null;
  /** Quando voltou da última queda (ou de um reinício percebido). */
  voltouEm: Date | null;
  /** O servidor que voltou é outro processo: os pedidos que rodavam foram interrompidos. */
  reiniciou: boolean;
  /** Última medição de memória do computador e dos agentes. */
  memoria: LeituraDeMemoria | null;
}

/**
 * Acompanha se o servidor está no ar, consultando `/api/saude` a cada poucos
 * segundos.
 *
 * Só uma consulta por vez: se uma demorar, a próxima espera — com vários
 * terminais abertos, o navegador pode segurar requisições na fila, e isso não
 * pode virar um falso "desconectado".
 */
export function useServidor(): EstadoDoServidor {
  const [estado, setEstado] = useState<EstadoDoServidor>({
    conectado: true,
    caiuEm: null,
    voltouEm: null,
    reiniciou: false,
    memoria: null,
  });
  const iniciadoEm = useRef<string | null>(null);
  const consultando = useRef(false);

  useEffect(() => {
    let ativo = true;

    const verificar = async (): Promise<void> => {
      if (consultando.current) {
        return;
      }
      consultando.current = true;
      try {
        const saude = await api.saude();
        if (!ativo) {
          return;
        }
        if (!saude.ok) {
          throw new Error("O servidor respondeu, mas não está pronto.");
        }
        const reiniciou = iniciadoEm.current !== null && iniciadoEm.current !== saude.iniciadoEm;
        iniciadoEm.current = saude.iniciadoEm;
        const memoria = saude.memoria ?? null;
        // A memória é medida a cada poucos segundos no servidor: entre uma
        // medição e outra a resposta é a mesma, e o estado não deve mudar.
        setEstado((atual) =>
          atual.conectado && !reiniciou
            ? mesmoConteudo(atual.memoria, memoria)
              ? atual
              : { ...atual, memoria }
            : {
                conectado: true,
                caiuEm: null,
                voltouEm: new Date(),
                reiniciou: reiniciou || atual.reiniciou,
                memoria,
              },
        );
      } catch {
        if (ativo) {
          setEstado((atual) =>
            atual.conectado
              ? { conectado: false, caiuEm: new Date(), voltouEm: null, reiniciou: false, memoria: null }
              : atual,
          );
        }
      } finally {
        consultando.current = false;
      }
    };

    void verificar();
    const intervalo = setInterval(() => void verificar(), INTERVALO_DA_VERIFICACAO_MS);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, []);

  return estado;
}
