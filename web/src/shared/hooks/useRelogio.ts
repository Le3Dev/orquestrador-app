import { useEffect, useState } from "react";

/**
 * Instante atual, atualizado a cada segundo enquanto `ativo` — o cronômetro
 * dos Subagentes em execução. Parado, não agenda nada: com dez cartões
 * concluídos na tela, nenhum re-render inútil por segundo.
 */
export function useRelogio(ativo: boolean): Date {
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    if (!ativo) {
      return;
    }
    setAgora(new Date());
    const intervalo = setInterval(() => setAgora(new Date()), 1_000);
    return () => clearInterval(intervalo);
  }, [ativo]);

  return agora;
}
