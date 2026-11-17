import { UsoDoTurno } from "../../orquestracao/EventoDeOrquestracao";
import { Motor, rotuloDoMotor } from "../../orquestracao/Motor";
import { CausaDaFalha, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";

/** Uma causa de falha já classificada e, no limite de uso, quando ele libera (ISO). */
export interface FalhaClassificada {
  causa: CausaDaFalha;
  liberaEm: string | null;
}

/**
 * Limite de uso ou de cota do plano: o Copilot fala em "Sorry, your request was
 * rate-limited", "user_weekly_rate_limited", "You have exceeded your premium
 * request allowance" e "AI credits" (textos vistos em relatos de usuários e na
 * documentação, sem lista oficial); o Codex diz o motivo pelo `codexErrorInfo`
 * (`usageLimitExceeded`), tratado à parte, e em "usage limit"; ambos podem devolver
 * HTTP 429. É heurística sobre texto: o que não casar cai em "outro" e não
 * dispara a reserva.
 */
const SINAIS_DE_LIMITE_DE_USO =
  /usage limit|rate[ _-]?limit|limit (?:reached|exceeded)|(?:exceeded|reached|hit) (?:your |the )?(?:[\w'’-]+ )*(?:limit|quota|allowance)|\bquota\b|\ballowance\b|too many requests|\b429\b|insufficient[_ ]quota|out of (?:ai )?credits|credits? (?:exhausted|depleted)|premium requests?|ai credits|(?:monthly|weekly|session) (?:limit|quota)/i;

/** Servidores do provedor sobrecarregados ou com erro interno (5xx, "overloaded", "at capacity"). */
const SINAIS_DE_SOBRECARGA =
  /overloaded|\b(?:50[0234]|529)\b|server error|internal (?:server )?error|bad gateway|service unavailable|gateway timeout|high demand|at capacity|temporarily unavailable|try again (?:later|in)/i;

/** A conexão com os servidores caiu ou nem se estabeleceu. */
const SINAIS_DE_REDE =
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|socket hang up|network|connection (?:error|lost|dropped|refused|reset)|timed? ?out|unable to connect|stream (?:disconnected|closed)|offline/i;

const MS_POR_UNIDADE: Readonly<Record<string, number>> = {
  s: 1_000,
  sec: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

/** De um epoch em segundos (ou milissegundos, com 13 dígitos) para ISO; nulo se não fizer sentido. */
export function epochEmIso(epoch: number): string | null {
  if (!Number.isFinite(epoch) || epoch <= 0) {
    return null;
  }
  const data = new Date(epoch >= 1e12 ? epoch : epoch * 1000);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/**
 * Quando o limite libera, se o texto disser: uma data ISO ("resets at
 * 2026-11-17T20:00:00Z"), um epoch ("resetsAt: 1794936160") ou uma espera
 * ("try again in 20 minutes", "retry-after: 90"). Nulo sem horário.
 */
export function liberaEmDoTexto(texto: string, agora: () => number = Date.now): string | null {
  const iso = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(texto)?.[1];
  if (iso !== undefined) {
    const data = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
    if (!Number.isNaN(data.getTime())) {
      return data.toISOString();
    }
  }
  const epoch = /resets?_?at\W{0,4}(\d{9,13})/i.exec(texto)?.[1];
  if (epoch !== undefined) {
    return epochEmIso(Number(epoch));
  }
  const emSegundos = /retry-after\W{0,3}(\d+)/i.exec(texto)?.[1];
  if (emSegundos !== undefined) {
    return new Date(agora() + Number(emSegundos) * 1_000).toISOString();
  }
  const espera = /(?:try again|retry) in\W{0,3}(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i.exec(texto);
  if (espera !== null) {
    const unidade = MS_POR_UNIDADE[(espera[2] ?? "s").toLowerCase()] ?? 1_000;
    return new Date(agora() + Number(espera[1]) * unidade).toISOString();
  }
  return null;
}

/** Classifica uma falha pelos textos (a mensagem do erro, o stderr...). */
export function classificarFalhaDoMotor(textos: readonly string[], agora: () => number = Date.now): FalhaClassificada {
  const junto = textos.join("\n");
  if (SINAIS_DE_LIMITE_DE_USO.test(junto)) {
    return { causa: "limite_de_uso", liberaEm: liberaEmDoTexto(junto, agora) };
  }
  if (SINAIS_DE_SOBRECARGA.test(junto)) {
    return { causa: "sobrecarga", liberaEm: null };
  }
  if (SINAIS_DE_REDE.test(junto)) {
    return { causa: "rede", liberaEm: null };
  }
  return { causa: "outro", liberaEm: null };
}

const TAMANHO_DO_DETALHE = 300;

function resumirDetalhe(original: string): string {
  const limpo = original.replace(/\s+/g, " ").trim();
  return limpo.length <= TAMANHO_DO_DETALHE ? limpo : `${limpo.slice(0, TAMANHO_DO_DETALHE - 1)}…`;
}

const FRASES_DAS_CAUSAS: Readonly<Record<"limite_de_uso" | "sobrecarga" | "rede", (rotulo: string) => string>> = {
  limite_de_uso: (rotulo) => `Limite de uso do ${rotulo} atingido`,
  sobrecarga: (rotulo) => `Os servidores do ${rotulo} estão sobrecarregados ou com erro`,
  rede: (rotulo) => `Falha de conexão com os servidores do ${rotulo}`,
};

/**
 * O resultado de falha com a causa já dita: nas causas que a reserva ou a
 * recuperação entendem, o motivo vira uma frase em português com o detalhe
 * original resumido; em "outro", fica o `motivoBase`. `liberaEm` só vai no
 * limite de uso. `classificada` (quando o motor sabe a causa pelo próprio
 * protocolo, como o `codexErrorInfo` do Codex) vale sobre o texto.
 */
export function falhaDoMotor(
  motor: Motor,
  motivoBase: string,
  textos: readonly string[],
  uso: UsoDoTurno | null,
  classificada: FalhaClassificada | null = null,
  sessaoDoMotor?: string,
): Extract<ResultadoDoTurno, { sucesso: false }> {
  const { causa, liberaEm } = classificada ?? classificarFalhaDoMotor([motivoBase, ...textos]);
  const sessao = sessaoDoMotor === undefined ? {} : { sessaoDoMotor };
  if (causa === "outro" || causa === "silencio") {
    return { sucesso: false, motivo: motivoBase, uso, causa, ...sessao };
  }
  const detalhe = resumirDetalhe([motivoBase, ...textos].find((parte) => parte.trim() !== "") ?? "");
  const frase = FRASES_DAS_CAUSAS[causa](rotuloDoMotor(motor));
  const motivo = detalhe === "" ? `${frase}.` : `${frase} (${detalhe}).`;
  return causa === "limite_de_uso"
    ? { sucesso: false, motivo, uso, causa, liberaEm, ...sessao }
    : { sucesso: false, motivo, uso, causa, ...sessao };
}
