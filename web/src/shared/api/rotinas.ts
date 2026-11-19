import { textosAtuais } from "../idioma/idioma";
import { textosDePaineis } from "../idioma/textos/paineis";
import { ErroDaApi } from "./cliente";

/**
 * Rotinas: fluxos agendados de pedidos a Orquestradores, aprovações e esperas,
 * e as execuções delas. A tela não importa do servidor: estes tipos espelham o
 * que `GET /api/rotinas` e os eventos de `GET /api/rotinas/eventos` devolvem.
 */

export type DadosDoGatilho =
  | { tipo: "diario"; hora: string }
  /** `dias`: de 0 (domingo) a 6 (sábado). */
  | { tipo: "semanal"; dias: number[]; hora: string }
  | { tipo: "intervalo"; minutos: number }
  /** `em`: ISO 8601. */
  | { tipo: "uma_vez"; em: string };

export type TipoDeGatilho = DadosDoGatilho["tipo"];

export type ModoDoPedido = "execucao" | "planejamento";

export type DadosDaEtapa =
  | { tipo: "pedido"; orquestradorId: string; texto: string; modo: ModoDoPedido }
  | { tipo: "aprovacao"; mensagem: string }
  | { tipo: "espera"; minutos: number };

export type TipoDeEtapa = DadosDaEtapa["tipo"];

/** O que fazer com uma hora que passou com o app fechado. */
export type AoPerder = "executar_ao_abrir" | "pular";

export const AO_PERDER_PADRAO: AoPerder = "pular";

/** Os limites que o servidor confere (`src/rotinas`); a tela avisa antes de enviar. */
export const LIMITES_DAS_ROTINAS = {
  tamanhoDoNome: 100,
  minimoDeEtapas: 1,
  maximoDeEtapas: 10,
  tamanhoDoTextoDoPedido: 20_000,
  tamanhoDaMensagemDeAprovacao: 1_000,
  maximoDeMinutosDaEspera: 1_440,
  minimoDeMinutosDoIntervalo: 15,
  maximoDeMinutosDoIntervalo: 525_600,
  tamanhoDoMotivoDaRecusa: 2_000,
} as const;

export interface DadosDaRotina {
  id: string;
  nome: string;
  ativa: boolean;
  gatilho: DadosDoGatilho;
  etapas: DadosDaEtapa[];
  aoPerder: AoPerder;
  criadaEm: string;
  /** Nulo enquanto nunca rodou. */
  ultimaExecucaoEm: string | null;
  /** Nulo quando desativada ou sem mais ocorrências. */
  proximaExecucaoEm: string | null;
}

export type SituacaoDaExecucao =
  | "em_andamento"
  | "aguardando_aprovacao"
  | "concluida"
  | "falhou"
  | "cancelada"
  | "recusada"
  | "interrompida"
  | "pulada";

export type OrigemDaExecucao = "agendada" | "manual" | "perdida";

/** O que a execução espera do usuário: aprovar a mensagem de uma etapa ou o plano de um pedido em planejamento. */
export type PendenciaDeAprovacao = { tipo: "aprovacao"; mensagem: string } | { tipo: "plano"; plano: string };

/** O que aconteceu numa etapa que já começou (a `pulada` nunca começa, por isso não vale aqui). */
export interface ResultadoDaEtapa {
  tipo: TipoDeEtapa;
  situacao: Exclude<SituacaoDaExecucao, "pulada">;
  iniciadaEm: string;
  /** Nulo enquanto a etapa não terminou. */
  encerradaEm: string | null;
  resposta: string | null;
  plano: string | null;
  erro: string | null;
}

export interface DadosDaExecucao {
  id: string;
  rotinaId: string;
  /** O nome que a rotina tinha ao começar. */
  rotinaNome: string;
  origem: OrigemDaExecucao;
  situacao: SituacaoDaExecucao;
  /** Posição (a partir de 0) da etapa em curso; nulo quando a execução terminou. */
  etapaAtual: number | null;
  etapas: DadosDaEtapa[];
  resultados: ResultadoDaEtapa[];
  iniciadaEm: string;
  encerradaEm: string | null;
  /** Por que não concluiu: erro, cancelamento, recusa, interrupção ou salto. */
  motivo: string | null;
  pendencia: PendenciaDeAprovacao | null;
}

/** A rotina e a execução que roda ou espera aprovação agora (nulo se não há). */
export interface ResumoDaRotina extends DadosDaRotina {
  execucaoAtiva: DadosDaExecucao | null;
}

/** O corpo de `POST /api/rotinas`; `aoPerder` e `ativa` usam o padrão do servidor (pular; ativa). */
export interface NovaRotina {
  nome: string;
  gatilho: DadosDoGatilho;
  etapas: DadosDaEtapa[];
  aoPerder?: AoPerder;
  ativa?: boolean;
}

