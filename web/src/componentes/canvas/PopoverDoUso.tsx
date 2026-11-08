import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { ConsumoDoOrquestrador, JanelaDaCota } from "../../shared/api/tipos";
import { descreverRenovacao, formatarPercentual, formatarTokens } from "../../shared/formatacao";

/** A partir daqui o medidor da cota fica vermelho. */
export const COTA_ALTA = 0.8;

/**
 * Marca os botões que abrem o popover (os medidores da cota e o resumo): o
 * clique neles não conta como "fora", para o próprio botão fechar.
 */
export const ATRIBUTO_DO_GATILHO = "data-abre-o-uso";

const EXPLICACAO_DO_CONSUMO =
  "Soma dos pedidos medidos na conversa atual de cada orquestrador (recomeça ao limpar a conversa). Índice de custo = " +
  "entrada + 1,25 × criação de cache + 0,1 × leitura de cache + 5 × saída, em tokens de entrada equivalentes: " +
  "compara os orquestradores, não é preço nem porcentagem da cota.";

/** "7 dias (Opus)" → janela de um modelo só. */
const JANELA_DE_MODELO = /\([^)]+\)\s*$/;

/** "5 horas" → "Limite de 5 horas"; nomes desconhecidos ficam como vieram. */
function nomeLegivel(nome: string): string {
  return /^\d+\s+(horas?|dias?)\b/.test(nome) ? `Limite de ${nome}` : nome;
}

function LinhaDaCota({ janela, agora }: { janela: JanelaDaCota; agora: Date }) {
  const percentual = Math.min(100, Math.round(janela.utilizacao * 100));
  const nome = nomeLegivel(janela.nome);
  return (
    <div className="linha-do-uso">
      <div className="cabeca-da-linha-do-uso">
        <span>{nome}</span>
        <span className={`mono ${janela.utilizacao >= COTA_ALTA ? "text-error" : ""}`}>
          {formatarPercentual(janela.utilizacao)}
        </span>
      </div>
      <span
        className={`medidor medidor-largo ${janela.utilizacao >= COTA_ALTA ? "medidor-alto" : ""}`}
        role="progressbar"
        aria-label={nome}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentual}
      >
        <span style={{ width: `${percentual}%` }} />
      </span>
      <span className="mono text-muted">
        {janela.situacao === "rejected" && <span className="text-error">no limite · </span>}
        {janela.renovaEm === null ? "sem horário de renovação" : descreverRenovacao(janela.renovaEm, agora)}
      </span>
    </div>
  );
}

function LinhaDoConsumo({ consumo, total }: { consumo: ConsumoDoOrquestrador; total: number }) {
  const parte = total > 0 ? consumo.indiceDeCusto / total : 0;
  const { entrada, criacaoDeCache, leituraDeCache, saida } = consumo.uso;
  return (
    <div
      className="linha-do-uso"
      title={`Tokens: entrada ${formatarTokens(entrada)} · criação de cache ${formatarTokens(criacaoDeCache)} · leitura de cache ${formatarTokens(leituraDeCache)} · saída ${formatarTokens(saida)}`}
    >
      <div className="cabeca-da-linha-do-uso">
        <span className="truncate">{consumo.nome}</span>
        <span className="mono shrink-0">índice {formatarTokens(consumo.indiceDeCusto)}</span>
      </div>
      <span className="medidor medidor-largo" aria-hidden="true">
        <span style={{ width: `${Math.round(parte * 100)}%` }} />
      </span>
      <span className="mono text-muted">
        {consumo.turnosMedidos} {consumo.turnosMedidos === 1 ? "pedido medido" : "pedidos medidos"} ·{" "}
        {formatarPercentual(parte)} do total{consumo.parcial ? " · parcial" : ""}
      </span>
    </div>
  );
}

/** Logo abaixo do botão, alinhado pela direita dele (o status fica no canto direito). */
function posicaoAbaixoDe(gatilho: HTMLElement): { top: number; right: number } {
  const caixa = gatilho.getBoundingClientRect();
  return { top: caixa.bottom + 8, right: Math.max(8, window.innerWidth - caixa.right) };
}

interface PropsDoPopoverDoUso {
  id: string;
  cota: JanelaDaCota[] | null;
  /** O botão que abriu: o popover se posiciona abaixo dele e devolve o foco a ele no Esc. */
  gatilho: HTMLElement;
  aoFechar: () => void;
}

