import { useCallback, useEffect, useRef, useState } from "react";

import { comecarGravacao, type Gravacao } from "./gravacao";
import { AMOSTRAS_MINIMAS, mensagemDoErroDeDitado } from "./texto";
import { transcrever } from "./transcritor";

export type FaseDoDitado = "parado" | "pedindo-microfone" | "gravando" | "transcrevendo";

export interface Ditado {
  fase: FaseDoDitado;
  /** Progresso do primeiro download do modelo (0 a 100), ou null fora dele. */
  baixando: number | null;
  erro: string | null;
  /** Começa a gravar; se já está gravando, para e transcreve. */
  alternar: () => void;
  /** Para a gravação e joga o áudio fora. */
  descartar: () => void;
  fecharErro: () => void;
}

/**
 * Ditado por voz: grava do microfone e transcreve com o Whisper local.
 * O texto chega por `aoTranscrever`, quando a transcrição termina.
 */
export function useDitado(aoTranscrever: (texto: string) => void): Ditado {
  const [fase, setFase] = useState<FaseDoDitado>("parado");
  const [baixando, setBaixando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const gravacao = useRef<Gravacao | null>(null);
  const montado = useRef(true);
  // Sempre a função mais nova: a transcrição termina depois de vários renders.
  const entregar = useRef(aoTranscrever);
  entregar.current = aoTranscrever;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      gravacao.current?.descartar();
      gravacao.current = null;
    };
  }, []);

  const descartar = useCallback(() => {
    gravacao.current?.descartar();
    gravacao.current = null;
    setFase((atual) => (atual === "gravando" ? "parado" : atual));
  }, []);

  const alternar = useCallback(() => {
    if (fase === "parado") {
      setErro(null);
      setFase("pedindo-microfone");
      comecarGravacao().then(
        (nova) => {
          if (!montado.current) {
            nova.descartar();
            return;
          }
          gravacao.current = nova;
          setFase("gravando");
        },
        (motivo: unknown) => {
          if (!montado.current) return;
          setErro(mensagemDoErroDeDitado(motivo));
          setFase("parado");
        },
      );
      return;
    }
    if (fase !== "gravando" || gravacao.current === null) return;

    const atual = gravacao.current;
    gravacao.current = null;
    setFase("transcrevendo");
    void (async () => {
      try {
        const audio = await atual.parar();
        if (audio.length < AMOSTRAS_MINIMAS) return;
        const texto = await transcrever(audio, (progresso) => {
          if (montado.current) setBaixando(progresso < 100 ? progresso : null);
        });
        if (montado.current && texto !== "") entregar.current(texto);
      } catch (motivo) {
        if (montado.current) setErro(mensagemDoErroDeDitado(motivo));
      } finally {
        if (montado.current) {
          setBaixando(null);
          setFase("parado");
        }
      }
    })();
  }, [fase]);

  const fecharErro = useCallback(() => setErro(null), []);

  return { fase, baixando, erro, alternar, descartar, fecharErro };
}
