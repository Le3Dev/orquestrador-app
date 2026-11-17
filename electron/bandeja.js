"use strict";

// Bandeja do Windows: o app continua rodando escondido para as Rotinas
// (agendadas) não pararem quando o usuário fecha a janela.
//
//   - Ícone na bandeja com o menu: Abrir, Iniciar com o Windows (marcável) e Sair.
//   - Com pelo menos uma Rotina ATIVA, fechar a janela esconde o app na bandeja
//     em vez de encerrá-lo; na primeira vez, uma notificação explica isso. Sem
//     Rotina ativa, fechar continua encerrando, como sempre. "Sair" encerra sempre.
//   - A tela conta ao processo principal quantas Rotinas estão ativas e quais
//     execuções aguardam aprovação (`informarSituacao`). Quando surge uma execução
//     aguardando, mostra uma notificação do Windows ("Rotina X aguarda sua
//     aprovação"); clicar nela abre a janela e pede à tela que abra o painel.
//   - "Iniciar com o Windows" grava o app para abrir com o sistema, já escondido
//     na bandeja (argumento `--na-bandeja`).
//
// Só no Windows. No Mac e no Linux o ícone e o "esconder ao fechar" ficam
// desligados (no Mac o app já sobrevive sem janelas; no Linux a bandeja depende
// do ambiente gráfico) e o resto segue como estava. Sem dependência direta do
// Electron: tudo entra por `criarBandeja`, para testar sem ele.

const fs = require("node:fs");
const path = require("node:path");

/** O argumento com que o Windows abre o app no login: janela escondida, só o ícone na bandeja. */
const ARGUMENTO_DE_INICIO_NA_BANDEJA = "--na-bandeja";

/** Canal (main → tela) que pede para abrir o painel das Rotinas. */
const CANAL_ABRIR_PAINEL_DE_ROTINAS = "rotinas:abrir-painel";

const LIMITE_DE_CONTAGEM = 10_000;
const LIMITE_DE_PENDENCIAS = 50;
const TAMANHO_MAXIMO_DO_NOME_NA_NOTIFICACAO = 100;
const TAMANHO_MAXIMO_DO_ID = 200;

const MENSAGEM_DO_AVISO_DE_SEGUNDO_PLANO =
  "Ele ficou na bandeja do Windows para as rotinas continuarem rodando. Para encerrar de vez, clique com o botão direito no ícone e escolha Sair.";

/** Inteiro de 0 a `LIMITE_DE_CONTAGEM`; qualquer outra coisa vale 0 (a tela é quem manda, mas nada que chega de fora é presumido). */
function contagem(valor) {
  return Number.isInteger(valor) && valor > 0 ? Math.min(valor, LIMITE_DE_CONTAGEM) : 0;
}

/** O que a tela informou, já conferido: `{ ativas, aguardandoAprovacao, pendentes: [{ id, rotina }] }`. */
function normalizarSituacao(dados) {
  const bruto = dados !== null && typeof dados === "object" ? dados : {};
  const pendentes = (Array.isArray(bruto.pendentes) ? bruto.pendentes : [])
    .filter((item) => item !== null && typeof item === "object" && typeof item.id === "string" && item.id !== "")
    .slice(0, LIMITE_DE_PENDENCIAS)
    .map((item) => ({
      id: item.id.slice(0, TAMANHO_MAXIMO_DO_ID),
      rotina: (typeof item.rotina === "string" ? item.rotina : "").trim().slice(0, TAMANHO_MAXIMO_DO_NOME_NA_NOTIFICACAO),
    }));
  return {
    ativas: contagem(bruto.ativas),
    // Quem manda os nomes manda também os ids: a contagem nunca fica abaixo do que foi listado.
    aguardandoAprovacao: Math.max(contagem(bruto.aguardandoAprovacao), pendentes.length),
    pendentes,
  };
}

/** "Rotina X aguarda sua aprovação" (ou, com várias, a contagem). `nomes` pode ter menos itens que `quantidade`. */
function textoDaAprovacao(quantidade, nomes) {
  if (quantidade === 1) {
    const nome = nomes[0];
    return nome ? `Rotina ${nome} aguarda sua aprovação` : "Uma rotina aguarda sua aprovação";
  }
  return `${quantidade} rotinas aguardam sua aprovação`;
}

