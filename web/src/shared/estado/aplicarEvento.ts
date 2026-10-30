import type {
  DadosDaConfiguracao,
  DadosDoAnexo,
  DecisaoDoPlano,
  EventoRegistrado,
  JanelaDaCota,
  ModoDoTurno,
  SituacaoDoSubagente,
  SituacaoDoTurno,
  UsoDoTurno,
} from "../api/tipos";
import { formatarDuracao, formatarTokens, idCurto } from "../formatacao";

export interface SubagenteNaTela {
  id: string;
  descricao: string;
  tarefa: string;
  situacao: SituacaoDoSubagente;
  iniciadoEm: string;
  encerradoEm: string | null;
  atividade: string;
  ultimaFerramenta: string | null;
  tokens: number;
  ferramentasUsadas: number;
  duracaoMs: number;
  resumo: string;
  resultado: string | null;
  textos: string[];
}

export interface AcaoRegistrada {
  ferramenta: string;
  detalhe: string;
}

export type TipoDeLinhaDoLog = "sistema" | "spawn" | "ferramenta" | "texto" | "fim" | "erro";

/** Uma linha do terminal de eventos do turno. `origem` é "orquestrador" ou o id de um Subagente. */
export interface LinhaDoLog {
  sequencia: number;
  em: string;
  origem: string;
  tipo: TipoDeLinhaDoLog;
  texto: string;
}

/** O terminal mostra o fim do log; guardar mais que isso só pesaria a tela. */
const LIMITE_DO_LOG = 300;

export interface TurnoNaTela {
  id: string;
  texto: string;
  anexos: DadosDoAnexo[];
  /** Instante do último evento do turno — junto com os sinais de vida, mostra se ele segue vivo. */
  ultimaAtividadeEm: string;
  iniciadoEm: string;
  encerradoEm: string | null;
  situacao: SituacaoDoTurno;
  configuracao: DadosDaConfiguracao;
  /** Em "planejamento" (Plan Mode), a resposta é um plano à espera de decisão. */
  modo: ModoDoTurno;
  /** Nulo fora do planejamento e enquanto o plano não fica pronto. */
  decisaoDoPlano: DecisaoDoPlano | null;
  textosDoOrquestrador: string[];
  resposta: string | null;
  motivoDaFalha: string | null;
  uso: UsoDoTurno | null;
  subagentes: SubagenteNaTela[];
  /** Ferramentas que o Orquestrador usou ele mesmo, em vez de delegar. */
  ferramentasDiretas: AcaoRegistrada[];
  permissoesNegadas: AcaoRegistrada[];
  log: LinhaDoLog[];
}

export interface EstadoDaConversa {
  ultimaSequencia: number;
  turnos: TurnoNaTela[];
  cota: JanelaDaCota[] | null;
}

export const ESTADO_INICIAL: EstadoDaConversa = { ultimaSequencia: 0, turnos: [], cota: null };

type AlteracaoDeTurno = (turno: TurnoNaTela) => TurnoNaTela;

function alterarSubagente(
  turno: TurnoNaTela,
  subagenteId: string,
  alteracao: (subagente: SubagenteNaTela) => SubagenteNaTela,
): TurnoNaTela {
  return {
    ...turno,
    subagentes: turno.subagentes.map((subagente) => (subagente.id === subagenteId ? alteracao(subagente) : subagente)),
  };
}

function encerrar(turno: TurnoNaTela, situacao: SituacaoDoTurno, em: string): TurnoNaTela {
  return {
    ...turno,
    situacao,
    encerradoEm: em,
    subagentes: turno.subagentes.map((subagente) =>
      subagente.situacao === "executando" ? { ...subagente, situacao: "cancelado", encerradoEm: em } : subagente,
    ),
  };
}

function primeiraLinha(texto: string, limite = 110): string {
  const linha = texto.trim().split("\n")[0] ?? "";
  return linha.length > limite ? `${linha.slice(0, limite)}…` : linha;
}

