// 32 simbolos (A-Z sem I e O, mais 2-9): 256 e multiplo de 32, entao nao ha vies no sorteio.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FORMATO = /^ORQ(-[A-HJ-NP-Z2-9]{4}){4}$/;

/** Objeto de valor imutavel: ORQ-XXXX-XXXX-XXXX-XXXX. */
export class ChaveDeLicenca {
  private constructor(readonly valor: string) {
    Object.freeze(this);
  }

  static gerar(): ChaveDeLicenca {
    const sorteio = crypto.getRandomValues(new Uint8Array(16));
    const grupos: string[] = [];
    for (let g = 0; g < 4; g++) {
      let grupo = '';
      for (let i = 0; i < 4; i++) {
        grupo += ALFABETO[(sorteio[g * 4 + i] ?? 0) % ALFABETO.length];
      }
      grupos.push(grupo);
    }
    return new ChaveDeLicenca(`ORQ-${grupos.join('-')}`);
  }

  /** Normaliza (trim + maiusculas) e valida o formato; null se nao for uma chave. */
  static interpretar(texto: string): ChaveDeLicenca | null {
    const normalizada = texto.trim().toUpperCase();
    return FORMATO.test(normalizada) ? new ChaveDeLicenca(normalizada) : null;
  }

  /** Reconstitui a partir do banco (ja validada na criacao). */
  static reconstituir(valor: string): ChaveDeLicenca {
    return new ChaveDeLicenca(valor);
  }
}