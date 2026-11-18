"use strict";

const { EventEmitter } = require("node:events");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// O vitest não pode ser carregado por require(); o resto do arquivo segue em CommonJS.
import { afterEach, describe, expect, it } from "vitest";

const { ATRASO_DA_PRIMEIRA_VERIFICACAO_MS, INTERVALO_ENTRE_VERIFICACOES_MS, criarServicoDeAtualizacao } = require("./atualizacao");
const {
  ETAPA_APP,
  ETAPA_CODIGO,
  ETAPA_DEPENDENCIAS,
  ETAPA_PROCURANDO,
  INTERVALO_DA_ESPERA_MS,
  ambienteDosComandos,
  caminhoDoAppGerado,
  contarOrquestradoresTrabalhando,
  criarEsperaDosOrquestradores,
  criarExecutorDeComandos,
  criarServicoDeAtualizacaoDoMac,
  fimDoLog,
  iniciarTrocaDoApp,
  lerProcessosEmExecucao,
  pastaDoAppPeloExecutavel,
  pastaDoCodigoDoMac,
  remotoPreferido,
  versaoComCommit,
} = require("./atualizacaoDoMac");

const PASTA = "/Users/teste/orquestrador-app";
const BASE = "a".repeat(40);
const NOVO = "b".repeat(40);

// Executor falso: responde por linha de comando ("git fetch upstream main");
// sem resposta, sucesso sem saída. Resposta string = sucesso com essa saída.
function criarExecutorFalso(respostas = {}) {
  const chamadas = [];
  const executar = async (comando, args, opcoes = {}) => {
    const linha = [comando, ...args].join(" ");
    chamadas.push({ linha, cwd: opcoes.cwd });
    let resposta = respostas[linha];
    if (typeof resposta === "function") resposta = resposta();
    if (resposta === undefined) return { codigo: 0, saida: "" };
    return typeof resposta === "string" ? { codigo: 0, saida: resposta } : resposta;
  };
  return { executar, chamadas, linhas: () => chamadas.map((chamada) => chamada.linha) };
}

// O cenário de uma versão nova numa branch que avança direto.
function respostasDeVersaoNova(extra = {}) {
  return {
    "git remote": "origin\nupstream\n",
    "git rev-parse --verify upstream/main^{commit}": NOVO,
    [`git merge-base --is-ancestor ${NOVO} ${BASE}`]: { codigo: 1, saida: "" },
    "git status --porcelain --untracked-files=no": "",
    "git symbolic-ref -q --short HEAD": "main",
    "git merge-base --is-ancestor HEAD upstream/main": { codigo: 0, saida: "" },
    ...extra,
  };
}

function criarServicoDoMac({ respostas = respostasDeVersaoNova(), ...opcoes } = {}) {
  const mudancas = [];
  const logs = [];
  const agendados = [];
  const instalacoes = [];
  const executor = criarExecutorFalso(respostas);
  const servico = criarServicoDeAtualizacaoDoMac({
    pastaDoCodigo: PASTA,
    commitDoApp: BASE,
    versaoDoApp: "0.2.2",
    executar: executor.executar,
    existe: () => true,
    arquivoDoLog: "/tmp/atualizacao-do-mac.log",
    instalarApp: (dados) => instalacoes.push(dados),
    registrar: (texto) => logs.push(texto),
    aoMudar: (estado) => mudancas.push(estado),
    agendar: (funcao, atrasoMs) => {
      const agendado = { funcao, atrasoMs, cancelado: false };
      agendados.push(agendado);
      return () => {
        agendado.cancelado = true;
      };
    },
    ...opcoes,
  });
  return { servico, executor, mudancas, logs, agendados, instalacoes };
}

