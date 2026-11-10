import { formatarMomento } from "../../shared/formatacao";

/** "14:32" para hoje; "08/11, 14:32" para outro dia. Sem data legível, nada. */
function horaDaMensagem(iso: string): string | null {
  return Number.isNaN(Date.parse(iso)) ? null : formatarMomento(iso);
}

/** A hora no pé da bolha; a data e a hora completas no balão. */
export function HoraDaMensagem({ criadaEm }: { criadaEm: string }) {
  const hora = horaDaMensagem(criadaEm);
  if (hora === null) {
    return null;
  }
  return (
    <time className="hora-da-mensagem" dateTime={criadaEm} title={new Date(criadaEm).toLocaleString("pt-BR")}>
      {hora}
    </time>
  );
}
