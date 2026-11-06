import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  apiDosArtefatos,
  type EventoDeArtefato,
  type ResumoDoArtefato,
  TIPOS_DE_EVENTO_DE_ARTEFATO,
  type TipoDeEventoDeArtefato,
} from "../api/artefatos";
import { ErroDaApi, mensagemDeErro } from "../api/cliente";
import { ESPERA_PARA_REABRIR_MS, type SituacaoDaConexao } from "../api/ConexoesDeEventos";
import { reaproveitarLista } from "./useReaproveitado";

/** O mínimo de um `EventSource` que os artefatos usam — permite trocar por um falso nos testes. */
export interface FonteDeEventosDosArtefatos {
  readonly readyState: number;
  onopen: ((evento: Event) => unknown) | null;
  onerror: ((evento: Event) => unknown) | null;
  addEventListener(tipo: TipoDeEventoDeArtefato, ouvinte: (evento: MessageEvent<string>) => void): void;
  close(): void;
}

/** Um evento recebido, numerado na ordem de chegada (o número nunca se repete). */
export interface EventoDeArtefatoRecebido {
  numero: number;
  evento: EventoDeArtefato;
}

export interface ArtefatosAoVivo {
  /** Do mais recente (`atualizadoEm`) para o mais antigo. */
  lista: readonly ResumoDoArtefato[];
  /** A lista já veio do servidor ao menos uma vez: só então quem não está nela pode sair do canvas. */
  carregada: boolean;
  /** Por que a lista não carregou (o hook segue tentando). */
  erro: string | null;
  conexao: SituacaoDaConexao | null;
  /** O último evento recebido; o canvas abre a janela de um artefato criado. */
  ultimoEvento: EventoDeArtefatoRecebido | null;
  /**
   * Os últimos eventos, em ordem (até `LIMITE_DE_EVENTOS_RECENTES`): dois
   * eventos que chegam juntos podem cair na mesma renderização, e quem abre
   * janelas não pode perder o primeiro.
   */
  eventosRecentes: readonly EventoDeArtefatoRecebido[];
  /** PATCH do título; a lista já sai com o título novo. Rejeita com a mensagem do servidor. */
  renomear: (artefatoId: string, titulo: string) => Promise<ResumoDoArtefato>;
  /** DELETE; o artefato sai da lista (já apagado em outro lugar também conta como apagado). */
  apagar: (artefatoId: string) => Promise<void>;
}

/** Igual a `EventSource.CLOSED`, sem depender do objeto global (ausente nos testes). */
const FECHADA = 2;
export const LIMITE_DE_EVENTOS_RECENTES = 20;

interface Estado {
  lista: readonly ResumoDoArtefato[];
  carregada: boolean;
  eventos: readonly EventoDeArtefatoRecebido[];
  ultimoNumero: number;
}

type Acao =
  | { tipo: "lista"; lista: ResumoDoArtefato[]; recebidosDurante: readonly EventoDeArtefato[] }
  | { tipo: "evento"; evento: EventoDeArtefato }
  | { tipo: "guardado"; artefato: ResumoDoArtefato }
  | { tipo: "removido"; artefatoId: string };

const ESTADO_INICIAL: Estado = { lista: [], carregada: false, eventos: [], ultimoNumero: 0 };

function ordenar(lista: readonly ResumoDoArtefato[]): ResumoDoArtefato[] {
  return [...lista].sort((a, b) => Date.parse(b.atualizadoEm) - Date.parse(a.atualizadoEm));
}

function guardar(lista: readonly ResumoDoArtefato[], artefato: ResumoDoArtefato): ResumoDoArtefato[] {
  return ordenar([...lista.filter((outro) => outro.id !== artefato.id), artefato]);
}

function remover(lista: readonly ResumoDoArtefato[], artefatoId: string): readonly ResumoDoArtefato[] {
  const restantes = lista.filter((artefato) => artefato.id !== artefatoId);
  return restantes.length === lista.length ? lista : restantes;
}

