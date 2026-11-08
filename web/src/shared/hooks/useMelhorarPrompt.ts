import { useCallback, useEffect, useRef, useState } from "react";

import { api, mensagemDeErro } from "../api/cliente";
import type { OndeDoPrompt } from "../api/tipos";

/**
 * Onde está o "melhorar o pedido" (✨) de um campo:
 * - `ocioso`: nada em andamento;
 * - `melhorando`: o pedido foi ao servidor (o campo fica travado);
 * - `melhorado`: o campo recebeu o texto novo; `original` serve para desfazer;
 * - `erro`: a melhoria falhou e o texto do campo ficou como estava.
 */
export type EstadoDaMelhoria =
  | { fase: "ocioso" }
  | { fase: "melhorando" }
  | { fase: "melhorado"; original: string; melhorado: string; indiceDeCusto: number }
  | { fase: "erro"; mensagem: string; texto: string };

interface Opcoes {
  /** O texto atual do campo. */
  texto: string;
  /** Troca o texto do campo (ao chegar a melhoria e ao desfazer). Não envia nada. */
  aoTrocarTexto: (texto: string) => void;
  onde: OndeDoPrompt;
  /** Só no orquestrador: o nome da pasta do projeto. */
  pasta?: string;
}

export interface MelhoriaDoPrompt {
  estado: EstadoDaMelhoria;
  melhorando: boolean;
  /** Manda o texto do campo para melhorar. Sem texto ou já melhorando, não faz nada. */
  melhorar: () => void;
  /** Aborta a melhoria em andamento; o campo fica como estava. */
  cancelar: () => void;
  /** Volta o texto de antes da melhoria. */
  desfazer: () => void;
}

const OCIOSO: EstadoDaMelhoria = { fase: "ocioso" };

/**
 * O "melhorar o pedido" de um campo de prompt (chat rápido ou terminal do
 * orquestrador). Editar o texto depois da melhoria tira o "desfazer"; editar
 * depois de um erro tira a mensagem. As imagens anexadas não vão na chamada.
 */
export function useMelhorarPrompt({ texto, aoTrocarTexto, onde, pasta }: Opcoes): MelhoriaDoPrompt {
  const [estado, setEstado] = useState<EstadoDaMelhoria>(OCIOSO);
  const controlador = useRef<AbortController | null>(null);
  const textoAtual = useRef(texto);

  useEffect(() => {
    textoAtual.current = texto;
  }, [texto]);

  // Sair da tela no meio da melhoria cancela o pedido.
  useEffect(() => () => controlador.current?.abort(), []);

  // O usuário mexeu no texto: o "desfazer" (ou o erro) deixa de valer.
  if (
    (estado.fase === "melhorado" && texto !== estado.melhorado) ||
    (estado.fase === "erro" && texto !== estado.texto)
  ) {
    setEstado(OCIOSO);
  }

  const melhorar = useCallback((): void => {
    if (texto.trim() === "" || controlador.current !== null) {
      return;
    }
    const atual = new AbortController();
    controlador.current = atual;
    const original = texto;
    setEstado({ fase: "melhorando" });
    void (async () => {
      try {
        const resposta = await api.melhorarPrompt(
          { texto: original, onde, ...(pasta !== undefined && pasta !== "" ? { pasta } : {}) },
          atual.signal,
        );
        if (atual.signal.aborted) {
          return;
        }
        if (resposta.texto.trim() === "") {
          setEstado({ fase: "erro", mensagem: "A melhoria voltou vazia; o texto ficou como estava.", texto: original });
          return;
        }
        // Algo entrou no campo enquanto melhorava (ex.: ditado): não troca por cima.
        if (textoAtual.current !== original) {
          setEstado(OCIOSO);
          return;
        }
        aoTrocarTexto(resposta.texto);
        setEstado({
          fase: "melhorado",
          original,
          melhorado: resposta.texto,
          indiceDeCusto: resposta.indiceDeCusto,
        });
      } catch (falha) {
        if (!atual.signal.aborted) {
          setEstado({
            fase: "erro",
            mensagem: `Não foi possível melhorar o pedido: ${mensagemDeErro(falha)}`,
            texto: original,
          });
        }
      } finally {
        if (controlador.current === atual) {
          controlador.current = null;
        }
      }
    })();
  }, [texto, onde, pasta, aoTrocarTexto]);

  const cancelar = useCallback((): void => {
    controlador.current?.abort();
    controlador.current = null;
    setEstado(OCIOSO);
  }, []);

  const desfazer = useCallback((): void => {
    if (estado.fase === "melhorado") {
      aoTrocarTexto(estado.original);
      setEstado(OCIOSO);
    }
  }, [estado, aoTrocarTexto]);

  return { estado, melhorando: estado.fase === "melhorando", melhorar, cancelar, desfazer };
}