describe("funções puras", () => {
  it("versão com commit curto", () => {
    expect(versaoComCommit("0.2.2", BASE)).toBe("0.2.2 (aaaaaaa)");
    expect(versaoComCommit("0.2.2", null)).toBe("0.2.2");
  });

  it("prefere o upstream, depois o origin", () => {
    expect(remotoPreferido("origin\nupstream")).toBe("upstream");
    expect(remotoPreferido(["origin"])).toBe("origin");
    expect(remotoPreferido("fork")).toBeNull();
  });

  it("pasta do código só com repositorioDoMac e repositório git", () => {
    expect(pastaDoCodigoDoMac({ repositorioDoMac: PASTA }, () => true)).toBe(PASTA);
    expect(pastaDoCodigoDoMac({ repositorioDoMac: PASTA }, () => false)).toBeNull();
    expect(pastaDoCodigoDoMac({}, () => true)).toBeNull();
    expect(pastaDoCodigoDoMac(null, () => true)).toBeNull();
  });

  it("acha o .app pelo executável", () => {
    expect(pastaDoAppPeloExecutavel("/Applications/Orquestrador de Agentes.app/Contents/MacOS/Orquestrador de Agentes")).toBe(
      "/Applications/Orquestrador de Agentes.app",
    );
    expect(pastaDoAppPeloExecutavel("/usr/local/bin/electron")).toBeNull();
  });

  it("fim do log: últimas linhas não vazias", () => {
    const texto = Array.from({ length: 30 }, (_, i) => `linha ${i}`).join("\n\n");
    expect(fimDoLog(texto, 3)).toBe("linha 27\nlinha 28\nlinha 29");
  });

  it("ambiente sem ELECTRON_RUN_AS_NODE e sem prompt do git", () => {
    const ambiente = ambienteDosComandos({ PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" });
    expect(ambiente).toEqual({ PATH: "/bin", GIT_TERMINAL_PROMPT: "0" });
  });

  it("conta orquestradores com pid vivo, uma vez cada", () => {
    const vivos = new Set([10, 11, 12]);
    const processos = [
      { pid: 10, orquestradorId: "o1", sessaoId: "s1", iniciadoEm: "" },
      { pid: 11, orquestradorId: "o1", sessaoId: "s2", iniciadoEm: "" },
      { pid: 12, orquestradorId: "o2", sessaoId: "s3", iniciadoEm: "" },
      { pid: 13, orquestradorId: "o3", sessaoId: "s4", iniciadoEm: "" },
      { pid: "x", orquestradorId: "o4" },
      null,
    ];
    expect(contarOrquestradoresTrabalhando(processos, (pid) => vivos.has(pid))).toBe(2);
    expect(contarOrquestradoresTrabalhando(null)).toBe(0);
  });

  it("lê o registro de processos; sem arquivo, lista vazia", () => {
    expect(lerProcessosEmExecucao("/x", () => '[{"pid":1}]')).toEqual([{ pid: 1 }]);
    expect(lerProcessosEmExecucao("/x", () => "{}")).toEqual([]);
    expect(
      lerProcessosEmExecucao("/x", () => {
        throw new Error("ENOENT");
      }),
    ).toEqual([]);
  });
});

describe("serviço do Mac: verificar", () => {
  it("desligado fica indisponível", () => {
    const { servico, executor } = criarServicoDoMac({ ativo: false });
    expect(servico.verificar({ manual: true }).situacao).toBe("indisponivel");
    expect(executor.chamadas).toHaveLength(0);
  });

  it("estado inicial com a versão e o commit, e os campos novos", () => {
    const { servico } = criarServicoDoMac();
    expect(servico.obter()).toEqual({
      situacao: "em-dia",
      versaoAtual: "0.2.2 (aaaaaaa)",
      versaoNova: null,
      progresso: null,
      mensagemDeErro: null,
      etapa: null,
      orquestradoresTrabalhando: null,
    });
  });

  it("mesmo commit do remoto → em-dia, sem gerar nada", async () => {
    const { servico, executor, mudancas } = criarServicoDoMac({
      respostas: respostasDeVersaoNova({ "git rev-parse --verify upstream/main^{commit}": BASE }),
    });
    expect(servico.verificar({ manual: true })).toMatchObject({ situacao: "verificando", etapa: ETAPA_PROCURANDO });
    await servico.emAndamento();
    expect(servico.obter().situacao).toBe("em-dia");
    expect(executor.linhas()).toContain("git fetch upstream main");
    expect(executor.linhas().some((linha) => linha.startsWith("npm"))).toBe(false);
    expect(mudancas.map((estado) => estado.situacao)).toEqual(["verificando", "em-dia"]);
  });

  it("app já à frente do remoto → em-dia", async () => {
    const { servico, executor } = criarServicoDoMac({
      respostas: respostasDeVersaoNova({ [`git merge-base --is-ancestor ${NOVO} ${BASE}`]: { codigo: 0, saida: "" } }),
    });
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.obter().situacao).toBe("em-dia");
    expect(executor.linhas()).not.toContain("git merge --ff-only upstream/main");
  });

  it("sem upstream usa o origin", async () => {
    const { servico, executor } = criarServicoDoMac({
      respostas: {
        "git remote": "origin",
        "git rev-parse --verify origin/main^{commit}": BASE,
      },
    });
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(executor.linhas()).toContain("git fetch origin main");
    expect(servico.obter().situacao).toBe("em-dia");
  });

  it("sem commitDoMac compara com o HEAD da pasta", async () => {
    const { servico } = criarServicoDoMac({
      commitDoApp: null,
      respostas: respostasDeVersaoNova({
        "git rev-parse --verify upstream/main^{commit}": NOVO,
        "git rev-parse --verify HEAD^{commit}": NOVO,
      }),
    });
    expect(servico.obter().versaoAtual).toBe("0.2.2");
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.obter()).toMatchObject({ situacao: "em-dia", versaoAtual: "0.2.2 (bbbbbbb)" });
  });

  it("versão nova: as etapas em ordem e depois pronta", async () => {
    const { servico, executor, mudancas } = criarServicoDoMac();
    servico.verificar({ manual: false });
    await servico.emAndamento();
    expect(mudancas.map((estado) => [estado.situacao, estado.etapa])).toEqual([
      ["verificando", ETAPA_PROCURANDO],
      ["baixando", ETAPA_CODIGO],
      ["baixando", ETAPA_DEPENDENCIAS],
      ["baixando", ETAPA_APP],
      ["pronta", null],
    ]);
    expect(mudancas.every((estado) => estado.progresso === null && estado.orquestradoresTrabalhando === null)).toBe(true);
    expect(servico.obter()).toMatchObject({ situacao: "pronta", versaoNova: "bbbbbbb", versaoAtual: "0.2.2 (aaaaaaa)" });
    const linhas = executor.linhas();
    const ordem = ["git fetch upstream main", "git merge --ff-only upstream/main", "npm ci", "npm --prefix web ci", "npm run dist:mac"];
    expect(ordem.map((linha) => linhas.indexOf(linha))).toEqual([...ordem.map((linha) => linhas.indexOf(linha))].sort((a, b) => a - b));
    expect(ordem.every((linha) => linhas.includes(linha))).toBe(true);
    expect(executor.chamadas.every((chamada) => chamada.cwd === PASTA)).toBe(true);
  });

  it("HEAD destacado: checkout --detach no remoto", async () => {
    const { servico, executor } = criarServicoDoMac({
      respostas: respostasDeVersaoNova({ "git symbolic-ref -q --short HEAD": { codigo: 1, saida: "" } }),
    });
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(executor.linhas()).toContain("git checkout --detach upstream/main");
    expect(executor.linhas()).not.toContain("git merge --ff-only upstream/main");
    expect(servico.obter().situacao).toBe("pronta");
  });

  it("pasta com alterações: erro citando a pasta e nada alterado", async () => {
    const { servico, executor } = criarServicoDoMac({
      respostas: respostasDeVersaoNova({ "git status --porcelain --untracked-files=no": " M src/root.ts" }),
    });
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.obter().situacao).toBe("erro");
    expect(servico.obter().mensagemDeErro).toContain(PASTA);
    expect(servico.obter().mensagemDeErro).toContain("nada foi alterado");
    expect(executor.linhas().some((linha) => /merge --ff-only|checkout|^npm/.test(linha))).toBe(false);
  });

  it("pasta com alterações numa verificação automática: só o log", async () => {
    const { servico, logs, executor } = criarServicoDoMac({
      respostas: respostasDeVersaoNova({ "git status --porcelain --untracked-files=no": " M src/root.ts" }),
    });
    servico.verificar({ manual: false });
    await servico.emAndamento();
    expect(servico.obter().situacao).toBe("em-dia");
    expect(logs.some((linha) => linha.includes("a tela não foi avisada"))).toBe(true);
    expect(executor.linhas().some((linha) => linha.startsWith("npm"))).toBe(false);
  });

  it("branch que não avança direto: erro e nada alterado", async () => {
    const { servico, executor } = criarServicoDoMac({
      respostas: respostasDeVersaoNova({
        "git symbolic-ref -q --short HEAD": "feature/minha",
        "git merge-base --is-ancestor HEAD upstream/main": { codigo: 1, saida: "" },
      }),
    });
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.obter().situacao).toBe("erro");
    expect(servico.obter().mensagemDeErro).toContain("feature/minha");
    expect(servico.obter().mensagemDeErro).toContain("--ff-only");
    expect(executor.linhas()).not.toContain("git merge --ff-only upstream/main");
  });

  it("fetch sem rede: automático volta ao estado de antes; manual mostra o erro", async () => {
    const respostas = respostasDeVersaoNova({ "git fetch upstream main": { codigo: 128, saida: "fatal: unable to access" } });
    const automatico = criarServicoDoMac({ respostas });
    automatico.servico.verificar({ manual: false });
    await automatico.servico.emAndamento();
    expect(automatico.servico.obter().situacao).toBe("em-dia");

    const manual = criarServicoDoMac({ respostas });
    manual.servico.verificar({ manual: true });
    await manual.servico.emAndamento();
    expect(manual.servico.obter().situacao).toBe("erro");
    expect(manual.servico.obter().mensagemDeErro).toContain("git fetch upstream main");
  });

  it.each([
    ["git merge --ff-only upstream/main", ETAPA_CODIGO],
    ["npm ci", ETAPA_DEPENDENCIAS],
    ["npm --prefix web ci", ETAPA_DEPENDENCIAS],
    ["npm run dist:mac", ETAPA_APP],
  ])("falha em %s → erro com a etapa e o fim do log (mesmo automático)", async (linha, nomeDaEtapa) => {
    const { servico, executor } = criarServicoDoMac({
      respostas: respostasDeVersaoNova({ [linha]: { codigo: 1, saida: "começo\nnpm ERR! algo quebrou\n" } }),
    });
    servico.verificar({ manual: false });
    await servico.emAndamento();
    const estado = servico.obter();
    expect(estado.situacao).toBe("erro");
    expect(estado.mensagemDeErro).toContain(`"${nomeDaEtapa}"`);
    expect(estado.mensagemDeErro).toContain("npm ERR! algo quebrou");
    expect(estado.mensagemDeErro).toContain("/tmp/atualizacao-do-mac.log");
    expect(executor.linhas().at(-1)).toBe(linha);
  });

  it("app gerado ausente → erro", async () => {
    const { servico } = criarServicoDoMac({ existe: () => false });
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.obter().situacao).toBe("erro");
    expect(servico.obter().mensagemDeErro).toContain(caminhoDoAppGerado(PASTA, "Orquestrador de Agentes"));
  });

  it("uma geração por vez; pronta não procura de novo", async () => {
    const { servico, executor } = criarServicoDoMac();
    servico.verificar({ manual: false });
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(executor.linhas().filter((linha) => linha === "git fetch upstream main")).toHaveLength(1);
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(executor.linhas().filter((linha) => linha === "git fetch upstream main")).toHaveLength(1);
  });

  it("agenda a primeira verificação e as seguintes como no Windows", () => {
    const { servico, agendados } = criarServicoDoMac();
    servico.iniciar();
    servico.iniciar();
    expect(agendados.map((agendado) => agendado.atrasoMs)).toEqual([ATRASO_DA_PRIMEIRA_VERIFICACAO_MS]);
    agendados[0].funcao();
    expect(agendados.map((agendado) => agendado.atrasoMs)).toEqual([ATRASO_DA_PRIMEIRA_VERIFICACAO_MS, INTERVALO_ENTRE_VERIFICACOES_MS]);
    servico.parar();
    expect(agendados[1].cancelado).toBe(true);
  });
});

