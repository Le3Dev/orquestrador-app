import { useCallback, useState } from "react";

import { apiDaConfiguracao } from "../ponteDoDesktop";

export interface AjustesDoAplicativo {
  /** A ponte do app desktop deixa reabrir os Ajustes (no navegador, não). */
  disponivel: boolean;
  /** Reabre os Ajustes (pasta dos projetos e Claude Code); se falhar, preenche `erro`. */
  abrir: () => Promise<void>;
  erro: string | null;
  descartarErro: () => void;
}

/**
 * Os Ajustes da primeira abertura (pasta dos projetos e Claude Code), que o
 * app desktop deixa reabrir: o ⚙ da barra de título, o da barra do canvas no
 * navegador e a ação da paleta. Quem usa mostra o `erro`.
 */
export function useAjustesDoAplicativo(): AjustesDoAplicativo {
  const [configuracao] = useState(apiDaConfiguracao);
  const [erro, setErro] = useState<string | null>(null);

  const abrir = useCallback(async () => {
    if (configuracao === null) {
      return;
    }
    setErro(null);
    try {
      await configuracao.abrirAjustes();
    } catch (falha) {
      const motivo = falha instanceof Error ? falha.message : String(falha);
      setErro(`Não foi possível abrir os ajustes de pastas: ${motivo}`);
    }
  }, [configuracao]);

  const descartarErro = useCallback(() => setErro(null), []);

  return { disponivel: configuracao !== null, abrir, erro, descartarErro };
}
