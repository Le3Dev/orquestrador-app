"use strict";

// Navegador do agente: um Chromium (WebContentsView) por Orquestrador, que os
// agentes de IA controlam por ferramentas MCP (src/infraestrutura/mcp). O
// servidor manda os comandos pelo utilityProcess (`navegador:comando`) e o
// electron/main.js os entrega a `executarComando`.
//
// Diferenças para a Prévia (electron/vistaDaPrevia.js): aqui qualquer site
// http/https vale (inclusive de máquina local) e quem navega é o agente, sem
// aprovação por ação. Ficam as proteções: sessão própria por Orquestrador
// (`persist:navegador-<id>`, separada da tela do app e da Prévia), navegação
// principal só para http/https, downloads bloqueados, permissões do site
// (câmera, microfone, localização, notificações...) negadas, pop-ups e
// target=_blank abrem na mesma vista, sem preload e com contextIsolation e
// sandbox.
//
// Como a vista funciona com o nó do canvas fechado: o WebContentsView fica
// sempre anexado à janela principal e "visível" para o Chromium, mas FORA da
// área da janela (`LIMITES_OCULTOS`: 1280x800, com só 1 DIP dentro, no canto
// superior esquerdo, e o canto cortado por `RAIO_OCULTO`: nenhum pixel da tela
// é coberto), onde a página continua pintando (requestAnimationFrame,
// transições, IntersectionObserver). Não existe "por baixo da tela": a vista
// anexada é filha da tela e sempre é desenhada por cima dela, qualquer que seja
// o índice; dentro da área da janela ela a cobriria. Visível de verdade só
// quando a tela manda `mostrar` com o retângulo do nó. O mesmo lugar vale no
// modo invisível (janela transparente). Desanexar a vista da janela trava
// captura e pintura: por isso nunca se remove sem fechar.
//
// Os comandos usam o `webContents.debugger` (protocolo do Chrome): cliques,
// teclas e rolagem são eventos de entrada reais (`isTrusted`), em pixels CSS
// (independem do zoom da vista); a leitura da página e a marcação dos
// elementos com `ref` rodam num mundo isolado (`Page.createIsolatedWorld`),
// que a página não enxerga.
//
// Pausar/assumir: com o navegador pausado, o usuário o controla e os comandos
// do agente são recusados ("O usuário assumiu o navegador; tente depois.").

const { calcularLimites, origemParaLog, userAgentDeNavegador, validarId, validarRetangulo } = require("./vistaDaPrevia");

const PREFIXO_DA_PARTICAO = "persist:navegador-";

/** As vistas abertas ao mesmo tempo: cada uma é um processo de renderização. */
const LIMITE_DE_VISTAS = 8;

const TAMANHO_MAXIMO_DA_URL = 2048;

/**
 * Limites da vista quando o nó do canvas não está aberto (ou no modo invisível): 1280x800, o layout que o
 * agente enxerga, fora da janela e com só 1 DIP dentro dela, no canto superior esquerdo. A vista anexada é
 * filha da tela e sempre desenhada por cima dela, qualquer que seja o índice: "por baixo" não existe, e
 * dentro da área da janela ela a cobriria. Mas inteira fora (ex.: -10000,-10000) o Chromium a trata como
 * escondida: nasce sem tamanho (0x0), não pinta e a captura trava. Com 1 DIP dentro ele a mantém visível.
 */
const LIMITES_OCULTOS = { x: 1 - 1280, y: 1 - 800, width: 1280, height: 800 };
/** Raio que corta o canto da vista escondida: o pixel que sobra dentro da janela não é desenhado. */
const RAIO_OCULTO = 10;

const NOME_DO_MUNDO_ISOLADO = "orquestrador-do-agente";

const LIMITE_DO_TEXTO = 20_000;
const LIMITE_DE_ELEMENTOS = 250;
const LARGURA_MAXIMA_DA_CAPTURA = 1280;
const LARGURA_MAXIMA_DA_FOTO = 1000;

const TEMPOS_PADRAO = {
  /** Espera máxima de uma página carregar; passou, segue com o que já apareceu. */
  carregamentoMs: 30_000,
  /** O DOM fica quieto por este tempo depois de uma ação... */
  domQuietoMs: 300,
  /** ...ou a espera acaba neste teto. */
  domTetoMs: 1500,
  /** Dá tempo de uma navegação começar depois de um clique. */
  inicioDeNavegacaoMs: 150,
  /** A captura de uma janela que nunca foi mostrada pode nunca terminar. */
  capturaMs: 8_000,
  /** Quanto esperar um texto aparecer. */
  textoMs: 20_000,
  /** Intervalo entre as checagens da espera por texto. */
  sondagemMs: 250,
  /** Depois de rolar (rolagem suave, carregamento preguiçoso). */
  rolagemMs: 250,
};

const MENSAGEM_PAUSADO = "O usuário assumiu o navegador; tente depois.";
const MENSAGEM_SEM_JANELA = "A janela do aplicativo não está aberta.";

const TIPOS_DE_COMANDO = new Set([
  "abrir",
  "ler_pagina",
  "clicar",
  "digitar",
  "tecla",
  "rolar",
  "capturar_tela",
  "voltar",
  "avancar",
  "recarregar",
  "esperar",
]);

// ──────────────────────────────────────────────────────────────────────────
// Funções puras (testadas sem Electron).
// ──────────────────────────────────────────────────────────────────────────

/** Erro de um comando; `motivo` segue src/navegador/ErroDoNavegador.ts. */
class ErroDoNavegadorDoAgente extends Error {
  constructor(motivo, mensagem) {
    super(mensagem);
    this.name = "ErroDoNavegadorDoAgente";
    this.motivo = motivo;
  }
}

const erroDoComando = (mensagem) => new ErroDoNavegadorDoAgente("comando_invalido", mensagem);

function particaoDoOrquestrador(id) {
  return `${PREFIXO_DA_PARTICAO}${id}`;
}

/** O endereço normalizado se for http/https sem usuário e senha (qualquer host); nulo para todo o resto. */
function enderecoPermitido(bruto) {
  if (typeof bruto !== "string" || bruto.length === 0 || bruto.length > TAMANHO_MAXIMO_DA_URL) return null;
  let url;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.href;
}

/**
 * A navegação que a página pode fazer: o quadro principal só vai para
 * http/https (nunca file:, chrome:, devtools:, javascript:, data: nem blob:);
 * quadros internos (anúncios, pagamentos, login) também podem ser about:blank,
 * blob: e data:.
 */
function navegacaoPermitida(url, ehQuadroPrincipal) {
  if (enderecoPermitido(url) !== null) return true;
  if (ehQuadroPrincipal) return false;
  return /^(about:blank|blob:|data:)/i.test(String(url));
}

const MODIFICADORES = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 };

const TECLAS_NOMEADAS = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", vk: 9, text: "" },
  Escape: { key: "Escape", code: "Escape", vk: 27, text: "" },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8, text: "" },
  Delete: { key: "Delete", code: "Delete", vk: 46, text: "" },
  Space: { key: " ", code: "Space", vk: 32, text: " " },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37, text: "" },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38, text: "" },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39, text: "" },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40, text: "" },
  Home: { key: "Home", code: "Home", vk: 36, text: "" },
  End: { key: "End", code: "End", vk: 35, text: "" },
  PageUp: { key: "PageUp", code: "PageUp", vk: 33, text: "" },
  PageDown: { key: "PageDown", code: "PageDown", vk: 34, text: "" },
};
for (let numero = 1; numero <= 12; numero += 1) {
  TECLAS_NOMEADAS[`F${numero}`] = { key: `F${numero}`, code: `F${numero}`, vk: 111 + numero, text: "" };
}

/** Comandos de edição que o Chromium só executa se vierem junto do atalho (Ctrl+A etc.). */
const COMANDOS_DE_EDICAO = { a: "selectAll", c: "copy", v: "paste", x: "cut", z: "undo", y: "redo" };

/**
 * "Ctrl+Shift+A" -> o que o `Input.dispatchKeyEvent` precisa: { key, code, vk,
 * modifiers, text, commands }. Lança `comando_invalido` para tecla desconhecida.
 */
