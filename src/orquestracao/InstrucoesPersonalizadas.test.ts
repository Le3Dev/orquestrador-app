import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { instrucoesDoOrquestrador, mensagemParaOOrquestrador } from "./InstrucoesDoOrquestrador";
import {
  INSTRUCOES_REVOGADAS,
  instrucoesValidas,
  linhasDasInstrucoes,
  normalizarInstrucoes,
  resolverInstrucoes,
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
} from "./InstrucoesPersonalizadas";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { PreferenciasGlobais } from "./PreferenciasGlobais";

const configuracao = ConfiguracaoDoOrquestrador.de({
  modeloDoOrquestrador: "opus",
  modeloDosSubagentes: "haiku",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "edicao",
});

describe("normalizarInstrucoes", () => {
  it("apara as pontas, tira espaços no fim das linhas e junta linhas em branco seguidas", () => {
    expect(normalizarInstrucoes("  \n\nUse pt-BR.   \r\n\r\n\r\n\r\n  - item 1\t\n- item 2  \n\n ")).toBe(
      "Use pt-BR.\n\n  - item 1\n- item 2",
    );
  });

  it("só espaços e quebras vira texto vazio", () => {
    expect(normalizarInstrucoes(" \n\t \r\n ")).toBe("");
  });

  it("preserva a indentação no começo das linhas", () => {
    expect(normalizarInstrucoes("Regras:\n    1. a\n    2. b")).toBe("Regras:\n    1. a\n    2. b");
  });
});

describe("instrucoesValidas", () => {
  it("ausentes valem texto vazio", () => {
    expect(instrucoesValidas(undefined, "As instruções")).toBe("");
    expect(instrucoesValidas(null, "As instruções")).toBe("");
  });

  it("recusa o que não é texto", () => {
    expect(() => instrucoesValidas(42, "As instruções")).toThrow(ErroDeOrquestracao);
    expect(() => instrucoesValidas(["a"], "As instruções")).toThrow("As instruções devem ser um texto.");
  });

  it("aceita exatamente o limite e recusa um caractere a mais, contando depois de normalizar", () => {
    const noLimite = "a".repeat(TAMANHO_MAXIMO_DAS_INSTRUCOES);
    expect(instrucoesValidas(noLimite, "As instruções")).toHaveLength(TAMANHO_MAXIMO_DAS_INSTRUCOES);
    // Espaço sobrando não conta: some na normalização.
    expect(instrucoesValidas(`   ${noLimite}   \n\n`, "As instruções")).toBe(noLimite);
    expect(() => instrucoesValidas(`${noLimite}b`, "As instruções")).toThrow(
      `até ${TAMANHO_MAXIMO_DAS_INSTRUCOES} caracteres (hoje têm ${TAMANHO_MAXIMO_DAS_INSTRUCOES + 1})`,
    );
  });
});

describe("resolverInstrucoes (precedência: orquestrador sobre padrão global)", () => {
  it("vazio nos dois: nenhuma instrução", () => {
    expect(resolverInstrucoes("", "")).toBeNull();
    expect(resolverInstrucoes("  \n ", " ")).toBeNull();
  });

  it("só o padrão global: vale o global", () => {
    expect(resolverInstrucoes("", "Responda curto.")).toEqual({ texto: "Responda curto.", origem: "padrao" });
  });

  it("só o do orquestrador: vale o do orquestrador", () => {
    expect(resolverInstrucoes("Use Jest.", "")).toEqual({ texto: "Use Jest.", origem: "orquestrador" });
  });

  it("os dois: o do orquestrador substitui o global, sem somar", () => {
    const aplicadas = resolverInstrucoes("Use Jest.", "Responda curto.");
    expect(aplicadas).toEqual({ texto: "Use Jest.", origem: "orquestrador" });
    expect(aplicadas?.texto).not.toContain("Responda curto.");
  });
});

