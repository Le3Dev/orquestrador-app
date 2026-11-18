import { useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import type { ResumoDaRotina } from "../../shared/api/rotinas";
import { formatarMomento } from "../../shared/formatacao";
import { EtiquetaDaSituacao } from "./EtiquetaDaSituacao";
import { HistoricoDeExecucoes } from "./HistoricoDeExecucoes";
import { descreverEtapa, descreverGatilho, descreverProximaExecucao } from "./textos";

interface Props {
  rotina: ResumoDaRotina;
  nomeDoOrquestrador: (id: string) => string | null;
  aoEditar: () => void;
  aoExecutarAgora: (id: string) => Promise<unknown>;
  aoAlterarAtiva: (id: string, ativa: boolean) => Promise<unknown>;
  aoApagar: (id: string) => Promise<unknown>;
  aoCancelarExecucao: (execucaoId: string) => Promise<unknown>;
}

const TEXTO_DO_AO_PERDER = {
  pular: "pula essa execução",
  executar_ao_abrir: "executa assim que o app abrir",
} as const;

/**
 * A rotina escolhida: quando roda, as etapas, os botões (executar agora,
 * ativar, desativar, editar e apagar — este pede confirmação) e o histórico.
 * O cartão de aprovação fica no topo do painel, não aqui: ele não pode
 * depender de qual rotina está aberta.
 */
export function DetalheDaRotina({
  rotina,
  nomeDoOrquestrador,
  aoEditar,
  aoExecutarAgora,
  aoAlterarAtiva,
  aoApagar,
  aoCancelarExecucao,
}: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const { execucaoAtiva } = rotina;

  async function fazer(acao: () => Promise<unknown>): Promise<void> {
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
    <div className="subagentes-editor custom-scrollbar gap-3" role="region" aria-label={`Rotina ${rotina.nome}`}>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <h3 className="font-titulo min-w-0 break-words text-[14px] font-medium text-primary">{rotina.nome}</h3>
        <span className={`etiqueta ${rotina.ativa ? "etiqueta-success" : ""}`}>{rotina.ativa ? "Ativa" : "Desativada"}</span>
      </div>

      <dl className="m-0 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
        <dt className="text-muted">Quando</dt>
        <dd className="m-0 text-primary">{descreverGatilho(rotina.gatilho)}</dd>
        <dt className="text-muted">Próxima execução</dt>
        <dd className="m-0 text-primary">{descreverProximaExecucao(rotina)}</dd>
        <dt className="text-muted">Última execução</dt>
        <dd className="m-0 text-primary">{rotina.ultimaExecucaoEm === null ? "nunca rodou" : formatarMomento(rotina.ultimaExecucaoEm)}</dd>
        <dt className="text-muted">Se perder a hora</dt>
        <dd className="m-0 text-primary">{TEXTO_DO_AO_PERDER[rotina.aoPerder]}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm btn-cta"
          disabled={ocupado || execucaoAtiva !== null}
          title={execucaoAtiva !== null ? "Já há uma execução em curso." : "Roda agora, sem esperar a hora marcada"}
          onClick={() => void fazer(() => aoExecutarAgora(rotina.id))}
        >
          Executar agora
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={ocupado}
          onClick={() => void fazer(() => aoAlterarAtiva(rotina.id, !rotina.ativa))}
        >
          {rotina.ativa ? "Desativar" : "Ativar"}
        </button>
        <button type="button" className="btn btn-sm btn-outline" disabled={ocupado} onClick={aoEditar}>
          Editar
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger ml-auto"
          disabled={ocupado}
          onClick={() => setConfirmandoApagar(true)}
        >
          Apagar
        </button>
      </div>

      {confirmandoApagar && (
        <div className="alert alert-warning flex flex-col gap-2" role="alertdialog" aria-label="Confirmar exclusão da rotina">
          <span>
            Apagar a rotina “{rotina.nome}” e o histórico dela? Uma execução em curso será cancelada. Isso não pode ser desfeito.
          </span>
          <span className="flex justify-end gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmandoApagar(false)}>
              Manter
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={ocupado}
              onClick={() => void fazer(() => aoApagar(rotina.id))}
            >
              Apagar de vez
            </button>
          </span>
        </div>
      )}

      {erro !== null && (
        <div className="alert alert-error" role="alert">
          {erro}
        </div>
      )}

      {execucaoAtiva !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-input)] border border-border bg-surface-2 px-3 py-2">
          <EtiquetaDaSituacao situacao={execucaoAtiva.situacao} />
          <span className="text-[12.5px] text-primary">
            {execucaoAtiva.etapaAtual === null
              ? "Encerrando…"
              : `Etapa ${execucaoAtiva.etapaAtual + 1} de ${execucaoAtiva.etapas.length}`}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost ml-auto"
            disabled={ocupado}
            onClick={() => void fazer(() => aoCancelarExecucao(execucaoAtiva.id))}
          >
            Cancelar execução
          </button>
        </div>
      )}

      <section className="flex flex-col gap-1.5" aria-label="Etapas">
        <h3 className="font-titulo text-[12.5px] font-medium text-primary">Etapas</h3>
        <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-secondary">
          {rotina.etapas.map((etapa, indice) => (
            <li key={indice} className="flex gap-2">
              <span className="mono text-muted">{indice + 1}.</span>
              <span className="min-w-0 break-words">{descreverEtapa(etapa, nomeDoOrquestrador)}</span>
            </li>
          ))}
        </ol>
      </section>

      <HistoricoDeExecucoes
        rotinaId={rotina.id}
        execucaoAtiva={execucaoAtiva}
        ultimaExecucaoEm={rotina.ultimaExecucaoEm}
        nomeDoOrquestrador={nomeDoOrquestrador}
      />
    </div>
  );
}