function resolverTecla(nome) {
  if (typeof nome !== "string" || nome.trim() === "") throw erroDoComando("Informe o nome da tecla.");
  const partes = nome.trim().split("+");
  const chave = partes.pop();
  let modificadores = 0;
  for (const parte of partes) {
    const achado = Object.keys(MODIFICADORES).find((candidato) => candidato.toLowerCase() === parte.trim().toLowerCase());
    if (!achado) throw erroDoComando(`Modificador de tecla desconhecido: "${parte}".`);
    modificadores |= MODIFICADORES[achado];
  }
  let definicao = Object.hasOwn(TECLAS_NOMEADAS, chave) ? TECLAS_NOMEADAS[chave] : undefined;
  if (!definicao && /^[A-Za-z]$/.test(chave)) {
    const maiuscula = (modificadores & MODIFICADORES.Shift) !== 0;
    definicao = {
      key: maiuscula ? chave.toUpperCase() : chave.toLowerCase(),
      code: `Key${chave.toUpperCase()}`,
      vk: chave.toUpperCase().charCodeAt(0),
      text: maiuscula ? chave.toUpperCase() : chave.toLowerCase(),
    };
  } else if (!definicao && /^[0-9]$/.test(chave)) {
    definicao = { key: chave, code: `Digit${chave}`, vk: chave.charCodeAt(0), text: chave };
  }
  if (!definicao) throw erroDoComando(`Tecla desconhecida: "${nome}".`);
  // Com Ctrl, Alt ou Meta a tecla não escreve nada: é atalho.
  const atalho = (modificadores & (MODIFICADORES.Ctrl | MODIFICADORES.Alt | MODIFICADORES.Meta)) !== 0;
  const comando = (modificadores & (MODIFICADORES.Ctrl | MODIFICADORES.Meta)) !== 0 && !(modificadores & MODIFICADORES.Alt)
    ? COMANDOS_DE_EDICAO[definicao.key.toLowerCase()]
    : undefined;
  const commands = comando === "undo" && (modificadores & MODIFICADORES.Shift) ? ["redo"] : comando ? [comando] : [];
  return {
    key: definicao.key,
    code: definicao.code,
    vk: definicao.vk,
    modifiers: modificadores,
    text: atalho ? "" : definicao.text,
    commands,
  };
}

function inteiroEntre(valor, minimo, maximo) {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= minimo && valor <= maximo;
}

function textoNaoVazio(valor, maximo) {
  return typeof valor === "string" && valor.trim() !== "" && valor.length <= maximo;
}

/**
 * Confere o comando que veio do servidor (que já o validou: aqui é a segunda
 * barreira) e devolve uma cópia só com os campos conhecidos.
 */
function validarComando(bruto) {
  if (bruto === null || typeof bruto !== "object" || !TIPOS_DE_COMANDO.has(bruto.tipo)) {
    throw erroDoComando("Comando do navegador desconhecido.");
  }
  switch (bruto.tipo) {
    case "abrir": {
      const url = enderecoPermitido(bruto.url);
      if (url === null) {
        throw new ErroDoNavegadorDoAgente("recusado", "O navegador só abre endereços http e https, sem usuário e senha.");
      }
      return { tipo: "abrir", url };
    }
    case "clicar": {
      const temRef = bruto.ref !== undefined && bruto.ref !== null;
      const temTexto = bruto.texto !== undefined && bruto.texto !== null;
      if (temRef === temTexto) throw erroDoComando('Para clicar, informe só "ref" ou só "texto".');
      if (temRef) {
        if (!inteiroEntre(bruto.ref, 1, 100_000)) throw erroDoComando('"ref" inválido.');
        return { tipo: "clicar", ref: bruto.ref };
      }
      if (!textoNaoVazio(bruto.texto, 200)) throw erroDoComando('"texto" inválido.');
      return { tipo: "clicar", texto: bruto.texto };
    }
    case "digitar": {
      if (typeof bruto.texto !== "string" || bruto.texto.length > 10_000) throw erroDoComando('"texto" inválido.');
      const comando = { tipo: "digitar", texto: bruto.texto, enviar: bruto.enviar === true };
      if (bruto.ref !== undefined && bruto.ref !== null) {
        if (!inteiroEntre(bruto.ref, 1, 100_000)) throw erroDoComando('"ref" inválido.');
        comando.ref = bruto.ref;
      }
      return comando;
    }
    case "tecla":
      resolverTecla(bruto.nome);
      return { tipo: "tecla", nome: bruto.nome };
    case "rolar": {
      if (!["cima", "baixo", "esquerda", "direita"].includes(bruto.direcao)) throw erroDoComando('"direcao" inválida.');
      const quantidade = bruto.quantidade ?? 1;
      if (typeof quantidade !== "number" || !Number.isFinite(quantidade) || quantidade <= 0 || quantidade > 20) {
        throw erroDoComando('"quantidade" inválida.');
      }
      return { tipo: "rolar", direcao: bruto.direcao, quantidade };
    }
    case "esperar": {
      const temMs = bruto.ms !== undefined && bruto.ms !== null;
      const temTexto = bruto.texto !== undefined && bruto.texto !== null;
      if (temMs === temTexto) throw erroDoComando('Para esperar, informe só "ms" ou só "texto".');
      if (temMs) {
        if (!inteiroEntre(bruto.ms, 1, 30_000)) throw erroDoComando('"ms" inválido.');
        return { tipo: "esperar", ms: bruto.ms };
      }
      if (!textoNaoVazio(bruto.texto, 200)) throw erroDoComando('"texto" inválido.');
      return { tipo: "esperar", texto: bruto.texto };
    }
    default:
      return { tipo: bruto.tipo };
  }
}