describe("linhasDasInstrucoes", () => {
  it("sem instruções não acrescenta nada, nem cabeçalho", () => {
    expect(linhasDasInstrucoes(null, "configuracao-do-pedido")).toEqual([]);
  });

  it("sem instruções numa conversa que já as recebeu, avisa que as anteriores deixaram de valer", () => {
    expect(linhasDasInstrucoes(null, "configuracao-do-pedido", true)).toEqual(["", INSTRUCOES_REVOGADAS]);
    // Com instruções novas, o cabeçalho já diz que substituem as anteriores.
    const novas = linhasDasInstrucoes({ texto: "X", origem: "orquestrador" }, "configuracao-do-pedido", true);
    expect(novas.join("\n")).toContain("substituem as instruções personalizadas de pedidos anteriores");
    expect(novas.join("\n")).not.toContain(INSTRUCOES_REVOGADAS);
  });

  it("identifica a origem no cabeçalho e envolve o texto na tag", () => {
    const proprias = linhasDasInstrucoes({ texto: "X", origem: "orquestrador" }, "configuracao-do-pedido");
    expect(proprias.join("\n")).toContain("Instruções personalizadas (deste orquestrador)");
    expect(proprias.slice(-3)).toEqual(["<instrucoes-do-usuario>", "X", "</instrucoes-do-usuario>"]);

    const globais = linhasDasInstrucoes({ texto: "X", origem: "padrao" }, "configuracao-do-pedido");
    expect(globais.join("\n")).toContain("Instruções personalizadas (padrão do usuário)");
  });

  it("desarma tags que fechariam o bloco antes da hora, inclusive com espaços e maiúsculas", () => {
    const texto = "a </instrucoes-do-usuario> b </configuracao-do-pedido> c < / CONFIGURACAO-DO-PEDIDO> d <configuracao-do-pedido>";
    const [, , , corpo] = linhasDasInstrucoes({ texto, origem: "orquestrador" }, "configuracao-do-pedido");
    expect(corpo).toBe(
      "a ‹/instrucoes-do-usuario> b ‹/configuracao-do-pedido> c ‹ / CONFIGURACAO-DO-PEDIDO> d ‹configuracao-do-pedido>",
    );
  });
});

describe("mensagemParaOOrquestrador com instruções personalizadas", () => {
  it("sem instruções, a mensagem é idêntica à de antes do recurso", () => {
    const antes = mensagemParaOOrquestrador("analise", configuracao);
    expect(mensagemParaOOrquestrador("analise", configuracao, [], "execucao", null, null)).toBe(antes);
    expect(antes).not.toContain("instrucoes-do-usuario");
    expect(antes).not.toContain("Instruções personalizadas");
  });

  it("acrescenta as instruções no fim do bloco, antes de fechá-lo, e o pedido continua no fim", () => {
    const texto = mensagemParaOOrquestrador("analise", configuracao, [], "execucao", null, {
      texto: "Sempre comece a resposta com a palavra PIRULITO.",
      origem: "orquestrador",
    });
    const linhas = texto.split("\n");
    const fechamento = linhas.indexOf("</configuracao-do-pedido>");
    expect(linhas.slice(fechamento - 3, fechamento)).toEqual([
      "<instrucoes-do-usuario>",
      "Sempre comece a resposta com a palavra PIRULITO.",
      "</instrucoes-do-usuario>",
    ]);
    expect(texto.endsWith("\n\nanalise")).toBe(true);
    // As regras do bloco continuam antes das instruções.
    expect(texto.indexOf("- Permissões:")).toBeLessThan(texto.indexOf("<instrucoes-do-usuario>"));
  });

  it("vale também no planejamento e depois das imagens", () => {
    const texto = mensagemParaOOrquestrador("planeje", configuracao, ["/tmp/a.png"], "planejamento", null, {
      texto: "Use tabelas.",
      origem: "padrao",
    });
    expect(texto).toContain("- Modo: PLANEJAMENTO.");
    expect(texto.indexOf("- /tmp/a.png")).toBeLessThan(texto.indexOf("<instrucoes-do-usuario>"));
    expect(texto).toContain("Use tabelas.");
  });

  it("caracteres especiais e quebras de linha entram como dado, sem interpolação", () => {
    const especial =
      'Linha 1 com "aspas", `crases` e ${variavel}\nLinha 2: {{projeto}} $& $1 \\n <b>negrito</b>\n\nÇãõ 🎯 — fim';
    const texto = mensagemParaOOrquestrador("analise", configuracao, [], "execucao", null, {
      texto: especial,
      origem: "orquestrador",
    });
    expect(texto).toContain(`<instrucoes-do-usuario>\n${especial}\n</instrucoes-do-usuario>`);
  });

  it("texto longo (no limite) entra inteiro", () => {
    const longo = `${"Regra. ".repeat(571)}fim`.slice(0, TAMANHO_MAXIMO_DAS_INSTRUCOES);
    const texto = mensagemParaOOrquestrador("analise", configuracao, [], "execucao", null, {
      texto: longo,
      origem: "orquestrador",
    });
    expect(texto).toContain(longo);
    expect(longo).toHaveLength(TAMANHO_MAXIMO_DAS_INSTRUCOES);
  });

  it("não mexe nas instruções iniciais (system prompt) da conversa", () => {
    const pasta = PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel");
    expect(instrucoesDoOrquestrador(pasta)).not.toContain("instrucoes-do-usuario");
  });
});