function aplicarNaLista(lista: readonly ResumoDoArtefato[], evento: EventoDeArtefato): readonly ResumoDoArtefato[] {
  return evento.tipo === "artefato_removido" ? remover(lista, evento.id) : guardar(lista, evento.artefato);
}

function reduzir(estado: Estado, acao: Acao): Estado {
  switch (acao.tipo) {
    case "lista": {
      // Os eventos que chegaram enquanto o GET estava no ar são reaplicados
      // sobre a lista: a resposta pode ter saído antes deles.
      const lista = acao.recebidosDurante.reduce<readonly ResumoDoArtefato[]>(aplicarNaLista, ordenar(acao.lista));
      return { ...estado, lista: reaproveitarLista(estado.lista, [...lista]), carregada: true };
    }
    case "evento": {
      const numero = estado.ultimoNumero + 1;
      return {
        lista: aplicarNaLista(estado.lista, acao.evento),
        carregada: estado.carregada,
        eventos: [...estado.eventos, { numero, evento: acao.evento }].slice(-LIMITE_DE_EVENTOS_RECENTES),
        ultimoNumero: numero,
      };
    }
    case "guardado":
      return { ...estado, lista: guardar(estado.lista, acao.artefato) };
    case "removido": {
      const lista = remover(estado.lista, acao.artefatoId);
      return lista === estado.lista ? estado : { ...estado, lista };
    }
  }
}

function ehResumo(valor: unknown): valor is ResumoDoArtefato {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const { id, versaoAtual, versoes } = valor as Record<string, unknown>;
  return typeof id === "string" && typeof versaoAtual === "number" && Array.isArray(versoes);
}

/** O evento nomeado já validado; nulo se o `data` vier malformado. */
function lerEvento(tipo: TipoDeEventoDeArtefato, dados: string): EventoDeArtefato | null {
  let corpo: unknown;
  try {
    corpo = JSON.parse(dados);
  } catch {
    return null;
  }
  if (typeof corpo !== "object" || corpo === null) {
    return null;
  }
  if (tipo === "artefato_removido") {
    const { id } = corpo as { id?: unknown };
    return typeof id === "string" ? { tipo, id } : null;
  }
  const { artefato } = corpo as { artefato?: unknown };
  return ehResumo(artefato) ? { tipo, artefato } : null;
}

function criarFontePadrao(endereco: string): FonteDeEventosDosArtefatos | null {
  // Sem `EventSource` (ex.: nos testes do jsdom), a lista só é lida pelo GET.
  return typeof EventSource === "undefined" ? null : new EventSource(endereco);
}

/**
 * Os artefatos ao vivo: assina os eventos (`GET /api/artefatos/eventos`, só
 * ao vivo, sem histórico) e, a cada vez que a conexão abre — inclusive quando
 * o navegador reconecta sozinho —, recarrega a lista pelo GET.
 *
 * Se a conexão for abandonada pelo navegador (resposta de erro, como o proxy
 * do Vite com o servidor fora), se a lista não carregar, ou se o servidor
 * voltar depois de cair, a assinatura recomeça do zero.
 */
