import { ErroDeRotina } from "./ErroDeRotina";

export const MINUTOS_MINIMOS_DO_INTERVALO = 15;
/** Um ano: mais que isso é um erro de digitação, e evita datas fora do alcance do `Date`. */
export const MINUTOS_MAXIMOS_DO_INTERVALO = 525_600;

export const MENSAGEM_DE_HORA_INVALIDA = "A hora deve estar no formato HH:MM, de 00:00 a 23:59.";
export const MENSAGEM_DE_DIAS_INVALIDOS =
  "Escolha ao menos um dia da semana, de 0 (domingo) a 6 (sábado), sem repetir.";
export const MENSAGEM_DE_INTERVALO_INVALIDO = `O intervalo deve ser de ${MINUTOS_MINIMOS_DO_INTERVALO} a ${MINUTOS_MAXIMOS_DO_INTERVALO} minutos.`;
export const MENSAGEM_DE_DATA_INVALIDA = "Informe a data e a hora da execução única (por exemplo, 2026-12-01T09:00:00-03:00).";
export const MENSAGEM_DE_GATILHO_INVALIDO = "O gatilho deve ser diário, semanal, intervalo ou uma vez.";

export type DadosDoGatilho =
  | { tipo: "diario"; hora: string }
  | { tipo: "semanal"; dias: number[]; hora: string }
  | { tipo: "intervalo"; minutos: number }
  | { tipo: "uma_vez"; /** ISO 8601 */ em: string };

export type TipoDeGatilho = DadosDoGatilho["tipo"];

/** Dia do calendário: `mes` de 0 (janeiro) a 11, como no `Date`. */
export interface DiaDoCalendario {
  ano: number;
  mes: number;
  dia: number;
}

/**
 * O relógio de parede de um fuso horário. Os gatilhos diário e semanal falam
 * em "9h", e não em "a cada 24 horas": é aqui que o horário de verão é
 * resolvido. Em produção vale o fuso do sistema; os testes injetam outros.
 */
export interface FusoHorario {
  /** O dia em que o relógio de parede do fuso está neste instante. */
  diaDe(instante: Date): DiaDoCalendario;
  /**
   * O instante em que o relógio de parede do fuso marca esse dia e hora
   * (`dia` pode passar do fim do mês). Hora que não existe (salto do horário
   * de verão) vale como a hora seguinte; hora que existe duas vezes (volta do
   * horário de verão) vale como a primeira.
   */
  instanteDe(ano: number, mes: number, dia: number, hora: number, minuto: number): Date;
}

/** O `Date` já faz exatamente o que a interface pede, no fuso do sistema. */
export const FUSO_DO_SISTEMA: FusoHorario = {
  diaDe: (instante) => ({ ano: instante.getFullYear(), mes: instante.getMonth(), dia: instante.getDate() }),
  instanteDe: (ano, mes, dia, hora, minuto) => new Date(ano, mes, dia, hora, minuto, 0, 0),
};

const FORMATO_DA_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const FORMATO_DA_DATA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UM_MINUTO_EM_MS = 60_000;
/** Mais que uma semana à frente não é preciso procurar: o dia permitido sempre aparece antes. */
const DIAS_PROCURADOS = 8;

function horaValida(hora: unknown): { texto: string; hora: number; minuto: number } {
  const partes = typeof hora === "string" ? FORMATO_DA_HORA.exec(hora) : null;
  if (partes === null) {
    throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_HORA_INVALIDA);
  }
  return { texto: hora as string, hora: Number(partes[1]), minuto: Number(partes[2]) };
}

function diasValidos(dias: unknown): readonly number[] {
  if (!Array.isArray(dias) || dias.length === 0 || dias.length > 7) {
    throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_DIAS_INVALIDOS);
  }
  const unicos = new Set<number>();
  for (const dia of dias as unknown[]) {
    if (typeof dia !== "number" || !Number.isInteger(dia) || dia < 0 || dia > 6 || unicos.has(dia)) {
      throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_DIAS_INVALIDOS);
    }
    unicos.add(dia);
  }
  return [...unicos].sort((a, b) => a - b);
}

function minutosValidos(minutos: unknown): number {
  if (
    typeof minutos !== "number" ||
    !Number.isInteger(minutos) ||
    minutos < MINUTOS_MINIMOS_DO_INTERVALO ||
    minutos > MINUTOS_MAXIMOS_DO_INTERVALO
  ) {
    throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_INTERVALO_INVALIDO);
  }
  return minutos;
}

function dataValida(em: unknown): number {
  if (typeof em !== "string" || !FORMATO_DA_DATA.test(em) || Number.isNaN(Date.parse(em))) {
    throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_DATA_INVALIDA);
  }
  return Date.parse(em);
}

