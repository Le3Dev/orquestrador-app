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

export const apiDosArtefatos = {
  /** Todos, do mais recente (`atualizadoEm`) para o mais antigo. */
  listar: () => requisitarJson<ResumoDoArtefato[]>("/artefatos"),

  ler: (id: string) => requisitarJson<ResumoDoArtefato>(caminhoDoArtefato(id)),

  /** O conteúdo bruto (HTML ou Markdown) de uma versão; 404 se ela não existe. */
  lerVersao: async (id: string, numero: number): Promise<string> => {
    const resposta = await chamar(`${caminhoDoArtefato(id)}/versoes/${encodeURIComponent(String(numero))}`);
    return resposta.text();
  },

  /** Recusado (400, "Título inválido.") com o título em branco ou longo demais. */
  renomear: (id: string, titulo: string) =>
    requisitarJson<ResumoDoArtefato>(caminhoDoArtefato(id), { method: "PATCH", body: JSON.stringify({ titulo }) }),

  apagar: async (id: string): Promise<void> => {
    await requisitarJson<null>(caminhoDoArtefato(id), { method: "DELETE" });
  },

  enderecoDosEventos: () => "/api/artefatos/eventos",
};