function cortar(texto, maximo) {
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

/** O que a tela mostra enquanto o comando roda. Nunca inclui o texto digitado. */
function descreverComando(comando) {
  switch (comando.tipo) {
    case "abrir":
      return `Abrindo ${origemParaLog(comando.url)}`;
    case "ler_pagina":
      return "Lendo a página";
    case "clicar":
      return comando.ref !== undefined ? `Clicando no elemento ${comando.ref}` : `Clicando em "${cortar(comando.texto, 40)}"`;
    case "digitar":
      return "Digitando";
    case "tecla":
      return `Apertando ${comando.nome}`;
    case "rolar":
      return `Rolando para ${comando.direcao}`;
    case "capturar_tela":
      return "Capturando a tela";
    case "voltar":
      return "Voltando";
    case "avancar":
      return "Avançando";
    case "recarregar":
      return "Recarregando";
    case "esperar":
      return comando.texto !== undefined ? `Esperando o texto "${cortar(comando.texto, 40)}"` : "Esperando";
    default:
      return "";
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Código que roda DENTRO da página (mundo isolado). Cada função precisa ser
// autocontida: vira texto (`toString`) e é avaliada na página.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Cria a biblioteca da página uma vez por documento (guardada em
 * `globalThis.__orquestradorDoAgente`, que só o mundo isolado enxerga).
 * `ler` numera os elementos interativos (`ref`) e `localizar` acha um deles
 * pelo `ref` ou pelo texto, rola até ele e devolve o ponto do clique.
 */
function criarBibliotecaDaPagina() {
  const SELETOR = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=switch]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=option]",
    "[role=combobox]",
    "[role=textbox]",
    "[contenteditable='']",
    "[contenteditable=true]",
    "[onclick]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");
  const refs = new Map();

  const colapsar = (texto) => String(texto == null ? "" : texto).replace(/\s+/g, " ").trim();
  const cortarTexto = (texto, maximo) => (texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto);

  function visivel(el) {
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } else if (getComputedStyle(el).visibility === "hidden") {
      return false;
    }
    const retangulo = el.getBoundingClientRect();
    return retangulo.width >= 1 && retangulo.height >= 1;
  }

  function nomeDe(el) {
    const aria = colapsar(el.getAttribute("aria-label"));
    if (aria) return aria;
    const rotuladoPor = el.getAttribute("aria-labelledby");
    if (rotuladoPor) {
      const texto = colapsar(
        rotuladoPor
          .split(/\s+/)
          .map((id) => (document.getElementById(id) || {}).textContent || "")
          .join(" "),
      );
      if (texto) return texto;
    }
    if (el.labels && el.labels.length > 0) {
      const texto = colapsar(Array.from(el.labels).map((rotulo) => rotulo.textContent).join(" "));
      if (texto) return texto;
    }
    const tag = el.tagName;
    if (tag === "INPUT") {
      if (["button", "submit", "reset"].includes(el.type)) return colapsar(el.value);
      if (el.type === "image") return colapsar(el.alt);
      return colapsar(el.placeholder || el.title || el.name);
    }
    if (tag === "SELECT" || tag === "TEXTAREA") return colapsar(el.title || el.name);
    const texto = colapsar(el.innerText || el.textContent);
    if (texto) return texto;
    const imagem = el.querySelector("img[alt]");
    return colapsar(el.getAttribute("title") || (imagem ? imagem.alt : ""));
  }

  function tipoDe(el) {
    const tag = el.tagName;
    const papel = (el.getAttribute("role") || "").toLowerCase();
    if (tag === "A" || papel === "link") return "link";
    if (tag === "BUTTON" || tag === "SUMMARY" || papel === "button") return "botão";
    if (tag === "SELECT" || papel === "combobox") return "lista";
    if (tag === "TEXTAREA" || papel === "textbox" || el.isContentEditable) return "campo de texto";
    if (tag === "INPUT") {
      const tipo = (el.type || "text").toLowerCase();
      if (tipo === "checkbox") return "caixa de seleção";
      if (tipo === "radio") return "opção";
      if (["button", "submit", "reset", "image"].includes(tipo)) return "botão";
      if (tipo === "password") return "campo de senha";
      if (tipo === "file") return "campo de arquivo";
      return "campo";
    }
    if (papel === "checkbox" || papel === "switch") return "caixa de seleção";
    if (papel === "radio" || papel === "option") return "opção";
    if (papel === "tab") return "aba";
    if (papel === "menuitem") return "item de menu";
    return "elemento";
  }

  function valorDe(el) {
    const tag = el.tagName;
    if (tag === "SELECT") {
      const opcao = el.options && el.options[el.selectedIndex];
      return opcao ? cortarTexto(colapsar(opcao.text), 80) : "";
    }
    if (tag === "TEXTAREA") return cortarTexto(colapsar(el.value), 80);
    if (tag === "INPUT") {
      const tipo = (el.type || "text").toLowerCase();
      // Senha nunca sai da página; botões e marcações já têm nome e estado.
      if (["password", "button", "submit", "reset", "image", "checkbox", "radio", "file"].includes(tipo)) return "";
      return cortarTexto(colapsar(el.value), 80);
    }
    return "";
  }

  function estadoDe(el) {
    const estados = [];
    if (el.disabled || el.getAttribute("aria-disabled") === "true") estados.push("desabilitado");
    if (el.checked === true || el.getAttribute("aria-checked") === "true") estados.push("marcado");
    if (el.getAttribute("aria-selected") === "true") estados.push("selecionado");
    if (el.getAttribute("aria-expanded") === "true") estados.push("expandido");
    if (el.getAttribute("aria-expanded") === "false") estados.push("recolhido");
    return estados.join(", ");
  }

  function dentroDeOutroAcionavel(el) {
    return Boolean(el.parentElement && el.parentElement.closest("a[href], button, [role=button], [role=link]"));
  }

  function naTela(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }

  function acionaveis() {
    return Array.from(document.querySelectorAll(SELETOR)).filter(visivel);
  }

  /** Os elementos cujo nome (ou texto) bate com o texto: exatos primeiro, depois os que o contêm. */
  function porTexto(texto) {
    const alvo = colapsar(texto).toLowerCase();
    const candidatos = acionaveis();
    const nomes = candidatos.map((el) => (nomeDe(el) || colapsar(el.innerText)).toLowerCase());
    let achados = candidatos.filter((_el, indice) => nomes[indice] === alvo);
    if (achados.length === 0) achados = candidatos.filter((_el, indice) => nomes[indice].includes(alvo));
    if (achados.length === 0) {
      // Qualquer elemento visível com o texto (menus e cartões sem papel), o mais interno.
      const todos = Array.from(document.querySelectorAll("body *")).filter(
        (el) => visivel(el) && colapsar(el.innerText).toLowerCase().includes(alvo),
      );
      achados = todos.filter((el) => !todos.some((outro) => outro !== el && el.contains(outro)));
    }
    return achados;
  }

  function descrever(el) {
    const nome = cortarTexto(nomeDe(el), 60);
    return nome ? `${tipoDe(el)} "${nome}"` : tipoDe(el);
  }

  return {
    ler(opcoes) {
      refs.clear();
      const lista = [];
      for (const el of acionaveis()) {
        const tipo = tipoDe(el);
        const nome = nomeDe(el);
        if (tipo === "elemento" && (nome === "" || dentroDeOutroAcionavel(el))) continue;
        lista.push({ el, tipo, nome });
      }
      // Passou do limite: os que aparecem na tela têm prioridade; a ordem do documento se mantém.
      let escolhidos = lista;
      if (lista.length > opcoes.limiteDeElementos) {
        const dentro = lista.filter((item) => naTela(item.el));
        const fora = lista.filter((item) => !naTela(item.el));
        const manter = new Set(dentro.slice(0, opcoes.limiteDeElementos).concat(fora).slice(0, opcoes.limiteDeElementos));
        escolhidos = lista.filter((item) => manter.has(item));
      }
      const elementos = escolhidos.map((item, indice) => {
        const ref = indice + 1;
        refs.set(ref, item.el);
        const descricao = { ref, tipo: item.tipo, nome: cortarTexto(item.nome, 80) };
        const valor = valorDe(item.el);
        if (valor) descricao.valor = valor;
        if (item.el.tagName === "A" && typeof item.el.href === "string") {
          const href = item.el.getAttribute("href") || "";
          descricao.destino = /^javascript:/i.test(href) ? "(script)" : cortarTexto(item.el.href, 150);
        }
        const estado = estadoDe(item.el);
        if (estado) descricao.estado = estado;
        return descricao;
      });
      let texto = document.body ? document.body.innerText : "";
      texto = texto.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      const textoTruncado = texto.length > opcoes.limiteDeTexto;
      return {
        texto: textoTruncado ? texto.slice(0, opcoes.limiteDeTexto) : texto,
        textoTruncado,
        elementos,
        elementosOmitidos: lista.length - escolhidos.length,
      };
    },

    /** alvo: { ref } ou { texto }. Rola até o elemento e devolve o ponto do clique (pixels CSS da janela da página). */
    localizar(alvo) {
      let el = null;
      let aviso = "";
      if (typeof alvo.ref === "number") {
        el = refs.get(alvo.ref) || null;
        if (!el || !el.isConnected) {
          return { ok: false, erro: `O elemento [${alvo.ref}] não existe mais. Chame navegador_ler_pagina de novo para ver os ref atuais.` };
        }
      } else {
        const achados = porTexto(alvo.texto);
        if (achados.length === 0) {
          return { ok: false, erro: `Não achei nenhum elemento visível com o texto "${cortarTexto(alvo.texto, 60)}".` };
        }
        el = achados.find(naTela) || achados[0];
        if (achados.length > 1) {
          aviso = `Havia ${achados.length} elementos com esse texto; usei o primeiro. Use navegador_ler_pagina e o ref para escolher.`;
        }
      }
      const arquivo = (el.tagName === "INPUT" && el.type === "file") || (el.control && el.control.type === "file");
      if (arquivo) {
        return { ok: false, erro: "Este elemento abre o seletor de arquivos, que o navegador do agente não suporta." };
      }
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const retangulo = el.getBoundingClientRect();
      if (retangulo.width < 1 || retangulo.height < 1) return { ok: false, erro: "O elemento não está visível." };
      const x = Math.min(Math.max(retangulo.left + retangulo.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(retangulo.top + retangulo.height / 2, 0), innerHeight - 1);
      const topo = document.elementFromPoint(x, y);
      if (topo && topo !== el && !el.contains(topo) && !topo.contains(el)) {
        aviso = `${aviso ? `${aviso} ` : ""}Atenção: outro elemento (${topo.tagName.toLowerCase()}) cobre o ponto do clique.`;
      }
      return { ok: true, x, y, descricao: descrever(el), aviso, lista: el.tagName === "SELECT" };
    },

    /** Escolhe a opção de um <select> (que não abre pelo clique do protocolo). */
    escolherOpcao(ref, texto) {
      const el = refs.get(ref);
      if (!el || !el.isConnected || el.tagName !== "SELECT") return { ok: false, erro: "O elemento não é uma lista." };
      const alvo = colapsar(texto).toLowerCase();
      const opcoes = Array.from(el.options);
      const opcao =
        opcoes.find((o) => colapsar(o.text).toLowerCase() === alvo || o.value.toLowerCase() === alvo) ||
        opcoes.find((o) => colapsar(o.text).toLowerCase().includes(alvo));
      if (!opcao) {
        return { ok: false, erro: `A lista não tem a opção "${cortarTexto(texto, 60)}". Opções: ${opcoes.slice(0, 15).map((o) => `"${colapsar(o.text)}"`).join(", ")}.` };
      }
      el.value = opcao.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, escolhida: colapsar(opcao.text) };
    },

    /** Seleciona o conteúdo do campo em foco, para o próximo texto substituí-lo. */
    selecionarConteudo() {
      const el = document.activeElement;
      if (!el) return false;
      if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && typeof el.select === "function") {
        try {
          el.select();
        } catch {
          // Tipos sem seleção (checkbox...): nada a selecionar.
        }
        return true;
      }
      if (el.isContentEditable) {
        document.execCommand("selectAll");
        return true;
      }
      return false;
    },

    /** O elemento que tem o foco agora (para avisar quando se digita no vazio). */
    focoAtual() {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return "";
      return `${tipoDe(el)}`;
    },

    /** Espera o DOM ficar quieto por `quietoMs`, no máximo `tetoMs`. */
    estavel(quietoMs, tetoMs) {
      return new Promise((resolver) => {
        let quieto = null;
        let teto = null;
        const observador = new MutationObserver(() => {
          clearTimeout(quieto);
          quieto = setTimeout(terminar, quietoMs);
        });
        function terminar() {
          observador.disconnect();
          clearTimeout(quieto);
          clearTimeout(teto);
          resolver(true);
        }
        observador.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        quieto = setTimeout(terminar, quietoMs);
        teto = setTimeout(terminar, tetoMs);
      });
    },

    contemTexto(texto) {
      return Boolean(document.body) && document.body.innerText.toLowerCase().includes(String(texto).toLowerCase());
    },

    posicaoDaRolagem() {
      const raiz = document.scrollingElement || document.documentElement;
      return {
        x: Math.round(raiz.scrollLeft),
        y: Math.round(raiz.scrollTop),
        maxX: Math.max(0, Math.round(raiz.scrollWidth - raiz.clientWidth)),
        maxY: Math.max(0, Math.round(raiz.scrollHeight - raiz.clientHeight)),
      };
    },
  };
}

