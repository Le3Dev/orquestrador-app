import type { ResumoDoArtefato } from "../api/artefatos";
import {
  artefatoAberto,
  comArtefatoAberto,
  criarLojaDosArtefatos,
  lugarLivre,
  posicaoParaArtefato,
  semArtefato,
  sincronizarArtefatos,
  terminalDaOrigem,
} from "./artefatos";
import { interpretarLayout, lerLayout, salvarLayout, sobrepoe, TAMANHO_DO_ARTEFATO } from "./layout";
import {
  ehArtefato,
  idDoNoDoArtefato,
  layoutDosNos,
  type NoDoCanvas,
  nosDoLayout,
  novaNota,
  novoNoDeArtefato,
  novoTerminal,
} from "./nos";

function artefato(id: string, alteracoes: Partial<ResumoDoArtefato> = {}): ResumoDoArtefato {
  return {
    id,
    titulo: `Artefato ${id}`,
    formato: "html",
    origem: { tipo: "orquestrador", id: "o1" },
    arquivo: `${id}.html`,
    criadoEm: "2026-11-05T12:00:00Z",
    atualizadoEm: "2026-11-05T12:00:00Z",
    versaoAtual: 1,
    versoes: [{ numero: 1, criadaEm: "2026-11-05T12:00:00Z", tamanho: 100 }],
    ...alteracoes,
  };
}

const TERMINAL = { x: 0, y: 0, largura: 600, altura: 520 };
const terminal = novoTerminal("o1", { x: TERMINAL.x, y: TERMINAL.y }, TERMINAL.largura, TERMINAL.altura);
const CENTRO = { x: 2000, y: 1500 };

function retanguloDoArtefato(posicao: { x: number; y: number }) {
  return { ...posicao, ...TAMANHO_DO_ARTEFATO };
}

describe("lugarLivre", () => {
  it("fica no primeiro desejado livre; se nenhum servir, anda para a direita até passar dos obstáculos", () => {
    const obstaculo = { x: 0, y: 0, largura: 500, altura: 500 };

    expect(lugarLivre([{ x: 600, y: 0 }], { largura: 100, altura: 100 }, [obstaculo])).toEqual({ x: 600, y: 0 });
    expect(lugarLivre([{ x: 0, y: 0 }, { x: 600, y: 0 }], { largura: 100, altura: 100 }, [obstaculo])).toEqual({
      x: 600,
      y: 0,
    });
    // Nenhum livre: passa do obstáculo (com a folga de 24).
    expect(lugarLivre([{ x: 100, y: 100 }], { largura: 100, altura: 100 }, [obstaculo])).toEqual({ x: 524, y: 100 });
  });
});

describe("posicaoParaArtefato", () => {
  it("com o terminal da origem aberto, abre à direita dele, com o topo alinhado", () => {
    const posicao = posicaoParaArtefato([terminal], TAMANHO_DO_ARTEFATO, "o1", CENTRO);

    expect(posicao).toEqual({ x: 640, y: 0 });
    expect(sobrepoe(retanguloDoArtefato(posicao), TERMINAL)).toBe(false);
  });

  it("com a direita ocupada (por uma nota), vai para a esquerda do terminal", () => {
    const nota = novaNota("n1", { x: 700, y: 0 });
    const posicao = posicaoParaArtefato([terminal, nota], TAMANHO_DO_ARTEFATO, "o1", CENTRO);

    expect(posicao).toEqual({ x: -680, y: 0 });
  });

  it("com os dois lados ocupados, anda para a direita até um lugar livre, sem cobrir nada", () => {
    const nos: NoDoCanvas[] = [
      terminal,
      novaNota("n1", { x: 700, y: 0 }),
      novoNoDeArtefato("outro", { x: -700, y: 0 }),
    ];
    const posicao = posicaoParaArtefato(nos, TAMANHO_DO_ARTEFATO, "o1", CENTRO);

    expect(posicao.y).toBe(0);
    for (const ocupado of [TERMINAL, { x: 700, y: 0, largura: 320, altura: 280 }, { x: -700, y: 0, ...TAMANHO_DO_ARTEFATO }]) {
      expect(sobrepoe(retanguloDoArtefato(posicao), ocupado)).toBe(false);
    }
  });

  it("sem terminal (chat ou orquestrador fechado), abre centralizado no ponto dado", () => {
    expect(posicaoParaArtefato([terminal], TAMANHO_DO_ARTEFATO, null, CENTRO)).toEqual({
      x: CENTRO.x - TAMANHO_DO_ARTEFATO.largura / 2,
      y: CENTRO.y - TAMANHO_DO_ARTEFATO.altura / 2,
    });
  });

  it("no centro ocupado por um terminal, não o cobre", () => {
    const noCentro = novoTerminal("o2", { x: 1700, y: 1200 }, 600, 520);
    const posicao = posicaoParaArtefato([noCentro], TAMANHO_DO_ARTEFATO, null, CENTRO);

    expect(sobrepoe(retanguloDoArtefato(posicao), { x: 1700, y: 1200, largura: 600, altura: 520 })).toBe(false);
  });
});

