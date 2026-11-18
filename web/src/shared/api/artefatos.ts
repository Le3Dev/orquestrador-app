import type { TracoDoDesenho } from "../canvas/layout";
import { ErroDaApi } from "./cliente";

/**
 * Artefatos: páginas HTML ou documentos Markdown criados pelos agentes. O
 * conteúdo de cada versão fica no servidor; a tela só mostra (num iframe
 * isolado, para HTML) e guarda no navegador onde cada janela está.
 */

export type FormatoDoArtefato = "html" | "markdown";

/** Quem criou o artefato: um Orquestrador (com o id dele) ou o chat rápido (id nulo). */
export interface OrigemDoArtefato {
  tipo: "orquestrador" | "chat";
  id: string | null;
}

export interface VersaoDoArtefato {
  numero: number;
  criadaEm: string;
  /** Em bytes. */
  tamanho: number;
}

export interface ResumoDoArtefato {
  id: string;
  titulo: string;
  formato: FormatoDoArtefato;
  origem: OrigemDoArtefato;
  /** O nome do arquivo (ex.: "relatorio.html"), usado no "salvar como…". */
  arquivo: string;
  criadoEm: string;
  atualizadoEm: string;
  versaoAtual: number;
  versoes: VersaoDoArtefato[];
}

/**
 * Onde o traço feito sobre a página está preso: o contêiner que rola (caminho
 * de índices dos filhos elemento, a partir da raiz do documento) e o elemento
 * dentro dele (caminho a partir do contêiner). Ver `desenhoNaPagina.ts`.
 */
export interface AncoraDoTraco {
  conteiner: number[];
  elemento: number[];
}

/**
 * Um traço do desenho sobre a página de uma versão do artefato, como o servidor
 * guarda: os campos do traço do canvas, com os pontos relativos ao canto
 * superior esquerdo do elemento âncora; sem âncora (`null`), em coordenadas
 * do documento.
 */
export interface TracoGravado extends TracoDoDesenho {
  ancora: AncoraDoTraco | null;
}

/**
 * O desenho de uma versão: os traços e a largura da página (em px CSS do
 * documento) quando o primeiro traço foi feito. Com largura, a página é sempre
 * montada nela e reduzida (ou ampliada) para caber; nula, a página flui como sempre.
 */
export interface DesenhoGravado {
  tracos: TracoGravado[];
  largura: number | null;
}

/** Os eventos ao vivo de `GET /api/artefatos/eventos` (sem histórico). */
export type EventoDeArtefato =
  | { tipo: "artefato_criado"; artefato: ResumoDoArtefato }
  | { tipo: "versao_adicionada"; artefato: ResumoDoArtefato }
  | { tipo: "artefato_renomeado"; artefato: ResumoDoArtefato }
  | { tipo: "artefato_removido"; id: string };

export type TipoDeEventoDeArtefato = EventoDeArtefato["tipo"];

export const TIPOS_DE_EVENTO_DE_ARTEFATO: readonly TipoDeEventoDeArtefato[] = [
  "artefato_criado",
  "versao_adicionada",
  "artefato_renomeado",
  "artefato_removido",
];

const FALHA_DE_CONEXAO = "Não foi possível falar com o servidor. Feche e abra o Orquestrador de novo.";

function mensagemDoCorpo(corpo: unknown): string | null {
  if (typeof corpo === "object" && corpo !== null && "erro" in corpo && typeof corpo.erro === "string") {
    return corpo.erro;
  }
  return null;
}

async function chamar(caminho: string, opcoes: RequestInit = {}): Promise<Response> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, opcoes);
  } catch {
    throw new Error(FALHA_DE_CONEXAO);
  }
  if (!resposta.ok) {
    const corpo: unknown = await resposta.json().catch(() => null);
    throw new ErroDaApi(mensagemDoCorpo(corpo) ?? `O servidor respondeu com erro ${resposta.status}.`, resposta.status);
  }
  return resposta;
}

async function requisitarJson<Resposta>(caminho: string, opcoes: RequestInit = {}): Promise<Resposta> {
  const resposta = await chamar(caminho, { ...opcoes, headers: { "Content-Type": "application/json", ...opcoes.headers } });
  return (resposta.status === 204 ? null : await resposta.json()) as Resposta;
}

const caminhoDoArtefato = (id: string) => `/artefatos/${encodeURIComponent(id)}`;
const caminhoDaVersao = (id: string, numero: number) =>
  `${caminhoDoArtefato(id)}/versoes/${encodeURIComponent(String(numero))}`;

export const apiDosArtefatos = {
  /** Todos, do mais recente (`atualizadoEm`) para o mais antigo. */
  listar: () => requisitarJson<ResumoDoArtefato[]>("/artefatos"),

  ler: (id: string) => requisitarJson<ResumoDoArtefato>(caminhoDoArtefato(id)),

  /** O conteúdo bruto (HTML ou Markdown) de uma versão; 404 se ela não existe. */
  lerVersao: async (id: string, numero: number): Promise<string> => {
    const resposta = await chamar(caminhoDaVersao(id, numero));
    return resposta.text();
  },

  /**
   * Os traços desenhados sobre a versão (vazio se ninguém desenhou) e a largura
   * da página quando o desenho começou (nula se não veio número); 404 se a
   * versão não existe. Vêm como o servidor mandou: quem usa valida cada traço e a largura.
   */
  lerDesenho: async (id: string, numero: number): Promise<DesenhoGravado> => {
    const corpo = await requisitarJson<{ tracos?: unknown; largura?: unknown } | null>(
      `${caminhoDaVersao(id, numero)}/desenho`,
    );
    return {
      tracos: Array.isArray(corpo?.tracos) ? (corpo.tracos as TracoGravado[]) : [],
      largura: typeof corpo?.largura === "number" ? corpo.largura : null,
    };
  },

  /**
   * Troca o desenho da versão inteiro, com a largura da página (204). Lista vazia
   * apaga o desenho. Recusado com 400 (traço ou largura inválidos), 404 ou 413 (grande demais).
   */
  salvarDesenho: async (
    id: string,
    numero: number,
    tracos: readonly TracoGravado[],
    largura: number | null,
  ): Promise<void> => {
    await requisitarJson<null>(`${caminhoDaVersao(id, numero)}/desenho`, {
      method: "PUT",
      body: JSON.stringify({ tracos, largura }),
    });
  },

  /** Recusado (400, "Título inválido.") com o título em branco ou longo demais. */
  renomear: (id: string, titulo: string) =>
    requisitarJson<ResumoDoArtefato>(caminhoDoArtefato(id), { method: "PATCH", body: JSON.stringify({ titulo }) }),

  apagar: async (id: string): Promise<void> => {
    await requisitarJson<null>(caminhoDoArtefato(id), { method: "DELETE" });
  },

  enderecoDosEventos: () => "/api/artefatos/eventos",
};
