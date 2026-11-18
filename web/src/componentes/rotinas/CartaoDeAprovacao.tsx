import { useId, useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import { type DadosDaExecucao, LIMITES_DAS_ROTINAS } from "../../shared/api/rotinas";
import { IconeAlerta } from "../Icones";

interface Props {
  execucao: DadosDaExecucao;
  /** Rejeitar mostra a mensagem no cartão e deixa a execução esperando. */
  aoAprovar: (execucaoId: string) => Promise<unknown>;
  aoRecusar: (execucaoId: string, motivo?: string) => Promise<unknown>;
}

/**
 * Uma rotina parada esperando o usuário: mostra o plano (pedido em
 * planejamento) ou a mensagem (etapa de aprovação) e os botões Aprovar e
 * Recusar. É o que não pode passar batido, por isso a borda e o aviso em
 * destaque.
 */
export function CartaoDeAprovacao({ execucao, aoAprovar, aoRecusar }: Props) {
  const id = useId();
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { pendencia } = execucao;
  const etapa = execucao.etapaAtual === null ? null : execucao.etapaAtual + 1;

  async function decidir(acao: () => Promise<unknown>): Promise<void> {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-warning bg-surface-2 p-3"
      aria-label={`Aprovação da rotina ${execucao.rotinaNome}`}
      data-testid="cartao-de-aprovacao"
    >
      <header className="flex items-start gap-2">
        <IconeAlerta tamanho={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <strong className="font-titulo text-[13px] text-primary">
            A rotina “{execucao.rotinaNome}” aguarda sua aprovação
          </strong>
          <span className="text-support">
            {pendencia?.tipo === "plano" ? "O orquestrador propôs este plano" : "A rotina parou nesta pergunta"}
            {etapa !== null ? ` (etapa ${etapa} de ${execucao.etapas.length})` : ""}. Ela só segue se você aprovar.
          </span>
        </div>
      </header>

      {pendencia !== null && (
        <div
          className="custom-scrollbar max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-input)] border border-border bg-surface-3 px-3 py-2 text-[12.5px] text-primary"
          tabIndex={0}
          aria-label={pendencia.tipo === "plano" ? "Plano proposto" : "Mensagem da rotina"}
        >
          {pendencia.tipo === "plano" ? pendencia.plano : pendencia.mensagem}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-motivo`} className="text-support">
          Motivo da recusa (opcional)
        </label>
        <input
          id={`${id}-motivo`}
          className="input campo-escuro"
          maxLength={LIMITES_DAS_ROTINAS.tamanhoDoMotivoDaRecusa}
          placeholder="Ex.: o plano mexe em arquivos demais"
          value={motivo}
          disabled={ocupado}
          onChange={(evento) => setMotivo(evento.target.value)}
        />
      </div>

      {erro !== null && (
        <div className="alert alert-error" role="alert">
          {erro}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={ocupado}
          onClick={() => void decidir(() => aoRecusar(execucao.id, motivo))}
        >
          Recusar
        </button>
        <button
          type="button"
          className="btn btn-sm btn-cta"
          disabled={ocupado}
          onClick={() => void decidir(() => aoAprovar(execucao.id))}
        >
          Aprovar
        </button>
      </div>
    </section>
  );
}
