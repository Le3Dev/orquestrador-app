"use strict";

// Vista nativa da Prévia: endereços externos (Google Sheets, Docs, Notion...)
// abrem num WebContentsView do Electron, com sessão persistente própria
// (`persist:previa`), para o login ficar salvo. O iframe da tela não serve para
// eles: é `credentialless` (sem cookies) e esses sites recusam iframe
// (`X-Frame-Options`). Endereços locais (localhost e rede interna) seguem no
// iframe da tela.
//
// Como a vista acompanha o nó do canvas: o WebContentsView é nativo e fica por
// cima do DOM, então a tela (web/src/componentes/canvas/VistaNativaDaPrevia.tsx)
// só o mostra enquanto a prévia está "ativa" (o usuário clicou nela) e manda o
// retângulo do corpo da prévia a cada quadro. Inativa, a tela mostra no lugar
// a última foto da página (tirada ao desativar, com a vista visível) e a roda e a pinça seguem movendo o canvas.
// A vista é escondida quando a prévia desativa (clique fora, minimizada, fora da
// tela, coberta por painel ou menu), quando a janela minimiza ou esconde e no
// modo invisível; é destruída ao fechar a prévia, ao recarregar a tela e ao
// fechar a janela.
//
// Segurança da vista: sem preload, nodeIntegration desligado, contextIsolation e
// sandbox ligados, sessão própria separada da tela do app (que guarda o cookie
// de acesso ao servidor local), janelas novas negadas (links http/https vão para
// o navegador do sistema, só de vista ativa com a janela em foco e com teto por
// vista), permissões negadas (só colar/copiar pelo clipboard sanitizado é
// liberado), navegação só http/https e nunca para endereço local (também
// cancelado na sessão, pedido a pedido), downloads só da vista ativa e um por vez.
// A tela mostra o host real e atual da página (evento `estado`, só a origem) e se dá
// para voltar e avançar (`podeVoltar` e `podeAvancar`, do histórico da própria vista).
// Os IPC só valem se vierem do quadro principal da janela principal e têm todos
// os campos validados aqui.

const PARTICAO = "persist:previa";

/** As vistas abertas ao mesmo tempo: cada uma é um processo de renderização. */
const LIMITE_DE_VISTAS = 12;

const TAMANHO_MAXIMO_DA_URL = 2048;
const PADRAO_DO_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Os limites do zoom da página (o do Chromium vai de 0.25 a 5). */
const ZOOM_MINIMO_DA_PAGINA = 0.25;
const ZOOM_MAXIMO_DA_PAGINA = 5;

/** Largura máxima da foto que a tela mostra enquanto a prévia está inativa. */
const LARGURA_MAXIMA_DA_FOTO = 1000;
const ESPERA_MAXIMA_DA_FOTO_MS = 1500;

/** Entre dois links que a página manda abrir no navegador do sistema (contra spam de abas), em todas as vistas. */
const INTERVALO_ENTRE_ABERTURAS_MS = 1000;

/** Por vista: no máximo tantos links abertos no navegador do sistema por janela de tempo. */
const ABERTURAS_POR_VISTA = 5;
const JANELA_DAS_ABERTURAS_MS = 60_000;

/** Espera máxima para a vista largar a página (about:blank) antes de limpar a sessão. */
const ESPERA_MAXIMA_DO_ABOUT_BLANK_MS = 3000;

/** Pedidos de permissão que a página pode receber: só copiar e colar pelo teclado e menu da própria página. */
const PERMISSOES_LIBERADAS = new Set(["clipboard-sanitized-write"]);

// ──────────────────────────────────────────────────────────────────────────
// Funções puras (testadas sem Electron).
// ──────────────────────────────────────────────────────────────────────────

