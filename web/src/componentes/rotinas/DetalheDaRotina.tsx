import { useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import type { ResumoDaRotina } from "../../shared/api/rotinas";
import { formatarMomento } from "../../shared/formatacao";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeRotinas } from "../../shared/idioma/textos/rotinas";
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
  const t = useTextos(textosDeRotinas).detalhe;
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
    <div className="subagentes-editor custom-scrollbar gap-3" role="region" aria-label={t.rotulo(rotina.nome)}>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <h3 className="font-titulo min-w-0 break-words text-[14px] font-medium text-primary">{rotina.nome}</h3>
        <span className={`etiqueta ${rotina.ativa ? "etiqueta-success" : ""}`}>{rotina.ativa ? t.ativa : t.desativada}</span>
      </div>

      <dl className="m-0 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
        <dt className="text-muted">{t.quando}</dt>
        <dd className="m-0 text-primary">{descreverGatilho(rotina.gatilho)}</dd>
        <dt className="text-muted">{t.proximaExecucao}</dt>
        <dd className="m-0 text-primary">{descreverProximaExecucao(rotina)}</dd>
        <dt className="text-muted">{t.ultimaExecucao}</dt>
        <dd className="m-0 text-primary">{rotina.ultimaExecucaoEm === null ? t.nuncaRodou : formatarMomento(rotina.ultimaExecucaoEm)}</dd>
        <dt className="text-muted">{t.sePerderAHora}</dt>
        <dd className="m-0 text-primary">{t.aoPerder[rotina.aoPerder]}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm btn-cta"
          disabled={ocupado || execucaoAtiva !== null}
          title={execucaoAtiva !== null ? t.jaHaExecucao : t.rodaAgora}
          onClick={() => void fazer(() => aoExecutarAgora(rotina.id))}
        >
          {t.executarAgora}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={ocupado}
          onClick={() => void fazer(() => aoAlterarAtiva(rotina.id, !rotina.ativa))}
        >
          {rotina.ativa ? t.desativar : t.ativar}
        </button>
        <button type="button" className="btn btn-sm btn-outline" disabled={ocupado} onClick={aoEditar}>
          {t.editar}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger ml-auto"
          disabled={ocupado}
          onClick={() => setConfirmandoApagar(true)}
        >
          {t.apagar}
        </button>
      </div>

      {confirmandoApagar && (
        <div className="alert alert-warning flex flex-col gap-2" role="alertdialog" aria-label={t.confirmarExclusao}>
          <span>{t.avisoDeExclusao(rotina.nome)}</span>
          <span className="flex justify-end gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmandoApagar(false)}>
              {t.manter}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={ocupado}
              onClick={() => void fazer(() => aoApagar(rotina.id))}
            >
              {t.apagarDeVez}
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
              ? t.encerrando
              : t.etapaDe(execucaoAtiva.etapaAtual + 1, execucaoAtiva.etapas.length)}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost ml-auto"
            disabled={ocupado}
            onClick={() => void fazer(() => aoCancelarExecucao(execucaoAtiva.id))}
          >
            {t.cancelarExecucao}
          </button>
        </div>
      )}

      <section className="flex flex-col gap-1.5" aria-label={t.etapas}>
        <h3 className="font-titulo text-[12.5px] font-medium text-primary">{t.etapas}</h3>
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
