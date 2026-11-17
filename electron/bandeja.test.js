"use strict";

// O vitest não pode ser carregado por require(); o resto do arquivo segue em CommonJS.
import { describe, expect, it, vi } from "vitest";

const {
  ARGUMENTO_DE_INICIO_NA_BANDEJA,
  CANAL_ABRIR_PAINEL_DE_ROTINAS,
  MENSAGEM_DO_AVISO_DE_SEGUNDO_PLANO,
  criarArquivoDeEstado,
  criarBandeja,
  dicaDoIcone,
  normalizarSituacao,
  textoDaAprovacao,
} = require("./bandeja");

function criarJanelaFalsa() {
  const janela = {
    visivel: true,
    minimizada: false,
    focada: true,
    destruida: false,
    hide: vi.fn(() => {
      janela.visivel = false;
    }),
    show: vi.fn(() => {
      janela.visivel = true;
    }),
    restore: vi.fn(() => {
      janela.minimizada = false;
    }),
    focus: vi.fn(() => {
      janela.focada = true;
    }),
    close: vi.fn(),
    isVisible: () => janela.visivel,
    isMinimized: () => janela.minimizada,
    isFocused: () => janela.focada,
    isDestroyed: () => janela.destruida,
    webContents: { send: vi.fn(), isDestroyed: () => false },
  };
  return janela;
}

/** Monta a bandeja com o Electron inteiro trocado por falsos; devolve tudo o que o teste precisa conferir. */
function montar(opcoes = {}) {
  const janela = opcoes.janela === undefined ? criarJanelaFalsa() : opcoes.janela;
  const icones = [];
  const notificacoes = [];
  const estado = { ...opcoes.estado };
  const suporte = { notificacao: opcoes.notificacaoSuportada !== false };
  const app = {
    setLoginItemSettings: vi.fn(),
    getLoginItemSettings: vi.fn(() => opcoes.loginAtual ?? { openAtLogin: false }),
  };

  class Tray {
    constructor(imagem) {
      if (opcoes.falhaAoCriarOIcone) throw new Error("sem bandeja");
      this.imagem = imagem;
      this.ouvintes = {};
      this.destruido = false;
      icones.push(this);
    }
    on(evento, ouvinte) {
      this.ouvintes[evento] = ouvinte;
    }
    setToolTip(texto) {
      this.dica = texto;
    }
    setContextMenu(menu) {
      this.menu = menu;
    }
    destroy() {
      this.destruido = true;
    }
  }

  class Notification {
    static isSupported() {
      return suporte.notificacao;
    }
    constructor(dados) {
      this.dados = dados;
      this.ouvintes = {};
      this.mostrada = false;
      notificacoes.push(this);
    }
    on(evento, ouvinte) {
      this.ouvintes[evento] = ouvinte;
    }
    show() {
      this.mostrada = true;
    }
  }

  const Menu = { buildFromTemplate: (modelo) => ({ modelo }) };
  const nativeImage = {
    createFromPath: (caminho) => ({ caminho, isEmpty: () => opcoes.iconeVazio === true }),
  };
  const sair = vi.fn();
  const abrirJanela = vi.fn();
  const registrar = vi.fn();
  const gravarEstado = vi.fn((novo) => {
    Object.assign(estado, novo);
    return true;
  });

  const bandeja = criarBandeja({
    app,
    Tray,
    Menu,
    Notification,
    nativeImage,
    caminhoDoIcone: "C:/app/electron/icones/icone.ico",
    nomeDoApp: "Orquestrador de Agentes",
    plataforma: opcoes.plataforma ?? "win32",
    argumentos: opcoes.argumentos ?? ["app.exe"],
    inicioComOWindowsDisponivel: opcoes.inicioComOWindowsDisponivel ?? true,
    obterJanela: () => janela,
    abrirJanela,
    sair,
    lerEstado: () => ({ ...estado }),
    gravarEstado,
    registrar,
  });
  return { bandeja, janela, icones, notificacoes, estado, suporte, app, sair, abrirJanela, registrar, gravarEstado };
}

const itensDoMenu = (icone) => icone.menu.modelo;
const itemDoMenu = (icone, rotulo) => itensDoMenu(icone).find((item) => item.label === rotulo || item.label?.startsWith(rotulo));
const evento = () => ({ preventDefault: vi.fn() });

