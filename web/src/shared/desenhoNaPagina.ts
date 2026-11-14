import { useEffect, useRef, useState } from "react";

import type { AncoraDoTraco, TracoGravado } from "./api/artefatos";
import {
  type ContasDoDesenho,
  criarContasDoDesenho,
  DISTANCIA_MINIMA_ENTRE_PONTOS_PX,
  RAIO_DA_BORRACHA_PX,
} from "./canvas/desenho";
import {
  CORES_DO_DESENHO,
  type CorDoDesenho,
  ESPESSURAS_DO_DESENHO,
  type EspessuraDoDesenho,
  interpretarTraco,
  MAXIMO_DE_CARACTERES_NO_TEXTO,
  MAXIMO_DE_PONTOS_NO_TRACO,
  type Ponto,
  TIPOS_DE_TRACO,
  type TipoDoTraco,
} from "./canvas/layout";

/*
 * O desenho sobre a página de um artefato. A camada mora DENTRO do documento
 * da página: um SVG no próprio documento (na página HTML, que roda num iframe
 * isolado, o app injeta um script; no Markdown, o app instala a mesma camada na
 * div que rola). Assim o desenho rola junto com a página, sem atraso, e o zoom do
 * canvas o escala junto.
 *
 * Cada traço fica preso a um elemento (a âncora): o contêiner que rola sob o
 * ponto onde ele começou (o documento ou uma div com rolagem própria) e o
 * elemento de bloco sob o ponto, guardados como caminhos de índices dos filhos
 * elemento. Os pontos contam do canto superior esquerdo desse elemento; se a
 * página reflui (outra largura, conteúdo que muda), o traço vai junto. Elemento
 * preso na tela (fixed, sticky) ou âncora que não existe mais: o traço fica em
 * coordenadas do documento (`ancora: null`).
 *
 * Cada traço concluído vai ao app com a largura da página naquele momento; o
 * app guarda a do primeiro traço e, enquanto houver traços, monta a página
 * sempre nela e a reduz (ou amplia) para caber (`NoArtefato.tsx`). Assim a
 * página não reflui entre a janela do canvas e a tela cheia.
 *
 * O estado (traços, ferramenta, cor, ligado) é do app, que manda tudo de uma vez
 * (`receber`). A página só desenha o que recebeu e devolve o que o usuário fez:
 * o traço concluído, os traços que a borracha tocou e as teclas (Esc,
 * Ctrl/Cmd+Z) que o foco dentro da página prendeu. O app valida cada mensagem
 * (os scripts da própria página falam no mesmo canal) e só aceita o que vem com
 * o modo ligado.
 *
 * As funções `criarFuncoesDeAncora` e `instalarDesenho` (e as contas de
 * `desenho.ts`) não usam nada de fora delas: o script da página leva o texto
 * delas (`toString`). Não use import, constante do módulo nem helper aqui dentro.
 */

const ORIGEM_DA_PAGINA = "orquestrador-artefato";
const ORIGEM_DO_APP = "orquestrador-app";

/** Marca os elementos da camada: eles não contam nos caminhos e o ponteiro sobre eles é da camada. */
export const MARCA_DO_DESENHO = "data-orquestrador-desenho";
/** Quantos traços o desenho de uma versão guarda (o servidor recusa mais). */
export const MAXIMO_DE_TRACOS_NO_DESENHO = 2000;
/** O caminho de índices mais fundo de uma âncora (o servidor recusa mais). */
export const MAXIMO_DO_CAMINHO_DA_ANCORA = 64;
/** O maior índice que um caminho aceita: mais filhos que isso não vem de uma página de verdade. */
const MAIOR_INDICE_DO_CAMINHO = 100_000;
/** O id mais longo de um traço (o servidor recusa mais). */
const MAXIMO_DO_ID = 64;

/** As ferramentas que a página entende (a barra da tela cheia usa só algumas). */
export type FerramentaNaPagina = TipoDoTraco | "borracha";
const FERRAMENTAS_NA_PAGINA: readonly FerramentaNaPagina[] = [...TIPOS_DE_TRACO, "borracha"];

/** O que o app manda para a camada a cada mudança. */
export interface EstadoDoDesenho {
  tracos: readonly TracoGravado[];
  /** O modo de desenho: só ligado a camada pega o ponteiro. Desligado, ela só mostra. */
  ligado: boolean;
  ferramenta: FerramentaNaPagina;
  cor: CorDoDesenho;
  espessura: EspessuraDoDesenho;
  /** A cor de cada nome, já resolvida do tema: a página não tem as variáveis do app. */
  cores: Readonly<Record<CorDoDesenho, string>>;
  /** A fonte do texto solto, também resolvida do tema. */
  fonte: string;
}

/** A menor e a maior largura de página que o desenho guarda (o servidor recusa fora disso). */
export const LARGURA_MINIMA_DA_PAGINA = 200;
export const LARGURA_MAXIMA_DA_PAGINA = 10_000;

/** A menor escala da página na largura do desenho: abaixo disso, o texto não se lê (a página ganha rolagem lateral). */
export const ESCALA_MINIMA_DA_PAGINA = 0.4;

/** O que a camada devolve ao app, já validado (`lerMensagemDoDesenho`). */
export type MensagemDoDesenho =
  | { tipo: "pronto" }
  /** `largura`: a da página quando o traço terminou (nula se não veio número). */
  | { tipo: "traco"; traco: TracoGravado; largura: number | null }
  | { tipo: "apagar"; ids: string[] }
  | { tipo: "tecla"; tecla: "Escape" | "desfazer" };

/** Os limites e o vocabulário que a camada usa para validar o que recebe. */
export interface ConfiguracaoDoDesenhoNaPagina {
  marca: string;
  tipos: readonly string[];
  cores: readonly string[];
  espessuras: readonly number[];
  ferramentas: readonly string[];
  maximoDeTracos: number;
  maximoDePontos: number;
  maximoDeCaracteres: number;
  maximoDoCaminho: number;
  maiorIndice: number;
  maximoDoId: number;
  /** Distância mínima entre dois pontos da mão livre e raio da borracha, em px da tela. */
  distanciaMinima: number;
  raioDaBorracha: number;
  /** Repassa Esc e Ctrl/Cmd+Z ao app (na página HTML, que é outro documento). */
  teclas: boolean;
}

export interface OpcoesDoDesenhoNaPagina {
  janela: Window;
  /** A raiz dos caminhos: o `<html>` da página ou a div do Markdown. */
  raiz: Element;
  /** Onde a camada mora. Sem ele, a camada cria um no fim da raiz. */
  hospedeiro: HTMLElement | null;
  /** Quem escuta o ponteiro e as teclas, na fase de captura: a janela da página ou a div do Markdown. */
  ouvinte: EventTarget;
  enviar: (mensagem: Record<string, unknown>) => void;
  configuracao: ConfiguracaoDoDesenhoNaPagina;
}

export interface DesenhoNaPagina {
  /** O estado novo, vindo do app (validado aqui dentro). */
  receber: (estado: unknown) => void;
  reposicionar: () => void;
  destruir: () => void;
}

// ---------------- Âncora (serializada no script) ----------------

/**
 * As contas da âncora: achar o contêiner que rola e o elemento sob um ponto,
 * montar e seguir os caminhos de índices, e medir onde a âncora está na tela.
 * Pura (só DOM): serve ao script da página e ao Markdown no app.
 */