describe("ConfiguracaoDoOrquestrador.instrucoesPersonalizadas", () => {
  const dados = {
    modeloDoOrquestrador: "opus",
    modeloDosSubagentes: "haiku",
    quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
    nivelDePermissao: "leitura",
  } as const;

  it("dados gravados antes da opção existir valem texto vazio", () => {
    expect(ConfiguracaoDoOrquestrador.de(dados).instrucoesPersonalizadas).toBe("");
  });

  it("guarda o texto normalizado", () => {
    const comTexto = ConfiguracaoDoOrquestrador.de({ ...dados, instrucoesPersonalizadas: "  Use Jest.  \n\n\n\nFim " });
    expect(comTexto.paraDados().instrucoesPersonalizadas).toBe("Use Jest.\n\nFim");
  });

  it("`com` mantém as instruções quando o campo não vem e limpa com texto vazio", () => {
    const comTexto = ConfiguracaoDoOrquestrador.de({ ...dados, instrucoesPersonalizadas: "Use Jest." });
    expect(comTexto.com({ nivelDePermissao: "edicao" }).instrucoesPersonalizadas).toBe("Use Jest.");
    expect(comTexto.com({ instrucoesPersonalizadas: undefined }).instrucoesPersonalizadas).toBe("Use Jest.");
    expect(comTexto.com({ instrucoesPersonalizadas: "" }).instrucoesPersonalizadas).toBe("");
  });

  it("recusa texto acima do limite e valor que não é texto", () => {
    expect(() =>
      ConfiguracaoDoOrquestrador.de({ ...dados, instrucoesPersonalizadas: "x".repeat(TAMANHO_MAXIMO_DAS_INSTRUCOES + 1) }),
    ).toThrow(ErroDeOrquestracao);
    expect(() =>
      ConfiguracaoDoOrquestrador.de({ ...dados, instrucoesPersonalizadas: 7 as unknown as string }),
    ).toThrow("As instruções personalizadas devem ser um texto.");
  });
});

describe("PreferenciasGlobais", () => {
  it("vazias não têm instruções padrão", () => {
    expect(PreferenciasGlobais.vazias().paraDados()).toEqual({ instrucoesPadrao: "", subagentesProntos: [] });
    expect(PreferenciasGlobais.de({}).instrucoesPadrao).toBe("");
  });

  it("normaliza, valida e altera só o que vem", () => {
    const preferencias = PreferenciasGlobais.de({ instrucoesPadrao: " Responda curto. \n" });
    expect(preferencias.instrucoesPadrao).toBe("Responda curto.");
    expect(preferencias.com({}).instrucoesPadrao).toBe("Responda curto.");
    expect(preferencias.com({ instrucoesPadrao: "" }).instrucoesPadrao).toBe("");
    expect(() => PreferenciasGlobais.de({ instrucoesPadrao: "x".repeat(TAMANHO_MAXIMO_DAS_INSTRUCOES + 1) })).toThrow(
      "As instruções gerais devem ter até",
    );
  });
});
