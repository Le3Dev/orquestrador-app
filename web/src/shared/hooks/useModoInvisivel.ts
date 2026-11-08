import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type ApiDoModoInvisivel, apiDoModoInvisivel, type CapturaDeTela } from "../ponteDoDesktop";

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
 * O último estado avisado pelo processo principal, por ponte. O aviso só chega
 * a quem já estava montado: quem monta depois (o chat rápido, que sai da coluna
 * fixa para o painel do pé ao entrar no modo) começa por aqui, e não como inativo.
 */
const ultimoEstadoAvisado = new WeakMap<ApiDoModoInvisivel, boolean>();

/**
 * O modo invisível do app desktop. O estado vem do aviso do processo principal
 * (que também avisa a saída pelo atalho Ctrl+Shift+I), então todas as telas que
 * usam o hook ficam em sincronia. Fora do desktop, nada faz efeito.
 */
export function useModoInvisivel(): ModoInvisivel {
  const [api] = useState(apiDoModoInvisivel);
  const [ativo, setAtivo] = useState(() => api !== null && ultimoEstadoAvisado.get(api) === true);
  const [comecouAtivo] = useState(ativo);
  const [erro, setErro] = useState<string | null>(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Montado já com o modo ativo (o chat que trocou de lugar ao entrar): o mouse
  // não está sobre a área nova, então os cliques voltam a passar; passar o mouse
  // sobre ela liga a captura de novo.
  useEffect(() => {
    if (api !== null && comecouAtivo) {
      void api.capturarMouse(false).catch(() => undefined);
    }
  }, [api, comecouAtivo]);

  useEffect(() => {
    if (api === null) {
      return undefined;
    }
    return api.aoMudar((novo) => {
      ultimoEstadoAvisado.set(api, novo);
      setAtivo(novo);
    });
  }, [api]);

  const entrar = useCallback(async () => {
    if (api === null) {
      return;
    }
    setErro(null);
    try {
      await api.entrar();
      // O mouse está sobre o botão: a janela precisa receber o clique de voltar.
      // Se o chat já trocou de lugar (desmontou este), quem montou cuida do mouse.
      if (montado.current) {
        await api.capturarMouse(true);
      }
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
