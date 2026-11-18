import { useState } from "react";

import type { AcaoDePausaDoOrquestrador } from "../../shared/api/acaoDePausa";
import { api, ErroDaApi, mensagemDeErro } from "../../shared/api/cliente";
import type { ModoDaPausa, ResumoDoOrquestrador } from "../../shared/api/tipos";
import { IconeOrquestrador } from "../Icones";
import type { PropsDasAcoesDoChat } from "./CartaoDeAcao";

interface Props {
  acao: AcaoDePausaDoOrquestrador;
  orquestradores: PropsDasAcoesDoChat["orquestradores"];
  aoAtualizarOrquestradores?: PropsDasAcoesDoChat["aoAtualizarOrquestradores"];
}

type Etapa =
  | { tipo: "pronto" }
  | { tipo: "executando" }
  | { tipo: "feito"; modo: ModoDaPausa }
  // `repetir`: falha passageira (rede, servidor). Sem ele, o estado já mudou e repetir não adianta.
  | { tipo: "erro"; mensagem: string; repetir: boolean };

/** Compara pastas sem diferenciar maiúsculas nem `\` de `/` (e sem a barra final). */
function mesmaPasta(a: string, b: string): boolean {
  const normalizar = (pasta: string) => pasta.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalizar(a) === normalizar(b);
}

/** O orquestrador da ação pelo nome (sem diferenciar maiúsculas) e pela pasta. */
function resolver(
  lista: readonly ResumoDoOrquestrador[],
  acao: AcaoDePausaDoOrquestrador,
): ResumoDoOrquestrador | undefined {
  const nome = acao.orquestrador.nome.trim().toLowerCase();
  return lista.find(
    (item) => item.nome.trim().toLowerCase() === nome && mesmaPasta(item.pastaDeTrabalho, acao.orquestrador.pasta),
  );
}

function descreverModo(modo: ModoDaPausa): string {
  return modo === "congelado" ? "congelado, continua de onde parou" : "continua pela conversa";
}

function descreverEstado(orquestrador: ResumoDoOrquestrador): string {
  if (orquestrador.situacao === "pausado") {
    const modo = orquestrador.pausa?.modo;
    return modo === undefined ? "pausado" : `pausado (${descreverModo(modo)})`;
  }
  return orquestrador.situacao;
}

/**
 * Por que a ação não vale para o estado atual, com as mesmas palavras do
 * servidor; nulo quando vale.
 */
function motivoDaRecusa(orquestrador: ResumoDoOrquestrador, pausar: boolean): string | null {
  if (pausar && orquestrador.situacao === "pausado") {
    return `"${orquestrador.nome}" já está pausado.`;
  }
  if (pausar && orquestrador.situacao !== "trabalhando") {
    return `"${orquestrador.nome}" não está trabalhando em nenhum pedido.`;
  }
  if (!pausar && orquestrador.situacao !== "pausado") {
    return `"${orquestrador.nome}" não está pausado.`;
  }
  return null;
}

/**
 * Ação sugerida pelo Claude no chat: pausar o pedido em andamento de um
 * Orquestrador ou tirá-lo da pausa. Só acontece no clique: relê a lista do
 * servidor, acha o orquestrador pelo nome e pela pasta e confere o estado
 * antes de chamar a pausa. Se ele sumiu ou o estado já mudou (inclusive um
 * 409 do servidor), o cartão diz isso numa linha, sem repetir a ação.
 */
export function CartaoDePausaDoOrquestrador({ acao, orquestradores, aoAtualizarOrquestradores }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "pronto" });
  const pausar = acao.tipo === "pausar_orquestrador";
  const { nome, pasta } = acao.orquestrador;
  const naTela = resolver(orquestradores, acao);

  async function executar(): Promise<void> {
    if (etapa.tipo === "executando" || etapa.tipo === "feito") {
      return;
    }
    setEtapa({ tipo: "executando" });
    try {
      const orquestrador = resolver(await api.listarOrquestradores(), acao);
      if (orquestrador === undefined) {
        setEtapa({
          tipo: "erro",
          mensagem: `"${nome}" não existe mais nesta pasta.`,
          repetir: false,
        });
        return;
      }
      const recusa = motivoDaRecusa(orquestrador, pausar);
      if (recusa !== null) {
        setEtapa({ tipo: "erro", mensagem: recusa, repetir: false });
        return;
      }
      const modo = pausar
        ? (await api.pausar(orquestrador.id)).pausa.modo
        : (await api.continuar(orquestrador.id)).modo;
      setEtapa({ tipo: "feito", modo });
      await aoAtualizarOrquestradores?.().catch(() => undefined);
    } catch (falha) {
      // 409: o estado mudou entre a leitura e o clique; 404: ele foi removido.
      const mudou = falha instanceof ErroDaApi && (falha.status === 409 || falha.status === 404);
      setEtapa({
        tipo: "erro",
        mensagem: mensagemDeErro(falha),
        repetir: !mudou,
      });
    }
  }

  const rotulo = pausar ? `⏸ Pausar ${nome}` : `▶ Continuar ${nome}`;

  return (
    <div className="cartao-de-acao">
      <span className="icone-do-cartao" aria-hidden="true">
        <IconeOrquestrador tamanho={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="titulo-do-cartao">{pausar ? "Pausar orquestrador" : "Continuar orquestrador"}</span>
        <span className="mono truncate text-muted" title={pasta}>
          {pasta}
        </span>
        {etapa.tipo === "feito" ? (
          <span className="mono texto-longo text-[11.5px] text-secondary" data-testid="estado-da-pausa">
            {pausar ? `${nome}: pausado (${descreverModo(etapa.modo)})` : `${nome}: continuando`}
          </span>
        ) : (
          naTela !== undefined && (
            <span className="mono texto-longo text-[11.5px] text-secondary" data-testid="estado-da-pausa">
              {nome}: {descreverEstado(naTela)}
            </span>
          )
        )}
        {etapa.tipo === "erro" && (
          <span className="hint-error texto-longo" role="alert">
            {etapa.mensagem}
          </span>
        )}
      </div>
      {/* Nome longo não espreme o cartão: o rótulo corta com reticências e fica inteiro no title. */}
      <button
        type="button"
        className={`btn btn-sm max-w-[45%] shrink-0 ${etapa.tipo === "feito" ? "btn-outline" : "btn-cta"}`}
        title={rotulo}
        disabled={etapa.tipo === "executando" || etapa.tipo === "feito" || (etapa.tipo === "erro" && !etapa.repetir)}
        onClick={() => void executar()}
      >
        <span className="truncate">
          {etapa.tipo === "executando"
            ? pausar
              ? "pausando…"
              : "continuando…"
            : etapa.tipo === "feito"
              ? pausar
                ? "pausado ✓"
                : "continuando ✓"
              : etapa.tipo === "erro" && etapa.repetir
                ? "tentar de novo"
                : rotulo}
        </span>
      </button>
    </div>
  );
}