describe("ícone e menu", () => {
  it("cria o ícone com o .ico, a dica com o nome do app e o menu Abrir, Iniciar com o Windows e Sair", () => {
    const { bandeja, icones } = montar();

    bandeja.iniciar();

    expect(icones).toHaveLength(1);
    expect(icones[0].imagem.caminho).toBe("C:/app/electron/icones/icone.ico");
    expect(icones[0].dica).toBe("Orquestrador de Agentes");
    expect(itensDoMenu(icones[0]).filter((item) => item.type !== "separator").map((item) => item.label)).toEqual([
      "Abrir",
      "Iniciar com o Windows",
      "Sair",
    ]);
    expect(itemDoMenu(icones[0], "Iniciar com o Windows")).toMatchObject({ type: "checkbox", checked: false, enabled: true });
  });

  it("iniciar duas vezes não duplica o ícone, e encerrar o remove", () => {
    const { bandeja, icones } = montar();

    bandeja.iniciar();
    bandeja.iniciar();
    expect(icones).toHaveLength(1);

    bandeja.encerrar();
    expect(icones[0].destruido).toBe(true);
  });

  it("Abrir (e o clique no ícone) mostra, restaura e foca a janela escondida", () => {
    const { bandeja, icones, janela } = montar();
    bandeja.iniciar();
    janela.visivel = false;
    janela.minimizada = true;
    janela.focada = false;

    itemDoMenu(icones[0], "Abrir").click();

    expect(janela.restore).toHaveBeenCalledTimes(1);
    expect(janela.show).toHaveBeenCalledTimes(1);
    expect(janela.focus).toHaveBeenCalledTimes(1);

    janela.visivel = false;
    icones[0].ouvintes.click();
    expect(janela.show).toHaveBeenCalledTimes(2);
  });

  it("Abrir sem janela (já destruída) pede ao app que abra uma", () => {
    const { bandeja, icones, janela, abrirJanela } = montar();
    bandeja.iniciar();
    janela.destruida = true;

    itemDoMenu(icones[0], "Abrir").click();

    expect(abrirJanela).toHaveBeenCalledTimes(1);
    expect(janela.show).not.toHaveBeenCalled();
  });

  it("Sair encerra o app", () => {
    const { bandeja, icones, sair } = montar();
    bandeja.iniciar();

    itemDoMenu(icones[0], "Sair").click();

    expect(sair).toHaveBeenCalledTimes(1);
  });

  it("o menu mostra quantas rotinas estão ativas e quantas aguardam, e a dica do ícone também", () => {
    const { bandeja, icones } = montar();
    bandeja.iniciar();

    bandeja.informarSituacao({ ativas: 2, aguardandoAprovacao: 1, pendentes: [{ id: "e1", rotina: "Relatório" }] });

    expect(icones[0].dica).toBe("Orquestrador de Agentes · 2 rotinas ativas · 1 aguardando aprovação");
    expect(itemDoMenu(icones[0], "2 rotinas ativas")).toMatchObject({ enabled: false });
  });

  it("sem o ícone (ícone vazio ou falha ao criar), nada é criado e a falha vai para o log", () => {
    const vazio = montar({ iconeVazio: true });
    vazio.bandeja.iniciar();
    expect(vazio.icones).toHaveLength(0);
    expect(vazio.registrar).toHaveBeenCalledWith(expect.stringContaining("Ícone da bandeja não encontrado"));

    const falha = montar({ falhaAoCriarOIcone: true });
    falha.bandeja.iniciar();
    expect(falha.registrar).toHaveBeenCalledWith(expect.stringContaining("Não foi possível criar o ícone da bandeja"));
    // Sem ícone na bandeja não há como trazer o app de volta: fechar não pode esconder.
    falha.bandeja.informarSituacao({ ativas: 1 });
    expect(falha.bandeja.aoFecharJanela(evento(), falha.janela)).toBe(false);
  });
});

