/**
 * O motor de transcrição e o download do modelo como o indicador da escuta os
 * mostra, desacoplados da sessão (o estado dela cabe nestes tipos).
 */

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
function progressoInteiro(download: DownloadDoModelo): number {
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
