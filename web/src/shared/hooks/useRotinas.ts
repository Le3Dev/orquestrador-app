import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { ErroDaApi, mensagemDeErro } from "../api/cliente";
import { ESPERA_PARA_REABRIR_MS, type SituacaoDaConexao } from "../api/ConexoesDeEventos";
import {
  type AlteracoesDaRotina,
  apiDasRotinas,
  type DadosDaExecucao,
  type DadosDaRotina,
  type EventoDeRotina,
  execucaoEstaAtiva,
  type NovaRotina,
  type ResumoDaRotina,
  TIPOS_DE_EVENTO_DE_ROTINA,
  type TipoDeEventoDeRotina,
} from "../api/rotinas";
import { reaproveitarLista } from "./useReaproveitado";

/** O mínimo de um `EventSource` que as rotinas usam — permite trocar por um falso nos testes. */
export interface FonteDeEventosDasRotinas {
  readonly readyState: number;
  onopen: ((evento: Event) => unknown) | null;
  onerror: ((evento: Event) => unknown) | null;
  addEventListener(tipo: TipoDeEventoDeRotina, ouvinte: (evento: MessageEvent<string>) => void): void;
  close(): void;
}

/** Uma execução que espera o usuário aprovar ou recusar. */
export interface AprovacaoPendente {
  execucao: DadosDaExecucao;
  rotinaNome: string;
}

export interface RotinasAoVivo {
  /** Na ordem em que foram criadas. */
  lista: readonly ResumoDaRotina[];
  /** A lista já veio do servidor ao menos uma vez. */
  carregada: boolean;
  /** Por que a lista não carregou (o hook segue tentando, cada vez mais devagar). */
  erro: string | null;
  /** O servidor não respondeu a lista (ex.: a rota ainda não existe): a tela mostra "Rotinas indisponíveis". */
  indisponivel: boolean;
  conexao: SituacaoDaConexao | null;
  /** Rotinas ligadas (as que a bandeja do Windows precisa manter rodando). */
  ativas: number;
  /** As execuções que esperam o usuário, na ordem das rotinas. */
  aprovacoesPendentes: readonly AprovacaoPendente[];
  /** Tenta carregar de novo agora (o botão "Tentar de novo"). */
  recarregar: () => void;
  /** POST; a lista já sai com a rotina nova. Rejeita com a mensagem do servidor. */
  criar: (nova: NovaRotina) => Promise<ResumoDaRotina>;
  /** PATCH (inclusive `{ ativa }`); a lista já sai com a rotina alterada. */
  alterar: (id: string, alteracoes: AlteracoesDaRotina) => Promise<ResumoDaRotina>;
  /** DELETE; a rotina sai da lista (já apagada em outro lugar também conta como apagada). */
  apagar: (id: string) => Promise<void>;
  executarAgora: (id: string) => Promise<DadosDaExecucao>;
  aprovar: (execucaoId: string) => Promise<DadosDaExecucao>;
  recusar: (execucaoId: string, motivo?: string) => Promise<DadosDaExecucao>;
  cancelar: (execucaoId: string) => Promise<DadosDaExecucao>;
}

/** Igual a `EventSource.CLOSED`, sem depender do objeto global (ausente nos testes). */
const FECHADA = 2;
/** O teto da espera entre tentativas: com a rota fora do ar, a tela não fica insistindo a cada 3 s. */
export const ESPERA_MAXIMA_PARA_REABRIR_MS = 30_000;

interface Estado {
  lista: readonly ResumoDaRotina[];
  carregada: boolean;
}

type Acao =
  | { tipo: "lista"; lista: ResumoDaRotina[]; recebidosDurante: readonly EventoDeRotina[] }
  | { tipo: "evento"; evento: EventoDeRotina }
  | { tipo: "guardada"; rotina: ResumoDaRotina }
  | { tipo: "removida"; id: string }
  | { tipo: "execucao"; execucao: DadosDaExecucao };

const ESTADO_INICIAL: Estado = { lista: [], carregada: false };

function ordenar(lista: readonly ResumoDaRotina[]): ResumoDaRotina[] {
  return [...lista].sort((a, b) => Date.parse(a.criadaEm) - Date.parse(b.criadaEm) || a.id.localeCompare(b.id));
}

function guardar(lista: readonly ResumoDaRotina[], rotina: ResumoDaRotina): ResumoDaRotina[] {
  return ordenar([...lista.filter((outra) => outra.id !== rotina.id), rotina]);
}

/** Os dados chegam sem a execução ativa (eventos `rotina_*`): ela fica como estava. */
function mesclar(lista: readonly ResumoDaRotina[], dados: DadosDaRotina): ResumoDaRotina[] {
  const execucaoAtiva = lista.find((rotina) => rotina.id === dados.id)?.execucaoAtiva ?? null;
  return guardar(lista, { ...dados, execucaoAtiva });
}

function remover(lista: readonly ResumoDaRotina[], id: string): readonly ResumoDaRotina[] {
  const restantes = lista.filter((rotina) => rotina.id !== id);
  return restantes.length === lista.length ? lista : restantes;
}