describe("serviço do Mac: instalar", () => {
  it("só em pronta; chama antesDeInstalar e a troca com o app gerado", async () => {
    const { servico, instalacoes } = criarServicoDoMac();
    expect(servico.instalarAgora()).toBe(false);
    servico.verificar({ manual: true });
    await servico.emAndamento();
    const ordem = [];
    expect(servico.instalarAgora({ antesDeInstalar: () => ordem.push("servidor") })).toBe(true);
    expect(ordem).toEqual(["servidor"]);
    expect(instalacoes).toEqual([{ appGerado: caminhoDoAppGerado(PASTA, "Orquestrador de Agentes") }]);
    expect(servico.instalarAgora()).toBe(false);
  });

  it("troca que não começa → erro", async () => {
    const { servico } = criarServicoDoMac({
      instalarApp: () => {
        throw new Error("sem permissão");
      },
    });
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.instalarAgora()).toBe(false);
    expect(servico.obter().situacao).toBe("erro");
    expect(servico.obter().mensagemDeErro).toContain("sem permissão");
  });

  it("ao fechar: só em pronta, troca sem reabrir e uma vez só", async () => {
    const { servico, instalacoes } = criarServicoDoMac();
    expect(servico.instalarAoFechar()).toBe(false);
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.instalarAoFechar()).toBe(true);
    expect(instalacoes).toEqual([{ appGerado: caminhoDoAppGerado(PASTA, "Orquestrador de Agentes"), reabrir: false }]);
    expect(servico.instalarAoFechar()).toBe(false);
    expect(servico.instalarAgora()).toBe(false);
    expect(instalacoes).toHaveLength(1);
  });

  it("ao fechar depois do Reiniciar agora: não troca de novo", async () => {
    const { servico, instalacoes } = criarServicoDoMac();
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.instalarAgora()).toBe(true);
    expect(servico.instalarAoFechar()).toBe(false);
    expect(instalacoes).toEqual([{ appGerado: caminhoDoAppGerado(PASTA, "Orquestrador de Agentes") }]);
  });

  it("ao fechar com a troca falhando: não lança e devolve false", async () => {
    const { servico, logs } = criarServicoDoMac({
      instalarApp: () => {
        throw new Error("sem permissão");
      },
    });
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.instalarAoFechar()).toBe(false);
    expect(logs.at(-1)).toContain("sem permissão");
  });
});

