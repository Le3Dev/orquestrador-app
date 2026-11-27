import { describe, expect, it, vi } from "vitest";

import { CatalogoDeMotores, DependenciasDoCatalogo, versaoNaSaida } from "./CatalogoDeMotores";
import { ExecutorDeComandoCurto, SaidaCurta } from "./ExecucaoCurtaDeCli";

const CAMINHOS = { "claude-code": "claude", codex: "codex", copilot: "copilot", gemini: "gemini" } as const;

function saida(parcial: Partial<SaidaCurta>): SaidaCurta {
  return { codigoDeSaida: 0, saida: "", erro: "", tempoEsgotado: false, falhaAoIniciar: null, ...parcial };
}

/** O que cada CLI responde, por "executável argumento1 argumento2". */
function comandosFalsos(respostas: Record<string, Partial<SaidaCurta>>): ExecutorDeComandoCurto & ReturnType<typeof vi.fn> {
  return vi.fn(async (executavel: string, argumentos: readonly string[]) => {
    const chave = `${executavel} ${argumentos.join(" ")}`;
    const resposta = respostas[chave];
    if (resposta === undefined) throw new Error(`Comando inesperado: ${chave}`);
    return saida(resposta);
  });
}

function catalogo(
  instalados: Record<string, string>,
  respostas: Record<string, Partial<SaidaCurta>>,
  extras: Partial<DependenciasDoCatalogo> = {},
): { catalogo: CatalogoDeMotores; executar: ReturnType<typeof comandosFalsos> } {
  const executar = comandosFalsos(respostas);
  return {
    executar,
    catalogo: new CatalogoDeMotores({
      caminhos: CAMINHOS,
      executar,
      procurar: (nome) => instalados[nome] ?? null,
      verificarLoginDoCopilot: async () => true,
      verificarLoginDoGemini: async () => true,
      ...extras,
    }),
  };
}

const TUDO_INSTALADO = { claude: "/bin/claude", codex: "/bin/codex", copilot: "/bin/copilot", gemini: "/bin/gemini" };
const RESPOSTAS_COMPLETAS: Record<string, Partial<SaidaCurta>> = {
  "/bin/claude --version": { saida: "2.1.322 (Claude Code)" },
  '/bin/claude auth status': { saida: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "alguem@exemplo.com" }) },
  "/bin/codex --version": { saida: "codex-cli 0.169.0" },
  "/bin/codex login status": { saida: "Logged in using ChatGPT" },
  "/bin/copilot --version": { saida: "GitHub Copilot CLI 1.0.83.\nRun 'copilot update' to check for updates." },
  "/bin/gemini --version": { saida: "0.21.0" },
};

