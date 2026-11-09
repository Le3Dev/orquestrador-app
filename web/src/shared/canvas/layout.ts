/**
 * Onde cada coisa fica no canvas. Guardado no navegador (localStorage): é
 * preferência de quem está olhando, não dado do sistema — o histórico dos
 * Orquestradores continua no servidor.
 */

export interface Ponto {
  x: number;
  y: number;
}

/** Um retângulo no canvas: o canto superior esquerdo e o tamanho. */
export interface Retangulo extends Ponto {
  largura: number;
  altura: number;
}

/**
 * O tamanho da letra de um terminal (e do rascunho): o zoom do conteúdo do
 * cartão. A barra de título e as alças de redimensionar ficam no tamanho normal.
 */
export const ESCALAS_DA_LETRA = [1, 1.15, 1.3] as const;
export type EscalaDaLetra = (typeof ESCALAS_DA_LETRA)[number];
export const ESCALA_DA_LETRA_PADRAO: EscalaDaLetra = 1;
/** As opções do campo "Tamanho da letra", na criação e no ⚙ do terminal. */
export const OPCOES_DA_ESCALA_DA_LETRA: readonly { valor: EscalaDaLetra; titulo: string }[] = [
  { valor: 1, titulo: "Normal" },
  { valor: 1.15, titulo: "Grande" },
  { valor: 1.3, titulo: "Maior" },
];

export function ehEscalaDaLetra(valor: unknown): valor is EscalaDaLetra {
  return ESCALAS_DA_LETRA.some((escala) => escala === valor);
}

/**
 * Onde fica um terminal. Sem `escalaDaLetra` (layouts antigos), a letra é a
 * normal. Sem `minimizada`, o terminal está aberto; minimizado (as bolinhas
 * do Mac), mostra só a barra de título, e `altura` continua a do terminal aberto.
 * `ligados`: os ids dos nós (notas, prévias e artefatos) que o usuário ligou
 * ao terminal, na ordem em que ligou; sem o campo, nenhum.
 */
export interface RetanguloDoTerminal extends Retangulo {
  escalaDaLetra?: EscalaDaLetra;
  minimizada?: boolean;
  ligados?: string[];
}

export interface Viewport extends Ponto {
  zoom: number;
}

/**
 * Onde fica uma nota. `altura` é sempre a da nota aberta: minimizada, ela
 * mostra só a barra de título, e restaurar volta a esta altura.
 */
export interface RetanguloDaNota extends Retangulo {
  minimizada: boolean;
}

/**
 * Uma prévia ao vivo (um navegador dentro do canvas): onde fica, o endereço
 * aberto (vazio enquanto o usuário não digita um) e o Orquestrador de cujo
 * terminal ela saiu (nulo quando foi aberta pela barra do canvas).
 */
export interface RetanguloDaPrevia extends RetanguloDaNota {
  url: string;
  orquestradorId: string | null;
}

/**
 * Um terminal de shell no canvas (o bloco "Terminal"): onde fica, o id do
 * terminal no servidor (para religar ao recarregar a página), a pasta em que
 * ele abriu e o Orquestrador a que está ligado (nulo quando aberto pela barra
 * do canvas).
 */
export interface RetanguloDoShell extends Retangulo {
  terminalId: string;
  pasta: string;
  orquestradorId: string | null;
}