/** O IPv4 (a.b.c) é da máquina, da rede interna, compartilhado (CGNAT), reservado ou multicast? */
function ipv4EhLocal(a, b, c) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Os 8 grupos de 16 bits de um IPv6 (aceita "::" e IPv4 no final), ou nulo se não for um IPv6 válido. */
function gruposDoIpv6(host) {
  let texto = host;
  const comPontos = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(texto);
  if (comPontos) {
    const [, inicio, a, b, c, d] = comPontos;
    texto = `${inicio}${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`;
  }
  const partes = texto.split("::");
  if (partes.length > 2) return null;
  const separar = (trecho) => (trecho === "" ? [] : trecho.split(":"));
  const antes = separar(partes[0]);
  const depois = partes.length === 2 ? separar(partes[1]) : [];
  const faltam = 8 - antes.length - depois.length;
  if (partes.length === 2 ? faltam < 1 : faltam !== 0) return null;
  const grupos = [...antes, ...new Array(partes.length === 2 ? faltam : 0).fill("0"), ...depois].map((grupo) =>
    /^[0-9a-f]{1,4}$/.test(grupo) ? parseInt(grupo, 16) : Number.NaN,
  );
  return grupos.some(Number.isNaN) ? null : grupos;
}

/** O host (sem colchetes, em minúsculas) é da máquina ou da rede interna? A mesma regra está em web/src/shared/previaNativa.ts. */
function ehHostLocal(hostBruto) {
  const host = String(hostBruto).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "" || host === "localhost") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) return ipv4EhLocal(Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3]));
  if (host.includes(":")) {
    // IPv6. Inválido conta como local (recusa).
    const g = gruposDoIpv6(host);
    if (g === null) return true;
    const zeros = (...grupos) => grupos.every((grupo) => grupo === 0);
    // O IPv4 embutido nos dois grupos a partir de `i` (o terceiro octeto vem do grupo seguinte).
    const v4Local = (i) => ipv4EhLocal(g[i] >> 8, g[i] & 255, g[i + 1] >> 8);
    return (
      zeros(g[0], g[1], g[2], g[3], g[4], g[5]) || // ::/96 (inclui ::, ::1 e IPv4 compatível)
      (zeros(g[0], g[1], g[2], g[3], g[4]) && g[5] === 0xffff) || // ::ffff:0:0/96 (IPv4 mapeado)
      (g[0] === 0x64 && g[1] === 0xff9b && zeros(g[2], g[3], g[4], g[5]) && v4Local(6)) || // 64:ff9b::/96 (NAT64)
      (g[0] === 0x2002 && v4Local(1)) || // 2002::/16 (6to4)
      (g[0] & 0xfe00) === 0xfc00 || // fc00::/7 (local único)
      (g[0] & 0xffc0) === 0xfe80 || // fe80::/10 (link-local)
      (g[0] & 0xff00) === 0xff00 // ff00::/8 (multicast)
    );
  }
  return (
    !host.includes(".") || // nome de uma palavra só: resolvido pela rede interna
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".internal") ||
    host.endsWith(".corp") ||
    host === "home.arpa" ||
    host.endsWith(".home.arpa")
  );
}

/** O pedido (qualquer http, https, ws ou wss) aponta para um host literal local? Reforço da sessão da prévia. */
function pedidoParaHostLocal(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return /^(https?|wss?):$/.test(protocol) && ehHostLocal(hostname);
  } catch {
    return false;
  }
}

