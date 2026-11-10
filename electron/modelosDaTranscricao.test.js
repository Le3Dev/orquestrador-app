"use strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  arquivosDoModelo,
  baixarArquivo,
  baixarModelo,
  caminhoDoArquivo,
  partesExternas,
  pastaDosModelos,
  sufixoDaPrecisao,
  urlDoArquivo,
} = require("./modelosDaTranscricao");

const BASE = "onnx-community/whisper-base";
const TURBO = "onnx-community/whisper-large-v3-turbo";
const CONFIGURACOES = ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json"];

describe("sufixos e lista de arquivos", () => {
  it("usa o sufixo de cada precisão", () => {
    expect(sufixoDaPrecisao("fp32")).toBe("");
    expect(sufixoDaPrecisao("fp16")).toBe("_fp16");
    expect(sufixoDaPrecisao("q8")).toBe("_quantized");
    expect(sufixoDaPrecisao("q4")).toBe("_q4");
    expect(() => sufixoDaPrecisao("int4")).toThrow(/Precisão desconhecida/);
  });

  it.each([
    ["fp32", ""],
    ["fp16", "_fp16"],
    ["q8", "_quantized"],
    ["q4", "_q4"],
  ])("lista as configurações e as duas sessões em %s", (precisao, sufixo) => {
    expect(arquivosDoModelo({ precisao })).toEqual([
      ...CONFIGURACOES,
      `onnx/encoder_model${sufixo}.onnx`,
      `onnx/decoder_model_merged${sufixo}.onnx`,
    ]);
  });

  it("inclui o .onnx_data quando o config.json do modelo pede (turbo fp32)", () => {
    const configuracao = { "transformers.js_config": { use_external_data_format: { "encoder_model.onnx": true } } };
    expect(arquivosDoModelo({ precisao: "fp32", configuracao })).toEqual([
      ...CONFIGURACOES,
      "onnx/encoder_model.onnx",
      "onnx/encoder_model.onnx_data",
      "onnx/decoder_model_merged.onnx",
    ]);
    // Em fp16 o arquivo é outro: sem partes externas.
    expect(arquivosDoModelo({ precisao: "fp16", configuracao })).not.toContain("onnx/encoder_model_fp16.onnx_data");
  });

  it("conta partes externas por número, por sessão e pelo ajuste do dispositivo", () => {
    const porNumero = { "transformers.js_config": { use_external_data_format: 3 } };
    expect(partesExternas(porNumero, "encoder_model.onnx", "encoder_model", null)).toBe(3);
    expect(arquivosDoModelo({ precisao: "fp32", configuracao: porNumero })).toEqual(
      expect.arrayContaining(["onnx/encoder_model.onnx_data", "onnx/encoder_model.onnx_data_1", "onnx/encoder_model.onnx_data_2"]),
    );
    const porSessao = { "transformers.js_config": { use_external_data_format: { decoder_model_merged: 1 } } };
    expect(partesExternas(porSessao, "decoder_model_merged_fp16.onnx", "decoder_model_merged", null)).toBe(1);
    const porDispositivo = {
      "transformers.js_config": { device_config: { webgpu: { use_external_data_format: true } } },
    };
    expect(partesExternas(porDispositivo, "encoder_model_fp16.onnx", "encoder_model", "webgpu")).toBe(1);
    expect(partesExternas(porDispositivo, "encoder_model_fp16.onnx", "encoder_model", "cpu")).toBe(0);
    expect(partesExternas(null, "encoder_model.onnx", "encoder_model", null)).toBe(0);
  });

  it("monta URL e caminho e recusa repositório desconhecido ou arquivo com ..", () => {
    expect(urlDoArquivo(BASE, "onnx/encoder_model.onnx")).toBe(
      "https://huggingface.co/onnx-community/whisper-base/resolve/main/onnx/encoder_model.onnx",
    );
    const pasta = pastaDosModelos(path.join("C:", "dados"));
    expect(pasta).toBe(path.join("C:", "dados", "modelos-da-transcricao"));
    expect(caminhoDoArquivo(pasta, BASE, "onnx/encoder_model.onnx")).toBe(
      path.join(pasta, "onnx-community", "whisper-base", "onnx", "encoder_model.onnx"),
    );
    expect(() => urlDoArquivo("fulano/modelo", "config.json")).toThrow(/Modelo desconhecido/);
    expect(() => caminhoDoArquivo(pasta, BASE, "../fora.json")).toThrow(/inválido/);
    expect(() => caminhoDoArquivo(pasta, BASE, "/absoluto.json")).toThrow(/inválido/);
    expect(() => caminhoDoArquivo(pasta, BASE, "onnx\\x.onnx")).toThrow(/inválido/);
  });
});

