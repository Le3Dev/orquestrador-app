"use strict";

// Motor nativo de transcrição, lado do processo principal.
//
// - "transcricao:conectar" (só do frame principal da janela principal): cria um
//   MessageChannelMain e entrega uma ponta à tela
//   (webContents.postMessage("transcricao:porta", null, [porta])). A outra ponta
//   fica aqui: o principal repassa as mensagens ao utilitário
//   (electron/transcritorNativo.js) por um segundo canal, só dele. Assim o
//   utilitário pode ser encerrado e subir de novo sem a porta da tela fechar.
// - O utilitário só sobe quando chega um pedido (preparar ou transcrever); um
//   "descarregar" sem utilitário no ar é ignorado.
// - Ocioso (3 min sem pedidos, ou depois de "descarregar"): o utilitário avisa
//   com quantas mensagens recebeu; se bate com quantas o principal mandou (nada
//   a caminho), o principal o encerra e devolve a memória, inclusive a da GPU.
//   A porta da tela continua aberta; o próximo pedido sobe outro utilitário.
// - Queda (saída não pedida): o principal fecha a porta da tela. A tela vê o
//   "close", conta a queda, reconecta e reenvia o que estava em andamento. Duas
//   quedas seguidas (sem um "pronto" no meio) → desiste: "transcricao:conectar"
//   passa a recusar e a tela usa a reserva do navegador.
// - Pedidos de modelo do utilitário (parentPort): baixa com o net.fetch do
//   Electron (electron/modelosDaTranscricao.js) e devolve o progresso, que o
//   utilitário encaminha à tela como "baixando".
// - Os ids de "transcrever" são trocados por ids internos no caminho de ida e
//   desfeitos na volta: a resposta de uma porta antiga (tela recarregada) nunca
//   cai num pedido da porta nova.
//
// Lógica sem Electron direto: utilityProcess, MessageChannelMain e o download
// são injetados para permitir teste.

const fs = require("node:fs");
const path = require("node:path");
const { vemDaJanelaPrincipal } = require("./escutaDoModoInvisivel");

const QUEDAS_SEGUIDAS_PARA_DESISTIR = 2;
/** Argumento da janela que diz ao preload se o binário do onnxruntime-node existe. */
const ARGUMENTO_DA_TRANSCRICAO_NATIVA = "--transcricao-nativa-disponivel";

/** Caminho do binding N-API do onnxruntime-node para a plataforma (null se o pacote não existe). */
function caminhoDoBinarioDoOnnx({ plataforma = process.platform, arquitetura = process.arch, resolver = require.resolve } = {}) {
  try {
    const pacote = resolver("onnxruntime-node/package.json");
    return path.join(path.dirname(pacote), "bin", "napi-v6", plataforma, arquitetura, "onnxruntime_binding.node");
  } catch {
    return null;
  }
}

/** O binário do onnxruntime-node da plataforma existe? (fs.existsSync enxerga o app.asar e o .unpacked.) */
function binarioDoOnnxDisponivel(opcoes = {}, existe = fs.existsSync) {
  const caminho = caminhoDoBinarioDoOnnx(opcoes);
  return Boolean(caminho) && existe(caminho);
}

function mensagemDoErro(erro) {
  return (erro && erro.message) || String(erro);
}

function ehRegistro(valor) {
  return typeof valor === "object" && valor !== null;
}

function fecharPorta(porta) {
  try {
    porta.close();
  } catch {
    /* já fechada */
  }
}

/**
 * @param {object} p
 * @param {{ fork: Function }} p.utilityProcess
 * @param {new () => { port1: object, port2: object }} p.MessageChannelMain
 * @param {string} p.caminhoDoTranscritor   electron/transcritorNativo.js
 * @param {string} p.pastaDosModelos        <userData>/modelos-da-transcricao
 * @param {string} p.pastaDeTrabalho        cwd do utilitário (fora do app.asar)
 * @param {boolean} p.disponivel            binário do onnxruntime-node presente
 * @param {(pedido: object) => Promise<unknown>} p.baixarModelo  modelosDaTranscricao.baixarModelo com o buscar já injetado
 * @param {(texto: string) => void} [p.registrar]
 * @param {object} [p.ambiente]             env base do utilitário (process.env)
 */