describe("CatalogoDeMotores", () => {
  it("lista os quatro motores na ordem, com caminho, versão e login", async () => {
    const { catalogo: motores } = catalogo(TUDO_INSTALADO, RESPOSTAS_COMPLETAS);

    expect(await motores.listar()).toEqual([
      { motor: "claude-code", rotulo: "Claude Code", instalado: true, versao: "2.1.322", caminho: "/bin/claude", logado: true, mensagem: null },
      { motor: "codex", rotulo: "Codex", instalado: true, versao: "0.169.0", caminho: "/bin/codex", logado: true, mensagem: null },
      { motor: "copilot", rotulo: "GitHub Copilot CLI", instalado: true, versao: "1.0.83", caminho: "/bin/copilot", logado: true, mensagem: null },
      { motor: "gemini", rotulo: "Gemini CLI", instalado: true, versao: "0.21.0", caminho: "/bin/gemini", logado: true, mensagem: null },
    ]);
  });

  it("não devolve dados pessoais do login (o e-mail do Claude fica de fora)", async () => {
    const { catalogo: motores } = catalogo(TUDO_INSTALADO, RESPOSTAS_COMPLETAS);

    expect(JSON.stringify(await motores.listar())).not.toContain("alguem@exemplo.com");
  });

  it("diz como instalar o que não está instalado, sem consultar nada dele", async () => {
    const { catalogo: motores, executar } = catalogo(
      { claude: "/bin/claude" },
      { "/bin/claude --version": { saida: "2.1.322" }, "/bin/claude auth status": { saida: '{"loggedIn":true}' } },
    );

    const [, codex, copilot, gemini] = await motores.listar();

    expect(codex).toMatchObject({ motor: "codex", instalado: false, versao: null, caminho: null, logado: null });
    expect(codex?.mensagem).toContain("npm install -g @openai/codex");
    expect(copilot?.mensagem).toContain("npm install -g @github/copilot");
    expect(gemini?.mensagem).toContain("npm install -g @google/gemini-cli");
    expect(executar).toHaveBeenCalledTimes(2);
  });

  it("marca como não logado e diz como entrar", async () => {
    const { catalogo: motores } = catalogo(TUDO_INSTALADO, {
      ...RESPOSTAS_COMPLETAS,
      "/bin/claude auth status": { codigoDeSaida: 1, saida: '{"loggedIn":false}' },
      "/bin/codex login status": { codigoDeSaida: 1, saida: "Not logged in" },
    }, { verificarLoginDoCopilot: async () => false, verificarLoginDoGemini: async () => false });

    const [claude, codex, copilot, gemini] = await motores.listar();

    expect(claude).toMatchObject({ logado: false, mensagem: expect.stringContaining("/login") });
    expect(codex).toMatchObject({ logado: false, mensagem: expect.stringContaining("codex login") });
    expect(copilot).toMatchObject({ logado: false, mensagem: expect.stringContaining("copilot login") });
    expect(gemini).toMatchObject({ logado: false, mensagem: expect.stringContaining("GEMINI_API_KEY") });
  });

  it("deixa o login como nulo quando não dá para saber, sem tratar como erro", async () => {
    const { catalogo: motores } = catalogo(TUDO_INSTALADO, {
      ...RESPOSTAS_COMPLETAS,
      "/bin/codex login status": { codigoDeSaida: 2, erro: "erro estranho" },
      "/bin/claude auth status": { tempoEsgotado: true, codigoDeSaida: null },
    }, { verificarLoginDoCopilot: async () => null, verificarLoginDoGemini: async () => null });

    const [claude, codex, copilot, gemini] = await motores.listar();

    expect(claude).toMatchObject({ instalado: true, logado: null, mensagem: null });
    expect(codex).toMatchObject({ instalado: true, logado: null, mensagem: null });
    expect(copilot).toMatchObject({ instalado: true, logado: null, mensagem: null });
    expect(gemini).toMatchObject({ instalado: true, logado: null, mensagem: null });
  });

  it("trata um executável que não roda como não instalado, com o motivo", async () => {
    const { catalogo: motores } = catalogo(TUDO_INSTALADO, {
      ...RESPOSTAS_COMPLETAS,
      "/bin/codex --version": { codigoDeSaida: null, falhaAoIniciar: "EACCES" },
    });

    const codex = (await motores.listar())[1];

    expect(codex).toMatchObject({ instalado: false, caminho: "/bin/codex" });
    expect(codex?.mensagem).toContain("EACCES");
  });

  it("guarda a resposta por um tempo, divide a consulta entre chamadas simultâneas e refaz ao renovar", async () => {
    let agora = 1_000;
    const { catalogo: motores, executar } = catalogo(TUDO_INSTALADO, RESPOSTAS_COMPLETAS, { validadeMs: 60_000, agora: () => agora });

    await Promise.all([motores.listar(), motores.listar()]);
    const chamadas = executar.mock.calls.length;
    await motores.listar();
    expect(executar.mock.calls.length).toBe(chamadas);

    agora += 30_000;
    await motores.listar();
    expect(executar.mock.calls.length).toBe(chamadas);

    await motores.listar(true);
    expect(executar.mock.calls.length).toBe(chamadas * 2);

    agora += 61_000;
    await motores.listar();
    expect(executar.mock.calls.length).toBe(chamadas * 3);
  });

  it("devolve a situação de um motor só", async () => {
    const { catalogo: motores } = catalogo(TUDO_INSTALADO, RESPOSTAS_COMPLETAS);

    expect(await motores.situacaoDe("codex")).toMatchObject({ motor: "codex", versao: "0.169.0" });
  });
});

describe("versaoNaSaida", () => {
  it("acha o número da versão no que cada CLI escreve", () => {
    expect(versaoNaSaida("codex-cli 0.169.0")).toBe("0.169.0");
    expect(versaoNaSaida("GitHub Copilot CLI 1.0.83.")).toBe("1.0.83");
    expect(versaoNaSaida("2.1.322 (Claude Code)")).toBe("2.1.322");
    expect(versaoNaSaida("1.2.3-beta.4")).toBe("1.2.3-beta.4");
    expect(versaoNaSaida("sem versão")).toBeNull();
  });
});
