import type { DadosDaConfiguracao } from "./api/tipos";
import {
  comMotorDoPapel,
  comoModeloClaude,
  comPredefinicao,
  CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
  ehMotor,
  modeloPadraoDoMotor,
  modeloServeAoMotor,
  motorDoOrquestradorDe,
  motorDosSubagentesDe,
  nomeCurtoDoMotor,
  nomeComVersao,
  nomeDoModeloDoMotor,
  ordemDeReservaDe,
  problemaDoModeloDoMotor,
  rotuloDoEsforco,
  rotuloDoMotor,
  usaSoOClaudeCode,
  versaoDoModeloUsado,
} from "./modelos";

describe("modelos do chat", () => {
  it("lê a versão do identificador do modelo, só da mesma família", () => {
    expect(versaoDoModeloUsado("claude-opus-5-5", "opus")).toBe("5.5");
    expect(versaoDoModeloUsado("claude-haiku-4-5-20251001", "haiku")).toBe("4.5");
    expect(versaoDoModeloUsado("claude-opus-4-20250514", "opus")).toBe("4");
    expect(versaoDoModeloUsado("claude-sonnet-5-5", "opus")).toBeNull();
    expect(versaoDoModeloUsado(null, "opus")).toBeNull();
  });

  it("monta o nome com a versão usada ou a da tabela", () => {
    expect(nomeComVersao("opus", "claude-opus-5-6")).toBe("Opus 5.6");
    expect(nomeComVersao("opus", "claude-sonnet-5-6")).toBe("Opus 5.5");
    expect(nomeComVersao("fable", null)).toBe("Fable 5.2");
  });

  it("rotula os esforços", () => {
    expect(rotuloDoEsforco("padrao")).toBe("Padrão");
    expect(rotuloDoEsforco("extra_alto")).toBe("Extra alto");
    expect(rotuloDoEsforco("ultracode")).toBe("Ultracode");
  });
});

