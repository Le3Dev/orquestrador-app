import type { TipoDeImagem } from "../orquestracao/Anexo";
import type { EsforcoDeRaciocinio } from "../orquestracao/EsforcoDeRaciocinio";
import type { JanelaDaCota } from "../orquestracao/EventoDeOrquestracao";
import type { ModeloClaude } from "../orquestracao/ModeloClaude";
import type { AutorizacaoPendente } from "./MensagemDoChat";

/** Imagem anexada à pergunta, já guardada em disco. */
export interface ImagemDaPergunta {
  /** Caminho absoluto do arquivo; o motor lê e envia o conteúdo junto com o texto. */
  caminho: string;
  tipoDeMidia: TipoDeImagem;
}

/** Tudo o que o motor precisa para responder uma pergunta do chat rápido. */
export interface PerguntaAoMotorDeChat {
  /** Identificador da conversa no motor; o mesmo em todas as perguntas da conversa. */
  sessaoId: string;
  /** Falso na primeira pergunta (cria a sessão com `--session-id`); verdadeiro nas seguintes (`--resume`). */
  sessaoIniciada: boolean;
  /** Texto final enviado pelo stdin, já com o bloco `<contexto-do-app>`. */
  mensagem: string;
  /** Instruções fixas do chat, acrescentadas ao prompt de sistema (`--append-system-prompt-file`). */
  instrucoes: string;
  imagens: readonly ImagemDaPergunta[];
  /** Pasta onde as imagens estão, liberada para leitura; nula quando não há imagens. */
  pastaDasImagens: string | null;
  /** Pasta de trabalho do processo (cwd); criada se não existir. */
  pastaDaSessao: string;
  /**
   * Raiz dos projetos: leitura sempre; edição e comandos só com
   * `alteracoesAutorizadas` (arquivos `.env*` continuam negados).
   */
  pastaDosProjetos: string;
  /**
   * Pasta de entrada dos artefatos do chat (caminho absoluto): gravar nela é
   * sempre permitido, com ou sem `alteracoesAutorizadas`, e nunca pede
   * autorização. O motor a cria se não existir.
   */
  pastaDeArtefatos: string;
  modelo: ModeloClaude;
  esforco: EsforcoDeRaciocinio;
  /** Se o chat pode publicar artefatos online no claude.ai (ferramenta `Artifact`). */
  permitirArtefatosOnline: boolean;
  /**
   * Se o usuário autorizou editar arquivos e rodar comandos nesta conversa.
   * Sem autorização, a tentativa é negada e volta como `autorizacaoPendente`.
   */
  alteracoesAutorizadas: boolean;
}

/** O que acontece enquanto o motor responde, para a tela acompanhar ao vivo. */
export type EventoDoMotorDeChat =
  /** A sessão foi aberta (já existe em disco), mesmo antes de qualquer texto. */
  | { tipo: "sessao_aberta" }
  /** Pedaço de texto da resposta, na ordem em que é gerado. */
  | { tipo: "trecho_da_resposta"; texto: string }
  /** O motor usou uma ferramenta (pesquisa na web, leitura, edição, comando…); `detalhe` é um resumo curto da entrada. */
  | { tipo: "ferramenta_do_chat"; ferramenta: string; detalhe: string }
  /** Situação da cota da assinatura do Claude. */
  | { tipo: "uso_da_cota"; janelas: JanelaDaCota[] };

/** Consumo de uma resposta. */
export interface UsoDaResposta {
  /** Tempo de relógio, do início do processo ao fim. */
  duracaoMs: number;
  /** Entrada + criação de cache + leitura de cache. */
  tokensDeEntrada: number;
  tokensDeSaida: number;
  /** ID do modelo que mais gerou saída (ex.: `claude-opus-5-5`); nulo se o motor não informou. */
  modeloUsado: string | null;
}

export type ResultadoDaResposta =
  | {
      sucesso: true;
      resposta: string;
      uso: UsoDaResposta;
      /** A primeira edição ou comando negado por falta de autorização; nulo se não houve. */
      autorizacaoPendente: AutorizacaoPendente | null;
      /** Outras ações bloqueadas (leitura de `.env*`, regra fixa do app), já legíveis. */
      avisos: string[];
    }
  | { sucesso: false; motivo: string; uso: UsoDaResposta | null };

/** Porta do chat rápido para o motor que gera as respostas. */
export interface MotorDeChat {
  /** Com `sinal` abortado, encerra o processo e resolve; o chamador sabe que foi cancelamento. */
  responder(
    pergunta: PerguntaAoMotorDeChat,
    aoObservar: (evento: EventoDoMotorDeChat) => void,
    sinal: AbortSignal,
  ): Promise<ResultadoDaResposta>;
}
