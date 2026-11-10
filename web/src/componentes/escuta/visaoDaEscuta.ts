import type { EstadoDaEscuta } from "../../shared/escuta/sessaoDaEscuta";
import type { SituacaoDaEscuta } from "../../shared/escuta/useEscuta";
import { type MensagemDoChatNaTela, textoParaMostrar } from "../../shared/estado/aplicarEventoDoChat";
import type { DownloadDoModelo, RespostaDaEscuta, SituacaoDoPainel, VisaoDaEscuta } from "./tipos";

/** O que a visão usa do estado da escuta (o `EscutaNaTela` do hook também serve). */
export type EstadoParaAVisao = Pick<
  EstadoDaEscuta,
  "situacao" | "progressoDoDownload" | "erro" | "legenda" | "motor" | "download"
>;

/** O que a visão usa de cada mensagem do chat. */
export type MensagemParaAVisao = Pick<MensagemDoChatNaTela, "papel" | "texto" | "situacao" | "origem" | "motivoDaFalha">;

/** Situações sem painel: escuta fora do ar, desligada ou com o aviso da primeira vez na tela. */
const SEM_PAINEL: ReadonlySet<SituacaoDaEscuta> = new Set(["indisponivel", "desligada", "aguardando-aviso"]);

const SITUACAO_DO_PAINEL: Readonly<Record<SituacaoDaEscuta, SituacaoDoPainel>> = {
  indisponivel: "parada",
  desligada: "parada",
  "aguardando-aviso": "parada",
  iniciando: "iniciando",
  // O download aparece à parte (barra no cabeçalho); para o painel, a escuta ainda está começando.
  "baixando-modelo": "iniciando",
  escutando: "escutando",
  pausada: "pausada",
  erro: "erro",
};

/** O painel da escuta aparece nesta situação? */
export function painelVisivel(situacao: SituacaoDaEscuta): boolean {
  return !SEM_PAINEL.has(situacao);
}

function semVazio(texto: string | null): string | null {
  return texto === null || texto.trim() === "" ? null : texto;
}

/** O download com o total, quando a sessão o informa; sem ele, só a porcentagem antiga. */
function downloadDa(estado: EstadoParaAVisao): DownloadDoModelo | null {
  if (estado.download !== null) {
    return { progresso: estado.download.progresso, totalMb: estado.download.totalMb };
  }
  return estado.progressoDoDownload === null ? null : { progresso: estado.progressoDoDownload, totalMb: null };
}

/** O fim de uma resposta que não chegou ao fim: o texto parcial (se houver) e o motivo. */
function textoInterrompido(parcial: string, aviso: string): string {
  return parcial.trim() === "" ? aviso : `${parcial}\n\n${aviso}`;
}

/**
 * A resposta à última pergunta da escuta: a última mensagem do usuário com a
 * origem "escuta" e a do Claude logo depois dela (o servidor cria as duas
 * juntas, no `pergunta_enviada`). Carregando enquanto a do Claude está
 * "respondendo", já com o texto parcial; sem pergunta da escuta, nula.
 */
export function respostaDaEscuta(mensagens: readonly MensagemParaAVisao[]): RespostaDaEscuta | null {
  const indice = mensagens.findLastIndex((mensagem) => mensagem.papel === "usuario" && mensagem.origem === "escuta");
  const daEscuta = mensagens[indice];
  if (daEscuta === undefined) {
    return null;
  }
  const pergunta = daEscuta.texto.trim();
  const seguinte = mensagens[indice + 1];
  if (seguinte === undefined || seguinte.papel !== "claude") {
    return { pergunta, texto: null, carregando: false };
  }
  switch (seguinte.situacao) {
    case "respondendo":
      return { pergunta, texto: semVazio(textoParaMostrar(seguinte.texto, true)), carregando: true };
    case "concluida":
      return { pergunta, texto: semVazio(textoParaMostrar(seguinte.texto, false)), carregando: false };
    case "falhou": {
      const motivo = seguinte.motivoDaFalha?.trim() ?? "";
      const aviso = motivo === "" ? "A resposta falhou." : `A resposta falhou: ${motivo}`;
      return { pergunta, texto: textoInterrompido(textoParaMostrar(seguinte.texto, false), aviso), carregando: false };
    }
    case "cancelada":
      return {
        pergunta,
        texto: textoInterrompido(textoParaMostrar(seguinte.texto, false), "A resposta foi cancelada."),
        carregando: false,
      };
  }
}

/**
 * O estado da escuta e as mensagens do chat convertidos para o que o painel
 * mostra: a legenda (frases confirmadas e o parcial), o motor, o download, a
 * situação, o erro e o cartão da resposta.
 */
export function visaoDaEscuta(estado: EstadoParaAVisao, mensagensDoChat: readonly MensagemParaAVisao[]): VisaoDaEscuta {
  return {
    confirmados: estado.legenda.frases,
    parcial: semVazio(estado.legenda.parcial),
    motor:
      estado.motor === null
        ? null
        : { dispositivo: estado.motor.dispositivo, modelo: estado.motor.modelo, precisao: estado.motor.precisao },
    download: downloadDa(estado),
    situacao: SITUACAO_DO_PAINEL[estado.situacao],
    erro: estado.erro,
    resposta: respostaDaEscuta(mensagensDoChat),
  };
}

/**
 * A "última pergunta" da faixa, só quando ela não está à vista no cartão: o
 * cartão já mostra a pergunta respondida (fora do compacto). Sobra para a
 * faixa a que foi só posta no campo, ou qualquer uma no compacto.
 */
export function ultimaPerguntaForaDoCartao(
  ultimaPergunta: string | null,
  resposta: RespostaDaEscuta | null,
  compacto: boolean,
): string | null {
  if (ultimaPergunta === null || ultimaPergunta.trim() === "") {
    return null;
  }
  if (!compacto && resposta !== null && resposta.pergunta === ultimaPergunta.trim()) {
    return null;
  }
  return ultimaPergunta;
}
