import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { api, mensagemDeErro } from "../api/cliente";
import { ESPERA_PARA_REABRIR_MS, type SituacaoDaConexao } from "../api/ConexoesDeEventos";
import type {
  AtividadeDaResposta,
  EstadoDoChat,
  EventoDoChatRegistrado,
  PreferenciasDoChat,
  TrechoDaResposta,
} from "../api/tipos";
import {
  aplicarAtividadeDoChat,
  aplicarEventoDoChat,
  aplicarTrechoDoChat,
  carregarEstadoDoChat,
  ESTADO_INICIAL_DO_CHAT,
  type EstadoDoChatNaTela,
} from "../estado/aplicarEventoDoChat";

/** O mínimo de um `EventSource` que o chat usa — permite trocar por um falso nos testes. */
export interface FonteDeEventosDoChat {
  readonly readyState: number;
  onopen: ((evento: Event) => unknown) | null;
  onerror: ((evento: Event) => unknown) | null;
  onmessage: ((evento: MessageEvent<string>) => unknown) | null;
  addEventListener(tipo: "trecho" | "atividade", ouvinte: (evento: MessageEvent<string>) => void): void;
  close(): void;
}

/** Igual a `EventSource.CLOSED`, sem depender do objeto global (ausente nos testes). */
const FECHADA = 2;

type Acao =
  | { tipo: "carregado"; estado: EstadoDoChat }
  | { tipo: "evento"; evento: EventoDoChatRegistrado }
  | { tipo: "trecho"; trecho: TrechoDaResposta }
  | { tipo: "atividade"; atividade: AtividadeDaResposta }
  | { tipo: "preferencias"; preferencias: PreferenciasDoChat };

function reduzir(estado: EstadoDoChatNaTela, acao: Acao): EstadoDoChatNaTela {
  switch (acao.tipo) {
    case "carregado":
      return carregarEstadoDoChat(acao.estado);
    case "evento":
      return aplicarEventoDoChat(estado, acao.evento);
    case "trecho":
      return aplicarTrechoDoChat(estado, acao.trecho);
    case "atividade":
      return aplicarAtividadeDoChat(estado, acao.atividade);
    case "preferencias":
      return { ...estado, preferencias: acao.preferencias };
  }
}

function lerJson<Tipo>(mensagem: MessageEvent<string>): Tipo | null {
  try {
    return JSON.parse(mensagem.data) as Tipo;
  } catch {
    return null;
  }
}

export interface ChatAoVivo {
  chat: EstadoDoChatNaTela;
  conexao: SituacaoDaConexao | null;
  /** Falha ao carregar o chat (o hook segue tentando). */
  erro: string | null;
  /** Aplica na hora as preferências que o servidor devolveu (o evento confirma depois). */
  aplicarPreferencias: (preferencias: PreferenciasDoChat) => void;
}

/**
 * O chat rápido ao vivo: carrega o estado (`GET /api/chat`) e assina os
 * eventos a partir da última sequência (`?desde=`).
 *
 * Se a conexão de eventos for abandonada pelo navegador (resposta de erro,
 * como o proxy do Vite com o servidor fora) ou o servidor voltar depois de
 * cair, o estado é recarregado e a assinatura recomeça dali — o texto
 * parcial da resposta em andamento vem pronto no estado.
 */
export function useChat(
  servidorConectado: boolean,
  criarFonte: (endereco: string) => FonteDeEventosDoChat = (endereco) => new EventSource(endereco),
): ChatAoVivo {
  const [chat, despachar] = useReducer(reduzir, ESTADO_INICIAL_DO_CHAT);
  const [conexao, setConexao] = useState<SituacaoDaConexao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fonte = useRef<FonteDeEventosDoChat | null>(null);
  const reabertura = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cada (re)conexão tem um número: a resposta de uma carga antiga não abre fonte.
  const geracao = useRef(0);
  const criar = useRef(criarFonte);
  const conectar = useRef<() => Promise<void>>(async () => undefined);

  const desligar = useCallback(() => {
    if (reabertura.current !== null) {
      clearTimeout(reabertura.current);
      reabertura.current = null;
    }
    fonte.current?.close();
    fonte.current = null;
  }, []);

  const agendarReconexao = useCallback(() => {
    if (reabertura.current !== null) {
      clearTimeout(reabertura.current);
    }
    reabertura.current = setTimeout(() => {
      reabertura.current = null;
      void conectar.current();
    }, ESPERA_PARA_REABRIR_MS);
  }, []);

  const abrir = useCallback(
    (desde: number, minhaGeracao: number) => {
      const nova = criar.current(api.enderecoDosEventosDoChat(desde));
      fonte.current = nova;
      setConexao("conectando");
      nova.onopen = () => setConexao("conectado");
      nova.onerror = () => {
        setConexao("reconectando");
        // Fechada de vez: o navegador desistiu; recarrega e assina de novo.
        if (nova.readyState === FECHADA && fonte.current === nova && geracao.current === minhaGeracao) {
          agendarReconexao();
        }
      };
      nova.onmessage = (mensagem) => {
        const evento = lerJson<EventoDoChatRegistrado>(mensagem);
        if (evento === null) {
          console.error("Evento inválido recebido do chat.");
          return;
        }
        despachar({ tipo: "evento", evento });
      };
      // Passageiros: um trecho ou uma atividade malformados são só ignorados.
      nova.addEventListener("trecho", (mensagem) => {
        const trecho = lerJson<TrechoDaResposta>(mensagem);
        if (trecho !== null) {
          despachar({ tipo: "trecho", trecho });
        }
      });
      nova.addEventListener("atividade", (mensagem) => {
        const atividade = lerJson<AtividadeDaResposta>(mensagem);
        if (atividade !== null) {
          despachar({ tipo: "atividade", atividade });
        }
      });
    },
    [agendarReconexao],
  );

  useEffect(() => {
    conectar.current = async () => {
      geracao.current += 1;
      const minhaGeracao = geracao.current;
      desligar();
      try {
        const estado = await api.lerChat();
        if (geracao.current !== minhaGeracao) {
          return;
        }
        despachar({ tipo: "carregado", estado });
        setErro(null);
        abrir(estado.ultimaSequencia, minhaGeracao);
      } catch (falha) {
        if (geracao.current !== minhaGeracao) {
          return;
        }
        setErro(mensagemDeErro(falha));
        setConexao("reconectando");
        agendarReconexao();
      }
    };
  }, [abrir, agendarReconexao, desligar]);

  // Conecta ao montar e de novo sempre que o servidor volta.
  useEffect(() => {
    if (servidorConectado) {
      void conectar.current();
    }
  }, [servidorConectado]);

  useEffect(
    () => () => {
      geracao.current += 1;
      desligar();
    },
    [desligar],
  );

  const aplicarPreferencias = useCallback(
    (preferencias: PreferenciasDoChat) => despachar({ tipo: "preferencias", preferencias }),
    [],
  );

  return { chat, conexao, erro, aplicarPreferencias };
}
