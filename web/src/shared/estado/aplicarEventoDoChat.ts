import type {
  AtividadeDaResposta,
  AutorizacaoPendente,
  EstadoDoChat,
  EventoDoChatRegistrado,
  JanelaDaCota,
  MensagemDoChat,
  PreferenciasDoChat,
  SituacaoDoChat,
  TrechoDaResposta,
} from "../api/tipos";
import { PREFERENCIAS_PADRAO_DO_CHAT } from "../modelos";

/** Uma mensagem como a tela a mostra: a do servidor e, se falhou, o motivo. */
export interface MensagemDoChatNaTela extends MensagemDoChat {
  /** Vem no evento `resposta_falhou` ou, no estado carregado, do último aviso da mensagem que falhou. */
  motivoDaFalha: string | null;
  /** O que a resposta quis alterar sem autorização; `null` também nos dados antigos, sem o campo. */
  autorizacaoPendente: AutorizacaoPendente | null;
}

export interface EstadoDoChatNaTela {
  /** Já veio o estado inicial do servidor (`GET /api/chat`). */
  carregado: boolean;
  situacao: SituacaoDoChat;
  preferencias: PreferenciasDoChat;
  mensagens: MensagemDoChatNaTela[];
  ultimaSequencia: number;
  cota: JanelaDaCota[] | null;
  /** Só a atividade mais recente da resposta em andamento ("lendo README.md…"). */
  atividade: AtividadeDaResposta | null;
  /** O chat pode editar arquivos e rodar comandos sem perguntar, até o próximo `/clear`. */
  alteracoesAutorizadas: boolean;
}

export const ESTADO_INICIAL_DO_CHAT: EstadoDoChatNaTela = {
  carregado: false,
  situacao: "ocioso",
  preferencias: PREFERENCIAS_PADRAO_DO_CHAT,
  mensagens: [],
  ultimaSequencia: 0,
  cota: null,
  atividade: null,
  alteracoesAutorizadas: false,
};

/**
 * No estado gravado, o servidor guarda o motivo de uma falha como o último
 * aviso da mensagem: aqui ele volta a ser o motivo, como no evento ao vivo.
 * Sem o campo da autorização (dados antigos), não há autorização pendente.
 */
function naTela(mensagem: MensagemDoChat): MensagemDoChatNaTela {
  const autorizacaoPendente = mensagem.autorizacaoPendente ?? null;
  if (mensagem.situacao === "falhou" && mensagem.avisos.length > 0) {
    return {
      ...mensagem,
      avisos: mensagem.avisos.slice(0, -1),
      motivoDaFalha: mensagem.avisos.at(-1) ?? null,
      autorizacaoPendente,
    };
  }
  return { ...mensagem, motivoDaFalha: null, autorizacaoPendente };
}

/** O estado do servidor (carga inicial ou recarga depois de uma queda) substitui o da tela. */
export function carregarEstadoDoChat(estado: EstadoDoChat): EstadoDoChatNaTela {
  return {
    carregado: true,
    situacao: estado.situacao,
    preferencias: estado.preferencias,
    mensagens: estado.mensagens.map(naTela),
    ultimaSequencia: estado.ultimaSequencia,
    cota: estado.cota,
    atividade: null,
    alteracoesAutorizadas: estado.alteracoesAutorizadas ?? false,
  };
}

function alterarMensagem(
  estado: EstadoDoChatNaTela,
  mensagemId: string,
  alteracao: (mensagem: MensagemDoChatNaTela) => MensagemDoChatNaTela,
): MensagemDoChatNaTela[] {
  return estado.mensagens.map((mensagem) => (mensagem.id === mensagemId ? alteracao(mensagem) : mensagem));
}

/** Fim da resposta: o chat volta a ficar ocioso e a atividade some. */
function encerrar(
  estado: EstadoDoChatNaTela,
  mensagemId: string,
  alteracao: (mensagem: MensagemDoChatNaTela) => MensagemDoChatNaTela,
): Omit<EstadoDoChatNaTela, "ultimaSequencia"> {
  return { ...estado, situacao: "ocioso", atividade: null, mensagens: alterarMensagem(estado, mensagemId, alteracao) };
}

/**
 * Aplica um evento registrado do chat. Eventos já vistos (sequência menor ou
 * igual à última aplicada) chegam de novo numa reconexão e são ignorados.
 */