/** A expressão que chama `metodo(...argumentos)` da biblioteca, criando-a no primeiro uso do documento. */
function expressaoDaPagina(metodo, ...argumentos) {
  return `(globalThis.__orquestradorDoAgente ??= (${criarBibliotecaDaPagina.toString()})()).${metodo}(${argumentos
    .map((argumento) => JSON.stringify(argumento))
    .join(", ")})`;
}

// ──────────────────────────────────────────────────────────────────────────
// Serviço (Electron injetado, para testar com falsos).
// ──────────────────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {Function} deps.WebContentsView classe do Electron
 * @param {object} deps.session módulo `session` do Electron
 * @param {() => object | null} deps.janelaPrincipal a BrowserWindow principal (ou nulo)
 * @param {(evento: object) => boolean} deps.eDaJanelaPrincipal o IPC veio do quadro principal da janela principal?
 * @param {() => boolean} [deps.bloqueada] a vista não pode aparecer agora (modo invisível)?
 * @param {string} [deps.nomeDoApp] nome do app no user agent, a remover
 * @param {(texto: string) => void} [deps.registrar]
 * @param {Partial<typeof TEMPOS_PADRAO>} [deps.tempos] só para os testes
 */
function criarNavegadorDoAgente({
  WebContentsView,
  session,
  janelaPrincipal,
  eDaJanelaPrincipal,
  bloqueada = () => false,
  nomeDoApp,
  registrar = () => undefined,
  tempos = {},
}) {
  const t = { ...TEMPOS_PADRAO, ...tempos };
  /** orquestradorId -> vista */
  const vistas = new Map();
  /** Orquestradores cujo navegador o usuário assumiu. */
  const pausados = new Set();
  const sessoesConfiguradas = new Set();

  function janelaValida() {
    const janela = janelaPrincipal();
    return janela && !janela.isDestroyed() && !janela.webContents.isDestroyed() ? janela : null;
  }

  function enviarParaATela(canal, dados) {
    const janela = janelaValida();
    if (janela) janela.webContents.send(canal, dados);
  }

  function exigirPrincipal(evento) {
    if (!eDaJanelaPrincipal(evento)) throw new Error("Operação permitida só na janela principal.");
  }

  const curto = (id) => String(id).slice(0, 8);

  // ───────────────────────── sessão ─────────────────────────

  function vistaDoConteudo(conteudo) {
    return [...vistas.values()].find((vista) => vista.view.webContents === conteudo);
  }

  function sessaoDoOrquestrador(id) {
    const sessao = session.fromPartition(particaoDoOrquestrador(id));
    if (sessoesConfiguradas.has(id)) return sessao;
    sessoesConfiguradas.add(id);
    sessao.setUserAgent(userAgentDeNavegador(sessao.getUserAgent(), nomeDoApp));
    // Permissões do site (câmera, microfone, localização, notificações, área de transferência...): tudo negado.
    sessao.setPermissionRequestHandler((_contents, _permissao, retorno) => retorno(false));
    sessao.setPermissionCheckHandler(() => false);
    // USB, serial, HID e Bluetooth: nenhum dispositivo.
    if (typeof sessao.setDevicePermissionHandler === "function") sessao.setDevicePermissionHandler(() => false);
    // Downloads bloqueados; o agente é avisado no resultado do próximo comando.
    sessao.on("will-download", (evento, _item, conteudo) => {
      evento.preventDefault();
      const vista = vistaDoConteudo(conteudo);
      if (vista) avisarNaVista(vista, "Download bloqueado: o navegador do agente não baixa arquivos.");
      registrar(`Download bloqueado (orquestrador ${curto(id)}).`);
    });
    return sessao;
  }

  // ───────────────────────── estado e eventos ─────────────────────────

  /** Avisos (diálogos, downloads) que entram na mensagem do próximo comando. */
  function avisarNaVista(vista, aviso) {
    if (vista.avisos.length < 5) vista.avisos.push(aviso);
  }

  function estadoDaVista(vista) {
    const conteudo = vista.view.webContents;
    const destruida = conteudo.isDestroyed();
    const historico = destruida ? null : conteudo.navigationHistory;
    return {
      orquestradorId: vista.id,
      url: destruida ? "" : conteudo.getURL(),
      titulo: destruida ? "" : conteudo.getTitle(),
      carregando: destruida ? false : conteudo.isLoading(),
      ultimaAcao: vista.ultimaAcao,
      emUsoPeloAgente: vista.emUso > 0,
      pausado: pausados.has(vista.id),
      podeVoltar: historico ? historico.canGoBack() : false,
      podeAvancar: historico ? historico.canGoForward() : false,
    };
  }

  /** Manda o estado à tela, só se mudou desde o último envio. */
  function avisarMudanca(vista) {
    if (!vistas.has(vista.id)) return;
    const estado = estadoDaVista(vista);
    const assinatura = JSON.stringify(estado);
    if (assinatura === vista.ultimaAssinatura) return;
    vista.ultimaAssinatura = assinatura;
    enviarParaATela("navegador-do-agente:mudou", estado);
  }

  // ───────────────────────── posição ─────────────────────────

  function areaDaJanela(janela) {
    const [largura, altura] = janela.getContentSize();
    return { largura, altura };
  }

  /**
   * Visível de verdade (sobre o nó do canvas) ou "escondida": fora da área da janela
   * (`LIMITES_OCULTOS`, sem desenhar pixel algum da tela) e ainda pintando. Nunca desanexa.
   */
  function aplicar(vista) {
    const janela = janelaValida();
    const conteudo = vista.view.webContents;
    if (!janela || conteudo.isDestroyed()) return;
    const { view } = vista;
    const limites =
      vista.mostrando && vista.retangulo && !bloqueada()
        ? calcularLimites(vista.retangulo, janela.webContents.getZoomFactor(), areaDaJanela(janela))
        : null;
    if (limites && janela.isVisible() && !janela.isMinimized()) {
      view.setBorderRadius(0);
      view.setBounds(limites.bounds);
      conteudo.setZoomFactor(limites.zoomDaPagina);
      // Adicionar de novo põe a vista no topo (acima da tela).
      janela.contentView.addChildView(view);
    } else {
      conteudo.setZoomFactor(1);
      view.setBorderRadius(RAIO_OCULTO);
      view.setBounds(LIMITES_OCULTOS);
      try {
        janela.contentView.removeChildView(view);
      } catch {
        /* ainda não estava anexada */
      }
      janela.contentView.addChildView(view, 0);
    }
    view.setVisible(true);
  }

  // ───────────────────────── vista ─────────────────────────

  function criarVista(id) {
    const janela = janelaValida();
    if (!janela) throw new ErroDoNavegadorDoAgente("indisponivel", MENSAGEM_SEM_JANELA);
    if (vistas.size >= LIMITE_DE_VISTAS) {
      throw new ErroDoNavegadorDoAgente("falhou", `Há navegadores demais abertos (${LIMITE_DE_VISTAS}). Feche algum.`);
    }
    const sessao = sessaoDoOrquestrador(id);
    const view = new WebContentsView({
      webPreferences: {
        session: sessao,
        // Sem preload: a página externa não enxerga nada do app.
        nodeIntegration: false,
        spellcheck: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
        // A página precisa seguir viva com o nó fechado.
        backgroundThrottling: false,
      },
    });
    const conteudo = view.webContents;
    conteudo.setUserAgent(sessao.getUserAgent());
    const vista = {
      id,
      view,
      mostrando: false,
      retangulo: null,
      ultimaAcao: "",
      emUso: 0,
      fila: Promise.resolve(),
      controladores: new Set(),
      avisos: [],
      ultimaAssinatura: "",
      debuggerLigado: false,
    };

    // Pop-ups e target=_blank abrem na mesma vista (só http/https).
    conteudo.setWindowOpenHandler(({ url }) => {
      const destino = enderecoPermitido(url);
      if (destino === null) {
        registrar(`Pop-up bloqueado (orquestrador ${curto(id)}): ${origemParaLog(url)}`);
      } else {
        Promise.resolve(conteudo.loadURL(destino)).catch(() => undefined);
      }
      return { action: "deny" };
    });
    const barrar = (detalhes) => {
      if (!navegacaoPermitida(detalhes.url, detalhes.isMainFrame !== false)) {
        detalhes.preventDefault();
        // Só a origem no log: o caminho e a query podem ter token ou dado pessoal.
        registrar(`Navegação bloqueada (orquestrador ${curto(id)}): ${origemParaLog(detalhes.url)}`);
        avisarNaVista(vista, `Navegação bloqueada: só http e https (${origemParaLog(detalhes.url)}).`);
      }
    };
    conteudo.on("will-frame-navigate", barrar);
    conteudo.on("will-redirect", barrar);

    const mudou = () => avisarMudanca(vista);
    for (const evento of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]) {
      conteudo.on(evento, mudou);
    }
    conteudo.on("render-process-gone", () => {
      registrar(`O processo da página caiu (orquestrador ${curto(id)}).`);
      fecharVista(id);
    });

    vistas.set(id, vista);
    view.setBounds(LIMITES_OCULTOS);
    aplicar(vista);
    // A primeira vez que o agente usa o navegador deste Orquestrador: a tela abre o nó.
    enviarParaATela("navegador-do-agente:ativado", { orquestradorId: id });
    return vista;
  }

  function obterOuCriarVista(id) {
    const existente = vistas.get(id);
    if (existente && !existente.view.webContents.isDestroyed()) return existente;
    if (existente) fecharVista(id);
    return criarVista(id);
  }

  function fecharVista(id) {
    const vista = vistas.get(id);
    if (!vista) return;
    vistas.delete(id);
    for (const controlador of vista.controladores) controlador.abort();
    const conteudo = vista.view.webContents;
    const janela = janelaValida();
    try {
      if (janela) janela.contentView.removeChildView(vista.view);
    } catch {
      /* já removida */
    }
    if (!conteudo.isDestroyed()) {
      try {
        if (conteudo.debugger.isAttached()) conteudo.debugger.detach();
      } catch {
        /* já desligado */
      }
      conteudo.close();
    }
  }

  function destruirTodas() {
    for (const id of [...vistas.keys()]) fecharVista(id);
  }

  // ───────────────────────── protocolo do Chrome ─────────────────────────

  /** O debugger ligado à vista (re-liga se algo o soltou). Cuida dos diálogos da página. */
  function debuggerDa(vista) {
    const conteudo = vista.view.webContents;
    const dbg = conteudo.debugger;
    if (!dbg.isAttached()) {
      dbg.attach("1.3");
      if (!vista.debuggerLigado) {
        vista.debuggerLigado = true;
        // alert e beforeunload seguem (não prendem o agente); confirm e prompt são recusados.
        dbg.on("message", (_evento, metodo, parametros) => {
          if (metodo !== "Page.javascriptDialogOpening") return;
          const tipo = String(parametros?.type ?? "");
          const aceitar = tipo === "alert" || tipo === "beforeunload";
          avisarNaVista(vista, `A página abriu um diálogo (${tipo}) e ele foi ${aceitar ? "aceito" : "recusado"}: ${cortar(String(parametros?.message ?? ""), 120)}`);
          Promise.resolve(dbg.sendCommand("Page.handleJavaScriptDialog", { accept: aceitar })).catch(() => undefined);
        });
      }
      Promise.resolve(dbg.sendCommand("Page.enable")).catch(() => undefined);
    }
    return dbg;
  }

  async function cdp(vista, metodo, parametros) {
    return debuggerDa(vista).sendCommand(metodo, parametros);
  }

  const contextoPerdido = (erro) =>
    /Cannot find context|Execution context was destroyed|Inspected target navigated|Target closed|No frame|Session with given id/i.test(
      String(erro?.message ?? erro),
    );

  /** Avalia `expressao` no mundo isolado da página (re-tenta uma vez se a página trocou no meio). */
  async function avaliar(vista, expressao, sinal) {
    for (let tentativa = 0; ; tentativa += 1) {
      try {
        const { frameTree } = await cdp(vista, "Page.getFrameTree");
        const { executionContextId } = await cdp(vista, "Page.createIsolatedWorld", {
          frameId: frameTree.frame.id,
          worldName: NOME_DO_MUNDO_ISOLADO,
        });
        const resposta = await cdp(vista, "Runtime.evaluate", {
          expression: expressao,
          contextId: executionContextId,
          returnByValue: true,
          awaitPromise: true,
        });
        if (resposta.exceptionDetails) {
          const detalhe = resposta.exceptionDetails.exception?.description ?? resposta.exceptionDetails.text;
          throw new ErroDoNavegadorDoAgente("falhou", `Falha ao ler a página: ${cortar(String(detalhe), 200)}`);
        }
        return resposta.result.value;
      } catch (erro) {
        if (tentativa === 0 && contextoPerdido(erro)) {
          await esperarFimDoCarregamento(vista, t.carregamentoMs, sinal);
          continue;
        }
        throw erro;
      }
    }
  }

  // ───────────────────────── esperas ─────────────────────────

  function erroDeAborto(vista) {
    return pausados.has(vista.id)
      ? new ErroDoNavegadorDoAgente("pausado", MENSAGEM_PAUSADO)
      : new ErroDoNavegadorDoAgente("cancelado", "O comando do navegador foi cancelado.");
  }

  function dormir(vista, ms, sinal) {
    return new Promise((resolver, rejeitar) => {
      if (sinal.aborted) {
        rejeitar(erroDeAborto(vista));
        return;
      }
      const aoAbortar = () => {
        clearTimeout(temporizador);
        rejeitar(erroDeAborto(vista));
      };
      const temporizador = setTimeout(() => {
        sinal.removeEventListener("abort", aoAbortar);
        resolver();
      }, ms);
      sinal.addEventListener("abort", aoAbortar, { once: true });
    });
  }

  /** Resolve quando a vista termina de carregar ou passa `ms`. */
  function esperarFimDoCarregamento(vista, ms, sinal) {
    const conteudo = vista.view.webContents;
    if (conteudo.isDestroyed() || !conteudo.isLoading()) return Promise.resolve();
    return new Promise((resolver, rejeitar) => {
      const limpar = () => {
        clearTimeout(temporizador);
        conteudo.removeListener("did-stop-loading", terminou);
        sinal.removeEventListener("abort", aoAbortar);
      };
      const terminou = () => {
        limpar();
        resolver();
      };
      const aoAbortar = () => {
        limpar();
        rejeitar(erroDeAborto(vista));
      };
      const temporizador = setTimeout(terminou, ms);
      conteudo.on("did-stop-loading", terminou);
      sinal.addEventListener("abort", aoAbortar, { once: true });
      if (sinal.aborted) aoAbortar();
    });
  }

  /** Espera o DOM ficar quieto (sem falhar: a página pode ter trocado no meio). */
  async function aguardarEstabilidade(vista, sinal) {
    try {
      await Promise.race([
        avaliar(vista, expressaoDaPagina("estavel", t.domQuietoMs, t.domTetoMs), sinal),
        dormir(vista, t.domTetoMs + 500, sinal),
      ]);
    } catch (erro) {
      if (erro instanceof ErroDoNavegadorDoAgente && (erro.motivo === "pausado" || erro.motivo === "cancelado")) throw erro;
    }
  }

  /** Depois de uma ação (clique, tecla, voltar...): dá tempo de uma navegação começar, espera o fim e o DOM assentar. */
  async function aguardarAposAcao(vista, sinal) {
    await dormir(vista, t.inicioDeNavegacaoMs, sinal);
    await esperarFimDoCarregamento(vista, t.carregamentoMs, sinal);
    await aguardarEstabilidade(vista, sinal);
  }

  // ───────────────────────── comandos ─────────────────────────

  function descricaoDoErroDeCarga(erro) {
    return String(erro?.code ?? erro?.message ?? erro);
  }

  async function abrir(vista, url, sinal) {
    const conteudo = vista.view.webContents;
    let incompleta = false;
    const carga = Promise.resolve(conteudo.loadURL(url)).then(
      () => null,
      (erro) => erro,
    );
    let temporizador;
    let aoAbortar;
    const limite = new Promise((resolver) => {
      temporizador = setTimeout(() => resolver("tempo"), t.carregamentoMs);
    });
    const cancelamento = new Promise((_resolver, rejeitar) => {
      aoAbortar = () => rejeitar(erroDeAborto(vista));
      if (sinal.aborted) aoAbortar();
      else sinal.addEventListener("abort", aoAbortar, { once: true });
    });
    let resultado;
    try {
      resultado = await Promise.race([carga, limite, cancelamento]);
    } finally {
      clearTimeout(temporizador);
      sinal.removeEventListener("abort", aoAbortar);
    }
    if (resultado === "tempo") {
      incompleta = true;
      conteudo.stop();
    } else if (resultado !== null && resultado.errno !== -3) {
      // -3 (ERR_ABORTED): outra navegação começou por cima ou o download foi barrado; não é falha de rede.
      throw new ErroDoNavegadorDoAgente(
        "falhou",
        `Não consegui abrir ${origemParaLog(url)}: ${descricaoDoErroDeCarga(resultado)}.`,
      );
    }
    await aguardarEstabilidade(vista, sinal);
    return { mensagem: incompleta ? "A página ainda estava carregando; usei o que já apareceu." : "Página aberta." };
  }

  async function lerPagina(vista, sinal) {
    const pagina = await avaliar(
      vista,
      expressaoDaPagina("ler", { limiteDeTexto: LIMITE_DO_TEXTO, limiteDeElementos: LIMITE_DE_ELEMENTOS }),
      sinal,
    );
    return { mensagem: `Li a página: ${pagina.elementos.length} elementos interativos.`, pagina };
  }

  async function mouseClicar(vista, x, y) {
    const enviar = (type, extra) => cdp(vista, "Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });
    await enviar("mouseMoved", { button: "none" });
    await enviar("mousePressed", { clickCount: 1, buttons: 1 });
    await enviar("mouseReleased", { clickCount: 1 });
  }

  async function localizar(vista, alvo, sinal) {
    const achado = await avaliar(vista, expressaoDaPagina("localizar", alvo), sinal);
    if (!achado.ok) throw new ErroDoNavegadorDoAgente("falhou", achado.erro);
    return achado;
  }

  async function clicar(vista, comando, sinal) {
    const alvo = comando.ref !== undefined ? { ref: comando.ref } : { texto: comando.texto };
    const achado = await localizar(vista, alvo, sinal);
    if (achado.lista) {
      throw new ErroDoNavegadorDoAgente(
        "falhou",
        "Para escolher uma opção de uma lista, use navegador_digitar com o ref da lista e o texto da opção.",
      );
    }
    await mouseClicar(vista, achado.x, achado.y);
    await aguardarAposAcao(vista, sinal);
    return { mensagem: `Cliquei em ${achado.descricao}.${achado.aviso ? ` ${achado.aviso}` : ""}` };
  }

  async function apertarTecla(vista, nome) {
    const tecla = resolverTecla(nome);
    const base = {
      key: tecla.key,
      code: tecla.code,
      windowsVirtualKeyCode: tecla.vk,
      nativeVirtualKeyCode: tecla.vk,
      modifiers: tecla.modifiers,
    };
    await cdp(vista, "Input.dispatchKeyEvent", {
      type: tecla.text ? "keyDown" : "rawKeyDown",
      ...base,
      ...(tecla.text ? { text: tecla.text, unmodifiedText: tecla.text } : {}),
      ...(tecla.commands.length > 0 ? { commands: tecla.commands } : {}),
    });
    await cdp(vista, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  async function digitar(vista, comando, sinal) {
    let destino = "no campo em foco";
    if (comando.ref !== undefined) {
      const achado = await localizar(vista, { ref: comando.ref }, sinal);
      destino = `em ${achado.descricao}`;
      if (achado.lista) {
        const escolha = await avaliar(vista, expressaoDaPagina("escolherOpcao", comando.ref, comando.texto), sinal);
        if (!escolha.ok) throw new ErroDoNavegadorDoAgente("falhou", escolha.erro);
        await aguardarAposAcao(vista, sinal);
        return { mensagem: `Escolhi a opção "${escolha.escolhida}" em ${achado.descricao}.` };
      }
      await mouseClicar(vista, achado.x, achado.y);
      await dormir(vista, 100, sinal);
      // Com `ref` o texto substitui o que já estava no campo.
      await avaliar(vista, expressaoDaPagina("selecionarConteudo"), sinal);
    }
    let aviso = "";
    if (comando.ref === undefined) {
      const foco = await avaliar(vista, expressaoDaPagina("focoAtual"), sinal);
      if (foco === "") aviso = " Nenhum campo estava em foco: o texto pode não ter ido a lugar nenhum; use o ref do campo.";
    }
    if (comando.texto !== "") await cdp(vista, "Input.insertText", { text: comando.texto });
    if (comando.enviar) {
      await apertarTecla(vista, "Enter");
      await aguardarAposAcao(vista, sinal);
    } else {
      await aguardarEstabilidade(vista, sinal);
    }
    const quantos = comando.texto.length;
    return { mensagem: `Digitei ${quantos} caractere${quantos === 1 ? "" : "s"} ${destino}${comando.enviar ? " e enviei (Enter)" : ""}.${aviso}` };
  }

  async function tecla(vista, comando, sinal) {
    await apertarTecla(vista, comando.nome);
    await aguardarAposAcao(vista, sinal);
    return { mensagem: `Apertei ${comando.nome}.` };
  }

  async function rolar(vista, comando, sinal) {
    const metricas = await cdp(vista, "Page.getLayoutMetrics");
    const largura = metricas.cssVisualViewport.clientWidth;
    const altura = metricas.cssVisualViewport.clientHeight;
    const zoom = vista.view.webContents.getZoomFactor() || 1;
    const vertical = comando.direcao === "cima" || comando.direcao === "baixo";
    const sinalDoPasso = comando.direcao === "cima" || comando.direcao === "esquerda" ? -1 : 1;
    const eixo = vertical ? "y" : "x";
    const antes = await avaliar(vista, expressaoDaPagina("posicaoDaRolagem"), sinal);
    let anterior = antes;
    let restante = comando.quantidade;
    while (restante > 0) {
      const tela = Math.min(1, restante);
      restante -= tela;
      // O delta da roda é em pixels da janela (DIP): em CSS, divide-se pelo zoom.
      const delta = sinalDoPasso * tela * 0.85 * (vertical ? altura : largura) * zoom;
      await cdp(vista, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: largura / 2,
        y: altura / 2,
        deltaX: vertical ? 0 : delta,
        deltaY: vertical ? delta : 0,
      });
      await dormir(vista, t.rolagemMs, sinal);
      if (restante <= 0) break;
      // Chegou ao limite da página: o resto da rolagem seria em vão.
      const atual = await avaliar(vista, expressaoDaPagina("posicaoDaRolagem"), sinal);
      if (atual[eixo] === anterior[eixo]) break;
      anterior = atual;
    }
    await aguardarEstabilidade(vista, sinal);
    const depois = await avaliar(vista, expressaoDaPagina("posicaoDaRolagem"), sinal);
    const maximo = vertical ? depois.maxY : depois.maxX;
    const onde = `${vertical ? "vertical" : "horizontal"} ${depois[eixo]} de ${maximo} px`;
    if (depois[eixo] === antes[eixo]) {
      return { mensagem: `A página já está no limite para ${comando.direcao} (posição ${onde}).` };
    }
    return { mensagem: `Rolei para ${comando.direcao} (posição ${onde}).` };
  }

  /**
   * Foto da área visível da página, em JPEG, com no máximo `larguraMaxima` pixels de largura. Sai no
   * layout (CSS) da página, qualquer que seja o zoom ou o tamanho do nó do canvas.
   */
  async function capturar(vista, { larguraMaxima, qualidade }, sinal) {
    const metricas = await cdp(vista, "Page.getLayoutMetrics");
    const visual = metricas.cssVisualViewport;
    let escalaDoDisplay = 1;
    try {
      const razao = await avaliar(vista, "devicePixelRatio", sinal);
      const zoom = vista.view.webContents.getZoomFactor() || 1;
      if (typeof razao === "number" && razao > 0) escalaDoDisplay = razao / zoom;
    } catch {
      /* sem a razão, a imagem pode passar da largura pedida */
    }
    const escala = Math.min(1, larguraMaxima / (visual.clientWidth * escalaDoDisplay));
    // Com a janela do app nunca mostrada, o Chromium não entrega o quadro e a captura não termina.
    const tirar = cdp(vista, "Page.captureScreenshot", {
      format: "jpeg",
      quality: qualidade,
      clip: { x: visual.pageX, y: visual.pageY, width: visual.clientWidth, height: visual.clientHeight, scale: escala },
    });
    const limite = new Promise((resolver) => setTimeout(() => resolver(null), t.capturaMs));
    const captura = await Promise.race([tirar, limite]);
    if (captura === null || !captura.data) {
      throw new ErroDoNavegadorDoAgente(
        "tempo_esgotado",
        "Não consegui capturar a tela: a janela do aplicativo está oculta. Abra o aplicativo e tente de novo.",
      );
    }
    return { base64: captura.data, tipoDeMidia: "image/jpeg" };
  }

  async function capturarTela(vista, sinal) {
    const imagem = await capturar(vista, { larguraMaxima: LARGURA_MAXIMA_DA_CAPTURA, qualidade: 80 }, sinal);
    return { mensagem: "Captura da tela.", imagem };
  }

  async function navegarNoHistorico(vista, direcao, sinal) {
    const historico = vista.view.webContents.navigationHistory;
    if (direcao === "voltar") {
      if (!historico.canGoBack()) throw new ErroDoNavegadorDoAgente("falhou", "Não há página anterior no histórico.");
      historico.goBack();
    } else {
      if (!historico.canGoForward()) throw new ErroDoNavegadorDoAgente("falhou", "Não há página seguinte no histórico.");
      historico.goForward();
    }
    await aguardarAposAcao(vista, sinal);
    return { mensagem: direcao === "voltar" ? "Voltei uma página." : "Avancei uma página." };
  }

  async function recarregar(vista, sinal) {
    vista.view.webContents.reload();
    await aguardarAposAcao(vista, sinal);
    return { mensagem: "Página recarregada." };
  }

  async function esperar(vista, comando, sinal) {
    if (comando.ms !== undefined) {
      await dormir(vista, comando.ms, sinal);
      return { mensagem: `Esperei ${comando.ms} ms.` };
    }
    const fim = Date.now() + t.textoMs;
    while (Date.now() < fim) {
      if (await avaliar(vista, expressaoDaPagina("contemTexto", comando.texto), sinal)) {
        return { mensagem: `O texto "${cortar(comando.texto, 60)}" apareceu na página.` };
      }
      await dormir(vista, t.sondagemMs, sinal);
    }
    throw new ErroDoNavegadorDoAgente(
      "tempo_esgotado",
      `O texto "${cortar(comando.texto, 60)}" não apareceu em ${Math.round(t.textoMs / 1000)} segundos.`,
    );
  }

  async function despachar(vista, comando, sinal) {
    switch (comando.tipo) {
      case "abrir":
        return abrir(vista, comando.url, sinal);
      case "ler_pagina":
        return lerPagina(vista, sinal);
      case "clicar":
        return clicar(vista, comando, sinal);
      case "digitar":
        return digitar(vista, comando, sinal);
      case "tecla":
        return tecla(vista, comando, sinal);
      case "rolar":
        return rolar(vista, comando, sinal);
      case "capturar_tela":
        return capturarTela(vista, sinal);
      case "voltar":
        return navegarNoHistorico(vista, "voltar", sinal);
      case "avancar":
        return navegarNoHistorico(vista, "avancar", sinal);
      case "recarregar":
        return recarregar(vista, sinal);
      case "esperar":
        return esperar(vista, comando, sinal);
      default:
        throw erroDoComando("Comando do navegador desconhecido.");
    }
  }

  /** Erro qualquer vira ErroDoNavegadorDoAgente (a mensagem do Electron/CDP não vai crua ao agente). */
  function normalizarErro(erro) {
    if (erro instanceof ErroDoNavegadorDoAgente) return erro;
    registrar(`Falha inesperada no navegador do agente: ${erro?.message ?? erro}`);
    return new ErroDoNavegadorDoAgente("falhou", `Falha no navegador: ${cortar(String(erro?.message ?? erro), 200)}`);
  }

  /**
   * Executa um comando no navegador do Orquestrador (criando a vista na primeira vez). Um comando por vez
   * por Orquestrador. Resolve com { url, titulo, mensagem, pagina?, imagem? } ou lança
   * ErroDoNavegadorDoAgente ({ motivo, message }).
   *
   * @param {{ orquestradorId: string, comando: object, sinal?: AbortSignal }} pedido
   */
  async function executarComando({ orquestradorId, comando, sinal }) {
    const id = validarId(orquestradorId);
    if (id === null) throw erroDoComando("Orquestrador inválido para o navegador.");
    const validado = validarComando(comando);
    if (pausados.has(id)) throw new ErroDoNavegadorDoAgente("pausado", MENSAGEM_PAUSADO);
    const vista = obterOuCriarVista(id);

    // Um controlador por comando: o aborto de quem pediu ou o pausar do usuário o encerram.
    const controlador = new AbortController();
    vista.controladores.add(controlador);
    const aoAbortarOPedido = () => controlador.abort();
    if (sinal) {
      if (sinal.aborted) controlador.abort();
      else sinal.addEventListener("abort", aoAbortarOPedido, { once: true });
    }

    const anterior = vista.fila;
    let liberar;
    vista.fila = new Promise((resolver) => {
      liberar = resolver;
    });
    try {
      await anterior;
      if (controlador.signal.aborted) throw erroDeAborto(vista);
      if (pausados.has(id)) throw new ErroDoNavegadorDoAgente("pausado", MENSAGEM_PAUSADO);
      vista.emUso += 1;
      vista.ultimaAcao = descreverComando(validado);
      avisarMudanca(vista);
      // Só a origem da página atual (e nunca o que foi digitado): é o rastro do que o agente fez.
      const paginaAtual = vista.view.webContents.getURL();
      registrar(`Orquestrador ${curto(id)}: ${validado.tipo} (${paginaAtual ? origemParaLog(paginaAtual) : "sem página"})`);
      try {
        const parcial = await despachar(vista, validado, controlador.signal);
        const conteudo = vista.view.webContents;
        const avisos = vista.avisos.splice(0);
        const mensagem = [parcial.mensagem, ...avisos].filter(Boolean).join(" ");
        vista.ultimaAcao = parcial.mensagem;
        return {
          url: conteudo.getURL(),
          titulo: conteudo.getTitle(),
          mensagem,
          ...(parcial.pagina ? { pagina: parcial.pagina } : {}),
          ...(parcial.imagem ? { imagem: parcial.imagem } : {}),
        };
      } catch (erro) {
        const normalizado = normalizarErro(erro);
        vista.ultimaAcao = `Falhou: ${normalizado.message}`;
        throw normalizado;
      } finally {
        vista.emUso -= 1;
        avisarMudanca(vista);
      }
    } finally {
      vista.controladores.delete(controlador);
      if (sinal) sinal.removeEventListener("abort", aoAbortarOPedido);
      liberar();
    }
  }

  // ───────────────────────── IPC da tela ─────────────────────────

  function vistaDoPedido(dados) {
    const id = validarId(dados?.orquestradorId);
    return id === null ? undefined : vistas.get(id);
  }

  /** posicionar({ orquestradorId, retangulo }): acompanha o corpo do nó na tela (enviado a cada quadro em que muda). */
  function aoPosicionar(evento, dados) {
    if (!eDaJanelaPrincipal(evento)) return;
    const vista = vistaDoPedido(dados);
    const retangulo = validarRetangulo(dados?.retangulo);
    if (!vista || retangulo === null) return;
    vista.retangulo = retangulo;
    if (vista.mostrando) aplicar(vista);
  }

  /** mostrar({ orquestradorId, retangulo }): põe a vista sobre o nó do canvas. Resolve false se recusou. */
  function aoMostrar(evento, dados) {
    exigirPrincipal(evento);
    const vista = vistaDoPedido(dados);
    const retangulo = validarRetangulo(dados?.retangulo);
    if (!vista || retangulo === null || bloqueada()) return false;
    vista.retangulo = retangulo;
    vista.mostrando = true;
    aplicar(vista);
    return true;
  }

  /** ocultar({ orquestradorId }): devolve a vista para baixo da tela, ainda pintando. */
  function aoOcultar(evento, dados) {
    exigirPrincipal(evento);
    const vista = vistaDoPedido(dados);
    if (!vista) return false;
    vista.mostrando = false;
    aplicar(vista);
    return true;
  }

  function aoPausar(evento, dados) {
    exigirPrincipal(evento);
    const id = validarId(dados?.orquestradorId);
    if (id === null) return false;
    pausados.add(id);
    const vista = vistas.get(id);
    if (vista) {
      // O comando em andamento termina agora, com o erro de "pausado".
      for (const controlador of vista.controladores) controlador.abort();
      // O teclado passa a ir para a página (o usuário vai usá-la).
      if (vista.mostrando && !vista.view.webContents.isDestroyed()) vista.view.webContents.focus();
      avisarMudanca(vista);
    }
    return true;
  }

  function aoRetomar(evento, dados) {
    exigirPrincipal(evento);
    const id = validarId(dados?.orquestradorId);
    if (id === null) return false;
    pausados.delete(id);
    const vista = vistas.get(id);
    if (vista) avisarMudanca(vista);
    return true;
  }

  /** fechar({ orquestradorId, apagarDados? }): fecha a vista; com `apagarDados`, apaga também o login e o armazenamento da sessão. */
  async function aoFechar(evento, dados) {
    exigirPrincipal(evento);
    const id = validarId(dados?.orquestradorId);
    if (id === null) return false;
    fecharVista(id);
    pausados.delete(id);
    if (dados.apagarDados === true) {
      const sessao = session.fromPartition(particaoDoOrquestrador(id));
      await sessao.clearStorageData();
      await sessao.clearCache();
      await sessao.clearAuthCache();
      registrar(`Dados do navegador do orquestrador ${curto(id)} apagados.`);
    }
    return true;
  }

  /**
   * O usuário navega pelos botões do nó (voltar, avançar e recarregar), com o agente pausado. Vai direto ao
   * histórico da página, sem passar pela fila de comandos do agente. Resolve false se não há navegador aberto
   * ou, no voltar e no avançar, não há para onde ir.
   */
  function navegarPeloUsuario(evento, dados, acao) {
    exigirPrincipal(evento);
    const vista = vistaDoPedido(dados);
    if (!vista || vista.view.webContents.isDestroyed()) return false;
    const conteudo = vista.view.webContents;
    const historico = conteudo.navigationHistory;
    if (acao === "voltar") {
      if (!historico.canGoBack()) return false;
      historico.goBack();
    } else if (acao === "avancar") {
      if (!historico.canGoForward()) return false;
      historico.goForward();
    } else {
      conteudo.reload();
    }
    registrar(`Orquestrador ${curto(vista.id)}: o usuário usou ${acao} no navegador.`);
    avisarMudanca(vista);
    return true;
  }

  /** voltar({ orquestradorId }): o usuário volta uma página. */
  const aoVoltar = (evento, dados) => navegarPeloUsuario(evento, dados, "voltar");
  /** avancar({ orquestradorId }): o usuário avança uma página (depois de voltar). */
  const aoAvancar = (evento, dados) => navegarPeloUsuario(evento, dados, "avancar");
  /** recarregar({ orquestradorId }): o usuário recarrega a página. */
  const aoRecarregar = (evento, dados) => navegarPeloUsuario(evento, dados, "recarregar");

  /** estados(): o estado de cada navegador aberto (a tela pede ao carregar, para reabrir os nós). */
  function aoPedirEstados(evento) {
    exigirPrincipal(evento);
    return [...vistas.values()].map(estadoDaVista);
  }

  /** foto({ orquestradorId }): data URI JPEG da página (para o nó mostrar enquanto a vista nativa está por baixo), ou null. */
  async function aoPedirFoto(evento, dados) {
    exigirPrincipal(evento);
    const vista = vistaDoPedido(dados);
    if (!vista) return null;
    try {
      const imagem = await capturar(vista, { larguraMaxima: LARGURA_MAXIMA_DA_FOTO, qualidade: 70 }, new AbortController().signal);
      return `data:${imagem.tipoDeMidia};base64,${imagem.base64}`;
    } catch (erro) {
      registrar(`Falha ao fotografar o navegador ${curto(vista.id)}: ${erro.message || erro}`);
      return null;
    }
  }

  // ───────────────────────── ponte com o servidor ─────────────────────────

  /**
   * Atende o servidor (utilityProcess `filho`): `{ tipo: "navegador:comando", id, orquestradorId, comando }` vira
   * `executarComando` e a resposta volta como `{ tipo: "navegador:resposta", id, ok: true, resultado }` ou
   * `{ ..., ok: false, erro: { motivo, mensagem } }`; `{ tipo: "navegador:cancelar", id }` aborta o comando.
   * Chamar a cada servidor novo (ele religa sozinho): os comandos em andamento de um servidor que saiu são abortados.
   */
  function ligarAoServidor(filho) {
    const emAndamento = new Map();
    const responder = (id, corpo) => {
      emAndamento.delete(id);
      try {
        filho.postMessage({ tipo: "navegador:resposta", id, ...corpo });
      } catch {
        /* o servidor já saiu */
      }
    };
    filho.on("message", (mensagem) => {
      if (mensagem === null || typeof mensagem !== "object" || typeof mensagem.id !== "string") return;
      const { id } = mensagem;
      if (mensagem.tipo === "navegador:cancelar") {
        emAndamento.get(id)?.abort();
        return;
      }
      if (mensagem.tipo !== "navegador:comando") return;
      const controlador = new AbortController();
      emAndamento.set(id, controlador);
      executarComando({ orquestradorId: mensagem.orquestradorId, comando: mensagem.comando, sinal: controlador.signal }).then(
        (resultado) => responder(id, { ok: true, resultado }),
        (erro) => {
          const conhecido = erro instanceof ErroDoNavegadorDoAgente;
          if (!conhecido) registrar(`Falha inesperada ao executar um comando do navegador: ${erro?.message ?? erro}`);
          responder(id, {
            ok: false,
            erro: { motivo: conhecido ? erro.motivo : "falhou", mensagem: conhecido ? erro.message : "O navegador do agente falhou." },
          });
        },
      );
    });
    filho.once("exit", () => {
      for (const controlador of emAndamento.values()) controlador.abort();
      emAndamento.clear();
    });
  }

  /** Liga as vistas à janela principal: a tela recarregou, as vistas descem; a janela fechou, elas caem. */
  function anexar(janela) {
    janela.on("closed", destruirTodas);
    janela.webContents.on("did-start-navigation", (detalhes) => {
      if (detalhes.isMainFrame && !detalhes.isSameDocument) ocultarTodas();
    });
    janela.webContents.on("render-process-gone", ocultarTodas);
  }

  function ocultarTodas() {
    for (const vista of vistas.values()) {
      vista.mostrando = false;
      aplicar(vista);
    }
  }

  /** O modo invisível ligou ou desligou: o que estava mostrado desce para fora da janela (ou volta a poder subir). */
  function reaplicarTodas() {
    if (bloqueada()) {
      for (const vista of vistas.values()) vista.mostrando = false;
    }
    for (const vista of vistas.values()) aplicar(vista);
  }

  return {
    executarComando,
    ligarAoServidor,
    aoPosicionar,
    aoMostrar,
    aoOcultar,
    aoPausar,
    aoRetomar,
    aoVoltar,
    aoAvancar,
    aoRecarregar,
    aoFechar,
    aoPedirEstados,
    aoPedirFoto,
    anexar,
    ocultarTodas,
    reaplicarTodas,
    destruirTodas,
    total: () => vistas.size,
  };
}

module.exports = {
  PREFIXO_DA_PARTICAO,
  LIMITE_DE_VISTAS,
  LIMITES_OCULTOS,
  RAIO_OCULTO,
  MENSAGEM_PAUSADO,
  ErroDoNavegadorDoAgente,
  particaoDoOrquestrador,
  enderecoPermitido,
  navegacaoPermitida,
  resolverTecla,
  validarComando,
  descreverComando,
  expressaoDaPagina,
  criarNavegadorDoAgente,
};