export function useArtefatos(
  servidorConectado: boolean,
  criarFonte: (endereco: string) => FonteDeEventosDosArtefatos | null = criarFontePadrao,
): ArtefatosAoVivo {
  const [estado, despachar] = useReducer(reduzir, ESTADO_INICIAL);
  const [conexao, setConexao] = useState<SituacaoDaConexao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fonte = useRef<FonteDeEventosDosArtefatos | null>(null);
  const reabertura = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cada (re)conexão tem um número: a resposta de uma carga antiga não vale.
  const geracao = useRef(0);
  // Idem para cada carga da lista (a conexão pode abrir de novo com um GET no ar).
  const carga = useRef(0);
  // Os eventos que chegam enquanto o GET está no ar; nulo fora de uma carga.
  const recebidosDuranteACarga = useRef<EventoDeArtefato[] | null>(null);
  const criar = useRef(criarFonte);
  const conectar = useRef<() => void>(() => undefined);

  const desligar = useCallback(() => {
    if (reabertura.current !== null) {
      clearTimeout(reabertura.current);
      reabertura.current = null;
    }
    fonte.current?.close();
    fonte.current = null;
    recebidosDuranteACarga.current = null;
  }, []);

  const agendarReconexao = useCallback(() => {
    if (reabertura.current !== null) {
      clearTimeout(reabertura.current);
    }
    reabertura.current = setTimeout(() => {
      reabertura.current = null;
      conectar.current();
    }, ESPERA_PARA_REABRIR_MS);
  }, []);

  const carregarLista = useCallback(
    async (minhaGeracao: number) => {
      carga.current += 1;
      const minhaCarga = carga.current;
      recebidosDuranteACarga.current = [];
      const valeAinda = () => geracao.current === minhaGeracao && carga.current === minhaCarga;
      try {
        const lista = await apiDosArtefatos.listar();
        if (!valeAinda()) {
          return;
        }
        despachar({ tipo: "lista", lista, recebidosDurante: recebidosDuranteACarga.current ?? [] });
        recebidosDuranteACarga.current = null;
        setErro(null);
      } catch (falha) {
        if (!valeAinda()) {
          return;
        }
        recebidosDuranteACarga.current = null;
        setErro(mensagemDeErro(falha));
        agendarReconexao();
      }
    },
    [agendarReconexao],
  );

  useEffect(() => {
    conectar.current = () => {
      geracao.current += 1;
      const minhaGeracao = geracao.current;
      desligar();
      const nova = criar.current(apiDosArtefatos.enderecoDosEventos());
      if (nova === null) {
        void carregarLista(minhaGeracao);
        return;
      }
      fonte.current = nova;
      setConexao("conectando");
      nova.onopen = () => {
        if (fonte.current !== nova) {
          return;
        }
        setConexao("conectado");
        // Os eventos não têm histórico: o que mudou enquanto estava fora vem pela lista.
        void carregarLista(minhaGeracao);
      };
      nova.onerror = () => {
        if (fonte.current !== nova) {
          return;
        }
        setConexao("reconectando");
        // Fechada de vez: o navegador desistiu; assina de novo daqui a pouco.
        if (nova.readyState === FECHADA) {
          agendarReconexao();
        }
      };
      for (const tipo of TIPOS_DE_EVENTO_DE_ARTEFATO) {
        nova.addEventListener(tipo, (mensagem) => {
          if (fonte.current !== nova) {
            return;
          }
          const evento = lerEvento(tipo, mensagem.data);
          if (evento === null) {
            console.error(`Evento de artefato inválido recebido do servidor (${tipo}).`);
            return;
          }
          recebidosDuranteACarga.current?.push(evento);
          despachar({ tipo: "evento", evento });
        });
      }
    };
  }, [agendarReconexao, carregarLista, desligar]);

  // Conecta ao montar e de novo sempre que o servidor volta.
  useEffect(() => {
    if (servidorConectado) {
      conectar.current();
    }
  }, [servidorConectado]);

  useEffect(
    () => () => {
      geracao.current += 1;
      desligar();
    },
    [desligar],
  );

  const renomear = useCallback(async (artefatoId: string, titulo: string) => {
    const artefato = await apiDosArtefatos.renomear(artefatoId, titulo);
    despachar({ tipo: "guardado", artefato });
    return artefato;
  }, []);

  const apagar = useCallback(async (artefatoId: string) => {
    try {
      await apiDosArtefatos.apagar(artefatoId);
    } catch (falha) {
      // Já apagado (em outra aba, por exemplo): basta tirá-lo da tela.
      if (!(falha instanceof ErroDaApi && falha.status === 404)) {
        throw falha;
      }
    }
    despachar({ tipo: "removido", artefatoId });
  }, []);

  return {
    lista: estado.lista,
    carregada: estado.carregada,
    erro,
    conexao,
    ultimoEvento: estado.eventos.at(-1) ?? null,
    eventosRecentes: estado.eventos,
    renomear,
    apagar,
  };
}
