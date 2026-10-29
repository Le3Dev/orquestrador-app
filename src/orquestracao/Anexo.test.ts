import path from "node:path";

import { describe, expect, it } from "vitest";

import { Anexo, MAXIMO_DE_IMAGENS_POR_MENSAGEM, TAMANHO_MAXIMO_DA_IMAGEM } from "./Anexo";
import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { mensagemParaOOrquestrador } from "./InstrucoesDoOrquestrador";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";

const imagem = (dados: Partial<{ id: string; nome: string; tipoDeMidia: string; tamanhoEmBytes: number }> = {}) =>
  Anexo.de({ id: "a1", nome: "tela.png", tipoDeMidia: "image/png", tamanhoEmBytes: 1024, ...dados });

describe("Anexo", () => {
  it("guarda o arquivo com o id e a extensão do formato", () => {
    expect(imagem().arquivo).toBe("a1.png");
    expect(imagem({ tipoDeMidia: "image/jpeg" }).arquivo).toBe("a1.jpg");
    expect(imagem({ tipoDeMidia: "image/webp" }).arquivo).toBe("a1.webp");
  });

  it("recusa formatos que o Claude não lê", () => {
    expect(() => imagem({ tipoDeMidia: "application/pdf" })).toThrow(/PNG, JPEG, GIF ou WebP/);
  });

  it("recusa imagem vazia ou acima do limite do Claude", () => {
    expect(() => imagem({ tamanhoEmBytes: 0 })).toThrow(/vazia/);
    expect(() => imagem({ tamanhoEmBytes: TAMANHO_MAXIMO_DA_IMAGEM + 1 })).toThrow(/5 MB/);
    expect(imagem({ tamanhoEmBytes: TAMANHO_MAXIMO_DA_IMAGEM }).tamanhoEmBytes).toBe(TAMANHO_MAXIMO_DA_IMAGEM);
  });

  it("dá um nome quando a imagem vem sem nome (ex.: colada da área de transferência)", () => {
    expect(imagem({ nome: "   " }).nome).toBe("imagem");
  });
});

describe("Orquestrador com imagens", () => {
  function novo(): Orquestrador {
    return Orquestrador.criar({
      id: "o1",
      nome: "Painel",
      pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
      sessaoId: "s1",
      configuracao: ConfiguracaoDoOrquestrador.de({
        modeloDoOrquestrador: "opus",
        modeloDosSubagentes: "opus",
        quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
        nivelDePermissao: "leitura",
      }),
      agora: new Date(),
    });
  }

  it("leva as imagens no evento e no turno", () => {
    const orquestrador = novo();
    const evento = orquestrador.iniciarTurno("t1", "veja", new Date(), [imagem()]);

    expect(evento).toMatchObject({ tipo: "turno_iniciado", anexos: [{ arquivo: "a1.png", nome: "tela.png" }] });
    expect(orquestrador.turnoEmAndamento?.anexos).toHaveLength(1);
  });

  it(`aceita no máximo ${MAXIMO_DE_IMAGENS_POR_MENSAGEM} imagens por mensagem`, () => {
    const muitas = Array.from({ length: MAXIMO_DE_IMAGENS_POR_MENSAGEM + 1 }, (_, indice) => imagem({ id: `a${indice}` }));

    expect(() => novo().iniciarTurno("t1", "veja", new Date(), muitas)).toThrow(/até 5 imagens/);
  });

  it("reabre turnos gravados antes de existirem anexos", () => {
    const dados = novo().paraDados();
    const turnoAntigo = {
      id: "t0",
      texto: "antigo",
      iniciadoEm: "2026-10-28T10:00:00.000Z",
      encerradoEm: "2026-10-28T10:01:00.000Z",
      situacao: "concluido" as const,
      resposta: "ok",
      motivoDaFalha: null,
      uso: null,
      subagentes: [],
    };

    const reaberto = Orquestrador.reconstituir({ ...dados, turnos: [turnoAntigo as never] });

    expect(reaberto.paraDados().turnos[0]?.anexos).toEqual([]);
  });
});

describe("mensagemParaOOrquestrador com imagens", () => {
  it("cita os caminhos para o orquestrador repassar aos subagentes", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "opus",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
    });

    const texto = mensagemParaOOrquestrador("veja o erro", configuracao, ["C:/dados/anexos/o1/a1.png"]);

    expect(texto).toContain("Imagens anexadas");
    expect(texto).toContain("- C:/dados/anexos/o1/a1.png");
    expect(texto.endsWith("veja o erro")).toBe(true);
  });
});