/**
 * O uso da assinatura, aberto pelos medidores da cota do status: cada janela
 * (5 horas, 7 dias e as por modelo, se o Claude mandar) com a barra e quando
 * renova, e o consumo medido de cada orquestrador na conversa atual (lido na
 * abertura). Fica no `body` (o status corta o que transborda) e fecha com
 * Esc, com clique fora ou no próprio medidor.
 */
export function PopoverDoUso({ id, cota, gatilho, aoFechar }: PropsDoPopoverDoUso) {
  const painel = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState(() => posicaoAbaixoDe(gatilho));
  const [agora] = useState(() => new Date());
  const [consumos, setConsumos] = useState<ConsumoDoOrquestrador[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    painel.current?.focus();
  }, []);

  useEffect(() => {
    let vivo = true;
    api
      .lerConsumoDosOrquestradores()
      .then((lidos) => {
        if (vivo) {
          setConsumos(lidos);
        }
      })
      .catch((falha: unknown) => {
        if (vivo) {
          setErro(mensagemDeErro(falha));
        }
      });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    const aoPressionar = (evento: MouseEvent) => {
      const alvo = evento.target;
      if (!(alvo instanceof Element) || painel.current?.contains(alvo) || alvo.closest(`[${ATRIBUTO_DO_GATILHO}]`)) {
        return;
      }
      aoFechar();
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        evento.preventDefault();
        evento.stopPropagation();
        gatilho.focus();
        aoFechar();
      }
    };
    const aoRedimensionar = () => setPosicao(posicaoAbaixoDe(gatilho));
    document.addEventListener("mousedown", aoPressionar, true);
    document.addEventListener("keydown", aoTeclar, true);
    window.addEventListener("resize", aoRedimensionar);
    return () => {
      document.removeEventListener("mousedown", aoPressionar, true);
      document.removeEventListener("keydown", aoTeclar, true);
      window.removeEventListener("resize", aoRedimensionar);
    };
  }, [gatilho, aoFechar]);

  const janelas = cota ?? [];
  const gerais = janelas.filter((janela) => !JANELA_DE_MODELO.test(janela.nome));
  const porModelo = janelas.filter((janela) => JANELA_DE_MODELO.test(janela.nome));
  const total = (consumos ?? []).reduce((soma, consumo) => soma + consumo.indiceDeCusto, 0);

  return createPortal(
    <div
      ref={painel}
      id={id}
      role="dialog"
      aria-label="Uso da assinatura"
      tabIndex={-1}
      className="popover-do-uso painel-flutuante no-drag"
      style={{ top: posicao.top, right: posicao.right }}
    >
      <section className="secao-do-uso" aria-label="Cotas da assinatura">
        <span className="rotulo-tecnico">cotas da assinatura</span>
        {janelas.length === 0 ? (
          <p className="nota-do-uso">
            A cota aparece depois do primeiro pedido: o Claude informa o uso a cada resposta.
          </p>
        ) : (
          <>
            {gerais.map((janela) => (
              <LinhaDaCota key={janela.nome} janela={janela} agora={agora} />
            ))}
            {porModelo.length > 0 && (
              <>
                <span className="rotulo-tecnico">por modelo</span>
                {porModelo.map((janela) => (
                  <LinhaDaCota key={janela.nome} janela={janela} agora={agora} />
                ))}
              </>
            )}
          </>
        )}
      </section>
      <hr className="separador-do-menu" />
      <section className="secao-do-uso" aria-label="Consumo por orquestrador">
        <span className="rotulo-tecnico" title={EXPLICACAO_DO_CONSUMO}>
          consumo por orquestrador · conversa atual
        </span>
        {erro !== null ? (
          <p className="nota-do-uso text-error" role="alert">
            {erro}
          </p>
        ) : consumos === null ? (
          <p className="nota-do-uso">carregando…</p>
        ) : consumos.length === 0 ? (
          <p className="nota-do-uso">Nenhum pedido medido ainda nas conversas atuais.</p>
        ) : (
          consumos.map((consumo) => <LinhaDoConsumo key={consumo.id} consumo={consumo} total={total} />)
        )}
        <p className="nota-do-uso">
          Índice de custo em tokens de entrada equivalentes: compara os orquestradores, não é preço nem % da cota.
        </p>
      </section>
    </div>,
    document.body,
  );
}