// Serviço de dentro falso: só obter/instalarAgora, com a situação controlável.
function criarEspera({ contagens = [0], situacao = "pronta", instalar, semInstalarAoFechar = false } = {}) {
  const fila = [...contagens];
  const mudancas = [];
  const agendados = [];
  const instalacoes = [];
  const aoFechar = [];
  let estado = { situacao, versaoAtual: "0.2.2", versaoNova: "0.2.3", progresso: null, mensagemDeErro: null };
  const espera = criarEsperaDosOrquestradores({
    contarTrabalhando: () => (fila.length > 1 ? fila.shift() : fila[0]),
    instalar:
      instalar ||
      (() => {
        instalacoes.push(true);
        return true;
      }),
    aoMudar: (novo) => mudancas.push(novo),
    agendar: (funcao, atrasoMs) => {
      const agendado = { funcao, atrasoMs, cancelado: false };
      agendados.push(agendado);
      return () => {
        agendado.cancelado = true;
      };
    },
  });
  const deDentro = {
    obter: () => ({ ...estado }),
    verificar: () => ({ ...estado }),
    iniciar: () => {},
    parar: () => {},
    instalarAgora: () => true,
  };
  if (!semInstalarAoFechar) {
    deDentro.instalarAoFechar = () => {
      aoFechar.push(estado.situacao);
      return estado.situacao === "pronta";
    };
  }
  espera.ligar(deDentro);
  const mudar = (parcial) => {
    estado = { ...estado, ...parcial };
    espera.aoMudarDoServico({ ...estado });
  };
  return { espera, mudancas, agendados, instalacoes, aoFechar, mudar };
}