// ── Download com um "buscar" falso (como o net.fetch) ─────────────────────
function servidorFalso(arquivos, { ignorarRange = false } = {}) {
  const pedidos = [];
  const buscar = vi.fn(async (url, opcoes = {}) => {
    const metodo = opcoes.method || "GET";
    const range = opcoes.headers && opcoes.headers.Range;
    pedidos.push({ url, metodo, range: range || null });
    const conteudo = arquivos[url];
    if (!conteudo) return new Response(null, { status: 404 });
    if (metodo === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-length": String(conteudo.length) } });
    }
    if (range && !ignorarRange) {
      const inicio = Number(/bytes=(\d+)-/.exec(range)[1]);
      if (inicio >= conteudo.length) return new Response(null, { status: 416 });
      const resto = conteudo.subarray(inicio);
      return new Response(resto, { status: 206, headers: { "content-length": String(resto.length) } });
    }
    return new Response(conteudo, { status: 200, headers: { "content-length": String(conteudo.length) } });
  });
  return { buscar, pedidos };
}

function arquivosRemotosDoBase(precisao = "fp32") {
  const remotos = {};
  for (const arquivo of arquivosDoModelo({ precisao })) {
    const tamanho = arquivo.endsWith(".onnx") ? 1024 * 1024 : 64;
    remotos[urlDoArquivo(BASE, arquivo)] = arquivo === "config.json" ? Buffer.from("{}") : Buffer.alloc(tamanho, 7);
  }
  return remotos;
}

