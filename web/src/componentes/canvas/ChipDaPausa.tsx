import { useEffect, useState } from "react";

import type { ModoDaPausa } from "../../shared/api/tipos";
import { formatarMomento } from "../../shared/formatacao";
import { usePausaLonga } from "../../shared/hooks/usePausaLonga";

const MINUTO_MS = 60_000;

/** "agora", "há 5 min" ou "há 1 h 20 min". */
function tempoDaPausa(desde: string, agora: number): string {
  const minutos = Math.floor(Math.max(0, agora - Date.parse(desde)) / MINUTO_MS);
  if (minutos < 1) {
    return "agora";
  }
  if (minutos < 60) {
    return `há ${minutos} min`;
  }
  const resto = minutos % 60;
  return `há ${Math.floor(minutos / 60)} h${resto > 0 ? ` ${resto} min` : ""}`;
}

/** O aviso da pausa longa no modo congelado: a conexão com a API cai e o Claude Code refaz a chamada. */
const AVISO_DA_PAUSA_LONGA = "ao continuar, o passo atual pode ser refeito";

/** O que o tooltip explica: como o Continuar vai seguir em cada modo (e, congelado há muito, o risco). */
function dicaDaPausa(desde: string, modo: ModoDaPausa, longa: boolean): string {
  const quando = `Orquestrador pausado desde ${formatarMomento(desde)}.`;
  if (modo === "retomada") {
    return `${quando} Não deu para congelar o processo (app fechado, Windows ou o processo caiu): o Continuar segue pela conversa, com uma mensagem pedindo para continuar de onde parou.`;
  }
  return longa
    ? `${quando} O processo está congelado há mais de 2 min: a conexão com a API pode ter caído e, ${AVISO_DA_PAUSA_LONGA}.`
    : `${quando} O processo ficou congelado: o Continuar segue exatamente de onde parou.`;
}

/**
 * O chip "pausado há X min" da barra do terminal. Atualiza a cada minuto
 * completo da pausa, não a cada segundo. Congelado há mais de 2 min, ganha o
 * aviso da pausa longa depois do tempo: a barra corta o fim com reticências
 * (o tempo fica sempre à vista) e o tooltip e o "⋯" mostram a frase inteira.
 * Na retomada não há aviso: o processo já foi encerrado e não há chamada a refazer.
 */
export function ChipDaPausa({ desde, modo }: { desde: string; modo: ModoDaPausa }) {
  const [agora, setAgora] = useState(() => Date.now());
  const longa = usePausaLonga(desde) && modo === "congelado";

  useEffect(() => {
    const decorrido = Math.max(0, Date.now() - Date.parse(desde));
    const prazo = setTimeout(() => setAgora(Date.now()), MINUTO_MS - (decorrido % MINUTO_MS) + 50);
    return () => clearTimeout(prazo);
  }, [desde, agora]);

  return (
    <span
      className="min-w-0 truncate mono text-warning"
      title={dicaDaPausa(desde, modo, longa)}
      data-modo-da-pausa={modo}
      data-pausa-longa={longa ? "" : undefined}
    >
      ⏸ pausado {tempoDaPausa(desde, agora)}
      {longa && ` · ${AVISO_DA_PAUSA_LONGA}`}
    </span>
  );
}
