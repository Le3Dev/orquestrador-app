import { describe, expect, it } from "vitest";

import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ModoDoTurno } from "./ModoDoTurno";
import { PedidoNaFila, TAMANHO_MAXIMO_DA_MENSAGEM } from "./PedidoNaFila";

const enfileiradoEm = new Date("2026-11-05T10:00:00Z");

function capturarErro(acao: () => unknown): ErroDeOrquestracao {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeOrquestracao) {
      return erro;
    }
  }
  throw new Error("Era esperado um ErroDeOrquestracao.");
}

describe("PedidoNaFila e a origem de vínculo", () => {
  it("guarda de quem veio, leva no paraDados e no reconstituir, e sem origem o campo nem aparece", () => {
    const origem = { orquestradorId: "o1", nome: "API", saltos: 2 };
    const pedido = PedidoNaFila.criar({ id: "p1", texto: "oi", modo: "execucao", enfileiradoEm, origem });

    expect(pedido.origem).toEqual(origem);
    expect(Object.isFrozen(pedido.origem)).toBe(true);
    expect(pedido.paraDados().origem).toEqual(origem);
    expect(PedidoNaFila.reconstituir(pedido.paraDados()).origem).toEqual(origem);

    const doUsuario = PedidoNaFila.criar({ id: "p2", texto: "oi", modo: "execucao", enfileiradoEm });
    expect(doUsuario.origem).toBeNull();
    expect(doUsuario.paraDados()).not.toHaveProperty("origem");
  });

  it("reconstitui pedidos gravados antes dos vínculos (sem origem)", () => {
    const antigo = PedidoNaFila.reconstituir({ id: "p", texto: "t", modo: "execucao", enfileiradoEm: enfileiradoEm.toISOString() });

    expect(antigo.origem).toBeNull();
  });
});

describe("PedidoNaFila", () => {
  it("guarda o texto aparado, o modo e o instante em que entrou na fila", () => {
    const pedido = PedidoNaFila.criar({ id: "p1", texto: "  rode os testes  ", modo: "planejamento", enfileiradoEm });

    expect(pedido.id).toBe("p1");
    expect(pedido.texto).toBe("rode os testes");
    expect(pedido.modo).toBe("planejamento");
    expect(pedido.enfileiradoEm).toEqual(enfileiradoEm);
  });

  it.each([[""], ["   "], ["\n\t "]])("recusa o texto %j", (texto) => {
    const erro = capturarErro(() => PedidoNaFila.criar({ id: "p1", texto, modo: "execucao", enfileiradoEm }));

    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe("Escreva o pedido.");
  });

  it("recusa texto acima do limite da mensagem e aceita no limite", () => {
    const noLimite = "a".repeat(TAMANHO_MAXIMO_DA_MENSAGEM);

    expect(PedidoNaFila.criar({ id: "p1", texto: noLimite, modo: "execucao", enfileiradoEm }).texto).toBe(noLimite);
    const erro = capturarErro(() =>
      PedidoNaFila.criar({ id: "p2", texto: `${noLimite}a`, modo: "execucao", enfileiradoEm }),
    );
    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe(`O pedido deve ter até ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`);
  });

  it("recusa modo desconhecido", () => {
    const erro = capturarErro(() =>
      PedidoNaFila.criar({ id: "p1", texto: "oi", modo: "turbo" as ModoDoTurno, enfileiradoEm }),
    );

    expect(erro.message).toBe("Modo do pedido inválido.");
  });

  it("é imutável: congelado, e o instante devolvido é uma cópia", () => {
    const pedido = PedidoNaFila.criar({ id: "p1", texto: "oi", modo: "execucao", enfileiradoEm });

    expect(Object.isFrozen(pedido)).toBe(true);
    expect(() => {
      (pedido as unknown as { texto: string }).texto = "outro";
    }).toThrow(TypeError);
    pedido.enfileiradoEm.setFullYear(2000);
    expect(pedido.texto).toBe("oi");
    expect(pedido.enfileiradoEm).toEqual(enfileiradoEm);
  });

  it("paraDados traz o instante em ISO e reconstituir devolve o mesmo pedido", () => {
    const pedido = PedidoNaFila.criar({ id: "p1", texto: "oi", modo: "planejamento", enfileiradoEm });

    const dados = pedido.paraDados();

    expect(dados).toEqual({ id: "p1", texto: "oi", modo: "planejamento", enfileiradoEm: "2026-11-05T10:00:00.000Z" });
    expect(PedidoNaFila.reconstituir(dados).paraDados()).toEqual(dados);
  });

  it("congela os itens ligados como estavam ao enfileirar e os leva no paraDados e no reconstituir", () => {
    const itens = [{ tipo: "nota" as const, titulo: "Ideias", conteudo: "usar cache" }];
    const pedido = PedidoNaFila.criar({ id: "p1", texto: "oi", modo: "execucao", enfileiradoEm, itensLigados: itens });
    itens[0]!.conteudo = "mudou depois";

    expect(pedido.itensLigados).toEqual([{ tipo: "nota", titulo: "Ideias", conteudo: "usar cache" }]);
    expect(Object.isFrozen(pedido.itensLigados[0])).toBe(true);
    const dados = pedido.paraDados();
    expect(dados.itensLigados).toEqual([{ tipo: "nota", titulo: "Ideias", conteudo: "usar cache" }]);
    expect(PedidoNaFila.reconstituir(dados).paraDados()).toEqual(dados);
    // Gravado antes dos itens ligados: nenhum.
    expect(PedidoNaFila.reconstituir({ id: "p2", texto: "oi", modo: "execucao", enfileiradoEm: "2026-11-05T10:00:00.000Z" }).itensLigados).toEqual([]);
  });

  it("congela as prévias abertas, as leva no paraDados e no reconstituir, e sem elas o campo nem aparece", () => {
    const abertas = ["http://localhost:5173"];
    const pedido = PedidoNaFila.criar({ id: "p1", texto: "oi", modo: "execucao", enfileiradoEm, previasAbertas: abertas });
    abertas.push("http://localhost:4173");

    expect(pedido.previasAbertas).toEqual(["http://localhost:5173"]);
    const dados = pedido.paraDados();
    expect(dados.previasAbertas).toEqual(["http://localhost:5173"]);
    expect(PedidoNaFila.reconstituir(dados).paraDados()).toEqual(dados);
    expect(PedidoNaFila.criar({ id: "p2", texto: "oi", modo: "execucao", enfileiradoEm }).paraDados()).not.toHaveProperty("previasAbertas");
    expect(PedidoNaFila.reconstituir({ id: "p3", texto: "oi", modo: "execucao", enfileiradoEm: "2026-11-05T10:00:00.000Z" }).previasAbertas).toEqual([]);
  });
});
