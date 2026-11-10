import {
  APARENCIA_PADRAO_DA_ESCUTA,
  aparenciaValida,
  CHAVE_DAS_PREFERENCIAS_DA_ESCUTA,
  interpretarPreferenciasDaEscuta,
  LIMITES_DA_OPACIDADE,
  LIMITES_DO_TAMANHO_DA_FONTE,
  PREFERENCIAS_PADRAO_DA_ESCUTA,
  preferenciasNoNavegador,
  VERSAO_DAS_PREFERENCIAS_DA_ESCUTA,
} from "./preferenciasDaEscuta";

describe("preferências da escuta", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("padrões: automático no modo invisível e no 🎧, idioma português, velocidade e a aparência combinada", () => {
    expect(PREFERENCIAS_PADRAO_DA_ESCUTA).toEqual({
      automatico: true,
      automaticoManual: true,
      avisoVisto: false,
      idioma: "portuguese",
      prioridadeDoMotor: "velocidade",
      aparencia: { tamanhoDaFonte: 14, opacidade: 0.92, compacto: false },
    });
    expect(LIMITES_DO_TAMANHO_DA_FONTE).toEqual({ minimo: 12, maximo: 22 });
    expect(LIMITES_DA_OPACIDADE).toEqual({ minimo: 0.4, maximo: 1 });
    expect(Object.isFrozen(PREFERENCIAS_PADRAO_DA_ESCUTA)).toBe(true);
    expect(Object.isFrozen(APARENCIA_PADRAO_DA_ESCUTA)).toBe(true);
  });

  it("sem nada guardado, JSON inválido ou outro formato valem o padrão", () => {
    expect(interpretarPreferenciasDaEscuta(null)).toBe(PREFERENCIAS_PADRAO_DA_ESCUTA);
    expect(interpretarPreferenciasDaEscuta("{quebrado")).toBe(PREFERENCIAS_PADRAO_DA_ESCUTA);
    expect(interpretarPreferenciasDaEscuta("[1, 2]")).toBe(PREFERENCIAS_PADRAO_DA_ESCUTA);
    expect(interpretarPreferenciasDaEscuta('"texto"')).toBe(PREFERENCIAS_PADRAO_DA_ESCUTA);
  });

  it("dados antigos, sem os campos novos, mantêm o que tinham e ganham os padrões novos", () => {
    const lidas = interpretarPreferenciasDaEscuta(
      JSON.stringify({ automatico: false, automaticoManual: false, avisoVisto: true }),
    );
    expect(lidas).toEqual({
      automatico: false,
      automaticoManual: true,
      avisoVisto: true,
      idioma: "portuguese",
      prioridadeDoMotor: "velocidade",
      aparencia: APARENCIA_PADRAO_DA_ESCUTA,
    });
    expect(Object.isFrozen(lidas)).toBe(true);
  });

  it(`migração: dados sem versão ou de versão anterior à ${VERSAO_DAS_PREFERENCIAS_DA_ESCUTA} passam a português e ao Automático do 🎧 ligado, e o resto fica`, () => {
    expect(VERSAO_DAS_PREFERENCIAS_DA_ESCUTA).toBe(3);
    const antigas = {
      automatico: false,
      automaticoManual: false,
      avisoVisto: true,
      idioma: "automatico",
      prioridadeDoMotor: "precisao",
      aparencia: { tamanhoDaFonte: 18, opacidade: 0.6, compacto: true },
    };
    const esperadas = { ...antigas, idioma: "portuguese", automaticoManual: true };
    // Versão 2: o automático era o padrão e detectava errado; o manual desligado também era só o padrão.
    expect(interpretarPreferenciasDaEscuta(JSON.stringify({ ...antigas, versao: 2 }))).toEqual(esperadas);
    expect(interpretarPreferenciasDaEscuta(JSON.stringify(antigas))).toEqual(esperadas);
    expect(interpretarPreferenciasDaEscuta(JSON.stringify({ ...antigas, versao: 1 }))).toEqual(esperadas);
    expect(interpretarPreferenciasDaEscuta(JSON.stringify({ ...antigas, versao: "3" }))).toEqual(esperadas);
  });

  it("escolha gravada na versão atual é respeitada: idioma e Automático do 🎧", () => {
    const atual = VERSAO_DAS_PREFERENCIAS_DA_ESCUTA;
    expect(interpretarPreferenciasDaEscuta(JSON.stringify({ versao: atual, idioma: "portuguese" })).idioma).toBe("portuguese");
    expect(interpretarPreferenciasDaEscuta(JSON.stringify({ versao: atual, idioma: "automatico" })).idioma).toBe("automatico");
    expect(interpretarPreferenciasDaEscuta(JSON.stringify({ versao: atual, automaticoManual: false })).automaticoManual).toBe(false);
    expect(interpretarPreferenciasDaEscuta(JSON.stringify({ versao: atual, automaticoManual: true })).automaticoManual).toBe(true);
    // Na versão atual, campo ausente ou de outro tipo vale o padrão (ligado).
    expect(interpretarPreferenciasDaEscuta(JSON.stringify({ versao: atual, automaticoManual: "não" })).automaticoManual).toBe(true);
  });

  it("lê os campos novos e troca valor desconhecido ou de outro tipo pelo padrão", () => {
    expect(
      interpretarPreferenciasDaEscuta(
        JSON.stringify({
          versao: VERSAO_DAS_PREFERENCIAS_DA_ESCUTA,
          idioma: "portuguese",
          prioridadeDoMotor: "precisao",
          aparencia: { tamanhoDaFonte: 18, opacidade: 0.6, compacto: true },
        }),
      ),
    ).toMatchObject({ idioma: "portuguese", prioridadeDoMotor: "precisao", aparencia: { tamanhoDaFonte: 18, opacidade: 0.6, compacto: true } });

    expect(
      interpretarPreferenciasDaEscuta(
        JSON.stringify({ versao: VERSAO_DAS_PREFERENCIAS_DA_ESCUTA, idioma: "klingon", prioridadeDoMotor: 3, aparencia: [14], automatico: "sim" }),
      ),
    ).toMatchObject({ idioma: "portuguese", prioridadeDoMotor: "velocidade", aparencia: APARENCIA_PADRAO_DA_ESCUTA, automatico: true });
  });

  it("aparência guardada fora dos limites vai para a borda", () => {
    expect(
      interpretarPreferenciasDaEscuta(JSON.stringify({ aparencia: { tamanhoDaFonte: 99, opacidade: 0.05 } })).aparencia,
    ).toEqual({ tamanhoDaFonte: 22, opacidade: 0.4, compacto: false });
  });

  describe("aparenciaValida", () => {
    it("limita a fonte de 12 a 22 (inteira) e a opacidade de 0,4 a 1", () => {
      expect(aparenciaValida({ tamanhoDaFonte: 5, opacidade: 2, compacto: true })).toEqual({
        tamanhoDaFonte: 12,
        opacidade: 1,
        compacto: true,
      });
      expect(aparenciaValida({ tamanhoDaFonte: 30, opacidade: 0.1, compacto: false })).toEqual({
        tamanhoDaFonte: 22,
        opacidade: 0.4,
        compacto: false,
      });
      expect(aparenciaValida({ tamanhoDaFonte: 16.6, opacidade: 0.75, compacto: false })).toEqual({
        tamanhoDaFonte: 17,
        opacidade: 0.75,
        compacto: false,
      });
    });

    it("campo ausente, não numérico ou não finito vale o padrão", () => {
      expect(aparenciaValida({})).toEqual(APARENCIA_PADRAO_DA_ESCUTA);
      expect(aparenciaValida({ tamanhoDaFonte: Number.NaN, opacidade: Number.POSITIVE_INFINITY, compacto: "sim" })).toEqual(
        APARENCIA_PADRAO_DA_ESCUTA,
      );
      expect(aparenciaValida({ tamanhoDaFonte: "18" })).toEqual(APARENCIA_PADRAO_DA_ESCUTA);
    });

    it("devolve um objeto congelado", () => {
      expect(Object.isFrozen(aparenciaValida({ tamanhoDaFonte: 18 }))).toBe(true);
    });
  });

  it("no navegador, grava no localStorage com a versão do formato e lê de volta", () => {
    const preferencias = {
      ...PREFERENCIAS_PADRAO_DA_ESCUTA,
      avisoVisto: true,
      idioma: "automatico" as const,
      aparencia: { tamanhoDaFonte: 20, opacidade: 0.5, compacto: true },
    };
    preferenciasNoNavegador.gravar(preferencias);
    expect(JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_ESCUTA) ?? "null")).toEqual({
      versao: VERSAO_DAS_PREFERENCIAS_DA_ESCUTA,
      ...preferencias,
    });
    expect(preferenciasNoNavegador.ler()).toEqual(preferencias);
  });

  it("no navegador, a escolha nova do automático é gravada e respeitada; o dado da versão 2 com automático lê português", () => {
    localStorage.setItem(
      CHAVE_DAS_PREFERENCIAS_DA_ESCUTA,
      JSON.stringify({ ...PREFERENCIAS_PADRAO_DA_ESCUTA, versao: 2, idioma: "automatico", automaticoManual: false }),
    );
    expect(preferenciasNoNavegador.ler()).toMatchObject({ idioma: "portuguese", automaticoManual: true });

    preferenciasNoNavegador.gravar({ ...PREFERENCIAS_PADRAO_DA_ESCUTA, idioma: "automatico", automaticoManual: false });
    expect(preferenciasNoNavegador.ler()).toMatchObject({ idioma: "automatico", automaticoManual: false });
  });

  it("no navegador, sem nada guardado, lê o padrão", () => {
    expect(preferenciasNoNavegador.ler()).toBe(PREFERENCIAS_PADRAO_DA_ESCUTA);
  });
});
