import { explicacaoDoMotor, nomeCurtoDoModelo, rotuloDoMotor, textoDoDownload, tipoDoDispositivo } from "./motorDaEscuta";

describe("motor da escuta", () => {
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
