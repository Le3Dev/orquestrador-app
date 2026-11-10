import {
  ajustarAparencia,
  APARENCIA_PADRAO,
  explicacaoDoMotor,
  LIMITES_DA_APARENCIA,
  nomeCurtoDoModelo,
  rotuloDoMotor,
  textoDoDownload,
  tipoDoDispositivo,
} from "./tipos";

describe("tipos da escuta", () => {
  it("aparência padrão e limites", () => {
    expect(APARENCIA_PADRAO).toEqual({ tamanhoDaFonte: 14, opacidade: 0.92, compacto: false });
    expect(LIMITES_DA_APARENCIA.tamanhoDaFonte).toEqual({ minimo: 12, maximo: 22, passo: 1 });
    expect(LIMITES_DA_APARENCIA.opacidade).toEqual({ minimo: 0.4, maximo: 1, passo: 0.05 });
  });

  describe("ajustarAparencia", () => {
    it("mantém o que já está nos limites", () => {
      expect(ajustarAparencia({ tamanhoDaFonte: 18, opacidade: 0.55, compacto: true })).toEqual({
        tamanhoDaFonte: 18,
        opacidade: 0.55,
        compacto: true,
      });
    });

    it("prende a fonte entre 12 e 22", () => {
      expect(ajustarAparencia({ ...APARENCIA_PADRAO, tamanhoDaFonte: 8 }).tamanhoDaFonte).toBe(12);
      expect(ajustarAparencia({ ...APARENCIA_PADRAO, tamanhoDaFonte: 40 }).tamanhoDaFonte).toBe(22);
      expect(ajustarAparencia({ ...APARENCIA_PADRAO, tamanhoDaFonte: 15.4 }).tamanhoDaFonte).toBe(15);
    });

    it("prende a opacidade entre 0.4 e 1, sem resto de ponto flutuante", () => {
      expect(ajustarAparencia({ ...APARENCIA_PADRAO, opacidade: 0.1 }).opacidade).toBe(0.4);
      expect(ajustarAparencia({ ...APARENCIA_PADRAO, opacidade: 1.5 }).opacidade).toBe(1);
      expect(ajustarAparencia({ ...APARENCIA_PADRAO, opacidade: 0.92 + 0.05 }).opacidade).toBe(0.97);
      expect(ajustarAparencia({ ...APARENCIA_PADRAO, opacidade: 0.551 }).opacidade).toBe(0.55);
    });

    it("o padrão continua o mesmo depois de ajustado (0.92 fica fora da grade de 0.05)", () => {
      expect(ajustarAparencia(APARENCIA_PADRAO)).toEqual(APARENCIA_PADRAO);
    });

    it("valores inválidos voltam ao padrão", () => {
      expect(ajustarAparencia({ tamanhoDaFonte: Number.NaN, opacidade: Number.POSITIVE_INFINITY, compacto: false })).toEqual(
        APARENCIA_PADRAO,
      );
    });
  });

  describe("motor", () => {
    it.each([
      ["webgpu", "GPU"],
      ["dml", "GPU"],
      ["wasm", "CPU"],
      ["cpu", "CPU"],
    ] as const)("%s é %s", (dispositivo, tipo) => {
      expect(tipoDoDispositivo(dispositivo)).toBe(tipo);
      expect(rotuloDoMotor({ dispositivo, modelo: "onnx-community/whisper-base", precisao: "q4" })).toBe(
        `${tipo} · base · q4`,
      );
    });

    it("nome curto do modelo", () => {
      expect(nomeCurtoDoModelo("onnx-community/whisper-base")).toBe("base");
      expect(nomeCurtoDoModelo("Xenova/whisper-tiny.en")).toBe("tiny.en");
      expect(nomeCurtoDoModelo("onnx-community/whisper-large-v3-turbo")).toBe("large-v3-turbo");
      expect(nomeCurtoDoModelo("onnx-community/whisper-base_timestamped")).toBe("base");
      expect(nomeCurtoDoModelo("modelo-proprio")).toBe("modelo-proprio");
    });

    it("sem precisão, o rótulo não fica com separador sobrando", () => {
      expect(rotuloDoMotor({ dispositivo: "wasm", modelo: "onnx-community/whisper-small", precisao: "" })).toBe(
        "CPU · small",
      );
    });

    it("a explicação traz o modelo e a precisão completos", () => {
      expect(explicacaoDoMotor({ dispositivo: "webgpu", modelo: "onnx-community/whisper-base", precisao: "q4" })).toBe(
        "Modelo onnx-community/whisper-base, precisão q4, rodando em GPU (webgpu)",
      );
    });
  });

  describe("textoDoDownload", () => {
    it("com o total", () => {
      expect(textoDoDownload({ progresso: 45.4, totalMb: 198.7 })).toBe("baixando o modelo 45% de 199 MB");
    });

    it("sem o total", () => {
      expect(textoDoDownload({ progresso: 45, totalMb: null })).toBe("baixando o modelo 45%");
    });

    it("prende o progresso entre 0 e 100", () => {
      expect(textoDoDownload({ progresso: 140, totalMb: null })).toBe("baixando o modelo 100%");
      expect(textoDoDownload({ progresso: -3, totalMb: 0 })).toBe("baixando o modelo 0%");
    });
  });
});
