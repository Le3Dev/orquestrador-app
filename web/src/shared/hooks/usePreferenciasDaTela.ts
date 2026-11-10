import { useSyncExternalStore } from "react";

/** De que lado do canvas fica o chat fixo. */
export type LadoDoChatFixo = "esquerda" | "direita";

/** O estilo dos controles das janelas do canvas: o do sistema, as bolinhas do Mac ou os botões do Windows. */
export type EstiloDosControlesDasJanelas = "automatico" | "mac" | "windows";

/** Preferências de exibição da tela, guardadas neste computador (localStorage). */
export type PreferenciasDaTela = {
  /**
   * O chat rápido vira uma coluna fixa ao lado do canvas (o lado vem de
   * `ladoDoChatFixo`), em vez de flutuar no pé dele. O nome ficou do tempo em
   * que só havia a esquerda: trocá-lo apagaria a escolha já guardada.
   */
  chatFixoNaEsquerda: boolean;
  /** O lado do chat fixo; preferências antigas, sem o campo, valem a esquerda. */
  ladoDoChatFixo: LadoDoChatFixo;
  /** Mostra o botão Arquivos nos terminais (o visualizador de código). */
  visualizadorDeCodigo: boolean;
  /** Largura (px) do chat fixo, ajustada pela alça da borda dele. */
  larguraDoChatFixo: number;
  /**
   * Os bixinhos dos Subagentes que terminam ficam no canvas até o "limpar" do
   * terminal. Desligada (o padrão), os concluídos e cancelados saem sozinhos.
   */
  manterBixinhosAteLimpar: boolean;
  /**
   * O minimapa do canto inferior direito aparece. Desligada (o padrão, e o
   * valor das preferências antigas, sem o campo), só o botão que o mostra fica.
   */
  minimapaVisivel: boolean;
  /**
   * Os controles (fechar, minimizar, ampliar) das janelas do canvas. "automatico"
   * (o padrão, e o valor das preferências antigas, sem o campo) segue o sistema;
   * "mac" põe as bolinhas à esquerda e "windows" os botões à direita. A barra de
   * título do app não entra: ela segue sempre o sistema.
   */
  controlesDasJanelas: EstiloDosControlesDasJanelas;
};

export const CHAVE_DAS_PREFERENCIAS_DA_TELA = "orquestrador.preferenciasDaTela";

/** A largura do chat fixo: padrão, mínima e máxima (px). */
export const LARGURA_DO_CHAT_FIXO = { padrao: 360, minima: 280, maxima: 640 } as const;

const PADRAO: PreferenciasDaTela = {
  chatFixoNaEsquerda: false,
  ladoDoChatFixo: "esquerda",
  visualizadorDeCodigo: false,
  larguraDoChatFixo: LARGURA_DO_CHAT_FIXO.padrao,
  manterBixinhosAteLimpar: false,
  minimapaVisivel: false,
  controlesDasJanelas: "automatico",
};

/** Uma largura inteira entre a mínima e a máxima; número inválido (NaN, infinito) vale o padrão. */
export function limitarLarguraDoChatFixo(largura: number): number {
  if (!Number.isFinite(largura)) {
    return LARGURA_DO_CHAT_FIXO.padrao;
  }
  return Math.min(LARGURA_DO_CHAT_FIXO.maxima, Math.max(LARGURA_DO_CHAT_FIXO.minima, Math.round(largura)));
}

/** Quem usa o hook nesta aba: avisados a cada mudança (o evento `storage` só chega às outras abas). */
const ouvintes = new Set<() => void>();

/**
 * A última leitura, pelo texto guardado: o mesmo objeto enquanto o texto não
 * muda (o `useSyncExternalStore` exige um retrato estável). Sem localStorage
 * gravável, o valor mudado fica só aqui, na memória desta aba.
 */
let ultimaLeitura: { bruto: string | null; valor: PreferenciasDaTela } | null = null;

/** O texto guardado; sem localStorage (bloqueado), nulo. */
function lerBruto(): string | null {
  try {
    return localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA);
  } catch {
    return null;
  }
}

