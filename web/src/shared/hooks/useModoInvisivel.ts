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
  /** A escuta do áudio do sistema funciona aqui (só no app desktop no Windows). */
  escutaDisponivel: boolean;
  /** O usuário ligou a escuta pelo botão, fora do modo invisível. */
  escutaManualLigada: boolean;
  /** Liga/desliga a escuta manual (avisa o processo principal antes de marcar o estado). */
  alternarEscutaManual: () => Promise<void>;
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
  /** Quadro atual da tela (botão "capturar agora"); lança se falhar. */
  capturarAgora: () => Promise<CapturaDeTela>;
  /** Assina os quadros do atalho global Ctrl+Shift+S; devolve o cancelamento (no-op no navegador). */
  aoCapturarQuadro: (callback: (captura: CapturaDeTela) => void) => () => void;
}

const SEM_EFEITO: MouseDaArea = { onMouseEnter: () => undefined, onMouseLeave: () => undefined };

/** Estado atual do modo; uma ponte sem a consulta (ou um mock antigo) conta como desligado. */
async function consultarEstado(api: ApiDoModoInvisivel): Promise<boolean> {
  if (typeof api.estaAtivo !== "function") {
    return false;
  }
  return (await api.estaAtivo()) === true;
}

/**
 * O último estado avisado pelo processo principal, por ponte. O aviso só chega
 * a quem já estava montado: quem monta depois (o chat rápido, que sai da coluna
 * fixa para o painel do pé ao entrar no modo) começa por aqui, e não como inativo.
 */
const ultimoEstadoAvisado = new WeakMap<ApiDoModoInvisivel, boolean>();

/** Escuta manual ligada, por ponte: sobrevive à remontagem do chat (fixo/flutuante). */
const escutaManualPorPonte = new WeakMap<ApiDoModoInvisivel, boolean>();

/**
 * O modo invisível do app desktop. O estado vem do aviso do processo principal
 * (que também avisa a saída pelo atalho Ctrl+Shift+I), então todas as telas que
 * usam o hook ficam em sincronia. Ao montar, consulta o estado atual: quem
 * remonta com o modo já ligado (o chat rápido ao alternar fixo/flutuante) não
 * perde o aviso. Fora do desktop, nada faz efeito.
 */
export function useModoInvisivel(): ModoInvisivel {
  const [api] = useState(apiDoModoInvisivel);
  const [ativo, setAtivo] = useState(() => api !== null && ultimoEstadoAvisado.get(api) === true);
  const [comecouAtivo] = useState(ativo);
  const [escutaManualLigada, setEscutaManualLigada] = useState(
    () => api !== null && escutaManualPorPonte.get(api) === true,
  );
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
    let montado = true;
    // Um aviso que chegue antes da resposta da consulta é mais recente: ele vence.
    let avisado = false;
    const cancelar = api.aoMudar((valor) => {
      avisado = true;
      ultimoEstadoAvisado.set(api, valor);
      setAtivo(valor);
    });
    consultarEstado(api)
      .then((valor) => {
        // Sem aviso, `ativo` ainda é o false inicial: só muda se a consulta disser que está ligado.
        if (montado && !avisado && valor) {
          ultimoEstadoAvisado.set(api, true);
          setAtivo(true);
        }
      })
      .catch(() => {
        // Falha na consulta: fica desligado até o próximo aviso do processo principal.
      });
    return () => {
      montado = false;
      cancelar();
    };
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

  const capturarAgora = useCallback(async () => {
    if (api === null) {
      throw new Error("a captura de tela só existe no aplicativo desktop");
    }
    return api.capturarAgora();
  }, [api]);

  const aoCapturarQuadro = useCallback(
    (callback: (captura: CapturaDeTela) => void) => (api === null ? () => undefined : api.aoCapturarQuadro(callback)),
    [api],
  );

  const descartarErro = useCallback(() => setErro(null), []);

  // Primeiro avisa o processo principal e só depois marca o estado: a sessão da
  // escuta pede o getDisplayMedia ao ver o estado, e o clique ainda conta como gesto.
  const alternarEscutaManual = useCallback(async () => {
    if (api === null || typeof api.definirEscutaLigada !== "function") {
      return;
    }
    const ligar = !escutaManualLigada;
    setErro(null);
    try {
      if (ligar) {
        await api.definirEscutaLigada(true);
        escutaManualPorPonte.set(api, true);
        if (montado.current) setEscutaManualLigada(true);
      } else {
        escutaManualPorPonte.set(api, false);
        if (montado.current) setEscutaManualLigada(false);
        await api.definirEscutaLigada(false);
      }
    } catch (falha) {
      setErro(`Não foi possível ${ligar ? "ligar" : "desligar"} a escuta: ${falha instanceof Error ? falha.message : String(falha)}`);
    }
  }, [api, escutaManualLigada]);

  return {
    disponivel: api !== null,
    ativo,
    escutaDisponivel: api !== null && api.escutaDisponivel === true,
    escutaManualLigada,
    alternarEscutaManual,
    entrar,
    sair,
    erro,
    descartarErro,
    mouseDaArea,
    capturarTela,
    capturarAgora,
    aoCapturarQuadro,
  };
}
