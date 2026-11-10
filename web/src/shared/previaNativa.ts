/**
 * Regras da vista nativa da Prévia (app desktop): quando um endereço abre na
 * vista nativa do Electron (sessão própria, login salvo) e onde ela fica na
 * tela. O outro lado está em electron/vistaDaPrevia.js, que repete a regra de
 * "endereço local" e valida tudo de novo: o main não confia na tela.
 */

/**
 * Como a prévia mostra o endereço:
 * - "iframe": localhost e rede interna (o servidor de desenvolvimento);
 * - "vista-nativa": endereço externo no app desktop (login salvo na sessão da prévia);
 * - "nova-aba": endereço externo no navegador comum (sites com login recusam iframe).
 */
export type ModoDaPrevia = "iframe" | "vista-nativa" | "nova-aba";

/** O IPv4 (a.b.c) é da máquina, da rede interna, compartilhado (CGNAT), reservado ou multicast? */
function ipv4EhLocal(a: number, b: number, c: number): boolean {
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

/** Os 8 grupos de 16 bits de um IPv6 (aceita "::" e IPv4 no final), ou null se não for um IPv6 válido. */
function gruposDoIpv6(host: string): number[] | null {
  let texto = host;
  const comPontos = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(texto);
  if (comPontos !== null) {
    const [, inicio = "", a, b, c, d] = comPontos;
    texto = `${inicio}${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`;
  }
  const partes = texto.split("::");
  if (partes.length > 2) {
    return null;
  }
  const separar = (trecho: string): string[] => (trecho === "" ? [] : trecho.split(":"));
  const antes = separar(partes[0] ?? "");
  const depois = partes.length === 2 ? separar(partes[1] ?? "") : [];
  const faltam = 8 - antes.length - depois.length;
  if (partes.length === 2 ? faltam < 1 : faltam !== 0) {
    return null;
  }
  const grupos = [...antes, ...new Array<string>(partes.length === 2 ? faltam : 0).fill("0"), ...depois].map((grupo) =>
    /^[0-9a-f]{1,4}$/.test(grupo) ? parseInt(grupo, 16) : Number.NaN,
  );
  return grupos.some(Number.isNaN) ? null : grupos;
}

/** O host é da própria máquina ou da rede interna? (a mesma regra de ehHostLocal em electron/vistaDaPrevia.js) */
export function ehHostLocal(hostBruto: string): boolean {
  const host = hostBruto.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "" || host === "localhost") {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4 !== null) {
    return ipv4EhLocal(Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3]));
  }
  if (host.includes(":")) {
    // IPv6. Inválido conta como local (recusa).
    const grupos = gruposDoIpv6(host);
    if (grupos === null) {
      return true;
    }
    const g = (indice: number): number => grupos[indice] ?? 0;
    const zeros = (...indices: number[]): boolean => indices.every((indice) => g(indice) === 0);
    // O IPv4 embutido nos dois grupos a partir de `i` (o terceiro octeto vem do grupo seguinte).
    const v4Local = (i: number): boolean => ipv4EhLocal(g(i) >> 8, g(i) & 255, g(i + 1) >> 8);
    return (
      zeros(0, 1, 2, 3, 4, 5) || // ::/96 (inclui ::, ::1 e IPv4 compatível)
      (zeros(0, 1, 2, 3, 4) && g(5) === 0xffff) || // ::ffff:0:0/96 (IPv4 mapeado)
      (g(0) === 0x64 && g(1) === 0xff9b && zeros(2, 3, 4, 5) && v4Local(6)) || // 64:ff9b::/96 (NAT64)
      (g(0) === 0x2002 && v4Local(1)) || // 2002::/16 (6to4)
      (g(0) & 0xfe00) === 0xfc00 || // fc00::/7 (local único)
      (g(0) & 0xffc0) === 0xfe80 || // fe80::/10 (link-local)
      (g(0) & 0xff00) === 0xff00 // ff00::/8 (multicast)
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

/** O endereço aponta para esta máquina ou rede interna? Endereço que não é uma URL conta como local (segue no iframe, como antes). */
export function ehEnderecoLocal(endereco: string): boolean {
  try {
    return ehHostLocal(new URL(endereco).hostname);
  } catch {
    return true;
  }
}

/** Qual das três formas a prévia usa para este endereço. `temVistaNativa`: o app desktop expõe a ponte da prévia. */
export function modoDaPrevia(endereco: string, temVistaNativa: boolean): ModoDaPrevia {
  if (endereco === "" || ehEnderecoLocal(endereco)) {
    return "iframe";
  }
  return temVistaNativa ? "vista-nativa" : "nova-aba";
}

/** Um retângulo na tela (o que `getBoundingClientRect` devolve). */
export interface AreaNaTela {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** O que a vista nativa precisa saber: onde fica (pixels CSS da janela) e a escala do canvas. */
export interface RetanguloDaVista {
  x: number;
  y: number;
  largura: number;
  altura: number;
  zoom: number;
}

/** Menor lado visível, em pixels, para a vista valer a pena (menos que isso, a prévia fica só a foto). */
export const LADO_MINIMO_DA_VISTA_PX = 48;

/**
 * Onde a vista nativa fica: o corpo da prévia na tela (já escalado pelo zoom do
 * canvas e deslocado pelo pan), cortado pela área do canvas, para nunca passar
 * por cima do que está fora dela. `larguraDoLayout` é a largura do corpo sem
 * escala (offsetWidth): a razão entre as duas é o zoom. Nulo se o corpo não
 * está na tela (minimizada, escondida, fora da área) ou sobra menos que
 * `LADO_MINIMO_DA_VISTA_PX`.
 */
export function calcularRetangulo(corpo: AreaNaTela, area: AreaNaTela, larguraDoLayout: number): RetanguloDaVista | null {
  if (!(larguraDoLayout > 0) || !(corpo.width > 0) || !(corpo.height > 0)) {
    return null;
  }
  const esquerda = Math.max(corpo.left, area.left);
  const topo = Math.max(corpo.top, area.top);
  const direita = Math.min(corpo.left + corpo.width, area.left + area.width);
  const base = Math.min(corpo.top + corpo.height, area.top + area.height);
  if (direita - esquerda < LADO_MINIMO_DA_VISTA_PX || base - topo < LADO_MINIMO_DA_VISTA_PX) {
    return null;
  }
  return { x: esquerda, y: topo, largura: direita - esquerda, altura: base - topo, zoom: corpo.width / larguraDoLayout };
}

/** Distância das amostras às bordas, para não cair nas alças de redimensionar nem nas bordas arredondadas. */
const MARGEM_DAS_AMOSTRAS_PX = 8;

/**
 * Nove pontos dentro do retângulo (cantos, meios das bordas e centro), onde se
 * confere se algo da tela (painel, menu, cabeçalho) está por cima da vista.
 */
export function pontosDeAmostra(retangulo: RetanguloDaVista): { x: number; y: number }[] {
  const margemX = Math.min(MARGEM_DAS_AMOSTRAS_PX, retangulo.largura / 2);
  const margemY = Math.min(MARGEM_DAS_AMOSTRAS_PX, retangulo.altura / 2);
  const xs = [retangulo.x + margemX, retangulo.x + retangulo.largura / 2, retangulo.x + retangulo.largura - margemX];
  const ys = [retangulo.y + margemY, retangulo.y + retangulo.altura / 2, retangulo.y + retangulo.altura - margemY];
  return ys.flatMap((y) => xs.map((x) => ({ x, y })));
}

/** Os dois retângulos são o mesmo, até meio pixel? (evita um IPC por quadro quando nada se move) */
export function mesmoRetangulo(a: RetanguloDaVista | null, b: RetanguloDaVista | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.largura - b.largura) < 0.5 &&
    Math.abs(a.altura - b.altura) < 0.5 &&
    Math.abs(a.zoom - b.zoom) < 0.002
  );
}

/** Segundo nível comum sob um TLD de país (co.uk, com.br...): o domínio registrável tem um rótulo a mais. */
const SEGUNDOS_NIVEIS = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "go"]);

