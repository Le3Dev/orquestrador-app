import { useEffect, useState } from "react";

import type { ModoDaPausa } from "../../shared/api/tipos";
import { formatarMomento } from "../../shared/formatacao";

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

/** O que o tooltip explica: como o Continuar vai seguir em cada modo. */
function dicaDaPausa(desde: string, modo: ModoDaPausa): string {
  const quando = `Orquestrador pausado desde ${formatarMomento(desde)}.`;
  return modo === "congelado"
    ? `${quando} O processo ficou congelado: o Continuar segue exatamente de onde parou.`
    : `${quando} Não deu para congelar o processo (app fechado, Windows ou o processo caiu): o Continuar segue pela conversa, com uma mensagem pedindo para continuar de onde parou.`;
}

/**
 * O chip "pausado há X min" da barra do terminal. Atualiza a cada minuto
 * completo da pausa, não a cada segundo.
 */
export function ChipDaPausa({ desde, modo }: { desde: string; modo: ModoDaPausa }) {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const decorrido = Math.max(0, Date.now() - Date.parse(desde));
    const prazo = setTimeout(() => setAgora(Date.now()), MINUTO_MS - (decorrido % MINUTO_MS) + 50);
    return () => clearTimeout(prazo);
  }, [desde, agora]);

  return (
    <span className="min-w-0 truncate mono text-warning" title={dicaDaPausa(desde, modo)} data-modo-da-pausa={modo}>
      ⏸ pausado {tempoDaPausa(desde, agora)}
    </span>
  );
}