/**
 * Objeto de valor: quando uma Rotina dispara. Imutável; dois gatilhos com os
 * mesmos dados são iguais.
 *
 * - `diario`: todo dia, na hora local `HH:MM`.
 * - `semanal`: nos dias da semana (0 = domingo ... 6 = sábado), na hora local.
 * - `intervalo`: a cada N minutos (no mínimo 15), contados da última ocorrência.
 * - `uma_vez`: numa data e hora só.
 */
export class Gatilho {
  private constructor(private readonly dados: Readonly<DadosDoGatilho>) {
    Object.freeze(this);
  }

  /** Valida e cria. `dados` pode vir de qualquer lugar (corpo HTTP, arquivo): nada é presumido. */
  static criar(dados: DadosDoGatilho): Gatilho {
    const tipo: unknown = (dados as { tipo?: unknown } | null)?.tipo;
    switch (tipo) {
      case "diario":
        return new Gatilho(Object.freeze({ tipo: "diario", hora: horaValida((dados as { hora?: unknown }).hora).texto }));
      case "semanal": {
        const semanal = dados as { dias?: unknown; hora?: unknown };
        return new Gatilho(
          Object.freeze({
            tipo: "semanal",
            dias: Object.freeze(diasValidos(semanal.dias)) as number[],
            hora: horaValida(semanal.hora).texto,
          }),
        );
      }
      case "intervalo":
        return new Gatilho(
          Object.freeze({ tipo: "intervalo", minutos: minutosValidos((dados as { minutos?: unknown }).minutos) }),
        );
      case "uma_vez":
        return new Gatilho(
          Object.freeze({ tipo: "uma_vez", em: new Date(dataValida((dados as { em?: unknown }).em)).toISOString() }),
        );
      default:
        throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_GATILHO_INVALIDO);
    }
  }

  static reconstituir(dados: DadosDoGatilho): Gatilho {
    return Gatilho.criar(dados);
  }

  get tipo(): TipoDeGatilho {
    return this.dados.tipo;
  }

  /**
   * A primeira ocorrência estritamente depois de `depoisDe`, ou `null` quando
   * não há mais nenhuma (`uma_vez` que já passou).
   *
   * Para `intervalo`, `depoisDe` é a âncora: a última execução (ou a criação).
   */
  proximaOcorrencia(depoisDe: Date, fuso: FusoHorario = FUSO_DO_SISTEMA): Date | null {
    const dados = this.dados;
    switch (dados.tipo) {
      case "intervalo":
        return new Date(depoisDe.getTime() + dados.minutos * UM_MINUTO_EM_MS);
      case "uma_vez": {
        const em = Date.parse(dados.em);
        return em > depoisDe.getTime() ? new Date(em) : null;
      }
      case "diario":
        return proximoHorarioDoDia(depoisDe, fuso, dados.hora, null);
      case "semanal":
        return proximoHorarioDoDia(depoisDe, fuso, dados.hora, dados.dias);
    }
  }

  igualA(outro: Gatilho): boolean {
    return JSON.stringify(this.paraDados()) === JSON.stringify(outro.paraDados());
  }

  /** Uma cópia: quem recebe pode mexer à vontade sem alterar o gatilho. */
  paraDados(): DadosDoGatilho {
    const dados = this.dados;
    switch (dados.tipo) {
      case "diario":
        return { tipo: "diario", hora: dados.hora };
      case "semanal":
        return { tipo: "semanal", dias: [...dados.dias], hora: dados.hora };
      case "intervalo":
        return { tipo: "intervalo", minutos: dados.minutos };
      case "uma_vez":
        return { tipo: "uma_vez", em: dados.em };
    }
  }
}

/**
 * Procura, dia a dia a partir do dia de `depoisDe` no fuso, o primeiro dia
 * permitido cuja hora local fica depois de `depoisDe`. O dia da semana vem do
 * calendário puro (UTC), que não sofre com horário de verão.
 */
function proximoHorarioDoDia(
  depoisDe: Date,
  fuso: FusoHorario,
  horaTexto: string,
  diasPermitidos: readonly number[] | null,
): Date {
  const { hora, minuto } = horaValida(horaTexto);
  const hoje = fuso.diaDe(depoisDe);
  for (let adiante = 0; adiante < DIAS_PROCURADOS; adiante++) {
    const dia = new Date(Date.UTC(hoje.ano, hoje.mes, hoje.dia + adiante));
    if (diasPermitidos !== null && !diasPermitidos.includes(dia.getUTCDay())) {
      continue;
    }
    const candidato = fuso.instanteDe(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), hora, minuto);
    if (candidato.getTime() > depoisDe.getTime()) {
      return candidato;
    }
  }
  // Inalcançável com gatilhos válidos: sempre há um dia permitido na semana seguinte.
  throw new ErroDeRotina("dados_invalidos", "Não foi possível calcular a próxima execução desta rotina.");
}
