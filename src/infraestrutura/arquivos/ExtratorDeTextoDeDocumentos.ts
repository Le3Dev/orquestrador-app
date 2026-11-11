import { inflateRawSync } from "node:zlib";

import { formatarTamanho } from "../../orquestracao/ArquivosAnexados";

/**
 * Extrai o texto de documentos do Office (.docx, .xlsx, .pptx) só com o Node:
 * eles são arquivos zip de XML, e o `node:zlib` já descompacta. Um leitor de zip
 * mínimo cobre o que os documentos usam (métodos 0 e 8), sem dependências.
 *
 * O arquivo vem do usuário e pode ser um zip bomb: há tetos de entradas e de
 * bytes descompactados, e o texto final é cortado num teto também.
 */

/** O arquivo não pôde ser lido como documento; a mensagem diz o motivo, em português. */
export class ErroDeExtracaoDeTexto extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeExtracaoDeTexto";
  }
}

export interface LimitesDaExtracao {
  /** Entradas do zip, no máximo. */
  entradas: number;
  /** Bytes descompactados de uma entrada, no máximo. */
  bytesPorEntrada: number;
  /** Bytes descompactados no total (todas as entradas lidas), no máximo. */
  bytesNoTotal: number;
  /** Caracteres do texto extraído, no máximo: o que passa é cortado, com um aviso no fim. */
  caracteresDoTexto: number;
}

export const LIMITES_DA_EXTRACAO: Readonly<LimitesDaExtracao> = {
  entradas: 5_000,
  bytesPorEntrada: 50 * 1024 * 1024,
  bytesNoTotal: 150 * 1024 * 1024,
  caracteresDoTexto: 5 * 1024 * 1024,
};

/** Extensões de que sabemos extrair o texto. */
export const EXTENSOES_COM_TEXTO_EXTRAIVEL: readonly string[] = ["docx", "xlsx", "pptx"];

/**
 * O texto do documento, ou nulo se a extensão não é de um formato que sabemos
 * ler. Lança `ErroDeExtracaoDeTexto` se o arquivo está corrompido ou passa dos tetos.
 */