describe("terminalDaOrigem", () => {
  it("só o terminal aberto do Orquestrador que criou o artefato", () => {
    expect(terminalDaOrigem([terminal], artefato("a1"))).toBe("o1");
    expect(terminalDaOrigem([terminal], artefato("a1", { origem: { tipo: "orquestrador", id: "o9" } }))).toBeNull();
    expect(terminalDaOrigem([terminal], artefato("a1", { origem: { tipo: "chat", id: null } }))).toBeNull();
  });
});

describe("abrir, fechar e sincronizar janelas de artefatos", () => {
  afterEach(() => localStorage.clear());

  it("abrir não duplica; fechar tira só aquela janela", () => {
    const nos: NoDoCanvas[] = [terminal];
    const aberto = comArtefatoAberto(nos, "a1", { x: 640, y: 0 });

    expect(artefatoAberto(aberto, "a1")).toBe(true);
    expect(aberto.find((no) => no.id === idDoNoDoArtefato("a1"))).toMatchObject({
      type: "artefato",
      position: { x: 640, y: 0 },
      width: TAMANHO_DO_ARTEFATO.largura,
      height: TAMANHO_DO_ARTEFATO.altura,
      data: { artefatoId: "a1" },
    });
    expect(comArtefatoAberto(aberto, "a1", { x: 0, y: 0 })).toBe(aberto);
    expect(semArtefato(aberto, "a1")).toEqual([terminal]);
    expect(semArtefato(nos, "a1")).toBe(nos);
  });

  it("grava e lê de volta a posição e o tamanho; um layout antigo, sem artefatos, continua válido", () => {
    salvarLayout(layoutDosNos([terminal, novoNoDeArtefato("a1", { x: 10.4, y: 20.6 }, 700, 500)], null));

    expect(lerLayout().artefatos).toEqual({ a1: { x: 10, y: 21, largura: 700, altura: 500 } });
    expect(nosDoLayout(lerLayout()).filter(ehArtefato)).toEqual([
      expect.objectContaining({ id: idDoNoDoArtefato("a1"), position: { x: 10, y: 21 }, width: 700, height: 500 }),
    ]);
    expect(interpretarLayout(JSON.stringify({ terminais: {}, notas: {} })).artefatos).toEqual({});
    expect(
      interpretarLayout(JSON.stringify({ artefatos: { bom: { x: 0, y: 0, largura: 1, altura: 1 }, ruim: { x: "a" } } }))
        .artefatos,
    ).toEqual({ bom: { x: 0, y: 0, largura: 1, altura: 1 } });
  });

  it("o artefato apagado no servidor sai do canvas e do layout", () => {
    salvarLayout(
      layoutDosNos([novoNoDeArtefato("a1", { x: 0, y: 0 }), novoNoDeArtefato("apagado", { x: 700, y: 0 })], null),
    );

    const nos = sincronizarArtefatos(nosDoLayout(lerLayout()), new Set(["a1"]));
    salvarLayout(layoutDosNos(nos, null));

    expect(Object.keys(lerLayout().artefatos)).toEqual(["a1"]);
    // Nada a tirar: o mesmo array.
    expect(sincronizarArtefatos(nos, new Set(["a1", "outro"]))).toBe(nos);
  });
});

describe("loja dos artefatos", () => {
  it("só avisa quando algo muda, e o artefato que não mudou continua o mesmo objeto", () => {
    const loja = criarLojaDosArtefatos();
    const avisos = vi.fn();
    loja.assinar(avisos);
    const a1 = artefato("a1");
    const lista = [a1, artefato("a2")];

    loja.publicar({ lista, carregada: true, erro: null });
    loja.publicar({ lista, carregada: true, erro: null });

    expect(avisos).toHaveBeenCalledTimes(1);
    expect(loja.ler("a1")).toBe(a1);
    expect(loja.lerCarregada()).toBe(true);

    loja.publicar({ lista: [a1], carregada: true, erro: null });
    expect(loja.ler("a1")).toBe(a1);
    expect(loja.ler("a2")).toBeUndefined();
    expect(avisos).toHaveBeenCalledTimes(2);
  });
});
