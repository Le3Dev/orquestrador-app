import type {
  DadosDaEtapa,
  DadosDaRotina,
  DadosDoGatilho,
  OrigemDaExecucao,
  SituacaoDaExecucao,
  TipoDeEtapa,
} from "../../shared/api/rotinas";
import { idiomaAtual, localeDoIdioma, textosAtuais } from "../../shared/idioma/idioma";
import { textosDeRotinas } from "../../shared/idioma/textos/rotinas";

/** Os textos das rotinas na tela: o gatilho em linguagem de gente, a próxima execução, as situações. */

/** Na ordem do calendário do Brasil: a semana começa na segunda. */
const DIAS_NA_ORDEM_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0] as const;

const textos = () => textosAtuais(textosDeRotinas);
const locale = () => localeDoIdioma(idiomaAtual());
const formatoDeData = (opcoes: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), { hourCycle: "h23", ...opcoes });

/** "Segunda, quarta e sexta". */
function listarDias(dias: readonly number[]): string {
  const t = textos();
  const nomes = DIAS_NA_ORDEM_DA_SEMANA.filter((dia) => dias.includes(dia)).map((dia) => t.nomesDosDias[dia] ?? "");
  const [primeiro = "", ...resto] = nomes;
  const ultimo = resto.pop();
  const texto = ultimo === undefined ? primeiro : `${[primeiro, ...resto].join(", ")} ${t.gatilho.eConjuncao} ${ultimo}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Minutos em linguagem corrente: "30 minutos", "2 horas", "1 h 30 min", "1 dia". */
export function descreverMinutos(minutos: number): string {
  const t = textos().minutos;
  if (minutos >= 1_440 && minutos % 1_440 === 0) {
    const dias = minutos / 1_440;
    return dias === 1 ? t.umDia : t.dias(dias);
  }
  if (minutos >= 60 && minutos % 60 === 0) {
    const horas = minutos / 60;
    return horas === 1 ? t.umaHora : t.horas(horas);
  }
  if (minutos > 60) {
    return t.horasEMinutos(Math.floor(minutos / 60), minutos % 60);
  }
  return minutos === 1 ? t.umMinuto : t.minutos(minutos);
}

/** "Toda segunda às 09:00", "Segunda, quarta e sexta às 09:00", "A cada 30 minutos". */
export function descreverGatilho(gatilho: DadosDoGatilho): string {
  const t = textos();
  switch (gatilho.tipo) {
    case "diario":
      return t.gatilho.todoDia(gatilho.hora);
    case "semanal": {
      const dias = [...new Set(gatilho.dias)];
      if (dias.length === 7) {
        return t.gatilho.todoDia(gatilho.hora);
      }
      if (dias.length === 1) {
        const dia = dias[0] ?? 0;
        return t.gatilho.umDia(t.artigosDoDia[dia] ?? "", t.nomesDosDias[dia] ?? "", gatilho.hora);
      }
      if (dias.length === 5 && [1, 2, 3, 4, 5].every((dia) => dias.includes(dia))) {
        return t.gatilho.segundaASexta(gatilho.hora);
      }
      return t.gatilho.dias(listarDias(dias), gatilho.hora);
    }
    case "intervalo":
      return t.gatilho.aCada(descreverMinutos(gatilho.minutos));
    case "uma_vez": {
      const momento = new Date(gatilho.em);
      const formato = formatoDeData({ day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      return Number.isNaN(momento.getTime())
        ? t.gatilho.umaVez
        : t.gatilho.umaVezEm(formato.format(momento).replace(", ", ` ${t.gatilho.as} `));
    }
  }
}

/** "hoje às 09:00", "amanhã às 09:00" ou "05/12 às 09:00". */
export function descreverMomento(iso: string, agora: Date = new Date()): string {
  const momento = new Date(iso);
  if (Number.isNaN(momento.getTime())) {
    return "—";
  }
  const t = textos().momento;
  const hora = formatoDeData({ hour: "2-digit", minute: "2-digit" }).format(momento);
  const amanha = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  if (momento.toDateString() === agora.toDateString()) {
    return t.hoje(hora);
  }
  if (momento.toDateString() === amanha.toDateString()) {
    return t.amanha(hora);
  }
  return t.data(formatoDeData({ day: "2-digit", month: "2-digit" }).format(momento), hora);
}

/** Quando a rotina roda de novo; desativada ou sem mais ocorrências, diz isso. */
export function descreverProximaExecucao(rotina: Pick<DadosDaRotina, "ativa" | "proximaExecucaoEm">, agora: Date = new Date()): string {
  if (!rotina.ativa) {
    return textos().proxima.desativada;
  }
  return rotina.proximaExecucaoEm === null ? textos().proxima.semProxima : descreverMomento(rotina.proximaExecucaoEm, agora);
}
export interface RotuloDaSituacao {
  texto: string;
  /** A classe da etiqueta (`etiqueta-*`); vazia, a etiqueta neutra. */
  classe: string;
}

/** As classes da etiqueta de cada situação. */
const CLASSES_DAS_SITUACOES: Readonly<Record<SituacaoDaExecucao, string>> = {
  em_andamento: "etiqueta-ativa etiqueta-pulso",
  aguardando_aprovacao: "etiqueta-warning etiqueta-pulso",
  concluida: "etiqueta-success",
  falhou: "etiqueta-error",
  cancelada: "",
  recusada: "etiqueta-warning",
  interrompida: "etiqueta-warning",
  pulada: "",
};

export function rotuloDaSituacao(situacao: SituacaoDaExecucao): RotuloDaSituacao {
  return { texto: textos().situacoes[situacao], classe: CLASSES_DAS_SITUACOES[situacao] };
}

export function rotuloDaOrigem(origem: OrigemDaExecucao): string {
  return textos().origens[origem];
}

export function rotuloDoTipoDeEtapa(tipo: TipoDeEtapa): string {
  return textos().tiposDeEtapa[tipo];
}
/** O começo do texto, em uma linha, com reticências se foi cortado. */
export function resumirTexto(texto: string, limite: number): string {
  const linha = texto.replace(/\s+/g, " ").trim();
  return linha.length > limite ? `${linha.slice(0, limite - 1).trimEnd()}…` : linha;
}

/** Uma linha para a etapa, para a lista e o histórico. `nomeDoOrquestrador` resolve o id (nulo: o orquestrador não existe mais). */
export function descreverEtapa(etapa: DadosDaEtapa, nomeDoOrquestrador: (id: string) => string | null): string {
  switch (etapa.tipo) {
    case "pedido": {
      const t = textos().etapa;
      const nome = nomeDoOrquestrador(etapa.orquestradorId) ?? t.orquestradorRemovido;
      const modo = etapa.modo === "planejamento" ? "planejar" : "executar";
      return `Pedido (${modo}) para ${nome}: ${resumirTexto(etapa.texto, 90)}`;
    }
    case "aprovacao":
      return textos().etapa.pedirAprovacao(resumirTexto(etapa.mensagem, 90));
    case "espera":
      return textos().etapa.esperar(descreverMinutos(etapa.minutos));
  }
}
