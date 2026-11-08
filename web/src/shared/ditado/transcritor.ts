import type { RespostaDoTranscritor } from "./mensagens";

/**
 * Um worker só para a tela toda: o modelo carrega uma vez e serve a todos os
 * campos com ditado. Ele só é criado no primeiro uso do microfone.
 */
let worker: Worker | null = null;
let proximoId = 1;
const pendentes = new Map<number, { resolver: (texto: string) => void; rejeitar: (erro: Error) => void }>();
const ouvintesDoDownload = new Set<(progresso: number) => void>();

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
      for (const pendente of pendentes.values()) pendente.rejeitar(new Error(evento.message || "O ditado falhou ao iniciar."));
      pendentes.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Transcreve áudio mono a 16 kHz. `aoBaixar` recebe o progresso do primeiro download do modelo. */
export function transcrever(audio: Float32Array, aoBaixar?: (progresso: number) => void): Promise<string> {
  const id = proximoId++;
  if (aoBaixar !== undefined) ouvintesDoDownload.add(aoBaixar);
  return new Promise<string>((resolver, rejeitar) => {
    pendentes.set(id, { resolver, rejeitar });
    obterWorker().postMessage({ id, audio }, [audio.buffer]);
  }).finally(() => {
    if (aoBaixar !== undefined) ouvintesDoDownload.delete(aoBaixar);
  });
}
