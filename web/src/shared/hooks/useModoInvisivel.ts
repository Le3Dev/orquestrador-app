import { useCallback, useEffect, useMemo, useState } from "react";

import { apiDoModoInvisivel, type CapturaDeTela } from "../ponteDoDesktop";

export interface MouseDaArea {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export interface ModoInvisivel {
  /** O app desktop oferece o modo invisível (no navegador, não). */
  disponivel: boolean;
  ativo: boolean;
  /** Se entrar ou sair falhar, preenche `erro`. */
  entrar: () => Promise<void>;
  sair: () => Promise<void>;
  erro: string | null;
  descartarErro: () => void;
  /**
   * Para o header e a área do chat: com o modo ativo, o mouse sobre a área faz a
   * janela receber os cliques; fora dela, os cliques atravessam para os apps de trás.
   */
  mouseDaArea: MouseDaArea;
  /** Foto da tela do monitor da janela; lança se a captura falhar. */
  capturarTela: () => Promise<CapturaDeTela>;
}

const SEM_EFEITO: MouseDaArea = { onMouseEnter: () => undefined, onMouseLeave: () => undefined };

/**
 * O modo invisível do app desktop. O estado vem do aviso do processo principal
 * (que também avisa a saída pelo atalho Ctrl+Shift+I), então todas as telas que
 * usam o hook ficam em sincronia. Fora do desktop, nada faz efeito.
 */
export function useModoInvisivel(): ModoInvisivel {
  const [api] = useState(apiDoModoInvisivel);
  const [ativo, setAtivo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (api === null) {
      return undefined;
    }
    return api.aoMudar(setAtivo);
  }, [api]);

  const entrar = useCallback(async () => {
    if (api === null) {
      return;
    }
    setErro(null);
    try {
      await api.entrar();
      // O mouse está sobre o botão: a janela precisa receber o clique de voltar.
      await api.capturarMouse(true);
    } catch (falha) {
      setErro(`Não foi possível entrar no modo invisível: ${falha instanceof Error ? falha.message : String(falha)}`);
    }
  }, [api]);

  const sair = useCallback(async () => {
    if (api === null) {
      return;
    }
    setErro(null);
    try {
      await api.sair();
    } catch (falha) {
      setErro(`Não foi possível sair do modo invisível: ${falha instanceof Error ? falha.message : String(falha)}`);
    }
  }, [api]);

  const mouseDaArea = useMemo<MouseDaArea>(() => {
    if (api === null || !ativo) {
      return SEM_EFEITO;
    }
    return {
      onMouseEnter: () => void api.capturarMouse(true).catch(() => undefined),
      onMouseLeave: () => void api.capturarMouse(false).catch(() => undefined),
    };
  }, [api, ativo]);

  const capturarTela = useCallback(async () => {
    if (api === null) {
      throw new Error("a captura de tela só existe no aplicativo desktop");
    }
    return api.capturarTela();
  }, [api]);

  const descartarErro = useCallback(() => setErro(null), []);

  return { disponivel: api !== null, ativo, entrar, sair, erro, descartarErro, mouseDaArea, capturarTela };
}
