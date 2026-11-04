import { EsforcoDeRaciocinio, ehEsforcoDeRaciocinio } from "../orquestracao/EsforcoDeRaciocinio";
import { ehModeloClaude, ModeloClaude } from "../orquestracao/ModeloClaude";
import { ErroDoChat } from "./ErroDoChat";

export interface DadosDasPreferenciasDoChat {
  modelo: ModeloClaude;
  esforco: EsforcoDeRaciocinio;
}

export type AlteracoesDasPreferenciasDoChat = Partial<DadosDasPreferenciasDoChat>;

const PADRAO: DadosDasPreferenciasDoChat = { modelo: "opus", esforco: "alto" };

/**
 * Modelo e esforço com que o chat responde. Objeto de valor: para alterar,
 * cria-se outro (`com`).
 *
 * Fica fora da conversa: limpar a conversa ("/clear") não volta ao padrão —
 * a última escolha do usuário vale até ele trocar de novo.
 */
export class PreferenciasDoChat {
  private constructor(
    public readonly modelo: ModeloClaude,
    public readonly esforco: EsforcoDeRaciocinio,
  ) {
    Object.freeze(this);
  }

  static padrao(): PreferenciasDoChat {
    return new PreferenciasDoChat(PADRAO.modelo, PADRAO.esforco);
  }

  static de(dados: { modelo: unknown; esforco: unknown }): PreferenciasDoChat {
    if (!ehModeloClaude(dados.modelo)) {
      throw new ErroDoChat("dados_invalidos", "Modelo inválido.");
    }
    if (!ehEsforcoDeRaciocinio(dados.esforco)) {
      throw new ErroDoChat("dados_invalidos", "Esforço inválido.");
    }
    return new PreferenciasDoChat(dados.modelo, dados.esforco);
  }

  com(alteracoes: AlteracoesDasPreferenciasDoChat): PreferenciasDoChat {
    return PreferenciasDoChat.de({
      modelo: alteracoes.modelo ?? this.modelo,
      esforco: alteracoes.esforco ?? this.esforco,
    });
  }

  paraDados(): DadosDasPreferenciasDoChat {
    return { modelo: this.modelo, esforco: this.esforco };
  }
}
