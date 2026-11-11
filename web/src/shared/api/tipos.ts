/**
 * Contrato da API (`/api`), espelhando o que o servidor devolve. Mantenha em
 * sincronia com `src/orquestracao/EventoDeOrquestracao.ts` e com os
 * apresentadores de `src/controllers/orquestradoresRoutes.ts`.
 */

export type ModeloClaude = "fable" | "opus" | "sonnet" | "haiku";

export type NivelDePermissao = "leitura" | "edicao" | "edicao_e_comandos";

/**
 * Esforço de raciocínio do modelo. "padrao" não força nada: vale o padrão do modelo no Claude Code.
 * "ultracode" (xhigh com workflows de vários agentes em paralelo) só vale para o orquestrador e o
 * chat: o servidor recusa no esforço dos subagentes.
 */
export type EsforcoDeRaciocinio = "padrao" | "baixo" | "medio" | "alto" | "extra_alto" | "maximo" | "ultracode";

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
  /** O orquestrador e os subagentes podem publicar artefatos online no claude.ai. Desligado por padrão. */
  permitirArtefatosOnline: boolean;
  /**
   * Instruções do usuário acrescentadas ao fim do bloco de cada pedido. Vazias
   * por padrão: aí vale o padrão global (`DadosDasPreferencias.instrucoesPadrao`), se houver.
   */
  instrucoesPersonalizadas: string;
  /**
   * Quais subagentes prontos (das preferências) o orquestrador recebe. Ausente
   * (servidores e eventos anteriores à opção) vale "todos".
   */
  subagentesProntos?: SelecaoDeSubagentesProntos;
}

/**
 * Os subagentes prontos que um orquestrador recebe: todos, nenhum ou só os da
 * lista (por nome). Nomes que não existem mais nas preferências são ignorados.
 */
export type SelecaoDeSubagentesProntos = "todos" | "nenhum" | string[];

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
export const MAXIMO_DE_SUBAGENTES_PRONTOS = 30;
export const TAMANHO_MAXIMO_DA_DESCRICAO_DO_SUBAGENTE = 300;
export const TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE = 4_000;

/**
 * Texto de instruções com nome. Aplicar num orquestrador copia o texto para as
 * instruções personalizadas dele: sem vínculo, editar o perfil depois não muda
 * quem já o usou.
 */
export interface PerfilDeInstrucoes {
  nome: string;
  /** Mesmo limite das instruções personalizadas (`TAMANHO_MAXIMO_DAS_INSTRUCOES`). */
  texto: string;
}

/** Limites dos perfis de instruções, como o servidor confere. */
export const MAXIMO_DE_PERFIS_DE_INSTRUCOES = 20;
export const TAMANHO_MAXIMO_DO_NOME_DO_PERFIL = 40;

/** Preferências que valem para todos os orquestradores. */
export interface DadosDasPreferencias {
  /** Instruções para os orquestradores sem instruções próprias. */
  instrucoesPadrao: string;
  subagentesProntos: DadosDoSubagentePronto[];
  /** Falta em servidores anteriores a eles (vale lista vazia). */
  perfisDeInstrucoes?: PerfilDeInstrucoes[];
  /**
   * Retoma o turno sozinho quando o Claude fica em silêncio (travado) ou a API
   * falha (limite de uso, sobrecarga, rede). Ligada por padrão; falta em
   * servidores anteriores a ela (vale `true`).
   */
  autorrecuperacao?: boolean;
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
  | "permitirArtefatosOnline"
  | "esforcoDoOrquestrador"
  | "esforcoDosSubagentes"
  | "instrucoesPersonalizadas";

/**
 * A configuração como os eventos a gravaram: os anteriores à opção de commit e
 * push, à escolha do esforço e às instruções personalizadas não têm esses campos.
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
  /**
   * O que o servidor apurou de um turno calado há 90 s ou mais (chega a cada
   * ~30 s enquanto o silêncio dura). Não é atividade nova: só explica o silêncio.
   * Falta nos sinais comuns e em servidores anteriores ao diagnóstico.
   */
  diagnostico?: DiagnosticoDoSilencio;
}

/**
 * "trabalhando": há trabalho de verdade (ex.: "rodando `npm test` há 6 min");
 * "suspeito": nada indica trabalho (ex.: "sem saída há 3 min, sem CPU").
 */
