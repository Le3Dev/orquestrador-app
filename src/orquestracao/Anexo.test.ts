import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  Anexo,
  erroDaQuantidadeDeAnexos,
  MAXIMO_DE_IMAGENS_POR_MENSAGEM,
  TAMANHO_MAXIMO_DA_IMAGEM,
  TAMANHO_MAXIMO_DO_DOCUMENTO,
} from "./Anexo";
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

  it("recusa formatos não aceitos", () => {
    expect(() => imagem({ tipoDeMidia: "image/bmp", nome: "a.bmp" })).toThrow(/Tipo de arquivo não aceito/);
    expect(() => imagem({ tipoDeMidia: "application/x-msdownload", nome: "setup.exe" })).toThrow(/não aceito/);
    expect(() => imagem({ tipoDeMidia: "image/svg+xml", nome: "a.svg" })).toThrow(/não aceito/);
    expect(() => imagem({ tipoDeMidia: "application/msword", nome: "a.doc" })).toThrow(/não aceito/);
    expect(() => imagem({ tipoDeMidia: "", nome: "foto.png" })).toThrow(/não aceito/);
  });

  it("recusa imagem vazia ou acima do limite do Claude", () => {
    expect(() => imagem({ tamanhoEmBytes: 0 })).toThrow(/vazia/);
    expect(() => imagem({ tamanhoEmBytes: TAMANHO_MAXIMO_DA_IMAGEM + 1 })).toThrow(/5 MB/);
    expect(imagem({ tamanhoEmBytes: TAMANHO_MAXIMO_DA_IMAGEM }).tamanhoEmBytes).toBe(TAMANHO_MAXIMO_DA_IMAGEM);
  });

  it("dá um nome quando a imagem vem sem nome (ex.: colada da área de transferência)", () => {
    expect(imagem({ nome: "   " }).nome).toBe("imagem");
  });

  it("aceita os documentos pelo tipo e guarda com a extensão do formato", () => {
    const casos: [string, string, string][] = [
      ["a.pdf", "application/pdf", "pdf"],
      ["a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
      ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
      ["a.xls", "application/vnd.ms-excel", "xls"],
      ["a.csv", "text/csv", "csv"],
      ["a.txt", "text/plain", "txt"],
      ["a.md", "text/markdown", "md"],
    ];
    for (const [nome, tipoDeMidia, extensao] of casos) {
      const anexo = imagem({ nome, tipoDeMidia });
      expect(anexo.categoria).toBe("documento");
      expect(anexo.arquivo).toBe(`a1.${extensao}`);
      expect(anexo.paraDados()).toMatchObject({ categoria: "documento", tipoDeMidia });
    }
    expect(imagem().paraDados().categoria).toBe("imagem");
  });

  it("aceita pela extensão quando o navegador manda tipo vazio ou genérico, normalizando o tipo", () => {
    expect(imagem({ nome: "notas.md", tipoDeMidia: "" }).tipoDeMidia).toBe("text/markdown");
    expect(imagem({ nome: "NOTAS.MD", tipoDeMidia: "application/octet-stream" }).tipoDeMidia).toBe("text/markdown");
    expect(imagem({ nome: "dados.csv", tipoDeMidia: "" }).tipoDeMidia).toBe("text/csv");
    // O Excel do Windows registra .csv como application/vnd.ms-excel.
    expect(imagem({ nome: "dados.csv", tipoDeMidia: "application/vnd.ms-excel" }).tipoDeMidia).toBe("text/csv");
    expect(imagem({ nome: "leia-me.md", tipoDeMidia: "text/plain" }).tipoDeMidia).toBe("text/markdown");
    expect(imagem({ nome: "dados.csv", tipoDeMidia: "text/csv; charset=utf-8" }).tipoDeMidia).toBe("text/csv");
  });

  it("recusa tipo que contradiz a extensão", () => {
    expect(() => imagem({ nome: "virus.exe", tipoDeMidia: "application/pdf" })).toThrow(/não aceito/);
    expect(imagem({ nome: "sem-extensao", tipoDeMidia: "text/csv" }).arquivo).toBe("a1.csv");
    expect(() => imagem({ nome: "foto.pdf", tipoDeMidia: "image/png" })).toThrow(/não aceito/);
    expect(() => imagem({ nome: "planilha.xlsx", tipoDeMidia: "application/pdf" })).toThrow(/não aceito/);
  });

  it("limita documentos a 30 MB e imagens a 5 MB", () => {
    const documento = { nome: "a.pdf", tipoDeMidia: "application/pdf" };
    expect(imagem({ ...documento, tamanhoEmBytes: TAMANHO_MAXIMO_DO_DOCUMENTO }).tamanhoEmBytes).toBe(
      TAMANHO_MAXIMO_DO_DOCUMENTO,
    );
    expect(() => imagem({ ...documento, tamanhoEmBytes: TAMANHO_MAXIMO_DO_DOCUMENTO + 1 })).toThrow(/30 MB/);
    expect(() => imagem({ ...documento, tamanhoEmBytes: 0 })).toThrow(/documento "a.pdf" está vazio/);
    expect(() => imagem({ tamanhoEmBytes: 6 * 1024 * 1024 })).toThrow(/5 MB/);
  });

  it("limita imagens e documentos por mensagem separadamente", () => {
    const de = (categoria: "imagem" | "documento", quantidade: number) =>
      Array.from({ length: quantidade }, () => ({ categoria }));
    expect(erroDaQuantidadeDeAnexos([...de("imagem", 5), ...de("documento", 5)])).toBeNull();
    expect(erroDaQuantidadeDeAnexos(de("imagem", 6))).toMatch(/até 5 imagens/);
    expect(erroDaQuantidadeDeAnexos(de("documento", 6))).toMatch(/até 5 documentos/);
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
