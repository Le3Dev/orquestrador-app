import type { RespostaDoTranscritor } from "./mensagens";

/**
 * Sem ditado por este tempo, o worker (e o modelo de ~250 MB dentro dele) é
 * encerrado para devolver a memória. O próximo ditado recria o worker, que
 * relê o modelo do cache local (Cache API), sem baixar de novo.
 */
export const TEMPO_PARA_DESCARREGAR_O_DITADO_MS = 3 * 60_000;

/**
 * Um worker só para a tela toda: o modelo carrega uma vez e serve a todos os
 * campos com ditado. Ele só é criado no primeiro uso do microfone.
 */
let worker: Worker | null = null;
let proximoId = 1;
let cronometroDeDescarga: ReturnType<typeof setTimeout> | null = null;
const pendentes = new Map<number, { resolver: (texto: string) => void; rejeitar: (erro: Error) => void }>();
const ouvintesDoDownload = new Set<(progresso: number) => void>();

function pararCronometroDeDescarga(): void {
  if (cronometroDeDescarga !== null) {
    clearTimeout(cronometroDeDescarga);
    cronometroDeDescarga = null;
  }
}

/** Encerra o worker; quem ainda esperava uma transcrição recebe `motivo`. */
function encerrarWorker(motivo: Error): void {
  pararCronometroDeDescarga();
  for (const pendente of pendentes.values()) pendente.rejeitar(motivo);
  pendentes.clear();
  worker?.terminate();
  worker = null;
}

/** Reinicia a contagem para descarregar o modelo; nunca conta com transcrição em andamento. */
function agendarDescarga(): void {
  pararCronometroDeDescarga();
  if (worker === null || pendentes.size > 0) return;
  cronometroDeDescarga = setTimeout(() => {
    cronometroDeDescarga = null;
    if (pendentes.size === 0) encerrarWorker(new Error("O ditado foi descarregado."));
  }, TEMPO_PARA_DESCARREGAR_O_DITADO_MS);
}

function obterWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL("./transcritor.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (evento: MessageEvent<RespostaDoTranscritor>) => {
      const resposta = evento.data;
      if (resposta.tipo === "baixando") {
        for (const ouvinte of ouvintesDoDownload) ouvinte(resposta.progresso);
        return;
      }
      const pendente = pendentes.get(resposta.id);
      if (pendente === undefined) return;
      pendentes.delete(resposta.id);
      if (resposta.tipo === "texto") pendente.resolver(resposta.texto);
      else pendente.rejeitar(new Error(resposta.mensagem));
    };
    worker.onerror = (evento) => {
      // O worker nem subiu (ex.: falha ao carregar o script): ninguém espera para sempre.
      encerrarWorker(new Error(evento.message || "O ditado falhou ao iniciar."));
    };
  }
  return worker;
}

/** Transcreve áudio mono a 16 kHz. `aoBaixar` recebe o progresso do primeiro download do modelo. */
export function transcrever(audio: Float32Array, aoBaixar?: (progresso: number) => void): Promise<string> {
  const id = proximoId++;
  pararCronometroDeDescarga();
  if (aoBaixar !== undefined) ouvintesDoDownload.add(aoBaixar);
  return new Promise<string>((resolver, rejeitar) => {
    pendentes.set(id, { resolver, rejeitar });
    try {
      obterWorker().postMessage({ id, audio }, [audio.buffer]);
    } catch (erro) {
      pendentes.delete(id);
      throw erro;
    }
  }).finally(() => {
    if (aoBaixar !== undefined) ouvintesDoDownload.delete(aoBaixar);
    agendarDescarga();
  });
}
