import {
  instrucoesDoOrquestrador,
  instrucoesDoSubagente,
  mensagemParaOOrquestrador,
  Plataforma,
  precisaDeDelegacaoPeloApp,
} from "../../orquestracao/InstrucoesDoOrquestrador";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { DadosDoSubagentePronto } from "../../orquestracao/SubagentesProntos";

/** Marca que envolve as regras fixas do Orquestrador quando elas vão dentro do prompt. */
export const MARCA_DAS_REGRAS_DO_ORQUESTRADOR = "regras-do-orquestrador";

/** Marca que envolve as regras do subagente no prompt de uma subtarefa. */
export const MARCA_DAS_REGRAS_DO_SUBAGENTE = "regras-do-subagente";

/**
 * A mensagem do turno do Orquestrador: o bloco `<configuracao-do-pedido>`, os
 * itens ligados, o contexto da troca de motor e o pedido do usuário — o mesmo
 * texto que o Claude Code recebe.
 */
export function mensagemDoTurno(pedido: PedidoDeTurno, plataforma: Plataforma): string {
  return mensagemParaOOrquestrador(
    pedido.texto,
    pedido.configuracao,
    pedido.anexos,
    pedido.modo,
    pedido.pastaDeArtefatos,
    pedido.instrucoes,
    pedido.revogarInstrucoesAnteriores,
    pedido.subagentesProntos,
    plataforma,
    pedido.itensLigados ?? [],
    pedido.previasAbertas ?? [],
    pedido.contextoDaTroca,
    precisaDeDelegacaoPeloApp(pedido.configuracao),
  );
}

/** As regras fixas do Orquestrador (as que o Claude Code recebe como prompt de sistema). */
export function regrasDoOrquestrador(pedido: PedidoDeTurno): string {
  return instrucoesDoOrquestrador(pedido.pastaDeTrabalho, precisaDeDelegacaoPeloApp(pedido.configuracao));
}

/**
 * O prompt de um motor sem prompt de sistema (o ACP não tem): as regras do
 * Orquestrador, numa marca própria, e depois a mensagem do turno. Vai a cada
 * turno, e não só no primeiro: o agente compacta o histórico quando a conversa
 * cresce, e as regras do primeiro turno poderiam se perder no resumo.
 */
export function promptComRegras(pedido: PedidoDeTurno, plataforma: Plataforma): string {
  return [
    `<${MARCA_DAS_REGRAS_DO_ORQUESTRADOR}>`,
    regrasDoOrquestrador(pedido),
    `</${MARCA_DAS_REGRAS_DO_ORQUESTRADOR}>`,
    "",
    mensagemDoTurno(pedido, plataforma),
  ].join("\n");
}

export interface SubtarefaParaOPrompt {
  descricao: string;
  prompt: string;
}

/**
 * As regras de um Subagente (`executor` ou um subagente pronto, com a
 * especialidade). Valem as permissões do pedido: a regra de commit é a de
 * sempre, e só vale para quem a subtarefa designar.
 */
export function regrasDoSubagente(
  pedido: PedidoDeTurno,
  especialidade: DadosDoSubagentePronto | null,
  plataforma: Plataforma,
): string {
  return instrucoesDoSubagente(
    pedido.pastaDeTrabalho,
    pedido.configuracao.permiteCommitEPush(pedido.modo),
    pedido.pastaDeArtefatos,
    especialidade,
    plataforma,
    false,
  );
}

/** O pedido da subtarefa em si, sem as regras. */
export function textoDaSubtarefa(subtarefa: SubtarefaParaOPrompt): string {
  return [`Subtarefa: ${subtarefa.descricao}`, "", subtarefa.prompt].join("\n");
}

/** O prompt de uma subtarefa para um motor sem prompt de sistema: as regras do subagente e a subtarefa. */
export function promptDaSubtarefa(
  pedido: PedidoDeTurno,
  subtarefa: SubtarefaParaOPrompt,
  especialidade: DadosDoSubagentePronto | null,
  plataforma: Plataforma,
): string {
  return [
    `<${MARCA_DAS_REGRAS_DO_SUBAGENTE}>`,
    regrasDoSubagente(pedido, especialidade, plataforma),
    `</${MARCA_DAS_REGRAS_DO_SUBAGENTE}>`,
    "",
    textoDaSubtarefa(subtarefa),
  ].join("\n");
}
