import { describe, expect, it } from "vitest";

import {
  DadosDaEtapa,
  EtapaDaRotina,
  MENSAGEM_DE_APROVACAO_INVALIDA,
  MENSAGEM_DE_ESPERA_INVALIDA,
  MENSAGEM_DE_ETAPA_INVALIDA,
  MENSAGEM_DE_MODO_INVALIDO,
  MENSAGEM_DE_ORQUESTRADOR_INVALIDO,
  MENSAGEM_DE_TEXTO_LONGO_DEMAIS,
  MENSAGEM_DE_TEXTO_VAZIO,
} from "./EtapaDaRotina";
import { ErroDeRotina } from "./ErroDeRotina";

function dadosInvalidos(valor: unknown): DadosDaEtapa {
  return valor as DadosDaEtapa;
}

function mensagemDoErro(acao: () => unknown): string {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeRotina) {
      expect(erro.motivo).toBe("dados_invalidos");
      return erro.message;
    }
    throw erro;
  }
  throw new Error("Esperava um ErroDeRotina, mas nada foi lançado.");
}

const PEDIDO = { tipo: "pedido", orquestradorId: "orq-1", texto: "Rode os testes.", modo: "execucao" } as const;

describe("EtapaDaRotina", () => {
  it("cria um pedido, uma aprovação e uma espera", () => {
    expect(EtapaDaRotina.criar(PEDIDO).paraDados()).toEqual(PEDIDO);
    expect(EtapaDaRotina.criar({ ...PEDIDO, modo: "planejamento" }).paraDados()).toMatchObject({ modo: "planejamento" });
    expect(EtapaDaRotina.criar({ tipo: "aprovacao", mensagem: "  Confira o relatório.  " }).paraDados()).toEqual({
      tipo: "aprovacao",
      mensagem: "Confira o relatório.",
    });
    expect(EtapaDaRotina.criar({ tipo: "espera", minutos: 30 }).paraDados()).toEqual({ tipo: "espera", minutos: 30 });
  });

  it("o texto do pedido pode ter até 20.000 caracteres, e é guardado como veio", () => {
    const texto = "x".repeat(20_000);

    expect(EtapaDaRotina.criar({ ...PEDIDO, texto }).paraDados()).toMatchObject({ texto });
    expect(mensagemDoErro(() => EtapaDaRotina.criar({ ...PEDIDO, texto: `${texto}x` }))).toBe(
      MENSAGEM_DE_TEXTO_LONGO_DEMAIS,
    );
    expect(MENSAGEM_DE_TEXTO_LONGO_DEMAIS).toBe("O pedido pode ter até 20.000 caracteres.");
  });

  it.each<[string, unknown, string]>([
    ["pedido sem orquestrador", { ...PEDIDO, orquestradorId: "" }, MENSAGEM_DE_ORQUESTRADOR_INVALIDO],
    ["orquestrador que escapa da pasta", { ...PEDIDO, orquestradorId: "..\\x" }, MENSAGEM_DE_ORQUESTRADOR_INVALIDO],
    ["orquestrador que não é texto", { ...PEDIDO, orquestradorId: 3 }, MENSAGEM_DE_ORQUESTRADOR_INVALIDO],
    ["pedido sem texto", { ...PEDIDO, texto: "   " }, MENSAGEM_DE_TEXTO_VAZIO],
    ["texto que não é texto", { ...PEDIDO, texto: 42 }, MENSAGEM_DE_TEXTO_VAZIO],
    ["modo desconhecido", { ...PEDIDO, modo: "rapido" }, MENSAGEM_DE_MODO_INVALIDO],
    ["aprovação sem mensagem", { tipo: "aprovacao", mensagem: "  " }, MENSAGEM_DE_APROVACAO_INVALIDA],
    ["aprovação com mensagem longa", { tipo: "aprovacao", mensagem: "x".repeat(1_001) }, MENSAGEM_DE_APROVACAO_INVALIDA],
    ["espera de 0 minutos", { tipo: "espera", minutos: 0 }, MENSAGEM_DE_ESPERA_INVALIDA],
    ["espera de mais de um dia", { tipo: "espera", minutos: 1_441 }, MENSAGEM_DE_ESPERA_INVALIDA],
    ["espera fracionada", { tipo: "espera", minutos: 1.5 }, MENSAGEM_DE_ESPERA_INVALIDA],
    ["tipo desconhecido", { tipo: "sono" }, MENSAGEM_DE_ETAPA_INVALIDA],
    ["nulo", null, MENSAGEM_DE_ETAPA_INVALIDA],
  ])("recusa %s", (_caso, dados, mensagem) => {
    expect(mensagemDoErro(() => EtapaDaRotina.criar(dadosInvalidos(dados)))).toBe(mensagem);
  });

  it("é imutável e entrega cópias", () => {
    const etapa = EtapaDaRotina.criar(PEDIDO);

    const copia = etapa.paraDados();
    if (copia.tipo === "pedido") {
      copia.texto = "outro texto";
    }

    expect(Object.isFrozen(etapa)).toBe(true);
    expect(Object.isFrozen(etapa.dados)).toBe(true);
    expect(etapa.paraDados()).toEqual(PEDIDO);
    expect(etapa.tipo).toBe("pedido");
  });
});