export interface LayoutDoCanvas {
  /** Terminais abertos no canvas, por id do Orquestrador. */
  terminais: Record<string, RetanguloDoTerminal>;
  /** Notas no canvas, por id da Nota. Layouts gravados antes das notas não têm o campo: valem como sem notas. */
  notas: Record<string, RetanguloDaNota>;
  /**
   * Janelas de artefatos abertas no canvas, por id do Artefato. Fechar só tira
   * daqui; layouts gravados antes dos artefatos não têm o campo: valem como
   * nenhum aberto.
   */
  artefatos: Record<string, Retangulo>;
  /** Prévias no canvas, pelo id criado na tela. Layouts gravados antes delas não têm o campo: valem como sem prévias. */
  previas: Record<string, RetanguloDaPrevia>;
  /** Terminais de shell no canvas, pelo id criado na tela. Layouts gravados antes deles não têm o campo: valem como nenhum. */
  shells: Record<string, RetanguloDoShell>;
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
// A criação mostra tudo de uma vez: no tamanho padrão, o formulário cabe sem rolar.
export const TAMANHO_DO_RASCUNHO = { largura: 760, altura: 720 } as const;
export const TAMANHO_DO_BIXINHO = { largura: 150, altura: 170 } as const;
export const TAMANHO_DA_NOTA = { largura: 320, altura: 280 } as const;
export const TAMANHO_MINIMO_DA_NOTA = { largura: 220, altura: 140 } as const;
/** Altura da nota minimizada: só a barra de título (38px) e a borda. */
export const ALTURA_DA_NOTA_MINIMIZADA = 40;
export const TAMANHO_DA_PREVIA = { largura: 720, altura: 520 } as const;
export const TAMANHO_MINIMO_DA_PREVIA = { largura: 360, altura: 240 } as const;
/** A prévia minimizada também fica só com a barra de título, da mesma altura da nota. */
export const ALTURA_DA_PREVIA_MINIMIZADA = ALTURA_DA_NOTA_MINIMIZADA;
export const TAMANHO_DO_SHELL = { largura: 640, altura: 400 } as const;
export const TAMANHO_MINIMO_DO_SHELL = { largura: 320, altura: 180 } as const;
export const TAMANHO_DO_ARTEFATO = { largura: 640, altura: 480 } as const;
export const TAMANHO_MINIMO_DO_ARTEFATO = { largura: 320, altura: 200 } as const;

const ESPACO_ENTRE_BIXINHOS = 18;
const BIXINHOS_POR_FILEIRA = 5;
/** Distância entre a base do terminal e a primeira fileira de bixinhos. */
const DISTANCIA_DO_TERMINAL = 80;
const DESLOCAMENTO_EM_CASCATA = 36;
const ESPACO_ENTRE_TERMINAIS = 120;
const ESPACO_ENTRE_NOTAS = 24;
/** Distância entre o terminal e a prévia que abre ao lado dele. */
const ESPACO_ATE_A_PREVIA = 60;
const NOTAS_POR_COLUNA = 4;
/** Folga mínima entre o grupo de bixinhos e as outras janelas (e bixinhos) do canvas. */
export const MARGEM_DOS_BIXINHOS = 24;
/** Quantas vezes, no máximo, o grupo desce procurando um lugar livre abaixo do terminal. */
const TENTATIVAS_DESCENDO = 50;
/** Folga entre uma janela aberta numa área livre e o que já está no canvas (`posicaoLivrePerto`). */
const MARGEM_DA_AREA_LIVRE = 40;
/** Colunas (à direita) e fileiras (abaixo) que `posicaoLivrePerto` testa antes de abrir abaixo de tudo. */
const PASSOS_DA_VARREDURA = 6;

const CHAVE = "orquestrador-agentes:canvas:v1";
/** Os nós que se ligam a um terminal (`ligados`), pelo prefixo do id: notas, prévias e artefatos. */
const PREFIXOS_DOS_ITENS_LIGAVEIS = ["nota:", "previa:", "artefato:"] as const;
const CHAVE_DOS_BIXINHOS_LIMPOS = `${CHAVE}:bixinhos-limpos`;

function ehNumero(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

function ehRetangulo(valor: unknown): valor is Retangulo {
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

/**
 * As prévias válidas do layout salvo, validadas como as notas. Um endereço
 * que não é http(s) vira vazio (a prévia abre pedindo outro); sem
 * Orquestrador, a prévia fica solta.
 */
function interpretarPrevias(previas: unknown): Record<string, RetanguloDaPrevia> {
  const validas: Record<string, RetanguloDaPrevia> = {};
  if (typeof previas !== "object" || previas === null) {
    return validas;
  }
  for (const [id, retangulo] of Object.entries(previas)) {
    if (ehRetangulo(retangulo)) {
      const { x, y, largura, altura } = retangulo;
      const { minimizada, url, orquestradorId } = retangulo as { minimizada?: unknown; url?: unknown; orquestradorId?: unknown };
      validas[id] = {
        x,
        y,
        largura,
        altura,
        minimizada: minimizada === true,
        url: typeof url === "string" && /^https?:\/\//i.test(url) ? url : "",
        orquestradorId: typeof orquestradorId === "string" ? orquestradorId : null,
      };
    }
  }
  return validas;
}

/**
 * Os terminais de shell válidos do layout salvo: sem o id do terminal no
 * servidor ou sem a pasta, o bloco não teria a que religar nem onde abrir de
 * novo, e sai. Sem Orquestrador, o bloco fica solto.
 */
function interpretarShells(shells: unknown): Record<string, RetanguloDoShell> {
  const validos: Record<string, RetanguloDoShell> = {};
  if (typeof shells !== "object" || shells === null) {
    return validos;
  }
  for (const [id, retangulo] of Object.entries(shells)) {
    if (!ehRetangulo(retangulo)) {
      continue;
    }
    const { x, y, largura, altura } = retangulo;
    const { terminalId, pasta, orquestradorId } = retangulo as {
      terminalId?: unknown;
      pasta?: unknown;
      orquestradorId?: unknown;
    };
    if (typeof terminalId === "string" && terminalId !== "" && typeof pasta === "string" && pasta !== "") {
      validos[id] = {
        x,
        y,
        largura,
        altura,
        terminalId,
        pasta,
        orquestradorId: typeof orquestradorId === "string" ? orquestradorId : null,
      };
    }
  }
  return validos;
}

/** Os retângulos válidos de um grupo do layout salvo (os artefatos); só os campos do retângulo. */
function interpretarRetangulos(grupo: unknown): Record<string, Retangulo> {
  const validos: Record<string, Retangulo> = {};
  if (typeof grupo !== "object" || grupo === null) {
    return validos;
  }
  for (const [id, retangulo] of Object.entries(grupo)) {
    if (ehRetangulo(retangulo)) {
      const { x, y, largura, altura } = retangulo;
      validos[id] = { x, y, largura, altura };
    }
  }
  return validos;
}

/** Os itens ligados válidos de um terminal salvo: ids de nota, prévia ou artefato, sem repetição. */
function interpretarLigados(ligados: unknown): string[] {
  if (!Array.isArray(ligados)) {
    return [];
  }
  const validos = ligados.filter(
    (id): id is string =>
      typeof id === "string" && PREFIXOS_DOS_ITENS_LIGAVEIS.some((prefixo) => id.startsWith(prefixo) && id.length > prefixo.length),
  );
  return [...new Set(validos)];
}

/**
 * Os terminais válidos do layout salvo; um tamanho da letra fora das opções
 * vale como o normal, e sem `minimizada: true` o terminal fica aberto (os dois
 * sem o campo, como nos layouts antigos). Sem `ligados` (ou só com ids
 * inválidos), o terminal fica sem itens ligados, e o campo nem aparece.
 */
function interpretarTerminais(terminais: unknown): Record<string, RetanguloDoTerminal> {
  const validos: Record<string, RetanguloDoTerminal> = {};
  if (typeof terminais !== "object" || terminais === null) {
    return validos;
  }
  for (const [id, retangulo] of Object.entries(terminais)) {
    if (ehRetangulo(retangulo)) {
      const { x, y, largura, altura } = retangulo;
      const { escalaDaLetra, minimizada } = retangulo as { escalaDaLetra?: unknown; minimizada?: unknown };
      const ligados = interpretarLigados((retangulo as { ligados?: unknown }).ligados);
      validos[id] = {
        x,
        y,
        largura,
        altura,
        ...(ehEscalaDaLetra(escalaDaLetra) && escalaDaLetra !== ESCALA_DA_LETRA_PADRAO ? { escalaDaLetra } : {}),
        ...(minimizada === true ? { minimizada: true } : {}),
        ...(ligados.length > 0 ? { ligados } : {}),
      };
    }
  }
  return validos;
}

function layoutVazio(): LayoutDoCanvas {
  return { terminais: {}, notas: {}, artefatos: {}, previas: {}, shells: {}, viewport: null };
}

/** Lê o layout salvo, descartando o que estiver corrompido em vez de quebrar a tela. */
export function interpretarLayout(texto: string | null): LayoutDoCanvas {
  if (texto === null) {
    return layoutVazio();
  }
  try {
    const salvo: unknown = JSON.parse(texto);
    if (typeof salvo !== "object" || salvo === null) {
      return layoutVazio();
    }
    const { terminais, notas, artefatos, previas, shells, viewport } = salvo as Record<string, unknown>;
    return {
      terminais: interpretarTerminais(terminais),
      notas: interpretarNotas(notas),
      artefatos: interpretarRetangulos(artefatos),
      previas: interpretarPrevias(previas),
      shells: interpretarShells(shells),
      viewport: ehViewport(viewport) ? viewport : null,
    };
  } catch {
    return layoutVazio();
  }
}

export function lerLayout(): LayoutDoCanvas {
  try {
    return interpretarLayout(localStorage.getItem(CHAVE));
  } catch {
    return layoutVazio();
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

/** Se dois retângulos se sobrepõem; só encostar não conta. */
export function sobrepoe(a: Retangulo, b: Retangulo): boolean {
  return a.x < b.x + b.largura && b.x < a.x + a.largura && a.y < b.y + b.altura && b.y < a.y + a.altura;
}

/** O retângulo que envolve os bixinhos nas posições dadas. */
function contornoDosBixinhos(posicoes: readonly Ponto[]): Retangulo {
  const xs = posicoes.map((posicao) => posicao.x);
  const ys = posicoes.map((posicao) => posicao.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    largura: Math.max(...xs) + TAMANHO_DO_BIXINHO.largura - x,
    altura: Math.max(...ys) + TAMANHO_DO_BIXINHO.altura - y,
  };
}

/**
 * As posições dos bixinhos em relação ao terminal, no mesmo arranjo em
 * fileiras de `posicoesDosBixinhos`, mas num lugar em que o grupo (com a
 * folga de `MARGEM_DOS_BIXINHOS`) não fique por cima de nenhum obstáculo
 * (`terminal` e `obstaculos` em coordenadas absolutas). Tenta, nesta ordem:
 * abaixo e centralizado (o padrão); à direita do terminal; à esquerda; acima;
 * e abaixo, descendo em passos até passar dos obstáculos. Se nada servir,
 * fica o padrão. Sem conflito, o resultado é exatamente o padrão.
 */
export function posicoesLivresDosBixinhos(
  quantidade: number,
  terminal: Retangulo,
  obstaculos: readonly Retangulo[],
): Ponto[] {
  const padrao = posicoesDosBixinhos(quantidade, terminal.largura, terminal.altura);
  if (padrao.length === 0 || obstaculos.length === 0) {
    return padrao;
  }
  const bloco = contornoDosBixinhos(padrao);
  // O lugar que o grupo ocupa, com a folga ao redor, deslocado do padrão.
  const ocupado = (deslocamento: Ponto): Retangulo => ({
    x: terminal.x + bloco.x + deslocamento.x - MARGEM_DOS_BIXINHOS,
    y: terminal.y + bloco.y + deslocamento.y - MARGEM_DOS_BIXINHOS,
    largura: bloco.largura + 2 * MARGEM_DOS_BIXINHOS,
    altura: bloco.altura + 2 * MARGEM_DOS_BIXINHOS,
  });
  const noCaminho = (deslocamento: Ponto): Retangulo[] =>
    obstaculos.filter((obstaculo) => sobrepoe(ocupado(deslocamento), obstaculo));

  const candidatos: Ponto[] = [
    // Abaixo, centralizado: o padrão.
    { x: 0, y: 0 },
    // À direita, com o topo do grupo alinhado ao do terminal.
    { x: terminal.largura + DISTANCIA_DO_TERMINAL - bloco.x, y: -bloco.y },
    // À esquerda, idem.
    { x: -DISTANCIA_DO_TERMINAL - bloco.largura - bloco.x, y: -bloco.y },
    // Acima, centralizado.
    { x: 0, y: -DISTANCIA_DO_TERMINAL - bloco.altura - bloco.y },
  ];
  let escolhido = candidatos.find((candidato) => noCaminho(candidato).length === 0);

  // Abaixo, descendo: cada passo leva o grupo até logo abaixo do obstáculo mais baixo no caminho.
  let descendo: Ponto = { x: 0, y: 0 };
  for (let tentativa = 0; escolhido === undefined && tentativa < TENTATIVAS_DESCENDO; tentativa++) {
    const bloqueios = noCaminho(descendo);
    if (bloqueios.length === 0) {
      escolhido = descendo;
    } else {
      const base = Math.max(...bloqueios.map((obstaculo) => obstaculo.y + obstaculo.altura));
      descendo = { x: 0, y: descendo.y + base - ocupado(descendo).y };
    }
  }

  if (escolhido === undefined || (escolhido.x === 0 && escolhido.y === 0)) {
    return padrao;
  }
  const { x, y } = escolhido;
  return padrao.map((posicao) => ({ x: posicao.x + x, y: posicao.y + y }));
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

/**
 * A primeira área livre para uma janela do tamanho dado, perto de `inicio`
 * (onde ela abriria, ex.: centralizada na vista): o próprio `inicio` se nada
 * estiver no caminho (com a folga de `MARGEM_DA_AREA_LIVRE`); senão, varre à
 * direita e depois as fileiras abaixo, em passos do tamanho da janela mais a
 * folga. Sem lugar na varredura, abre logo abaixo de tudo, alinhada a
 * `inicio`. `obstaculos` em coordenadas absolutas (janelas e bixinhos).
 */
export function posicaoLivrePerto(
  inicio: Ponto,
  tamanho: { largura: number; altura: number },
  obstaculos: readonly Retangulo[],
): Ponto {
  const comFolga = (ponto: Ponto): Retangulo => ({
    x: ponto.x - MARGEM_DA_AREA_LIVRE,
    y: ponto.y - MARGEM_DA_AREA_LIVRE,
    largura: tamanho.largura + 2 * MARGEM_DA_AREA_LIVRE,
    altura: tamanho.altura + 2 * MARGEM_DA_AREA_LIVRE,
  });
  const livre = (ponto: Ponto): boolean => !obstaculos.some((obstaculo) => sobrepoe(comFolga(ponto), obstaculo));
  const arredondar = ({ x, y }: Ponto): Ponto => ({ x: Math.round(x), y: Math.round(y) });

  for (let fileira = 0; fileira < PASSOS_DA_VARREDURA; fileira++) {
    for (let coluna = 0; coluna < PASSOS_DA_VARREDURA; coluna++) {
      const candidato = {
        x: inicio.x + coluna * (tamanho.largura + MARGEM_DA_AREA_LIVRE),
        y: inicio.y + fileira * (tamanho.altura + MARGEM_DA_AREA_LIVRE),
      };
      if (livre(candidato)) {
        return arredondar(candidato);
      }
    }
  }
  const base = Math.max(...obstaculos.map((obstaculo) => obstaculo.y + obstaculo.altura));
  return arredondar({ x: inicio.x, y: base + MARGEM_DA_AREA_LIVRE });
}

/**
 * Onde abrir a prévia de um terminal: à direita dele, com o topo alinhado; se
 * algo estiver no caminho, à esquerda, abaixo ou acima; e, sem nenhum lugar
 * livre, à direita mesmo. `terminal` e `obstaculos` em coordenadas absolutas.
 */
export function posicaoAoLado(
  terminal: Retangulo,
  tamanho: { largura: number; altura: number },
  obstaculos: readonly Retangulo[],
): Ponto {
  const candidatos: Ponto[] = [
    { x: terminal.x + terminal.largura + ESPACO_ATE_A_PREVIA, y: terminal.y },
    { x: terminal.x - ESPACO_ATE_A_PREVIA - tamanho.largura, y: terminal.y },
    { x: terminal.x, y: terminal.y + terminal.altura + ESPACO_ATE_A_PREVIA },
    { x: terminal.x, y: terminal.y - ESPACO_ATE_A_PREVIA - tamanho.altura },
  ];
  const livre = candidatos.find(
    (candidato) => !obstaculos.some((obstaculo) => sobrepoe({ ...candidato, ...tamanho }, obstaculo)),
  );
  const { x, y } = livre ?? candidatos[0] ?? terminal;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * O tamanho do cartão ao trocar o tamanho da letra (de `anterior` para
 * `nova`): largura e altura mudam na mesma proporção. Ao crescer, não passa do
 * padrão do cartão na maior letra (nem encolhe um cartão que já é maior que
 * isso); ao diminuir, não fica menor que o mínimo.
 */
export function tamanhoNaEscalaDaLetra(
  atual: { largura: number; altura: number },
  anterior: EscalaDaLetra,
  nova: EscalaDaLetra,
  padrao: { largura: number; altura: number },
  minimo: { largura: number; altura: number },
): { largura: number; altura: number } {
  const fator = nova / anterior;
  const maior = Math.max(...ESCALAS_DA_LETRA);
  const ajustar = (medida: number, padraoDaMedida: number, minimoDaMedida: number): number =>
    Math.round(
      fator >= 1
        ? Math.max(medida, Math.min(medida * fator, padraoDaMedida * maior))
        : Math.max(medida * fator, minimoDaMedida),
    );
  return {
    largura: ajustar(atual.largura, padrao.largura, minimo.largura),
    altura: ajustar(atual.altura, padrao.altura, minimo.altura),
  };
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
 *
 * Os artefatos seguem nas mesmas colunas, depois das notas, começando numa
 * coluna própria: uma página larga não alarga a coluna das notas.
 */
export function organizarComNotas(
  terminais: readonly JanelaParaOrganizar[],
  notas: readonly JanelaParaOrganizar[],
  artefatos: readonly JanelaParaOrganizar[] = [],
): Record<string, Ponto> {
  const posicoes = organizarEmGrade(terminais);
  let x = terminais.reduce(
    (direita, terminal) =>
      Math.max(direita, (posicoes[terminal.id]?.x ?? 0) + larguraNaGrade(terminal.largura) + ESPACO_ENTRE_TERMINAIS),
    0,
  );

  for (const grupo of [notas, artefatos]) {
    for (let inicio = 0; inicio < grupo.length; inicio += NOTAS_POR_COLUNA) {
      const coluna = grupo.slice(inicio, inicio + NOTAS_POR_COLUNA);
      let y = 0;
      for (const janela of coluna) {
        posicoes[janela.id] = { x, y };
        y += janela.altura + ESPACO_ENTRE_NOTAS;
      }
      x += Math.max(...coluna.map((janela) => janela.largura)) + ESPACO_ENTRE_NOTAS;
    }
  }
  return posicoes;
}

/** Uma janela do canvas com o lugar que ocupa: o que as ações do grupo (alinhar, distribuir, lado a lado) recebem. */
export interface JanelaNoCanvas extends Retangulo {
  id: string;
}

/** Os lados e os centros pelos quais `alinharJanelas` alinha o grupo. */
export type Alinhamento = "esquerda" | "centro" | "direita" | "topo" | "meio" | "base";
/** O eixo em que `distribuirJanelas` reparte o espaço. */
export type EixoDaDistribuicao = "horizontal" | "vertical";

/**
 * Folga entre as janelas que a barra do grupo organiza: lado a lado, o vão
 * mínimo do distribuir e o desvio do alinhar quando duas cairiam uma sobre a outra.
 */
export const MARGEM_DO_LADO_A_LADO = 40;

/** O retângulo que envolve todas as janelas (nulo sem nenhuma). */
function contornoDasJanelas(janelas: readonly Retangulo[]): Retangulo | null {
  if (janelas.length === 0) {
    return null;
  }
  const x = Math.min(...janelas.map((janela) => janela.x));
  const y = Math.min(...janelas.map((janela) => janela.y));
  return {
    x,
    y,
    largura: Math.max(...janelas.map((janela) => janela.x + janela.largura)) - x,
    altura: Math.max(...janelas.map((janela) => janela.y + janela.altura)) - y,
  };
}

/** As janelas nas posições dadas (as sem posição ficam onde estão). */
function nasPosicoes(janelas: readonly JanelaNoCanvas[], posicoes: Readonly<Record<string, Ponto>>): JanelaNoCanvas[] {
  return janelas.map((janela) => ({ ...janela, ...posicoes[janela.id] }));
}

/**
 * Tira as janelas de cima umas das outras andando só no eixo dado (`y` desce,
 * `x` vai para a direita): na ordem em que estavam nesse eixo (empate: a
 * ordem no outro eixo), cada uma que
 * cairia sobre uma já acomodada passa para logo depois dela, com `margem`. As
 * que não colidem ficam exatamente onde estão.
 */
function semSobreporNoEixo(
  janelas: readonly JanelaNoCanvas[],
  posicoes: Readonly<Record<string, Ponto>>,
  eixo: "x" | "y",
  margem: number,
): Record<string, Ponto> {
  const outroEixo = eixo === "x" ? "y" : "x";
  // Empatadas no eixo (ex.: a mesma coluna), vai antes a que vinha antes no outro.
  const ordenadas = [...janelas].sort(
    (a, b) => a[eixo] - b[eixo] || a[outroEixo] - b[outroEixo] || a.id.localeCompare(b.id),
  );
  const acomodadas: Retangulo[] = [];
  const resultado: Record<string, Ponto> = { ...posicoes };
  const medida = eixo === "x" ? "largura" : "altura";
  for (const janela of ordenadas) {
    const lugar: JanelaNoCanvas = { ...janela, ...posicoes[janela.id] };
    // Cada passo leva a janela para depois da mais distante que ela cobre; só avança, então termina.
    let cobertas = acomodadas.filter((outra) => sobrepoe(lugar, outra));
    while (cobertas.length > 0) {
      lugar[eixo] = Math.max(...cobertas.map((outra) => outra[eixo] + outra[medida])) + margem;
      cobertas = acomodadas.filter((outra) => sobrepoe(lugar, outra));
    }
    acomodadas.push(lugar);
    resultado[janela.id] = { x: Math.round(lugar.x), y: Math.round(lugar.y) };
  }
  return resultado;
}

/**
 * Se alguma janela do grupo, nas posições novas, cair sobre uma das `outras`
 * (as telas fora da seleção), o grupo inteiro vai para a área livre mais
 * perto (`posicaoLivrePerto`, a partir do canto do grupo), sem mudar o
 * arranjo entre elas. Sem colisão, as posições ficam como estão.
 */
function foraDasOutras(
  janelas: readonly JanelaNoCanvas[],
  posicoes: Record<string, Ponto>,
  outras: readonly Retangulo[],
): Record<string, Ponto> {
  const movidas = nasPosicoes(janelas, posicoes);
  const contorno = contornoDasJanelas(movidas);
  if (contorno === null || !movidas.some((janela) => outras.some((outra) => sobrepoe(janela, outra)))) {
    return posicoes;
  }
  const destino = posicaoLivrePerto(contorno, contorno, outras);
  const dx = destino.x - contorno.x;
  const dy = destino.y - contorno.y;
  return Object.fromEntries(
    movidas.map((janela) => [janela.id, { x: Math.round(janela.x + dx), y: Math.round(janela.y + dy) }]),
  );
}

/**
 * Alinha as janelas pelo contorno do grupo, como num editor de design: à
 * esquerda, ao centro ou à direita (só muda o x); ao topo, ao meio ou à base
 * (só muda o y). Duas que cairiam uma sobre a outra (ex.: alinhar ao topo
 * janelas empilhadas na mesma coluna) se afastam o mínimo no outro eixo, com
 * `MARGEM_DO_LADO_A_LADO`; e, se o grupo cair sobre uma das `outras` (as telas
 * fora da seleção), vai inteiro para a área livre mais perto. Devolve a
 * posição nova de cada uma, arredondada.
 */
export function alinharJanelas(
  janelas: readonly JanelaNoCanvas[],
  como: Alinhamento,
  outras: readonly Retangulo[] = [],
): Record<string, Ponto> {
  const contorno = contornoDasJanelas(janelas);
  const posicoes: Record<string, Ponto> = {};
  if (contorno === null) {
    return posicoes;
  }
  const direita = contorno.x + contorno.largura;
  const base = contorno.y + contorno.altura;
  for (const janela of janelas) {
    const x =
      como === "esquerda"
        ? contorno.x
        : como === "direita"
          ? direita - janela.largura
          : como === "centro"
            ? contorno.x + (contorno.largura - janela.largura) / 2
            : janela.x;
    const y =
      como === "topo"
        ? contorno.y
        : como === "base"
          ? base - janela.altura
          : como === "meio"
            ? contorno.y + (contorno.altura - janela.altura) / 2
            : janela.y;
    posicoes[janela.id] = { x: Math.round(x), y: Math.round(y) };
  }
  // Alinhar na horizontal (muda o x) desvia no y; na vertical, no x.
  const desvio = como === "esquerda" || como === "centro" || como === "direita" ? "y" : "x";
  return foraDasOutras(janelas, semSobreporNoEixo(janelas, posicoes, desvio, MARGEM_DO_LADO_A_LADO), outras);
}

/**
 * Reparte o espaço do grupo num eixo: a primeira e a última janela (na ordem
 * do eixo) ficam nas pontas do contorno e as do meio ganham o mesmo vão entre
 * vizinhas. Se o vão ficaria menor que `MARGEM_DO_LADO_A_LADO` (ou negativo,
 * quando as medidas somam mais que o contorno), vale a margem, e o grupo
 * cresce a partir da primeira. O outro eixo não muda; se o grupo cair sobre
 * uma das `outras`, vai inteiro para a área livre mais perto. Com menos de
 * três janelas, nada se move.
 */
export function distribuirJanelas(
  janelas: readonly JanelaNoCanvas[],
  eixo: EixoDaDistribuicao,
  outras: readonly Retangulo[] = [],
): Record<string, Ponto> {
  const posicoes: Record<string, Ponto> = Object.fromEntries(
    janelas.map((janela) => [janela.id, { x: janela.x, y: janela.y }]),
  );
  const contorno = contornoDasJanelas(janelas);
  if (contorno === null || janelas.length < 3) {
    return posicoes;
  }
  const horizontal = eixo === "horizontal";
  const inicio = (janela: Retangulo): number => (horizontal ? janela.x : janela.y);
  const medida = (janela: Retangulo): number => (horizontal ? janela.largura : janela.altura);
  const ordenadas = [...janelas].sort((a, b) => inicio(a) - inicio(b) || a.id.localeCompare(b.id));
  const total = horizontal ? contorno.largura : contorno.altura;
  const vao = Math.max(
    MARGEM_DO_LADO_A_LADO,
    (total - ordenadas.reduce((soma, janela) => soma + medida(janela), 0)) / (ordenadas.length - 1),
  );
  let cursor = horizontal ? contorno.x : contorno.y;
  for (const janela of ordenadas) {
    const lugar = Math.round(cursor);
    posicoes[janela.id] = horizontal ? { x: lugar, y: janela.y } : { x: janela.x, y: lugar };
    cursor += medida(janela) + vao;
  }
  return foraDasOutras(janelas, posicoes, outras);
}

/**
 * As janelas na ordem de leitura: em faixas de cima para baixo (uma janela
 * que começa antes da metade da primeira da faixa ainda é da mesma faixa) e,
 * em cada faixa, da esquerda para a direita.
 */
function emOrdemDeLeitura(janelas: readonly JanelaNoCanvas[]): JanelaNoCanvas[] {
  const porTopo = [...janelas].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const faixas: JanelaNoCanvas[][] = [];
  for (const janela of porTopo) {
    const faixa = faixas.at(-1);
    const primeira = faixa?.[0];
    if (faixa !== undefined && primeira !== undefined && janela.y < primeira.y + primeira.altura / 2) {
      faixa.push(janela);
    } else {
      faixas.push([janela]);
    }
  }
  return faixas.flatMap((faixa) => faixa.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id)));
}

/**
 * "Lado a lado" da barra do grupo: as janelas numa grade simples a partir do
 * canto superior esquerdo do grupo, na ordem de leitura atual, com
 * `MARGEM_DO_LADO_A_LADO` entre elas. Até três ficam numa fileira só; mais
 * que isso, a grade é quase quadrada (4 viram 2 × 2; 5 a 9, três por
 * fileira). Cada fileira tem a altura da janela mais alta dela. Se a grade
 * cair sobre uma das `outras` (as telas fora da seleção), vai inteira para a
 * área livre mais perto.
 */
export function janelasLadoALado(
  janelas: readonly JanelaNoCanvas[],
  margem: number = MARGEM_DO_LADO_A_LADO,
  outras: readonly Retangulo[] = [],
): Record<string, Ponto> {
  const posicoes: Record<string, Ponto> = {};
  const contorno = contornoDasJanelas(janelas);
  if (contorno === null) {
    return posicoes;
  }
  const colunas = janelas.length <= 3 ? janelas.length : Math.ceil(Math.sqrt(janelas.length));
  const ordenadas = emOrdemDeLeitura(janelas);
  let y = contorno.y;
  for (let inicio = 0; inicio < ordenadas.length; inicio += colunas) {
    const fileira = ordenadas.slice(inicio, inicio + colunas);
    let x = contorno.x;
    for (const janela of fileira) {
      posicoes[janela.id] = { x: Math.round(x), y: Math.round(y) };
      x += janela.largura + margem;
    }
    y += Math.max(...fileira.map((janela) => janela.altura)) + margem;
  }
  return foraDasOutras(janelas, posicoes, outras);
}
