import type { TipoDeImagem } from "../orquestracao/Anexo";
import type { EsforcoDeRaciocinio } from "../orquestracao/EsforcoDeRaciocinio";
import type { JanelaDaCota } from "../orquestracao/EventoDeOrquestracao";
import type { ModeloClaude } from "../orquestracao/ModeloClaude";

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
  /** Raiz dos projetos, liberada só para leitura (arquivos `.env*` continuam negados). */
  pastaDosProjetos: string;
  modelo: ModeloClaude;
  esforco: EsforcoDeRaciocinio;
}

/** O que acontece enquanto o motor responde, para a tela acompanhar ao vivo. */
export type EventoDoMotorDeChat =
  /** Pedaço de texto da resposta, na ordem em que é gerado. */
  | { tipo: "trecho_da_resposta"; texto: string }
  /** O motor usou uma ferramenta (pesquisa na web, leitura de arquivo…); `detalhe` é um resumo curto da entrada. */
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
  | { sucesso: true; resposta: string; uso: UsoDaResposta }
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