function criarTranscricaoNativa({
  utilityProcess,
  MessageChannelMain,
  caminhoDoTranscritor,
  pastaDosModelos,
  pastaDeTrabalho,
  disponivel,
  baixarModelo,
  registrar,
  ambiente = process.env,
}) {
  const log = (texto) => {
    if (registrar) registrar(texto);
  };
  const estado = {
    filho: null, // utilitário atual: { processo, porta, enviadas }
    quedasSeguidas: 0,
    desistiu: !disponivel,
    fechando: false,
    portaDaTela: null, // ponta do principal no canal da tela
    prioridadeDaEscuta: null,
  };
  /** id interno → { porta, id } do pedido "transcrever" repassado ao utilitário. */
  const emAndamento = new Map();
  let proximoIdInterno = 1;

  function leitorDeLinhas(prefixo) {
    let resto = "";
    return {
      escrever(pedaco) {
        resto += pedaco.toString("utf8");
        const quebra = resto.lastIndexOf("\n");
        if (quebra < 0) return;
        for (const linha of resto.slice(0, quebra).split(/\r?\n/)) if (linha.trim()) log(`${prefixo}${linha}`);
        resto = resto.slice(quebra + 1);
      },
      finalizar() {
        if (resto.trim()) log(`${prefixo}${resto}`);
        resto = "";
      },
    };
  }

  // ── Utilitário ──────────────────────────────────────────────────────────
  function subir() {
    if (estado.filho) return estado.filho;
    const processo = utilityProcess.fork(caminhoDoTranscritor, [], {
      env: { ...ambiente, ORQUESTRADOR_PASTA_DOS_MODELOS: pastaDosModelos },
      cwd: pastaDeTrabalho,
      stdio: ["ignore", "pipe", "pipe"],
      serviceName: "Transcrição do Orquestrador",
    });
    // A ponta do utilitário vai no "spawn"; o que for postado antes espera na fila da porta.
    const { port1: pontaDoUtilitario, port2: porta } = new MessageChannelMain();
    const filho = { processo, porta, enviadas: 0, encerramentoPedido: false };
    estado.filho = filho;

    const saida = leitorDeLinhas("");
    const erros = leitorDeLinhas("(stderr) ");
    if (processo.stdout) processo.stdout.on("data", (pedaco) => saida.escrever(pedaco));
    if (processo.stderr) processo.stderr.on("data", (pedaco) => erros.escrever(pedaco));

    porta.on("message", (evento) => aoMensagemDoUtilitarioPelaPorta(filho, evento && evento.data));
    porta.start();

    processo.once("spawn", () => {
      log(`Motor nativo iniciado (pid ${processo.pid}).`);
      try {
        processo.postMessage({ tipo: "porta", prioridadeDaEscuta: estado.prioridadeDaEscuta }, [pontaDoUtilitario]);
      } catch (erro) {
        log(`Falha ao entregar a porta ao motor nativo: ${mensagemDoErro(erro)}`);
      }
    });
    processo.once("exit", (codigo) => {
      saida.finalizar();
      erros.finalizar();
      aoSair(filho, codigo);
    });
    processo.on("message", (mensagem) => aoMensagemDoUtilitario(filho, mensagem));
    return filho;
  }

  function encerrarFilho(filho) {
    filho.encerramentoPedido = true;
    if (estado.filho === filho) estado.filho = null;
    try {
      filho.processo.kill();
    } catch {
      /* já saiu */
    }
  }

  function aoSair(filho, codigo) {
    if (estado.filho === filho) estado.filho = null;
    fecharPorta(filho.porta);
    if (estado.fechando) return;
    if (filho.encerramentoPedido) {
      log(`Motor nativo encerrado para liberar a memória (código ${codigo}).`);
      return;
    }
    // O que estava com ele se perdeu: a tela reenvia depois de reconectar.
    emAndamento.clear();
    estado.quedasSeguidas += 1;
    if (estado.quedasSeguidas >= QUEDAS_SEGUIDAS_PARA_DESISTIR) {
      estado.desistiu = true;
      log(
        `O motor nativo caiu ${estado.quedasSeguidas} vezes seguidas (último código ${codigo}). Parei de religar; a tela usa a reserva do navegador.`,
      );
    } else {
      log(`O motor nativo caiu (código ${codigo}). O próximo pedido sobe outro.`);
    }
    // A tela vê o "close", conta a queda e reconecta (ou, depois de desistir, cai para o navegador).
    soltarPortaDaTela();
  }

  function enviarAoUtilitario(dados) {
    if (estado.desistiu || estado.fechando) return;
    if (!estado.filho && dados.tipo === "descarregar") return; // nada carregado
    const filho = subir();
    filho.enviadas += 1;
    filho.porta.postMessage(dados);
  }

  // ── Tela → utilitário ───────────────────────────────────────────────────
  function aoMensagemDaTela(porta, dados) {
    if (porta !== estado.portaDaTela || !ehRegistro(dados)) return;
    if (dados.tipo === "preparar") {
      if (dados.origem === "escuta" && typeof dados.prioridade === "string") estado.prioridadeDaEscuta = dados.prioridade;
      enviarAoUtilitario(dados);
      return;
    }
    if (dados.tipo === "transcrever") {
      const idInterno = proximoIdInterno++;
      emAndamento.set(idInterno, { porta, id: typeof dados.id === "number" ? dados.id : null });
      enviarAoUtilitario({ ...dados, id: idInterno });
      return;
    }
    if (dados.tipo === "descarregar") enviarAoUtilitario(dados);
  }

  // ── Utilitário → tela ───────────────────────────────────────────────────
  function aoMensagemDoUtilitarioPelaPorta(filho, dados) {
    if (!ehRegistro(dados)) return;
    if ((dados.tipo === "resultado" || dados.tipo === "erro") && typeof dados.id === "number") {
      const pedido = emAndamento.get(dados.id);
      if (!pedido) return;
      emAndamento.delete(dados.id);
      if (pedido.porta === estado.portaDaTela) pedido.porta.postMessage({ ...dados, id: pedido.id });
      return;
    }
    if (estado.portaDaTela) estado.portaDaTela.postMessage(dados);
  }

  async function atenderPedidoDeModelo(filho, { pedido, repositorio, precisao, dispositivo }) {
    const responder = (mensagem) => {
      if (filho !== estado.filho) return;
      try {
        filho.processo.postMessage({ ...mensagem, pedido });
      } catch {
        /* utilitário saiu */
      }
    };
    try {
      let avisouTotal = false;
      await baixarModelo({
        repositorio,
        precisao,
        dispositivo,
        pasta: pastaDosModelos,
        aoProgredir: ({ progresso, totalMb }) => {
          if (!avisouTotal) {
            avisouTotal = true;
            log(`Baixando ${repositorio} (${precisao}): ${totalMb === null ? "tamanho desconhecido" : `${totalMb} MB`}.`);
          }
          responder({ tipo: "modelo:progresso", progresso, totalMb });
        },
      });
      if (avisouTotal) log(`Download de ${repositorio} (${precisao}) concluído.`);
      responder({ tipo: "modelo:pronto" });
    } catch (erro) {
      log(`Falha ao baixar ${repositorio} (${precisao}): ${mensagemDoErro(erro)}`);
      responder({ tipo: "modelo:erro", mensagem: `Não foi possível baixar o modelo ${repositorio}: ${mensagemDoErro(erro)}` });
    }
  }

  // Mensagens do utilitário pelo parentPort (download, log, pronto, ocioso).
  function aoMensagemDoUtilitario(filho, mensagem) {
    if (!ehRegistro(mensagem)) return;
    switch (mensagem.tipo) {
      case "registro":
        log(String(mensagem.texto));
        break;
      case "modelo":
        void atenderPedidoDeModelo(filho, mensagem);
        break;
      case "pronto": {
        estado.quedasSeguidas = 0;
        const motor = mensagem.motor || {};
        log(
          `Pronto (${mensagem.origem}): ${motor.modelo} em ${motor.dispositivo} ${motor.precisao}` +
            (typeof mensagem.mediaDoBaseMs === "number" ? `, B ${mensagem.mediaDoBaseMs} ms, prioridade ${mensagem.prioridade}.` : "."),
        );
        break;
      }
      case "ocioso":
        // Só encerra se nada estiver a caminho dele (senão o pedido se perderia).
        if (filho === estado.filho && mensagem.recebidas === filho.enviadas) encerrarFilho(filho);
        break;
      default:
        break;
    }
  }

  // ── Porta da tela ───────────────────────────────────────────────────────
  function soltarPortaDaTela() {
    const porta = estado.portaDaTela;
    estado.portaDaTela = null;
    if (porta) fecharPorta(porta);
  }

  /**
   * Handler de ipcMain.handle("transcricao:conectar"). Só o frame principal da
   * janela principal; recusa (lança) também quando o motor desistiu.
   */
  function conectar(evento, janelaPrincipal) {
    if (!vemDaJanelaPrincipal(evento && evento.senderFrame, janelaPrincipal)) {
      log("Pedido de conexão ao motor nativo recusado: não veio do frame principal da janela principal.");
      throw new Error("Operação permitida só no frame principal da janela principal.");
    }
    if (estado.fechando) throw new Error("O app está fechando.");
    if (estado.desistiu) {
      throw new Error(
        disponivel
          ? "O motor nativo de transcrição foi desligado depois de cair duas vezes seguidas."
          : "O motor nativo de transcrição não está disponível nesta plataforma.",
      );
    }
    // Uma conexão nova substitui a anterior (tela recarregada ou reconectando).
    soltarPortaDaTela();
    const { port1: pontaDaTela, port2: porta } = new MessageChannelMain();
    estado.portaDaTela = porta;
    porta.on("message", (evento) => aoMensagemDaTela(porta, evento && evento.data));
    porta.on("close", () => {
      if (estado.portaDaTela === porta) estado.portaDaTela = null;
    });
    porta.start();
    janelaPrincipal.webContents.postMessage("transcricao:porta", null, [pontaDaTela]);
  }

  /** Ao fechar o app: encerra sem religar. */
  function encerrar() {
    estado.fechando = true;
    soltarPortaDaTela();
    const filho = estado.filho;
    if (filho) encerrarFilho(filho);
  }

  return {
    conectar,
    encerrar,
    // Para os testes e o log.
    get estado() {
      return {
        filho: Boolean(estado.filho),
        quedasSeguidas: estado.quedasSeguidas,
        desistiu: estado.desistiu,
        fechando: estado.fechando,
        conectada: Boolean(estado.portaDaTela),
        prioridadeDaEscuta: estado.prioridadeDaEscuta,
        emAndamento: emAndamento.size,
      };
    },
  };
}

module.exports = {
  ARGUMENTO_DA_TRANSCRICAO_NATIVA,
  QUEDAS_SEGUIDAS_PARA_DESISTIR,
  binarioDoOnnxDisponivel,
  caminhoDoBinarioDoOnnx,
  criarTranscricaoNativa,
};
