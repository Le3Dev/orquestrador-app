"use strict";

const { EventEmitter } = require("node:events");
// O vitest não pode ser carregado por require(); o resto do arquivo segue em CommonJS.
import { describe, expect, it } from "vitest";

const {
  ATRASO_DA_PRIMEIRA_VERIFICACAO_MS,
  INTERVALO_ENTRE_VERIFICACOES_MS,
  criarServicoDeAtualizacao,
  estadoInicial,
  mensagemDoErro,
  proximoEstado,
} = require("./atualizacao");

// Atualizador falso no formato do autoUpdater do electron-updater: emite os
// mesmos eventos e registra as chamadas. `aoVerificar` decide o que acontece
// em checkForUpdates (por padrão, só emite "checking-for-update").
function criarAtualizadorFalso({ aoVerificar } = {}) {
  const atualizador = new EventEmitter();
  // O autoUpdater real assina o próprio "error" (para o log); sem ouvinte, o
  // EventEmitter lançaria a exceção.
  atualizador.on("error", () => {});
  atualizador.verificacoes = 0;
  atualizador.instalacoes = [];
  atualizador.checkForUpdates = () => {
    atualizador.verificacoes += 1;
    atualizador.emit("checking-for-update");
    return aoVerificar ? aoVerificar(atualizador) : new Promise(() => {});
  };
  atualizador.quitAndInstall = (...argumentos) => {
    atualizador.instalacoes.push(argumentos);
  };
  return atualizador;
}

function criarServico(opcoes = {}) {
  const mudancas = [];
  const logs = [];
  const agendados = [];
  const atualizador = opcoes.atualizador || criarAtualizadorFalso();
  const servico = criarServicoDeAtualizacao({
    atualizador,
    versaoAtual: "0.2.0",
    ativo: opcoes.ativo ?? true,
    registrar: (texto) => logs.push(texto),
    aoMudar: (estado) => mudancas.push(estado),
    agendar: (funcao, atrasoMs) => {
      const agendado = { funcao, atrasoMs, cancelado: false };
      agendados.push(agendado);
      return () => {
        agendado.cancelado = true;
      };
    },
  });
  return { servico, atualizador, mudancas, logs, agendados };
}

// Deixa as promessas pendentes (then/catch do serviço) rodarem.
const esperarPromessas = () => new Promise((resolver) => setImmediate(resolver));

const ESTADO_EM_DIA = estadoInicial("0.2.0", true);

describe("proximoEstado", () => {
  it("verificando → baixando com progresso inteiro → pronta", () => {
    let estado = proximoEstado(ESTADO_EM_DIA, { tipo: "verificando" });
    expect(estado.situacao).toBe("verificando");

    estado = proximoEstado(estado, { tipo: "disponivel", versao: "0.3.0" });
    expect(estado).toEqual({
      situacao: "baixando",
      versaoAtual: "0.2.0",
      versaoNova: "0.3.0",
      progresso: 0,
      mensagemDeErro: null,
    });

    estado = proximoEstado(estado, { tipo: "progresso", percentual: 42.7 });
    expect(estado.progresso).toBe(42);
    expect(estado.versaoNova).toBe("0.3.0");
    expect(proximoEstado(estado, { tipo: "progresso", percentual: 140 }).progresso).toBe(100);
    expect(proximoEstado(estado, { tipo: "progresso", percentual: "x" }).progresso).toBe(0);

    estado = proximoEstado(estado, { tipo: "baixada", versao: "0.3.0" });
    expect(estado).toEqual({
      situacao: "pronta",
      versaoAtual: "0.2.0",
      versaoNova: "0.3.0",
      progresso: null,
      mensagemDeErro: null,
    });
  });

  it("sem atualização → em-dia", () => {
    const verificando = proximoEstado(ESTADO_EM_DIA, { tipo: "verificando" });
    expect(proximoEstado(verificando, { tipo: "sem-atualizacao" })).toEqual(ESTADO_EM_DIA);
  });

  it("erro manual mostra a mensagem; erro automático volta ao estado anterior", () => {
    const verificando = proximoEstado(ESTADO_EM_DIA, { tipo: "verificando" });
    expect(proximoEstado(verificando, { tipo: "erro", manual: true, mensagem: "Sem internet." })).toEqual({
      ...ESTADO_EM_DIA,
      situacao: "erro",
      mensagemDeErro: "Sem internet.",
    });
    expect(
      proximoEstado(verificando, { tipo: "erro", manual: false, mensagem: "x", anterior: ESTADO_EM_DIA }),
    ).toEqual(ESTADO_EM_DIA);
  });

  it("não sai de indisponivel e não regride uma versão já baixada", () => {
    const indisponivel = estadoInicial("0.2.0", false);
    expect(indisponivel.situacao).toBe("indisponivel");
    expect(proximoEstado(indisponivel, { tipo: "verificando" })).toBe(indisponivel);
    expect(proximoEstado(indisponivel, { tipo: "baixada", versao: "9.9.9" })).toBe(indisponivel);

    const pronta = { ...ESTADO_EM_DIA, situacao: "pronta", versaoNova: "0.3.0" };
    expect(proximoEstado(pronta, { tipo: "verificando" })).toBe(pronta);
    expect(proximoEstado(pronta, { tipo: "sem-atualizacao" })).toBe(pronta);
  });
});