/** O que cada evento muda no turno a que pertence. */
function alteracaoDoTurno(evento: EventoRegistrado): AlteracaoDeTurno | null {
  switch (evento.tipo) {
    case "texto_do_orquestrador":
      return (turno) => ({ ...turno, textosDoOrquestrador: [...turno.textosDoOrquestrador, evento.texto] });

    case "ferramenta_do_orquestrador":
      return (turno) => ({
        ...turno,
        ferramentasDiretas: [...turno.ferramentasDiretas, { ferramenta: evento.ferramenta, detalhe: evento.detalhe }],
      });

    case "permissao_negada":
      return (turno) => ({
        ...turno,
        permissoesNegadas: [...turno.permissoesNegadas, { ferramenta: evento.ferramenta, detalhe: evento.detalhe }],
      });

    case "subagente_iniciado":
      return (turno) => ({
        ...turno,
        subagentes: [
          ...turno.subagentes,
          {
            id: evento.subagenteId,
            descricao: evento.descricao,
            tarefa: evento.tarefa,
            situacao: "executando",
            iniciadoEm: evento.em,
            encerradoEm: null,
            atividade: "",
            ultimaFerramenta: null,
            tokens: 0,
            ferramentasUsadas: 0,
            duracaoMs: 0,
            resumo: "",
            resultado: null,
            textos: [],
          },
        ],
      });

    case "progresso_do_subagente":
      return (turno) =>
        alterarSubagente(turno, evento.subagenteId, (subagente) => ({
          ...subagente,
          atividade: evento.atividade,
          ultimaFerramenta: evento.ultimaFerramenta,
          tokens: evento.tokens,
          ferramentasUsadas: evento.ferramentasUsadas,
          duracaoMs: evento.duracaoMs,
        }));

    case "texto_do_subagente":
      return (turno) =>
        alterarSubagente(turno, evento.subagenteId, (subagente) => ({
          ...subagente,
          textos: [...subagente.textos, evento.texto],
        }));

    case "subagente_concluido":
      return (turno) =>
        alterarSubagente(turno, evento.subagenteId, (subagente) => ({
          ...subagente,
          situacao: evento.situacao,
          encerradoEm: evento.em,
          resumo: evento.resumo,
          tokens: evento.tokens,
          duracaoMs: evento.duracaoMs,
        }));

    case "resultado_do_subagente":
      return (turno) =>
        alterarSubagente(turno, evento.subagenteId, (subagente) => ({ ...subagente, resultado: evento.resultado }));

    case "turno_concluido":
      return (turno) => ({
        ...encerrar(turno, "concluido", evento.em),
        resposta: evento.resposta,
        uso: evento.uso,
        // O plano entregue fica esperando o usuário aprovar ou descartar.
        decisaoDoPlano: turno.modo === "planejamento" ? "pendente" : turno.decisaoDoPlano,
        // A resposta final também chega como último texto do orquestrador;
        // sem este filtro ela apareceria duas vezes.
        textosDoOrquestrador: turno.textosDoOrquestrador.filter((texto) => texto.trim() !== evento.resposta.trim()),
      });

    case "plano_aprovado":
      return (turno) => ({ ...turno, decisaoDoPlano: "aprovado" });

    case "plano_descartado":
      return (turno) => ({ ...turno, decisaoDoPlano: "descartado" });

    case "turno_cancelado":
      return (turno) => encerrar(turno, "cancelado", evento.em);

    case "turno_interrompido":
      return (turno) => encerrar(turno, "interrompido", evento.em);

    case "turno_falhou":
      return (turno) => ({ ...encerrar(turno, "falhou", evento.em), motivoDaFalha: evento.motivo });

    default:
      return null;
  }
}

/**
 * A linha que o evento deixa no terminal do turno. Eventos sem interesse
 * para quem acompanha (textos parciais, cota) não deixam linha.
 */
