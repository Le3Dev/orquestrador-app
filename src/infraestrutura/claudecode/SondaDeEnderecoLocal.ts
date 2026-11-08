/**
 * Confere se um servidor local está mesmo no ar antes de oferecer a prévia de
 * um endereço que só apareceu num comando ou na fala de um agente (ex.: o
 * `open http://127.0.0.1:4173` ou "o servidor está em http://localhost:5173").
 */
export type SondaDeEndereco = (url: string) => Promise<boolean>;

const ESPERA_MAXIMA_MS = 1500;

/** Os hosts da própria máquina a tentar, nessa ordem: o servidor pode escutar só em IPv4 ou só em IPv6. */
const HOSTS = ["127.0.0.1", "[::1]"];

async function responde(url: string): Promise<boolean> {
  try {
    // Qualquer resposta HTTP (até 404 ou 500) quer dizer que há um servidor ali.
    const resposta = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) });
    await resposta.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Verdadeiro se a porta local do endereço (`http://localhost:PORTA/...`) responde HTTP. */
export const sondarEnderecoLocal: SondaDeEndereco = async (url) => {
  let endereco: URL;
  try {
    endereco = new URL(url);
  } catch {
    return false;
  }
  for (const host of HOSTS) {
    if (await responde(`${endereco.protocol}//${host}:${endereco.port}/`)) {
      return true;
    }
  }
  return false;
};