/**
 * O domínio registrável aproximado do host (sem lista pública de sufixos): os dois últimos rótulos, ou os
 * três quando o penúltimo é um segundo nível comum de TLD de país (docs.google.com -> google.com;
 * www.exemplo.com.br -> exemplo.com.br). IP e host de uma palavra voltam como estão.
 */
export function dominioRegistravel(hostBruto: string): string {
  const host = hostBruto.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host.includes(":") || /^\d+(\.\d+){3}$/.test(host)) {
    return host;
  }
  const rotulos = host.split(".");
  if (rotulos.length <= 2) {
    return host;
  }
  const ultimo = rotulos[rotulos.length - 1] ?? "";
  const penultimo = rotulos[rotulos.length - 2] ?? "";
  const quantos = ultimo.length === 2 && SEGUNDOS_NIVEIS.has(penultimo) ? 3 : 2;
  return rotulos.slice(-quantos).join(".");
}

/** O host (com porta, se houver) de uma origem ("https://docs.google.com" -> "docs.google.com"); null se não for uma URL http/https. */
export function hostDaOrigem(origem: string | null): string | null {
  if (origem === null) {
    return null;
  }
  try {
    const url = new URL(origem);
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}

/**
 * A página mostrada agora (a origem que o app informa) está num domínio registrável diferente do endereço
 * aberto na prévia? Serve para destacar redirecionamentos e links que levaram a outro site. Sem origem
 * (ainda carregando) ou sem endereço, não há o que comparar: false.
 */
export function mudouDeDominio(enderecoAberto: string, origemAtual: string | null): boolean {
  const atual = hostDaOrigem(origemAtual);
  if (atual === null) {
    return false;
  }
  try {
    return dominioRegistravel(new URL(enderecoAberto).hostname) !== dominioRegistravel(atual.replace(/:\d+$/, ""));
  } catch {
    return false;
  }
}

/** Se o histórico da vista nativa tem para onde ir: os botões ← e → da barra da prévia. */
export interface HistoricoDaVista {
  podeVoltar: boolean;
  podeAvancar: boolean;
}

export const SEM_HISTORICO: HistoricoDaVista = { podeVoltar: false, podeAvancar: false };