export function linhaDoLog(evento: EventoRegistrado): Omit<LinhaDoLog, "sequencia" | "em"> | null {
  switch (evento.tipo) {
    case "turno_iniciado": {
      const { modeloDoOrquestrador, modeloDosSubagentes, quantidadeDeSubagentes } = evento.configuracao;
      const quantidade =
        quantidadeDeSubagentes.modo === "fixa" ? `${quantidadeDeSubagentes.limite}` : `≤${quantidadeDeSubagentes.limite}`;
      const modo = evento.modo === "planejamento" ? "plan mode · " : "";
      return {
        origem: "orquestrador",
        tipo: "sistema",
        texto: `${modo}turno iniciado · ${modeloDoOrquestrador} → ${modeloDosSubagentes} · ${quantidade} agentes`,
      };
    }
    case "sessao_iniciada":
      return { origem: "orquestrador", tipo: "sistema", texto: "sessão do claude code conectada" };
    case "texto_do_orquestrador":
      return { origem: "orquestrador", tipo: "texto", texto: primeiraLinha(evento.texto) };
    case "ferramenta_do_orquestrador":
      return { origem: "orquestrador", tipo: "erro", texto: `usou ${evento.ferramenta} sem delegar · ${evento.detalhe}` };
    case "subagente_iniciado":
      return {
        origem: "orquestrador",
        tipo: "spawn",
        texto: `instanciou executor#${idCurto(evento.subagenteId)} · ${evento.descricao}`,
      };
    case "progresso_do_subagente":
      return {
        origem: evento.subagenteId,
        tipo: "ferramenta",
        texto: evento.ultimaFerramenta ? `${evento.ultimaFerramenta} · ${evento.atividade}` : evento.atividade,
      };
    case "subagente_concluido":
      return {
        origem: evento.subagenteId,
        tipo: evento.situacao === "concluido" ? "fim" : "erro",
        texto: `${evento.situacao} em ${formatarDuracao(evento.duracaoMs)} · ${formatarTokens(evento.tokens)} tokens`,
      };
    case "permissao_negada":
      return { origem: "orquestrador", tipo: "erro", texto: `bloqueado: ${evento.ferramenta} · ${evento.detalhe}` };
    case "turno_concluido":
      return {
        origem: "orquestrador",
        tipo: "fim",
        texto: `síntese entregue · ${formatarDuracao(evento.uso.duracaoMs)} · ${formatarTokens(evento.uso.tokensDeEntrada + evento.uso.tokensDeSaida)} tokens`,
      };
    case "turno_cancelado":
      return { origem: "orquestrador", tipo: "erro", texto: "turno cancelado pelo usuário" };
    case "turno_interrompido":
      return { origem: "orquestrador", tipo: "erro", texto: "turno interrompido (servidor reiniciado)" };
    case "turno_falhou":
      return { origem: "orquestrador", tipo: "erro", texto: `falhou · ${primeiraLinha(evento.motivo)}` };
    case "plano_aprovado":
      return { origem: "orquestrador", tipo: "fim", texto: "plano aprovado · execução iniciada" };
    case "plano_descartado":
      return { origem: "orquestrador", tipo: "sistema", texto: "plano descartado" };
    default:
      return null;
  }
}

function novoTurno(evento: Extract<EventoRegistrado, { tipo: "turno_iniciado" }>): TurnoNaTela {
  return {
    id: evento.turnoId,
    texto: evento.texto,
    anexos: evento.anexos ?? [],
    ultimaAtividadeEm: evento.em,
    iniciadoEm: evento.em,
    encerradoEm: null,
    situacao: "em_andamento",
    configuracao: {
      ...evento.configuracao,
      // Pedidos gravados antes da opção de commit e push rodaram com eles bloqueados;
      // e os anteriores à escolha do esforço, com o padrão do modelo.
      permitirCommitEPush: evento.configuracao.permitirCommitEPush ?? false,
      esforcoDoOrquestrador: evento.configuracao.esforcoDoOrquestrador ?? "padrao",
      esforcoDosSubagentes: evento.configuracao.esforcoDosSubagentes ?? "padrao",
    },
    // Pedidos gravados antes do Plan Mode foram todos de execução.
    modo: evento.modo ?? "execucao",
    decisaoDoPlano: null,
    textosDoOrquestrador: [],
    resposta: null,
    motivoDaFalha: null,
    uso: null,
    subagentes: [],
    ferramentasDiretas: [],
    permissoesNegadas: [],
    log: [],
  };
}

/**
 * Reconstrói a conversa a partir dos eventos do servidor. Função pura: o mesmo
 * histórico sempre produz a mesma tela.
 *
 * Ignora eventos já aplicados (pela sequência). Isso torna seguro reconectar o
 * SSE — inclusive a dupla montagem do StrictMode em desenvolvimento, que abre
 * a conexão duas vezes e recebe o histórico inteiro de novo.
 */
export function aplicarEvento(estado: EstadoDaConversa, evento: EventoRegistrado): EstadoDaConversa {
  if (evento.sequencia <= estado.ultimaSequencia) {
    return estado;
  }
  const proximo: EstadoDaConversa = { ...estado, ultimaSequencia: evento.sequencia };

  if (evento.tipo === "configuracao_alterada") {
    return proximo;
  }
  if (evento.tipo === "uso_da_cota") {
    return { ...proximo, cota: evento.janelas };
  }

  const turnos = evento.tipo === "turno_iniciado" ? [...estado.turnos, novoTurno(evento)] : estado.turnos;
  const alteracao = alteracaoDoTurno(evento);
  const linha = linhaDoLog(evento);

  return {
    ...proximo,
    turnos: turnos.map((turno) => {
      if (turno.id !== evento.turnoId) {
        return turno;
      }
      const alterado = { ...(alteracao === null ? turno : alteracao(turno)), ultimaAtividadeEm: evento.em };
      if (linha === null) {
        return alterado;
      }
      const log = [...alterado.log, { ...linha, sequencia: evento.sequencia, em: evento.em }];
      return { ...alterado, log: log.length > LIMITE_DO_LOG ? log.slice(-LIMITE_DO_LOG) : log };
    }),
  };
}