export interface DiagnosticoDoSilencio {
  situacao: "trabalhando" | "suspeito";
  resumo: string;
  /** O servidor não vê os processos neste sistema (Windows): só avisa, não encerra nem retoma o turno sozinho. */
  semRetomadaAutomatica?: true;
}

/** Por que o turno precisou de recuperação. */
export type CausaDaRecuperacao = "silencio" | "limite_de_uso" | "sobrecarga" | "rede";

/**
 * Etapas da autorrecuperação: "encerrado" (o turno travado foi encerrado),
 * "aguardando" (espera até `retomaEm`), "retomando" (um turno novo vai
 * começar), "cancelada" (o usuário cancelou ou mandou outra mensagem) e
 * "desistiu" (esgotou as tentativas).
 */
export type EtapaDaRecuperacao = "encerrado" | "aguardando" | "retomando" | "cancelada" | "desistiu";

/** O turno novo que retoma sozinho um turno que travou ou falhou. */
export interface DadosDaRetomada {
  deTurnoId: string;
  tentativa: number;
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

/** Se um servidor de desenvolvimento local responde agora (`GET /servidores-locais/situacao`). */
export interface SituacaoDoServidorLocal {
  url: string;
  noAr: boolean;
}

export type SituacaoDoOrquestrador ="ocioso" | "trabalhando";
export type SituacaoDoTurno = "em_andamento" | "concluido" | "cancelado" | "falhou" | "interrompido";

/**
 * "planejamento" é o Plan Mode: o pedido só investiga e a resposta é um plano,
 * que espera a aprovação do usuário antes de qualquer alteração.
 */
export type ModoDoTurno = "execucao" | "planejamento";

/** De onde veio um endereço local detectado: da resposta final do agente ou da saída de uma ferramenta. */
export type OrigemDoEndereco = "resposta" | "ferramenta";
export type DecisaoDoPlano = "pendente" | "aprovado" | "descartado";
export type SituacaoDoSubagente = "executando" | "concluido" | "falhou" | "cancelado";

export type SituacaoDaTarefa = "pendente" | "em_andamento" | "concluida";

/** Um item da lista de tarefas que o Orquestrador mantém (`TodoWrite` do Claude Code). */
export interface TarefaDoOrquestrador {
  texto: string;
  situacao: SituacaoDaTarefa;
}

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

/**
 * O consumo medido de um Orquestrador na conversa atual (`GET
 * /consumo-dos-orquestradores`): a soma dos turnos medidos, com o principal e
 * os Subagentes juntos em `uso`. `parcial`: algum desses turnos foi cancelado
 * ou falhou.
 */
export interface ConsumoDoOrquestrador {
  id: string;
  nome: string;
  turnosMedidos: number;
  parcial: boolean;
  uso: DadosDoUso;
  indiceDeCusto: number;
}

/** Onde o pedido está sendo escrito: uma pergunta ao chat rápido ou um pedido de trabalho ao orquestrador. */
export type OndeDoPrompt = "chat" | "orquestrador";

/** O "melhorar o pedido" (✨): o texto do campo, onde ele está e, no orquestrador, o nome da pasta do projeto. */
export interface PedidoDeMelhoria {
  texto: string;
  onde: OndeDoPrompt;
  pasta?: string;
}

/** O pedido reescrito e quanto custou reescrever (`indiceDeCusto` como o dos turnos). */
export interface PromptMelhorado {
  texto: string;
  uso: DadosDoUso;
  indiceDeCusto: number;
  duracaoMs: number;
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
  /** De onde viriam as instruções personalizadas no próximo pedido; nulo sem nenhuma. */
  instrucoesAtivas: OrigemDasInstrucoes | null;
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
  /** O último pedido terminou com um Plano à espera da decisão. Falta em servidores anteriores (vale false). */
  planoPendente?: boolean;
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

/** Uma opção de uma pergunta do Claude; `descricao` aparece em letra menor embaixo do rótulo. */
export interface OpcaoDaPergunta {
  rotulo: string;
  descricao: string | null;
}

/**
 * Pergunta que o Claude faz com opções clicáveis (bloco ```pergunta-do-app).
 * Vêm de 1 a 4 por resposta, cada uma com 2 a 6 opções; `multipla` deixa
 * escolher mais de uma.
 */
export interface PerguntaDoApp {
  pergunta: string;
  opcoes: OpcaoDaPergunta[];
  multipla: boolean;
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
  // Um servidor de desenvolvimento subiu (ex.: "npm run dev"). Uma vez por endereço por turno; `url` já
  // normalizada: "http(s)://localhost:PORTA" e o caminho, sem a barra final solitária.
  // `origem`: "resposta" é o endereço citado na resposta final do agente (a única que abre a prévia sozinha);
  // "ferramenta" (e a falta do campo, nos eventos antigos) é o que apareceu na saída de uma ferramenta:
  // só entra na faixa de servidores, para abrir com um clique.
  | { tipo: "endereco_local_detectado"; url: string; origem?: OrigemDoEndereco }
  | { tipo: "uso_da_cota"; janelas: JanelaDaCota[] }
  // A lista de tarefas do Orquestrador (`TodoWrite`), inteira: substitui a anterior. Nunca vem vazia.
  | { tipo: "tarefas_atualizadas"; tarefas: TarefaDoOrquestrador[] }
  // `anexos` e `modo` faltam nos eventos gravados antes de existirem imagens e o Plan Mode.
  | {
      tipo: "turno_iniciado";
      texto: string;
      configuracao: DadosDaConfiguracaoGravada;
      anexos?: DadosDoAnexo[];
      modo?: ModoDoTurno;
      // Só nos turnos que o app abriu sozinho para retomar um que travou ou falhou; `texto` é a mensagem de retomada.
      retomada?: DadosDaRetomada;
    }
  // Autorrecuperação do turno travado ou que falhou por limite de uso, sobrecarga ou rede.
  // `tentativa` começa em 1 e `de` é o máximo para a causa; `resumo` vem pronto em pt-BR (em "desistiu",
  // o diagnóstico completo); `retomaEm` (ISO) só em "aguardando".
  | {
      tipo: "recuperacao_do_turno";
      etapa: EtapaDaRecuperacao;
      causa: CausaDaRecuperacao;
      tentativa: number;
      de: number;
      resumo: string;
      retomaEm: string | null;
    }
  // `planoPendente`: o turno terminou com um plano à espera de decisão — no Plan Mode ou num pedido
  // de execução em que o Orquestrador propôs um plano antes de alterar. Falta nos eventos gravados antes.
  // `perguntas`: o Orquestrador terminou perguntando, com opções para o usuário escolher. Falta nos eventos antigos.
  // `previasParaFechar`: endereços (normalizados) das prévias que o Orquestrador pediu para fechar, no bloco
  // ```previa-do-app que o servidor já tirou da resposta. Falta, ou vem vazio, quando não pediu nenhuma.
  | {
      tipo: "turno_concluido";
      resposta: string;
      uso: UsoDoTurno;
      planoPendente?: boolean;
      perguntas?: PerguntaDoApp[];
      previasParaFechar?: string[];
    }
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
  // O usuário trocou o nome do Orquestrador (já aparado; sem `turnoId`: vale também durante um pedido).
  | { tipo: "orquestrador_renomeado"; nome: string }
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
  /** O chat pode publicar artefatos online no claude.ai. Desligado por padrão. */
  permitirArtefatosOnline: boolean;
}

/**
 * Ação que o Claude sugere no app; só é executada quando o usuário clica.
 * As mensagens gravadas antes das ações de subagente só têm `abrir_orquestrador`.
 */
export type AcaoDoApp = AcaoDeAbrirOrquestrador | AcaoDeCriarSubagente | AcaoDeEditarSubagente;

/** Os modelos que o chat sugere para um subagente pronto: os mesmos do painel Subagentes. */
export type ModeloDoSubagenteNoChat = "herdar" | "opus" | "sonnet" | "haiku";

/** Acrescentar um subagente pronto à biblioteca (o servidor valida ao gravar). */
export interface AcaoDeCriarSubagente {
  tipo: "criar_subagente";
  nome: string;
  descricao: string;
  prompt: string;
  modelo: ModeloDoSubagenteNoChat;
}

/** Trocar campos de um subagente pronto existente, pelo nome; nulo fica como está. */
export interface AcaoDeEditarSubagente {
  tipo: "editar_subagente";
  nome: string;
  descricao: string | null;
  prompt: string | null;
  modelo: ModeloDoSubagenteNoChat | null;
}

export interface AcaoDeAbrirOrquestrador {
  tipo: "abrir_orquestrador";
  projeto: string;
  pasta: string;
  pedido: string | null;
  /** Cria um Orquestrador novo na pasta em vez de reaproveitar um. Falta nas mensagens antigas (vale false). */
  novo?: boolean;
  /**
   * Nome de um orquestrador da pasta que o Claude escolheu para o pedido, já
   * conferido pelo servidor; nulo deixa a tela escolher. Falta nas mensagens antigas.
   */
  orquestrador?: string | null;
  /** Nome sugerido (a função) para o orquestrador que a ação criar; nulo usa o do projeto. Falta nas mensagens antigas. */
  nome?: string | null;
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

/**
 * De onde veio uma pergunta que não foi digitada: `escuta` é a detectada na
 * transcrição do áudio do computador, com o modo invisível ligado.
 */
export type OrigemDaPergunta = "escuta";

export interface MensagemDoChat {
  id: string;
  papel: PapelNoChat;
  texto: string;
  imagens: ImagemDaMensagemDoChat[];
  criadaEm: string;
  situacao: SituacaoDaMensagemDoChat;
  acoes: AcaoDoApp[];
  /** Perguntas com opções da resposta. Falta nas mensagens gravadas antes delas (vale vazio). */
  perguntas?: PerguntaDoApp[];
  avisos: string[];
  uso: UsoDaResposta | null;
  /** Falta nas mensagens gravadas antes da autorização (vale `null`). */
  autorizacaoPendente?: AutorizacaoPendente | null;
  /** Só nas perguntas enviadas sozinhas (ex.: pela escuta); falta nas digitadas e nas antigas. */
  origem?: OrigemDaPergunta;
}

/** O trecho transcrito pela escuta e, opcionalmente, o que veio logo antes, para dar sentido a ele. */
export interface PedidoDeClassificacaoDaEscuta {
  trecho: string;
  contexto?: string;
}

/** Se o trecho é uma pergunta e, sendo, a pergunta já pronta para enviar ao chat (nula quando não é). */
export interface ClassificacaoDaEscuta {
  ehPergunta: boolean;
  pergunta: string | null;
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
  // gravados antes da autorização (vale `null`); `perguntas`, nos anteriores a elas (vale vazio).
  | {
      tipo: "resposta_concluida";
      mensagemId: string;
      texto: string;
      acoes: AcaoDoApp[];
      perguntas?: PerguntaDoApp[];
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

// ---------------- Terminais (shell interativo no canvas) ----------------

/**
 * Um terminal de verdade (o shell do computador) aberto pela tela e vivo no
 * servidor. No código da tela ele se chama "shell", para não confundir com o
 * terminal de um Orquestrador; na tela, "Terminal".
 */
export interface DadosDoShell {
  id: string;
  /** A pasta em que o shell começou. */
  pasta: string;
  /** O Orquestrador de cuja pasta (ou worktree) o shell saiu; nulo quando aberto pela barra do canvas. */
  orquestradorId: string | null;
  criadoEm: string;
}

/** O que `POST /api/terminais` recebe: a pasta ou o Orquestrador, e o tamanho inicial em caracteres. */
export interface NovoShell {
  pasta?: string;
  orquestradorId?: string;
  colunas: number;
  linhas: number;
}

/** Do servidor para a tela, pelo WebSocket do terminal (JSON em texto). */
export type MensagemDoShell = { tipo: "saida"; dados: string } | { tipo: "fim"; codigo: number | null };

/** Da tela para o servidor, pelo WebSocket do terminal (JSON em texto). */
export type MensagemParaOShell =
  | { tipo: "entrada"; dados: string }
  | { tipo: "tamanho"; colunas: number; linhas: number };

// ---------------- Visualizador de código ----------------

/** Um item de uma pasta do Orquestrador, num nível só (as subpastas são lidas quando abertas). */
export interface EntradaDaPasta {
  nome: string;
  tipo: "pasta" | "arquivo";
  /** Bytes; só nos arquivos. */
  tamanho?: number;
}

/** O que `GET /api/orquestradores/:id/arquivos` devolve. */
export interface ListagemDaPasta {
  /** Relativo à pasta (ou worktree) do Orquestrador, com `/`; vazio na raiz. */
  caminho: string;
  entradas: EntradaDaPasta[];
  /** A pasta tinha itens demais e a lista veio cortada. */
  truncada: boolean;
}

/** O que `GET /api/orquestradores/:id/arquivos/conteudo` devolve. Só texto até 500 KB. */
export interface ConteudoDoArquivo {
  caminho: string;
  conteudo: string;
  /** Bytes. */
  tamanho: number;
  linhas: number;
}
