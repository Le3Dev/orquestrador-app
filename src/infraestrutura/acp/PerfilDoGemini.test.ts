import { describe, expect, it } from "vitest";

import { ContextoDePermissao } from "../motores/PoliticaDePermissao";
import { ChamadaDeFerramentaAcp } from "./AdaptadorDeEventosAcp";
import { ferramentasExcluidasDoGemini, criarPerfilDoGemini, VARIAVEL_DAS_CONFIGURACOES_DO_GEMINI } from "./PerfilDoGemini";

const CONTEXTO: ContextoDePermissao = {
  nivel: "edicao_e_comandos",
  modo: "execucao",
  pastaDeTrabalho: "/projeto",
  pastaDeArtefatos: "/artefatos",
  pastaDosAnexos: "/anexos",
  permiteCommitEPush: false,
};

const chamada = (titulo: string, tipo: ChamadaDeFerramentaAcp["tipo"] = "other"): ChamadaDeFerramentaAcp => ({
  id: "1",
  titulo,
  tipo,
  entrada: {},
  caminhos: [],
});

describe("PerfilDoGemini", () => {
  const perfil = criarPerfilDoGemini("gemini");

  it("inicia o gemini em modo ACP, com a aprovação padrão (o app decide)", () => {
    expect(perfil.motor).toBe("gemini");
    expect(perfil.comando()).toEqual({ executavel: "gemini", argumentosIniciais: ["--acp", "--approval-mode", "default"] });
  });

  it("resolve o executável a cada turno quando recebe uma função", () => {
    let atual = "gemini";
    const dinamico = criarPerfilDoGemini(() => atual);
    atual = "C:\\npm\\gemini.cmd";
    expect(dinamico.comando().executavel).toBe("C:\\npm\\gemini.cmd");
  });

  it("libera a pasta de artefatos e a dos anexos, e só passa o modelo quando não é o padrão", () => {
    expect(perfil.argumentosDoTurno({ contexto: CONTEXTO, modelo: "padrao" })).toEqual([
      "--include-directories",
      "/artefatos",
      "--include-directories",
      "/anexos",
    ]);
    expect(perfil.argumentosDoTurno({ contexto: { ...CONTEXTO, pastaDosAnexos: null }, modelo: "gemini-2.5-pro" })).toEqual([
      "--include-directories",
      "/artefatos",
      "--model",
      "gemini-2.5-pro",
    ]);
  });

  it("não herda o que libera tudo", () => {
    const ambiente = perfil.ambiente({ GEMINI_YOLO: "true", GEMINI_APPROVAL_MODE: "yolo", GEMINI_API_KEY: "chave", PATH: "/bin" });
    expect(ambiente["GEMINI_YOLO"]).toBeUndefined();
    expect(ambiente["GEMINI_APPROVAL_MODE"]).toBeUndefined();
    expect(ambiente["GEMINI_API_KEY"]).toBe("chave");
    expect(ambiente["PATH"]).toBe("/bin");
  });

  describe("segunda barreira (tools.exclude)", () => {
    it("sem comandos no nível: nega o shell inteiro", () => {
      expect(ferramentasExcluidasDoGemini({ ...CONTEXTO, nivel: "edicao" })).toEqual(["run_shell_command"]);
      expect(ferramentasExcluidasDoGemini({ ...CONTEXTO, modo: "planejamento" })).toEqual(["run_shell_command"]);
    });

    it("com comandos e sem commit liberado: nega git commit e git push", () => {
      expect(ferramentasExcluidasDoGemini(CONTEXTO)).toEqual(["run_shell_command(git commit)", "run_shell_command(git push)"]);
    });

    it("com comandos e commit liberado: não nega nada", () => {
      expect(ferramentasExcluidasDoGemini({ ...CONTEXTO, permiteCommitEPush: true })).toEqual([]);
    });
  });

  describe("configuração por arquivo", () => {
    const porArquivo = perfil.configuracaoPorArquivo;

    it("leva o servidor MCP com httpUrl, token e tempo limite longo, e trava o modo automático", () => {
      expect(porArquivo?.conteudo({ contexto: CONTEXTO, servidor: { nome: "orquestrador", url: "http://127.0.0.1:1/mcp", token: "t" } })).toEqual({
        general: { enableAutoUpdate: false, enableAutoUpdateNotification: false, defaultApprovalMode: "default" },
        security: { disableYoloMode: true },
        tools: { exclude: ["run_shell_command(git commit)", "run_shell_command(git push)"] },
        mcpServers: {
          orquestrador: { httpUrl: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer t" }, timeout: 3_600_000 },
        },
      });
    });

    it("sem servidor (subtarefa), não leva mcpServers", () => {
      expect(porArquivo?.conteudo({ contexto: CONTEXTO, servidor: null })).not.toHaveProperty("mcpServers");
    });

    it("aponta o CLI para o arquivo pela variável das configurações do sistema", () => {
      expect(porArquivo?.ambiente("/tmp/c.json")).toEqual({ [VARIAVEL_DAS_CONFIGURACOES_DO_GEMINI]: "/tmp/c.json" });
    });
  });

  describe("ferramentas do app", () => {
    it("reconhece a delegação pelo nome, com prefixo ou sufixo do servidor MCP", () => {
      expect(perfil.ehFerramentaDoApp(chamada("delegar_subtarefas"))).toBe(true);
      expect(perfil.ehFerramentaDoApp(chamada("mcp_orquestrador_delegar_subtarefas"))).toBe(true);
      expect(perfil.ehFerramentaDoApp(chamada("delegar_subtarefas (orquestrador MCP Server)"))).toBe(true);
    });

    it("não confunde com outra ferramenta nem com um comando", () => {
      expect(perfil.ehFerramentaDoApp(chamada("outra_ferramenta"))).toBe(false);
      expect(perfil.ehFerramentaDoApp(chamada("delegar_subtarefas", "execute"))).toBe(false);
    });
  });

  describe("login e mensagens", () => {
    it("reconhece 'não logado' só no código -32000", () => {
      expect(perfil.ehFaltaDeLogin("Authentication required.", -32000)).toBe(true);
      expect(perfil.ehFaltaDeLogin("Gemini API key is missing or not configured.", -32000)).toBe(true);
      expect(perfil.ehFaltaDeLogin("Authentication required.", -32603)).toBe(false);
      expect(perfil.ehFaltaDeLogin("Rate limit exceeded. Try again later.", 429)).toBe(false);
    });

    it("diz como instalar e como entrar", () => {
      expect(perfil.comoInstalar).toBe("npm install -g @google/gemini-cli");
      expect(perfil.comoEntrar).toContain("GEMINI_API_KEY");
    });
  });
});
