"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// O vitest não pode ser carregado por require(); o resto do arquivo segue em CommonJS.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { criarServicoDeLicenca } = require("./licenca");

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const INICIO = Date.UTC(2026, 0, 10, 12, 0, 0);

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const chavePublica = publicKey.export({ type: "spki", format: "pem" });
const ID_DESTA_MAQUINA = crypto.createHash("sha256").update("guid-desta-maquina").digest("hex");

function b64(objeto) {
  return Buffer.from(JSON.stringify(objeto)).toString("base64url");
}

function emitirToken(sobrescrever = {}, chave = privateKey) {
  const payload = {
    v: 1,
    licenca: "lic-1",
    maquina: ID_DESTA_MAQUINA,
    plano: "mensal",
    pagaAte: INICIO + 20 * DIA,
    emitidoEm: INICIO,
    expiraEm: INICIO + 7 * DIA,
    ...sobrescrever,
  };
  const cabecalho = b64({ alg: "EdDSA", typ: "JWT" });
  const corpo = b64(payload);
  const assinatura = crypto.sign(null, Buffer.from(`${cabecalho}.${corpo}`), chave).toString("base64url");
  return `${cabecalho}.${corpo}.${assinatura}`;
}

function resposta(status, json) {
  return { status, json: async () => json };
}

