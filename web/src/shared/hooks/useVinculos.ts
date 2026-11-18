import { useCallback, useEffect, useRef, useState } from "react";

import { api, mensagemDeErro } from "../api/cliente";
import type { VinculoDto } from "../api/tipos";
import { reaproveitarLista } from "./useReaproveitado";

/** A consulta periódica, só enquanto existe algum vínculo (as notas e o fim do vínculo podem mudar por fora). */
export const INTERVALO_DOS_VINCULOS_MS = 5_000;

/**
 * Os vínculos entre orquestradores: lê ao abrir e recarrega a cada ação (as
 * funções devolvidas recarregam sozinhas). Com algum vínculo, consulta de
 * novo a cada poucos segundos; sem nenhum, não consulta (criar um recarrega).
 * Não há canal de eventos para isso no servidor.
 */
export function useVinculos(): {
  vinculos: VinculoDto[];
  erro: string | null;
  recarregar: () => Promise<void>;
  criar: (orquestradorAId: string, orquestradorBId: string) => Promise<void>;
  desfazer: (id: string) => Promise<void>;
  salvarNotas: (id: string, texto: string) => Promise<void>;
  enviarMensagem: (id: string, de: string, texto: string) => Promise<void>;
} {
  const [vinculos, setVinculos] = useState<VinculoDto[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const recarregar = useCallback(async () => {
    try {
      const lista = await api.listarVinculos();
      if (vivo.current) {
        setVinculos((anteriores) => reaproveitarLista(anteriores, lista));
        setErro(null);
      }
    } catch (falha) {
      if (vivo.current) {
        setErro(mensagemDeErro(falha));
      }
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const comVinculos = vinculos.length > 0;
  useEffect(() => {
    if (!comVinculos) {
      return undefined;
    }
    const intervalo = setInterval(() => void recarregar(), INTERVALO_DOS_VINCULOS_MS);
    return () => clearInterval(intervalo);
  }, [comVinculos, recarregar]);

  // Cada ação recarrega a lista depois, dando certo ou não (o outro lado pode ter mudado).
  const aposAcao = useCallback(
    async (acao: () => Promise<unknown>) => {
      try {
        await acao();
      } finally {
        await recarregar();
      }
    },
    [recarregar],
  );

  const criar = useCallback((a: string, b: string) => aposAcao(() => api.criarVinculo(a, b)), [aposAcao]);
  const desfazer = useCallback((id: string) => aposAcao(() => api.desfazerVinculo(id)), [aposAcao]);
  const salvarNotas = useCallback((id: string, texto: string) => aposAcao(() => api.salvarNotasDoVinculo(id, texto)), [aposAcao]);
  const enviarMensagem = useCallback(
    (id: string, de: string, texto: string) => aposAcao(() => api.enviarMensagemDoVinculo(id, de, texto)),
    [aposAcao],
  );

  return { vinculos, erro, recarregar, criar, desfazer, salvarNotas, enviarMensagem };
}
