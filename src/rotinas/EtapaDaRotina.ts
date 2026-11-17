import { ErroDeRotina, formatarMilhares } from "./ErroDeRotina";

export const MODOS_DO_PEDIDO = ["execucao", "planejamento"] as const;
export type ModoDoPedido = (typeof MODOS_DO_PEDIDO)[number];

export const TIPOS_DE_ETAPA = ["pedido", "aprovacao", "espera"] as const;
export type TipoDeEtapa = (typeof TIPOS_DE_ETAPA)[number];

export const TAMANHO_MAXIMO_DO_TEXTO_DO_PEDIDO = 20_000;
export const TAMANHO_MAXIMO_DA_MENSAGEM_DE_APROVACAO = 1_000;
/** Um dia: a espera vive na memória do app, então uma espera longa demais não sobreviveria a ele. */
export const MINUTOS_MAXIMOS_DA_ESPERA = 1_440;

/** Mesma regra de identidade dos Orquestradores: vira nome de pasta em outros contextos. */
export const IDENTIDADE_DE_ORQUESTRADOR_VALIDA = /^[A-Za-z0-9_-]{1,100}$/;

export const MENSAGEM_DE_ORQUESTRADOR_INVALIDO = "Escolha o orquestrador que vai receber o pedido.";
export const MENSAGEM_DE_TEXTO_VAZIO = "Escreva o pedido que o orquestrador deve receber.";
export const MENSAGEM_DE_TEXTO_LONGO_DEMAIS = `O pedido pode ter até ${formatarMilhares(TAMANHO_MAXIMO_DO_TEXTO_DO_PEDIDO)} caracteres.`;
export const MENSAGEM_DE_MODO_INVALIDO = "O modo do pedido deve ser execução ou planejamento.";
export const MENSAGEM_DE_APROVACAO_INVALIDA = `A mensagem de aprovação deve ter entre 1 e ${formatarMilhares(TAMANHO_MAXIMO_DA_MENSAGEM_DE_APROVACAO)} caracteres.`;
export const MENSAGEM_DE_ESPERA_INVALIDA = `A espera deve ser de 1 a ${formatarMilhares(MINUTOS_MAXIMOS_DA_ESPERA)} minutos.`;
export const MENSAGEM_DE_ETAPA_INVALIDA = "Cada etapa deve ser um pedido, uma aprovação ou uma espera.";

export type DadosDaEtapa =
  | { tipo: "pedido"; orquestradorId: string; texto: string; modo: ModoDoPedido }
  | { tipo: "aprovacao"; mensagem: string }
  | { tipo: "espera"; minutos: number };

/**
 * Objeto de valor: um passo da Rotina. Imutável.
 *
 * - `pedido`: o texto vai para um Orquestrador (em `execucao` ele trabalha; em
 *   `planejamento` ele só devolve um plano, que fica aguardando aprovação).
 * - `aprovacao`: a Rotina para até o usuário aprovar ou recusar.
 * - `espera`: a Rotina espera alguns minutos antes de seguir.
 */
export class EtapaDaRotina {
  private constructor(public readonly dados: Readonly<DadosDaEtapa>) {
    Object.freeze(this);
  }

  /** Valida e cria. `dados` pode vir de qualquer lugar (corpo HTTP, arquivo): nada é presumido. */
  static criar(dados: DadosDaEtapa): EtapaDaRotina {
    const tipo: unknown = (dados as { tipo?: unknown } | null)?.tipo;
    switch (tipo) {
      case "pedido": {
        const pedido = dados as { orquestradorId?: unknown; texto?: unknown; modo?: unknown };
        if (typeof pedido.orquestradorId !== "string" || !IDENTIDADE_DE_ORQUESTRADOR_VALIDA.test(pedido.orquestradorId)) {
          throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_ORQUESTRADOR_INVALIDO);
        }
        if (typeof pedido.texto !== "string" || pedido.texto.trim() === "") {
          throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_TEXTO_VAZIO);
        }
        if (pedido.texto.length > TAMANHO_MAXIMO_DO_TEXTO_DO_PEDIDO) {
          throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_TEXTO_LONGO_DEMAIS);
        }
        if (pedido.modo !== "execucao" && pedido.modo !== "planejamento") {
          throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_MODO_INVALIDO);
        }
        return new EtapaDaRotina(
          Object.freeze({ tipo: "pedido", orquestradorId: pedido.orquestradorId, texto: pedido.texto, modo: pedido.modo }),
        );
      }
      case "aprovacao": {
        const mensagem = (dados as { mensagem?: unknown }).mensagem;
        const aparada = typeof mensagem === "string" ? mensagem.trim() : "";
        if (aparada === "" || aparada.length > TAMANHO_MAXIMO_DA_MENSAGEM_DE_APROVACAO) {
          throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_APROVACAO_INVALIDA);
        }
        return new EtapaDaRotina(Object.freeze({ tipo: "aprovacao", mensagem: aparada }));
      }
      case "espera": {
        const minutos = (dados as { minutos?: unknown }).minutos;
        if (typeof minutos !== "number" || !Number.isInteger(minutos) || minutos < 1 || minutos > MINUTOS_MAXIMOS_DA_ESPERA) {
          throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_ESPERA_INVALIDA);
        }
        return new EtapaDaRotina(Object.freeze({ tipo: "espera", minutos }));
      }
      default:
        throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_ETAPA_INVALIDA);
    }
  }

  static reconstituir(dados: DadosDaEtapa): EtapaDaRotina {
    return EtapaDaRotina.criar(dados);
  }

  get tipo(): TipoDeEtapa {
    return this.dados.tipo;
  }

  /** Uma cópia: quem recebe pode mexer à vontade sem alterar a etapa. */
  paraDados(): DadosDaEtapa {
    return { ...this.dados };
  }
}
