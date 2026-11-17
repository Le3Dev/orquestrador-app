interface Props {
  aberto: boolean;
  /** Execuções esperando o usuário aprovar ou recusar: vira o selo do botão. */
  aguardandoAprovacao: number;
  aoAlternar: () => void;
}

/**
 * O botão "Rotinas" da barra do canvas: abre e fecha o painel. O selo com o
 * número de execuções aguardando aprovação aparece no botão mesmo com o
 * painel fechado, para a pendência não passar batido.
 */
export function BotaoDasRotinas({ aberto, aguardandoAprovacao, aoAlternar }: Props) {
  const rotulo = aguardandoAprovacao > 0 ? `Rotinas, ${aguardandoAprovacao} aguardando aprovação` : "Rotinas";
  return (
    <button
      type="button"
      className="btn btn-sm btn-outline botao-de-painel mt-2 self-start"
      aria-expanded={aberto}
      aria-label={rotulo}
      title={aguardandoAprovacao > 0 ? "Há rotinas esperando sua aprovação" : "Rotinas agendadas"}
      onClick={aoAlternar}
    >
      Rotinas
      {aguardandoAprovacao > 0 && (
        <span
          className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold leading-none text-surface"
          data-testid="selo-das-rotinas"
          aria-hidden="true"
        >
          {aguardandoAprovacao}
        </span>
      )}
    </button>
  );
}
