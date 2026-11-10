import { EsforcoDeRaciocinio, ehEsforcoDeRaciocinio } from "../orquestracao/EsforcoDeRaciocinio";
import { ehModeloClaude, ModeloClaude } from "../orquestracao/ModeloClaude";
import { ErroDoChat } from "./ErroDoChat";

export interface DadosDasPreferenciasDoChat {
  modelo: ModeloClaude;
  esforco: EsforcoDeRaciocinio;
  /** Se o chat pode publicar artefatos online no claude.ai. Desligada por padrão. */
  permitirArtefatosOnline: boolean;
}

export type AlteracoesDasPreferenciasDoChat = Partial<DadosDasPreferenciasDoChat>;

const PADRAO: DadosDasPreferenciasDoChat = { modelo: "opus", esforco: "alto", permitirArtefatosOnline: false };

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
    public readonly permitirArtefatosOnline: boolean,
  ) {
    Object.freeze(this);
  }

  static padrao(): PreferenciasDoChat {
    return new PreferenciasDoChat(PADRAO.modelo, PADRAO.esforco, PADRAO.permitirArtefatosOnline);
  }

  /** `permitirArtefatosOnline` ausente (preferências gravadas antes da opção) vale `false`. */
  static de(dados: { modelo: unknown; esforco: unknown; permitirArtefatosOnline?: unknown }): PreferenciasDoChat {
    if (!ehModeloClaude(dados.modelo)) {
      throw new ErroDoChat("dados_invalidos", "Modelo inválido.");
    }
    if (!ehEsforcoDeRaciocinio(dados.esforco)) {
      throw new ErroDoChat("dados_invalidos", "Esforço inválido.");
    }
    const permitirArtefatosOnline = dados.permitirArtefatosOnline ?? false;
    if (typeof permitirArtefatosOnline !== "boolean") {
      throw new ErroDoChat("dados_invalidos", "A opção de artefatos online deve ser verdadeira ou falsa.");
    }
    return new PreferenciasDoChat(dados.modelo, dados.esforco, permitirArtefatosOnline);
  }

  com(alteracoes: AlteracoesDasPreferenciasDoChat): PreferenciasDoChat {
    return PreferenciasDoChat.de({
      modelo: alteracoes.modelo ?? this.modelo,
      esforco: alteracoes.esforco ?? this.esforco,
      permitirArtefatosOnline: alteracoes.permitirArtefatosOnline ?? this.permitirArtefatosOnline,
    });
  }

  paraDados(): DadosDasPreferenciasDoChat {
    return { modelo: this.modelo, esforco: this.esforco, permitirArtefatosOnline: this.permitirArtefatosOnline };
  }
}
