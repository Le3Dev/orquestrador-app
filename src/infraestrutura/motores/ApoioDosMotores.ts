import { readFile } from "node:fs/promises";

import { UsoDoTurno } from "../../orquestracao/EventoDeOrquestracao";
import { FERRAMENTA_DE_DELEGACAO, precisaDeDelegacaoPeloApp } from "../../orquestracao/InstrucoesDoOrquestrador";
import { PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { NOME_DO_GRUPO_DO_NAVEGADOR } from "../mcp/FerramentasDoNavegador";
import { FerramentasDoTurno, RegistroDoTurnoMcp } from "../mcp/ServidorMcpDoApp";
import { RegistroDeTurnosDoApp } from "./RegistroDeTurnosDoApp";

/** O servidor MCP do app, do ponto de vista de um motor: só abrir o turno. */
export interface PonteParaOServidorMcp {
  registrarTurno(pedido: { orquestradorId: string; ferramentas: FerramentasDoTurno }): RegistroDoTurnoMcp;
}

/** Quais grupos de ferramentas do app o turno liga. */
export type FerramentasDoAppNoTurno = (pedido: PedidoDeTurno) => FerramentasDoTurno;

/** Por padrão, só a delegação, e só quando o motor precisa dela (`precisaDeDelegacaoPeloApp`). */
export const FERRAMENTAS_DO_APP_POR_PADRAO: FerramentasDoAppNoTurno = (pedido) => ({
  [FERRAMENTA_DE_DELEGACAO]: precisaDeDelegacaoPeloApp(pedido.configuracao),
});

/**
 * Os grupos do servidor MCP do app que um turno do Orquestrador liga, qualquer
 * que seja o motor: o navegador do agente, só com a opção ligada, no nível
 * "Editar e rodar comandos" e fora do planejamento (`permiteNavegador`). É o
 * `ferramentasDoTurno` que o `root.ts` dá ao Claude Code.
 */
export const FERRAMENTAS_DO_APP_NO_TURNO: FerramentasDoAppNoTurno = (pedido) => ({
  [NOME_DO_GRUPO_DO_NAVEGADOR]: pedido.configuracao.permiteNavegador(pedido.modo),
});

/**
 * Abre o turno no servidor MCP do app para os grupos de ferramentas ligados;
 * nulo quando não há servidor ou nenhum grupo está ligado (o turno segue sem MCP).
 */
export function abrirTurnoNoServidorMcp(
  servidor: PonteParaOServidorMcp | null | undefined,
  ferramentas: FerramentasDoTurno,
  orquestradorId: string,
): RegistroDoTurnoMcp | null {
  if (servidor === undefined || servidor === null || !Object.values(ferramentas).some(Boolean)) {
    return null;
  }
  return servidor.registrarTurno({ orquestradorId, ferramentas });
}

/** As imagens anexadas, em base64 (só elas vão inline; os documentos o agente abre pelo caminho). */
export async function lerImagensDoPedido(pedido: PedidoDeTurno): Promise<Array<{ tipoDeMidia: string; base64: string }>> {
  return Promise.all(
    pedido.anexos
      .filter((anexo) => anexo.categoria === "imagem")
      .map(async (imagem) => ({
        tipoDeMidia: imagem.tipoDeMidia,
        base64: (await readFile(imagem.caminho)).toString("base64"),
      })),
  );
}

/**
 * Os subagentes lançados pelas ferramentas do app e os tokens deles entram no
 * consumo do turno, como no Claude Code (cujo `modelUsage` inclui os subagentes).
 */
export function somarConsumoDosSubagentes(
  turnos: RegistroDeTurnosDoApp | undefined,
  pedido: PedidoDeTurno,
  resultado: ResultadoDoTurno,
): ResultadoDoTurno {
  const turno = turnos?.obter(pedido.orquestradorId);
  if (turno === undefined || resultado.uso === null) {
    return resultado;
  }
  const uso: UsoDoTurno = {
    ...resultado.uso,
    tokensDeEntrada: resultado.uso.tokensDeEntrada + turno.tokensDeEntradaDosSubagentes,
    tokensDeSaida: resultado.uso.tokensDeSaida + turno.tokensDeSaidaDosSubagentes,
    subagentesLancados: turno.subagentesLancados,
  };
  return { ...resultado, uso };
}

export function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
