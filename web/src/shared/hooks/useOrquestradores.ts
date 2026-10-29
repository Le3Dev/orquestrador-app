import { useCallback, useEffect, useState } from "react";

import { api, mensagemDeErro } from "../api/cliente";
import type { ResumoDoOrquestrador } from "../api/tipos";

const INTERVALO_DE_ATUALIZACAO_MS = 4_000;

/**
 * Lista de Orquestradores para a barra lateral.
 *
 * Atualiza por consulta periódica, e não por SSE: a lista só precisa mostrar
 * quem está trabalhando, e alguns segundos de atraso ali não atrapalham —
 * o acompanhamento ao vivo fica na janela de cada Orquestrador.
 */
export function useOrquestradores(): {
  orquestradores: ResumoDoOrquestrador[] | null;
  erro: string | null;
  recarregar: () => Promise<void>;
} {
  const [orquestradores, setOrquestradores] = useState<ResumoDoOrquestrador[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setOrquestradores(await api.listarOrquestradores());
      setErro(null);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }, []);

  useEffect(() => {
    void recarregar();
    const intervalo = setInterval(() => void recarregar(), INTERVALO_DE_ATUALIZACAO_MS);
    return () => clearInterval(intervalo);
  }, [recarregar]);

  return { orquestradores, erro, recarregar };
}
