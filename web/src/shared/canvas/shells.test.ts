import {
  escreverNoPromptDoTerminal,
  limparPromptsDosTerminais,
  registrarPromptDoTerminal,
} from "./promptsDosTerminais";
import {
  blocoParaOOrquestrador,
  enderecoDoWebSocket,
  lerMensagemDoShell,
  LINHAS_PARA_O_ORQUESTRADOR,
  nomeCurtoDaPasta,
  textoParaOOrquestrador,
  ultimasLinhas,
} from "./shells";

describe("conexão do shell", () => {
  it("o WebSocket é da mesma origem, seguro numa página https", () => {
    expect(enderecoDoWebSocket("/api/terminais/t1/conexao", { protocol: "http:", host: "localhost:3200" })).toBe(
      "ws://localhost:3200/api/terminais/t1/conexao",
    );
    expect(enderecoDoWebSocket("/api/terminais/t1/conexao", { protocol: "https:", host: "app.local" })).toBe(
      "wss://app.local/api/terminais/t1/conexao",
    );
  });

  it("lê só as mensagens conhecidas", () => {
    expect(lerMensagemDoShell(JSON.stringify({ tipo: "saida", dados: "oi" }))).toEqual({ tipo: "saida", dados: "oi" });
    expect(lerMensagemDoShell(JSON.stringify({ tipo: "fim", codigo: 130 }))).toEqual({ tipo: "fim", codigo: 130 });
    expect(lerMensagemDoShell(JSON.stringify({ tipo: "fim" }))).toEqual({ tipo: "fim", codigo: null });
    expect(lerMensagemDoShell(JSON.stringify({ tipo: "saida", dados: 5 }))).toBeNull();
    expect(lerMensagemDoShell(JSON.stringify({ tipo: "outro" }))).toBeNull();
    expect(lerMensagemDoShell("não é json")).toBeNull();
    expect(lerMensagemDoShell(new ArrayBuffer(2))).toBeNull();
  });

  it("o nome curto da pasta é a última parte do caminho", () => {
    expect(nomeCurtoDaPasta("/Users/pedro/projetos/meu-app/")).toBe("meu-app");
    expect(nomeCurtoDaPasta("C:\\projetos\\api")).toBe("api");
  });
});

describe("texto para o orquestrador", () => {
  it("pega as últimas linhas, sem as em branco do fim", () => {
    expect(ultimasLinhas(["a", "b", "c", "", "  "], 2)).toEqual(["b", "c"]);
    expect(ultimasLinhas(["", ""], 5)).toEqual([]);
  });

  it("sem seleção, vão as últimas 40 linhas", () => {
    const linhas = Array.from({ length: 60 }, (_, indice) => `linha ${indice + 1}`);

    const texto = textoParaOOrquestrador("", linhas);

    expect(LINHAS_PARA_O_ORQUESTRADOR).toBe(40);
    expect(texto).toBe(`\`\`\`\n${linhas.slice(20).join("\n")}\n\`\`\``);
  });

  it("com seleção, vai só ela; sem nada além de espaços, nada vai", () => {
    expect(textoParaOOrquestrador("Erro: x", ["outra coisa"])).toBe("```\nErro: x\n```");
    expect(textoParaOOrquestrador("  ", ["", " "])).toBeNull();
  });

  it("a cerca do bloco é maior que qualquer sequência de crases da saída", () => {
    expect(blocoParaOOrquestrador("antes\n```js\nx\n```\n")).toBe("````\nantes\n```js\nx\n```\n````");
  });
});

describe("prompts dos terminais", () => {
  afterEach(() => limparPromptsDosTerminais());

  it("escreve no prompt registrado e para de escrever depois de tirado do registro", () => {
    const prompt = { acrescentarTexto: vi.fn() };
    const tirar = registrarPromptDoTerminal("o1", prompt);

    expect(escreverNoPromptDoTerminal("o1", "oi")).toBe(true);
    tirar();
    expect(escreverNoPromptDoTerminal("o1", "depois")).toBe(false);

    expect(prompt.acrescentarTexto).toHaveBeenCalledTimes(1);
    expect(prompt.acrescentarTexto).toHaveBeenCalledWith("oi");
  });

  it("com o terminal fechado, o texto espera e entra (uma vez só) quando o prompt aparece", () => {
    expect(escreverNoPromptDoTerminal("o1", "a")).toBe(false);
    escreverNoPromptDoTerminal("o1", "b");
    const prompt = { acrescentarTexto: vi.fn() };

    registrarPromptDoTerminal("o1", prompt);
    registrarPromptDoTerminal("o1", prompt);

    expect(prompt.acrescentarTexto.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("tirar do registro um prompt já substituído não tira o novo", () => {
    const antigo = { acrescentarTexto: vi.fn() };
    const novo = { acrescentarTexto: vi.fn() };
    const tirarAntigo = registrarPromptDoTerminal("o1", antigo);
    registrarPromptDoTerminal("o1", novo);

    tirarAntigo();
    escreverNoPromptDoTerminal("o1", "x");

    expect(novo.acrescentarTexto).toHaveBeenCalledWith("x");
    expect(antigo.acrescentarTexto).not.toHaveBeenCalled();
  });
});
