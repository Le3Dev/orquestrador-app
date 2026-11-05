import type {
  DadosDaConfiguracao,
  DadosDoAnexo,
  DadosDoConsumoDoTurno,
  DadosDoPedidoNaFila,
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
  /**
   * Nulo enquanto não há plano entregue. Além do Plan Mode, um pedido de
   * execução também pode terminar com um plano: o Orquestrador o propõe antes
   * de uma mudança grande.
   */
  decisaoDoPlano: DecisaoDoPlano | null;
  textosDoOrquestrador: string[];
  resposta: string | null;
  motivoDaFalha: string | null;
  uso: UsoDoTurno | null;
  /**
   * Consumo medido do turno (principal e Subagentes), que chega depois do fim.
   * Nulo — ou ausente — enquanto não foi medido.
   */
  consumo?: DadosDoConsumoDoTurno | null;
  subagentes: SubagenteNaTela[];
  /** Ferramentas que o Orquestrador usou ele mesmo, sem Subagente (leituras, checagens, comandos curtos). */
  ferramentasDiretas: AcaoRegistrada[];
  permissoesNegadas: AcaoRegistrada[];
  log: LinhaDoLog[];
}

export interface EstadoDaConversa {
  ultimaSequencia: number;
  turnos: TurnoNaTela[];
  cota: JanelaDaCota[] | null;
  /** Quando o usuário começou a conversa atual (/clear); nulo enquanto é a primeira. */
  conversaIniciadaEm: string | null;
  /**
   * Pedidos que os eventos puseram na fila e ainda não tiraram, na ordem de
   * chegada. Não é a fila inteira: os pedidos enfileirados antes de um /clear
   * não estão mais no histórico. A fila da tela é `filaDePedidos`.
   */
  pedidosEnfileirados: readonly DadosDoPedidoNaFila[];
  /** Ids que os eventos já tiraram da fila (removidos ou enviados). */
  pedidosRetirados: readonly string[];
}

export const ESTADO_INICIAL: EstadoDaConversa = {
  ultimaSequencia: 0,
  turnos: [],
  cota: null,
  conversaIniciadaEm: null,
  pedidosEnfileirados: [],
  pedidosRetirados: [],
};

/**
 * A fila de pedidos que a tela mostra: a do servidor (`fila` do resumo do
 * Orquestrador), corrigida pelos eventos da fila.
 *
 * O resumo é a fila inteira, mas no instante da consulta (a lista é
 * consultada a cada poucos segundos); os eventos chegam na hora, mas só os da
 * conversa atual — depois de um /clear, o histórico começa de novo e a fila
 * continua. Juntando: os pedidos do resumo que nenhum evento tirou, seguidos
 * dos que os eventos puseram depois da consulta, sem repetir.
 */
export function filaDePedidos(
  estado: EstadoDaConversa,
  filaDoServidor: readonly DadosDoPedidoNaFila[],
): DadosDoPedidoNaFila[] {
  const retirados = new Set(estado.pedidosRetirados);
  const vistos = new Set<string>();
  const fila: DadosDoPedidoNaFila[] = [];
  for (const pedido of [...filaDoServidor, ...estado.pedidosEnfileirados]) {
    if (!retirados.has(pedido.id) && !vistos.has(pedido.id)) {
      vistos.add(pedido.id);
      fila.push(pedido);
    }
  }
  return fila;
}

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

/**
 * O turno terminou com um plano à espera de decisão? O servidor informa —
 * inclusive quando, num pedido de execução, o Orquestrador propôs um plano
 * antes de alterar. Eventos gravados antes do campo seguem a regra antiga: só
 * o Plan Mode entrega plano.
 */
function ficouComPlanoPendente(turno: TurnoNaTela, planoPendente: boolean | undefined): boolean {
  return planoPendente ?? turno.modo === "planejamento";
}

/** O que o Orquestrador faz com cada ferramenta, no gerúndio, para o terminal. */
const VERBOS_DAS_FERRAMENTAS: Readonly<Record<string, string>> = {
  Read: "lendo",
  Grep: "buscando",
  Glob: "listando",
  PowerShell: "executando",
  Bash: "executando",
  WebFetch: "abrindo",
  WebSearch: "pesquisando",
};

