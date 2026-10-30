import type { TurnoNaTela } from "./aplicarEvento";

export type Fase = "planejar" | "delegar" | "executar" | "sintetizar";

export interface SituacaoDaFase {
  /** Fase em que o turno está (ou parou). Nulo quando o turno terminou bem. */
  atual: Fase | null;
  /** O turno terminou sem concluir (cancelado, falhou, interrompido). */
  parado: boolean;
  /** Frase curta para o nó do Orquestrador. */
  descricao: string;
  /** O Orquestrador respondeu sem lançar Subagentes. */
  direto: boolean;
}

function fasePeloAndamento(turno: TurnoNaTela): Fase {
  if (turno.subagentes.length === 0) {
    return "planejar";
  }
  return turno.subagentes.some((subagente) => subagente.situacao === "executando") ? "executar" : "sintetizar";
}

/**
 * Turno encerrado sem concluir: ao encerrar, os Subagentes que ainda rodavam
 * viram "cancelado" — então havia execução em curso quando parou.
 */
function faseOndeParou(turno: TurnoNaTela): Fase {
  if (turno.subagentes.length === 0) {
    return "planejar";
  }
  return turno.subagentes.some((subagente) => subagente.situacao === "cancelado") ? "executar" : "sintetizar";
}

/**
 * Em que ponto do ciclo o Orquestrador está: planejar as subtarefas, delegar
 * aos Subagentes, esperar a execução e sintetizar a resposta.
 *
 * Deduzida dos Subagentes, porque o Claude Code não anuncia fases: sem
 * Subagentes ainda é planejamento; com algum rodando, execução; com todos
 * encerrados e o turno aberto, síntese.
 */
export function faseDoTurno(turno: TurnoNaTela): SituacaoDaFase {
  const total = turno.subagentes.length;
  const rodando = turno.subagentes.filter((subagente) => subagente.situacao === "executando").length;
  const plural = total === 1 ? "agente" : "agentes";
  // No Plan Mode o pedido só investiga: o que sai dele é um plano, não o trabalho feito.
  const planejamento = turno.modo === "planejamento";

  switch (turno.situacao) {
    case "em_andamento": {
      const atual = fasePeloAndamento(turno);
      const descricao =
        atual === "planejar"
          ? planejamento
            ? "Investigando para montar o plano…"
            : "Planejando as subtarefas…"
          : atual === "executar"
            ? `${rodando} de ${total} ${plural} em execução`
            : "Sintetizando a resposta…";
      return { atual, parado: false, descricao, direto: false };
    }
    case "concluido":
      return {
        atual: null,
        parado: false,
        descricao: planejamento
          ? "Plano entregue"
          : total === 0
            ? "Respondeu diretamente"
            : `Concluído com ${total} ${plural}`,
        direto: total === 0,
      };
    case "cancelado":
      return { atual: faseOndeParou(turno), parado: true, descricao: "Cancelado", direto: false };
    case "falhou":
      return { atual: faseOndeParou(turno), parado: true, descricao: "Falhou", direto: false };
    case "interrompido":
      return { atual: faseOndeParou(turno), parado: true, descricao: "Interrompido", direto: false };
  }
}