describe("Iniciar com o Windows", () => {
  it("o item reflete o que o Windows tem registrado", () => {
    const { bandeja, icones, app } = montar({ loginAtual: { openAtLogin: true, executableWillLaunchAtLogin: true } });

    bandeja.iniciar();

    expect(itemDoMenu(icones[0], "Iniciar com o Windows").checked).toBe(true);
    expect(app.getLoginItemSettings).toHaveBeenCalledWith({ args: [ARGUMENTO_DE_INICIO_NA_BANDEJA] });
  });

  it("registrado mas desligado no Gerenciador de Tarefas, aparece desmarcado", () => {
    const { bandeja, icones } = montar({ loginAtual: { openAtLogin: true, executableWillLaunchAtLogin: false } });

    bandeja.iniciar();

    expect(itemDoMenu(icones[0], "Iniciar com o Windows").checked).toBe(false);
  });

  it("marcar liga o login item com o argumento da bandeja; desmarcar desliga", () => {
    const { bandeja, icones, app } = montar();
    bandeja.iniciar();

    itemDoMenu(icones[0], "Iniciar com o Windows").click({ checked: true });
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true, args: ["--na-bandeja"] });

    itemDoMenu(icones[0], "Iniciar com o Windows").click({ checked: false });
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false, args: ["--na-bandeja"] });
  });

  it("fora do app instalado (desenvolvimento) o item fica desligado e nada é gravado", () => {
    const { bandeja, icones, app } = montar({ inicioComOWindowsDisponivel: false });
    bandeja.iniciar();

    const item = itemDoMenu(icones[0], "Iniciar com o Windows");
    expect(item).toMatchObject({ enabled: false, checked: false });
    expect(item.label).toContain("só no app instalado");

    bandeja.definirIniciarComOWindows(true);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("falha do sistema ao gravar vai para o log e não derruba nada", () => {
    const { bandeja, app, registrar } = montar();
    app.setLoginItemSettings.mockImplementation(() => {
      throw new Error("acesso negado");
    });
    bandeja.iniciar();

    expect(() => bandeja.definirIniciarComOWindows(true)).not.toThrow();
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("acesso negado"));
  });

  it("abrir no login: o argumento --na-bandeja esconde a janela até o usuário abrir", () => {
    expect(montar({ argumentos: ["app.exe", "--na-bandeja"] }).bandeja.iniciadoNaBandeja()).toBe(true);
    expect(montar({ argumentos: ["app.exe"] }).bandeja.iniciadoNaBandeja()).toBe(false);
    // Fora do Windows a bandeja não existe: o argumento não pode deixar a janela escondida sem como voltar.
    expect(montar({ argumentos: ["app.exe", "--na-bandeja"], plataforma: "linux" }).bandeja.iniciadoNaBandeja()).toBe(false);
  });
});