export function criarFuncoesDeAncora(marca: string, maximoDoCaminho: number) {
  const XHTML = "http://www.w3.org/1999/xhtml";

  type Alvo = { conteiner: Element; elemento: Element };

  function estiloDe(elemento: Element): CSSStyleDeclaration | null {
    const vista = elemento.ownerDocument.defaultView;
    return vista === null ? null : vista.getComputedStyle(elemento);
  }

  function ehDaCamada(elemento: Element): boolean {
    return elemento.hasAttribute(marca);
  }

  /** Os filhos elemento, sem os da camada: os caminhos não mudam com ela. */
  function filhosDe(elemento: Element): Element[] {
    const filhos: Element[] = [];
    for (let filho = elemento.firstElementChild; filho !== null; filho = filho.nextElementSibling) {
      if (!ehDaCamada(filho)) {
        filhos.push(filho);
      }
    }
    return filhos;
  }

  /** Os índices de `raiz` até `elemento` (vazio: a própria raiz); nulo se ele não está dentro dela. */
  function caminhoAte(raiz: Element, elemento: Element): number[] | null {
    const caminho: number[] = [];
    let atual = elemento;
    while (atual !== raiz) {
      const pai = atual.parentElement;
      if (pai === null) {
        return null;
      }
      const indice = filhosDe(pai).indexOf(atual);
      if (indice === -1) {
        return null;
      }
      caminho.unshift(indice);
      atual = pai;
    }
    return caminho;
  }

  function elementoDoCaminho(raiz: Element, caminho: readonly number[]): Element | null {
    let atual: Element | undefined = raiz;
    for (const indice of caminho) {
      atual = filhosDe(atual)[indice];
      if (atual === undefined) {
        return null;
      }
    }
    return atual;
  }

  /** Se o elemento rola por conta própria (overflow auto ou scroll, com mais conteúdo do que cabe). */
  function rolaPorConta(elemento: Element, raiz: Element): boolean {
    if (elemento === raiz) {
      return false;
    }
    const documento = elemento.ownerDocument;
    if (elemento === documento.body && raiz === documento.documentElement) {
      // Com o <html> sem overflow próprio, o do <body> vai para a janela: quem rola é o documento.
      const doHtml = estiloDe(documento.documentElement);
      if (doHtml === null || ((doHtml.overflowY || doHtml.overflow) === "visible" && (doHtml.overflowX || doHtml.overflow) === "visible")) {
        return false;
      }
    }
    const estilo = estiloDe(elemento);
    if (estilo === null) {
      return false;
    }
    const rolavel = (valor: string) => valor === "auto" || valor === "scroll" || valor === "overlay";
    return (
      (rolavel(estilo.overflowY || estilo.overflow) && elemento.scrollHeight > elemento.clientHeight) ||
      (rolavel(estilo.overflowX || estilo.overflow) && elemento.scrollWidth > elemento.clientWidth)
    );
  }

  /** O contêiner que rola mais perto do elemento (ele mesmo incluído); sem nenhum, a raiz. */
  function conteinerDe(elemento: Element, raiz: Element): Element {
    for (let atual: Element | null = elemento; atual !== null && atual !== raiz; atual = atual.parentElement) {
      if (rolaPorConta(atual, raiz)) {
        return atual;
      }
    }
    return raiz;
  }

  /** Se o elemento (ou algo acima dele, até a raiz) fica preso na tela: fixed ou sticky. */
  function presoNaTela(elemento: Element, raiz: Element): boolean {
    for (let atual: Element | null = elemento; atual !== null && atual !== raiz; atual = atual.parentElement) {
      const posicao = estiloDe(atual)?.position;
      if (posicao === "fixed" || posicao === "sticky") {
        return true;
      }
    }
    return false;
  }

  /** O elemento de bloco HTML mais perto (ele mesmo incluído), antes de chegar ao limite; sem nenhum, o limite. */
  function blocoDe(elemento: Element, limite: Element): Element {
    for (let atual: Element | null = elemento; atual !== null && atual !== limite; atual = atual.parentElement) {
      if (atual.namespaceURI === XHTML) {
        const exibicao = estiloDe(atual)?.display ?? "";
        if (exibicao !== "" && exibicao !== "inline" && exibicao !== "contents" && exibicao !== "none") {
          return atual;
        }
      }
    }
    return limite;
  }

  /**
   * A âncora do traço que começa sobre `tocado`: nula se não há elemento bom
   * (fora da raiz, o próprio documento ou o `<body>`, algo preso na tela, caminho fundo demais).
   */
  function acharAncora(raiz: Element, tocado: Element | null): { ancora: AncoraDoTraco; alvo: Alvo } | null {
    if (tocado === null || tocado === raiz || !raiz.contains(tocado)) {
      return null;
    }
    const conteiner = conteinerDe(tocado, raiz);
    let elemento = blocoDe(tocado, conteiner);
    if (conteiner === raiz && (elemento === raiz || elemento === raiz.ownerDocument.body)) {
      return null;
    }
    if (presoNaTela(elemento, raiz)) {
      return null;
    }
    const doConteiner = caminhoAte(raiz, conteiner);
    let doElemento = caminhoAte(conteiner, elemento);
    if (doConteiner === null || doElemento === null || doConteiner.length > maximoDoCaminho) {
      return null;
    }
    if (doElemento.length > maximoDoCaminho) {
      // Fundo demais: vale o ancestral no limite do caminho.
      doElemento = doElemento.slice(0, maximoDoCaminho);
      const ancestral = elementoDoCaminho(conteiner, doElemento);
      if (ancestral === null) {
        return null;
      }
      elemento = ancestral;
    }
    return { ancora: { conteiner: doConteiner, elemento: doElemento }, alvo: { conteiner, elemento } };
  }

  /** O contêiner e o elemento da âncora na página de agora; nulo se a âncora é nula ou um dos dois sumiu. */
  function resolverAncora(raiz: Element, ancora: AncoraDoTraco | null): Alvo | null {
    if (ancora === null) {
      return null;
    }
    const conteiner = elementoDoCaminho(raiz, ancora.conteiner);
    const elemento = conteiner === null ? null : elementoDoCaminho(conteiner, ancora.elemento);
    return conteiner === null || elemento === null ? null : { conteiner, elemento };
  }

  /** A escala com que a raiz aparece na tela (o zoom do canvas, no Markdown); 1 se não der para medir. */
  function escalaDe(raiz: Element): number {
    const largura = (raiz as HTMLElement).offsetWidth;
    const naTela = raiz.getBoundingClientRect().width;
    return largura > 0 && naTela > 0 ? naTela / largura : 1;
  }

  /** O canto de onde contam os pontos do traço preso ao alvo, em px da janela (como clientX e clientY). */
  function origemNaTela(alvo: Alvo, escala: number): Ponto {
    const caixa = alvo.elemento.getBoundingClientRect();
    if (alvo.elemento !== alvo.conteiner) {
      return { x: caixa.left, y: caixa.top };
    }
    // O próprio contêiner: o canto do conteúdo dele, que anda com a rolagem.
    return {
      x: caixa.left + (alvo.conteiner.clientLeft - alvo.conteiner.scrollLeft) * escala,
      y: caixa.top + (alvo.conteiner.clientTop - alvo.conteiner.scrollTop) * escala,
    };
  }

  /** A área visível do contêiner (dentro da borda), em px da janela: o traço preso nele não passa dela. */
  function areaVisivel(conteiner: Element, escala: number): { x: number; y: number; largura: number; altura: number } {
    const caixa = conteiner.getBoundingClientRect();
    return {
      x: caixa.left + conteiner.clientLeft * escala,
      y: caixa.top + conteiner.clientTop * escala,
      largura: conteiner.clientWidth * escala,
      altura: conteiner.clientHeight * escala,
    };
  }

  return {
    caminhoAte,
    elementoDoCaminho,
    conteinerDe,
    acharAncora,
    resolverAncora,
    escalaDe,
    origemNaTela,
    areaVisivel,
  };
}