/** ["2 rotinas ativas", "1 aguardando aprovação"]; vazio sem nenhuma rotina ativa nem pendência. */
function resumoDasRotinas({ ativas, aguardandoAprovacao }) {
  const partes = [];
  if (ativas > 0) partes.push(ativas === 1 ? "1 rotina ativa" : `${ativas} rotinas ativas`);
  if (aguardandoAprovacao > 0) partes.push(`${aguardandoAprovacao} aguardando aprovação`);
  return partes;
}

/** "Orquestrador de Agentes · 2 rotinas ativas · 1 aguardando aprovação" (o texto ao passar o mouse no ícone). */
function dicaDoIcone(nomeDoApp, situacao) {
  return [nomeDoApp, ...resumoDasRotinas(situacao)].join(" · ");
}

/**
 * O estado que a bandeja guarda entre as aberturas (hoje só "o aviso de segundo
 * plano já foi mostrado"), num JSON da pasta do usuário. Falha de leitura ou
 * gravação nunca derruba o app: lê `{}` e a gravação devolve false.
 */
function criarArquivoDeEstado(caminho, sistemaDeArquivos = fs) {
  return {
    ler() {
      try {
        const lido = JSON.parse(sistemaDeArquivos.readFileSync(caminho, "utf8"));
        return lido !== null && typeof lido === "object" && !Array.isArray(lido) ? lido : {};
      } catch {
        return {};
      }
    },
    gravar(estado) {
      try {
        sistemaDeArquivos.mkdirSync(path.dirname(caminho), { recursive: true });
        sistemaDeArquivos.writeFileSync(caminho, JSON.stringify(estado, null, 2), "utf8");
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * @param {object} opcoes
 * @param {object} opcoes.app `app` do Electron (setLoginItemSettings, getLoginItemSettings).
 * @param {Function} opcoes.Tray
 * @param {object} opcoes.Menu `Menu` do Electron (buildFromTemplate).
 * @param {Function} opcoes.Notification
 * @param {object} opcoes.nativeImage
 * @param {string} opcoes.caminhoDoIcone O .ico (Windows) do ícone da bandeja.
 * @param {string} opcoes.nomeDoApp
 * @param {string} [opcoes.plataforma] `process.platform`; só "win32" liga a bandeja.
 * @param {readonly string[]} [opcoes.argumentos] `process.argv` (procura o `--na-bandeja`).
 * @param {boolean} [opcoes.inicioComOWindowsDisponivel] Só no app instalado: o desenvolvimento abriria o Electron puro, sem o app.
 * @param {() => object | null} opcoes.obterJanela A janela principal, ou null.
 * @param {() => void} opcoes.abrirJanela Reabre a janela principal quando ela não existe mais.
 * @param {() => void} opcoes.sair Encerra o app de verdade (passa pelo `before-quit`).
 * @param {() => object} [opcoes.lerEstado]
 * @param {(estado: object) => boolean | void} [opcoes.gravarEstado]
 * @param {(texto: string) => void} [opcoes.registrar]
 */
function criarBandeja({
  app,
  Tray,
  Menu,
  Notification,
  nativeImage,
  caminhoDoIcone,
  nomeDoApp,
  plataforma = process.platform,
  argumentos = process.argv,
  inicioComOWindowsDisponivel = false,
  obterJanela,
  abrirJanela,
  sair,
  lerEstado = () => ({}),
  gravarEstado = () => true,
  registrar = () => {},
}) {
  const ativa = plataforma === "win32";
  const opcoesDoInicio = { args: [ARGUMENTO_DE_INICIO_NA_BANDEJA] };

  let icone = null;
  let situacao = { ativas: 0, aguardandoAprovacao: 0 };
  // As execuções que já geraram notificação: só as que seguem pendentes ficam aqui.
  let jaAvisadas = new Set();
  // O app vai encerrar (Sair, atualização, desligar): fechar a janela deixa de esconder.
  let saindo = false;
  let fechamentoLivre = false;
  // A notificação precisa de uma referência viva: sem ela o coletor de lixo pode engoli-la antes do clique.
  const notificacoes = new Set();

  function janelaViva() {
    const janela = obterJanela();
    return janela && !janela.isDestroyed() ? janela : null;
  }

  function janelaEmFoco() {
    const janela = janelaViva();
    return Boolean(janela) && janela.isVisible() && !janela.isMinimized() && janela.isFocused();
  }

  /** Traz a janela de volta (restaura, mostra e foca); sem janela, pede que o app abra uma. */
  function abrir() {
    const janela = janelaViva();
    if (!janela) {
      abrirJanela();
      return;
    }
    if (janela.isMinimized()) janela.restore();
    if (!janela.isVisible()) janela.show();
    janela.focus();
  }

  /** Abre a janela e pede à tela que abra o painel das Rotinas (o clique na notificação de aprovação). */
  function abrirPainelDeRotinas() {
    abrir();
    const janela = janelaViva();
    if (janela && !janela.webContents.isDestroyed()) janela.webContents.send(CANAL_ABRIR_PAINEL_DE_ROTINAS);
  }

  function iniciarComOWindows() {
    if (!inicioComOWindowsDisponivel) return false;
    try {
      const configuracao = app.getLoginItemSettings(opcoesDoInicio);
      // `executableWillLaunchAtLogin` é falso quando o usuário desligou o app no Gerenciador de Tarefas.
      return configuracao.openAtLogin === true && configuracao.executableWillLaunchAtLogin !== false;
    } catch (erro) {
      registrar(`Não foi possível ler "Iniciar com o Windows": ${erro.message || erro}`);
      return false;
    }
  }

  function definirIniciarComOWindows(ligado) {
    if (!inicioComOWindowsDisponivel) return;
    try {
      app.setLoginItemSettings({ openAtLogin: ligado === true, ...opcoesDoInicio });
    } catch (erro) {
      registrar(`Não foi possível ${ligado ? "ligar" : "desligar"} "Iniciar com o Windows": ${erro.message || erro}`);
    }
    atualizarIcone();
  }

  /** O modelo do menu do ícone (sem `Menu` aqui dentro, para o teste conferir os itens). */
  function modeloDoMenu() {
    const itens = [{ label: "Abrir", click: () => abrir() }];
    const resumo = resumoDasRotinas(situacao);
    if (resumo.length > 0) {
      itens.push({ label: resumo.join(" · "), enabled: false });
    }
    itens.push(
      { type: "separator" },
      {
        label: inicioComOWindowsDisponivel ? "Iniciar com o Windows" : "Iniciar com o Windows (só no app instalado)",
        type: "checkbox",
        checked: iniciarComOWindows(),
        enabled: inicioComOWindowsDisponivel,
        click: (item) => definirIniciarComOWindows(item.checked),
      },
      { type: "separator" },
      { label: "Sair", click: () => sair() },
    );
    return itens;
  }

  function atualizarIcone() {
    if (!icone) return;
    try {
      icone.setToolTip(dicaDoIcone(nomeDoApp, situacao));
      icone.setContextMenu(Menu.buildFromTemplate(modeloDoMenu()));
    } catch (erro) {
      registrar(`Não foi possível atualizar o ícone da bandeja: ${erro.message || erro}`);
    }
  }

  /** Mostra uma notificação do Windows e guarda a referência até ela fechar. false se o sistema não suporta. */
  function notificar({ titulo, texto, aoClicar }) {
    try {
      if (!Notification.isSupported()) return false;
      const notificacao = new Notification({ title: titulo, body: texto });
      notificacoes.add(notificacao);
      notificacao.on("click", () => {
        notificacoes.delete(notificacao);
        aoClicar();
      });
      notificacao.on("close", () => notificacoes.delete(notificacao));
      notificacao.show();
      return true;
    } catch (erro) {
      registrar(`Não foi possível mostrar a notificação: ${erro.message || erro}`);
      return false;
    }
  }

  function avisarQueFicouNaBandeja() {
    const estado = lerEstado();
    if (estado.avisoDeSegundoPlanoMostrado === true) return;
    const mostrou = notificar({
      titulo: `${nomeDoApp} continua aberto`,
      texto: MENSAGEM_DO_AVISO_DE_SEGUNDO_PLANO,
      aoClicar: abrir,
    });
    if (mostrou) gravarEstado({ ...estado, avisoDeSegundoPlanoMostrado: true });
  }

  function avisarAprovacoes({ aguardandoAprovacao, pendentes }, anterior) {
    const novas = pendentes.filter((pendente) => !jaAvisadas.has(pendente.id));
    jaAvisadas = new Set(pendentes.map((pendente) => pendente.id));
    // Sem os nomes (tela antiga), só dá para contar: o que passou de quantas aguardavam antes é novo.
    const semNome = pendentes.length === 0 ? Math.max(0, aguardandoAprovacao - anterior.aguardandoAprovacao) : 0;
    const quantidade = novas.length + semNome;
    // Com a janela à frente o usuário já está vendo o cartão: a notificação só atrapalharia.
    if (quantidade === 0 || janelaEmFoco()) return;
    notificar({
      titulo: nomeDoApp,
      texto: textoDaAprovacao(
        quantidade,
        novas.map((nova) => nova.rotina),
      ),
      aoClicar: abrirPainelDeRotinas,
    });
  }

  return {
    /** A bandeja existe nesta plataforma (Windows). */
    ativa,

    /** Cria o ícone. Chamar depois do `ready`. Sem a bandeja (outra plataforma, ícone inválido), não faz nada. */
    iniciar() {
      if (!ativa || icone) return;
      try {
        const imagem = nativeImage.createFromPath(caminhoDoIcone);
        if (imagem.isEmpty()) {
          registrar(`Ícone da bandeja não encontrado em ${caminhoDoIcone}.`);
          return;
        }
        icone = new Tray(imagem);
        icone.on("click", abrir);
        atualizarIcone();
      } catch (erro) {
        icone = null;
        registrar(`Não foi possível criar o ícone da bandeja: ${erro.message || erro}`);
      }
    },

    /** Remove o ícone (senão ele fica fantasma na bandeja depois que o app fecha). */
    encerrar() {
      if (!icone) return;
      try {
        icone.destroy();
      } catch (erro) {
        registrar(`Não foi possível remover o ícone da bandeja: ${erro.message || erro}`);
      }
      icone = null;
    },

    /** O Windows abriu o app no login: a janela fica escondida e só o ícone aparece. */
    iniciadoNaBandeja: () => ativa && argumentos.includes(ARGUMENTO_DE_INICIO_NA_BANDEJA),

    /**
     * O `close` da janela principal. Com Rotina ativa e o ícone na bandeja, cancela o
     * fechamento e esconde a janela (e devolve true); fora disso devolve false e a
     * janela fecha como sempre.
     */
    aoFecharJanela(evento, janela) {
      if (!ativa || !icone || saindo || fechamentoLivre || situacao.ativas === 0) return false;
      evento.preventDefault();
      janela.hide();
      avisarQueFicouNaBandeja();
      return true;
    },

    /** Fecha a janela de verdade, mesmo com Rotinas ativas (ex.: a licença foi bloqueada). */
    fecharDeVerdade(janela) {
      fechamentoLivre = true;
      try {
        janela.close();
      } finally {
        fechamentoLivre = false;
      }
    },

    /** O app vai encerrar (Sair, atualização, desligar o Windows): daqui em diante fechar a janela não esconde. */
    marcarSaida() {
      saindo = true;
    },

    /** O que a tela contou: quantas Rotinas estão ativas e quais execuções aguardam aprovação. */
    informarSituacao(dados) {
      const nova = normalizarSituacao(dados);
      const anterior = situacao;
      situacao = { ativas: nova.ativas, aguardandoAprovacao: nova.aguardandoAprovacao };
      atualizarIcone();
      avisarAprovacoes(nova, anterior);
    },

    abrir,
    iniciarComOWindows,
    definirIniciarComOWindows,
    /** O que a tela informou por último (para conferir e para o menu). */
    situacao: () => ({ ...situacao }),
  };
}

module.exports = {
  ARGUMENTO_DE_INICIO_NA_BANDEJA,
  CANAL_ABRIR_PAINEL_DE_ROTINAS,
  MENSAGEM_DO_AVISO_DE_SEGUNDO_PLANO,
  criarArquivoDeEstado,
  criarBandeja,
  dicaDoIcone,
  normalizarSituacao,
  textoDaAprovacao,
};