describe("fechar a janela", () => {
  it("sem rotina ativa, fecha como sempre (encerra o app)", () => {
    const { bandeja, janela } = montar();
    bandeja.iniciar();
    bandeja.informarSituacao({ ativas: 0, aguardandoAprovacao: 0 });
    const fechamento = evento();

    expect(bandeja.aoFecharJanela(fechamento, janela)).toBe(false);
    expect(fechamento.preventDefault).not.toHaveBeenCalled();
    expect(janela.hide).not.toHaveBeenCalled();
  });

  it("antes de a tela informar qualquer coisa, fecha como sempre", () => {
    const { bandeja, janela } = montar();
    bandeja.iniciar();

    expect(bandeja.aoFecharJanela(evento(), janela)).toBe(false);
  });

  it("com pelo menos uma rotina ativa, esconde na bandeja em vez de fechar", () => {
    const { bandeja, janela } = montar();
    bandeja.iniciar();
    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 0 });
    const fechamento = evento();

    expect(bandeja.aoFecharJanela(fechamento, janela)).toBe(true);

    expect(fechamento.preventDefault).toHaveBeenCalledTimes(1);
    expect(janela.hide).toHaveBeenCalledTimes(1);
    expect(janela.visivel).toBe(false);
  });

  it("depois que a última rotina ativa sai, volta a fechar de verdade", () => {
    const { bandeja, janela } = montar();
    bandeja.iniciar();
    bandeja.informarSituacao({ ativas: 2 });
    bandeja.informarSituacao({ ativas: 0 });

    expect(bandeja.aoFecharJanela(evento(), janela)).toBe(false);
  });

  it("na primeira vez, uma notificação explica; nas seguintes (e nas próximas aberturas), não", () => {
    const { bandeja, janela, notificacoes, estado, gravarEstado } = montar();
    bandeja.iniciar();
    bandeja.informarSituacao({ ativas: 1 });

    bandeja.aoFecharJanela(evento(), janela);

    expect(notificacoes).toHaveLength(1);
    expect(notificacoes[0].mostrada).toBe(true);
    expect(notificacoes[0].dados.title).toBe("Orquestrador de Agentes continua aberto");
    expect(notificacoes[0].dados.body).toBe(MENSAGEM_DO_AVISO_DE_SEGUNDO_PLANO);
    expect(notificacoes[0].dados.body).toContain("bandeja");
    expect(notificacoes[0].dados.body).toContain("Sair");
    expect(gravarEstado).toHaveBeenCalledWith({ avisoDeSegundoPlanoMostrado: true });

    janela.visivel = true;
    bandeja.aoFecharJanela(evento(), janela);
    expect(notificacoes).toHaveLength(1);

    // Outra abertura do app com o mesmo arquivo de estado.
    const proxima = montar({ estado });
    proxima.bandeja.iniciar();
    proxima.bandeja.informarSituacao({ ativas: 1 });
    proxima.bandeja.aoFecharJanela(evento(), proxima.janela);
    expect(proxima.notificacoes).toHaveLength(0);
    expect(proxima.janela.hide).toHaveBeenCalledTimes(1);
  });

  it("sem suporte a notificações, esconde mesmo assim e tenta avisar de novo na próxima", () => {
    const { bandeja, janela, notificacoes, suporte, gravarEstado } = montar({ notificacaoSuportada: false });
    bandeja.iniciar();
    bandeja.informarSituacao({ ativas: 1 });

    expect(bandeja.aoFecharJanela(evento(), janela)).toBe(true);
    expect(notificacoes).toHaveLength(0);
    expect(gravarEstado).not.toHaveBeenCalled();

    suporte.notificacao = true;
    bandeja.aoFecharJanela(evento(), janela);
    expect(notificacoes).toHaveLength(1);
  });

  it("Sair (o app vai encerrar) nunca esconde, mesmo com rotinas ativas", () => {
    const { bandeja, janela } = montar();
    bandeja.iniciar();
    bandeja.informarSituacao({ ativas: 3 });

    bandeja.marcarSaida();

    const fechamento = evento();
    expect(bandeja.aoFecharJanela(fechamento, janela)).toBe(false);
    expect(fechamento.preventDefault).not.toHaveBeenCalled();
  });

  it("fecharDeVerdade fecha a janela mesmo com rotinas ativas, só desta vez", () => {
    const { bandeja, janela } = montar();
    bandeja.iniciar();
    bandeja.informarSituacao({ ativas: 1 });
    let resultadoDuranteOFechamento = null;
    janela.close.mockImplementation(() => {
      resultadoDuranteOFechamento = bandeja.aoFecharJanela(evento(), janela);
    });

    bandeja.fecharDeVerdade(janela);

    expect(janela.close).toHaveBeenCalledTimes(1);
    expect(resultadoDuranteOFechamento).toBe(false);
    // Passou: o próximo fechamento volta a esconder.
    expect(bandeja.aoFecharJanela(evento(), janela)).toBe(true);
  });

  it("no Mac e no Linux não há bandeja: nada é criado e fechar segue como estava", () => {
    for (const plataforma of ["darwin", "linux"]) {
      const { bandeja, icones, janela } = montar({ plataforma });
      bandeja.iniciar();
      bandeja.informarSituacao({ ativas: 2 });
      const fechamento = evento();

      expect(bandeja.ativa).toBe(false);
      expect(icones).toHaveLength(0);
      expect(bandeja.aoFecharJanela(fechamento, janela)).toBe(false);
      expect(fechamento.preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe("notificação de aprovação", () => {
  function montarComBandeja(opcoes) {
    const montagem = montar(opcoes);
    montagem.bandeja.iniciar();
    montagem.janela.focada = false;
    return montagem;
  }

  it('mostra "Rotina X aguarda sua aprovação" quando surge uma execução aguardando', () => {
    const { bandeja, notificacoes } = montarComBandeja();

    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1, pendentes: [{ id: "e1", rotina: "Relatório da manhã" }] });

    expect(notificacoes).toHaveLength(1);
    expect(notificacoes[0].mostrada).toBe(true);
    expect(notificacoes[0].dados).toEqual({ title: "Orquestrador de Agentes", body: "Rotina Relatório da manhã aguarda sua aprovação" });
  });

  it("não repete a notificação da mesma execução, e avisa a nova quando ela aparece", () => {
    const { bandeja, notificacoes } = montarComBandeja();
    const e1 = { id: "e1", rotina: "Relatório" };
    const e2 = { id: "e2", rotina: "Testes" };

    bandeja.informarSituacao({ ativas: 2, aguardandoAprovacao: 1, pendentes: [e1] });
    bandeja.informarSituacao({ ativas: 2, aguardandoAprovacao: 1, pendentes: [e1] });
    expect(notificacoes).toHaveLength(1);

    bandeja.informarSituacao({ ativas: 2, aguardandoAprovacao: 2, pendentes: [e1, e2] });
    expect(notificacoes).toHaveLength(2);
    expect(notificacoes[1].dados.body).toBe("Rotina Testes aguarda sua aprovação");
  });

  it("uma execução que foi decidida e volta a aguardar é nova", () => {
    const { bandeja, notificacoes } = montarComBandeja();
    const pendente = { id: "e1", rotina: "Relatório" };

    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1, pendentes: [pendente] });
    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 0, pendentes: [] });
    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1, pendentes: [pendente] });

    expect(notificacoes).toHaveLength(2);
  });

  it("várias de uma vez viram uma notificação só, com a contagem", () => {
    const { bandeja, notificacoes } = montarComBandeja();

    bandeja.informarSituacao({
      ativas: 2,
      aguardandoAprovacao: 2,
      pendentes: [
        { id: "e1", rotina: "A" },
        { id: "e2", rotina: "B" },
      ],
    });

    expect(notificacoes).toHaveLength(1);
    expect(notificacoes[0].dados.body).toBe("2 rotinas aguardam sua aprovação");
  });

  it("com a janela à frente, o usuário já vê o cartão: sem notificação (e sem repetir depois)", () => {
    const { bandeja, notificacoes, janela } = montarComBandeja();
    janela.focada = true;
    const pendente = { id: "e1", rotina: "Relatório" };

    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1, pendentes: [pendente] });
    expect(notificacoes).toHaveLength(0);

    janela.focada = false;
    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1, pendentes: [pendente] });
    expect(notificacoes).toHaveLength(0);
  });

  it("janela escondida na bandeja ou minimizada conta como fora de vista", () => {
    const escondida = montarComBandeja();
    escondida.janela.focada = true;
    escondida.janela.visivel = false;
    escondida.bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1, pendentes: [{ id: "e1", rotina: "A" }] });
    expect(escondida.notificacoes).toHaveLength(1);

    const minimizada = montarComBandeja();
    minimizada.janela.focada = true;
    minimizada.janela.minimizada = true;
    minimizada.bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1, pendentes: [{ id: "e1", rotina: "A" }] });
    expect(minimizada.notificacoes).toHaveLength(1);
  });

  it("tela sem a lista de pendências: só a contagem, e só quando ela cresce", () => {
    const { bandeja, notificacoes } = montarComBandeja();

    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1 });
    expect(notificacoes).toHaveLength(1);
    expect(notificacoes[0].dados.body).toBe("Uma rotina aguarda sua aprovação");

    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1 });
    expect(notificacoes).toHaveLength(1);
  });

  it("clicar na notificação abre a janela e pede à tela o painel das rotinas", () => {
    const { bandeja, notificacoes, janela } = montarComBandeja();
    janela.visivel = false;
    bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1, pendentes: [{ id: "e1", rotina: "Relatório" }] });

    notificacoes[0].ouvintes.click();

    expect(janela.show).toHaveBeenCalledTimes(1);
    expect(janela.focus).toHaveBeenCalledTimes(1);
    expect(janela.webContents.send).toHaveBeenCalledWith(CANAL_ABRIR_PAINEL_DE_ROTINAS);
    expect(CANAL_ABRIR_PAINEL_DE_ROTINAS).toBe("rotinas:abrir-painel");
  });

  it("sem suporte a notificações, não faz nada e não quebra", () => {
    const { bandeja, notificacoes } = montarComBandeja({ notificacaoSuportada: false });

    expect(() =>
      bandeja.informarSituacao({ ativas: 1, aguardandoAprovacao: 1, pendentes: [{ id: "e1", rotina: "A" }] }),
    ).not.toThrow();
    expect(notificacoes).toHaveLength(0);
  });
});

