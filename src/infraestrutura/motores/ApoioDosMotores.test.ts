import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { ModoDoTurno } from "../../orquestracao/ModoDoTurno";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import { abrirTurnoNoServidorMcp, FERRAMENTAS_DO_APP_NO_TURNO, PonteParaOServidorMcp } from "./ApoioDosMotores";

function pedido(opcoes: { navegadorDoAgente: boolean; nivel?: NivelDePermissao; modo?: ModoDoTurno }): PedidoDeTurno {
  return {
    orquestradorId: "o1",
    anexos: [],
    pastaDosAnexos: null,
    pastaDeArtefatos: path.resolve("/artefatos/o1"),
    instrucoes: null,
    revogarInstrucoesAnteriores: false,
    subagentesProntos: [],
    sessaoId: "sessao-1",
    sessaoIniciada: false,
    motor: "claude-code",
    contextoDaTroca: null,
    texto: "abra o site",
    modo: opcoes.modo ?? "execucao",
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
      nivelDePermissao: opcoes.nivel ?? "edicao_e_comandos",
      navegadorDoAgente: opcoes.navegadorDoAgente,
    }),
  };
}

describe("FERRAMENTAS_DO_APP_NO_TURNO", () => {
  it("liga o navegador só com a opção ligada, em Editar e rodar comandos e fora do planejamento", () => {
    expect(FERRAMENTAS_DO_APP_NO_TURNO(pedido({ navegadorDoAgente: true }))).toEqual({ navegador: true });
    expect(FERRAMENTAS_DO_APP_NO_TURNO(pedido({ navegadorDoAgente: false }))).toEqual({ navegador: false });
    expect(FERRAMENTAS_DO_APP_NO_TURNO(pedido({ navegadorDoAgente: true, nivel: "edicao" }))).toEqual({ navegador: false });
    expect(FERRAMENTAS_DO_APP_NO_TURNO(pedido({ navegadorDoAgente: true, nivel: "leitura" }))).toEqual({ navegador: false });
    expect(FERRAMENTAS_DO_APP_NO_TURNO(pedido({ navegadorDoAgente: true, modo: "planejamento" }))).toEqual({
      navegador: false,
    });
  });
});

describe("abrirTurnoNoServidorMcp", () => {
  const registro = { url: "http://127.0.0.1:1/mcp", token: "t", encerrar: () => undefined };
  const servidor: PonteParaOServidorMcp = { registrarTurno: () => registro };

  it("registra o turno quando algum grupo está ligado", () => {
    expect(abrirTurnoNoServidorMcp(servidor, { navegador: true }, "o1")).toBe(registro);
  });

  it("devolve nulo sem servidor ou sem nenhum grupo ligado (o turno segue sem MCP)", () => {
    expect(abrirTurnoNoServidorMcp(null, { navegador: true }, "o1")).toBeNull();
    expect(abrirTurnoNoServidorMcp(undefined, { navegador: true }, "o1")).toBeNull();
    expect(abrirTurnoNoServidorMcp(servidor, { navegador: false }, "o1")).toBeNull();
    expect(abrirTurnoNoServidorMcp(servidor, {}, "o1")).toBeNull();
  });
});
