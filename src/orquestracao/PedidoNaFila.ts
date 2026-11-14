import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ItemLigado } from "./InstrucoesDoOrquestrador";
import { MODOS_DO_TURNO, ModoDoTurno } from "./ModoDoTurno";

/**
 * Limite do texto de um pedido ao Orquestrador, mandado na hora (mensagem) ou
 * pela fila. Mora aqui, e não no `Orquestrador`, para que o agregado possa
 * usar o `PedidoNaFila` sem import circular; o `Orquestrador` o reexporta.
 */
export const TAMANHO_MAXIMO_DA_MENSAGEM = 50_000;

/** Por que um pedido saiu da fila: o usuário o tirou, ou ele virou um turno. */
export type MotivoDaRetiradaDaFila = "removido" | "enviado";

/**
 * De quem veio um pedido que não é do usuário: a mensagem de um Orquestrador
 * vinculado. `saltos` conta quantas mensagens de vínculo já encadearam até
 * aqui (0 na primeira), para o anti-laço descartar as que passarem do limite.
 * O nome é o do remetente quando a mensagem foi enviada.
 */
export interface OrigemDoPedido {
  orquestradorId: string;
  nome: string;
  saltos: number;
}

export interface DadosDoPedidoNaFila {
  id: string;
  texto: string;
  modo: ModoDoTurno;
  /** ISO 8601. */
  enfileiradoEm: string;
  /** Os itens ligados ao Orquestrador quando o pedido entrou na fila. Ausente: nenhum (e nos pedidos antigos). */
  itensLigados?: ItemLigado[] | undefined;
  /** Os endereços das prévias abertas no canvas quando o pedido entrou na fila. Ausente: nenhuma. */
  previasAbertas?: string[] | undefined;
  /** Quem enviou, se veio de um Orquestrador vinculado. Ausente: o pedido é do usuário (e nos pedidos antigos). */
  origem?: OrigemDoPedido | undefined;
}

export interface NovoPedidoNaFila {
  id: string;
  texto: string;
  modo: ModoDoTurno;
  enfileiradoEm: Date;
  itensLigados?: readonly ItemLigado[] | undefined;
  previasAbertas?: readonly string[] | undefined;
  origem?: OrigemDoPedido | null | undefined;
}

/**
 * Um pedido guardado na fila de um Orquestrador, à espera da vez: sai sozinho
 * quando o turno atual termina bem, ou quando o usuário manda enviar agora.
 * Objeto de valor imutável — só texto e modo (anexos não entram na fila).
 *
 * Os itens ligados ao Orquestrador no canvas ficam congelados como estavam
 * ao enfileirar: o pedido sai mais tarde com o contexto que o usuário viu.
 *
 * O `id` não faz dele uma entidade: serve só para o usuário apontar qual
 * pedido quer tirar ou enviar.
 */
export class PedidoNaFila {
  private constructor(
    public readonly id: string,
    public readonly texto: string,
    public readonly modo: ModoDoTurno,
    private readonly enfileiradoEmMs: number,
    public readonly itensLigados: readonly ItemLigado[],
    public readonly previasAbertas: readonly string[],
    /** Nulo: pedido do usuário. */
    public readonly origem: Readonly<OrigemDoPedido> | null = null,
  ) {
    Object.freeze(this);
  }

  static criar(novo: NovoPedidoNaFila): PedidoNaFila {
    const texto = novo.texto.trim();
    if (texto === "") {
      throw new ErroDeOrquestracao("dados_invalidos", "Escreva o pedido.");
    }
    if (texto.length > TAMANHO_MAXIMO_DA_MENSAGEM) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        `O pedido deve ter até ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`,
      );
    }
    if (!(MODOS_DO_TURNO as readonly string[]).includes(novo.modo)) {
      throw new ErroDeOrquestracao("dados_invalidos", "Modo do pedido inválido.");
    }
    const itens = (novo.itensLigados ?? []).map((item) => Object.freeze({ ...item }));
    return new PedidoNaFila(
      novo.id,
      texto,
      novo.modo,
      novo.enfileiradoEm.getTime(),
      Object.freeze(itens),
      Object.freeze([...(novo.previasAbertas ?? [])]),
      novo.origem === undefined || novo.origem === null ? null : Object.freeze({ ...novo.origem }),
    );
  }

  /** Lido do `orquestrador.json`: já foi validado ao entrar na fila. */
  static reconstituir(dados: DadosDoPedidoNaFila): PedidoNaFila {
    const itens = (dados.itensLigados ?? []).map((item) => Object.freeze({ ...item }));
    return new PedidoNaFila(
      dados.id,
      dados.texto,
      dados.modo,
      Date.parse(dados.enfileiradoEm),
      Object.freeze(itens),
      Object.freeze([...(dados.previasAbertas ?? [])]),
      dados.origem === undefined ? null : Object.freeze({ ...dados.origem }),
    );
  }

  /** Uma cópia: quem a recebe não altera o pedido. */
  get enfileiradoEm(): Date {
    return new Date(this.enfileiradoEmMs);
  }

  paraDados(): DadosDoPedidoNaFila {
    return {
      id: this.id,
      texto: this.texto,
      modo: this.modo,
      enfileiradoEm: new Date(this.enfileiradoEmMs).toISOString(),
      // Sem itens, o campo nem aparece: o `orquestrador.json` e a tela ficam como antes.
      ...(this.itensLigados.length === 0 ? {} : { itensLigados: this.itensLigados.map((item) => ({ ...item })) }),
      ...(this.previasAbertas.length === 0 ? {} : { previasAbertas: [...this.previasAbertas] }),
      ...(this.origem === null ? {} : { origem: { ...this.origem } }),
    };
  }
}
