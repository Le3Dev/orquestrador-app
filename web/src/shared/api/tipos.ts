/**
 * Contrato da API (`/api`), espelhando o que o servidor devolve. Mantenha em
 * sincronia com `src/orquestracao/EventoDeOrquestracao.ts` e com os
 * apresentadores de `src/controllers/orquestradoresRoutes.ts`.
 */

export type ModeloClaude = "fable" | "opus" | "sonnet" | "haiku";

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
}

/** Campos que faltam nos eventos gravados antes de existirem. */
type CamposPosterioresDaConfiguracao = "permitirCommitEPush" | "esforcoDoOrquestrador" | "esforcoDosSubagentes";

/**
 * A configuração como os eventos a gravaram: os anteriores à opção de commit e
 * push e à escolha do esforço não têm esses campos.
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

/** Predefinições de configuração que o servidor oferece; hoje só o modo econômico. */
export type NomeDaPredefinicao = "economico";

export interface DadosDaPredefinicao {
  nome: NomeDaPredefinicao;
  rotulo: string;
  descricao: string;
  /** Os campos que a predefinição muda; os demais ficam como estão. */
  configuracao: Partial<DadosDaConfiguracao>;
}

/** Tokens de um trecho do turno, como o Claude Code os conta. */
export interface DadosDoUso {
  entrada: number;
  criacaoDeCache: number;
  leituraDeCache: number;
  saida: number;
}

/**
 * Consumo medido de um turno, separado entre o Orquestrador (principal) e os
 * Subagentes. `indiceDeCusto` = entrada + 1,25 × criação de cache + 0,1 ×
 * leitura de cache + 5 × saída, em tokens de entrada equivalentes: serve para
 * comparar turnos, não é preço. `parcial`: o turno foi cancelado ou falhou.
 */
export interface DadosDoConsumoDoTurno {
  principal: DadosDoUso;
  subagentes: DadosDoUso;
  subagentesMedidos: number;
  parcial: boolean;
  indiceDeCusto: number;
  modeloDoPrincipal: string | null;
}

/** O esforço que o Claude Code usa quando o app deixa em "padrao", e de onde ele vem. */
export interface DadosDoEsforcoHerdado {
  nivel: EsforcoDeRaciocinio;
  origem: string;
  modelo: string | null;
  /** O nível herdado gasta mais tokens que o razoável: vale avisar o usuário. */
  deveAvisar: boolean;
}

export interface EsforcosHerdados {
  orquestrador: DadosDoEsforcoHerdado | null;
  subagentes: DadosDoEsforcoHerdado | null;
}

/**
 * Quantos pedidos cabem na fila de um Orquestrador; o servidor recusa o
 * seguinte com 409. Só para mostrar: quem decide é o servidor
 * (`LIMITE_DA_FILA` em `src/orquestracao/Orquestrador.ts`).
 */
export const LIMITE_DA_FILA = 10;

/**
 * Um pedido guardado na fila do Orquestrador, à espera da vez: sai sozinho
 * quando o turno atual termina concluído (sem plano pendente) ou quando o
 * usuário manda "enviar agora". Só texto e modo: imagens não entram na fila.
 */
export interface DadosDoPedidoNaFila {
  id: string;
  texto: string;
  modo: ModoDoTurno;
  /** ISO 8601. */
  enfileiradoEm: string;
}

/** Por que um pedido saiu da fila: o usuário o tirou, ou ele virou um turno. */
export type MotivoDaRetiradaDaFila = "removido" | "enviado";

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
  /** A predefinição que a configuração atual reproduz por inteiro, se houver. Falta em servidores anteriores. */
  predefinicaoCorrespondente?: NomeDaPredefinicao | null;
  /**
   * Os pedidos à espera, na ordem em que vão sair. É a fila no instante da
   * consulta: a tela junta com os eventos da fila (ver `filaDePedidos`).
   * Falta em servidores anteriores à fila (vale vazia).
   */
  fila?: DadosDoPedidoNaFila[];
}

export interface PastaDeProjeto {
  nome: string;
  caminho: string;
}