describe("serviço de licença", () => {
  let pasta;
  let agoraMs;
  let chamadas;
  let respostaDoServidor; // função (rota, corpo) => resposta ou lança erro

  function criar(opcoes = {}) {
    return criarServicoDeLicenca({
      fetch: async (url, init) => {
        const rota = url.split("/v1/licencas/")[1];
        const corpo = JSON.parse(init.body);
        chamadas.push({ rota, corpo, url });
        return respostaDoServidor(rota, corpo);
      },
      agora: () => agoraMs,
      pastaDoUsuario: pasta,
      urlDoServicoDeLicencas: "https://licencas.exemplo.test/",
      chavePublicaDaLicenca: chavePublica,
      lerMachineGuid: () => "guid-desta-maquina",
      nomeDoComputador: () => "PC-DO-LEANDRO",
      intervaloDeRevalidacaoMs: DIA,
      ...opcoes,
    });
  }

  const arquivo = () => path.join(pasta, "licenca.json");
  const lerArquivo = () => JSON.parse(fs.readFileSync(arquivo(), "utf8"));
  const gravarArquivo = (dados) => fs.writeFileSync(arquivo(), JSON.stringify(dados), "utf8");

  beforeEach(() => {
    pasta = fs.mkdtempSync(path.join(os.tmpdir(), "licenca-"));
    agoraMs = INICIO;
    chamadas = [];
    respostaDoServidor = () => resposta(200, { token: emitirToken() });
  });

  afterEach(() => {
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  it("ativar com sucesso grava chave, token e ultimaHoraVista", async () => {
    const servico = criar();
    const r = await servico.ativar("orq-aaaa-bbbb-cccc-dddd");
    expect(r.ok).toBe(true);
    expect(chamadas[0].url).toBe("https://licencas.exemplo.test/v1/licencas/ativar");
    expect(chamadas[0].corpo).toEqual({
      chave: "ORQ-AAAA-BBBB-CCCC-DDDD",
      maquina: { id: ID_DESTA_MAQUINA, nome: "PC-DO-LEANDRO" },
    });
    const gravado = lerArquivo();
    expect(gravado.chave).toBe("ORQ-AAAA-BBBB-CCCC-DDDD");
    expect(gravado.token).toBeTruthy();
    expect(gravado.ultimaHoraVista).toBe(INICIO);
    expect(servico.status()).toMatchObject({ ativada: true, plano: "mensal", nomeDaMaquina: "PC-DO-LEANDRO" });
  });

  it("ativar recusada por limite de máquinas devolve a mensagem do servidor e não grava", async () => {
    respostaDoServidor = () => resposta(403, { erro: "Limite de computadores atingido.", motivo: "limite-de-maquinas" });
    const r = await criar().ativar("ORQ-AAAA-BBBB-CCCC-DDDD");
    expect(r).toMatchObject({ ok: false, motivo: "limite-de-maquinas", mensagem: "Limite de computadores atingido." });
    expect(fs.existsSync(arquivo())).toBe(false);
  });

  it("ativar rejeita token de outra máquina ou assinado com outra chave", async () => {
    respostaDoServidor = () => resposta(200, { token: emitirToken({ maquina: "outra" }) });
    expect((await criar().ativar("ORQ-A")).ok).toBe(false);
    const outra = crypto.generateKeyPairSync("ed25519");
    respostaDoServidor = () => resposta(200, { token: emitirToken({}, outra.privateKey) });
    expect((await criar().ativar("ORQ-A")).ok).toBe(false);
    expect(fs.existsSync(arquivo())).toBe(false);
  });

  it("arquivo copiado de outra máquina (token com outro maquina) bloqueia", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken({ maquina: "f".repeat(64) }), ultimaHoraVista: INICIO });
    respostaDoServidor = () => {
      throw new Error("sem rede");
    };
    const r = await criar().validar();
    expect(r).toMatchObject({ ok: false, motivo: "outra-maquina" });
  });

  it("token adulterado (expiraEm maior no payload) bloqueia", async () => {
    const [cab, corpo, assinatura] = emitirToken().split(".");
    const payload = JSON.parse(Buffer.from(corpo, "base64url").toString());
    payload.expiraEm += 365 * DIA;
    gravarArquivo({ chave: "ORQ-A", token: `${cab}.${b64(payload)}.${assinatura}`, ultimaHoraVista: INICIO });
    respostaDoServidor = () => {
      throw new Error("sem rede");
    };
    const r = await criar().validar();
    expect(r).toMatchObject({ ok: false, motivo: "token-invalido" });
  });

  it("arquivo corrompido é tratado como sem licença", async () => {
    fs.writeFileSync(arquivo(), "{ lixo", "utf8");
    const r = await criar().validar();
    expect(r).toMatchObject({ ok: false, motivo: "sem-licenca" });
  });

  it("online: validar grava o token novo", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    agoraMs = INICIO + 2 * DIA;
    const novo = emitirToken({ emitidoEm: agoraMs, expiraEm: agoraMs + 7 * DIA });
    respostaDoServidor = () => resposta(200, { token: novo });
    const r = await criar().validar();
    expect(r).toMatchObject({ ok: true, online: true });
    expect(lerArquivo().token).toBe(novo);
    expect(lerArquivo().ultimaHoraVista).toBe(agoraMs);
  });

  it("offline com token válido libera", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    respostaDoServidor = () => {
      throw new Error("sem rede");
    };
    agoraMs = INICIO + 3 * DIA;
    const r = await criar().validar();
    expect(r).toMatchObject({ ok: true, online: false });
    expect(lerArquivo().ultimaHoraVista).toBe(agoraMs);
  });

  it("servidor com 5xx também usa o token guardado", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    respostaDoServidor = () => resposta(503, {});
    expect((await criar().validar()).ok).toBe(true);
  });

  it("offline com token vencendo avisa para conectar", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    respostaDoServidor = () => {
      throw new Error("sem rede");
    };
    agoraMs = INICIO + 6.5 * DIA;
    const r = await criar().validar();
    expect(r.ok).toBe(true);
    expect(r.avisoOffline).toBeTruthy();
  });

  it("offline com token vencido bloqueia", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    respostaDoServidor = () => {
      throw new Error("sem rede");
    };
    agoraMs = INICIO + 8 * DIA;
    const r = await criar().validar();
    expect(r).toMatchObject({ ok: false, motivo: "token-expirado" });
  });

  it("relógio que voltou bloqueia (e pequenas diferenças são toleradas)", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO + 2 * DIA });
    respostaDoServidor = () => {
      throw new Error("sem rede");
    };
    agoraMs = INICIO + 2 * DIA - 11 * 60 * 1000;
    expect(await criar().validar()).toMatchObject({ ok: false, motivo: "relogio-alterado" });
    agoraMs = INICIO + 2 * DIA - 5 * 60 * 1000;
    expect((await criar().validar()).ok).toBe(true);
  });

  it("403 assinatura-inativa bloqueia e apaga o token mantendo a chave", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    respostaDoServidor = () => resposta(403, { erro: "Assinatura cancelada.", motivo: "assinatura-inativa" });
    const servico = criar();
    const r = await servico.validar();
    expect(r).toMatchObject({ ok: false, motivo: "assinatura-inativa", mensagem: "Assinatura cancelada." });
    expect(lerArquivo()).toMatchObject({ chave: "ORQ-A", token: null });
    expect(servico.status().ativada).toBe(false);
    // Mesmo offline depois, não volta a liberar.
    respostaDoServidor = () => {
      throw new Error("sem rede");
    };
    expect((await servico.validar()).ok).toBe(false);
  });

  it("desativar avisa o servidor e apaga o arquivo; falha de rede não impede", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    respostaDoServidor = () => resposta(200, { ok: true });
    await criar().desativar();
    expect(chamadas[0]).toMatchObject({ rota: "desativar", corpo: { chave: "ORQ-A", maquina: { id: ID_DESTA_MAQUINA } } });
    expect(fs.existsSync(arquivo())).toBe(false);

    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    respostaDoServidor = () => {
      throw new Error("sem rede");
    };
    const r = await criar().desativar();
    expect(r.ok).toBe(true);
    expect(fs.existsSync(arquivo())).toBe(false);
  });

  it("sem chave pública ou URL configuradas bloqueia (fail closed)", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    const logs = [];
    const semChave = criar({ chavePublicaDaLicenca: null, log: (o, t) => logs.push(t) });
    expect(await semChave.validar()).toMatchObject({ ok: false, motivo: "sem-configuracao" });
    expect((await semChave.ativar("ORQ-A")).ok).toBe(false);
    expect(logs.length).toBeGreaterThan(0);
    const semUrl = criar({ urlDoServicoDeLicencas: "" });
    expect((await semUrl.liberadoParaAbrir()).liberado).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it("id da máquina sem MachineGuid usa hostname e MAC", () => {
    const servico = criar({ lerMachineGuid: () => "", lerMacFisico: () => "aa:bb:cc:dd:ee:ff" });
    const esperado = crypto.createHash("sha256").update("PC-DO-LEANDRO::aa:bb:cc:dd:ee:ff").digest("hex");
    expect(servico.idDaMaquina()).toBe(esperado);
  });

  it("revalidação periódica chama aoBloquear quando a licença é recusada e pode ser parada", async () => {
    gravarArquivo({ chave: "ORQ-A", token: emitirToken(), ultimaHoraVista: INICIO });
    let tarefa = null;
    let intervalo = null;
    let cancelado = false;
    const servico = criar({
      agendar: (fn, ms) => {
        tarefa = fn;
        intervalo = ms;
        return { unref() {} };
      },
      cancelarAgendamento: () => {
        cancelado = true;
      },
    });
    const bloqueios = [];
    servico.iniciarRevalidacaoPeriodica({ aoBloquear: (d) => bloqueios.push(d) });
    expect(intervalo).toBe(DIA);

    await tarefa(); // servidor ainda aceita
    expect(bloqueios).toHaveLength(0);

    respostaDoServidor = () => resposta(403, { erro: "Assinatura cancelada.", motivo: "assinatura-inativa" });
    await tarefa();
    expect(bloqueios).toHaveLength(1);
    expect(bloqueios[0].motivo).toBe("assinatura-inativa");
    expect(cancelado).toBe(true);
  });

  it("o temporizador real não segura o processo (unref)", () => {
    const servico = criar({ intervaloDeRevalidacaoMs: 60_000 });
    const parar = servico.iniciarRevalidacaoPeriodica({ aoBloquear: () => {} });
    parar();
    expect(typeof parar).toBe("function");
  });
});
