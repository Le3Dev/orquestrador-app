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

const cifrado = (t) => `cifrado:${Buffer.from(t).toString("base64")}`;
const semRede = () => {
  throw new Error("sem rede");
};

describe("serviço de licença (login por e-mail)", () => {
  let pasta;
  let agoraMs;
  let chamadas;
  let respostaDoServidor; // função (rota, corpo) => resposta ou lança erro

  function criar(opcoes = {}) {
    return criarServicoDeLicenca({
      fetch: async (url, init) => {
        const rota = url.split("licencas.exemplo.test")[1];
        const corpo = JSON.parse(init.body);
        chamadas.push({ rota, corpo, url });
        return respostaDoServidor(rota, corpo);
      },
      agora: () => agoraMs,
      pastaDoUsuario: pasta,
      urlDoServicoDeLicencas: "https://licencas.exemplo.test/",
      chavePublicaDaLicenca: chavePublica,
      cifrar: cifrado,
      decifrar: (t) => Buffer.from(t.replace(/^cifrado:/, ""), "base64").toString("utf8"),
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
    respostaDoServidor = (rota) => {
      if (rota === "/v1/entrar/codigo") return resposta(200, { ok: true });
      if (rota === "/v1/entrar/confirmar") {
        return resposta(200, { token: emitirToken(), sessao: "sessao-secreta", plano: "mensal", email: "a@b.com" });
      }
      if (rota === "/v1/licencas/validar") return resposta(200, { token: emitirToken() });
      if (rota === "/v1/sair") return resposta(200, { ok: true });
      return resposta(404, {});
    };
  });

  afterEach(() => {
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  const conectar = (servico) => servico.entrar({ email: "a@b.com", codigo: "123456" });

  it("pedirCodigo normaliza o e-mail e chama o serviço", async () => {
    const r = await criar().pedirCodigo("  Ana@Exemplo.COM ");
    expect(r.ok).toBe(true);
    expect(chamadas[0].url).toBe("https://licencas.exemplo.test/v1/entrar/codigo");
    expect(chamadas[0].corpo).toEqual({ email: "ana@exemplo.com" });
  });

  it("pedirCodigo repassa o erro do servidor", async () => {
    respostaDoServidor = () => resposta(429, { erro: "Aguarde um pouco.", motivo: "muitas-tentativas" });
    const r = await criar().pedirCodigo("a@b.com");
    expect(r).toMatchObject({ ok: false, motivo: "muitas-tentativas", mensagem: "Aguarde um pouco." });
  });

  it("entrar com sucesso grava a sessão cifrada, nunca em claro", async () => {
    const servico = criar();
    const r = await servico.entrar({ email: " A@B.com ", codigo: "123 456" });
    expect(r.ok).toBe(true);
    expect(chamadas[0].url).toBe("https://licencas.exemplo.test/v1/entrar/confirmar");
    expect(chamadas[0].corpo).toEqual({
      email: "a@b.com",
      codigo: "123456",
      maquina: { id: ID_DESTA_MAQUINA, nome: "PC-DO-LEANDRO" },
    });
    const gravado = lerArquivo();
    expect(gravado.email).toBe("a@b.com");
    expect(gravado.sessao).toBe(cifrado("sessao-secreta"));
    expect(fs.readFileSync(arquivo(), "utf8")).not.toContain('"sessao-secreta"');
    expect(gravado.token).toBeTruthy();
    expect(gravado.ultimaHoraVista).toBe(INICIO);
    expect(servico.status()).toMatchObject({ conectado: true, email: "a@b.com", plano: "mensal", nomeDaMaquina: "PC-DO-LEANDRO" });
    expect(servico.status().diasRestantesDoTeste).toBeUndefined();
  });

  it("código inválido não grava nada", async () => {
    respostaDoServidor = () => resposta(403, { erro: "Código incorreto.", motivo: "codigo-invalido" });
    const servico = criar();
    const r = await servico.entrar({ email: "a@b.com", codigo: "000000" });
    expect(r).toMatchObject({ ok: false, motivo: "codigo-invalido", mensagem: "Código incorreto." });
    expect(fs.existsSync(arquivo())).toBe(false);
    expect(servico.status().conectado).toBe(false);
  });

  it("limite-de-maquinas devolve outraMaquina e o reenvio com substituir funciona", async () => {
    const outra = { nome: "NOTEBOOK", ultimoUsoEm: INICIO - DIA };
    const normal = respostaDoServidor;
    respostaDoServidor = (rota, corpo) =>
      rota === "/v1/entrar/confirmar" && !corpo.substituirOutraMaquina
        ? resposta(403, { erro: "Em uso.", motivo: "limite-de-maquinas", outraMaquina: outra })
        : normal(rota, corpo);
    const servico = criar();
    const primeira = await conectar(servico);
    expect(primeira).toMatchObject({ ok: false, motivo: "limite-de-maquinas", outraMaquina: outra });
    expect(fs.existsSync(arquivo())).toBe(false);
    const segunda = await servico.entrar({ email: "a@b.com", codigo: "123456", substituirOutraMaquina: true });
    expect(segunda.ok).toBe(true);
    expect(chamadas[1].corpo.substituirOutraMaquina).toBe(true);
  });

  it("no teste, status informa os dias restantes", async () => {
    respostaDoServidor = (rota) =>
      rota === "/v1/entrar/confirmar"
        ? resposta(200, {
            token: emitirToken({ plano: "teste", pagaAte: INICIO + 5 * DIA - HORA }),
            sessao: "sessao-secreta",
            plano: "teste",
            email: "a@b.com",
          })
        : resposta(404, {});
    const servico = criar();
    await conectar(servico);
    expect(servico.status()).toMatchObject({ conectado: true, plano: "teste", diasRestantesDoTeste: 5 });
  });

  it("entrar sem configuração bloqueia", async () => {
    const r = await criar({ urlDoServicoDeLicencas: null }).entrar({ email: "a@b.com", codigo: "123456" });
    expect(r).toMatchObject({ ok: false, motivo: "sem-configuracao" });
    expect(chamadas).toHaveLength(0);
  });

  it("validar usa a sessão (decifrada) e guarda o novo token", async () => {
    const servico = criar();
    await conectar(servico);
    agoraMs = INICIO + 2 * DIA;
    respostaDoServidor = () => resposta(200, { token: emitirToken({ expiraEm: INICIO + 9 * DIA }) });
    const r = await servico.validar();
    expect(r).toMatchObject({ ok: true, online: true, plano: "mensal" });
    const ultima = chamadas[chamadas.length - 1];
    expect(ultima.url).toBe("https://licencas.exemplo.test/v1/licencas/validar");
    expect(ultima.corpo).toEqual({ sessao: "sessao-secreta", maquina: { id: ID_DESTA_MAQUINA } });
    expect(lerArquivo().ultimaHoraVista).toBe(INICIO + 2 * DIA);
  });

  it.each([
    ["teste-expirado", "Seu teste grátis terminou. Assine com o mesmo e-mail para continuar."],
    ["maquina-substituida", "Sua conta foi usada em outro computador. Entre de novo para usar aqui."],
    ["assinatura-inativa", null],
    ["sessao-invalida", null],
  ])("403 %s bloqueia e apaga token e sessão mantendo o e-mail", async (motivo, mensagem) => {
    const servico = criar();
    await conectar(servico);
    respostaDoServidor = () => resposta(403, { motivo });
    const r = await servico.validar();
    expect(r).toMatchObject({ ok: false, motivo, online: true });
    if (mensagem) expect(r.mensagem).toBe(mensagem);
    expect(r.mensagem).toBeTruthy();
    const gravado = lerArquivo();
    expect(gravado.email).toBe("a@b.com");
    expect(gravado.sessao).toBeNull();
    expect(gravado.token).toBeNull();
    expect(servico.status()).toMatchObject({ conectado: false, email: "a@b.com" });
    expect((await servico.validar()).motivo).toBe("sem-licenca");
  });

  it("offline com token válido libera e avisa perto do vencimento", async () => {
    const servico = criar();
    await conectar(servico);
    respostaDoServidor = semRede;
    agoraMs = INICIO + 1 * DIA;
    expect(await servico.validar()).toMatchObject({ ok: true, online: false, motivo: "offline" });
    agoraMs = INICIO + 7 * DIA - HORA;
    const perto = await servico.validar();
    expect(perto.ok).toBe(true);
    expect(perto.avisoOffline).toBeTruthy();
  });

  it("5xx cai no token guardado", async () => {
    const servico = criar();
    await conectar(servico);
    respostaDoServidor = () => resposta(503, {});
    expect(await servico.validar()).toMatchObject({ ok: true, online: false });
  });

  it("token de outra máquina bloqueia offline", async () => {
    const servico = criar();
    await conectar(servico);
    gravarArquivo({ ...lerArquivo(), token: emitirToken({ maquina: "outra" }) });
    respostaDoServidor = semRede;
    expect(await servico.validar()).toMatchObject({ ok: false, motivo: "outra-maquina" });
  });

  it("token de outra chave ou adulterado bloqueia offline", async () => {
    const servico = criar();
    await conectar(servico);
    const dados = lerArquivo();
    respostaDoServidor = semRede;
    const outraChave = crypto.generateKeyPairSync("ed25519").privateKey;
    gravarArquivo({ ...dados, token: emitirToken({}, outraChave) });
    expect(await servico.validar()).toMatchObject({ ok: false, motivo: "token-invalido" });
    const [c, , a] = dados.token.split(".");
    const corpoFalso = b64({ v: 1, maquina: ID_DESTA_MAQUINA, plano: "anual", expiraEm: INICIO + 900 * DIA });
    gravarArquivo({ ...dados, token: `${c}.${corpoFalso}.${a}` });
    expect(await servico.validar()).toMatchObject({ ok: false, motivo: "token-invalido" });
  });

  it("token vencido bloqueia offline", async () => {
    const servico = criar();
    await conectar(servico);
    respostaDoServidor = semRede;
    agoraMs = INICIO + 8 * DIA;
    expect(await servico.validar()).toMatchObject({ ok: false, motivo: "token-expirado" });
  });

  it("relógio voltado bloqueia offline, mas tolera pequenos ajustes", async () => {
    const servico = criar();
    await conectar(servico);
    agoraMs = INICIO + 3 * DIA;
    await servico.validar();
    respostaDoServidor = semRede;
    agoraMs = INICIO + 3 * DIA - 5 * 60 * 1000;
    expect((await servico.validar()).ok).toBe(true);
    agoraMs = INICIO + 1 * DIA;
    expect(await servico.validar()).toMatchObject({ ok: false, motivo: "relogio-alterado" });
  });

  it("sair chama /v1/sair e apaga o arquivo, mesmo offline", async () => {
    const servico = criar();
    await conectar(servico);
    await servico.sair();
    const ultima = chamadas[chamadas.length - 1];
    expect(ultima.url).toBe("https://licencas.exemplo.test/v1/sair");
    expect(ultima.corpo).toEqual({ sessao: "sessao-secreta", maquina: { id: ID_DESTA_MAQUINA } });
    expect(fs.existsSync(arquivo())).toBe(false);

    await conectar(servico);
    respostaDoServidor = semRede;
    expect((await servico.sair()).ok).toBe(true);
    expect(fs.existsSync(arquivo())).toBe(false);
  });

  it("arquivo antigo com chave = não conectado", async () => {
    gravarArquivo({ chave: "ORQ-AAAA", token: emitirToken(), ultimaHoraVista: INICIO });
    const servico = criar();
    expect(servico.status().conectado).toBe(false);
    expect(await servico.validar()).toMatchObject({ ok: false, motivo: "sem-licenca" });
    expect(chamadas).toHaveLength(0);
  });

  it("sem URL ou sem chave pública bloqueia", async () => {
    for (const opcoes of [{ urlDoServicoDeLicencas: "" }, { chavePublicaDaLicenca: null }]) {
      const servico = criar(opcoes);
      expect(await servico.validar()).toMatchObject({ ok: false, motivo: "sem-configuracao" });
      expect(await servico.pedirCodigo("a@b.com")).toMatchObject({ ok: false, motivo: "sem-configuracao" });
      expect(servico.status().conectado).toBe(false);
    }
    expect(chamadas).toHaveLength(0);
  });

  it("revalidação periódica bloqueia e chama aoBloquear", async () => {
    let tarefa = null;
    const servico = criar({
      agendar: (fn) => {
        tarefa = fn;
        return 1;
      },
      cancelarAgendamento: () => {},
    });
    await conectar(servico);
    const bloqueios = [];
    servico.iniciarRevalidacaoPeriodica({ aoBloquear: (d) => bloqueios.push(d) });
    respostaDoServidor = () => resposta(403, { motivo: "maquina-substituida" });
    await tarefa();
    expect(bloqueios).toHaveLength(1);
    expect(bloqueios[0].motivo).toBe("maquina-substituida");
  });
});
