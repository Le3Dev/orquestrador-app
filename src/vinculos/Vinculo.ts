import { ErroDeVinculo } from "./ErroDeVinculo";

/** Tamanho máximo das notas compartilhadas de um vínculo: elas vão em todo prompt dos dois lados. */
export const TAMANHO_MAXIMO_DAS_NOTAS_DO_VINCULO = 8_000;

export const MENSAGEM_DE_NOTAS_LONGAS_DEMAIS = `As notas do vínculo podem ter até ${TAMANHO_MAXIMO_DAS_NOTAS_DO_VINCULO} caracteres.`;

export interface DadosDoVinculo {
  id: string;
  orquestradorAId: string;
  orquestradorBId: string;
  notas: string;
  /** ISO 8601 */
  criadoEm: string;
  /** ISO 8601 */
  atualizadoEm: string;
}

export interface NovoVinculo {
  id: string;
  orquestradorAId: string;
  orquestradorBId: string;
  agora: Date;
}

/**
 * Ligação criada pelo usuário entre dois Orquestradores (de qualquer projeto):
 * eles passam a poder trocar mensagens e a compartilhar um bloco de notas.
 *
 * A ligação não tem direção: o par A/B guarda só a ordem em que foi criado.
 * Os Orquestradores são referenciados por identidade, sem importar o agregado.
 */
export class Vinculo {
  private constructor(
    public readonly id: string,
    public readonly orquestradorAId: string,
    public readonly orquestradorBId: string,
    private notasAtuais: string,
    private readonly criadoEmMs: number,
    private atualizadoEmMs: number,
  ) {}

  static criar({ id, orquestradorAId, orquestradorBId, agora }: NovoVinculo): Vinculo {
    if (orquestradorAId === "" || orquestradorBId === "") {
      throw new ErroDeVinculo("dados_invalidos", "Escolha os dois orquestradores a vincular.");
    }
    if (orquestradorAId === orquestradorBId) {
      throw new ErroDeVinculo("dados_invalidos", "Um orquestrador não pode ser vinculado a ele mesmo.");
    }
    return new Vinculo(id, orquestradorAId, orquestradorBId, "", agora.getTime(), agora.getTime());
  }

  static reconstituir(dados: DadosDoVinculo): Vinculo {
    return new Vinculo(
      dados.id,
      dados.orquestradorAId,
      dados.orquestradorBId,
      dados.notas,
      Date.parse(dados.criadoEm),
      Date.parse(dados.atualizadoEm),
    );
  }

  get notas(): string {
    return this.notasAtuais;
  }

  get criadoEm(): Date {
    return new Date(this.criadoEmMs);
  }

  get atualizadoEm(): Date {
    return new Date(this.atualizadoEmMs);
  }

  /** Este vínculo liga o Orquestrador? */
  envolve(orquestradorId: string): boolean {
    return this.orquestradorAId === orquestradorId || this.orquestradorBId === orquestradorId;
  }

  /** Liga exatamente estes dois, em qualquer ordem? */
  ehEntre(umId: string, outroId: string): boolean {
    return (
      (this.orquestradorAId === umId && this.orquestradorBId === outroId) ||
      (this.orquestradorAId === outroId && this.orquestradorBId === umId)
    );
  }

  /** O Orquestrador do outro lado, visto de `orquestradorId`; nulo se ele não faz parte do vínculo. */
  parceiroDe(orquestradorId: string): string | null {
    if (orquestradorId === this.orquestradorAId) {
      return this.orquestradorBId;
    }
    return orquestradorId === this.orquestradorBId ? this.orquestradorAId : null;
  }

  /** Substitui as notas inteiras; texto igual ao atual não conta como alteração. */
  reescreverNotas(texto: string, agora: Date): void {
    if (texto.length > TAMANHO_MAXIMO_DAS_NOTAS_DO_VINCULO) {
      throw new ErroDeVinculo("dados_invalidos", MENSAGEM_DE_NOTAS_LONGAS_DEMAIS);
    }
    if (texto === this.notasAtuais) {
      return;
    }
    this.notasAtuais = texto;
    this.atualizadoEmMs = agora.getTime();
  }

  paraDados(): DadosDoVinculo {
    return {
      id: this.id,
      orquestradorAId: this.orquestradorAId,
      orquestradorBId: this.orquestradorBId,
      notas: this.notasAtuais,
      criadoEm: new Date(this.criadoEmMs).toISOString(),
      atualizadoEm: new Date(this.atualizadoEmMs).toISOString(),
    };
  }
}