/** Guarda a execução na rotina dela: ativa, vira a `execucaoAtiva`; encerrada, só a libera se era a que estava lá. */
function aplicarExecucao(lista: readonly ResumoDaRotina[], execucao: DadosDaExecucao): readonly ResumoDaRotina[] {
  let mudou = false;
  const nova = lista.map((rotina) => {
    if (rotina.id !== execucao.rotinaId) {
      return rotina;
    }
    if (execucaoEstaAtiva(execucao)) {
      mudou = true;
      return { ...rotina, execucaoAtiva: execucao };
    }
    if (rotina.execucaoAtiva?.id === execucao.id) {
      mudou = true;
      return { ...rotina, execucaoAtiva: null };
    }
    return rotina;
  });
  return mudou ? nova : lista;
}

function aplicarNaLista(lista: readonly ResumoDaRotina[], evento: EventoDeRotina): readonly ResumoDaRotina[] {
  switch (evento.tipo) {
    case "rotina_criada":
    case "rotina_alterada":
      return mesclar(lista, evento.rotina);
    case "rotina_removida":
      return remover(lista, evento.id);
    case "execucao_iniciada":
    case "etapa_iniciada":
    case "etapa_concluida":
    case "aguardando_aprovacao":
    case "execucao_encerrada":
      return aplicarExecucao(lista, evento.execucao);
  }
}

