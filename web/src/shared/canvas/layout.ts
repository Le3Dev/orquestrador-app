/**
 * Onde cada coisa fica no canvas. Guardado no navegador (localStorage): é
 * preferência de quem está olhando, não dado do sistema — o histórico dos
 * Orquestradores continua no servidor.
 */

export interface Ponto {
  x: number;
  y: number;
}

export interface RetanguloDoTerminal extends Ponto {
  largura: number;
  altura: number;
}

export interface Viewport extends Ponto {
  zoom: number;
}

/**
 * Onde fica uma nota. `altura` é sempre a da nota aberta: minimizada, ela
 * mostra só a barra de título, e restaurar volta a esta altura.
 */
export interface RetanguloDaNota extends RetanguloDoTerminal {
  minimizada: boolean;
}

export interface LayoutDoCanvas {
  /** Terminais abertos no canvas, por id do Orquestrador. */
  terminais: Record<string, RetanguloDoTerminal>;
  /** Notas no canvas, por id da Nota. Layouts gravados antes das notas não têm o campo: valem como sem notas. */
  notas: Record<string, RetanguloDaNota>;
  viewport: Viewport | null;
}

/**
 * Os bixinhos que o usuário limpou do canvas num Orquestrador. Só o último
 * pedido tem bixinhos na tela, então basta guardar os daquele pedido: um
 * pedido novo torna a lista inútil, e a próxima limpeza a substitui — ela
 * não cresce sem limite.
 */
export interface BixinhosLimpos {
  turnoId: string;
  subagentes: readonly string[];
}

export const TAMANHO_DO_TERMINAL = { largura: 600, altura: 520 } as const;
export const TAMANHO_MINIMO_DO_TERMINAL = { largura: 420, altura: 300 } as const;
export const TAMANHO_DO_RASCUNHO = { largura: 640, altura: 620 } as const;
export const TAMANHO_DO_BIXINHO = { largura: 150, altura: 170 } as const;
export const TAMANHO_DA_NOTA = { largura: 320, altura: 280 } as const;
export const TAMANHO_MINIMO_DA_NOTA = { largura: 220, altura: 140 } as const;
/** Altura da nota minimizada: só a barra de título (38px) e a borda. */
export const ALTURA_DA_NOTA_MINIMIZADA = 40;

const ESPACO_ENTRE_BIXINHOS = 18;
const BIXINHOS_POR_FILEIRA = 5;
/** Distância entre a base do terminal e a primeira fileira de bixinhos. */
const DISTANCIA_DO_TERMINAL = 80;
const DESLOCAMENTO_EM_CASCATA = 36;
const ESPACO_ENTRE_TERMINAIS = 120;
const ESPACO_ENTRE_NOTAS = 24;
const NOTAS_POR_COLUNA = 4;

const CHAVE = "orquestrador-agentes:canvas:v1";
const CHAVE_DOS_BIXINHOS_LIMPOS = `${CHAVE}:bixinhos-limpos`;

