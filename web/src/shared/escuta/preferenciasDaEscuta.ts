/** Em que idioma a escuta transcreve: português fixo ou detectado a cada fala. */
export type IdiomaDaEscuta = "portuguese" | "automatico";

/** O que pesa na escolha do motor de transcrição: rapidez ou acerto. */
export type PrioridadeDoMotor = "velocidade" | "precisao";

/** Como a legenda da escuta aparece na tela. Imutável. */
export interface AparenciaDaEscuta {
  /** Em px, de 12 a 22. */
  readonly tamanhoDaFonte: number;
  /** De 0,4 a 1. */
  readonly opacidade: number;
  readonly compacto: boolean;
}

/** Preferências da escuta, guardadas neste computador (localStorage). */
export interface PreferenciasDaEscuta {
  /** Ligada: a escuta classifica e envia as perguntas sozinha. Desligada: só transcreve. */
  readonly automatico: boolean;
  /** O mesmo, mas para a escuta ligada à mão (botão 🎧), fora do modo invisível. Começa ligado. */
  readonly automaticoManual: boolean;
  /** A pessoa já confirmou o aviso da primeira vez. */
  readonly avisoVisto: boolean;
  readonly idioma: IdiomaDaEscuta;
  readonly prioridadeDoMotor: PrioridadeDoMotor;
  readonly aparencia: AparenciaDaEscuta;
}

export const CHAVE_DAS_PREFERENCIAS_DA_ESCUTA = "orquestrador.preferenciasDaEscuta";

/**
 * Versão do formato gravado. Na 2, o idioma padrão foi o automático, que
 * detectava errado (português saía como inglês); na 3, o padrão volta a ser
 * português e o Automático do 🎧 passa a começar ligado. Dados sem versão (ou
 * de versão anterior) têm o idioma e o `automaticoManual` só porque eram o
 * padrão daquela época, então são lidos como os padrões novos.
 */
export const VERSAO_DAS_PREFERENCIAS_DA_ESCUTA = 3;

export const LIMITES_DO_TAMANHO_DA_FONTE = Object.freeze({ minimo: 12, maximo: 22 });
export const LIMITES_DA_OPACIDADE = Object.freeze({ minimo: 0.4, maximo: 1 });

export const APARENCIA_PADRAO_DA_ESCUTA: AparenciaDaEscuta = Object.freeze({
  tamanhoDaFonte: 14,
  opacidade: 0.92,
  compacto: false,
});

export const PREFERENCIAS_PADRAO_DA_ESCUTA: PreferenciasDaEscuta = Object.freeze({
  automatico: true,
  automaticoManual: true,
  avisoVisto: false,
  idioma: "portuguese",
  prioridadeDoMotor: "velocidade",
  aparencia: APARENCIA_PADRAO_DA_ESCUTA,
});

/** Onde a sessão lê e grava as preferências (um falso nos testes). */
export interface ArmazenamentoDasPreferencias {
  ler(): PreferenciasDaEscuta;
  gravar(preferencias: PreferenciasDaEscuta): void;
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}

/**
 * Uma aparência dentro dos limites: número fora da faixa vai para a borda;
 * campo ausente ou de outro tipo vale o padrão.
 */
export function aparenciaValida(bruta: Partial<Record<keyof AparenciaDaEscuta, unknown>>): AparenciaDaEscuta {
  const padrao = APARENCIA_PADRAO_DA_ESCUTA;
  const fonte = bruta.tamanhoDaFonte;
  const opacidade = bruta.opacidade;
  return Object.freeze({
    tamanhoDaFonte:
      typeof fonte === "number" && Number.isFinite(fonte)
        ? limitar(Math.round(fonte), LIMITES_DO_TAMANHO_DA_FONTE.minimo, LIMITES_DO_TAMANHO_DA_FONTE.maximo)
        : padrao.tamanhoDaFonte,
    opacidade:
      typeof opacidade === "number" && Number.isFinite(opacidade)
        ? limitar(opacidade, LIMITES_DA_OPACIDADE.minimo, LIMITES_DA_OPACIDADE.maximo)
        : padrao.opacidade,
    compacto: typeof bruta.compacto === "boolean" ? bruta.compacto : padrao.compacto,
  });
}

function idiomaValido(bruto: unknown): IdiomaDaEscuta {
  return bruto === "automatico" || bruto === "portuguese" ? bruto : PREFERENCIAS_PADRAO_DA_ESCUTA.idioma;
}

function prioridadeValida(bruta: unknown): PrioridadeDoMotor {
  return bruta === "velocidade" || bruta === "precisao" ? bruta : PREFERENCIAS_PADRAO_DA_ESCUTA.prioridadeDoMotor;
}

/** O registro foi gravado na versão atual do formato (ou numa mais nova). */
function daVersaoAtual(registro: Record<string, unknown>): boolean {
  const versao = registro.versao;
  return typeof versao === "number" && versao >= VERSAO_DAS_PREFERENCIAS_DA_ESCUTA;
}

/** O idioma gravado vale só a partir da versão atual do formato; antes dela, vale o padrão (português). */
function idiomaDaVersao(registro: Record<string, unknown>): IdiomaDaEscuta {
  return daVersaoAtual(registro) ? idiomaValido(registro.idioma) : PREFERENCIAS_PADRAO_DA_ESCUTA.idioma;
}

/** O Automático do 🎧 gravado vale só a partir da versão atual; antes dela, desligado era o padrão, não escolha. */
function automaticoManualDaVersao(registro: Record<string, unknown>): boolean {
  const gravado = registro.automaticoManual;
  return daVersaoAtual(registro) && typeof gravado === "boolean"
    ? gravado
    : PREFERENCIAS_PADRAO_DA_ESCUTA.automaticoManual;
}

/** O texto gravado no localStorage: as preferências com a versão do formato. */
export function serializarPreferenciasDaEscuta(preferencias: PreferenciasDaEscuta): string {
  return JSON.stringify({ versao: VERSAO_DAS_PREFERENCIAS_DA_ESCUTA, ...preferencias });
}

/**
 * Tolerante: JSON inválido, outro formato ou campo de outro tipo valem o
 * padrão. Dados sem versão ou de versão anterior à atual mantêm as outras
 * preferências, mas o idioma vira português e o Automático do 🎧 vira ligado
 * (os padrões novos).
 */
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
  const aparencia = registro.aparencia;
  return Object.freeze({
    automatico:
      typeof registro.automatico === "boolean" ? registro.automatico : PREFERENCIAS_PADRAO_DA_ESCUTA.automatico,
    automaticoManual: automaticoManualDaVersao(registro),
    avisoVisto:
      typeof registro.avisoVisto === "boolean" ? registro.avisoVisto : PREFERENCIAS_PADRAO_DA_ESCUTA.avisoVisto,
    idioma: idiomaDaVersao(registro),
    prioridadeDoMotor: prioridadeValida(registro.prioridadeDoMotor),
    aparencia:
      typeof aparencia === "object" && aparencia !== null && !Array.isArray(aparencia)
        ? aparenciaValida(aparencia as Record<string, unknown>)
        : APARENCIA_PADRAO_DA_ESCUTA,
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
      localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_ESCUTA, serializarPreferenciasDaEscuta(preferencias));
    } catch {
      // Sem localStorage gravável: vale só enquanto a tela estiver aberta.
    }
  },
});