export function aplicarEventoDoChat(estado: EstadoDoChatNaTela, evento: EventoDoChatRegistrado): EstadoDoChatNaTela {
  if (evento.sequencia <= estado.ultimaSequencia) {
    return estado;
  }
  const ultimaSequencia = evento.sequencia;

  switch (evento.tipo) {
    case "pergunta_enviada": {
      const novas = [evento.mensagemDoUsuario, evento.mensagemDoClaude]
        .filter((nova) => !estado.mensagens.some((mensagem) => mensagem.id === nova.id))
        .map(naTela);
      return {
        ...estado,
        ultimaSequencia,
        situacao: "respondendo",
        atividade: null,
        mensagens: [...estado.mensagens, ...novas],
      };
    }
    case "resposta_concluida":
      return {
        ...encerrar(estado, evento.mensagemId, (mensagem) => ({
          ...mensagem,
          situacao: "concluida",
          texto: evento.texto,
          acoes: evento.acoes,
          avisos: evento.avisos,
          uso: evento.uso,
          autorizacaoPendente: evento.autorizacaoPendente ?? null,
        })),
        ultimaSequencia,
      };
    case "resposta_falhou":
      return {
        ...encerrar(estado, evento.mensagemId, (mensagem) => ({
          ...mensagem,
          situacao: "falhou",
          motivoDaFalha: evento.motivo,
          uso: evento.uso ?? mensagem.uso,
        })),
        ultimaSequencia,
      };
    case "resposta_cancelada":
      return {
        ...encerrar(estado, evento.mensagemId, (mensagem) => ({ ...mensagem, situacao: "cancelada" })),
        ultimaSequencia,
      };
    case "conversa_limpa":
      // O `/clear` também desfaz a autorização de alterações.
      return {
        ...estado,
        ultimaSequencia,
        situacao: "ocioso",
        atividade: null,
        mensagens: [],
        alteracoesAutorizadas: false,
      };
    case "preferencias_alteradas":
      return { ...estado, ultimaSequencia, preferencias: evento.preferencias };
    case "uso_da_cota":
      return { ...estado, ultimaSequencia, cota: evento.janelas };
    case "alteracoes_autorizadas":
      return { ...estado, ultimaSequencia, alteracoesAutorizadas: true };
    case "autorizacao_revogada":
      return { ...estado, ultimaSequencia, alteracoesAutorizadas: false };
    default:
      // Evento de uma versão mais nova do servidor: só avança a sequência.
      return { ...estado, ultimaSequencia };
  }
}

/** Trecho novo do texto da resposta em andamento (passageiro, sem sequência): concatena. */
export function aplicarTrechoDoChat(estado: EstadoDoChatNaTela, trecho: TrechoDaResposta): EstadoDoChatNaTela {
  const alvo = estado.mensagens.find((mensagem) => mensagem.id === trecho.mensagemId);
  if (alvo === undefined || alvo.situacao !== "respondendo" || trecho.texto === "") {
    return estado;
  }
  return {
    ...estado,
    mensagens: alterarMensagem(estado, trecho.mensagemId, (mensagem) => ({
      ...mensagem,
      texto: mensagem.texto + trecho.texto,
    })),
  };
}

/** A ferramenta que o Claude usa agora; só vale para a resposta em andamento. */
export function aplicarAtividadeDoChat(
  estado: EstadoDoChatNaTela,
  atividade: AtividadeDaResposta,
): EstadoDoChatNaTela {
  const alvo = estado.mensagens.find((mensagem) => mensagem.id === atividade.mensagemId);
  return alvo === undefined || alvo.situacao !== "respondendo" ? estado : { ...estado, atividade };
}

const CERCA_DE_ACAO = "```acao-do-app";

/**
 * O texto da resposta sem os blocos ```` ```acao-do-app ```` (até a cerca de
 * fechamento ou o fim): as ações chegam prontas no fim da resposta e viram
 * cartões. Durante a resposta, também some uma cerca ainda pela metade no fim
 * ("```aca"), para o bloco não piscar na tela antes de ser reconhecido.
 */
export function textoParaMostrar(texto: string, respondendo: boolean): string {
  let restante = texto;
  let resultado = "";
  for (;;) {
    const inicio = restante.indexOf(CERCA_DE_ACAO);
    if (inicio === -1) {
      resultado += restante;
      break;
    }
    resultado += restante.slice(0, inicio);
    const fimDaAbertura = restante.indexOf("\n", inicio);
    if (fimDaAbertura === -1) {
      break;
    }
    const fechamento = restante.indexOf("\n```", fimDaAbertura);
    if (fechamento === -1) {
      break;
    }
    const fimDoFechamento = restante.indexOf("\n", fechamento + 4);
    restante = fimDoFechamento === -1 ? "" : restante.slice(fimDoFechamento + 1);
  }
  if (respondendo) {
    resultado = semCercaPelaMetade(resultado);
  }
  return resultado.trimEnd();
}

/** Tira do fim um começo de cerca de ação ainda incompleto, no início de uma linha. */
function semCercaPelaMetade(texto: string): string {
  const inicioDaLinha = texto.lastIndexOf("\n") + 1;
  const ultimaLinha = texto.slice(inicioDaLinha);
  return ultimaLinha.length >= 3 && CERCA_DE_ACAO.startsWith(ultimaLinha) ? texto.slice(0, inicioDaLinha) : texto;
}

/** A resposta que parou pedindo autorização, com o que ela quis fazer. */
export interface PedidoDeAutorizacao {
  mensagemId: string;
  autorizacao: AutorizacaoPendente;
}

/**
 * O pedido de autorização que vale agora: o da **última** resposta do Claude,
 * se ela parou por falta de autorização. Respostas anteriores não pedem mais
 * nada. Se o chat já está autorizado, quem decide esconder é o cartão.
 */
export function pedidoDeAutorizacaoAtual(estado: EstadoDoChatNaTela): PedidoDeAutorizacao | null {
  for (let indice = estado.mensagens.length - 1; indice >= 0; indice -= 1) {
    const mensagem = estado.mensagens[indice];
    if (mensagem?.papel === "claude") {
      return mensagem.autorizacaoPendente === null
        ? null
        : { mensagemId: mensagem.id, autorizacao: mensagem.autorizacaoPendente };
    }
  }
  return null;
}

/** O modelo usado na última resposta que informou, para o rótulo do seletor. */
export function ultimoModeloUsado(estado: EstadoDoChatNaTela): string | null {
  for (let indice = estado.mensagens.length - 1; indice >= 0; indice -= 1) {
    const modelo = estado.mensagens[indice]?.uso?.modeloUsado;
    if (modelo !== undefined && modelo !== null) {
      return modelo;
    }
  }
  return null;
}
