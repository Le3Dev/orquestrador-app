/**
 * Tipos de apresentação da escuta ao vivo, desacoplados da sessão: quem liga
 * os componentes à sessão converte o estado dela para estes tipos.
 */

/** Um trecho já confirmado da legenda (não muda mais). */
export interface TrechoDaLegenda {
  readonly id: string;
  readonly texto: string;
  readonly inicioMs: number;
  readonly fimMs: number;
  /** O trecho foi detectado como pergunta: aparece destacado na legenda. */
  readonly pergunta: boolean;
}

export type DispositivoDaEscuta = "webgpu" | "wasm" | "cpu" | "dml";

/** Onde e com qual modelo a transcrição está rodando. */
export interface MotorDaEscuta {
  readonly dispositivo: DispositivoDaEscuta;
  /** Nome completo do modelo (ex.: "onnx-community/whisper-base"). */
  readonly modelo: string;
  /** Precisão dos pesos (ex.: "q4", "fp16"). */
  readonly precisao: string;
}

/** Download do modelo em andamento. */
export interface DownloadDoModelo {
  /** De 0 a 100. */
  readonly progresso: number;
  /** Tamanho total em MB; nulo enquanto não se sabe. */
  readonly totalMb: number | null;
}

/** A resposta à última pergunta detectada pela escuta. */
export interface RespostaDaEscuta {
  readonly pergunta: string;
  /** A resposta em Markdown (tópicos curtos); nula enquanto não chega. */
  readonly texto: string | null;
  readonly carregando: boolean;
}

export type SituacaoDoPainel = "escutando" | "pausada" | "iniciando" | "erro" | "parada";

/** Tudo o que o painel da escuta mostra. */
export interface VisaoDaEscuta {
  readonly confirmados: readonly TrechoDaLegenda[];
  /** O que está sendo dito agora: provisório, muda ao vivo. */
  readonly parcial: string | null;
  readonly motor: MotorDaEscuta | null;
  readonly download: DownloadDoModelo | null;
  readonly situacao: SituacaoDoPainel;
  readonly erro: string | null;
  readonly resposta: RespostaDaEscuta | null;
}

/** Preferências visuais do painel (escolhidas pela pessoa). */
export interface AparenciaDaEscuta {
  /** Em px. */
  readonly tamanhoDaFonte: number;
  /** Opacidade do fundo do painel, de 0 a 1 (o texto continua opaco). */
  readonly opacidade: number;
  /** Compacto: só a legenda, com 3 linhas. */
  readonly compacto: boolean;
}

export const APARENCIA_PADRAO: AparenciaDaEscuta = { tamanhoDaFonte: 14, opacidade: 0.92, compacto: false };

export const LIMITES_DA_APARENCIA = {
  tamanhoDaFonte: { minimo: 12, maximo: 22, passo: 1 },
  opacidade: { minimo: 0.4, maximo: 1, passo: 0.05 },
} as const;

interface Limite {
  readonly minimo: number;
  readonly maximo: number;
  readonly passo: number;
}

/** Casas decimais do passo: 1 → 0, 0.05 → 2. */
function casasDoPasso(passo: number): number {
  return String(passo).split(".")[1]?.length ?? 0;
}

/**
 * Prende o valor no intervalo e o arredonda às casas do passo (sem resto de
 * ponto flutuante, como 0.9700000000000001). Não força a grade do passo: o
 * padrão 0.92 fica fora da grade de 0.05 e precisa continuar 0.92.
 */
function ajustarAoLimite(valor: number, padrao: number, { minimo, maximo, passo }: Limite): number {
  const finito = Number.isFinite(valor) ? valor : padrao;
  const preso = Math.min(maximo, Math.max(minimo, finito));
  return Number(preso.toFixed(casasDoPasso(passo)));
}

/** A aparência dentro de LIMITES_DA_APARENCIA (valores inválidos voltam ao padrão). */
export function ajustarAparencia(aparencia: AparenciaDaEscuta): AparenciaDaEscuta {
  return {
    tamanhoDaFonte: ajustarAoLimite(
      aparencia.tamanhoDaFonte,
      APARENCIA_PADRAO.tamanhoDaFonte,
      LIMITES_DA_APARENCIA.tamanhoDaFonte,
    ),
    opacidade: ajustarAoLimite(aparencia.opacidade, APARENCIA_PADRAO.opacidade, LIMITES_DA_APARENCIA.opacidade),
    compacto: aparencia.compacto,
  };
}

/** GPU (webgpu, dml) ou CPU (wasm, cpu). */
export function tipoDoDispositivo(dispositivo: DispositivoDaEscuta): "GPU" | "CPU" {
  return dispositivo === "webgpu" || dispositivo === "dml" ? "GPU" : "CPU";
}

/** "onnx-community/whisper-base" → "base"; "Xenova/whisper-tiny.en" → "tiny.en". */
export function nomeCurtoDoModelo(modelo: string): string {
  const ultimo = modelo.split("/").filter((parte) => parte.trim() !== "").at(-1)?.trim() ?? "";
  const curto = ultimo.replace(/^whisper[-_]/i, "").replace(/_timestamped$/i, "");
  return curto === "" ? ultimo : curto;
}

/** O selo do motor: "GPU · base · q4". */
export function rotuloDoMotor(motor: MotorDaEscuta): string {
  return [tipoDoDispositivo(motor.dispositivo), nomeCurtoDoModelo(motor.modelo), motor.precisao.trim()]
    .filter((parte) => parte !== "")
    .join(" · ");
}

/** O balão (title) do selo, com o modelo e a precisão completos. */
export function explicacaoDoMotor(motor: MotorDaEscuta): string {
  const precisao = motor.precisao.trim() === "" ? "" : `, precisão ${motor.precisao.trim()}`;
  return `Modelo ${motor.modelo}${precisao}, rodando em ${tipoDoDispositivo(motor.dispositivo)} (${motor.dispositivo})`;
}

/** O progresso do download preso entre 0 e 100, inteiro. */
export function progressoInteiro(download: DownloadDoModelo): number {
  const progresso = Number.isFinite(download.progresso) ? download.progresso : 0;
  return Math.round(Math.min(100, Math.max(0, progresso)));
}

/** "baixando o modelo 45% de 199 MB" (sem o total: "baixando o modelo 45%"). */
export function textoDoDownload(download: DownloadDoModelo): string {
  const total =
    download.totalMb === null || !Number.isFinite(download.totalMb) || download.totalMb <= 0
      ? ""
      : ` de ${Math.round(download.totalMb)} MB`;
  return `baixando o modelo ${progressoInteiro(download)}%${total}`;
}
