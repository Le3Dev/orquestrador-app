import { Motor, MOTOR_PADRAO, rotuloDoMotor } from "./Motor";
import { DadosDoTurno } from "./Turno";

/**
 * A troca de motor sem perder a conversa. Cada motor tem a própria sessão e só
 * lembra dos turnos que ele mesmo executou; quando outro motor assume um pedido
 * (a reserva por limite de uso, ou um pedido novo enquanto o limite do motor
 * principal não liberou), o novo motor precisa saber o que aconteceu enquanto
 * ele não participava. O worktree é o mesmo, então os arquivos já estão lá:
 * só falta contar a conversa.
 *
 * Função pura sobre o histórico de turnos.
 */

/** Quantos turnos não vistos entram, no máximo (os mais recentes). */
export const MAXIMO_DE_TURNOS_NO_CONTEXTO = 10;
/** O tamanho máximo do texto inteiro, cabeçalho incluído. */
export const MAXIMO_DE_CARACTERES_DO_CONTEXTO = 12_000;
/** O pedido do usuário de cada turno é cortado neste tamanho. */
export const MAXIMO_DO_PEDIDO_NO_CONTEXTO = 1_500;
/** A resposta final de cada turno é cortada neste tamanho. */
export const MAXIMO_DA_RESPOSTA_NO_CONTEXTO = 3_000;
const MAXIMO_DO_MOTIVO_NO_CONTEXTO = 300;

const CORTE = "… [cortado]";

const CABECALHO = [
  "Você está assumindo uma conversa que já teve pedidos atendidos por outro motor, e a sua sessão não os registrou.",
  "Abaixo, do mais antigo ao mais recente, o que aconteceu enquanto você não participava. Os arquivos da pasta de trabalho já refletem esse trabalho: confira o estado atual antes de refazer algo.",
].join("\n");

/** Do que o contexto precisa de um turno: o `DadosDoTurno` serve. */
export type TurnoDoContexto = Pick<DadosDoTurno, "texto" | "resposta" | "situacao" | "motivoDaFalha" | "motor">;

function cortar(texto: string, maximo: number): string {
  const aparado = texto.trim();
  return aparado.length <= maximo ? aparado : `${aparado.slice(0, maximo).trimEnd()}${CORTE}`;
}

/** O que o turno entregou: a resposta final, ou o porquê de não haver uma. */
function resultadoDoTurno(turno: TurnoDoContexto): string {
  const incompleto = "Pode ter deixado trabalho pela metade.";
  switch (turno.situacao) {
    case "concluido": {
      const resposta = cortar(turno.resposta, MAXIMO_DA_RESPOSTA_NO_CONTEXTO);
      return resposta === "" ? "Resposta final: concluído, sem texto de resposta." : `Resposta final:\n${resposta}`;
    }
    case "falhou": {
      const motivo = cortar(turno.motivoDaFalha ?? "", MAXIMO_DO_MOTIVO_NO_CONTEXTO);
      return `Resposta final: nenhuma, o turno falhou${motivo === "" ? "" : ` (${motivo})`}. ${incompleto}`;
    }
    case "cancelado":
      return `Resposta final: nenhuma, o usuário cancelou o turno. ${incompleto}`;
    case "interrompido":
      return `Resposta final: nenhuma, o turno foi interrompido (o app foi reiniciado). ${incompleto}`;
    case "pausado":
      return `Resposta final: nenhuma, o usuário pausou o turno. ${incompleto}`;
    case "em_andamento":
      return "Resposta final: nenhuma ainda.";
  }
}

function descreverTurno(turno: TurnoDoContexto, numero: number): string {
  const motor = rotuloDoMotor(turno.motor ?? MOTOR_PADRAO);
  return [
    `[Pedido ${numero}, atendido por ${motor}]`,
    `Pedido do usuário:\n${cortar(turno.texto, MAXIMO_DO_PEDIDO_NO_CONTEXTO)}`,
    resultadoDoTurno(turno),
  ].join("\n");
}

/**
 * O texto com os turnos que a sessão de `motor` não viu: os feitos por outro
 * motor depois da última participação dele (ou todos, se ele ainda não
 * participou). Cada um leva o pedido do usuário e a resposta final, cortados;
 * entram no máximo os `MAXIMO_DE_TURNOS_NO_CONTEXTO` mais recentes e, se o
 * total passar de `MAXIMO_DE_CARACTERES_DO_CONTEXTO`, os mais antigos saem.
 * Sem turnos não vistos, `null`.
 *
 * `historico` é a conversa em ordem; um turno ainda em andamento (o que vai
 * rodar agora) não entra.
 */
export function contextoDaTroca(historico: readonly TurnoDoContexto[], motor: Motor): string | null {
  const encerrados = historico.filter((turno) => turno.situacao !== "em_andamento");
  let ultimoDoMotor = -1;
  encerrados.forEach((turno, indice) => {
    if ((turno.motor ?? MOTOR_PADRAO) === motor) {
      ultimoDoMotor = indice;
    }
  });
  const naoVistos = encerrados.slice(ultimoDoMotor + 1);
  if (naoVistos.length === 0) {
    return null;
  }

  const recentes = naoVistos.slice(-MAXIMO_DE_TURNOS_NO_CONTEXTO);
  const primeiroNumero = naoVistos.length - recentes.length + 1;
  const blocos = recentes.map((turno, indice) => descreverTurno(turno, primeiroNumero + indice));

  // Dos mais recentes para os mais antigos, enquanto couber; o mais recente entra sempre.
  const reservaDaNota = 120;
  const orcamento = MAXIMO_DE_CARACTERES_DO_CONTEXTO - CABECALHO.length - reservaDaNota;
  const escolhidos: string[] = [];
  let usado = 0;
  for (const bloco of [...blocos].reverse()) {
    if (escolhidos.length > 0 && usado + bloco.length + 2 > orcamento) {
      break;
    }
    escolhidos.unshift(bloco);
    usado += bloco.length + 2;
  }

  const omitidos = naoVistos.length - escolhidos.length;
  const nota =
    omitidos === 0
      ? []
      : [`(${omitidos} ${omitidos === 1 ? "pedido mais antigo foi omitido" : "pedidos mais antigos foram omitidos"} por tamanho.)`];
  return [CABECALHO, ...nota, ...escolhidos].join("\n\n");
}