export function extrairTextoDoDocumento(
  extensao: string,
  conteudo: Uint8Array,
  limites: Partial<LimitesDaExtracao> = {},
): string | null {
  const efetivos: LimitesDaExtracao = { ...LIMITES_DA_EXTRACAO, ...limites };
  switch (extensao.toLowerCase()) {
    case "docx":
      return textoDoDocx(new LeitorDeZip(conteudo, efetivos), efetivos);
    case "xlsx":
      return textoDoXlsx(new LeitorDeZip(conteudo, efetivos), efetivos);
    case "pptx":
      return textoDoPptx(new LeitorDeZip(conteudo, efetivos), efetivos);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Zip

const ASSINATURA_DO_FIM_DO_DIRETORIO = 0x06054b50;
const ASSINATURA_DO_DIRETORIO_CENTRAL = 0x02014b50;
const ASSINATURA_DO_CABECALHO_LOCAL = 0x04034b50;
const TAMANHO_MINIMO_DO_FIM_DO_DIRETORIO = 22;
const TAMANHO_MAXIMO_DO_COMENTARIO = 0xffff;
const TAMANHO_DO_CABECALHO_CENTRAL = 46;
const TAMANHO_DO_CABECALHO_LOCAL = 30;

const ARQUIVO_INVALIDO = "O arquivo não é um documento do Office válido (está corrompido ou incompleto).";

interface EntradaDoZip {
  metodo: number;
  tamanhoCompactado: number;
  tamanhoDeclarado: number;
  deslocamentoDoCabecalho: number;
}

class LeitorDeZip {
  private readonly dados: Buffer;
  private readonly entradas = new Map<string, EntradaDoZip>();
  private descompactadoNoTotal = 0;

  constructor(
    conteudo: Uint8Array,
    private readonly limites: LimitesDaExtracao,
  ) {
    this.dados = Buffer.from(conteudo.buffer, conteudo.byteOffset, conteudo.byteLength);
    this.lerDiretorioCentral();
  }

  nomes(): string[] {
    return [...this.entradas.keys()];
  }

  /** O conteúdo da entrada em UTF-8, ou nulo se o zip não tem essa entrada. */
  lerTexto(nome: string): string | null {
    const entrada = this.entradas.get(nome);
    if (entrada === undefined) {
      return null;
    }
    const texto = this.descompactar(entrada).toString("utf8");
    return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  }

  private lerDiretorioCentral(): void {
    const { dados } = this;
    const fim = this.acharFimDoDiretorio();
    const total = dados.readUInt16LE(fim + 10);
    const deslocamento = dados.readUInt32LE(fim + 16);
    if (total === 0xffff || deslocamento === 0xffffffff) {
      throw new ErroDeExtracaoDeTexto("O documento usa o formato ZIP64, que não é suportado.");
    }
    if (total > this.limites.entradas) {
      throw new ErroDeExtracaoDeTexto(
        `O arquivo tem entradas demais (${total}; o máximo é ${this.limites.entradas}) e foi recusado por segurança.`,
      );
    }

    let posicao = deslocamento;
    for (let indice = 0; indice < total; indice += 1) {
      if (
        posicao + TAMANHO_DO_CABECALHO_CENTRAL > dados.length ||
        dados.readUInt32LE(posicao) !== ASSINATURA_DO_DIRETORIO_CENTRAL
      ) {
        throw new ErroDeExtracaoDeTexto(ARQUIVO_INVALIDO);
      }
      const marcas = dados.readUInt16LE(posicao + 8);
      const tamanhoDoNome = dados.readUInt16LE(posicao + 28);
      const tamanhoDoExtra = dados.readUInt16LE(posicao + 30);
      const tamanhoDoComentario = dados.readUInt16LE(posicao + 32);
      const fimDoNome = posicao + TAMANHO_DO_CABECALHO_CENTRAL + tamanhoDoNome;
      if (fimDoNome > dados.length) {
        throw new ErroDeExtracaoDeTexto(ARQUIVO_INVALIDO);
      }
      if ((marcas & 0x1) !== 0) {
        throw new ErroDeExtracaoDeTexto("O documento está protegido por senha e não dá para ler o texto dele.");
      }
      const nome = dados.toString("utf8", posicao + TAMANHO_DO_CABECALHO_CENTRAL, fimDoNome);
      if (!this.entradas.has(nome)) {
        this.entradas.set(nome, {
          metodo: dados.readUInt16LE(posicao + 10),
          tamanhoCompactado: dados.readUInt32LE(posicao + 20),
          tamanhoDeclarado: dados.readUInt32LE(posicao + 24),
          deslocamentoDoCabecalho: dados.readUInt32LE(posicao + 42),
        });
      }
      posicao = fimDoNome + tamanhoDoExtra + tamanhoDoComentario;
    }
  }

  /** Procura, do fim para o começo, o registro que aponta para o diretório central. */
  private acharFimDoDiretorio(): number {
    const { dados } = this;
    const maisAlto = dados.length - TAMANHO_MINIMO_DO_FIM_DO_DIRETORIO;
    const maisBaixo = Math.max(0, maisAlto - TAMANHO_MAXIMO_DO_COMENTARIO);
    for (let posicao = maisAlto; posicao >= maisBaixo; posicao -= 1) {
      if (dados.readUInt32LE(posicao) === ASSINATURA_DO_FIM_DO_DIRETORIO) {
        return posicao;
      }
    }
    throw new ErroDeExtracaoDeTexto(ARQUIVO_INVALIDO);
  }

  private descompactar(entrada: EntradaDoZip): Buffer {
    const { dados } = this;
    const teto = Math.min(this.limites.bytesPorEntrada, this.limites.bytesNoTotal - this.descompactadoNoTotal);
    // O tamanho declarado pode mentir, mas recusar cedo evita o trabalho quando ele já passa do teto.
    if (entrada.tamanhoDeclarado > teto) {
      throw this.recusaPorTamanho();
    }

    const cabecalho = entrada.deslocamentoDoCabecalho;
    if (
      cabecalho + TAMANHO_DO_CABECALHO_LOCAL > dados.length ||
      dados.readUInt32LE(cabecalho) !== ASSINATURA_DO_CABECALHO_LOCAL
    ) {
      throw new ErroDeExtracaoDeTexto(ARQUIVO_INVALIDO);
    }
    const inicio = cabecalho + TAMANHO_DO_CABECALHO_LOCAL + dados.readUInt16LE(cabecalho + 26) + dados.readUInt16LE(cabecalho + 28);
    const fim = inicio + entrada.tamanhoCompactado;
    if (fim > dados.length) {
      throw new ErroDeExtracaoDeTexto(ARQUIVO_INVALIDO);
    }
    const compactado = dados.subarray(inicio, fim);

    let conteudo: Buffer;
    if (entrada.metodo === 0) {
      if (compactado.length > teto) {
        throw this.recusaPorTamanho();
      }
      conteudo = compactado;
    } else if (entrada.metodo === 8) {
      try {
        conteudo = inflateRawSync(compactado, { maxOutputLength: Math.max(teto, 1) });
      } catch (erro) {
        if (erro instanceof RangeError || (erro as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE") {
          throw this.recusaPorTamanho();
        }
        throw new ErroDeExtracaoDeTexto(ARQUIVO_INVALIDO);
      }
    } else {
      throw new ErroDeExtracaoDeTexto("O documento usa uma compressão que não é suportada.");
    }
    this.descompactadoNoTotal += conteudo.length;
    return conteudo;
  }

  private recusaPorTamanho(): ErroDeExtracaoDeTexto {
    return new ErroDeExtracaoDeTexto(
      "O documento descompactado é grande demais (possível zip bomb) e foi recusado por segurança.",
    );
  }
}

// ---------------------------------------------------------------------------
// XML

/** Uma tag (`nome` e `atributos`) ou um trecho de texto (`texto`); o que não se aplica fica vazio. */
interface TokenDoXml {
  tipo: "abre" | "fecha" | "vazio" | "texto";
  nome: string;
  atributos: string;
  texto: string;
}

/** Comentário, instrução, CDATA (1), tag (2: `/` de fechamento, 3: nome, 4: atributos, 5: `/` de vazio) ou texto (6). */
const PEDACO_DE_XML = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;

/** Percorre o XML na ordem, sem montar a árvore. O nome da tag vem sem o prefixo do espaço de nomes (`w:t` vira `t`). */
function* tokensDoXml(xml: string): Generator<TokenDoXml> {
  for (const pedaco of xml.matchAll(PEDACO_DE_XML)) {
    const [, cdata, fechamento, nomeCompleto, atributos, vazio, texto] = pedaco;
    if (cdata !== undefined) {
      yield { tipo: "texto", nome: "", atributos: "", texto: cdata };
    } else if (nomeCompleto !== undefined) {
      yield {
        tipo: fechamento === "/" ? "fecha" : vazio === "/" ? "vazio" : "abre",
        nome: nomeCompleto.slice(nomeCompleto.indexOf(":") + 1),
        atributos: atributos ?? "",
        texto: "",
      };
    } else if (texto !== undefined) {
      yield { tipo: "texto", nome: "", atributos: "", texto: decodificarEntidades(texto) };
    }
  }
}

const ENTIDADE_DO_XML = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;

const ENTIDADES_NOMEADAS: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodificarEntidades(texto: string): string {
  if (!texto.includes("&")) {
    return texto;
  }
  return texto.replace(ENTIDADE_DO_XML, (original, entidade: string) => {
    if (entidade.startsWith("#")) {
      const codigo = entidade[1] === "x" ? parseInt(entidade.slice(2), 16) : parseInt(entidade.slice(1), 10);
      return Number.isInteger(codigo) && codigo >= 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : original;
    }
    return ENTIDADES_NOMEADAS[entidade] ?? original;
  });
}

/** Os atributos de uma tag, com o prefixo do espaço de nomes tirado do nome (`r:id` vira `id`) e as entidades decodificadas. */
function atributosDaTag(atributos: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const achado of atributos.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const nome = (achado[1] ?? "").slice((achado[1] ?? "").indexOf(":") + 1);
    mapa.set(nome, decodificarEntidades(achado[2] ?? achado[3] ?? ""));
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Texto de saída

/** Acumula o texto até o teto; o que passa é descartado e o fim ganha um aviso. */
class Saida {
  private readonly partes: string[] = [];
  private tamanho = 0;
  private cortada = false;

  constructor(private readonly limite: number) {}

  /** Verdadeiro quando já passou do teto: quem lê pode parar. */
  get cheia(): boolean {
    return this.cortada;
  }

  adicionar(texto: string): void {
    if (this.cortada) {
      return;
    }
    const sobra = this.limite - this.tamanho;
    if (texto.length > sobra) {
      this.partes.push(texto.slice(0, Math.max(sobra, 0)));
      this.tamanho = this.limite;
      this.cortada = true;
      return;
    }
    this.partes.push(texto);
    this.tamanho += texto.length;
  }

  resultado(): string {
    const texto = this.partes.join("").trimEnd();
    return this.cortada
      ? `${texto}\n\n[Texto cortado aqui: o documento passa do limite de ${formatarTamanho(this.limite)} de texto extraído.]`
      : texto;
  }
}

// ---------------------------------------------------------------------------
// Word

function textoDoDocx(zip: LeitorDeZip, limites: LimitesDaExtracao): string {
  const xml = zip.lerTexto("word/document.xml");
  if (xml === null) {
    throw new ErroDeExtracaoDeTexto("O arquivo não parece ser um documento do Word (não tem word/document.xml).");
  }
  const saida = new Saida(limites.caracteresDoTexto);
  let dentroDoTexto = false;
  for (const token of tokensDoXml(xml)) {
    if (token.tipo === "texto") {
      if (dentroDoTexto) {
        saida.adicionar(token.texto);
      }
    } else if (token.nome === "t") {
      dentroDoTexto = token.tipo === "abre";
    } else if (token.tipo === "fecha" && token.nome === "p") {
      saida.adicionar("\n");
    } else if (token.tipo !== "fecha" && (token.nome === "br" || token.nome === "cr")) {
      saida.adicionar("\n");
    } else if (token.tipo === "vazio" && token.nome === "tab" && token.atributos.trim() === "") {
      // `<w:tab w:val=…/>` dentro de `<w:tabs>` define uma parada de tabulação; só a tag sem atributos é o caractere.
      saida.adicionar("\t");
    }
    if (saida.cheia) {
      break;
    }
  }
  return saida.resultado();
}

// ---------------------------------------------------------------------------
// PowerPoint

function textoDoPptx(zip: LeitorDeZip, limites: LimitesDaExtracao): string {
  const slides = zip
    .nomes()
    .map((nome) => ({ nome, numero: /^ppt\/slides\/slide(\d+)\.xml$/.exec(nome)?.[1] }))
    .filter((slide): slide is { nome: string; numero: string } => slide.numero !== undefined)
    .map((slide) => ({ nome: slide.nome, numero: Number(slide.numero) }))
    .sort((a, b) => a.numero - b.numero);
  if (slides.length === 0) {
    throw new ErroDeExtracaoDeTexto("O arquivo não parece ser uma apresentação do PowerPoint (não tem slides).");
  }

  const saida = new Saida(limites.caracteresDoTexto);
  for (const slide of slides) {
    const xml = zip.lerTexto(slide.nome) ?? "";
    saida.adicionar(`## Slide ${slide.numero}\n`);
    let dentroDoTexto = false;
    for (const token of tokensDoXml(xml)) {
      if (token.tipo === "texto") {
        if (dentroDoTexto) {
          saida.adicionar(token.texto);
        }
      } else if (token.nome === "t") {
        dentroDoTexto = token.tipo === "abre";
      } else if ((token.tipo === "fecha" && token.nome === "p") || (token.tipo !== "fecha" && token.nome === "br")) {
        saida.adicionar("\n");
      }
      if (saida.cheia) {
        break;
      }
    }
    saida.adicionar("\n");
    if (saida.cheia) {
      break;
    }
  }
  return saida.resultado();
}

// ---------------------------------------------------------------------------
// Excel

/** Colunas além de XFD (a última do Excel) não existem: a referência é lixo. */
const MAXIMO_DE_COLUNAS = 16_384;

function indiceDaColuna(referencia: string): number | null {
  const letras = /^([A-Za-z]{1,3})\d*$/.exec(referencia)?.[1];
  if (letras === undefined) {
    return null;
  }
  let indice = 0;
  for (const letra of letras.toUpperCase()) {
    indice = indice * 26 + (letra.charCodeAt(0) - 64);
  }
  return indice - 1 < MAXIMO_DE_COLUNAS ? indice - 1 : null;
}

function lerStringsCompartilhadas(zip: LeitorDeZip): string[] {
  const xml = zip.lerTexto("xl/sharedStrings.xml");
  if (xml === null) {
    return [];
  }
  const itens: string[] = [];
  let atual: string | null = null;
  let dentroDoTexto = false;
  let dentroDoFonetico = false;
  for (const token of tokensDoXml(xml)) {
    if (token.tipo === "texto") {
      if (atual !== null && dentroDoTexto && !dentroDoFonetico) {
        atual += token.texto;
      }
    } else if (token.nome === "si") {
      if (token.tipo === "abre") {
        atual = "";
      } else if (token.tipo === "fecha") {
        itens.push(atual ?? "");
        atual = null;
      } else {
        itens.push("");
      }
    } else if (token.nome === "rPh") {
      dentroDoFonetico = token.tipo === "abre";
    } else if (token.nome === "t") {
      dentroDoTexto = token.tipo === "abre";
    }
  }
  return itens;
}

interface PlanilhaDoXlsx {
  nome: string;
  entrada: string;
}

/** `Target` de uma relação do workbook, relativo à pasta `xl/` (ou absoluto, com `/`), vira o caminho dentro do zip. */
function caminhoDoAlvo(alvo: string): string {
  const partes = (alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`).split("/");
  const resolvido: string[] = [];
  for (const parte of partes) {
    if (parte === "..") {
      resolvido.pop();
    } else if (parte !== "." && parte !== "") {
      resolvido.push(parte);
    }
  }
  return resolvido.join("/");
}

function listarPlanilhas(zip: LeitorDeZip): PlanilhaDoXlsx[] {
  const doWorkbook: PlanilhaDoXlsx[] = [];
  const workbook = zip.lerTexto("xl/workbook.xml");
  const relacoes = zip.lerTexto("xl/_rels/workbook.xml.rels");
  if (workbook !== null && relacoes !== null) {
    const alvos = new Map<string, string>();
    for (const token of tokensDoXml(relacoes)) {
      if (token.tipo !== "fecha" && token.nome === "Relationship") {
        const atributos = atributosDaTag(token.atributos);
        const id = atributos.get("Id");
        const alvo = atributos.get("Target");
        if (id !== undefined && alvo !== undefined) {
          alvos.set(id, caminhoDoAlvo(alvo));
        }
      }
    }
    for (const token of tokensDoXml(workbook)) {
      if (token.tipo !== "fecha" && token.nome === "sheet") {
        const atributos = atributosDaTag(token.atributos);
        const entrada = alvos.get(atributos.get("id") ?? "");
        if (entrada !== undefined) {
          doWorkbook.push({ nome: atributos.get("name") ?? `Planilha ${doWorkbook.length + 1}`, entrada });
        }
      }
    }
  }
  if (doWorkbook.length > 0) {
    return doWorkbook;
  }

  // Sem o workbook (ou sem relações): as planilhas na ordem do número do arquivo.
  return zip
    .nomes()
    .map((nome) => ({ nome, numero: /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(nome)?.[1] }))
    .filter((planilha): planilha is { nome: string; numero: string } => planilha.numero !== undefined)
    .map((planilha) => ({ entrada: planilha.nome, numero: Number(planilha.numero) }))
    .sort((a, b) => a.numero - b.numero)
    .map((planilha) => ({ nome: `Planilha ${planilha.numero}`, entrada: planilha.entrada }));
}

interface CelulaEmLeitura {
  coluna: number | null;
  tipo: string;
  valor: string;
}

/** Quebra de linha e tabulação dentro de uma célula estragariam as colunas: viram espaço. */
function valorDaCelula(celula: CelulaEmLeitura, strings: readonly string[]): string {
  let valor = celula.valor;
  if (celula.tipo === "s") {
    valor = strings[Number(celula.valor)] ?? "";
  } else if (celula.tipo === "b") {
    valor = celula.valor.trim() === "1" ? "VERDADEIRO" : "FALSO";
  }
  return valor.replace(/[\t\r\n]+/g, " ");
}

/** Uma linha de texto por `<row>`, as células separadas por tab, respeitando a coluna de cada uma. */
function escreverPlanilha(xml: string, strings: readonly string[], saida: Saida): void {
  let linha: string[] | null = null;
  let ultimaColuna = -1;
  let celula: CelulaEmLeitura | null = null;
  let dentroDoValor = false;
  let dentroDoTextoEmLinha = false;
  let dentroDoTexto = false;

  const guardar = (concluida: CelulaEmLeitura) => {
    if (linha === null || concluida.coluna === null) {
      return;
    }
    while (linha.length < concluida.coluna) {
      linha.push("");
    }
    linha[concluida.coluna] = valorDaCelula(concluida, strings);
  };

  for (const token of tokensDoXml(xml)) {
    if (token.tipo === "texto") {
      if (celula !== null && (dentroDoValor || (dentroDoTextoEmLinha && dentroDoTexto))) {
        celula.valor += token.texto;
      }
      continue;
    }
    switch (token.nome) {
      case "row":
        if (token.tipo === "abre") {
          linha = [];
          ultimaColuna = -1;
        } else if (token.tipo === "fecha") {
          const preenchida = linha?.some((valor) => valor !== "") === true;
          if (linha !== null && preenchida) {
            let ultima = linha.length - 1;
            while (ultima > 0 && linha[ultima] === "") {
              ultima -= 1;
            }
            saida.adicionar(`${linha.slice(0, ultima + 1).join("\t")}\n`);
          }
          linha = null;
        }
        break;
      case "c": {
        if (token.tipo === "fecha") {
          if (celula !== null) {
            guardar(celula);
            ultimaColuna = celula.coluna ?? ultimaColuna;
          }
          celula = null;
          dentroDoValor = dentroDoTextoEmLinha = dentroDoTexto = false;
        } else {
          const atributos = atributosDaTag(token.atributos);
          const referencia = atributos.get("r");
          const coluna = referencia === undefined ? ultimaColuna + 1 : indiceDaColuna(referencia);
          if (token.tipo === "abre") {
            celula = { coluna, tipo: atributos.get("t") ?? "n", valor: "" };
          } else if (coluna !== null) {
            // Célula vazia, só com estilo: ocupa a posição, sem valor.
            ultimaColuna = coluna;
          }
        }
        break;
      }
      case "v":
        dentroDoValor = token.tipo === "abre";
        break;
      case "is":
        dentroDoTextoEmLinha = token.tipo === "abre";
        break;
      case "t":
        dentroDoTexto = token.tipo === "abre";
        break;
      default:
        break;
    }
    if (saida.cheia) {
      return;
    }
  }
}

function textoDoXlsx(zip: LeitorDeZip, limites: LimitesDaExtracao): string {
  const planilhas = listarPlanilhas(zip);
  if (planilhas.length === 0) {
    throw new ErroDeExtracaoDeTexto("O arquivo não parece ser uma planilha do Excel (não tem planilhas).");
  }
  const strings = lerStringsCompartilhadas(zip);
  const saida = new Saida(limites.caracteresDoTexto);
  for (const planilha of planilhas) {
    const xml = zip.lerTexto(planilha.entrada);
    if (xml === null) {
      continue;
    }
    saida.adicionar(`## ${planilha.nome}\n`);
    escreverPlanilha(xml, strings, saida);
    saida.adicionar("\n");
    if (saida.cheia) {
      break;
    }
  }
  return saida.resultado();
}