export type FuncoesDeAncora = ReturnType<typeof criarFuncoesDeAncora>;

// ---------------- A camada (serializada no script) ----------------

/**
 * Instala a camada de desenho no documento da raiz: o SVG (num hospedeiro
 * absoluto no canto da raiz, de tamanho zero, que não mexe no layout), a
 * escuta do ponteiro e das teclas (na fase de captura, só com o modo ligado)
 * e o reposicionamento quando a página reflui.
 *
 * Ligada, a camada não cobre a página: ela segura o `pointerdown` (e os cliques
 * que viriam dele) antes da página, e a roda continua com a página, que rola
 * como sempre (o documento ou a div sob o mouse).
 */
export function instalarDesenho(
  opcoes: OpcoesDoDesenhoNaPagina,
  contas: ContasDoDesenho,
  ancoras: FuncoesDeAncora,
): DesenhoNaPagina {
  type Alvo = { conteiner: Element; elemento: Element };
  type Estado = {
    tracos: TracoGravado[];
    ligado: boolean;
    ferramenta: string;
    cor: string;
    espessura: number;
    cores: Record<string, string>;
    fonte: string;
  };
  type Item = { traco: TracoGravado; externo: SVGGElement; interno: SVGGElement; alvo: Alvo | null };
  type Gesto =
    | { tipo: "traco"; traco: TracoGravado; alvo: Alvo | null }
    | { tipo: "borracha"; ultimo: Ponto; ids: string[] };
  type TextoAberto = {
    campo: HTMLInputElement;
    ponto: Ponto;
    ancora: AncoraDoTraco | null;
    alvo: Alvo | null;
    cor: string;
    espessura: number;
  };
  type Base = { x: number; y: number; escala: number };

  const { janela, raiz, ouvinte, enviar, configuracao } = opcoes;
  const documento = raiz.ownerDocument;
  const SVG = "http://www.w3.org/2000/svg";
  const MARCA = configuracao.marca;
  const LIGADO = `${MARCA}-ligado`;
  const COR_VALIDA = /^[#\w\s(),.%-]{1,80}$/;
  const FONTE_VALIDA = /^[\w\s,"'-]{1,200}$/;
  // Ids dos recortes únicos no documento: dois artefatos em Markdown dividem o documento do app.
  const PREFIXO = `orquestrador-desenho-${Math.random().toString(36).slice(2, 8)}-`;
  const ligadoSel = `[${LIGADO}]`;
  const foraDaCamada = `*:not([${MARCA}])`;
  const REGRAS = [
    `${ligadoSel}, ${ligadoSel} ${foraDaCamada} { cursor: crosshair !important; user-select: none !important; -webkit-user-select: none !important; touch-action: none !important; }`,
    `[${LIGADO}="texto"], [${LIGADO}="texto"] ${foraDaCamada} { cursor: text !important; }`,
    `[${LIGADO}="borracha"], [${LIGADO}="borracha"] ${foraDaCamada} { cursor: cell !important; }`,
  ].join("\n");
  const criouOHospedeiro = opcoes.hospedeiro === null;

  let hospedeiro: HTMLElement | null = opcoes.hospedeiro;
  let svg: SVGSVGElement | null = null;
  let definicoes: SVGDefsElement | null = null;
  let camadaDosTracos: SVGGElement | null = null;
  let camadaDoRascunho: SVGGElement | null = null;
  let estado: Estado | null = null;
  let itens: Item[] = [];
  let gesto: Gesto | null = null;
  let texto: TextoAberto | null = null;
  let contador = 0;
  let cancelarAgendado: (() => void) | null = null;
  let observadorDeTamanho: ResizeObserver | null = null;
  let observadorDeMudancas: MutationObserver | null = null;
  let destruido = false;

  // ---- Validação do que chega do app ----

  function ehCaminho(valor: unknown): valor is number[] {
    return (
      Array.isArray(valor) &&
      valor.length <= configuracao.maximoDoCaminho &&
      valor.every((indice) => typeof indice === "number" && Number.isInteger(indice) && indice >= 0 && indice <= configuracao.maiorIndice)
    );
  }

  /** A âncora lida (nula vale); `undefined` se veio malformada. */
  function lerAncora(valor: unknown): AncoraDoTraco | null | undefined {
    if (valor === null || valor === undefined) {
      return null;
    }
    if (typeof valor !== "object") {
      return undefined;
    }
    const { conteiner, elemento } = valor as Record<string, unknown>;
    return ehCaminho(conteiner) && ehCaminho(elemento) ? { conteiner: conteiner.slice(), elemento: elemento.slice() } : undefined;
  }

  function lerTraco(valor: unknown): TracoGravado | null {
    if (typeof valor !== "object" || valor === null) {
      return null;
    }
    const { id, tipo, cor, espessura, pontos, texto: escrito, ancora } = valor as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      id === "" ||
      id.length > configuracao.maximoDoId ||
      typeof tipo !== "string" ||
      configuracao.tipos.indexOf(tipo) === -1 ||
      typeof cor !== "string" ||
      configuracao.cores.indexOf(cor) === -1 ||
      typeof espessura !== "number" ||
      configuracao.espessuras.indexOf(espessura) === -1 ||
      !Array.isArray(pontos)
    ) {
      return null;
    }
    const maoLivre = tipo === "caneta" || tipo === "marca-texto";
    const quantidadeCerta = maoLivre
      ? pontos.length >= 1 && pontos.length <= configuracao.maximoDePontos
      : pontos.length === (tipo === "texto" ? 1 : 2);
    if (!quantidadeCerta) {
      return null;
    }
    const lidos: Ponto[] = [];
    for (const ponto of pontos) {
      if (typeof ponto !== "object" || ponto === null) {
        return null;
      }
      const { x, y } = ponto as Record<string, unknown>;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      lidos.push({ x, y });
    }
    const ancoraLida = lerAncora(ancora);
    if (ancoraLida === undefined) {
      return null;
    }
    const traco = { id, tipo, cor, espessura, pontos: lidos, ancora: ancoraLida } as TracoGravado;
    if (tipo !== "texto") {
      return traco;
    }
    return typeof escrito === "string" && escrito.trim() !== "" && escrito.length <= configuracao.maximoDeCaracteres
      ? { ...traco, texto: escrito }
      : null;
  }

  function lerEstado(valor: unknown): Estado | null {
    if (typeof valor !== "object" || valor === null) {
      return null;
    }
    const { tracos, ligado, ferramenta, cor, espessura, cores, fonte } = valor as Record<string, unknown>;
    if (
      !Array.isArray(tracos) ||
      tracos.length > configuracao.maximoDeTracos ||
      typeof ligado !== "boolean" ||
      typeof ferramenta !== "string" ||
      configuracao.ferramentas.indexOf(ferramenta) === -1 ||
      typeof cor !== "string" ||
      configuracao.cores.indexOf(cor) === -1 ||
      typeof espessura !== "number" ||
      configuracao.espessuras.indexOf(espessura) === -1
    ) {
      return null;
    }
    const paleta: Record<string, string> = {};
    for (const nome of configuracao.cores) {
      const valorDaCor = typeof cores === "object" && cores !== null ? (cores as Record<string, unknown>)[nome] : undefined;
      paleta[nome] = typeof valorDaCor === "string" && COR_VALIDA.test(valorDaCor) ? valorDaCor : "currentColor";
    }
    const lidos: TracoGravado[] = [];
    for (const traco of tracos) {
      const lido = lerTraco(traco);
      if (lido !== null) {
        lidos.push(lido);
      }
    }
    return {
      tracos: lidos,
      ligado,
      ferramenta,
      cor,
      espessura,
      cores: paleta,
      fonte: typeof fonte === "string" && FONTE_VALIDA.test(fonte) ? fonte : "sans-serif",
    };
  }

  // ---- Coordenadas ----

  function arredondar(valor: number): number {
    return Math.round(valor * 10) / 10;
  }

  /** Onde o SVG está na tela e a escala da raiz: a base para passar de px da janela a px da camada. */
  function base(): Base {
    const caixa = svg === null ? null : svg.getBoundingClientRect();
    return { x: caixa === null ? 0 : caixa.left, y: caixa === null ? 0 : caixa.top, escala: ancoras.escalaDe(raiz) };
  }

  function naCamada(x: number, y: number, b: Base): Ponto {
    return { x: (x - b.x) / b.escala, y: (y - b.y) / b.escala };
  }

  /** Onde fica, na camada, o canto de onde contam os pontos do traço: o da âncora, ou o do documento. */
  function deslocamentoDe(alvo: Alvo | null, b: Base): Ponto {
    if (alvo === null) {
      return { x: 0, y: 0 };
    }
    const origem = ancoras.origemNaTela(alvo, b.escala);
    return naCamada(origem.x, origem.y, b);
  }

  function translacao(ponto: Ponto): string {
    return `translate(${arredondar(ponto.x)} ${arredondar(ponto.y)})`;
  }

  // ---- Elementos ----

  function criar<Nome extends keyof SVGElementTagNameMap>(nome: Nome): SVGElementTagNameMap[Nome] {
    return documento.createElementNS(SVG, nome);
  }

  /** Cria (ou recoloca, se a página a tirou) a camada. Falso se não há onde pôr. */
  function garantirCamada(): boolean {
    if (destruido) {
      return false;
    }
    if (hospedeiro === null) {
      hospedeiro = documento.createElement("div");
    }
    if (!hospedeiro.isConnected) {
      if (!criouOHospedeiro) {
        return false;
      }
      raiz.appendChild(hospedeiro);
    }
    if (svg !== null && svg.parentNode === hospedeiro) {
      return true;
    }
    hospedeiro.setAttribute(MARCA, "");
    hospedeiro.style.cssText =
      "position:absolute;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;overflow:visible;pointer-events:none;z-index:2147483647;";
    const estilo = documento.createElement("style");
    estilo.setAttribute(MARCA, "");
    estilo.textContent = REGRAS;
    svg = criar("svg");
    svg.setAttribute(MARCA, "");
    svg.setAttribute("data-testid", "desenho-na-pagina");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");
    svg.style.cssText = "position:absolute;top:0;left:0;width:1px;height:1px;overflow:visible;pointer-events:none;";
    definicoes = criar("defs");
    camadaDosTracos = criar("g");
    camadaDoRascunho = criar("g");
    camadaDoRascunho.setAttribute("data-rascunho", "");
    svg.append(definicoes, camadaDosTracos, camadaDoRascunho);
    hospedeiro.replaceChildren(estilo, svg);
    return true;
  }

  function criarForma(traco: TracoGravado, cores: Record<string, string>, fonte: string): SVGElement | null {
    const [de, ate] = traco.pontos;
    if (de === undefined) {
      return null;
    }
    const cor = cores[traco.cor] ?? "currentColor";
    let forma: SVGElement;
    if (traco.tipo === "texto") {
      const escrito = criar("text");
      escrito.setAttribute("x", String(de.x));
      escrito.setAttribute("y", String(de.y));
      escrito.setAttribute("font-size", String(contas.tamanhoDoTexto(traco.espessura)));
      escrito.setAttribute("dominant-baseline", "hanging");
      escrito.setAttribute("fill", cor);
      escrito.setAttribute("font-family", fonte);
      escrito.setAttribute("font-weight", "500");
      escrito.style.whiteSpace = "pre";
      escrito.textContent = traco.texto ?? "";
      forma = escrito;
    } else if (traco.tipo === "retangulo") {
      const caixa = contas.retanguloEntre(de, ate ?? de);
      const retangulo = criar("rect");
      retangulo.setAttribute("x", String(caixa.x));
      retangulo.setAttribute("y", String(caixa.y));
      retangulo.setAttribute("width", String(caixa.largura));
      retangulo.setAttribute("height", String(caixa.altura));
      retangulo.setAttribute("stroke-width", String(traco.espessura));
      forma = retangulo;
    } else {
      const caminho = criar("path");
      const seta = traco.tipo === "seta";
      caminho.setAttribute("d", seta ? contas.caminhoDaSeta(de, ate ?? de, traco.espessura) : contas.caminhoDaMaoLivre(traco.pontos));
      caminho.setAttribute("stroke-width", String(seta ? traco.espessura : contas.larguraDoTraco(traco)));
      if (traco.tipo === "marca-texto") {
        caminho.setAttribute("stroke-opacity", "0.38");
      }
      forma = caminho;
    }
    if (traco.tipo !== "texto") {
      forma.setAttribute("fill", "none");
      forma.setAttribute("stroke", cor);
      forma.setAttribute("stroke-linecap", "round");
      forma.setAttribute("stroke-linejoin", "round");
    }
    forma.setAttribute("data-traco", traco.tipo);
    return forma;
  }

  /** O grupo de fora leva o recorte (em coordenadas da camada); o de dentro, a posição da âncora. */
  function criarItem(traco: TracoGravado): Item | null {
    if (estado === null) {
      return null;
    }
    const forma = criarForma(traco, estado.cores, estado.fonte);
    if (forma === null) {
      return null;
    }
    const externo = criar("g");
    const interno = criar("g");
    externo.setAttribute("data-traco-id", traco.id);
    interno.appendChild(forma);
    externo.appendChild(interno);
    return { traco, externo, interno, alvo: null };
  }

  function desenharTudo(): void {
    if (estado === null || documento.readyState === "loading" || !garantirCamada() || camadaDosTracos === null) {
      return;
    }
    camadaDosTracos.replaceChildren();
    itens = [];
    const apagando = gesto !== null && gesto.tipo === "borracha" ? gesto.ids : [];
    for (const traco of estado.tracos) {
      const item = criarItem(traco);
      if (item !== null) {
        if (apagando.indexOf(traco.id) !== -1) {
          item.externo.style.display = "none";
        }
        camadaDosTracos.appendChild(item.externo);
        itens.push(item);
      }
    }
    reposicionar();
    observar();
  }

  /** O traço em curso (ou o concluído, até o app devolver o estado com ele). */
  function mostrarRascunho(traco: TracoGravado, alvo: Alvo | null): void {
    if (camadaDoRascunho === null) {
      return;
    }
    camadaDoRascunho.replaceChildren();
    const item = criarItem(traco);
    if (item !== null) {
      item.interno.setAttribute("transform", translacao(deslocamentoDe(alvo, base())));
      camadaDoRascunho.appendChild(item.externo);
    }
  }

  function limparRascunho(): void {
    camadaDoRascunho?.replaceChildren();
  }

  function recorteDe(conteiner: Element, b: Base, recortes: Map<Element, string>): string {
    const pronto = recortes.get(conteiner);
    if (pronto !== undefined || definicoes === null) {
      return pronto ?? "";
    }
    const area = ancoras.areaVisivel(conteiner, b.escala);
    const id = `${PREFIXO}${recortes.size}`;
    const recorte = criar("clipPath");
    recorte.setAttribute("id", id);
    recorte.setAttribute("clipPathUnits", "userSpaceOnUse");
    const retangulo = criar("rect");
    const canto = naCamada(area.x, area.y, b);
    retangulo.setAttribute("x", String(arredondar(canto.x)));
    retangulo.setAttribute("y", String(arredondar(canto.y)));
    retangulo.setAttribute("width", String(arredondar(area.largura / b.escala)));
    retangulo.setAttribute("height", String(arredondar(area.altura / b.escala)));
    recorte.appendChild(retangulo);
    definicoes.appendChild(recorte);
    recortes.set(conteiner, id);
    return id;
  }

  function posicionarTexto(b: Base): void {
    if (texto === null) {
      return;
    }
    const deslocamento = deslocamentoDe(texto.alvo, b);
    texto.campo.style.left = `${arredondar(deslocamento.x + texto.ponto.x)}px`;
    texto.campo.style.top = `${arredondar(deslocamento.y + texto.ponto.y)}px`;
  }

  /** Põe cada traço junto da âncora dele, como a página está agora. */
  function reposicionar(): void {
    if (destruido || svg === null || definicoes === null) {
      return;
    }
    const b = base();
    const recortes = new Map<Element, string>();
    definicoes.replaceChildren();
    for (const item of itens) {
      const alvo = ancoras.resolverAncora(raiz, item.traco.ancora);
      item.alvo = alvo;
      item.interno.setAttribute("transform", translacao(deslocamentoDe(alvo, b)));
      const recorte = alvo !== null && alvo.conteiner !== raiz ? recorteDe(alvo.conteiner, b, recortes) : "";
      if (recorte === "") {
        item.externo.removeAttribute("clip-path");
      } else {
        item.externo.setAttribute("clip-path", `url(#${recorte})`);
      }
    }
    if (gesto !== null && gesto.tipo === "traco") {
      mostrarRascunho(gesto.traco, gesto.alvo);
    }
    posicionarTexto(b);
  }

  /** Junta os pedidos de reposicionar num quadro só. */
  function agendar(): void {
    if (cancelarAgendado !== null || destruido) {
      return;
    }
    const rodar = () => {
      cancelarAgendado = null;
      reposicionar();
    };
    if (typeof janela.requestAnimationFrame === "function") {
      const pedido = janela.requestAnimationFrame(rodar);
      cancelarAgendado = () => janela.cancelAnimationFrame(pedido);
    } else {
      const pedido = janela.setTimeout(rodar, 16);
      cancelarAgendado = () => janela.clearTimeout(pedido);
    }
  }

  /** Observa o tamanho da raiz, do corpo e de cada contêiner e elemento âncora: mudou, reposiciona. */
  function observar(): void {
    const Observador = (janela as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (Observador === undefined) {
      return;
    }
    if (observadorDeTamanho === null) {
      observadorDeTamanho = new Observador(() => agendar());
    }
    observadorDeTamanho.disconnect();
    observadorDeTamanho.observe(raiz);
    if (documento.body !== null && raiz === documento.documentElement) {
      observadorDeTamanho.observe(documento.body);
    }
    const vistos: Element[] = [];
    for (const item of itens) {
      if (item.alvo === null) {
        continue;
      }
      for (const elemento of [item.alvo.conteiner, item.alvo.elemento]) {
        if (vistos.indexOf(elemento) === -1) {
          vistos.push(elemento);
          observadorDeTamanho.observe(elemento);
        }
      }
    }
  }

  // ---- Ponteiro e teclas ----

  function daCamada(alvo: EventTarget | null): boolean {
    return (
      hospedeiro !== null &&
      alvo !== null &&
      typeof (alvo as Node).nodeType === "number" &&
      hospedeiro.contains(alvo as Node)
    );
  }

  /** Segura o evento antes da página: ela não o vê, e o navegador não faz o que faria com ele. */
  function segurar(evento: Event): void {
    evento.preventDefault();
    evento.stopImmediatePropagation();
  }

  function editavel(alvo: EventTarget | null): boolean {
    const elemento = alvo as HTMLElement | null;
    return (
      elemento !== null &&
      typeof elemento.tagName === "string" &&
      (elemento.isContentEditable || elemento.tagName === "INPUT" || elemento.tagName === "TEXTAREA" || elemento.tagName === "SELECT")
    );
  }

  /** O elemento da página sob o ponteiro (nunca o da camada). */
  function elementoTocado(evento: PointerEvent): Element | null {
    const achado =
      typeof documento.elementFromPoint === "function" ? documento.elementFromPoint(evento.clientX, evento.clientY) : null;
    if (achado !== null && !daCamada(achado)) {
      return achado;
    }
    const alvo = evento.target as Element | null;
    return alvo !== null && typeof alvo.getBoundingClientRect === "function" && !daCamada(alvo) ? alvo : null;
  }

  /**
   * A largura da página agora, em px CSS dela: a do iframe (com a barra de rolagem,
   * a mesma que o app dá ao iframe para montar a página igual) ou a da div do
   * Markdown. Transformações de fora não contam. Nula se não der para medir.
   */
  function larguraDaPagina(): number | null {
    const valor = raiz === documento.documentElement ? janela.innerWidth : (raiz as HTMLElement).offsetWidth;
    return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? Math.round(valor) : null;
  }

  /** Manda o traço concluído ao app, com a largura da página (o app guarda a do primeiro). */
  function enviarTraco(traco: TracoGravado): void {
    enviar({ desenho: "traco", traco, largura: larguraDaPagina() });
  }

  function novoId(): string {
    contador += 1;
    return `p${Date.now().toString(36)}-${contador}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function capturar(pointerId: number): void {
    try {
      if (typeof pointerId === "number") {
        raiz.setPointerCapture(pointerId);
      }
    } catch {
      // Sem captura: o traço só termina se o ponteiro soltar dentro da página.
    }
  }

  function apagarEm(pontos: readonly Ponto[]): void {
    if (gesto === null || gesto.tipo !== "borracha") {
      return;
    }
    const b = base();
    const folga = configuracao.raioDaBorracha / b.escala;
    for (const item of itens) {
      if (gesto.ids.indexOf(item.traco.id) !== -1) {
        continue;
      }
      const deslocamento = deslocamentoDe(item.alvo, b);
      const tocou = pontos.some((ponto) =>
        contas.tracoTocado(item.traco, { x: ponto.x - deslocamento.x, y: ponto.y - deslocamento.y }, folga),
      );
      if (tocou) {
        gesto.ids.push(item.traco.id);
        item.externo.style.display = "none";
      }
    }
  }

  function abrirTexto(ponto: Ponto, ancora: AncoraDoTraco | null, alvo: Alvo | null): void {
    if (estado === null || !garantirCamada() || hospedeiro === null) {
      return;
    }
    const campo = documento.createElement("input");
    const cor = estado.cores[estado.cor] ?? "currentColor";
    const tamanho = contas.tamanhoDoTexto(estado.espessura as EspessuraDoDesenho);
    campo.setAttribute(MARCA, "");
    campo.setAttribute("aria-label", "Texto solto");
    campo.setAttribute("data-testid", "texto-solto-na-pagina");
    campo.setAttribute("autocomplete", "off");
    campo.placeholder = "Digite e tecle Enter";
    campo.maxLength = configuracao.maximoDeCaracteres;
    campo.spellcheck = false;
    // Cor e fonte passaram pela validação (sem ";"): não dá para escapar da regra.
    campo.style.cssText =
      `all:initial;position:absolute;box-sizing:content-box;min-width:160px;padding:0 2px;border:0;border-radius:3px;` +
      `outline:1px dashed ${cor};background:color-mix(in srgb, ${cor} 8%, transparent);color:${cor};` +
      `font-family:${estado.fonte};font-weight:500;line-height:1.1;font-size:${tamanho}px;pointer-events:auto;cursor:text;`;
    hospedeiro.appendChild(campo);
    texto = { campo, ponto, ancora, alvo, cor: estado.cor, espessura: estado.espessura };
    posicionarTexto(base());
    campo.addEventListener("blur", confirmarTexto);
    campo.focus({ preventScroll: true });
  }

  /** Termina o texto solto: com algo escrito, vira traço (vai ao app); vazio, some. Chamado duas vezes, vale uma. */
  function confirmarTexto(): void {
    const aberto = texto;
    if (aberto === null) {
      return;
    }
    texto = null;
    const valor = aberto.campo.value.slice(0, configuracao.maximoDeCaracteres);
    aberto.campo.remove();
    if (valor.trim() === "") {
      return;
    }
    const traco = {
      id: novoId(),
      tipo: "texto",
      cor: aberto.cor,
      espessura: aberto.espessura,
      pontos: [aberto.ponto],
      texto: valor,
      ancora: aberto.ancora,
    } as TracoGravado;
    mostrarRascunho(traco, aberto.alvo);
    enviarTraco(traco);
  }

  function descartarTexto(): void {
    const aberto = texto;
    texto = null;
    aberto?.campo.remove();
  }

  function aoApertar(evento: PointerEvent): void {
    if (estado === null || !estado.ligado || daCamada(evento.target) || evento.button !== 0) {
      return;
    }
    segurar(evento);
    confirmarTexto();
    if (!garantirCamada()) {
      return;
    }
    const achado = ancoras.acharAncora(raiz, elementoTocado(evento));
    const alvo = achado === null ? null : achado.alvo;
    const ancora = achado === null ? null : achado.ancora;
    const b = base();
    const naTela = naCamada(evento.clientX, evento.clientY, b);
    const deslocamento = deslocamentoDe(alvo, b);
    const ponto = { x: arredondar(naTela.x - deslocamento.x), y: arredondar(naTela.y - deslocamento.y) };
    if (estado.ferramenta === "texto") {
      abrirTexto(ponto, ancora, alvo);
      return;
    }
    capturar(evento.pointerId);
    if (estado.ferramenta === "borracha") {
      gesto = { tipo: "borracha", ultimo: naTela, ids: [] };
      apagarEm([naTela]);
      return;
    }
    const maoLivre = estado.ferramenta === "caneta" || estado.ferramenta === "marca-texto";
    const traco = {
      id: novoId(),
      tipo: estado.ferramenta,
      cor: estado.cor,
      espessura: estado.espessura,
      pontos: maoLivre ? [ponto] : [ponto, ponto],
      ancora,
    } as TracoGravado;
    gesto = { tipo: "traco", traco, alvo };
    mostrarRascunho(traco, alvo);
  }

  function aoMover(evento: PointerEvent): void {
    if (gesto === null) {
      return;
    }
    segurar(evento);
    const b = base();
    const naTela = naCamada(evento.clientX, evento.clientY, b);
    if (gesto.tipo === "borracha") {
      apagarEm(contas.pontosEntre(gesto.ultimo, naTela, configuracao.raioDaBorracha / b.escala));
      gesto.ultimo = naTela;
      return;
    }
    const { traco } = gesto;
    // A âncora de agora: se a página rolou no meio do traço, o ponto continua no lugar certo.
    const deslocamento = deslocamentoDe(gesto.alvo, b);
    const ponto = { x: arredondar(naTela.x - deslocamento.x), y: arredondar(naTela.y - deslocamento.y) };
    if (traco.tipo === "caneta" || traco.tipo === "marca-texto") {
      const ultimo = traco.pontos[traco.pontos.length - 1];
      if (
        traco.pontos.length >= configuracao.maximoDePontos ||
        (ultimo !== undefined && Math.hypot(ultimo.x - ponto.x, ultimo.y - ponto.y) < configuracao.distanciaMinima / b.escala)
      ) {
        return;
      }
      traco.pontos.push(ponto);
    } else {
      traco.pontos = [traco.pontos[0] ?? ponto, ponto];
    }
    mostrarRascunho(traco, gesto.alvo);
  }

  function aoSoltar(evento: PointerEvent): void {
    if (gesto === null) {
      return;
    }
    segurar(evento);
    const terminado = gesto;
    gesto = null;
    if (terminado.tipo === "borracha") {
      if (terminado.ids.length > 0) {
        enviar({ desenho: "apagar", ids: terminado.ids.slice() });
      }
      return;
    }
    // O rascunho fica até o app devolver o estado com o traço (sem piscar).
    enviarTraco({ ...terminado.traco, pontos: terminado.traco.pontos.slice() });
  }

  /** Os cliques e o arraste nativo que viriam do apertar: com o modo ligado, a página não os vê. */
  function aoClicar(evento: Event): void {
    if (estado !== null && estado.ligado && !daCamada(evento.target)) {
      segurar(evento);
    }
  }

  function aoTeclar(evento: KeyboardEvent): void {
    if (texto !== null && evento.target === texto.campo) {
      if (evento.key === "Enter") {
        evento.preventDefault();
        confirmarTexto();
      } else if (evento.key === "Escape" && configuracao.teclas) {
        evento.preventDefault();
        descartarTexto();
        enviar({ desenho: "tecla", tecla: "Escape" });
      }
      if (configuracao.teclas) {
        // O que se digita no campo não chega aos atalhos da página.
        evento.stopImmediatePropagation();
      }
      return;
    }
    if (!configuracao.teclas || estado === null || !estado.ligado) {
      return;
    }
    if (evento.key === "Escape") {
      segurar(evento);
      enviar({ desenho: "tecla", tecla: "Escape" });
      return;
    }
    const comComando = evento.metaKey || evento.ctrlKey;
    if (
      comComando &&
      !evento.shiftKey &&
      !evento.altKey &&
      (evento.code === "KeyZ" || evento.key === "z" || evento.key === "Z") &&
      !editavel(evento.target)
    ) {
      segurar(evento);
      enviar({ desenho: "tecla", tecla: "desfazer" });
    }
  }

  /** Uma div de dentro rolou: os traços presos nela vão junto. A rolagem do documento a camada já acompanha. */
  function aoRolar(evento: Event): void {
    const alvo = evento.target;
    if (alvo === documento || alvo === raiz || alvo === janela) {
      return;
    }
    if (itens.length > 0 || texto !== null || gesto !== null) {
      reposicionar();
    }
  }

  function receber(dados: unknown): void {
    if (destruido) {
      return;
    }
    const novo = lerEstado(dados);
    if (novo === null) {
      return;
    }
    const anterior = estado;
    estado = novo;
    if (gesto === null) {
      limparRascunho();
    }
    if (!novo.ligado) {
      gesto = null;
      limparRascunho();
      descartarTexto();
    } else if (anterior !== null && anterior.ferramenta !== novo.ferramenta) {
      confirmarTexto();
    }
    if (novo.ligado) {
      raiz.setAttribute(LIGADO, novo.ferramenta);
    } else {
      raiz.removeAttribute(LIGADO);
    }
    desenharTudo();
  }

  const escutas: [string, (evento: never) => void][] = [
    ["pointerdown", aoApertar],
    ["pointermove", aoMover],
    ["pointerup", aoSoltar],
    ["pointercancel", aoSoltar],
    ["mousedown", aoClicar],
    ["mouseup", aoClicar],
    ["click", aoClicar],
    ["dblclick", aoClicar],
    ["auxclick", aoClicar],
    ["dragstart", aoClicar],
    ["keydown", aoTeclar],
    ["scroll", aoRolar],
  ];
  for (const [nome, escutar] of escutas) {
    ouvinte.addEventListener(nome, escutar as unknown as EventListener, true);
  }
  janela.addEventListener("resize", agendar);
  janela.addEventListener("load", agendar);

  const Mutacoes = (janela as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver;
  if (typeof Mutacoes === "function") {
    observadorDeMudancas = new Mutacoes((registros) => {
      for (const registro of registros) {
        if (registro.type === "attributes" && registro.attributeName === LIGADO) {
          continue;
        }
        if (daCamada(registro.target)) {
          continue;
        }
        agendar();
        return;
      }
    });
    observadorDeMudancas.observe(raiz, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  function aoFicarPronto(): void {
    desenharTudo();
    enviar({ desenho: "pronto" });
  }
  if (documento.readyState === "loading") {
    documento.addEventListener("DOMContentLoaded", aoFicarPronto, { once: true });
  } else {
    aoFicarPronto();
  }

  function destruir(): void {
    destruido = true;
    for (const [nome, escutar] of escutas) {
      ouvinte.removeEventListener(nome, escutar as unknown as EventListener, true);
    }
    janela.removeEventListener("resize", agendar);
    janela.removeEventListener("load", agendar);
    documento.removeEventListener("DOMContentLoaded", aoFicarPronto);
    observadorDeTamanho?.disconnect();
    observadorDeMudancas?.disconnect();
    cancelarAgendado?.();
    cancelarAgendado = null;
    descartarTexto();
    raiz.removeAttribute(LIGADO);
    if (criouOHospedeiro) {
      hospedeiro?.remove();
    } else {
      hospedeiro?.replaceChildren();
    }
  }

  return { receber, reposicionar, destruir };
}

// ---------------- O script da página HTML ----------------

const CONFIGURACAO_BASE: Omit<ConfiguracaoDoDesenhoNaPagina, "teclas"> = {
  marca: MARCA_DO_DESENHO,
  tipos: TIPOS_DE_TRACO,
  cores: CORES_DO_DESENHO,
  espessuras: ESPESSURAS_DO_DESENHO,
  ferramentas: FERRAMENTAS_NA_PAGINA,
  maximoDeTracos: MAXIMO_DE_TRACOS_NO_DESENHO,
  maximoDePontos: MAXIMO_DE_PONTOS_NO_TRACO,
  maximoDeCaracteres: MAXIMO_DE_CARACTERES_NO_TEXTO,
  maximoDoCaminho: MAXIMO_DO_CAMINHO_DA_ANCORA,
  maiorIndice: MAIOR_INDICE_DO_CAMINHO,
  maximoDoId: MAXIMO_DO_ID,
  distanciaMinima: DISTANCIA_MINIMA_ENTRE_PONTOS_PX,
  raioDaBorracha: RAIO_DA_BORRACHA_PX,
};

/**
 * O script injetado no HTML do artefato, junto do de navegação. Roda dentro do
 * iframe: só aceita mensagens da janela pai (o app), no formato do app; o que
 * manda de volta leva a marca da página.
 */
export const SCRIPT_DO_DESENHO = `(function () {
  var pai = window.parent;
  if (!pai || pai === window) { return; }
  var contas = (${criarContasDoDesenho.toString()})();
  var ancoras = (${criarFuncoesDeAncora.toString()})(${JSON.stringify(MARCA_DO_DESENHO)}, ${MAXIMO_DO_CAMINHO_DA_ANCORA});
  var desenho = (${instalarDesenho.toString()})({
    janela: window,
    raiz: document.documentElement,
    hospedeiro: null,
    ouvinte: window,
    enviar: function (mensagem) {
      mensagem.origem = "${ORIGEM_DA_PAGINA}";
      try { pai.postMessage(mensagem, "*"); } catch (erro) {}
    },
    configuracao: ${JSON.stringify({ ...CONFIGURACAO_BASE, teclas: true })}
  }, contas, ancoras);
  window.addEventListener("message", function (evento) {
    var dados = evento.data;
    if (evento.source !== pai || !dados || dados.origem !== "${ORIGEM_DO_APP}" || dados.acao !== "desenho") { return; }
    desenho.receber(dados.estado);
  });
})();`;

/** `<script>` com a camada de desenho: vai logo depois do de navegação, no começo do HTML. */
export const TAG_DO_SCRIPT_DO_DESENHO = `<script>${SCRIPT_DO_DESENHO}</script>`;

// ---------------- Do lado do app ----------------

/** A âncora lida; `undefined` se malformada (o traço inteiro é recusado). Sem o campo, vale nula. */
function interpretarAncora(valor: unknown): AncoraDoTraco | null | undefined {
  if (valor === null || valor === undefined) {
    return null;
  }
  if (typeof valor !== "object") {
    return undefined;
  }
  const { conteiner, elemento } = valor as Record<string, unknown>;
  const ehCaminho = (caminho: unknown): caminho is number[] =>
    Array.isArray(caminho) &&
    caminho.length <= MAXIMO_DO_CAMINHO_DA_ANCORA &&
    caminho.every((indice) => Number.isInteger(indice) && indice >= 0 && indice <= MAIOR_INDICE_DO_CAMINHO);
  return ehCaminho(conteiner) && ehCaminho(elemento) ? { conteiner: [...conteiner], elemento: [...elemento] } : undefined;
}

/** Um traço gravado, só com os campos dele; nulo se algo estiver fora do esperado. */
export function interpretarTracoGravado(valor: unknown): TracoGravado | null {
  const traco = interpretarTraco(valor);
  if (traco === null || traco.id.length > MAXIMO_DO_ID) {
    return null;
  }
  const ancora = interpretarAncora((valor as Record<string, unknown>).ancora);
  return ancora === undefined ? null : { ...traco, ancora };
}

/** Os traços válidos, na ordem e até o máximo; o traço corrompido sai, os outros ficam. */
export function interpretarTracosGravados(valor: unknown): TracoGravado[] {
  if (!Array.isArray(valor)) {
    return [];
  }
  return valor
    .slice(0, MAXIMO_DE_TRACOS_NO_DESENHO)
    .map(interpretarTracoGravado)
    .filter((traco): traco is TracoGravado => traco !== null);
}

/**
 * A largura de página que vale guardar: inteira (arredondada) e dentro dos
 * limites (fora deles, o limite); nula se não é um número positivo.
 */
export function interpretarLarguraDaPagina(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    return null;
  }
  return Math.min(LARGURA_MAXIMA_DA_PAGINA, Math.max(LARGURA_MINIMA_DA_PAGINA, Math.round(valor)));
}

/**
 * A escala da página montada na largura do desenho para caber na largura
 * disponível: para baixo (a janela do canvas) ou para cima (a tela cheia larga).
 * Nunca abaixo de `ESCALA_MINIMA_DA_PAGINA` (aí a página ganha rolagem lateral).
 * Nula sem largura do desenho ou sem medida: a página flui como sempre.
 */
export function escalaDaPagina(larguraDoDesenho: number | null, disponivel: number): number | null {
  if (larguraDoDesenho === null || larguraDoDesenho <= 0 || !(disponivel > 0)) {
    return null;
  }
  return Math.max(ESCALA_MINIMA_DA_PAGINA, disponivel / larguraDoDesenho);
}

/** A mensagem que a camada mandou, ou nula se não é dela ou está malformada. */
export function lerMensagemDoDesenho(dados: unknown): MensagemDoDesenho | null {
  if (typeof dados !== "object" || dados === null) {
    return null;
  }
  const mensagem = dados as Record<string, unknown>;
  if (mensagem.origem !== ORIGEM_DA_PAGINA) {
    return null;
  }
  switch (mensagem.desenho) {
    case "pronto":
      return { tipo: "pronto" };
    case "traco": {
      const traco = interpretarTracoGravado(mensagem.traco);
      // A largura malformada não derruba o traço: só não serve para guardar.
      return traco === null ? null : { tipo: "traco", traco, largura: interpretarLarguraDaPagina(mensagem.largura) };
    }
    case "apagar": {
      const { ids } = mensagem;
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        ids.length > MAXIMO_DE_TRACOS_NO_DESENHO ||
        !ids.every((id) => typeof id === "string" && id !== "" && id.length <= MAXIMO_DO_ID)
      ) {
        return null;
      }
      return { tipo: "apagar", ids: [...new Set(ids as string[])] };
    }
    case "tecla":
      return mensagem.tecla === "Escape" || mensagem.tecla === "desfazer" ? { tipo: "tecla", tecla: mensagem.tecla } : null;
    default:
      return null;
  }
}

/** As cores e a fonte do desenho, resolvidas do tema do app (o CSS liga `.traco-cor-*` aos tokens). */
export function lerAparenciaDoDesenho(): Pick<EstadoDoDesenho, "cores" | "fonte"> {
  const amostra = document.createElement("span");
  amostra.hidden = true;
  document.body.append(amostra);
  try {
    const cores = {} as Record<CorDoDesenho, string>;
    for (const cor of CORES_DO_DESENHO) {
      amostra.className = `traco-cor-${cor}`;
      cores[cor] = getComputedStyle(amostra).getPropertyValue("--cor-do-traco").trim() || "currentColor";
    }
    const fonte = getComputedStyle(document.documentElement).getPropertyValue("--fonte-titulo").trim() || "sans-serif";
    return { cores, fonte };
  } finally {
    amostra.remove();
  }
}

/**
 * A ponte com a camada da página HTML (no iframe): manda o estado a cada
 * mudança, quando a página carrega e quando ela avisa que está pronta; recebe o
 * que o usuário fez. Só vale a mensagem da janela desse iframe (`evento.source`),
 * já validada. Depois de cada mensagem, o estado vai de novo (a página tira o
 * rascunho quando ele chega).
 */
export function useDesenhoNoQuadro(
  quadro: HTMLIFrameElement | null,
  estado: EstadoDoDesenho,
  aoMensagem: (mensagem: MensagemDoDesenho) => void,
): void {
  const aoMensagemAtual = useRef(aoMensagem);
  useEffect(() => {
    aoMensagemAtual.current = aoMensagem;
  });
  const [pedidos, setPedidos] = useState(0);

  useEffect(() => {
    if (quadro === null) {
      return;
    }
    const aoReceber = (evento: MessageEvent) => {
      if (evento.source === null || evento.source !== quadro.contentWindow) {
        return;
      }
      const mensagem = lerMensagemDoDesenho(evento.data);
      if (mensagem === null) {
        return;
      }
      if (mensagem.tipo !== "pronto") {
        aoMensagemAtual.current(mensagem);
      }
      setPedidos((anterior) => anterior + 1);
    };
    const aoCarregar = () => setPedidos((anterior) => anterior + 1);
    window.addEventListener("message", aoReceber);
    quadro.addEventListener("load", aoCarregar);
    return () => {
      window.removeEventListener("message", aoReceber);
      quadro.removeEventListener("load", aoCarregar);
    };
  }, [quadro]);

  useEffect(() => {
    // A origem do iframe é opaca (sem `allow-same-origin`): só `*` alcança.
    quadro?.contentWindow?.postMessage({ origem: ORIGEM_DO_APP, acao: "desenho", estado }, "*");
  }, [quadro, estado, pedidos]);
}

/**
 * A mesma camada no documento Markdown, que mora no app: instalada na div que
 * rola (`raiz`), dentro do `hospedeiro` (um filho vazio dela). Sem iframe, a
 * conversa é direta, mas passa pela mesma validação.
 */
export function useDesenhoNoDocumento(
  raiz: HTMLElement | null,
  hospedeiro: HTMLElement | null,
  estado: EstadoDoDesenho,
  aoMensagem: (mensagem: MensagemDoDesenho) => void,
): void {
  const aoMensagemAtual = useRef(aoMensagem);
  useEffect(() => {
    aoMensagemAtual.current = aoMensagem;
  });
  const [pedidos, setPedidos] = useState(0);
  const desenho = useRef<DesenhoNaPagina | null>(null);

  useEffect(() => {
    if (raiz === null || hospedeiro === null) {
      return;
    }
    const instalado = instalarDesenho(
      {
        janela: window,
        raiz,
        hospedeiro,
        ouvinte: raiz,
        enviar: (mensagem) => {
          const lida = lerMensagemDoDesenho({ ...mensagem, origem: ORIGEM_DA_PAGINA });
          if (lida !== null && lida.tipo !== "pronto") {
            aoMensagemAtual.current(lida);
          }
          setPedidos((anterior) => anterior + 1);
        },
        // As teclas, no app, quem trata é a tela cheia (Esc) e a barra (Ctrl/Cmd+Z).
        configuracao: { ...CONFIGURACAO_BASE, teclas: false },
      },
      criarContasDoDesenho(),
      criarFuncoesDeAncora(MARCA_DO_DESENHO, MAXIMO_DO_CAMINHO_DA_ANCORA),
    );
    desenho.current = instalado;
    return () => {
      instalado.destruir();
      if (desenho.current === instalado) {
        desenho.current = null;
      }
    };
  }, [raiz, hospedeiro]);

  useEffect(() => {
    desenho.current?.receber(estado);
  }, [raiz, hospedeiro, estado, pedidos]);
}
