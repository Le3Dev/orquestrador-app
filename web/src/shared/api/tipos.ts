/**
 * Contrato da API (`/api`), espelhando o que o servidor devolve. Mantenha em
 * sincronia com `src/orquestracao/EventoDeOrquestracao.ts` e com os
 * apresentadores de `src/controllers/orquestradoresRoutes.ts`.
 */

export type ModeloClaude = "opus" | "sonnet" | "haiku";

export type NivelDePermissao = "leitura" | "edicao" | "edicao_e_comandos";

/** Esforço de raciocínio do modelo. "padrao" não força nada: vale o padrão do modelo no Claude Code. */
export type EsforcoDeRaciocinio = "padrao" | "baixo" | "medio" | "alto" | "extra_alto" | "maximo";

export interface DadosDaQuantidade {
  modo: "fixa" | "automatica";
  limite: number;
}

export interface DadosDaConfiguracao {
  modeloDoOrquestrador: ModeloClaude;
  /** "padrao" por padrão. */
  esforcoDoOrquestrador: EsforcoDeRaciocinio;
  modeloDosSubagentes: ModeloClaude;
  /** "padrao" por padrão. */
  esforcoDosSubagentes: EsforcoDeRaciocinio;
  quantidadeDeSubagentes: DadosDaQuantidade;
  nivelDePermissao: NivelDePermissao;
  /** Libera `git commit`/`git push` só quando o usuário pede na mensagem. Desligado por padrão. */
  permitirCommitEPush: boolean;
  /**
   * O Orquestrador faz o trivial sozinho (leituras rápidas, uma checagem, um
   * comando curto), sem Subagente; alterações continuam delegadas. Ligado por padrão.
   */
  permitirTrabalhoDireto: boolean;
  /** Em pedidos grandes, o Orquestrador responde com um plano para aprovar antes de alterar. Ligado por padrão. */
  proporPlanoEmPedidosGrandes: boolean;
  /**
   * Instruções do usuário acrescentadas ao fim do bloco de cada pedido. Vazias
   * por padrão: aí vale o padrão global (`DadosDasPreferencias.instrucoesPadrao`), se houver.
   */
  instrucoesPersonalizadas: string;
}

/** Limite das instruções personalizadas e das padrão, como o servidor confere (já sem espaço sobrando). */
export const TAMANHO_MAXIMO_DAS_INSTRUCOES = 4_000;

/** De onde vêm as instruções personalizadas de um pedido: as do orquestrador ou o padrão global. */
export type OrigemDasInstrucoes = "orquestrador" | "padrao";

/** `herdar` usa o modelo dos subagentes do orquestrador que o lançar. */
export type ModeloDoSubagentePronto = "herdar" | ModeloClaude;

/** Subagente com prompt pronto, que qualquer orquestrador pode decidir usar. */
export interface DadosDoSubagentePronto {
  /** Como o orquestrador o chama: letras minúsculas, números e hífen. */
  nome: string;
  /** Quando usar (uma linha): o orquestrador decide por ela. */
  descricao: string;
  /** A especialidade, somada às regras de todo subagente. */
  prompt: string;
  modelo: ModeloDoSubagentePronto;
}

/** Limites dos subagentes prontos, como o servidor confere. */
export const MAXIMO_DE_SUBAGENTES_PRONTOS = 10;
export const TAMANHO_MAXIMO_DA_DESCRICAO_DO_SUBAGENTE = 300;
export const TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE = 4_000;

/** Preferências que valem para todos os orquestradores. */
export interface DadosDasPreferencias {
  /** Instruções para os orquestradores sem instruções próprias. */
  instrucoesPadrao: string;
  subagentesProntos: DadosDoSubagentePronto[];
}

/** O que o orquestrador receberia num pedido com uma configuração (`POST /previa-do-prompt`). */
export interface PreviaDoPrompt {
  /** System prompt da conversa (fixo desde o primeiro pedido). */
  instrucoesIniciais: string;
  /** A mensagem de um pedido: bloco da configuração, instruções personalizadas e o pedido. */
  mensagem: string;
  origemDasInstrucoes: OrigemDasInstrucoes | null;
}