/** Só protocolo e host (com porta, se houver) do endereço http/https; nulo para o resto. Nunca caminho, query nem fragmento. */
function origemDaPagina(url) {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * O endereço normalizado se for http/https, sem usuário e senha, e NÃO local;
 * nulo para todo o resto (esquemas como file:, javascript:, data:, endereços da
 * máquina, texto que não é URL).
 */
function validarEnderecoExterno(bruto) {
  if (typeof bruto !== "string" || bruto.length === 0 || bruto.length > TAMANHO_MAXIMO_DA_URL) return null;
  let url;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (ehHostLocal(url.hostname)) return null;
  return url.href;
}

function validarId(id) {
  return typeof id === "string" && PADRAO_DO_ID.test(id) ? id : null;
}

function numeroEntre(valor, minimo, maximo) {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= minimo && valor <= maximo;
}

/**
 * O retângulo que a tela manda: { x, y, largura, altura, zoom } em pixels CSS
 * da tela (zoom = escala do canvas). Devolve uma cópia só com esses campos, ou
 * nulo se faltar algum ou estiver fora de faixa.
 */
function validarRetangulo(bruto) {
  if (bruto === null || typeof bruto !== "object") return null;
  const { x, y, largura, altura, zoom } = bruto;
  if (
    !numeroEntre(x, -100_000, 100_000) ||
    !numeroEntre(y, -100_000, 100_000) ||
    !numeroEntre(largura, 1, 20_000) ||
    !numeroEntre(altura, 1, 20_000) ||
    !numeroEntre(zoom, 0.05, 10)
  ) {
    return null;
  }
  return { x, y, largura, altura, zoom };
}

function limitar(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

/**
 * Do retângulo da tela (pixels CSS) aos limites da vista (pixels da janela) e
 * ao zoom da página. `zoomDaJanela` é o zoom da própria tela do app (Cmd/Ctrl
 * + e -), que escala os pixels CSS. A vista nunca passa da área da janela.
 * Nulo se sobrar menos de 1 pixel.
 */
function calcularLimites(retangulo, zoomDaJanela, areaDaJanela) {
  const escala = Number.isFinite(zoomDaJanela) && zoomDaJanela > 0 ? zoomDaJanela : 1;
  const esquerda = limitar(Math.round(retangulo.x * escala), 0, areaDaJanela.largura);
  const topo = limitar(Math.round(retangulo.y * escala), 0, areaDaJanela.altura);
  const direita = limitar(Math.round((retangulo.x + retangulo.largura) * escala), 0, areaDaJanela.largura);
  const base = limitar(Math.round((retangulo.y + retangulo.altura) * escala), 0, areaDaJanela.altura);
  if (direita - esquerda < 1 || base - topo < 1) return null;
  return {
    bounds: { x: esquerda, y: topo, width: direita - esquerda, height: base - topo },
    zoomDaPagina: limitar(retangulo.zoom * escala, ZOOM_MINIMO_DA_PAGINA, ZOOM_MAXIMO_DA_PAGINA),
  };
}

/**
 * A navegação que a página pode fazer: o quadro principal só vai para
 * http/https externo; quadros internos (anúncios, pagamentos, login) também
 * podem ser about:blank, blob: e data:, mas nunca para um esquema de arquivo ou
 * de aplicativo nem para o computador local.
 */
function navegacaoPermitida(url, ehQuadroPrincipal) {
  if (validarEnderecoExterno(url) !== null) return true;
  if (ehQuadroPrincipal) return false;
  return /^(about:blank|blob:|data:)/i.test(String(url));
}

/**
 * "Sair das contas" larga a página (about:blank) antes de limpar a sessão, e esse about:blank fica no
 * começo do histórico: voltar levaria a uma página em branco. Tira a entrada, se houver e não for a atual.
 */
function descartarAboutBlankDoInicio(historico) {
  if (historico.length() > 1 && historico.getActiveIndex() > 0 && /^about:blank/i.test(historico.getEntryAtIndex(0)?.url ?? "")) {
    historico.removeEntryAtIndex(0);
  }
}

/** Para o log: só a origem (protocolo e host). O caminho e a query podem carregar token ou dado pessoal. */
function origemParaLog(url) {
  try {
    const { protocol, origin } = new URL(String(url));
    return origin !== "null" ? origin : `${protocol} (sem origem)`;
  } catch {
    return "(endereço inválido)";
  }
}

/** Só o clipboard sanitizado de escrita; câmera, microfone, notificações, localização etc. ficam negados. */
function permissaoLiberada(permissao) {
  return PERMISSOES_LIBERADAS.has(permissao);
}

/** O user agent sem as marcas "Electron/x" e do app: o Google recusa o login em navegadores embutidos que se identificam assim. */
function userAgentDeNavegador(userAgent, nomeDoApp) {
  let limpo = String(userAgent).replace(/\s*Electron\/\S+/gi, "");
  if (nomeDoApp) {
    const escapado = String(nomeDoApp).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    limpo = limpo.replace(new RegExp(`\\s*${escapado}\\/\\S+`, "gi"), "");
  }
  return limpo;
}

// ──────────────────────────────────────────────────────────────────────────
// Serviço (Electron injetado, para testar com falsos).
// ──────────────────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {Function} deps.WebContentsView classe do Electron
 * @param {object} deps.session módulo `session` do Electron
 * @param {object} deps.shell módulo `shell` do Electron
 * @param {() => object | null} deps.janelaPrincipal a BrowserWindow principal (ou nulo)
 * @param {(evento: object) => boolean} deps.eDaJanelaPrincipal o IPC veio do quadro principal da janela principal?
 * @param {() => boolean} deps.bloqueada a prévia não pode ativar agora (modo invisível)?
 * @param {string} [deps.nomeDoApp] nome do app no user agent, a remover
 * @param {(texto: string) => void} [deps.registrar]
 */
function criarVistasDaPrevia({
  WebContentsView,
  session,
  shell,
  janelaPrincipal,
  eDaJanelaPrincipal,
  bloqueada,
  nomeDoApp,
  registrar = () => undefined,
}) {
  /** id -> { view, url, ativa, retangulo, pedido, aberturas } */
  const vistas = new Map();
  let sessaoPronta = null;
  let ultimaAbertura = 0;
  /** Quantos downloads estão em andamento (só um por vez). */
  let baixando = 0;
  /** Sobe a cada "sair das contas": uma foto tirada antes dele não vale mais. */
  let geracaoDaSessao = 0;

  function sessaoDaPrevia() {
    if (sessaoPronta) return sessaoPronta;
    const sessao = session.fromPartition(PARTICAO);
    sessao.setUserAgent(userAgentDeNavegador(sessao.getUserAgent(), nomeDoApp));
    // Tudo negado, menos o que está em PERMISSOES_LIBERADAS.
    sessao.setPermissionRequestHandler((_contents, permissao, retorno) => retorno(permissaoLiberada(permissao)));
    sessao.setPermissionCheckHandler((_contents, permissao) => permissaoLiberada(permissao));
    // USB, serial, HID e Bluetooth: nenhum dispositivo.
    if (typeof sessao.setDevicePermissionHandler === "function") sessao.setDevicePermissionHandler(() => false);
    // Reforço: pedido para host literal local (localhost, IP da máquina ou da rede interna) é cancelado,
    // mesmo vindo de uma página externa (subrecursos, fetch, WebSocket). Nomes públicos que resolvem para
    // IP local não são pegos aqui.
    sessao.webRequest.onBeforeRequest((detalhes, retorno) => {
      const local = pedidoParaHostLocal(detalhes.url);
      if (local) registrar(`Pedido a endereço local cancelado: ${origemParaLog(detalhes.url)}`);
      retorno({ cancel: local });
    });
    // Downloads: só da vista que está ativa (o usuário clicou nela) e um por vez.
    sessao.on("will-download", (evento, item, conteudo) => {
      const ativa = [...vistas.values()].some((vista) => vista.ativa && vista.view.webContents === conteudo);
      if (!ativa || baixando > 0) {
        evento.preventDefault();
        registrar(`Download cancelado (${ativa ? "já há um em andamento" : "vista não está ativa"}).`);
        return;
      }
      baixando += 1;
      item.once("done", () => {
        baixando = Math.max(0, baixando - 1);
      });
    });
    sessaoPronta = sessao;
    return sessao;
  }

  function janelaValida() {
    const janela = janelaPrincipal();
    return janela && !janela.isDestroyed() && !janela.webContents.isDestroyed() ? janela : null;
  }

  function avisar(evento) {
    const janela = janelaValida();
    if (janela) janela.webContents.send("previa:evento", evento);
  }

  function exigirPrincipal(evento) {
    if (!eDaJanelaPrincipal(evento)) throw new Error("Operação permitida só na janela principal.");
  }

  /**
   * Link que a página pediu para abrir numa janela nova. Só vale se a vista que pediu estiver ativa (o
   * usuário está usando a página) e a janela do app com foco; além do intervalo global, cada vista tem
   * um teto por minuto. Vista escondida não abre nada.
   */
  function abrirNoNavegadorDoSistema(id, url) {
    const vista = vistas.get(id);
    const janela = janelaValida();
    if (!vista || !vista.ativa || !janela || !janela.isFocused()) return;
    // Só http/https e nunca endereço local (a mesma regra da navegação).
    if (validarEnderecoExterno(url) === null) return;
    const agora = Date.now();
    if (agora - ultimaAbertura < INTERVALO_ENTRE_ABERTURAS_MS) return;
    vista.aberturas = vista.aberturas.filter((instante) => agora - instante < JANELA_DAS_ABERTURAS_MS);
    if (vista.aberturas.length >= ABERTURAS_POR_VISTA) return;
    vista.aberturas.push(agora);
    ultimaAbertura = agora;
    shell.openExternal(url);
  }

  /**
   * Fotografa a vista, que precisa estar visível (ativa): escondida, a captura volta vazia.
   * Por isso a foto sai ao desativar, e a prévia que nunca foi usada ainda não tem foto.
   */
  async function tirarFoto(id) {
    const vista = vistas.get(id);
    if (!vista || !vista.ativa || vista.view.webContents.isDestroyed()) return;
    const geracao = geracaoDaSessao;
    try {
      // Com limite de tempo: numa janela minimizada a captura pode nunca terminar.
      let imagem = await Promise.race([
        vista.view.webContents.capturePage(),
        new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("tempo esgotado")), ESPERA_MAXIMA_DA_FOTO_MS)),
      ]);
      if (imagem.isEmpty() || geracao !== geracaoDaSessao) return;
      const { width } = imagem.getSize();
      if (width > LARGURA_MAXIMA_DA_FOTO) imagem = imagem.resize({ width: LARGURA_MAXIMA_DA_FOTO });
      avisar({ tipo: "foto", id, foto: `data:image/jpeg;base64,${imagem.toJPEG(70).toString("base64")}` });
    } catch (erro) {
      registrar(`Falha ao fotografar a prévia ${id}: ${erro.message || erro}`);
    }
  }

  function criarVista(id) {
    const sessao = sessaoDaPrevia();
    const view = new WebContentsView({
      webPreferences: {
        session: sessao,
        // Sem preload: a página externa não enxerga nada do app.
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
      },
    });
    const conteudo = view.webContents;
    conteudo.setUserAgent(sessao.getUserAgent());

    // Janelas novas: nunca dentro do app. Links http/https vão para o navegador do sistema.
    conteudo.setWindowOpenHandler(({ url }) => {
      abrirNoNavegadorDoSistema(id, url);
      return { action: "deny" };
    });
    const barrar = (detalhes) => {
      if (!navegacaoPermitida(detalhes.url, detalhes.isMainFrame !== false)) {
        detalhes.preventDefault();
        // Só a origem no log: o caminho e a query podem ter token ou dado pessoal.
        registrar(`Navegação bloqueada na prévia ${id}: ${origemParaLog(detalhes.url)}`);
      }
    };
    conteudo.on("will-frame-navigate", barrar);
    conteudo.on("will-redirect", barrar);

    // O estado que a tela mostra: carregando, erro e a ORIGEM real da página agora (só protocolo e host).
    const estado = { carregando: true, erro: null, origem: null, podeVoltar: false, podeAvancar: false };
    const avisarEstado = () => {
      // O histórico é lido na hora de avisar: toda navegação (e o voltar e avançar) passa por aqui.
      const historico = conteudo.navigationHistory;
      if (historico) descartarAboutBlankDoInicio(historico);
      estado.podeVoltar = historico ? historico.canGoBack() : false;
      estado.podeAvancar = historico ? historico.canGoForward() : false;
      avisar({ tipo: "estado", id, ...estado });
    };
    const mudouDePagina = (url, quadroPrincipal = true) => {
      if (!quadroPrincipal) return;
      estado.origem = origemDaPagina(url);
      avisarEstado();
    };
    conteudo.on("did-navigate", (_evento, url) => mudouDePagina(url));
    conteudo.on("did-navigate-in-page", (_evento, url, quadroPrincipal) => mudouDePagina(url, quadroPrincipal));
    conteudo.on("did-start-loading", () => {
      Object.assign(estado, { carregando: true, erro: null });
      avisarEstado();
    });
    conteudo.on("did-finish-load", () => {
      Object.assign(estado, { carregando: false, erro: null });
      avisarEstado();
    });
    conteudo.on("did-fail-load", (_evento, codigo, descricao, _url, quadroPrincipal) => {
      // -3 (ABORTED): outra navegação começou por cima; não é falha.
      if (quadroPrincipal && codigo !== -3) {
        Object.assign(estado, { carregando: false, erro: String(descricao || "falha ao carregar") });
        avisarEstado();
      }
    });
    // Esc e atalhos: Shift+Esc devolve o controle ao canvas (o Esc sozinho é da página).
    conteudo.on("before-input-event", (evento, entrada) => {
      if (entrada.type === "keyDown" && entrada.key === "Escape" && entrada.shift) {
        evento.preventDefault();
        void desativar(id);
      }
    });
    return view;
  }

  function limitesDaJanela(janela) {
    const [largura, altura] = janela.getContentSize();
    return { largura, altura };
  }

  function aplicar(id) {
    const vista = vistas.get(id);
    const janela = janelaValida();
    if (!vista || !janela) return;
    const { view } = vista;
    const limites = vista.retangulo
      ? calcularLimites(vista.retangulo, janela.webContents.getZoomFactor(), limitesDaJanela(janela))
      : null;
    if (vista.ativa && limites && janela.isVisible() && !janela.isMinimized()) {
      view.setBounds(limites.bounds);
      view.webContents.setZoomFactor(limites.zoomDaPagina);
      // Adicionar de novo põe a vista no topo (acima de qualquer outra).
      janela.contentView.addChildView(view);
      view.setVisible(true);
    } else {
      view.setVisible(false);
    }
  }

  async function desativar(id) {
    const vista = vistas.get(id);
    if (!vista || !vista.ativa) return;
    const pedido = vista.pedido;
    // Fotografa com a vista ainda visível e depois esconde: a tela troca a vista pela foto.
    await tirarFoto(id);
    // Um pedido de ativar chegou durante a foto: ele vale mais.
    if (vista.pedido !== pedido || !vista.ativa) return;
    vista.ativa = false;
    aplicar(id);
    avisar({ tipo: "desativada", id });
  }

  function desativarTodas() {
    for (const id of vistas.keys()) void desativar(id);
  }

  function fecharVista(id) {
    const vista = vistas.get(id);
    if (!vista) return;
    vistas.delete(id);
    const janela = janelaValida();
    try {
      if (janela) janela.contentView.removeChildView(vista.view);
    } catch {
      /* já removida */
    }
    if (!vista.view.webContents.isDestroyed()) vista.view.webContents.close();
  }

  function destruirTodas() {
    for (const id of [...vistas.keys()]) fecharVista(id);
  }

  function carregar(vista, url) {
    vista.url = url;
    vista.view.webContents.loadURL(url).catch(() => {
      /* a falha chega por did-fail-load; ERR_ABORTED de navegação trocada também cai aqui */
    });
  }

  // ───────────────────────── IPC ─────────────────────────

  /** abrir({ id, url, retangulo? }): cria a vista (escondida) ou, se já existe, só navega quando o endereço mudou. */
  function aoAbrir(evento, dados) {
    exigirPrincipal(evento);
    const id = validarId(dados?.id);
    const url = validarEnderecoExterno(dados?.url);
    if (id === null || url === null) return false;
    const retangulo = dados.retangulo === undefined ? null : validarRetangulo(dados.retangulo);
    const existente = vistas.get(id);
    if (existente) {
      if (existente.url !== url) carregar(existente, url);
      return true;
    }
    if (vistas.size >= LIMITE_DE_VISTAS) return false;
    const vista = { view: criarVista(id), url, ativa: false, retangulo, aberturas: [] };
    vista.view.setVisible(false);
    vistas.set(id, vista);
    const janela = janelaValida();
    if (janela) {
      // Escondida, mas no tamanho aproximado do corpo da prévia: a página carrega no layout certo.
      const area = limitesDaJanela(janela);
      const limites = retangulo ? calcularLimites(retangulo, janela.webContents.getZoomFactor(), area) : null;
      vista.view.setBounds(limites ? limites.bounds : { x: 0, y: 0, width: 960, height: 640 });
      janela.contentView.addChildView(vista.view);
      vista.view.setVisible(false);
    }
    carregar(vista, url);
    return true;
  }

  /** retangulo({ id, retangulo }): acompanha o corpo da prévia na tela (enviado a cada quadro em que muda). */
  function aoMoverRetangulo(evento, dados) {
    if (!eDaJanelaPrincipal(evento)) return;
    const id = validarId(dados?.id);
    const retangulo = validarRetangulo(dados?.retangulo);
    const vista = id === null ? undefined : vistas.get(id);
    if (!vista || retangulo === null) return;
    vista.retangulo = retangulo;
    aplicar(id);
  }

  /** ativar({ id, ativa, retangulo? }): mostra a vista com o foco, ou esconde (com foto). Uma ativa por vez. */
  async function aoAtivar(evento, dados) {
    exigirPrincipal(evento);
    const id = validarId(dados?.id);
    const vista = id === null ? undefined : vistas.get(id);
    if (!vista || typeof dados.ativa !== "boolean") return false;
    // Pedidos chegam em ordem, mas `desativar` espera a foto: só vale o último de cada vista.
    const pedido = (vista.pedido = (vista.pedido || 0) + 1);
    if (!dados.ativa) {
      await desativar(id);
      return true;
    }
    if (bloqueada()) return false;
    const retangulo = validarRetangulo(dados.retangulo);
    if (retangulo === null) return false;
    for (const [outro, { ativa }] of vistas) {
      if (outro !== id && ativa) await desativar(outro);
    }
    // Depois dos awaits o mundo pode ter mudado (pedido mais novo, vista fechada, modo invisível ligado, janela sumida).
    if (vista.pedido !== pedido || !vistas.has(id) || bloqueada() || !janelaValida()) return false;
    vista.retangulo = retangulo;
    vista.ativa = true;
    aplicar(id);
    if (!vista.view.webContents.isDestroyed()) vista.view.webContents.focus();
    return true;
  }

  function aoRecarregar(evento, dados) {
    exigirPrincipal(evento);
    const id = validarId(dados?.id);
    const vista = id === null ? undefined : vistas.get(id);
    if (!vista) return false;
    vista.view.webContents.reload();
    return true;
  }

  /** Volta ou avança no histórico da vista, se houver para onde ir. O estado novo chega pelo evento `estado`. */
  function navegarNoHistorico(evento, dados, direcao) {
    exigirPrincipal(evento);
    const id = validarId(dados?.id);
    const vista = id === null ? undefined : vistas.get(id);
    const historico = vista?.view.webContents.navigationHistory;
    if (!historico) return false;
    if (direcao === "voltar") {
      if (!historico.canGoBack()) return false;
      historico.goBack();
    } else {
      if (!historico.canGoForward()) return false;
      historico.goForward();
    }
    return true;
  }

  const aoVoltar = (evento, dados) => navegarNoHistorico(evento, dados, "voltar");
  const aoAvancar = (evento, dados) => navegarNoHistorico(evento, dados, "avancar");

  function aoFechar(evento, dados) {
    exigirPrincipal(evento);
    const id = validarId(dados?.id);
    if (id === null) return false;
    fecharVista(id);
    return true;
  }

  /**
   * Apaga o login e tudo o que os sites guardaram na sessão `persist:previa`. Primeiro cada vista larga a
   * página (about:blank), para nada gravar de volta durante a limpeza; depois limpa a sessão (armazenamento,
   * cache, autenticação e cache de DNS), recarrega cada vista no endereço com que foi aberta e manda a tela
   * descartar as fotos (data URI) que guardou das páginas.
   */
  async function aoSairDasContas(evento) {
    exigirPrincipal(evento);
    const sessao = sessaoDaPrevia();
    geracaoDaSessao += 1;
    const abertas = [...vistas.values()].filter(({ view }) => !view.webContents.isDestroyed());
    await Promise.all(
      abertas.map(({ view }) =>
        Promise.race([
          Promise.resolve(view.webContents.loadURL("about:blank")).catch(() => undefined),
          new Promise((resolver) => setTimeout(resolver, ESPERA_MAXIMA_DO_ABOUT_BLANK_MS)),
        ]),
      ),
    );
    // Cookies, localStorage, IndexedDB, service workers, cache storage e o resto do armazenamento.
    await sessao.clearStorageData();
    await sessao.clearCache();
    await sessao.clearAuthCache();
    await sessao.clearHostResolverCache();
    avisar({ tipo: "sessao-limpa" });
    for (const vista of abertas) {
      // Pode ter sido fechada durante a limpeza.
      if ([...vistas.values()].includes(vista) && !vista.view.webContents.isDestroyed()) carregar(vista, vista.url);
    }
    registrar("Sessão da prévia limpa (sair das contas).");
    return true;
  }

  /** Liga as vistas à janela principal: some ao minimizar ou esconder; cai junto quando a tela recarrega ou a janela fecha. */
  function anexar(janela) {
    janela.on("minimize", desativarTodas);
    // No macOS o "hide" também vem quando outra janela cobre esta por inteiro.
    janela.on("hide", desativarTodas);
    janela.on("closed", destruirTodas);
    janela.webContents.on("did-start-navigation", (detalhes) => {
      if (detalhes.isMainFrame && !detalhes.isSameDocument) destruirTodas();
    });
    janela.webContents.on("render-process-gone", destruirTodas);
  }

  return {
    aoAbrir,
    aoMoverRetangulo,
    aoAtivar,
    aoRecarregar,
    aoVoltar,
    aoAvancar,
    aoFechar,
    aoSairDasContas,
    anexar,
    desativarTodas,
    destruirTodas,
    total: () => vistas.size,
  };
}

module.exports = {
  PARTICAO,
  LIMITE_DE_VISTAS,
  ehHostLocal,
  pedidoParaHostLocal,
  origemDaPagina,
  origemParaLog,
  validarEnderecoExterno,
  validarId,
  validarRetangulo,
  calcularLimites,
  navegacaoPermitida,
  descartarAboutBlankDoInicio,
  permissaoLiberada,
  userAgentDeNavegador,
  criarVistasDaPrevia,
};
