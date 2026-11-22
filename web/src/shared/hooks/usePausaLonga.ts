import { useEffect, useState } from "react";

/**
 * A partir de quanto tempo a pausa fica longa. A pausa congela o processo do
 * Claude Code (SIGSTOP); congelado por muito tempo, a conexão com a API cai e,
 * ao continuar, ele refaz a chamada em andamento. No QA de 22/11
 * (docs/entregas/qa-pausar-resposta-do-chat.html, caso 6), 90 s seguiu de onde
 * parou e 180 s recomeçou a resposta do zero: o corte fica entre os dois.
 */
export const PAUSA_LONGA_MS = 2 * 60_000;

/**
 * Se a pausa que começou em `desde` (ISO) já passou de PAUSA_LONGA_MS. Vira
 * sozinho na hora certa, com um único timer, sem depender de nova renderização
 * vinda de fora.
 */
export function usePausaLonga(desde: string): boolean {
  const [agora, setAgora] = useState(() => Date.now());
  // `agora` nunca fica à frente do relógio: na dúvida, ainda não é longa e o timer confere.
  const longa = agora - Date.parse(desde) > PAUSA_LONGA_MS;

  useEffect(() => {
    if (longa) {
      return;
    }
    const falta = Date.parse(desde) + PAUSA_LONGA_MS - Date.now();
    const prazo = setTimeout(() => setAgora(Date.now()), Math.max(0, falta) + 50);
    return () => clearTimeout(prazo);
  }, [desde, longa]);

  return longa;
}
