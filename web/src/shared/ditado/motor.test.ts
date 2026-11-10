import { describe, expect, it, vi } from "vitest";

import { TranscricaoDescartada } from "./filaDeTranscricao";
import {
  criarMotorDeTranscricao,
  type DescricaoDoMotor,
  MAXIMO_DE_ERROS_SEGUIDOS_DO_NATIVO,
  type MotorDeTranscricao,
  type OrigemDaTranscricao,
  type ProgressoDoDownload,
  type ResultadoDaTranscricao,
} from "./motor";
import { FalhaDoMotorNativo, type MotorNativo } from "./motorNativo";

type OuvinteDoMotor = (origem: OrigemDaTranscricao, motor: DescricaoDoMotor | null) => void;
type OuvinteDoDownload = (origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null) => void;

const NATIVO: DescricaoDoMotor = { dispositivo: "dml", modelo: "whisper-large-v3-turbo", precisao: "fp16", nativo: true };
const WASM_DITADO: DescricaoDoMotor = {
  dispositivo: "wasm",
  modelo: "onnx-community/whisper-small",
  precisao: "q8",
  nativo: false,
};
const WASM_ESCUTA: DescricaoDoMotor = {
  dispositivo: "wasm",
  modelo: "onnx-community/whisper-base",
  precisao: "q8",
  nativo: false,
};

const resultado = (texto: string): ResultadoDaTranscricao => ({
  texto,
  segmentos: [],
  idioma: "pt",
  duracaoDaPassadaMs: 1,
});

/** Um motor falso: as funções são `vi.fn` e os avisos são disparados pelo teste. */
function motorFalso(descricoes: Record<OrigemDaTranscricao, DescricaoDoMotor>) {
  const ouvintesDoMotor = new Set<OuvinteDoMotor>();
  const ouvintesDoDownload = new Set<OuvinteDoDownload>();
  const ouvintesDaFalha = new Set<(erro: FalhaDoMotorNativo) => void>();
  const atuais = new Map<OrigemDaTranscricao, DescricaoDoMotor>();
  const avisarMotor = (origem: OrigemDaTranscricao, motor: DescricaoDoMotor) => {
    atuais.set(origem, motor);
    for (const ouvinte of ouvintesDoMotor) ouvinte(origem, motor);
  };
  const motor: MotorNativo = {
    transcrever: vi.fn<MotorDeTranscricao["transcrever"]>(async (_audio, opcoes) => {
      avisarMotor(opcoes.origem, descricoes[opcoes.origem]);
      return resultado(`${descricoes[opcoes.origem].dispositivo}:${opcoes.origem}`);
    }),
    preparar: vi.fn<MotorDeTranscricao["preparar"]>(async (origem) => {
      avisarMotor(origem, descricoes[origem]);
      return descricoes[origem];
    }),
    motorAtual: (origem) => atuais.get(origem) ?? null,
    aoMudarMotor(ouvinte) {
      ouvintesDoMotor.add(ouvinte);
      return () => ouvintesDoMotor.delete(ouvinte);
    },
    aoBaixar(ouvinte) {
      ouvintesDoDownload.add(ouvinte);
      return () => ouvintesDoDownload.delete(ouvinte);
    },
    aoFalhar(ouvinte) {
      ouvintesDaFalha.add(ouvinte);
      return () => ouvintesDaFalha.delete(ouvinte);
    },
  };
  return {
    motor,
    baixar: (origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null) => {
      for (const ouvinte of ouvintesDoDownload) ouvinte(origem, progresso);
    },
    falhar: (erro: FalhaDoMotorNativo) => {
      for (const ouvinte of ouvintesDaFalha) ouvinte(erro);
    },
  };
}

function montar({ nativoDisponivel = true }: { nativoDisponivel?: boolean } = {}) {
  const nativo = motorFalso({ ditado: NATIVO, escuta: NATIVO });
  const navegador = motorFalso({ ditado: WASM_DITADO, escuta: WASM_ESCUTA });
  const criarNativo = vi.fn(() => nativo.motor);
  const motor = criarMotorDeTranscricao({
    nativoDisponivel: () => nativoDisponivel,
    criarNativo,
    navegador: navegador.motor,
  });
  const mudancas: [OrigemDaTranscricao, DescricaoDoMotor | null][] = [];
  motor.aoMudarMotor((origem, descricao) => mudancas.push([origem, descricao]));
  return { motor, nativo, navegador, criarNativo, mudancas };
}

