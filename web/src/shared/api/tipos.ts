/**
 * Contrato da API (`/api`), espelhando o que o servidor devolve. Mantenha em
 * sincronia com `src/orquestracao/EventoDeOrquestracao.ts` e com os
 * apresentadores de `src/controllers/orquestradoresRoutes.ts`.
 */

export type ModeloClaude = "opus" | "sonnet" | "haiku";

export type NivelDePermissao = "leitura" | "edicao" | "edicao_e_comandos";

export interface DadosDaQuantidade {
  modo: "fixa" | "automatica";
  limite: number;
}

export interface DadosDaConfiguracao {
  modeloDoOrquestrador: ModeloClaude;
  modeloDosSubagentes: ModeloClaude;
  quantidadeDeSubagentes: DadosDaQuantidade;
  nivelDePermissao: NivelDePermissao;
}

export type TipoDeImagem = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface DadosDoAnexo {
  id: string;
  nome: string;
  tipoDeMidia: TipoDeImagem;
  tamanhoEmBytes: number;
  arquivo: string;
}

/** Sinal passageiro de que o Claude segue trabalhando (evento SSE "sinal", fora do histórico). */
export interface SinalDeVida {
  turnoId: string;
  em: string;
  tokensPensando: number;
}

export interface LeituraDeMemoria {
  totalBytes: number;
  livreBytes: number;
  servidorBytes: number;
  agentesBytes: number;
  porOrquestrador: Record<string, number>;
  lidaEm: string;
}

export interface SaudeDoServidor {
  ok: boolean;
  iniciadoEm: string;
  memoria: LeituraDeMemoria | null;
}

export type SituacaoDoOrquestrador = "ocioso" | "trabalhando";
export type SituacaoDoTurno = "em_andamento" | "concluido" | "cancelado" | "falhou" | "interrompido";
export type SituacaoDoSubagente = "executando" | "concluido" | "falhou" | "cancelado";

/**
 * Git worktree em que o Orquestrador opera. `null` quando a pasta não é um
 * repositório git (o Orquestrador não usa worktree).
 */
export interface DadosDoWorktree {
  branch: string;
  caminho: string;
  ativo: boolean;
}

export interface ResumoDoOrquestrador {
  id: string;
  nome: string;
  pastaDeTrabalho: string;
  nomeDaPasta: string;
  situacao: SituacaoDoOrquestrador;
  configuracao: DadosDaConfiguracao;
  criadoEm: string;
  totalDeTurnos: number;
  ultimoTurno: { texto: string; situacao: SituacaoDoTurno; iniciadoEm: string } | null;
  worktree: DadosDoWorktree | null;
}

export interface PastaDeProjeto {
  nome: string;
  caminho: string;
}

export interface UsoDoTurno {
  duracaoMs: number;
  tokensDeEntrada: number;
  tokensDeSaida: number;
  subagentesLancados: number;
}

export interface JanelaDaCota {
  nome: string;
  utilizacao: number;
  renovaEm: string | null;
  situacao: string;
}

type EventoDeTurno =
  | { tipo: "sessao_iniciada" }
  | { tipo: "texto_do_orquestrador"; texto: string }
  | { tipo: "ferramenta_do_orquestrador"; ferramenta: string; detalhe: string }
  | { tipo: "subagente_iniciado"; subagenteId: string; descricao: string; tarefa: string }
  | {
      tipo: "progresso_do_subagente";
      subagenteId: string;
      atividade: string;
      ultimaFerramenta: string | null;
      tokens: number;
      ferramentasUsadas: number;
      duracaoMs: number;
    }
  | { tipo: "texto_do_subagente"; subagenteId: string; texto: string }
  | {
      tipo: "subagente_concluido";
      subagenteId: string;
      situacao: Exclude<SituacaoDoSubagente, "executando">;
      resumo: string;
      tokens: number;
      duracaoMs: number;
    }
  | { tipo: "resultado_do_subagente"; subagenteId: string; resultado: string }
  | { tipo: "permissao_negada"; ferramenta: string; detalhe: string }
  | { tipo: "uso_da_cota"; janelas: JanelaDaCota[] }
  // `anexos` falta nos eventos gravados antes de existirem imagens.
  | { tipo: "turno_iniciado"; texto: string; configuracao: DadosDaConfiguracao; anexos?: DadosDoAnexo[] }
  | { tipo: "turno_concluido"; resposta: string; uso: UsoDoTurno }
  | { tipo: "turno_cancelado" }
  | { tipo: "turno_falhou"; motivo: string }
  | { tipo: "turno_interrompido" };

export type EventoDeOrquestracao =
  | (EventoDeTurno & { turnoId: string })
  | { tipo: "configuracao_alterada"; configuracao: DadosDaConfiguracao };

export type EventoRegistrado = EventoDeOrquestracao & { sequencia: number; em: string };