describe("motores", () => {
  const configuracao: DadosDaConfiguracao = { ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR };

  it("a configuração padrão começa no Claude Code, sem reserva e sem navegador", () => {
    expect(CONFIGURACAO_PADRAO_DO_ORQUESTRADOR).toMatchObject({
      motorDoOrquestrador: "claude-code",
      motorDosSubagentes: "claude-code",
      ordemDeReserva: [],
      navegadorDoAgente: false,
    });
  });

  it("rotula os motores como o usuário os conhece; um que a tela não conhece volta como veio", () => {
    expect(rotuloDoMotor("claude-code")).toBe("Claude Code");
    expect(rotuloDoMotor("codex")).toBe("Codex");
    expect(rotuloDoMotor("copilot")).toBe("GitHub Copilot CLI");
    expect(rotuloDoMotor("gemini")).toBe("gemini");
    expect(nomeCurtoDoMotor("claude-code")).toBe("Claude");
    expect(nomeCurtoDoMotor("copilot")).toBe("Copilot");
    expect(ehMotor("codex")).toBe(true);
    expect(ehMotor("gemini")).toBe(false);
    expect(ehMotor(undefined)).toBe(false);
  });

  it("o que falta na configuração vale o padrão (Claude Code, sem reserva)", () => {
    expect(motorDoOrquestradorDe({})).toBe("claude-code");
    expect(motorDosSubagentesDe({})).toBe("claude-code");
    expect(ordemDeReservaDe({})).toEqual([]);
    expect(motorDoOrquestradorDe({ motorDoOrquestrador: "codex" })).toBe("codex");
  });

  it("o modelo padrão de cada motor segue a regra do servidor", () => {
    expect(modeloPadraoDoMotor("claude-code", "orquestrador")).toBe("opus");
    expect(modeloPadraoDoMotor("claude-code", "subagentes")).toBe("sonnet");
    expect(modeloPadraoDoMotor("codex", "orquestrador")).toBe("padrao");
    expect(modeloPadraoDoMotor("copilot", "subagentes")).toBe("padrao");
  });

  it("confere o modelo pelo motor: apelidos do Claude no Claude Code; 'padrao' ou um id bem formado nos outros", () => {
    expect(modeloServeAoMotor("claude-code", "haiku")).toBe(true);
    expect(modeloServeAoMotor("claude-code", "gpt-5")).toBe(false);
    expect(modeloServeAoMotor("claude-code", "padrao")).toBe(false);
    expect(modeloServeAoMotor("codex", "padrao")).toBe(true);
    expect(modeloServeAoMotor("codex", "gpt-5.1-codex:high")).toBe(true);
    expect(modeloServeAoMotor("copilot", "claude_sonnet.4")).toBe(true);
    expect(modeloServeAoMotor("codex", "")).toBe(false);
    expect(modeloServeAoMotor("codex", "gpt 5")).toBe(false);
    expect(modeloServeAoMotor("codex", "a".repeat(65))).toBe(false);
  });

  it("um modelo que não é do Claude cai na reserva nas rotas que só falam Claude", () => {
    expect(comoModeloClaude("sonnet", "opus")).toBe("sonnet");
    expect(comoModeloClaude("padrao", "opus")).toBe("opus");
    expect(comoModeloClaude("gpt-5", "sonnet")).toBe("sonnet");
  });

  it("mostra o modelo como o usuário o lê", () => {
    expect(nomeDoModeloDoMotor("claude-code", "opus")).toBe("Opus 5.5");
    expect(nomeDoModeloDoMotor("claude-code", "opus", "claude-opus-5-6")).toBe("Opus 5.6");
    expect(nomeDoModeloDoMotor("codex", "padrao")).toBe("Padrão do CLI");
    expect(nomeDoModeloDoMotor("copilot", "gpt-5")).toBe("gpt-5");
  });

  describe("trocar o motor de um papel", () => {
    it("o modelo volta ao padrão do motor novo, e o mesmo motor não muda nada", () => {
      expect(comMotorDoPapel(configuracao, "orquestrador", "claude-code")).toBe(configuracao);
      expect(comMotorDoPapel(configuracao, "orquestrador", "codex")).toMatchObject({
        motorDoOrquestrador: "codex",
        modeloDoOrquestrador: "padrao",
        motorDosSubagentes: "claude-code",
        modeloDosSubagentes: "sonnet",
      });
      expect(comMotorDoPapel(configuracao, "subagentes", "copilot")).toMatchObject({
        motorDosSubagentes: "copilot",
        modeloDosSubagentes: "padrao",
        motorDoOrquestrador: "claude-code",
        modeloDoOrquestrador: "sonnet",
      });
    });

    it("voltar ao Claude Code põe o modelo de sempre de cada papel", () => {
      const noCodex = comMotorDoPapel(comMotorDoPapel(configuracao, "orquestrador", "codex"), "subagentes", "codex");

      expect(comMotorDoPapel(noCodex, "orquestrador", "claude-code")).toMatchObject({ modeloDoOrquestrador: "opus" });
      expect(comMotorDoPapel(noCodex, "subagentes", "claude-code")).toMatchObject({ modeloDosSubagentes: "sonnet" });
    });

    it("o motor que passa a ser o do orquestrador sai da reserva; a ordem dos outros se mantém", () => {
      const comReserva: DadosDaConfiguracao = { ...configuracao, ordemDeReserva: ["codex", "copilot"] };

      expect(comMotorDoPapel(comReserva, "orquestrador", "codex").ordemDeReserva).toEqual(["copilot"]);
    });

    it("trocar o motor dos subagentes não mexe na reserva", () => {
      const comReserva: DadosDaConfiguracao = { ...configuracao, ordemDeReserva: ["codex"] };
      expect(comMotorDoPapel(comReserva, "subagentes", "codex").ordemDeReserva).toEqual(["codex"]);
    });
  });

  describe("predefinição aplicada só na tela", () => {
    const economico: Partial<DadosDaConfiguracao> = {
      modeloDoOrquestrador: "opus",
      esforcoDoOrquestrador: "medio",
      modeloDosSubagentes: "sonnet",
    };

    it("traz os dois papéis de volta ao Claude Code e tira o Claude da reserva", () => {
      const noCodex: DadosDaConfiguracao = {
        ...configuracao,
        motorDoOrquestrador: "codex",
        modeloDoOrquestrador: "padrao",
        motorDosSubagentes: "copilot",
        modeloDosSubagentes: "padrao",
        ordemDeReserva: ["claude-code", "copilot"],
      };

      expect(comPredefinicao(noCodex, economico)).toMatchObject({
        motorDoOrquestrador: "claude-code",
        modeloDoOrquestrador: "opus",
        esforcoDoOrquestrador: "medio",
        motorDosSubagentes: "claude-code",
        modeloDosSubagentes: "sonnet",
        ordemDeReserva: ["copilot"],
      });
    });

    it("só o Claude Code vale para ela", () => {
      expect(usaSoOClaudeCode(configuracao)).toBe(true);
      expect(usaSoOClaudeCode({ ...configuracao, motorDosSubagentes: "codex" })).toBe(false);
      expect(usaSoOClaudeCode({ ...configuracao, motorDoOrquestrador: "copilot" })).toBe(false);
    });
  });

  describe("problema do modelo", () => {
    it("o Claude Code nunca tem: o modelo vem do menu", () => {
      expect(problemaDoModeloDoMotor(configuracao)).toBeNull();
    });

    it("fora do Claude Code, o 'padrao' ou um id bem formado servem", () => {
      expect(problemaDoModeloDoMotor({ ...configuracao, motorDoOrquestrador: "codex", modeloDoOrquestrador: "padrao" })).toBeNull();
      expect(problemaDoModeloDoMotor({ ...configuracao, motorDosSubagentes: "copilot", modeloDosSubagentes: "gpt-5:high" })).toBeNull();
    });

    it("vazio ou mal formado, diz de qual papel e o que fazer", () => {
      expect(problemaDoModeloDoMotor({ ...configuracao, motorDoOrquestrador: "codex", modeloDoOrquestrador: "" })).toBe(
        "Informe o modelo do orquestrador (ou escolha o padrão do CLI).",
      );
      expect(problemaDoModeloDoMotor({ ...configuracao, motorDosSubagentes: "copilot", modeloDosSubagentes: "gpt 5" })).toContain(
        "O modelo dos subagentes só aceita letras, números",
      );
    });
  });
});