/** Resultado de navegar pelo computador para escolher uma pasta qualquer. */
export interface NavegacaoDePastas {
  /** A pasta que está sendo listada. */
  caminho: string;
  /** A pasta acima; `null` quando já se chegou à raiz do disco. */
  pai: string | null;
  /** As subpastas visíveis, em ordem alfabética. */
  pastas: PastaDeProjeto[];
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
  | { tipo: "plano_descartado" }
  // Medido depois do fim do turno, a partir dos registros do Claude Code.
  | { tipo: "consumo_do_turno_medido"; consumo: DadosDoConsumoDoTurno };

export type EventoDeOrquestracao =
  | (EventoDeTurno & { turnoId: string })
  | { tipo: "configuracao_alterada"; configuracao: DadosDaConfiguracaoGravada }
  // O usuário começou uma conversa nova (/clear): os pedidos anteriores ficam arquivados no servidor.
  // A fila de pedidos não muda: ela é do Orquestrador, não da conversa.
  | {
      tipo: "conversa_limpa";
      turnosAnteriores: number;
      planoDescartado: boolean;
      worktreeComAlteracoes: boolean;
    }
  // Um pedido entrou no fim da fila (sem `turnoId`: espera a vez, com ou sem turno em andamento).
  | { tipo: "pedido_enfileirado"; pedido: DadosDoPedidoNaFila }
  // Um pedido saiu da fila: `removido` pelo usuário, ou `enviado` — então vem logo antes do
  // `turno_iniciado` do turno que o atende.
  | { tipo: "pedido_retirado_da_fila"; pedidoId: string; motivo: MotivoDaRetiradaDaFila };

export type EventoRegistrado = EventoDeOrquestracao & { sequencia: number; em: string };

/* --------------------------------------------------------------------------
   Chat rápido (`/api/chat`): perguntas avulsas ao Claude, fora dos Orquestradores.
   Mantenha em sincronia com as rotas e os eventos do chat no servidor.
   -------------------------------------------------------------------------- */

/** Modelo e esforço do chat; a última escolha vira o padrão (opus/alto no começo). */
export interface PreferenciasDoChat {
  modelo: ModeloClaude;
  esforco: EsforcoDeRaciocinio;
}

/** Ação que o Claude sugere no app; só é executada quando o usuário clica. */
export interface AcaoDoApp {
  tipo: "abrir_orquestrador";
  projeto: string;
  pasta: string;
  pedido: string | null;
}

export interface UsoDaResposta {
  duracaoMs: number;
  tokensDeEntrada: number;
  tokensDeSaida: number;
  /** Ex.: "claude-opus-5-5"; nulo quando o servidor não soube. */
  modeloUsado: string | null;
}

export interface ImagemDaMensagemDoChat {
  arquivo: string;
  nome: string;
  tipoDeMidia: string;
}

export type PapelNoChat = "usuario" | "claude";
export type SituacaoDaMensagemDoChat = "respondendo" | "concluida" | "falhou" | "cancelada";

/** O que o chat quis fazer e não pôde, por falta de autorização. */
export type AcaoQuePedeAutorizacao = "editar" | "rodar_comando";

/**
 * A resposta parou porque o chat precisava editar um arquivo ou rodar um
 * comando sem estar autorizado. `detalhe` é o arquivo ou o comando.
 */
export interface AutorizacaoPendente {
  acao: AcaoQuePedeAutorizacao;
  detalhe: string;
}

export interface MensagemDoChat {
  id: string;
  papel: PapelNoChat;
  texto: string;
  imagens: ImagemDaMensagemDoChat[];
  criadaEm: string;
  situacao: SituacaoDaMensagemDoChat;
  acoes: AcaoDoApp[];
  avisos: string[];
  uso: UsoDaResposta | null;
  /** Falta nas mensagens gravadas antes da autorização (vale `null`). */
  autorizacaoPendente?: AutorizacaoPendente | null;
}

export type SituacaoDoChat = "ocioso" | "respondendo";

export interface EstadoDoChat {
  sessaoId: string;
  situacao: SituacaoDoChat;
  preferencias: PreferenciasDoChat;
  /** A mensagem "respondendo" já traz o texto parcial acumulado. */
  mensagens: MensagemDoChat[];
  ultimaSequencia: number;
  cota: JanelaDaCota[] | null;
  /**
   * O usuário autorizou o chat a editar arquivos e rodar comandos, até o
   * próximo `/clear`. Falta em servidores anteriores à autorização (vale `false`).
   */
  alteracoesAutorizadas?: boolean;
}

export type EventoDoChat =
  | { tipo: "pergunta_enviada"; mensagemDoUsuario: MensagemDoChat; mensagemDoClaude: MensagemDoChat }
  // O `texto` final substitui o que veio nos trechos. `autorizacaoPendente` falta nos eventos
  // gravados antes da autorização (vale `null`).
  | {
      tipo: "resposta_concluida";
      mensagemId: string;
      texto: string;
      acoes: AcaoDoApp[];
      avisos: string[];
      uso: UsoDaResposta | null;
      autorizacaoPendente?: AutorizacaoPendente | null;
    }
  | { tipo: "resposta_falhou"; mensagemId: string; motivo: string; uso: UsoDaResposta | null }
  | { tipo: "resposta_cancelada"; mensagemId: string }
  // O `/clear` também desfaz a autorização de alterações.
  | { tipo: "conversa_limpa" }
  | { tipo: "preferencias_alteradas"; preferencias: PreferenciasDoChat }
  | { tipo: "uso_da_cota"; janelas: JanelaDaCota[] }
  // O usuário autorizou o chat a editar arquivos e rodar comandos, até o próximo `/clear`.
  | { tipo: "alteracoes_autorizadas" }
  // O usuário revogou a autorização (o ✕ do selo).
  | { tipo: "autorizacao_revogada" };

export type EventoDoChatRegistrado = EventoDoChat & { sequencia: number; em: string };

/** Evento SSE passageiro "trecho" (sem id): pedaço novo do texto da resposta, para concatenar. */
export interface TrechoDaResposta {
  mensagemId: string;
  texto: string;
}

/** Evento SSE passageiro "atividade" (sem id): a ferramenta que o Claude está usando agora. */
export interface AtividadeDaResposta {
  mensagemId: string;
  ferramenta: string;
  detalhe: string;
}