describe("mensagemDoErro", () => {
  it("traduz os erros comuns para o usuário", () => {
    expect(mensagemDoErro(new Error("net::ERR_INTERNET_DISCONNECTED"))).toMatch(/Sem conexão/);
    expect(mensagemDoErro(Object.assign(new Error("x"), { code: "ENOTFOUND" }))).toMatch(/Sem conexão/);
    expect(mensagemDoErro(Object.assign(new Error("x"), { code: "ERR_UPDATER_NO_PUBLISHED_VERSIONS" }))).toMatch(
      /Nenhuma versão publicada/,
    );
    expect(mensagemDoErro(Object.assign(new Error("x"), { statusCode: 403 }))).toMatch(/limite de acessos/);
    expect(mensagemDoErro(new Error("algo estranho"))).toBe("Não foi possível verificar a atualização: algo estranho");
  });
});

describe("criarServicoDeAtualizacao", () => {
  it("inativo (fora do app instalado): indisponivel, com a versão atual, sem tocar no atualizador", () => {
    const { servico, atualizador, agendados } = criarServico({ ativo: false });
    expect(servico.obter()).toEqual({
      situacao: "indisponivel",
      versaoAtual: "0.2.0",
      versaoNova: null,
      progresso: null,
      mensagemDeErro: null,
    });
    expect(servico.verificar({ manual: true }).situacao).toBe("indisponivel");
    servico.iniciar();
    expect(servico.instalarAgora()).toBe(false);
    expect(atualizador.verificacoes).toBe(0);
    expect(atualizador.instalacoes).toEqual([]);
    expect(agendados).toEqual([]);
  });

  it("verificando → baixando com progresso → pronta, avisando a tela a cada mudança", () => {
    const { servico, atualizador, mudancas } = criarServico();

    expect(servico.verificar({ manual: true }).situacao).toBe("verificando");
    atualizador.emit("update-available", { version: "0.3.0" });
    atualizador.emit("download-progress", { percent: 10.2 });
    atualizador.emit("download-progress", { percent: 10.9 }); // mesmo inteiro: não avisa de novo
    atualizador.emit("download-progress", { percent: 55.5 });
    atualizador.emit("update-downloaded", { version: "0.3.0" });

    expect(mudancas.map((estado) => [estado.situacao, estado.progresso])).toEqual([
      ["verificando", null],
      ["baixando", 0],
      ["baixando", 10],
      ["baixando", 55],
      ["pronta", null],
    ]);
    expect(servico.obter()).toEqual({
      situacao: "pronta",
      versaoAtual: "0.2.0",
      versaoNova: "0.3.0",
      progresso: null,
      mensagemDeErro: null,
    });
    // Já baixada: uma nova verificação não consulta o GitHub de novo.
    servico.verificar({ manual: true });
    expect(atualizador.verificacoes).toBe(1);
  });

  it("sem atualização → em-dia", async () => {
    const atualizador = criarAtualizadorFalso({
      aoVerificar: (a) => {
        a.emit("update-not-available", { version: "0.2.0" });
        return Promise.resolve({ updateInfo: { version: "0.2.0" } });
      },
    });
    const { servico } = criarServico({ atualizador });
    servico.verificar({ manual: true });
    await esperarPromessas();
    expect(servico.obter().situacao).toBe("em-dia");
  });

  it("erro na verificação automática só vai para o log e volta à situação anterior", async () => {
    const falha = Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" });
    const atualizador = criarAtualizadorFalso({
      aoVerificar: (a) => {
        a.emit("error", falha);
        return Promise.reject(falha);
      },
    });
    const { servico, mudancas, logs, agendados } = criarServico({ atualizador });

    servico.iniciar();
    expect(agendados).toHaveLength(1);
    expect(agendados[0].atrasoMs).toBe(ATRASO_DA_PRIMEIRA_VERIFICACAO_MS);
    agendados[0].funcao();
    await esperarPromessas();

    expect(atualizador.verificacoes).toBe(1);
    expect(servico.obter()).toEqual(estadoInicial("0.2.0", true));
    expect(mudancas.at(-1).situacao).toBe("em-dia");
    expect(mudancas.some((estado) => estado.situacao === "erro")).toBe(false);
    expect(logs.join("\n")).toMatch(/verificação automática.*ENOTFOUND/);
    // A próxima fica agendada para dali a 4 h.
    expect(agendados).toHaveLength(2);
    expect(agendados[1].atrasoMs).toBe(INTERVALO_ENTRE_VERIFICACOES_MS);
  });

  it("erro na verificação manual mostra a situação erro com mensagem clara", async () => {
    const falha = new Error("net::ERR_INTERNET_DISCONNECTED");
    const atualizador = criarAtualizadorFalso({
      aoVerificar: (a) => {
        a.emit("error", falha);
        return Promise.reject(falha);
      },
    });
    const { servico, mudancas } = criarServico({ atualizador });

    servico.verificar({ manual: true });
    await esperarPromessas();

    expect(servico.obter()).toEqual({
      situacao: "erro",
      versaoAtual: "0.2.0",
      versaoNova: null,
      progresso: null,
      mensagemDeErro: "Sem conexão com o GitHub para procurar atualizações. Verifique a internet e tente de novo.",
    });
    // Um evento só por falha (o evento "error" e a promessa rejeitada não duplicam).
    expect(mudancas.filter((estado) => estado.situacao === "erro")).toHaveLength(1);
  });

  it("erro no download de uma verificação automática também volta à situação anterior", () => {
    const { servico, atualizador } = criarServico();
    servico.verificar({ manual: false });
    atualizador.emit("update-available", { version: "0.3.0" });
    atualizador.emit("download-progress", { percent: 30 });
    atualizador.emit("error", Object.assign(new Error("sha512 checksum mismatch"), { code: "ERR_CHECKSUM_MISMATCH" }));
    expect(servico.obter().situacao).toBe("em-dia");
  });

  it("pedir verificação durante uma automática passa a mostrar o erro ao usuário", () => {
    const { servico, atualizador } = criarServico();
    servico.verificar({ manual: false });
    expect(servico.verificar({ manual: true }).situacao).toBe("verificando");
    expect(atualizador.verificacoes).toBe(1);
    atualizador.emit("error", new Error("falhou"));
    expect(servico.obter().situacao).toBe("erro");
    expect(servico.obter().mensagemDeErro).toBe("Não foi possível verificar a atualização: falhou");
  });

  it("instalarAgora fora de 'pronta' não faz nada", () => {
    const { servico, atualizador } = criarServico();
    let antes = 0;
    const antesDeInstalar = () => {
      antes += 1;
    };

    expect(servico.instalarAgora({ antesDeInstalar })).toBe(false); // em-dia
    servico.verificar({ manual: true });
    expect(servico.instalarAgora({ antesDeInstalar })).toBe(false); // verificando
    atualizador.emit("update-available", { version: "0.3.0" });
    expect(servico.instalarAgora({ antesDeInstalar })).toBe(false); // baixando

    expect(antes).toBe(0);
    expect(atualizador.instalacoes).toEqual([]);
  });

  it("instalarAgora em 'pronta' roda o antesDeInstalar e instala em silêncio reabrindo o app (uma vez só)", () => {
    const { servico, atualizador } = criarServico();
    const ordem = [];
    atualizador.quitAndInstall = (...argumentos) => ordem.push(["instalar", ...argumentos]);
    servico.verificar({ manual: true });
    atualizador.emit("update-available", { version: "0.3.0" });
    atualizador.emit("update-downloaded", { version: "0.3.0" });

    expect(servico.instalarAgora({ antesDeInstalar: () => ordem.push(["encerrar servidor"]) })).toBe(true);
    expect(servico.instalarAgora({ antesDeInstalar: () => ordem.push(["encerrar servidor"]) })).toBe(false);
    expect(ordem).toEqual([["encerrar servidor"], ["instalar", true, true]]);
  });

  it("falha ao iniciar a instalação vira erro com mensagem e devolve false", () => {
    const { servico, atualizador } = criarServico();
    atualizador.quitAndInstall = () => {
      atualizador.emit("error", new Error("No valid update available, can't quit and install"));
    };
    servico.verificar({ manual: false });
    atualizador.emit("update-available", { version: "0.3.0" });
    atualizador.emit("update-downloaded", { version: "0.3.0" });

    expect(servico.instalarAgora()).toBe(false);
    expect(servico.obter().situacao).toBe("erro");
    expect(servico.obter().mensagemDeErro).toMatch(/instalação da versão 0\.3\.0/);
  });

  it("iniciar agenda uma vez só e parar cancela", () => {
    const { servico, agendados } = criarServico();
    servico.iniciar();
    servico.iniciar();
    expect(agendados).toHaveLength(1);
    servico.parar();
    expect(agendados[0].cancelado).toBe(true);
  });
});
