import { useEffect, useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import { apiDasRotinas, type DadosDaExecucao } from "../../shared/api/rotinas";
import { formatarDecorrido, formatarMomento } from "../../shared/formatacao";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeRotinas } from "../../shared/idioma/textos/rotinas";
import { EtiquetaDaSituacao } from "./EtiquetaDaSituacao";
import { descreverEtapa, rotuloDaOrigem, rotuloDoTipoDeEtapa } from "./textos";

interface PropsDaExecucao {
  execucao: DadosDaExecucao;
  nomeDoOrquestrador: (id: string) => string | null;
}

/** Uma execução: a linha-resumo e, aberta, o que deu cada etapa. */
function ItemDoHistorico({ execucao, nomeDoOrquestrador }: PropsDaExecucao) {
  const t = useTextos(textosDeRotinas).historico;
  const agora = new Date();
  return (
    <li>
      <details className="rounded-[var(--radius-input)] border border-border bg-surface-2 px-3 py-2">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
          <EtiquetaDaSituacao situacao={execucao.situacao} />
          <span className="mono text-secondary">{formatarMomento(execucao.iniciadaEm, agora)}</span>
          <span className="text-support">{rotuloDaOrigem(execucao.origem)}</span>
          {execucao.situacao !== "pulada" && (
            <span className="text-support ml-auto">{formatarDecorrido(execucao.iniciadaEm, execucao.encerradaEm, agora)}</span>
          )}
        </summary>

        <div className="mt-2 flex flex-col gap-2">
          {execucao.motivo !== null && <div className="alert alert-warning">{execucao.motivo}</div>}
          {execucao.etapas.length > 0 && execucao.situacao !== "pulada" && (
            <ol className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={t.resultadoDeCadaEtapa}>
              {execucao.etapas.map((etapa, indice) => {
                const resultado = execucao.resultados[indice];
                return (
                  <li key={indice} className="flex flex-col gap-1 border-t border-border pt-1.5 first:border-t-0 first:pt-0">
                    <span className="flex flex-wrap items-center gap-2 text-[12px] text-primary">
                      <span className="font-titulo font-medium">
                        {indice + 1}. {rotuloDoTipoDeEtapa(etapa.tipo)}
                      </span>
                      {resultado !== undefined ? (
                        <EtiquetaDaSituacao situacao={resultado.situacao} />
                      ) : (
                        <span className="text-support">{t.naoChegouARodar}</span>
                      )}
                    </span>
                    <span className="text-support">{descreverEtapa(etapa, nomeDoOrquestrador)}</span>
                    {resultado !== undefined && resultado.resposta !== null && resultado.resposta !== "" && (
                      <pre className="custom-scrollbar m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-input)] bg-surface-3 px-2.5 py-2 font-mono text-[11.5px] text-secondary">
                        {resultado.resposta}
                      </pre>
                    )}
                    {resultado !== undefined && resultado.erro !== null && resultado.erro !== "" && (
                      <div className="alert alert-error">{resultado.erro}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </details>
    </li>
  );
}

interface Props {
  rotinaId: string;
  /** Quando a execução em curso muda de etapa ou termina, o histórico é lido de novo. */
  execucaoAtiva: DadosDaExecucao | null;
  ultimaExecucaoEm: string | null;
  nomeDoOrquestrador: (id: string) => string | null;
}

/** As execuções da rotina, da mais recente para a mais antiga, com o resultado de cada etapa. */
export function HistoricoDeExecucoes({ rotinaId, execucaoAtiva, ultimaExecucaoEm, nomeDoOrquestrador }: Props) {
  const t = useTextos(textosDeRotinas).historico;
  const [execucoes, setExecucoes] = useState<DadosDaExecucao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const andamento =
    execucaoAtiva === null ? "" : `${execucaoAtiva.id}:${execucaoAtiva.situacao}:${execucaoAtiva.resultados.length}`;

  useEffect(() => {
    let atual = true;
    apiDasRotinas
      .listarExecucoes(rotinaId)
      .then((lista) => {
        if (atual) {
          setExecucoes(lista);
          setErro(null);
        }
      })
      .catch((falha: unknown) => {
        if (atual) {
          setErro(mensagemDeErro(falha));
        }
      });
    return () => {
      atual = false;
    };
  }, [rotinaId, andamento, ultimaExecucaoEm]);

  return (
    <section className="flex flex-col gap-2" aria-label={t.rotulo}>
      <h3 className="font-titulo text-[12.5px] font-medium text-primary">{t.titulo}</h3>
      {erro !== null && (
        <div className="alert alert-error" role="alert">
          {t.naoCarregou(erro)}
        </div>
      )}
      {execucoes === null ? (
        erro === null && <span className="hint">{t.carregando}</span>
      ) : execucoes.length === 0 ? (
        <span className="hint">{t.aindaNaoRodou}</span>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {execucoes.map((execucao) => (
            <ItemDoHistorico key={execucao.id} execucao={execucao} nomeDoOrquestrador={nomeDoOrquestrador} />
          ))}
        </ul>
      )}
    </section>
  );
}