function reduzir(estado: Estado, acao: Acao): Estado {
  switch (acao.tipo) {
    case "lista": {
      // Os eventos que chegaram enquanto o GET estava no ar são reaplicados
      // sobre a lista: a resposta pode ter saído antes deles.
      const lista = acao.recebidosDurante.reduce<readonly ResumoDaRotina[]>(aplicarNaLista, ordenar(acao.lista));
      return { lista: reaproveitarLista(estado.lista, [...lista]), carregada: true };
    }
    case "evento":
      return { ...estado, lista: aplicarNaLista(estado.lista, acao.evento) };
    case "guardada":
      return { ...estado, lista: guardar(estado.lista, acao.rotina) };
    case "removida": {
      const lista = remover(estado.lista, acao.id);
      return lista === estado.lista ? estado : { ...estado, lista };
    }
    case "execucao": {
      const lista = aplicarExecucao(estado.lista, acao.execucao);
      return lista === estado.lista ? estado : { ...estado, lista };
    }
  }
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function ehRotina(valor: unknown): valor is DadosDaRotina {
  return ehObjeto(valor) && typeof valor.id === "string" && typeof valor.nome === "string" && Array.isArray(valor.etapas);
}

function ehExecucao(valor: unknown): valor is DadosDaExecucao {
  return (
    ehObjeto(valor) &&
    typeof valor.id === "string" &&
    typeof valor.rotinaId === "string" &&
    typeof valor.situacao === "string" &&
    Array.isArray(valor.resultados)
  );
}

/** O evento nomeado já validado; nulo se o `data` vier malformado. */
function lerEvento(tipo: TipoDeEventoDeRotina, dados: string): EventoDeRotina | null {
  let corpo: unknown;
  try {
    corpo = JSON.parse(dados);
  } catch {
    return null;
  }
  if (!ehObjeto(corpo)) {
    return null;
  }
  switch (tipo) {
    case "rotina_criada":
    case "rotina_alterada":
      return ehRotina(corpo.rotina) ? { tipo, rotina: corpo.rotina } : null;
    case "rotina_removida":
      return typeof corpo.id === "string" ? { tipo, id: corpo.id } : null;
    case "execucao_iniciada":
    case "aguardando_aprovacao":
      return ehExecucao(corpo.execucao) ? { tipo, execucao: corpo.execucao } : null;
    case "etapa_iniciada":
    case "etapa_concluida":
      return ehExecucao(corpo.execucao) && typeof corpo.indice === "number"
        ? { tipo, execucao: corpo.execucao, indice: corpo.indice }
        : null;
    case "execucao_encerrada":
      return ehExecucao(corpo.execucao) && typeof corpo.situacao === "string"
        ? { tipo, execucao: corpo.execucao, situacao: corpo.situacao as DadosDaExecucao["situacao"] }
        : null;
  }
}

function criarFontePadrao(endereco: string): FonteDeEventosDasRotinas | null {
  // Sem `EventSource` (ex.: nos testes do jsdom), a lista só é lida pelo GET.
  return typeof EventSource === "undefined" ? null : new EventSource(endereco);
}

/**
 * As rotinas ao vivo: assina os eventos (`GET /api/rotinas/eventos`, só ao
 * vivo, sem histórico) e, a cada vez que a conexão abre — inclusive quando o
 * navegador reconecta sozinho —, recarrega a lista pelo GET.
 *
 * Se a lista não carregar (a rota ainda não existe, o servidor caiu) ou a
 * conexão for abandonada pelo navegador, a assinatura recomeça do zero, com
 * espera crescente (3 s, 6 s… até 30 s). Enquanto isso `indisponivel` fica
 * verdadeiro e a tela segue de pé.
 */
export function useRotinas(
  servidorConectado: boolean,
  criarFonte: (endereco: string) => FonteDeEventosDasRotinas | null = criarFontePadrao,
): RotinasAoVivo {
  const [estado, despachar] = useReducer(reduzir, ESTADO_INICIAL);
  const [conexao, setConexao] = useState<SituacaoDaConexao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fonte = useRef<FonteDeEventosDasRotinas | null>(null);
  const reabertura = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Quantas tentativas seguidas falharam: define a espera até a próxima.
  const falhas = useRef(0);
  // Cada (re)conexão tem um número: a resposta de uma carga antiga não vale.
  const geracao = useRef(0);
  // Idem para cada carga da lista (a conexão pode abrir de novo com um GET no ar).
  const carga = useRef(0);
  // Os eventos que chegam enquanto o GET está no ar; nulo fora de uma carga.
  const recebidosDuranteACarga = useRef<EventoDeRotina[] | null>(null);
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
    const espera = Math.min(ESPERA_PARA_REABRIR_MS * 2 ** falhas.current, ESPERA_MAXIMA_PARA_REABRIR_MS);
    falhas.current += 1;
    reabertura.current = setTimeout(() => {
      reabertura.current = null;
      conectar.current();
    }, espera);
  }, []);

  const carregarLista = useCallback(
    async (minhaGeracao: number) => {
      carga.current += 1;
      const minhaCarga = carga.current;
      recebidosDuranteACarga.current = [];
      const valeAinda = () => geracao.current === minhaGeracao && carga.current === minhaCarga;
      try {
        const lista = await apiDasRotinas.listar();
        if (!valeAinda()) {
          return;
        }
        despachar({ tipo: "lista", lista, recebidosDurante: recebidosDuranteACarga.current ?? [] });
        recebidosDuranteACarga.current = null;
        falhas.current = 0;
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
      const nova = criar.current(apiDasRotinas.enderecoDosEventos());
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
        // Fechada de vez: o navegador desistiu (ex.: 404 da rota); assina de novo daqui a pouco.
        if (nova.readyState === FECHADA) {
          agendarReconexao();
        }
      };
      for (const tipo of TIPOS_DE_EVENTO_DE_ROTINA) {
        nova.addEventListener(tipo, (mensagem) => {
          if (fonte.current !== nova) {
            return;
          }
          const evento = lerEvento(tipo, mensagem.data);
          if (evento === null) {
            console.error(`Evento de rotina inválido recebido do servidor (${tipo}).`);
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
      falhas.current = 0;
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

  const recarregar = useCallback(() => {
    falhas.current = 0;
    conectar.current();
  }, []);

  const guardar = useCallback((rotina: ResumoDaRotina) => {
    despachar({ tipo: "guardada", rotina });
    return rotina;
  }, []);

  const criarRotina = useCallback(async (nova: NovaRotina) => guardar(await apiDasRotinas.criar(nova)), [guardar]);

  const alterar = useCallback(
    async (id: string, alteracoes: AlteracoesDaRotina) => guardar(await apiDasRotinas.alterar(id, alteracoes)),
    [guardar],
  );

  const apagar = useCallback(async (id: string) => {
    try {
      await apiDasRotinas.apagar(id);
    } catch (falha) {
      // Já apagada (em outra aba, por exemplo): basta tirá-la da tela.
      if (!(falha instanceof ErroDaApi && falha.status === 404)) {
        throw falha;
      }
    }
    despachar({ tipo: "removida", id });
  }, []);

  const guardarExecucao = useCallback((execucao: DadosDaExecucao) => {
    despachar({ tipo: "execucao", execucao });
    return execucao;
  }, []);

  const executarAgora = useCallback(
    async (id: string) => guardarExecucao(await apiDasRotinas.executarAgora(id)),
    [guardarExecucao],
  );
  const aprovar = useCallback(
    async (execucaoId: string) => guardarExecucao(await apiDasRotinas.aprovar(execucaoId)),
    [guardarExecucao],
  );
  const recusar = useCallback(
    async (execucaoId: string, motivo?: string) => guardarExecucao(await apiDasRotinas.recusar(execucaoId, motivo)),
    [guardarExecucao],
  );
  const cancelar = useCallback(
    async (execucaoId: string) => guardarExecucao(await apiDasRotinas.cancelar(execucaoId)),
    [guardarExecucao],
  );

  const aprovacoesPendentes = useMemo(
    () =>
      estado.lista.flatMap((rotina): AprovacaoPendente[] =>
        rotina.execucaoAtiva?.situacao === "aguardando_aprovacao"
          ? [{ execucao: rotina.execucaoAtiva, rotinaNome: rotina.execucaoAtiva.rotinaNome }]
          : [],
      ),
    [estado.lista],
  );
  const ativas = useMemo(() => estado.lista.filter((rotina) => rotina.ativa).length, [estado.lista]);

  return {
    lista: estado.lista,
    carregada: estado.carregada,
    erro,
    indisponivel: !estado.carregada && erro !== null,
    conexao,
    ativas,
    aprovacoesPendentes,
    recarregar,
    criar: criarRotina,
    alterar,
    apagar,
    executarAgora,
    aprovar,
    recusar,
    cancelar,
  };
}