describe("espera pelos orquestradores", () => {
  it("sem forcar e com orquestradores trabalhando: não reinicia", async () => {
    const { espera, instalacoes } = criarEspera({ contagens: [2] });
    await expect(espera.instalarAgora()).resolves.toEqual({ iniciou: false, orquestradoresTrabalhando: 2 });
    expect(instalacoes).toHaveLength(0);
  });

  it("com forcar instala mesmo com orquestradores trabalhando", async () => {
    const { espera, instalacoes } = criarEspera({ contagens: [2] });
    await expect(espera.instalarAgora({ forcar: true })).resolves.toEqual({ iniciou: true, orquestradoresTrabalhando: 2 });
    expect(instalacoes).toHaveLength(1);
  });

  it("sem versão pronta não instala", async () => {
    const { espera, instalacoes } = criarEspera({ situacao: "em-dia" });
    await expect(espera.instalarAgora({ forcar: true })).resolves.toEqual({ iniciou: false, orquestradoresTrabalhando: 0 });
    expect(instalacoes).toHaveLength(0);
  });

  it("aguardando: a contagem cai até 0 e então instala", async () => {
    const { espera, mudancas, agendados, instalacoes } = criarEspera({ contagens: [2, 1, 0] });
    expect(espera.instalarQuandoLivre()).toMatchObject({ situacao: "aguardando", orquestradoresTrabalhando: 2 });
    expect(agendados.at(-1).atrasoMs).toBe(INTERVALO_DA_ESPERA_MS);
    agendados.at(-1).funcao();
    expect(espera.obter()).toMatchObject({ situacao: "aguardando", orquestradoresTrabalhando: 1 });
    expect(mudancas.map((estado) => estado.orquestradoresTrabalhando)).toEqual([2, 1]);
    agendados.at(-1).funcao();
    await new Promise((resolver) => setImmediate(resolver));
    expect(instalacoes).toHaveLength(1);
  });

  it("instalarQuandoLivre sem ninguém trabalhando instala na hora", async () => {
    const { espera, instalacoes } = criarEspera({ contagens: [0] });
    espera.instalarQuandoLivre();
    await new Promise((resolver) => setImmediate(resolver));
    expect(instalacoes).toHaveLength(1);
  });

  it("cancelar a espera volta para pronta e desliga a conferência", () => {
    const { espera, agendados, instalacoes } = criarEspera({ contagens: [3] });
    espera.instalarQuandoLivre();
    expect(espera.cancelarEspera()).toMatchObject({ situacao: "pronta", orquestradoresTrabalhando: null });
    expect(agendados.at(-1).cancelado).toBe(true);
    expect(instalacoes).toHaveLength(0);
  });

  it("o serviço de dentro sair de pronta encerra a espera", () => {
    const { espera, mudar, agendados } = criarEspera({ contagens: [3] });
    espera.instalarQuandoLivre();
    mudar({ situacao: "erro", mensagemDeErro: "falhou" });
    expect(espera.obter()).toMatchObject({ situacao: "erro", orquestradoresTrabalhando: null });
    expect(agendados.at(-1).cancelado).toBe(true);
  });

  it("ao fechar em aguardando: encerra a espera e repassa ao serviço de dentro", () => {
    const { espera, agendados, aoFechar } = criarEspera({ contagens: [2] });
    espera.instalarQuandoLivre();
    expect(espera.instalarAoFechar()).toBe(true);
    expect(aoFechar).toEqual(["pronta"]);
    expect(agendados.at(-1).cancelado).toBe(true);
  });

  it("ao fechar depois do Reiniciar agora: não repassa", async () => {
    const { espera, aoFechar } = criarEspera({ contagens: [0] });
    await espera.instalarAgora();
    expect(espera.instalarAoFechar()).toBe(false);
    expect(aoFechar).toEqual([]);
  });

  it("ao fechar sem suporte no serviço de dentro (Windows): nada", () => {
    const { espera } = criarEspera({ semInstalarAoFechar: true });
    expect(espera.instalarAoFechar()).toBe(false);
  });

  it("no Windows o estado ganha etapa e orquestradoresTrabalhando nulos", () => {
    const atualizador = new EventEmitter();
    atualizador.on("error", () => {});
    atualizador.checkForUpdates = () => new Promise(() => {});
    atualizador.quitAndInstall = () => {};
    const mudancas = [];
    const espera = criarEsperaDosOrquestradores({ aoMudar: (estado) => mudancas.push(estado) });
    const deDentro = criarServicoDeAtualizacao({
      atualizador,
      versaoAtual: "0.2.2",
      ativo: true,
      aoMudar: espera.aoMudarDoServico,
    });
    espera.ligar(deDentro);
    expect(espera.obter()).toMatchObject({ situacao: "em-dia", etapa: null, orquestradoresTrabalhando: null });
    atualizador.emit("update-downloaded", { version: "0.2.3" });
    expect(mudancas.at(-1)).toMatchObject({ situacao: "pronta", versaoNova: "0.2.3", etapa: null, orquestradoresTrabalhando: null });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Integração: git e bash de verdade em pastas temporárias.
// ──────────────────────────────────────────────────────────────────────────
const temGit = spawnSync("git", ["--version"]).status === 0;
const ehPosix = process.platform !== "win32";
const pastasCriadas = [];

function pastaTemporaria() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "orq-atualizacao-mac-"));
  pastasCriadas.push(pasta);
  return pasta;
}

afterEach(() => {
  for (const pasta of pastasCriadas.splice(0)) {
    try {
      execFileSync("chmod", ["-R", "u+rwx", pasta]);
    } catch {
      /* segue */
    }
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

// Sem a configuração global de quem roda (assinatura de commit, hooks).
const AMBIENTE_DO_GIT = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };

function rodarGit(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=Teste", "-c", "user.email=teste@exemplo.com", ...args], {
    cwd,
    env: AMBIENTE_DO_GIT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

describe.skipIf(!temGit || !ehPosix)("integração com git de verdade", () => {
  function montarRepositorios() {
    const raiz = pastaTemporaria();
    const remoto = path.join(raiz, "remoto.git");
    const codigo = path.join(raiz, "codigo");
    const outro = path.join(raiz, "outro");
    rodarGit(raiz, "init", "--bare", "-b", "main", remoto);
    rodarGit(raiz, "clone", remoto, codigo);
    fs.writeFileSync(path.join(codigo, "versao.txt"), "1\n");
    rodarGit(codigo, "add", "versao.txt");
    rodarGit(codigo, "commit", "-m", "primeira");
    rodarGit(codigo, "push", "origin", "HEAD:main");
    rodarGit(raiz, "clone", remoto, outro);
    return { raiz, codigo, outro, base: rodarGit(codigo, "rev-parse", "HEAD") };
  }

  function servicoDeVerdade(codigo, base, falharEm = null) {
    const real = criarExecutorDeComandos({ ambiente: () => AMBIENTE_DO_GIT });
    const npm = [];
    const executar = (comando, args, opcoes) => {
      if (comando !== "npm") return real(comando, args, opcoes);
      const linha = [comando, ...args].join(" ");
      npm.push(linha);
      if (linha === falharEm) return Promise.resolve({ codigo: 1, saida: "falha de mentira" });
      if (linha === "npm run dist:mac") fs.mkdirSync(caminhoDoAppGerado(opcoes.cwd, "Orquestrador de Agentes"), { recursive: true });
      return Promise.resolve({ codigo: 0, saida: "" });
    };
    const servico = criarServicoDeAtualizacaoDoMac({ pastaDoCodigo: codigo, commitDoApp: base, versaoDoApp: "0.2.2", executar });
    return { servico, npm };
  }

  it("em dia, depois versão nova: avança a branch e gera o app", async () => {
    const { codigo, outro, base } = montarRepositorios();
    const primeiro = servicoDeVerdade(codigo, base);
    primeiro.servico.verificar({ manual: true });
    await primeiro.servico.emAndamento();
    expect(primeiro.servico.obter().situacao).toBe("em-dia");

    fs.writeFileSync(path.join(outro, "versao.txt"), "2\n");
    rodarGit(outro, "commit", "-am", "segunda");
    rodarGit(outro, "push", "origin", "HEAD:main");
    const novo = rodarGit(outro, "rev-parse", "HEAD");

    const segundo = servicoDeVerdade(codigo, base);
    segundo.servico.verificar({ manual: true });
    await segundo.servico.emAndamento();
    expect(segundo.servico.obter()).toMatchObject({ situacao: "pronta", versaoNova: novo.slice(0, 7) });
    expect(rodarGit(codigo, "rev-parse", "HEAD")).toBe(novo);
    expect(segundo.npm).toEqual(["npm ci", "npm --prefix web ci", "npm run dist:mac"]);
  }, 60_000);

  it("pasta suja: erro e o HEAD não muda", async () => {
    const { codigo, outro, base } = montarRepositorios();
    fs.writeFileSync(path.join(outro, "versao.txt"), "2\n");
    rodarGit(outro, "commit", "-am", "segunda");
    rodarGit(outro, "push", "origin", "HEAD:main");
    fs.writeFileSync(path.join(codigo, "versao.txt"), "mexido\n");

    const { servico, npm } = servicoDeVerdade(codigo, base);
    servico.verificar({ manual: true });
    await servico.emAndamento();
    expect(servico.obter().situacao).toBe("erro");
    expect(servico.obter().mensagemDeErro).toContain(codigo);
    expect(rodarGit(codigo, "rev-parse", "HEAD")).toBe(base);
    expect(npm).toEqual([]);
  }, 60_000);

  it("falha no build depois do merge: erro, e a próxima tentativa gera de novo", async () => {
    const { codigo, outro, base } = montarRepositorios();
    fs.writeFileSync(path.join(outro, "versao.txt"), "2\n");
    rodarGit(outro, "commit", "-am", "segunda");
    rodarGit(outro, "push", "origin", "HEAD:main");

    const comFalha = servicoDeVerdade(codigo, base, "npm run dist:mac");
    comFalha.servico.verificar({ manual: true });
    await comFalha.servico.emAndamento();
    expect(comFalha.servico.obter().situacao).toBe("erro");
    expect(comFalha.servico.obter().mensagemDeErro).toContain("falha de mentira");

    // O commit do app continua o antigo: a pasta já avançou, mas a versão nova segue pendente.
    comFalha.servico.verificar({ manual: true });
    await comFalha.servico.emAndamento();
    expect(comFalha.npm.filter((linha) => linha === "npm run dist:mac")).toHaveLength(2);
  }, 60_000);
});

describe.skipIf(!ehPosix)("executor de comandos de verdade", () => {
  it("junta a saída, devolve o código e grava o log", async () => {
    const pasta = pastaTemporaria();
    const log = path.join(pasta, "logs", "atualizacao.log");
    const executar = criarExecutorDeComandos({ arquivoDeLog: log });
    const resultado = await executar(process.execPath, ["-e", "console.log('ola'); console.error('erro'); process.exit(3)"], { cwd: pasta });
    expect(resultado.codigo).toBe(3);
    expect(resultado.saida).toContain("ola");
    expect(resultado.saida).toContain("erro");
    expect(fs.readFileSync(log, "utf8")).toContain("ola");
  });

  it("comando inexistente e tempo esgotado: código null", async () => {
    const pasta = pastaTemporaria();
    const executar = criarExecutorDeComandos();
    expect((await executar("comando-que-nao-existe-123", [], { cwd: pasta })).codigo).toBeNull();
    const lento = await executar(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { cwd: pasta, timeoutMs: 200 });
    expect(lento.codigo).toBeNull();
    expect(lento.saida).toContain("tempo esgotado");
  }, 10_000);
});

describe("troca do app", () => {
  it("roda o script desacoplado com os argumentos certos", () => {
    const pasta = pastaTemporaria();
    const chamadas = [];
    const { script, backup } = iniciarTrocaDoApp({
      pid: 4321,
      appAtual: "/Applications/Orquestrador de Agentes.app",
      appNovo: "/codigo/dist_electron/mac-arm64/Orquestrador de Agentes.app",
      nomeDoApp: "Orquestrador de Agentes",
      arquivoDeLog: path.join(pasta, "logs", "troca.log"),
      pastaTemporaria: pasta,
      agora: new Date(2026, 10, 18, 9, 5, 7),
      gerarProcesso: (comando, args, opcoes) => {
        const filho = { unref: () => chamadas.push("unref") };
        chamadas.push({ comando, args, detached: opcoes.detached });
        return filho;
      },
    });
    expect(backup).toBe(path.join(pasta, "Orquestrador de Agentes (backup 2026-11-18-090507).app"));
    expect(fs.statSync(script).mode & 0o111).not.toBe(0);
    expect(chamadas).toEqual([
      {
        comando: "/usr/bin/nohup",
        args: [
          "/bin/bash",
          script,
          "4321",
          "/Applications/Orquestrador de Agentes.app",
          "/codigo/dist_electron/mac-arm64/Orquestrador de Agentes.app",
          backup,
        ],
        detached: true,
      },
      "unref",
    ]);
  });

  it("reabrir false: o script recebe ORQUESTRADOR_TROCA_REABRIR=0", () => {
    const pasta = pastaTemporaria();
    const ambientes = [];
    const trocar = (reabrir) =>
      iniciarTrocaDoApp({
        pid: 4321,
        appAtual: "/Applications/Orquestrador de Agentes.app",
        appNovo: "/codigo/dist_electron/mac-arm64/Orquestrador de Agentes.app",
        nomeDoApp: "Orquestrador de Agentes",
        arquivoDeLog: path.join(pasta, "logs", "troca.log"),
        pastaTemporaria: pasta,
        ambiente: { PATH: "/usr/bin" },
        ...(reabrir === undefined ? {} : { reabrir }),
        gerarProcesso: (_comando, _args, opcoes) => {
          ambientes.push(opcoes.env);
          return { unref: () => {} };
        },
      });
    trocar(false);
    trocar(undefined);
    expect(ambientes).toEqual([{ PATH: "/usr/bin", ORQUESTRADOR_TROCA_REABRIR: "0" }, { PATH: "/usr/bin" }]);
  });

  describe.skipIf(process.platform !== "darwin")("trocarAppDoMac.sh no Mac", () => {
    function montar() {
      const pasta = pastaTemporaria();
      const atual = path.join(pasta, "Aplicativos", "App de Teste.app");
      const novo = path.join(pasta, "gerado", "App de Teste.app");
      const backup = path.join(pasta, "temp", "App de Teste (backup).app");
      const abertos = path.join(pasta, "abertos.txt");
      const abrir = path.join(pasta, "abrir-falso.sh");
      fs.mkdirSync(atual, { recursive: true });
      fs.mkdirSync(novo, { recursive: true });
      fs.writeFileSync(path.join(atual, "versao.txt"), "velha");
      fs.writeFileSync(path.join(novo, "versao.txt"), "nova");
      fs.writeFileSync(abrir, `#!/bin/bash\necho "$1" >> "${abertos}"\n`, { mode: 0o755 });
      return { atual, novo, backup, abertos, abrir };
    }

    function rodarScript({ atual, novo, backup, abrir }, pid, extra = {}) {
      return spawnSync("/bin/bash", [path.join(__dirname, "trocarAppDoMac.sh"), String(pid), atual, novo, backup], {
        env: { ...process.env, ORQUESTRADOR_TROCA_ABRIR: abrir, ...extra },
        encoding: "utf8",
        timeout: 20_000,
      });
    }

    it("espera o app fechar, guarda o backup, copia o novo e o abre", async () => {
      const caminhos = montar();
      // Neto reparentado ao launchd: ao sair, é recolhido (um filho direto viraria
      // zumbi enquanto o spawnSync segura o teste, e o kill -0 nunca falharia).
      const pid = Number(execFileSync("/bin/bash", ["-c", "sleep 1 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" }).trim());
      const resultado = rodarScript(caminhos, pid);
      expect(resultado.status).toBe(0);
      expect(fs.readFileSync(path.join(caminhos.atual, "versao.txt"), "utf8")).toBe("nova");
      expect(fs.readFileSync(path.join(caminhos.backup, "versao.txt"), "utf8")).toBe("velha");
      expect(fs.readFileSync(caminhos.abertos, "utf8").trim()).toBe(caminhos.atual);
    }, 20_000);

    it("cópia que falha: restaura o backup e reabre o app anterior", () => {
      const caminhos = montar();
      const travado = path.join(caminhos.novo, "travado.txt");
      fs.writeFileSync(travado, "x");
      fs.chmodSync(travado, 0o000);
      const resultado = rodarScript(caminhos, 999_999);
      expect(resultado.status).toBe(1);
      expect(fs.readFileSync(path.join(caminhos.atual, "versao.txt"), "utf8")).toBe("velha");
      expect(fs.existsSync(caminhos.backup)).toBe(false);
      expect(fs.readFileSync(caminhos.abertos, "utf8").trim()).toBe(caminhos.atual);
    }, 20_000);

    it("ORQUESTRADOR_TROCA_REABRIR=0: troca e não abre o app", () => {
      const caminhos = montar();
      const resultado = rodarScript(caminhos, 999_999, { ORQUESTRADOR_TROCA_REABRIR: "0" });
      expect(resultado.status).toBe(0);
      expect(fs.readFileSync(path.join(caminhos.atual, "versao.txt"), "utf8")).toBe("nova");
      expect(fs.readFileSync(path.join(caminhos.backup, "versao.txt"), "utf8")).toBe("velha");
      expect(fs.existsSync(caminhos.abertos)).toBe(false);
      expect(resultado.stdout).toContain("não reabre");
    }, 20_000);
  });
});