describe("normalizarSituacao", () => {
  it("aceita o formato certo e corta nomes e listas longos demais", () => {
    const situacao = normalizarSituacao({
      ativas: 2,
      aguardandoAprovacao: 1,
      pendentes: [{ id: "e1", rotina: `  ${"x".repeat(300)}  ` }],
    });

    expect(situacao.ativas).toBe(2);
    expect(situacao.aguardandoAprovacao).toBe(1);
    expect(situacao.pendentes[0].rotina).toHaveLength(100);
    expect(normalizarSituacao({ pendentes: Array.from({ length: 80 }, (_, n) => ({ id: `e${n}`, rotina: "A" })) }).pendentes).toHaveLength(50);
  });

  it("o que vem torto vale zero ou é ignorado, sem lançar", () => {
    expect(normalizarSituacao(null)).toEqual({ ativas: 0, aguardandoAprovacao: 0, pendentes: [] });
    expect(normalizarSituacao("lixo")).toEqual({ ativas: 0, aguardandoAprovacao: 0, pendentes: [] });
    expect(normalizarSituacao({ ativas: -3, aguardandoAprovacao: 1.5, pendentes: "x" })).toEqual({
      ativas: 0,
      aguardandoAprovacao: 0,
      pendentes: [],
    });
    expect(
      normalizarSituacao({ ativas: "2", pendentes: [null, 3, { id: 7 }, { id: "" }, { id: "ok" }] }).pendentes,
    ).toEqual([{ id: "ok", rotina: "" }]);
  });

  it("a contagem de aguardando nunca fica abaixo da lista de pendências", () => {
    expect(normalizarSituacao({ aguardandoAprovacao: 0, pendentes: [{ id: "a", rotina: "A" }] }).aguardandoAprovacao).toBe(1);
  });
});

