import type {
  DadosDaEtapa,
  DadosDaRotina,
  DadosDoGatilho,
  OrigemDaExecucao,
  SituacaoDaExecucao,
  TipoDeEtapa,
} from "../../shared/api/rotinas";

/** Os textos das rotinas na tela: o gatilho em linguagem de gente, a próxima execução, as situações. */

/** Na ordem do calendário do Brasil: a semana começa na segunda. */
const DIAS_NA_ORDEM_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0] as const;
const NOMES_DOS_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
/** "Toda segunda", "Todo sábado". */
const ARTIGO_DO_DIA = ["Todo", "Toda", "Toda", "Toda", "Toda", "Toda", "Todo"] as const;

const dataCompletaEHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const diaEMes = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const horaEMinuto = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "Segunda, quarta e sexta". */
function listarDias(dias: readonly number[]): string {
  const nomes = DIAS_NA_ORDEM_DA_SEMANA.filter((dia) => dias.includes(dia)).map((dia) => NOMES_DOS_DIAS[dia] ?? "");
  const [primeiro = "", ...resto] = nomes;
  const ultimo = resto.pop();
  const texto = ultimo === undefined ? primeiro : `${[primeiro, ...resto].join(", ")} e ${ultimo}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Minutos em linguagem corrente: "30 minutos", "2 horas", "1 h 30 min", "1 dia". */
export function descreverMinutos(minutos: number): string {
  if (minutos >= 1_440 && minutos % 1_440 === 0) {
    const dias = minutos / 1_440;
    return dias === 1 ? "1 dia" : `${dias} dias`;
  }
  if (minutos >= 60 && minutos % 60 === 0) {
    const horas = minutos / 60;
    return horas === 1 ? "1 hora" : `${horas} horas`;
  }
  if (minutos > 60) {
    return `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
  }
  return minutos === 1 ? "1 minuto" : `${minutos} minutos`;
}

/** "Toda segunda às 09:00", "Segunda, quarta e sexta às 09:00", "A cada 30 minutos". */
export function descreverGatilho(gatilho: DadosDoGatilho): string {
  switch (gatilho.tipo) {
    case "diario":
      return `Todo dia às ${gatilho.hora}`;
    case "semanal": {
      const dias = [...new Set(gatilho.dias)];
      if (dias.length === 7) {
        return `Todo dia às ${gatilho.hora}`;
      }
      if (dias.length === 1) {
        const dia = dias[0] ?? 0;
        return `${ARTIGO_DO_DIA[dia] ?? "Todo"} ${NOMES_DOS_DIAS[dia] ?? ""} às ${gatilho.hora}`;
      }
      if (dias.length === 5 && [1, 2, 3, 4, 5].every((dia) => dias.includes(dia))) {
        return `De segunda a sexta às ${gatilho.hora}`;
      }
      return `${listarDias(dias)} às ${gatilho.hora}`;
    }
    case "intervalo":
      return `A cada ${descreverMinutos(gatilho.minutos)}`;
    case "uma_vez": {
      const momento = new Date(gatilho.em);
      return Number.isNaN(momento.getTime())
        ? "Uma vez"
        : `Uma vez, em ${dataCompletaEHora.format(momento).replace(", ", " às ")}`;
    }
  }
}

/** "hoje às 09:00", "amanhã às 09:00" ou "05/12 às 09:00". */
export function descreverMomento(iso: string, agora: Date = new Date()): string {
  const momento = new Date(iso);
  if (Number.isNaN(momento.getTime())) {
    return "—";
  }
  const hora = horaEMinuto.format(momento);
  const amanha = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  if (momento.toDateString() === agora.toDateString()) {
    return `hoje às ${hora}`;
  }
  if (momento.toDateString() === amanha.toDateString()) {
    return `amanhã às ${hora}`;
  }
  return `${diaEMes.format(momento)} às ${hora}`;
}

/** Quando a rotina roda de novo; desativada ou sem mais ocorrências, diz isso. */
export function descreverProximaExecucao(rotina: Pick<DadosDaRotina, "ativa" | "proximaExecucaoEm">, agora: Date = new Date()): string {
  if (!rotina.ativa) {
    return "Desativada: não roda sozinha";
  }
  return rotina.proximaExecucaoEm === null ? "Sem próxima execução" : descreverMomento(rotina.proximaExecucaoEm, agora);
}

export interface RotuloDaSituacao {
  texto: string;
  /** A classe da etiqueta (`etiqueta-*`); vazia, a etiqueta neutra. */
  classe: string;
}

export const ROTULOS_DAS_SITUACOES: Readonly<Record<SituacaoDaExecucao, RotuloDaSituacao>> = {
  em_andamento: { texto: "Em andamento", classe: "etiqueta-ativa etiqueta-pulso" },
  aguardando_aprovacao: { texto: "Aguardando aprovação", classe: "etiqueta-warning etiqueta-pulso" },
  concluida: { texto: "Concluída", classe: "etiqueta-success" },
  falhou: { texto: "Falhou", classe: "etiqueta-error" },
  cancelada: { texto: "Cancelada", classe: "" },
  recusada: { texto: "Recusada", classe: "etiqueta-warning" },
  interrompida: { texto: "Interrompida", classe: "etiqueta-warning" },
  pulada: { texto: "Pulada", classe: "" },
};

export const ROTULOS_DAS_ORIGENS: Readonly<Record<OrigemDaExecucao, string>> = {
  agendada: "agendada",
  manual: "manual",
  perdida: "recuperada ao abrir",
};

export const ROTULOS_DOS_TIPOS_DE_ETAPA: Readonly<Record<TipoDeEtapa, string>> = {
  pedido: "Pedido",
  aprovacao: "Aprovação",
  espera: "Espera",
};

/** O começo do texto, em uma linha, com reticências se foi cortado. */
export function resumirTexto(texto: string, limite: number): string {
  const linha = texto.replace(/\s+/g, " ").trim();
  return linha.length > limite ? `${linha.slice(0, limite - 1).trimEnd()}…` : linha;
}

/** Uma linha para a etapa, para a lista e o histórico. `nomeDoOrquestrador` resolve o id (nulo: o orquestrador não existe mais). */
export function descreverEtapa(etapa: DadosDaEtapa, nomeDoOrquestrador: (id: string) => string | null): string {
  switch (etapa.tipo) {
    case "pedido": {
      const nome = nomeDoOrquestrador(etapa.orquestradorId) ?? "orquestrador removido";
      const modo = etapa.modo === "planejamento" ? "planejar" : "executar";
      return `Pedido (${modo}) para ${nome}: ${resumirTexto(etapa.texto, 90)}`;
    }
    case "aprovacao":
      return `Pedir aprovação: ${resumirTexto(etapa.mensagem, 90)}`;
    case "espera":
      return `Esperar ${descreverMinutos(etapa.minutos)}`;
  }
}
