import { CausaDaRecuperacao } from "./EventoDeOrquestracao";
import { CausaDaFalha } from "./MotorDeAgentes";

/**
 * Regras da autorrecuperação de um turno (ver ADR-36): quantas vezes o app
 * retoma a sessão para cada causa, quanto espera antes de cada tentativa e o
 * que diz ao Claude ao retomar. Funções puras: quem agenda e publica é o
 * `ServicoDeOrquestracao`.
 */

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;

/** Espera de cada tentativa (a 1ª é o índice 0); o tamanho da lista é o máximo de tentativas. */
const ESPERAS: Readonly<Record<Exclude<CausaDaRecuperacao, "limite_de_uso">, readonly number[]>> = {
  silencio: [30 * SEGUNDO, 2 * MINUTO],
  sobrecarga: [1 * MINUTO, 3 * MINUTO, 5 * MINUTO],
  rede: [1 * MINUTO, 3 * MINUTO, 5 * MINUTO],
};

const TENTATIVAS_NO_LIMITE_DE_USO = 3;
/** Folga depois do horário em que o limite libera, para não bater nele de novo. */
const FOLGA_DEPOIS_DO_LIMITE_MS = 60 * SEGUNDO;
/** Quando o Claude não diz quando o limite libera. */
const ESPERA_SEM_HORARIO_DO_LIMITE_MS = 15 * MINUTO;
/** O maior atraso que um `setTimeout` aceita (~24,8 dias). */
export const ESPERA_MAXIMA_MS = 2_147_483_647;

/** As causas de falha que o app sabe recuperar; "outro" (e a ausência de causa) não. */
export function ehRecuperavel(causa: CausaDaFalha | undefined): causa is CausaDaRecuperacao {
  return causa === "silencio" || causa === "limite_de_uso" || causa === "sobrecarga" || causa === "rede";
}

export function maximoDeTentativas(causa: CausaDaRecuperacao): number {
  return causa === "limite_de_uso" ? TENTATIVAS_NO_LIMITE_DE_USO : ESPERAS[causa].length;
}

/**
 * Quanto esperar antes da tentativa `tentativa` (1 para a primeira). No
 * limite de uso, até `liberaEm` mais um minuto, sem teto: se libera daqui a
 * horas, retoma daqui a horas.
 */
export function esperaAntesDaTentativa(
  causa: CausaDaRecuperacao,
  tentativa: number,
  liberaEm: string | null,
  agora: Date,
): number {
  if (causa === "limite_de_uso") {
    const libera = liberaEm === null ? Number.NaN : Date.parse(liberaEm);
    if (Number.isNaN(libera)) {
      return ESPERA_SEM_HORARIO_DO_LIMITE_MS;
    }
    return Math.min(Math.max(0, libera + FOLGA_DEPOIS_DO_LIMITE_MS - agora.getTime()), ESPERA_MAXIMA_MS);
  }
  const esperas = ESPERAS[causa];
  return esperas[Math.min(tentativa, esperas.length) - 1] ?? esperas[0] ?? 0;
}

/** A causa como entra numa frase do log: "o Claude ficou sem dar notícias", "limite de uso"… */
export function descreverCausa(causa: CausaDaRecuperacao): string {
  switch (causa) {
    case "silencio":
      return "o Claude ficou sem dar notícias";
    case "limite_de_uso":
      return "limite de uso da assinatura";
    case "sobrecarga":
      return "API do Claude sobrecarregada";
    case "rede":
      return "falha de rede";
  }
}

/** "14:30", no fuso do computador. */
export function formatarHora(data: Date): string {
  return `${String(data.getHours()).padStart(2, "0")}:${String(data.getMinutes()).padStart(2, "0")}`;
}

/** "45 s", "3 min", "2 h 5 min". */
export function formatarDuracao(ms: number): string {
  const segundos = Math.max(0, Math.floor(ms / SEGUNDO));
  if (segundos < 60) {
    return `${segundos} s`;
  }
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) {
    return `${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** O resumo da etapa "aguardando", ex.: "limite de uso, libera às 14:30". */
export function resumoDaEspera(causa: CausaDaRecuperacao, liberaEm: string | null, retomaEm: Date): string {
  switch (causa) {
    case "silencio":
      return `o Claude ficou sem dar notícias; retoma às ${formatarHora(retomaEm)}`;
    case "limite_de_uso": {
      const libera = liberaEm === null ? Number.NaN : Date.parse(liberaEm);
      return Number.isNaN(libera)
        ? `limite de uso, sem horário de liberação; tenta de novo às ${formatarHora(retomaEm)}`
        : `limite de uso, libera às ${formatarHora(new Date(libera))}`;
    }
    case "sobrecarga":
      return `API do Claude sobrecarregada; tenta de novo às ${formatarHora(retomaEm)}`;
    case "rede":
      return `falha de rede; tenta de novo às ${formatarHora(retomaEm)}`;
  }
}

/** O que se tentou, para o resumo da desistência. */
export function descreverEsperas(causa: CausaDaRecuperacao): string {
  if (causa === "limite_de_uso") {
    return "esperando a liberação do limite a cada vez";
  }
  return `com esperas de ${ESPERAS[causa].map(formatarDuracao).join(", ")}`;
}

/**
 * A mensagem que o app manda, na mesma sessão, para o Claude continuar de
 * onde parou. Não pede para desfazer nada: o que já foi feito na pasta fica.
 */
export function mensagemDeRetomada(causa: CausaDaRecuperacao, comWorktree: boolean): string {
  const interrupcao =
    causa === "silencio"
      ? "Você foi interrompido pelo app porque ficou sem dar notícias"
      : causa === "limite_de_uso"
        ? "Você foi interrompido porque o limite de uso da assinatura foi atingido (ele já foi liberado)"
        : causa === "sobrecarga"
          ? "Você foi interrompido porque a API do Claude estava sobrecarregada"
          : "Você foi interrompido por uma falha de rede";
  const onde = comWorktree ? "da worktree" : "da pasta de trabalho";
  return (
    `${interrupcao}. Confira o estado atual ${onde} e do que já foi feito, ` +
    "sem desfazer nada, e continue de onde parou. Se a tarefa já estiver concluída, apenas resuma o resultado."
  );
}