/** Ex.: "lendo src/app.ts", "executando npm test", "usando TodoWrite". */
function atividadeDoOrquestrador(ferramenta: string, detalhe: string): string {
  const verbo = VERBOS_DAS_FERRAMENTAS[ferramenta] ?? `usando ${ferramenta}`;
  const alvo = primeiraLinha(detalhe);
  return alvo === "" ? verbo : `${verbo} ${alvo}`;
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
        decisaoDoPlano: ficouComPlanoPendente(turno, evento.planoPendente) ? "pendente" : turno.decisaoDoPlano,
        // A resposta final também chega como último texto do orquestrador;
        // sem este filtro ela apareceria duas vezes.
        textosDoOrquestrador: turno.textosDoOrquestrador.filter((texto) => texto.trim() !== evento.resposta.trim()),
      });

    case "plano_aprovado":
      return (turno) => ({ ...turno, decisaoDoPlano: "aprovado" });

    // Chega depois do fim do turno; uma medição nova substitui a anterior.
    case "consumo_do_turno_medido":
      return (turno) => ({ ...turno, consumo: evento.consumo });

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
 * A linha que o evento deixa no terminal do turno (`turno`, antes do evento).
 * Eventos sem interesse para quem acompanha (textos parciais, cota) não
 * deixam linha.
 */
export function linhaDoLog(evento: EventoRegistrado, turno: TurnoNaTela): Omit<LinhaDoLog, "sequencia" | "em"> | null {
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
    // Atividade normal: o Orquestrador pode ler e rodar comandos curtos sozinho.
    // Como as ações dos Subagentes, some do histórico quando o pedido termina.
    case "ferramenta_do_orquestrador":
      return {
        origem: "orquestrador",
        tipo: "ferramenta",
        texto: atividadeDoOrquestrador(evento.ferramenta, evento.detalhe),
      };
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
    case "turno_concluido": {
      const uso = `${formatarDuracao(evento.uso.duracaoMs)} · ${formatarTokens(evento.uso.tokensDeEntrada + evento.uso.tokensDeSaida)} tokens`;
      // Pedido de execução em que o Orquestrador preferiu propor um plano antes de alterar.
      const planoProposto = evento.planoPendente === true && turno.modo === "execucao";
      return {
        origem: "orquestrador",
        tipo: "fim",
        texto: planoProposto ? `plano proposto · aguardando aprovação · ${uso}` : `síntese entregue · ${uso}`,
      };
    }
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
      // Os anteriores às opções de trabalho direto e de plano automático ficam com o padrão (ligadas).
      permitirTrabalhoDireto: evento.configuracao.permitirTrabalhoDireto ?? true,
      proporPlanoEmPedidosGrandes: evento.configuracao.proporPlanoEmPedidosGrandes ?? true,
    },
    // Pedidos gravados antes do Plan Mode foram todos de execução.
    modo: evento.modo ?? "execucao",
    decisaoDoPlano: null,
    textosDoOrquestrador: [],
    resposta: null,
    motivoDaFalha: null,
    uso: null,
    consumo: null,
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
  if (evento.tipo === "conversa_limpa") {
    // Conversa nova (/clear): os pedidos anteriores ficam arquivados no servidor
    // e saem da tela. A cota fica: é da assinatura, não da conversa.
    // A fila do Orquestrador continua, mas daqui em diante vem do resumo do
    // servidor: quem abrir o terminal depois não verá os eventos de antes do
    // /clear, e um terminal que reconectar depois dele pode ter perdido uma
    // retirada. Os retirados ficam, para filtrar um resumo defasado.
    return { ...proximo, turnos: [], conversaIniciadaEm: evento.em, pedidosEnfileirados: [] };
  }
  if (evento.tipo === "uso_da_cota") {
    return { ...proximo, cota: evento.janelas };
  }
  if (evento.tipo === "pedido_enfileirado") {
    const { pedido } = evento;
    // Repetido, ou já retirado por um evento que chegou antes: nada muda.
    if (
      estado.pedidosRetirados.includes(pedido.id) ||
      estado.pedidosEnfileirados.some((enfileirado) => enfileirado.id === pedido.id)
    ) {
      return proximo;
    }
    return { ...proximo, pedidosEnfileirados: [...estado.pedidosEnfileirados, pedido] };
  }
  if (evento.tipo === "pedido_retirado_da_fila") {
    if (estado.pedidosRetirados.includes(evento.pedidoId)) {
      return proximo;
    }
    return {
      ...proximo,
      pedidosEnfileirados: estado.pedidosEnfileirados.filter((pedido) => pedido.id !== evento.pedidoId),
      pedidosRetirados: [...estado.pedidosRetirados, evento.pedidoId],
    };
  }

  const turnos = evento.tipo === "turno_iniciado" ? [...estado.turnos, novoTurno(evento)] : estado.turnos;
  const alteracao = alteracaoDoTurno(evento);

  return {
    ...proximo,
    turnos: turnos.map((turno) => {
      if (turno.id !== evento.turnoId) {
        return turno;
      }
      const alterado = { ...(alteracao === null ? turno : alteracao(turno)), ultimaAtividadeEm: evento.em };
      const linha = linhaDoLog(evento, turno);
      if (linha === null) {
        return alterado;
      }
      const log = [...alterado.log, { ...linha, sequencia: evento.sequencia, em: evento.em }];
      return { ...alterado, log: log.length > LIMITE_DO_LOG ? log.slice(-LIMITE_DO_LOG) : log };
    }),
  };
}
