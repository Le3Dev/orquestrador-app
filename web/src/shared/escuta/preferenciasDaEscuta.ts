/** Preferências da escuta, guardadas neste computador (localStorage). */
export interface PreferenciasDaEscuta {
  /** Ligada: a escuta classifica e envia as perguntas sozinha. Desligada: só transcreve. */
  readonly automatico: boolean;
  /** O mesmo, mas para a escuta ligada à mão (botão 🎧), fora do modo invisível. Começa desligado. */
  readonly automaticoManual: boolean;
  /** A pessoa já confirmou o aviso da primeira vez. */
  readonly avisoVisto: boolean;
}

export const CHAVE_DAS_PREFERENCIAS_DA_ESCUTA = "orquestrador.preferenciasDaEscuta";

export const PREFERENCIAS_PADRAO_DA_ESCUTA: PreferenciasDaEscuta = Object.freeze({
  automatico: true,
  automaticoManual: false,
  avisoVisto: false,
});

/** Onde a sessão lê e grava as preferências (um falso nos testes). */
export interface ArmazenamentoDasPreferencias {
  ler(): PreferenciasDaEscuta;
  gravar(preferencias: PreferenciasDaEscuta): void;
}

/** Tolerante: JSON inválido, outro formato ou campo de outro tipo valem o padrão. */
export function interpretarPreferenciasDaEscuta(bruto: string | null): PreferenciasDaEscuta {
  if (bruto === null) return PREFERENCIAS_PADRAO_DA_ESCUTA;
  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    return PREFERENCIAS_PADRAO_DA_ESCUTA;
  }
  if (typeof lido !== "object" || lido === null || Array.isArray(lido)) return PREFERENCIAS_PADRAO_DA_ESCUTA;
  const registro = lido as Record<string, unknown>;
  return Object.freeze({
    automatico:
      typeof registro.automatico === "boolean" ? registro.automatico : PREFERENCIAS_PADRAO_DA_ESCUTA.automatico,
    automaticoManual:
      typeof registro.automaticoManual === "boolean"
        ? registro.automaticoManual
        : PREFERENCIAS_PADRAO_DA_ESCUTA.automaticoManual,
    avisoVisto:
      typeof registro.avisoVisto === "boolean" ? registro.avisoVisto : PREFERENCIAS_PADRAO_DA_ESCUTA.avisoVisto,
  });
}

/** O localStorage do navegador; bloqueado, lê o padrão e a gravação fica só na memória da sessão. */
export const preferenciasNoNavegador: ArmazenamentoDasPreferencias = Object.freeze({
  ler(): PreferenciasDaEscuta {
    try {
      return interpretarPreferenciasDaEscuta(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_ESCUTA));
    } catch {
      return PREFERENCIAS_PADRAO_DA_ESCUTA;
    }
  },
  gravar(preferencias: PreferenciasDaEscuta): void {
    try {
      localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_ESCUTA, JSON.stringify(preferencias));
    } catch {
      // Sem localStorage gravável: vale só enquanto a tela estiver aberta.
    }
  },
});