describe("baixarModelo", () => {
  let pasta;
  beforeEach(() => {
    pasta = fs.mkdtempSync(path.join(os.tmpdir(), "modelos-"));
  });
  afterEach(() => {
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  it("informa o total em MB antes de baixar, o progresso até 100 e grava sem sobrar .parcial", async () => {
    const remotos = arquivosRemotosDoBase();
    const { buscar } = servidorFalso(remotos);
    const progresso = [];
    const { baixados } = await baixarModelo({ repositorio: BASE, precisao: "fp32", pasta, buscar, aoProgredir: (p) => progresso.push(p) });

    expect(baixados).toHaveLength(7);
    expect(progresso[0]).toEqual({ progresso: 0, totalMb: 2 });
    expect(progresso.at(-1)).toEqual({ progresso: 100, totalMb: 2 });
    const valores = progresso.map((p) => p.progresso);
    expect([...valores].sort((a, b) => a - b)).toEqual(valores);
    for (const arquivo of arquivosDoModelo({ precisao: "fp32" })) {
      const destino = caminhoDoArquivo(pasta, BASE, arquivo);
      expect(fs.existsSync(destino)).toBe(true);
      expect(fs.existsSync(`${destino}.parcial`)).toBe(false);
    }
  });

  it("não baixa nem avisa nada quando os arquivos já estão no disco", async () => {
    const { buscar } = servidorFalso(arquivosRemotosDoBase());
    await baixarModelo({ repositorio: BASE, precisao: "fp32", pasta, buscar });
    buscar.mockClear();
    const aoProgredir = vi.fn();
    const { baixados } = await baixarModelo({ repositorio: BASE, precisao: "fp32", pasta, buscar, aoProgredir });
    expect(baixados).toEqual([]);
    expect(buscar).not.toHaveBeenCalled();
    expect(aoProgredir).not.toHaveBeenCalled();
  });

  it("retoma um .parcial com Range e conta o que já estava baixado no progresso", async () => {
    const remotos = arquivosRemotosDoBase();
    const arquivo = "onnx/encoder_model.onnx";
    const destino = caminhoDoArquivo(pasta, BASE, arquivo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(`${destino}.parcial`, Buffer.alloc(512 * 1024, 7));
    const { buscar, pedidos } = servidorFalso(remotos);
    const progresso = [];
    await baixarModelo({ repositorio: BASE, precisao: "fp32", pasta, buscar, aoProgredir: (p) => progresso.push(p) });

    const doEncoder = pedidos.find((p) => p.url === urlDoArquivo(BASE, arquivo) && p.metodo === "GET");
    expect(doEncoder.range).toBe(`bytes=${512 * 1024}-`);
    expect(fs.statSync(destino).size).toBe(1024 * 1024);
    expect(fs.readFileSync(destino).every((byte) => byte === 7)).toBe(true);
    // Meio MB de 2 MB já estava lá.
    expect(progresso[0].progresso).toBe(24);
  });

  it("recomeça do zero quando o servidor ignora o Range", async () => {
    const url = urlDoArquivo(BASE, "onnx/encoder_model.onnx");
    const destino = path.join(pasta, "encoder_model.onnx");
    fs.writeFileSync(`${destino}.parcial`, Buffer.alloc(10, 1));
    const { buscar } = servidorFalso({ [url]: Buffer.alloc(100, 2) }, { ignorarRange: true });
    const recebidos = [];
    await baixarArquivo({ buscar, url, destino, aoReceber: (bytes) => recebidos.push(bytes) });
    expect(recebidos[0]).toBe(-10);
    expect(fs.readFileSync(destino)).toEqual(Buffer.alloc(100, 2));
  });

  it("recomeça do zero com 416 (parcial maior que o remoto)", async () => {
    const url = urlDoArquivo(BASE, "tokenizer.json");
    const destino = path.join(pasta, "tokenizer.json");
    fs.writeFileSync(`${destino}.parcial`, Buffer.alloc(200, 1));
    const { buscar } = servidorFalso({ [url]: Buffer.alloc(100, 3) });
    await baixarArquivo({ buscar, url, destino });
    expect(fs.readFileSync(destino)).toEqual(Buffer.alloc(100, 3));
  });

  it("deixa o .parcial e lança quando o download vem incompleto", async () => {
    const url = urlDoArquivo(BASE, "tokenizer.json");
    const destino = path.join(pasta, "tokenizer.json");
    const buscar = vi.fn(async () => new Response(Buffer.alloc(50, 1), { status: 200, headers: { "content-length": "100" } }));
    await expect(baixarArquivo({ buscar, url, destino })).rejects.toThrow(/incompleto/);
    expect(fs.existsSync(destino)).toBe(false);
    expect(fs.statSync(`${destino}.parcial`).size).toBe(50);
  });

  it("aceita corpo descomprimido maior que o content-length quando a resposta veio em gzip (net.fetch)", async () => {
    const url = urlDoArquivo(BASE, "config.json");
    const destino = path.join(pasta, "config.json");
    const corpo = Buffer.from(JSON.stringify({ model_type: "whisper", preenchimento: "x".repeat(2000) }));
    const buscar = vi.fn(
      async () => new Response(corpo, { status: 200, headers: { "content-length": "874", "content-encoding": "gzip" } }),
    );
    await baixarArquivo({ buscar, url, destino });
    expect(fs.readFileSync(destino)).toEqual(corpo);
  });

  it("não anexa um pedaço comprimido ao .parcial: baixa de novo do zero", async () => {
    const url = urlDoArquivo(BASE, "tokenizer.json");
    const destino = path.join(pasta, "tokenizer.json");
    fs.writeFileSync(`${destino}.parcial`, Buffer.alloc(10, 1));
    const completo = Buffer.alloc(100, 4);
    const buscar = vi.fn(async (_url, opcoes = {}) =>
      opcoes.headers && opcoes.headers.Range
        ? new Response(completo.subarray(10), { status: 206, headers: { "content-encoding": "gzip" } })
        : new Response(completo, { status: 200, headers: { "content-encoding": "gzip" } }),
    );
    const recebidos = [];
    await baixarArquivo({ buscar, url, destino, aoReceber: (bytes) => recebidos.push(bytes) });
    expect(recebidos[0]).toBe(-10);
    expect(fs.readFileSync(destino)).toEqual(completo);
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("lança com o HTTP quando o arquivo não existe", async () => {
    const { buscar } = servidorFalso({});
    await expect(baixarModelo({ repositorio: BASE, precisao: "fp32", pasta, buscar })).rejects.toThrow(/HTTP 404/);
  });

  it("totalMb null quando o servidor não informa tamanho nenhum", async () => {
    const remotos = arquivosRemotosDoBase("q8");
    const { buscar: buscarComTamanho } = servidorFalso(remotos);
    const buscar = vi.fn(async (url, opcoes = {}) =>
      opcoes.method === "HEAD" ? new Response(null, { status: 200 }) : buscarComTamanho(url, opcoes),
    );
    const progresso = [];
    await baixarModelo({ repositorio: BASE, precisao: "q8", pasta, buscar, aoProgredir: (p) => progresso.push(p) });
    expect(progresso[0]).toEqual({ progresso: 0, totalMb: null });
    expect(progresso.at(-1)).toEqual({ progresso: 100, totalMb: null });
  });

  it("usa os tamanhos da API de árvore do Hugging Face (o HEAD do net.fetch perde o x-linked-size)", async () => {
    const remotos = arquivosRemotosDoBase("fp16");
    const { buscar: buscarArquivos } = servidorFalso(remotos);
    const arvore = (pasta) =>
      Object.entries(remotos)
        .map(([url, conteudo]) => [url.replace(`https://huggingface.co/${BASE}/resolve/main/`, ""), conteudo])
        .filter(([arquivo]) => (pasta ? arquivo.startsWith(`${pasta}/`) : !arquivo.includes("/")))
        .map(([arquivo, conteudo]) =>
          arquivo.endsWith(".onnx")
            ? { type: "file", path: arquivo, size: conteudo.length, lfs: { size: conteudo.length } }
            : { type: "file", path: arquivo, size: conteudo.length },
        );
    const buscar = vi.fn(async (url, opcoes = {}) => {
      if (url === `https://huggingface.co/api/models/${BASE}/tree/main`) return Response.json([...arvore(""), { type: "directory", path: "onnx" }]);
      if (url === `https://huggingface.co/api/models/${BASE}/tree/main/onnx`) return Response.json(arvore("onnx"));
      // HEAD sem tamanho (como o net.fetch depois do redirecionamento, com o JSON em br).
      if (opcoes.method === "HEAD") return new Response(null, { status: 200, headers: { "content-encoding": "br" } });
      return buscarArquivos(url, opcoes);
    });
    const progresso = [];
    await baixarModelo({ repositorio: BASE, precisao: "fp16", pasta, buscar, aoProgredir: (p) => progresso.push(p) });
    expect(progresso[0]).toEqual({ progresso: 0, totalMb: 2 });
    expect(buscar.mock.calls.some(([, opcoes]) => opcoes && opcoes.method === "HEAD")).toBe(false);
  });

  it("com parte dos tamanhos desconhecida, informa o total do que conhece", async () => {
    const remotos = arquivosRemotosDoBase("fp32");
    const { buscar: buscarComTamanho } = servidorFalso(remotos);
    const buscar = vi.fn(async (url, opcoes = {}) =>
      opcoes.method === "HEAD" && url.endsWith(".json") ? new Response(null, { status: 200 }) : buscarComTamanho(url, opcoes),
    );
    const progresso = [];
    await baixarModelo({ repositorio: BASE, precisao: "fp32", pasta, buscar, aoProgredir: (p) => progresso.push(p) });
    expect(progresso[0]).toEqual({ progresso: 0, totalMb: 2 });
    expect(progresso.at(-1)).toEqual({ progresso: 100, totalMb: 2 });
  });

  it("pede as partes .onnx_data que o config.json do modelo declara", async () => {
    const configuracao = { "transformers.js_config": { use_external_data_format: { "encoder_model.onnx": true } } };
    const remotos = {};
    for (const arquivo of arquivosDoModelo({ precisao: "fp32", configuracao })) {
      remotos[urlDoArquivo(TURBO, arquivo)] = arquivo === "config.json" ? Buffer.from(JSON.stringify(configuracao)) : Buffer.alloc(8, 1);
    }
    const { buscar } = servidorFalso(remotos);
    const { baixados } = await baixarModelo({ repositorio: TURBO, precisao: "fp32", pasta, buscar });
    expect(baixados).toContain("onnx/encoder_model.onnx_data");
  });

  it("apaga um config.json corrompido e pede para tentar de novo", async () => {
    const destino = caminhoDoArquivo(pasta, BASE, "config.json");
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, "{ quebrado");
    const { buscar } = servidorFalso({});
    await expect(baixarModelo({ repositorio: BASE, precisao: "fp32", pasta, buscar })).rejects.toThrow(/corrompido/);
    expect(fs.existsSync(destino)).toBe(false);
  });
});