/** Campos que faltam nos eventos gravados antes de existirem. */
type CamposPosterioresDaConfiguracao =
  | "permitirCommitEPush"
  | "esforcoDoOrquestrador"
  | "esforcoDosSubagentes"
  | "permitirTrabalhoDireto"
  | "proporPlanoEmPedidosGrandes"
  | "instrucoesPersonalizadas";

/**
 * A configuração como os eventos a gravaram: os anteriores à opção de commit e
 * push, à escolha do esforço, às opções de trabalho direto e de plano
 * automático e às instruções personalizadas não têm esses campos.
 */
export type DadosDaConfiguracaoGravada = Omit<DadosDaConfiguracao, CamposPosterioresDaConfiguracao> &
  Partial<Pick<DadosDaConfiguracao, CamposPosterioresDaConfiguracao>>;

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

/**
 * "planejamento" é o Plan Mode: o pedido só investiga e a resposta é um plano,
 * que espera a aprovação do usuário antes de qualquer alteração.
 */
export type ModoDoTurno = "execucao" | "planejamento";
export type DecisaoDoPlano = "pendente" | "aprovado" | "descartado";
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
  /** De onde viriam as instruções personalizadas no próximo pedido; nulo sem nenhuma. */
  instrucoesAtivas: OrigemDasInstrucoes | null;
  criadoEm: string;
  totalDeTurnos: number;
  ultimoTurno: { texto: string; situacao: SituacaoDoTurno; iniciadoEm: string } | null;
  worktree: DadosDoWorktree | null;
}

export interface PastaDeProjeto {
  nome: string;
  caminho: string;
}

/** Uma pasta aberta no navegador de pastas da criação (`GET /pastas?caminho=`). */
export interface ConteudoDaPasta {
  /** A pasta dos projetos, ponto de partida do navegador. */
  raiz: string;
  atual: string;
  /** Nula na raiz do disco. */
  acima: string | null;
  pastas: PastaDeProjeto[];
  /** Pasta dos projetos, pasta pessoal e, no Windows, as unidades. */
  atalhos: PastaDeProjeto[];
}

/**
 * Nota livre do canvas (bloco de notas). O conteúdo fica no servidor; a
 * posição, o tamanho e se está minimizada ficam no layout do navegador.
 */
export interface DadosDaNota {
  id: string;
  /** De 1 a 120 caracteres. */
  titulo: string;
  /** Texto puro, até 100.000 caracteres. */
  texto: string;
  criadaEm: string;
  atualizadaEm: string;
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
  | {
      tipo: "subagente_iniciado";
      subagenteId: string;
      descricao: string;
      tarefa: string;
      /** "executor" ou o nome de um subagente pronto; ausente nos eventos antigos. */
      papel?: string;
    }
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
  // `anexos` e `modo` faltam nos eventos gravados antes de existirem imagens e o Plan Mode.
  | {
      tipo: "turno_iniciado";
      texto: string;
      configuracao: DadosDaConfiguracaoGravada;
      anexos?: DadosDoAnexo[];
      modo?: ModoDoTurno;
    }
  // `planoPendente`: o turno terminou com um plano à espera de decisão — no Plan Mode ou num pedido
  // de execução em que o Orquestrador propôs um plano antes de alterar. Falta nos eventos gravados antes.
  | { tipo: "turno_concluido"; resposta: string; uso: UsoDoTurno; planoPendente?: boolean }
  | { tipo: "turno_cancelado" }
  | { tipo: "turno_falhou"; motivo: string }
  | { tipo: "turno_interrompido" }
  // Decisão sobre o plano pendente; ao aprovar, segue o `turno_iniciado` da execução.
  | { tipo: "plano_aprovado" }
  | { tipo: "plano_descartado" };

export type EventoDeOrquestracao =
  | (EventoDeTurno & { turnoId: string })
  | { tipo: "configuracao_alterada"; configuracao: DadosDaConfiguracaoGravada }
  // O usuário começou uma conversa nova (/clear): os pedidos anteriores ficam arquivados no servidor.
  | {
      tipo: "conversa_limpa";
      turnosAnteriores: number;
      planoDescartado: boolean;
      worktreeComAlteracoes: boolean;
    };

export type EventoRegistrado = EventoDeOrquestracao & { sequencia: number; em: string };
