import { TipoDeImagem } from "./Anexo";
import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { DocumentoDoPedido } from "./DocumentosAnexados";
import { EventoDoMotor, UsoDoTurno } from "./EventoDeOrquestracao";
import { ItemLigado } from "./InstrucoesDoOrquestrador";
import { InstrucoesAplicadas } from "./InstrucoesPersonalizadas";
import { ModoDoTurno } from "./ModoDoTurno";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { DadosDoSubagentePronto } from "./SubagentesProntos";

/** Imagem anexada ao pedido, já guardada em disco. */
export interface ImagemDoPedido {
  caminho: string;
  tipoDeMidia: TipoDeImagem;
}

export interface PedidoDeTurno {
  orquestradorId: string;
  sessaoId: string;
  /** Falso no primeiro turno: o motor cria a sessão; verdadeiro nos seguintes: retoma. */
  sessaoIniciada: boolean;
  texto: string;
  configuracao: ConfiguracaoDoOrquestrador;
  /** No planejamento, os agentes só leem, seja qual for o nível da configuração. */
  modo: ModoDoTurno;
  pastaDeTrabalho: PastaDeTrabalho;
  imagens: readonly ImagemDoPedido[];
  /** Documentos anexados (o texto extraído está ao lado do original); citados na mensagem ao Orquestrador. */
  documentos?: readonly DocumentoDoPedido[];
  /** Pasta dos anexos (imagens e documentos), liberada para leitura dos Subagentes; nula sem anexos. */
  pastaDasImagens: string | null;
  /**
   * Pasta de entrada dos artefatos deste Orquestrador (caminho absoluto): o
   * Orquestrador e os Subagentes podem gravar nela em qualquer nível de
   * permissão e no planejamento. O motor a cria se não existir.
   */
  pastaDeArtefatos: string;
  /**
   * Instruções personalizadas que valem neste pedido (as do Orquestrador ou o
   * padrão global), resolvidas quando o turno começou; nulas sem nenhuma.
   */
  instrucoes: InstrucoesAplicadas | null;
  /**
   * Sem instruções neste pedido, mas a conversa já recebeu instruções em
   * pedidos anteriores (que seguem no histórico): avisar que deixaram de valer.
   */
  revogarInstrucoesAnteriores: boolean;
  /**
   * Subagentes prontos da biblioteca do usuário, capturados quando o turno
   * começou: vão no `agentes.json` ao lado do executor e são listados no bloco
   * do pedido. Lista vazia: tudo como antes.
   */
  subagentesProntos: readonly DadosDoSubagentePronto[];
  /**
   * Os itens que o usuário ligou ao Orquestrador no canvas (notas, prévias,
   * artefatos), mandados com o pedido: vão no bloco `<itens-ligados>` da
   * mensagem. Ausente ou vazio: nenhum.
   */
  itensLigados?: readonly ItemLigado[] | undefined;
  /**
   * Os endereços das prévias ao vivo abertas no canvas quando o pedido saiu:
   * entram numa linha da mensagem, para o Orquestrador fechar as que não
   * servem mais. Ausente ou vazio: nenhuma linha.
   */
  previasAbertas?: readonly string[] | undefined;
}

/** Por que um turno falhou, quando dá para saber. */
export type CausaDaFalha = "silencio" | "limite_de_uso" | "sobrecarga" | "rede" | "outro";

export type ResultadoDoTurno =
  | { sucesso: true; resposta: string; uso: UsoDoTurno }
  | {
      sucesso: false;
      motivo: string;
      uso: UsoDoTurno | null;
      /** Ausente = "outro". */
      causa?: CausaDaFalha;
      /** Só em "limite_de_uso", quando o Claude informa quando libera (ISO). */
      liberaEm?: string | null;
    };

/** Razão do abort que pede ao motor um resultado de falha por silêncio (`causa: "silencio"`). */
export const ABORTO_POR_SILENCIO = "silencio";

/**
 * Quem de fato executa o Orquestrador e seus Subagentes.
 *
 * Porta do domínio: hoje é o Claude Code em modo headless, que usa o login da
 * assinatura do usuário; para oferecer o app a outras pessoas num servidor,
 * basta outro adaptador (Agent SDK com API key) sem mexer no domínio.
 *
 * Quando `sinal` é abortado, o motor encerra tudo o que lançou e resolve a
 * promessa — cabe ao chamador saber que foi um cancelamento. Com
 * `sinal.reason === "silencio"` (a autorrecuperação desistiu de esperar), o
 * motor resolve `{ sucesso: false, causa: "silencio", … }`.
 */
export interface MotorDeAgentes {
  executarTurno(
    pedido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
    /** Chamado a cada linha que o processo escreve (stdout ou stderr), inclusive as que não viram evento; no máximo uma vez por segundo. */
    aoReceberLinha?: () => void,
  ): Promise<ResultadoDoTurno>;
}