/** O corpo de `PATCH /api/rotinas/:id`: só o que vier muda; `ativa` liga e desliga. */
export type AlteracoesDaRotina = Partial<NovaRotina>;

/** Os eventos ao vivo de `GET /api/rotinas/eventos` (sem histórico). */
export type EventoDeRotina =
  | { tipo: "rotina_criada"; rotina: DadosDaRotina }
  | { tipo: "rotina_alterada"; rotina: DadosDaRotina }
  | { tipo: "rotina_removida"; id: string }
  | { tipo: "execucao_iniciada"; execucao: DadosDaExecucao }
  | { tipo: "etapa_iniciada"; execucao: DadosDaExecucao; indice: number }
  | { tipo: "etapa_concluida"; execucao: DadosDaExecucao; indice: number }
  | { tipo: "aguardando_aprovacao"; execucao: DadosDaExecucao }
  | { tipo: "execucao_encerrada"; execucao: DadosDaExecucao; situacao: SituacaoDaExecucao };

export type TipoDeEventoDeRotina = EventoDeRotina["tipo"];

export const TIPOS_DE_EVENTO_DE_ROTINA: readonly TipoDeEventoDeRotina[] = [
  "rotina_criada",
  "rotina_alterada",
  "rotina_removida",
  "execucao_iniciada",
  "etapa_iniciada",
  "etapa_concluida",
  "aguardando_aprovacao",
  "execucao_encerrada",
];

/** As situações em que a execução ainda não terminou. */
export function execucaoEstaAtiva(execucao: Pick<DadosDaExecucao, "situacao">): boolean {
  return execucao.situacao === "em_andamento" || execucao.situacao === "aguardando_aprovacao";
}

function mensagemDoCorpo(corpo: unknown): string | null {
  if (typeof corpo === "object" && corpo !== null && "erro" in corpo && typeof corpo.erro === "string") {
    return corpo.erro;
  }
  return null;
}

async function requisitar<Resposta>(caminho: string, opcoes: RequestInit = {}): Promise<Resposta> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, {
      ...opcoes,
      headers: { "Content-Type": "application/json", ...opcoes.headers },
    });
  } catch {
    throw new Error(textosAtuais(textosDePaineis).api.falhaDeConexao);
  }
  const corpo: unknown = resposta.status === 204 ? null : await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new ErroDaApi(mensagemDoCorpo(corpo) ?? textosAtuais(textosDePaineis).api.servidorRespondeuComErro(resposta.status), resposta.status);
  }
  return corpo as Resposta;
}

const caminhoDaRotina = (id: string) => `/rotinas/${encodeURIComponent(id)}`;
const caminhoDaExecucao = (id: string) => `/rotinas/execucoes/${encodeURIComponent(id)}`;

export const apiDasRotinas = {
  listar: () => requisitar<ResumoDaRotina[]>("/rotinas"),

  /** Recusado (400) com a mensagem do servidor: nome, gatilho, etapas ou horário inválidos. */
  criar: (nova: NovaRotina) => requisitar<ResumoDaRotina>("/rotinas", { method: "POST", body: JSON.stringify(nova) }),

  ler: (id: string) => requisitar<ResumoDaRotina>(caminhoDaRotina(id)),

  /** Só o que vier muda; `{ ativa: true | false }` liga e desliga. */
  alterar: (id: string, alteracoes: AlteracoesDaRotina) =>
    requisitar<ResumoDaRotina>(caminhoDaRotina(id), { method: "PATCH", body: JSON.stringify(alteracoes) }),

  /** Apaga a rotina e as execuções dela; as que estão em curso são canceladas. */
  apagar: async (id: string): Promise<void> => {
    await requisitar<null>(caminhoDaRotina(id), { method: "DELETE" });
  },

  /** Começa uma execução agora e responde logo (202): o andamento vem pelos eventos. Recusado (409) se já há uma em curso. */
  executarAgora: (id: string) => requisitar<DadosDaExecucao>(`${caminhoDaRotina(id)}/executar`, { method: "POST" }),

  /** Da mais recente para a mais antiga. */
  listarExecucoes: (id: string) => requisitar<DadosDaExecucao[]>(`${caminhoDaRotina(id)}/execucoes`),

  aprovar: (execucaoId: string) =>
    requisitar<DadosDaExecucao>(`${caminhoDaExecucao(execucaoId)}/aprovar`, { method: "POST" }),

  recusar: (execucaoId: string, motivo?: string) =>
    requisitar<DadosDaExecucao>(`${caminhoDaExecucao(execucaoId)}/recusar`, {
      method: "POST",
      body: JSON.stringify(motivo === undefined || motivo.trim() === "" ? {} : { motivo: motivo.trim() }),
    }),

  cancelar: (execucaoId: string) =>
    requisitar<DadosDaExecucao>(`${caminhoDaExecucao(execucaoId)}/cancelar`, { method: "POST" }),

  enderecoDosEventos: () => "/api/rotinas/eventos",
};