function ehNumero(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

function ehRetangulo(valor: unknown): valor is RetanguloDoTerminal {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const { x, y, largura, altura } = valor as Record<string, unknown>;
  return ehNumero(x) && ehNumero(y) && ehNumero(largura) && ehNumero(altura);
}

function ehViewport(valor: unknown): valor is Viewport {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const { x, y, zoom } = valor as Record<string, unknown>;
  return ehNumero(x) && ehNumero(y) && ehNumero(zoom) && zoom > 0;
}

/** As notas válidas do layout salvo; sem `minimizada`, a nota fica aberta. */
function interpretarNotas(notas: unknown): Record<string, RetanguloDaNota> {
  const validas: Record<string, RetanguloDaNota> = {};
  if (typeof notas !== "object" || notas === null) {
    return validas;
  }
  for (const [id, retangulo] of Object.entries(notas)) {
    if (ehRetangulo(retangulo)) {
      const { x, y, largura, altura } = retangulo;
      validas[id] = { x, y, largura, altura, minimizada: (retangulo as { minimizada?: unknown }).minimizada === true };
    }
  }
  return validas;
}

/** Lê o layout salvo, descartando o que estiver corrompido em vez de quebrar a tela. */
export function interpretarLayout(texto: string | null): LayoutDoCanvas {
  const vazio: LayoutDoCanvas = { terminais: {}, notas: {}, viewport: null };
  if (texto === null) {
    return vazio;
  }
  try {
    const salvo: unknown = JSON.parse(texto);
    if (typeof salvo !== "object" || salvo === null) {
      return vazio;
    }
    const { terminais, notas, viewport } = salvo as Record<string, unknown>;
    const validos: Record<string, RetanguloDoTerminal> = {};
    if (typeof terminais === "object" && terminais !== null) {
      for (const [id, retangulo] of Object.entries(terminais)) {
        if (ehRetangulo(retangulo)) {
          validos[id] = retangulo;
        }
      }
    }
    return { terminais: validos, notas: interpretarNotas(notas), viewport: ehViewport(viewport) ? viewport : null };
  } catch {
    return vazio;
  }
}

export function lerLayout(): LayoutDoCanvas {
  try {
    return interpretarLayout(localStorage.getItem(CHAVE));
  } catch {
    return { terminais: {}, notas: {}, viewport: null };
  }
}

export function salvarLayout(layout: LayoutDoCanvas): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(layout));
  } catch {
    // Sem armazenamento: o canvas só não é lembrado no próximo acesso.
  }
}

function ehBixinhosLimpos(valor: unknown): valor is BixinhosLimpos {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const { turnoId, subagentes } = valor as Record<string, unknown>;
  return (
    typeof turnoId === "string" &&
    Array.isArray(subagentes) &&
    subagentes.every((subagente) => typeof subagente === "string")
  );
}

/** Lê os bixinhos limpos, por id do Orquestrador, descartando o que estiver corrompido. */
export function interpretarBixinhosLimpos(texto: string | null): Map<string, BixinhosLimpos> {
  const validos = new Map<string, BixinhosLimpos>();
  if (texto === null) {
    return validos;
  }
  try {
    const salvo: unknown = JSON.parse(texto);
    if (typeof salvo !== "object" || salvo === null || Array.isArray(salvo)) {
      return validos;
    }
    for (const [orquestradorId, limpos] of Object.entries(salvo)) {
      if (ehBixinhosLimpos(limpos)) {
        validos.set(orquestradorId, { turnoId: limpos.turnoId, subagentes: [...limpos.subagentes] });
      }
    }
    return validos;
  } catch {
    return new Map();
  }
}

export function lerBixinhosLimpos(): ReadonlyMap<string, BixinhosLimpos> {
  try {
    return interpretarBixinhosLimpos(localStorage.getItem(CHAVE_DOS_BIXINHOS_LIMPOS));
  } catch {
    return new Map();
  }
}

export function salvarBixinhosLimpos(limpezas: ReadonlyMap<string, BixinhosLimpos>): void {
  try {
    localStorage.setItem(CHAVE_DOS_BIXINHOS_LIMPOS, JSON.stringify(Object.fromEntries(limpezas)));
  } catch {
    // Sem armazenamento: os bixinhos limpos só voltam no próximo acesso.
  }
}

/**
 * Posições dos bixinhos em relação ao terminal: fileiras centralizadas logo
 * abaixo dele, de até cinco por fileira, para as linhas descerem em leque.
 */
export function posicoesDosBixinhos(quantidade: number, larguraDoTerminal: number, alturaDoTerminal: number): Ponto[] {
  const posicoes: Ponto[] = [];
  for (let indice = 0; indice < quantidade; indice++) {
    const fileira = Math.floor(indice / BIXINHOS_POR_FILEIRA);
    const naFileira = Math.min(BIXINHOS_POR_FILEIRA, quantidade - fileira * BIXINHOS_POR_FILEIRA);
    const posicaoNaFileira = indice % BIXINHOS_POR_FILEIRA;
    const larguraDaFileira = naFileira * TAMANHO_DO_BIXINHO.largura + (naFileira - 1) * ESPACO_ENTRE_BIXINHOS;
    posicoes.push({
      x: larguraDoTerminal / 2 - larguraDaFileira / 2 + posicaoNaFileira * (TAMANHO_DO_BIXINHO.largura + ESPACO_ENTRE_BIXINHOS),
      y: alturaDoTerminal + DISTANCIA_DO_TERMINAL + fileira * (TAMANHO_DO_BIXINHO.altura + ESPACO_ENTRE_BIXINHOS),
    });
  }
  return posicoes;
}

