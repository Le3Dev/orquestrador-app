import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RotinasAoVivo } from "../../shared/hooks/useRotinas";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeRotinas } from "../../shared/idioma/textos/rotinas";
import { IconeFechar } from "../Icones";
import { CartaoDeAprovacao } from "./CartaoDeAprovacao";
import { DetalheDaRotina } from "./DetalheDaRotina";
import { EditorDeRotina, type OrquestradorEscolhivel } from "./EditorDeRotina";
import { EtiquetaDaSituacao } from "./EtiquetaDaSituacao";
import { emEdicao, paraAlteracoes, paraNovaRotina, type RotinaEmEdicao, rotinaVazia } from "./edicao";
import { descreverGatilho, descreverProximaExecucao } from "./textos";

interface Props {
  rotinas: RotinasAoVivo;
  /** Os orquestradores que existem (para escolher quem recebe cada pedido); nulo enquanto a lista não chegou. */
  orquestradores: readonly OrquestradorEscolhivel[] | null;
  aoFechar: () => void;
}

type Modo = "detalhe" | "nova" | "editar";

/**
 * Rotinas, logo abaixo da barra do canvas, em mestre e detalhe: a lista à
 * esquerda e, à direita, a rotina escolhida (com o histórico) ou o editor.
 * As execuções que esperam aprovação ficam no topo, com Aprovar e Recusar,
 * seja qual for a rotina aberta. Sem o servidor das rotinas, mostra
 * "Rotinas indisponíveis" e o resto do canvas segue de pé.
 */
