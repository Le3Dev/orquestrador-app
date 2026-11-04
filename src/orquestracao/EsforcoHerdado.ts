import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ehEsforcoDeRaciocinio, EsforcoDeRaciocinio } from "./EsforcoDeRaciocinio";

export interface DadosDoEsforcoHerdado {
  nivel: EsforcoDeRaciocinio;
  origem: string;
  modelo: string | null;
  deveAvisar: boolean;
}

export interface NovoEsforcoHerdado {
  nivel: Exclude<EsforcoDeRaciocinio, "padrao">;
  origem: string;
  modelo: string | null;
}

/** Níveis caros o bastante para avisar quem deixou o esforço em "Padrão". */
const NIVEIS_QUE_AVISAM: readonly EsforcoDeRaciocinio[] = ["extra_alto", "maximo"];

/**
 * O esforço de raciocínio que o Claude Code usa de verdade quando o app deixa
 * o esforço em "Padrão": vem do ambiente ou das configurações do próprio
 * Claude Code na máquina. `origem` diz de onde (para o usuário saber o que
 * mudar). Objeto de valor.
 */
export class EsforcoHerdado {
  private constructor(
    public readonly nivel: Exclude<EsforcoDeRaciocinio, "padrao">,
    public readonly origem: string,
    public readonly modelo: string | null,
  ) {
    Object.freeze(this);
  }

  static criar(dados: NovoEsforcoHerdado): EsforcoHerdado {
    // Conferido em tempo de execução também: o nível vem de arquivos e variáveis da máquina.
    const nivel: unknown = dados.nivel;
    if (!ehEsforcoDeRaciocinio(nivel) || nivel === "padrao") {
      throw new ErroDeOrquestracao("dados_invalidos", "Esforço herdado inválido.");
    }
    const origem = dados.origem.trim();
    if (origem === "") {
      throw new ErroDeOrquestracao("dados_invalidos", "Informe de onde vem o esforço herdado.");
    }
    const modelo = dados.modelo === null ? null : dados.modelo.trim();
    return new EsforcoHerdado(dados.nivel, origem, modelo === null || modelo === "" ? null : modelo);
  }

  /** "Padrão" está saindo caro: o Claude Code raciocina em extra alto ou máximo. */
  deveAvisar(): boolean {
    return NIVEIS_QUE_AVISAM.includes(this.nivel);
  }

  paraDados(): DadosDoEsforcoHerdado {
    return { nivel: this.nivel, origem: this.origem, modelo: this.modelo, deveAvisar: this.deveAvisar() };
  }
}