/**
 * Onde abrir um terminal novo: centralizado no ponto pedido, deslocado em
 * cascata se já houver um terminal exatamente ali — abrir vários seguidos
 * não os empilha um sobre o outro.
 */
export function posicaoParaNovoTerminal(
  centro: Ponto,
  tamanho: { largura: number; altura: number },
  ocupados: readonly Ponto[],
): Ponto {
  let posicao = { x: Math.round(centro.x - tamanho.largura / 2), y: Math.round(centro.y - tamanho.altura / 2) };
  const muitoPerto = (outro: Ponto): boolean =>
    Math.abs(outro.x - posicao.x) < DESLOCAMENTO_EM_CASCATA / 2 && Math.abs(outro.y - posicao.y) < DESLOCAMENTO_EM_CASCATA / 2;

  for (let tentativa = 0; tentativa < 20 && ocupados.some(muitoPerto); tentativa++) {
    posicao = { x: posicao.x + DESLOCAMENTO_EM_CASCATA, y: posicao.y + DESLOCAMENTO_EM_CASCATA };
  }
  return posicao;
}

/** Uma janela do canvas (terminal, rascunho ou nota) a organizar. */
export interface JanelaParaOrganizar {
  id: string;
  largura: number;
  altura: number;
}

/** A largura que um terminal ocupa na grade: a dele ou a de uma fileira de bixinhos, a maior. */
function larguraNaGrade(largura: number): number {
  return Math.max(largura, BIXINHOS_POR_FILEIRA * (TAMANHO_DO_BIXINHO.largura + ESPACO_ENTRE_BIXINHOS));
}

/**
 * "Organizar": terminais lado a lado, em colunas, com espaço abaixo de cada
 * um para os bixinhos.
 */
export function organizarEmGrade(terminais: readonly JanelaParaOrganizar[], colunas = 3): Record<string, Ponto> {
  const espacoParaBixinhos = DISTANCIA_DO_TERMINAL + 2 * (TAMANHO_DO_BIXINHO.altura + ESPACO_ENTRE_BIXINHOS) + 40;
  const posicoes: Record<string, Ponto> = {};
  let y = 0;

  for (let inicio = 0; inicio < terminais.length; inicio += colunas) {
    const fileira = terminais.slice(inicio, inicio + colunas);
    let x = 0;
    for (const terminal of fileira) {
      posicoes[terminal.id] = { x, y };
      x += larguraNaGrade(terminal.largura) + ESPACO_ENTRE_TERMINAIS;
    }
    y += Math.max(...fileira.map((terminal) => terminal.altura)) + espacoParaBixinhos;
  }
  return posicoes;
}

/**
 * "Organizar" com notas: os terminais na grade de sempre e as notas em
 * colunas de até quatro, à direita dela. A grade não muda por causa das
 * notas — elas não têm bixinhos nem precisam do espaço reservado a eles.
 */
export function organizarComNotas(
  terminais: readonly JanelaParaOrganizar[],
  notas: readonly JanelaParaOrganizar[],
): Record<string, Ponto> {
  const posicoes = organizarEmGrade(terminais);
  let x = terminais.reduce(
    (direita, terminal) =>
      Math.max(direita, (posicoes[terminal.id]?.x ?? 0) + larguraNaGrade(terminal.largura) + ESPACO_ENTRE_TERMINAIS),
    0,
  );

  for (let inicio = 0; inicio < notas.length; inicio += NOTAS_POR_COLUNA) {
    const coluna = notas.slice(inicio, inicio + NOTAS_POR_COLUNA);
    let y = 0;
    for (const nota of coluna) {
      posicoes[nota.id] = { x, y };
      y += nota.altura + ESPACO_ENTRE_NOTAS;
    }
    x += Math.max(...coluna.map((nota) => nota.largura)) + ESPACO_ENTRE_NOTAS;
  }
  return posicoes;
}