describe("textos", () => {
  it("textoDaAprovacao e dicaDoIcone", () => {
    expect(textoDaAprovacao(1, ["Relatório"])).toBe("Rotina Relatório aguarda sua aprovação");
    expect(textoDaAprovacao(1, [""])).toBe("Uma rotina aguarda sua aprovação");
    expect(textoDaAprovacao(3, ["A"])).toBe("3 rotinas aguardam sua aprovação");
    expect(dicaDoIcone("App", { ativas: 0, aguardandoAprovacao: 0 })).toBe("App");
    expect(dicaDoIcone("App", { ativas: 1, aguardandoAprovacao: 0 })).toBe("App · 1 rotina ativa");
  });
});

describe("criarArquivoDeEstado", () => {
  function sistemaDeArquivosFalso(conteudo) {
    const arquivos = new Map(conteudo === undefined ? [] : [["C:/dados/bandeja.json", conteudo]]);
    return {
      arquivos,
      readFileSync: (caminho) => {
        if (!arquivos.has(caminho)) throw new Error("ENOENT");
        return arquivos.get(caminho);
      },
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn((caminho, texto) => {
        arquivos.set(caminho, texto);
      }),
    };
  }

  it("lê e grava o JSON do estado", () => {
    const sistema = sistemaDeArquivosFalso('{"avisoDeSegundoPlanoMostrado":true}');
    const arquivo = criarArquivoDeEstado("C:/dados/bandeja.json", sistema);

    expect(arquivo.ler()).toEqual({ avisoDeSegundoPlanoMostrado: true });
    expect(arquivo.gravar({ avisoDeSegundoPlanoMostrado: false })).toBe(true);
    expect(JSON.parse(sistema.arquivos.get("C:/dados/bandeja.json"))).toEqual({ avisoDeSegundoPlanoMostrado: false });
    expect(sistema.mkdirSync).toHaveBeenCalledWith("C:/dados", { recursive: true });
  });

  it("arquivo ausente ou torto lê como vazio, e falha ao gravar devolve false", () => {
    expect(criarArquivoDeEstado("C:/dados/bandeja.json", sistemaDeArquivosFalso()).ler()).toEqual({});
    expect(criarArquivoDeEstado("C:/dados/bandeja.json", sistemaDeArquivosFalso("não é json")).ler()).toEqual({});
    expect(criarArquivoDeEstado("C:/dados/bandeja.json", sistemaDeArquivosFalso("[1,2]")).ler()).toEqual({});

    const semPermissao = sistemaDeArquivosFalso();
    semPermissao.writeFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(criarArquivoDeEstado("C:/dados/bandeja.json", semPermissao).gravar({})).toBe(false);
  });
});