const audio = () => new Float32Array([0.1, 0.2, 0.3]);

describe("motor de transcrição (escolha entre o nativo e a reserva)", () => {
  it("sem o nativo no app, usa a reserva no navegador e nem cria o nativo", async () => {
    const { motor, navegador, criarNativo, mudancas } = montar({ nativoDisponivel: false });
    await expect(motor.preparar("escuta")).resolves.toEqual(WASM_ESCUTA);
    await expect(motor.transcrever(audio(), { origem: "ditado" })).resolves.toMatchObject({ texto: "wasm:ditado" });
    expect(criarNativo).not.toHaveBeenCalled();
    expect(navegador.motor.preparar).toHaveBeenCalledWith("escuta", undefined);
    expect(motor.motorAtual("escuta")).toEqual(WASM_ESCUTA);
    expect(mudancas).toEqual([
      ["escuta", WASM_ESCUTA],
      ["ditado", WASM_DITADO],
    ]);
  });

  it("com o nativo no app, usa o nativo (criado só no primeiro uso) e repassa o motor e o download dele", async () => {
    const { motor, nativo, navegador, criarNativo, mudancas } = montar();
    const downloads: [OrigemDaTranscricao, ProgressoDoDownload | null][] = [];
    motor.aoBaixar((origem, progresso) => downloads.push([origem, progresso]));
    expect(criarNativo).not.toHaveBeenCalled();

    await expect(motor.preparar("escuta", "precisao")).resolves.toEqual(NATIVO);
    expect(nativo.motor.preparar).toHaveBeenCalledWith("escuta", "precisao");
    nativo.baixar("escuta", { progresso: 50, totalMb: 1500 });
    await expect(motor.transcrever(audio(), { origem: "ditado" })).resolves.toMatchObject({ texto: "dml:ditado" });

    expect(criarNativo).toHaveBeenCalledTimes(1);
    expect(navegador.motor.transcrever).not.toHaveBeenCalled();
    expect(navegador.motor.preparar).not.toHaveBeenCalled();
    expect(motor.motorAtual("escuta")).toEqual(NATIVO);
    expect(mudancas).toEqual([
      ["escuta", NATIVO],
      ["ditado", NATIVO],
    ]);
    expect(downloads).toEqual([["escuta", { progresso: 50, totalMb: 1500 }]]);
  });

  it("se montar o nativo lança, a reserva atende desde já", async () => {
    const { motor, criarNativo } = montar();
    criarNativo.mockImplementation(() => {
      throw new Error("sem ponte");
    });
    await expect(motor.transcrever(audio(), { origem: "escuta" })).resolves.toMatchObject({ texto: "wasm:escuta" });
  });

  it("o nativo desiste num pedido: o mesmo áudio é refeito na reserva, sem erro, e aoMudarMotor avisa", async () => {
    const { motor, nativo, navegador, mudancas } = montar();
    await motor.preparar("escuta");
    const original = audio();
    vi.mocked(nativo.motor.transcrever).mockRejectedValueOnce(new FalhaDoMotorNativo("caiu duas vezes"));

    await expect(motor.transcrever(original, { origem: "ditado" })).resolves.toMatchObject({ texto: "wasm:ditado" });
    expect(vi.mocked(navegador.motor.transcrever).mock.calls[0]?.[0]).toBe(original);
    // A reserva foi preparada para a origem que estava preparada, e quem ouve ficou sabendo.
    expect(navegador.motor.preparar).toHaveBeenCalledWith("escuta", undefined);
    expect(mudancas).toContainEqual(["escuta", WASM_ESCUTA]);
    expect(mudancas.at(-1)).toEqual(["ditado", WASM_DITADO]);
    expect(motor.motorAtual("escuta")).toEqual(WASM_ESCUTA);

    // Daí em diante, tudo vai direto à reserva.
    await motor.transcrever(audio(), { origem: "ditado" });
    expect(nativo.motor.transcrever).toHaveBeenCalledTimes(1);
  });

  it(`erros comuns do nativo: cada pedido é refeito na reserva; no ${MAXIMO_DE_ERROS_SEGUIDOS_DO_NATIVO}º seguido, a reserva assume`, async () => {
    const { motor, nativo, navegador } = montar();
    const transcreverNoNativo = vi.mocked(nativo.motor.transcrever);
    transcreverNoNativo.mockRejectedValueOnce(new Error("A transcrição falhou: x"));
    await expect(motor.transcrever(audio(), { origem: "ditado" })).resolves.toMatchObject({ texto: "wasm:ditado" });

    // Um acerto zera a contagem.
    await expect(motor.transcrever(audio(), { origem: "ditado" })).resolves.toMatchObject({ texto: "dml:ditado" });

    transcreverNoNativo.mockRejectedValueOnce(new Error("y"));
    transcreverNoNativo.mockRejectedValueOnce(new Error("z"));
    await motor.transcrever(audio(), { origem: "ditado" });
    await motor.transcrever(audio(), { origem: "ditado" });
    expect(transcreverNoNativo).toHaveBeenCalledTimes(4);
    expect(navegador.motor.transcrever).toHaveBeenCalledTimes(3);

    await motor.transcrever(audio(), { origem: "ditado" });
    expect(transcreverNoNativo).toHaveBeenCalledTimes(4);
  });

  it("uma passada descartada pelo nativo é repassada, sem refazer na reserva", async () => {
    const { motor, nativo, navegador } = montar();
    vi.mocked(nativo.motor.transcrever).mockRejectedValueOnce(new TranscricaoDescartada());
    await expect(motor.transcrever(audio(), { origem: "escuta", descartavel: true })).rejects.toBeInstanceOf(
      TranscricaoDescartada,
    );
    expect(navegador.motor.transcrever).not.toHaveBeenCalled();
  });

  it("o preparo do nativo falha: resolve com o preparo da reserva", async () => {
    const { motor, nativo, navegador } = montar();
    vi.mocked(nativo.motor.preparar).mockImplementationOnce(async () => {
      // Como o nativo de verdade: avisa `aoFalhar` e então rejeita.
      const erro = new FalhaDoMotorNativo("não carregou");
      nativo.falhar(erro);
      throw erro;
    });
    await expect(motor.preparar("escuta", "velocidade")).resolves.toEqual(WASM_ESCUTA);
    expect(navegador.motor.preparar).toHaveBeenCalledTimes(1);
    expect(navegador.motor.preparar).toHaveBeenCalledWith("escuta", "velocidade");
  });

  it("o nativo cai sozinho (aoFalhar): a reserva é preparada para as origens preparadas e o motor novo é avisado", async () => {
    const { motor, nativo, navegador, mudancas } = montar();
    await motor.preparar("escuta");
    await motor.preparar("ditado");
    mudancas.length = 0;

    nativo.falhar(new FalhaDoMotorNativo("caiu"));
    expect(navegador.motor.preparar).toHaveBeenCalledWith("escuta", undefined);
    expect(navegador.motor.preparar).toHaveBeenCalledWith("ditado", undefined);
    expect(mudancas).toEqual([
      ["escuta", WASM_ESCUTA],
      ["ditado", WASM_DITADO],
    ]);
    // O download do nativo que já desistiu não chega mais.
    const downloads: unknown[] = [];
    motor.aoBaixar((origem, progresso) => downloads.push([origem, progresso]));
    nativo.baixar("escuta", { progresso: 10, totalMb: null });
    expect(downloads).toEqual([]);
  });

  it("o download da reserva sempre chega (ela também refaz o que o nativo não entregou)", () => {
    const { motor, navegador } = montar();
    const downloads: unknown[] = [];
    motor.aoBaixar((origem, progresso) => downloads.push([origem, progresso]));
    navegador.baixar("ditado", { progresso: 20, totalMb: 243.5 });
    navegador.baixar("ditado", null);
    expect(downloads).toEqual([
      ["ditado", { progresso: 20, totalMb: 243.5 }],
      ["ditado", null],
    ]);
  });
});