export function PainelDeRotinas({ rotinas, orquestradores, aoFechar }: Props) {
  const t = useTextos(textosDeRotinas).painel;
  const { lista, carregada, indisponivel, erro, aprovacoesPendentes } = rotinas;
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("detalhe");

  // Esc fecha. Só o Esc dado no painel (ou sem nada focado): o painel não é
  // modal, e um Esc num terminal ou numa nota não pode fechá-lo.
  const painel = useRef<HTMLElement>(null);
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target;
      const noPainel = alvo === document.body || (alvo instanceof Node && painel.current?.contains(alvo) === true);
      if (evento.key === "Escape" && !evento.defaultPrevented && noPainel) {
        aoFechar();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const escolhida = lista.find((rotina) => rotina.id === selecionadaId) ?? lista[0] ?? null;
  const nomeDoOrquestrador = useCallback(
    (id: string) => orquestradores?.find((orquestrador) => orquestrador.id === id)?.nome ?? null,
    [orquestradores],
  );
  const rotinaNova = useMemo<RotinaEmEdicao>(
    // Com um só orquestrador, não há o que escolher: o primeiro pedido já sai com ele.
    () => rotinaVazia(orquestradores?.length === 1 ? (orquestradores[0]?.id ?? "") : ""),
    [orquestradores],
  );

  function escolher(id: string): void {
    setSelecionadaId(id);
    setModo("detalhe");
  }

  async function salvar(dados: RotinaEmEdicao): Promise<void> {
    if (modo === "editar" && escolhida !== null) {
      const alteracoes = paraAlteracoes(dados, escolhida);
      if (Object.keys(alteracoes).length > 0) {
        await rotinas.alterar(escolhida.id, alteracoes);
      }
    } else {
      const criada = await rotinas.criar(paraNovaRotina(dados));
      setSelecionadaId(criada.id);
    }
    setModo("detalhe");
  }

  const editando = modo === "nova" || (modo === "editar" && escolhida !== null);

  return (
    <section ref={painel} className="painel-flutuante painel-da-barra mt-2 w-[760px]" aria-label={t.rotulo}>
      <header className="painel-da-barra-cabecalho">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-[14px]">{t.titulo}</h2>
          <span className="text-support">{t.descricao}</span>
        </div>
        <button type="button" className="botao-icone shrink-0" aria-label={t.fechar} onClick={aoFechar}>
          <IconeFechar tamanho={16} />
        </button>
      </header>

      {indisponivel ? (
        <div className="painel-da-barra-corpo" role="alert">
          <div className="alert alert-warning flex flex-col gap-2">
            <strong className="font-titulo text-[13px] text-primary">{t.indisponiveis}</strong>
            <span>{t.naoCarregou(erro)}</span>
            <span>
              <button type="button" className="btn btn-sm btn-outline" onClick={rotinas.recarregar}>
                {t.tentarDeNovo}
              </button>
            </span>
          </div>
        </div>
      ) : !carregada ? (
        <div className="painel-da-barra-corpo">
          <span className="hint">{t.carregando}</span>
        </div>
      ) : (
        <>
          {erro !== null && (
            <div className="alert alert-warning mx-4 mt-3" role="status">
              {t.semResposta}
            </div>
          )}

          {aprovacoesPendentes.length > 0 && (
            <div
              className="custom-scrollbar flex max-h-[45vh] shrink-0 flex-col gap-2 overflow-y-auto border-b border-border p-3"
              role="region"
              aria-label={t.aprovacoesPendentes}
            >
              {aprovacoesPendentes.map(({ execucao }) => (
                <CartaoDeAprovacao key={execucao.id} execucao={execucao} aoAprovar={rotinas.aprovar} aoRecusar={rotinas.recusar} />
              ))}
            </div>
          )}

          {lista.length === 0 && modo !== "nova" ? (
            <div className="subagentes-vazio">
              <strong className="font-titulo text-[13px]">{t.nenhuma}</strong>
              <span className="text-support max-w-sm">{t.nenhumaAjuda}</span>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setModo("nova")}>
                {t.nova}
              </button>
            </div>
          ) : (
            <div className="subagentes-corpo">
              <div className="subagentes-lista">
                <ul className="custom-scrollbar" aria-label={t.lista}>
                  {lista.map((rotina) => (
                    <li key={rotina.id}>
                      <button
                        type="button"
                        className="item-subagente"
                        aria-pressed={modo !== "nova" && rotina.id === escolhida?.id}
                        onClick={() => escolher(rotina.id)}
                      >
                        <span className="truncate text-[12.5px] font-medium text-primary">{rotina.nome}</span>
                        <span className="truncate text-[11.5px] text-muted">{descreverGatilho(rotina.gatilho)}</span>
                        <span className="truncate text-[11px] text-muted">
                          {rotina.ativa ? t.ativaCom(descreverProximaExecucao(rotina)) : t.desativada}
                        </span>
                        {rotina.execucaoAtiva !== null && (
                          <span className="mt-0.5 self-start">
                            <EtiquetaDaSituacao situacao={rotina.execucaoAtiva.situacao} />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-1.5 border-t border-border p-2">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModo("nova")}>
                    {t.nova}
                  </button>
                </div>
              </div>

              {editando ? (
                <EditorDeRotina
                  key={modo === "nova" ? "nova" : escolhida?.id}
                  titulo={modo === "nova" ? t.tituloNova : t.tituloEditar}
                  inicial={modo === "nova" || escolhida === null ? rotinaNova : emEdicao(escolhida)}
                  {...(modo === "editar" && escolhida !== null ? { gatilhoSalvo: escolhida.gatilho } : {})}
                  orquestradores={orquestradores}
                  aoSalvar={salvar}
                  aoCancelar={() => setModo("detalhe")}
                />
              ) : (
                escolhida !== null && (
                  <DetalheDaRotina
                    key={escolhida.id}
                    rotina={escolhida}
                    nomeDoOrquestrador={nomeDoOrquestrador}
                    aoEditar={() => setModo("editar")}
                    aoExecutarAgora={rotinas.executarAgora}
                    aoAlterarAtiva={(id, ativa) => rotinas.alterar(id, { ativa })}
                    aoApagar={rotinas.apagar}
                    aoCancelarExecucao={rotinas.cancelar}
                  />
                )
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