/** Tolerante: JSON inválido, outro formato ou campo de outro tipo valem o padrão. */
function interpretar(bruto: string | null): PreferenciasDaTela {
  if (bruto === null) {
    return PADRAO;
  }
  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    return PADRAO;
  }
  if (typeof lido !== "object" || lido === null || Array.isArray(lido)) {
    return PADRAO;
  }
  const registro = lido as Record<string, unknown>;
  const booleano = (
    campo: "chatFixoNaEsquerda" | "visualizadorDeCodigo" | "manterBixinhosAteLimpar" | "minimapaVisivel",
  ): boolean =>
    typeof registro[campo] === "boolean" ? (registro[campo] as boolean) : PADRAO[campo];
  const largura = registro.larguraDoChatFixo;
  return {
    chatFixoNaEsquerda: booleano("chatFixoNaEsquerda"),
    // Só "direita" muda o lado: ausente (preferência antiga) ou outro valor vale a esquerda.
    ladoDoChatFixo: registro.ladoDoChatFixo === "direita" ? "direita" : PADRAO.ladoDoChatFixo,
    visualizadorDeCodigo: booleano("visualizadorDeCodigo"),
    // Número fora do intervalo é limitado a ele; outro tipo vale o padrão.
    larguraDoChatFixo: typeof largura === "number" ? limitarLarguraDoChatFixo(largura) : PADRAO.larguraDoChatFixo,
    manterBixinhosAteLimpar: booleano("manterBixinhosAteLimpar"),
    minimapaVisivel: booleano("minimapaVisivel"),
    // Só "mac" e "windows" mudam o estilo: ausente ou outro valor segue o sistema.
    controlesDasJanelas:
      registro.controlesDasJanelas === "mac" || registro.controlesDasJanelas === "windows"
        ? registro.controlesDasJanelas
        : PADRAO.controlesDasJanelas,
  };
}

function lerPreferencias(): PreferenciasDaTela {
  const bruto = lerBruto();
  if (ultimaLeitura !== null && ultimaLeitura.bruto === bruto) {
    return ultimaLeitura.valor;
  }
  const valor = interpretar(bruto);
  ultimaLeitura = { bruto, valor };
  return valor;
}

function avisar(): void {
  for (const ouvinte of ouvintes) {
    ouvinte();
  }
}

/** Outra aba gravou (ou limpou tudo): relê. */
function aoMudarEmOutraAba(evento: StorageEvent): void {
  if (evento.key === null || evento.key === CHAVE_DAS_PREFERENCIAS_DA_TELA) {
    avisar();
  }
}

function assinar(ouvinte: () => void): () => void {
  if (ouvintes.size === 0) {
    window.addEventListener("storage", aoMudarEmOutraAba);
  }
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0) {
      window.removeEventListener("storage", aoMudarEmOutraAba);
    }
  };
}

function mudar(parcial: Partial<PreferenciasDaTela>): void {
  const atuais = lerPreferencias();
  const novas: PreferenciasDaTela = { ...atuais, ...parcial };
  novas.larguraDoChatFixo = limitarLarguraDoChatFixo(novas.larguraDoChatFixo);
  if (
    novas.chatFixoNaEsquerda === atuais.chatFixoNaEsquerda &&
    novas.ladoDoChatFixo === atuais.ladoDoChatFixo &&
    novas.visualizadorDeCodigo === atuais.visualizadorDeCodigo &&
    novas.larguraDoChatFixo === atuais.larguraDoChatFixo &&
    novas.manterBixinhosAteLimpar === atuais.manterBixinhosAteLimpar &&
    novas.minimapaVisivel === atuais.minimapaVisivel &&
    novas.controlesDasJanelas === atuais.controlesDasJanelas
  ) {
    return;
  }
  const bruto = JSON.stringify(novas);
  try {
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, bruto);
    ultimaLeitura = { bruto, valor: novas };
  } catch {
    // Sem gravar: vale nesta aba até recarregar.
    ultimaLeitura = { bruto: lerBruto(), valor: novas };
  }
  avisar();
}

/**
 * As preferências da tela (chat fixo, o lado e a largura dele, visualizador de
 * código, manter os bixinhos até limpar, o minimapa visível, o estilo dos
 * controles das janelas):
 * mudar num lugar reflete em todos os componentes que usam o hook e nas
 * outras abas abertas.
 */
export function usePreferenciasDaTela(): {
  preferencias: PreferenciasDaTela;
  mudarPreferencias: (parcial: Partial<PreferenciasDaTela>) => void;
} {
  const preferencias = useSyncExternalStore(assinar, lerPreferencias, () => PADRAO);
  // Função do módulo: a mesma em todo render (estável como um setState).
  return { preferencias, mudarPreferencias: mudar };
}
