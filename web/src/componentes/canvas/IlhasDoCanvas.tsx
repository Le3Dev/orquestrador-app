import { useReactFlow, useStore } from "@xyflow/react";
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import type { JanelaDaCota, LeituraDeMemoria } from "../../shared/api/tipos";
import { formatarMomento, formatarPercentual } from "../../shared/formatacao";
import { useAtualizacao } from "../../shared/hooks/useAtualizacao";
import { nivelDaMemoria, type NivelDaMemoria } from "../../shared/memoria";
import { IconeAlerta, IconeDesenhar, IconeEngrenagem, IconeGrade, IconeOrquestrador } from "../Icones";
import { AvisoDeAtualizacao } from "./AvisoDeAtualizacao";
import { ControlesDaJanela } from "./ControlesDaJanela";
import {
  IconeEnquadrar,
  IconeInfo,
  IconeLupa,
  IconeMais,
  IconeMemoria,
  IconeMenos,
  IconeTrabalhando,
} from "./IconesDasIlhas";
import { MenuNovo, type PropsDoMenuNovo } from "./MenuNovo";
import { COTA_ALTA } from "./PopoverDoUso";
import "../../theme/ilhas.css";

/** Nome e dica do "Organizar" e do "Desenhar" na ilha de ferramentas (os mesmos dos antigos controles). */
export const DICA_DO_ORGANIZAR = "Organizar: terminais lado a lado; notas e artefatos à direita";
export const DICA_DO_DESENHAR = "Desenhar: caneta, marca-texto, formas e texto por cima do canvas";

/**
 * Ilha do canto superior esquerdo: o ícone e o nome do app, um divisor e o
 * botão `+ Novo` com o menu (ver `MenuNovo`). No app desktop o fundo dela
 * arrasta a janela (`ilha-arrasta`); o botão, o menu e o submenu são `no-drag`.
 */
export function IlhaDoNome(props: PropsDoMenuNovo) {
  return (
    <header className="ilha ilha-arrasta ilha-do-nome nodrag nopan nowheel" data-testid="ilha-do-nome">
      <span className="nome-do-app">
        <span className="icone-do-app">
          <IconeOrquestrador tamanho={22} />
        </span>
        <h1>Orquestrador de Agentes</h1>
      </span>
      <span className="divisor-da-ilha" aria-hidden="true" />
      <MenuNovo {...props} />
    </header>
  );
}

interface PropsDoAnel {
  memoria: LeituraDeMemoria | null;
  nivel: NivelDaMemoria;
}

/** O anel de uso da memória: o arco cresce com o uso e o chip fica no meio. */
function AnelDeMemoria({ memoria }: Pick<PropsDoAnel, "memoria">) {
  const tamanho = 26;
  const traco = 2.2;
  const raio = (tamanho - traco) / 2;
  const circunferencia = 2 * Math.PI * raio;
  const usada = memoria === null ? 0 : Math.min(1, Math.max(0, 1 - memoria.livreBytes / memoria.totalBytes));
  return (
    <span className="anel-de-memoria" aria-hidden="true">
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`}>
        <circle className="trilha-do-anel" cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" strokeWidth={traco} />
        <circle
          className="arco-do-anel"
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="none"
          strokeWidth={traco}
          strokeLinecap="round"
          strokeDasharray={`${circunferencia * usada} ${circunferencia}`}
          transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`}
        />
      </svg>
      <IconeMemoria className="chip-do-anel" />
    </span>
  );
}

const TEXTO_DO_NIVEL: Record<NivelDaMemoria, string> = { normal: "", baixa: "Memória baixa", critica: "Memória crítica" };

interface PropsDaIlhaDaDireita {
  /** Abre a paleta de comandos (o mesmo do Ctrl+K). */
  aoBuscar: () => void;
  /** Orquestradores trabalhando agora. */
  trabalhando: number;
  memoria: LeituraDeMemoria | null;
  /** Abre as Configurações (ou fecha, se já estavam na mesma aba); sem aba, na aba padrão. */
  aoAlternarConfiguracoes: (aba?: "sistema") => void;
  configuracoesAbertas: boolean;
  /** Em qual aba as Configurações estão; nulo com elas fechadas. */
  abaAberta: string | null;
  /**
   * Windows e Linux no app desktop: a janela não tem botões nativos, então ─ ☐ ✕ vão para o fim
   * da ilha, depois de um divisor. No Mac (bolinhas nativas) e no navegador, fica falso.
   */
  controlesDaJanela?: boolean;
}

/**
 * Ilha do canto superior direito: a lupa (paleta de comandos), o contador de
 * quem está trabalhando, o anel de memória (abre Configurações na aba
 * Sistema) e a engrenagem (abre Configurações). No app desktop o fundo dela
 * arrasta a janela (`ilha-arrasta`); o que é clicável é `no-drag`.
 */
export function IlhaDaDireita({
  aoBuscar,
  trabalhando,
  memoria,
  aoAlternarConfiguracoes,
  configuracoesAbertas,
  abaAberta,
  controlesDaJanela = false,
}: PropsDaIlhaDaDireita) {
  const nivel = memoria === null ? "normal" : nivelDaMemoria(memoria);
  const percentual = memoria === null ? null : Math.round((1 - memoria.livreBytes / memoria.totalBytes) * 100);
  const texto = TEXTO_DO_NIVEL[nivel];
  const rotuloDoAnel =
    percentual === null
      ? "Memória do computador: sem leitura ainda. Abrir Configurações, Sistema"
      : `Memória do computador: ${percentual}% em uso${texto === "" ? "" : `, ${texto.toLowerCase()}`}. Abrir Configurações, Sistema`;
  return (
    <div className="ilha ilha-arrasta ilha-da-direita nodrag nopan nowheel" role="group" aria-label="Busca, status e configurações">
      <button
        type="button"
        className="botao-da-ilha no-drag"
        onClick={aoBuscar}
        aria-label="Buscar (Ctrl+K)"
        aria-keyshortcuts="Control+K"
        title="Paleta de comandos: ações, orquestradores, notas e pedidos (Ctrl+K)"
      >
        <IconeLupa tamanho={20} />
      </button>
      {trabalhando > 0 && (
        <span
          className="contador-da-ilha no-drag"
          role="status"
          aria-label={`${trabalhando} trabalhando agora`}
          title={`${trabalhando} trabalhando agora`}
          data-testid="contador-trabalhando"
        >
          <IconeTrabalhando tamanho={14} className="giro-do-contador" />
          <span aria-hidden="true">{trabalhando}</span>
          <span className="texto-do-contador" aria-hidden="true">
            trabalhando
          </span>
        </span>
      )}
      <button
        type="button"
        className={`anel-da-ilha anel-da-ilha-${nivel} no-drag`}
        aria-pressed={configuracoesAbertas && abaAberta === "sistema"}
        aria-label={rotuloDoAnel}
        title={percentual === null ? "Memória: sem leitura ainda. Abre Configurações, Sistema" : `Memória ${percentual}% em uso. Abre Configurações, Sistema`}
        data-testid="anel-de-memoria"
        onClick={() => aoAlternarConfiguracoes("sistema")}
      >
        <AnelDeMemoria memoria={memoria} />
        {texto !== "" && <span className="texto-do-anel">{texto}</span>}
      </button>
      <button
        type="button"
        className="botao-da-ilha no-drag"
        aria-pressed={configuracoesAbertas && abaAberta !== "sistema"}
        aria-label="Configurações"
        title="Configurações"
        onClick={() => aoAlternarConfiguracoes()}
      >
        <IconeEngrenagem tamanho={20} />
      </button>
      {controlesDaJanela && (
        <>
          <span className="divisor-da-ilha" aria-hidden="true" />
          <ControlesDaJanela />
        </>
      )}
    </div>
  );
}

interface PropsDaIlhaDeFerramentas {
  aoEnquadrar: () => void;
  aoOrganizar: () => void;
  podeOrganizar: boolean;
  aoAlternarDesenho: () => void;
  desenhoAberto: boolean;
}

/**
 * Ilha vertical do canto inferior esquerdo: aproximar, afastar, ajustar à
 * tela, organizar e desenhar (a caneta abre a barra de desenho ao lado).
 * Chama as mesmas funções dos antigos controles do React Flow.
 */
export const IlhaDeFerramentas = memo(function IlhaDeFerramentas({
  aoEnquadrar,
  aoOrganizar,
  podeOrganizar,
  aoAlternarDesenho,
  desenhoAberto,
}: PropsDaIlhaDeFerramentas) {
  const fluxo = useReactFlow();
  // Só os limites mudam o resultado: o zoom contínuo não re-renderiza a ilha.
  const noMaximo = useStore((estado) => estado.transform[2] >= estado.maxZoom);
  const noMinimo = useStore((estado) => estado.transform[2] <= estado.minZoom);
  return (
    <div
      className="ilha ilha-de-ferramentas nodrag nopan nowheel"
      role="group"
      aria-label="Ferramentas do canvas"
      data-testid="ilha-de-ferramentas"
    >
      <button
        type="button"
        className="botao-da-ilha-vertical"
        onClick={() => void fluxo.zoomIn({ duration: 200 })}
        disabled={noMaximo}
        aria-label="Aproximar"
        title="Aproximar"
      >
        <IconeMais tamanho={20} />
      </button>
      <button
        type="button"
        className="botao-da-ilha-vertical"
        onClick={() => void fluxo.zoomOut({ duration: 200 })}
        disabled={noMinimo}
        aria-label="Afastar"
        title="Afastar"
      >
        <IconeMenos tamanho={20} />
      </button>
      <button
        type="button"
        className="botao-da-ilha-vertical"
        onClick={aoEnquadrar}
        aria-label="Ajustar à tela"
        title="Ajustar à tela: mostra tudo o que está no canvas"
      >
        <IconeEnquadrar tamanho={18} />
      </button>
      <button
        type="button"
        className="botao-da-ilha-vertical"
        onClick={aoOrganizar}
        disabled={!podeOrganizar}
        aria-label="Organizar janelas"
        title={DICA_DO_ORGANIZAR}
      >
        <IconeGrade tamanho={18} />
      </button>
      <button
        type="button"
        className="botao-da-ilha-vertical botao-de-desenhar"
        onClick={aoAlternarDesenho}
        aria-pressed={desenhoAberto}
        aria-label="Desenhar"
        title={DICA_DO_DESENHAR}
      >
        <IconeDesenhar tamanho={18} />
      </button>
    </div>
  );
});

/** Onde a pilha de notificações começa: abaixo da ilha da direita (16 de margem, 48 de altura e 8 de respiro). */
const TOPO_DAS_NOTIFICACOES_PX = 72;

const AVISO_DA_MEMORIA = {
  baixa: "Memória baixa: novos pedidos (sobretudo com Opus nos subagentes) podem deixar o computador lento.",
  critica:
    "Memória quase esgotada: espere os pedidos em andamento terminarem, feche programas ou use Haiku/Sonnet nos subagentes.",
} as const;

interface PropsDaNotificacao {
  /** A cor e o papel do aviso: memória baixa, crítica ou cota. */
  tom: "baixa" | "critica" | "cota";
  icone: ReactNode;
  titulo?: string;
  children: ReactNode;
  aoVerSistema: () => void;
  aoEntendi: () => void;
  rotuloDoEntendi: string;
}

function Notificacao({ tom, icone, titulo, children, aoVerSistema, aoEntendi, rotuloDoEntendi }: PropsDaNotificacao) {
  return (
    <div className={`notificacao notificacao-${tom}`} role={tom === "critica" ? "alert" : "status"}>
      <span className="icone-da-notificacao" aria-hidden="true">
        {icone}
      </span>
      <div className="corpo-da-notificacao">
        <p>
          {titulo !== undefined && <strong>{titulo} </strong>}
          {children}
        </p>
        <div className="acoes-da-notificacao">
          <button type="button" className="botao-da-notificacao" onClick={aoVerSistema}>
            Ver Sistema
          </button>
          <button type="button" className="botao-da-notificacao" onClick={aoEntendi} aria-label={rotuloDoEntendi}>
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

interface PropsDasNotificacoes {
  memoria: LeituraDeMemoria | null;
  cota: JanelaDaCota[] | null;
  /** Abre as Configurações na aba Sistema. */
  aoVerSistema: () => void;
  /** Pedidos rodando agora: reiniciar para atualizar o app pede confirmação. */
  pedidosEmAndamento: number;
  /**
   * Avisa o topo livre abaixo da pilha, em px do contêiner (ou `null` sem pilha): é o `topo` do
   * painel de Configurações, que desce para baixo das notificações.
   */
  aoMedirTopoLivre?: (topo: number | null) => void;
}

/**
 * As notificações do canto superior direito, logo abaixo da ilha da direita:
 * memória baixa ou crítica, cota alta e a atualização do app (baixando ou
 * pronta). Cada aviso fica até o "Entendi" enquanto o motivo valer; se a
 * memória piorar (baixa para crítica) ou normalizar e apertar de novo, ele
 * volta. Não somem com um menu aberto: ficam do lado oposto ao do `+ Novo`.
 */
export function NotificacoesDoCanvas({
  memoria,
  cota,
  aoVerSistema,
  pedidosEmAndamento,
  aoMedirTopoLivre,
}: PropsDasNotificacoes) {
  const aoMedirRef = useRef(aoMedirTopoLivre);
  useEffect(() => {
    aoMedirRef.current = aoMedirTopoLivre;
  });
  // Ref com cleanup: mede a pilha enquanto ela existe e libera o topo ao sumir.
  const medirAPilha = useCallback((pilha: HTMLDivElement | null) => {
    if (pilha === null) {
      return;
    }
    const publicar = () => aoMedirRef.current?.(TOPO_DAS_NOTIFICACOES_PX + pilha.offsetHeight + 8);
    publicar();
    const observador = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publicar);
    observador?.observe(pilha);
    return () => {
      observador?.disconnect();
      aoMedirRef.current?.(null);
    };
  }, []);
  const nivel = memoria === null ? "normal" : nivelDaMemoria(memoria);
  const [memoriaDispensada, setMemoriaDispensada] = useState<NivelDaMemoria | null>(null);
  const [cotasDispensadas, setCotasDispensadas] = useState<ReadonlySet<string>>(new Set());
  const { estado, avisoDispensado } = useAtualizacao();

  // Ajustes durante o render (padrão do React para estado derivado): normalizou, o aviso pode voltar.
  if (nivel === "normal" && memoriaDispensada !== null) {
    setMemoriaDispensada(null);
  }
  const cotasAltas = (cota ?? []).filter((janela) => janela.utilizacao >= COTA_ALTA);
  const aindaAltas = [...cotasDispensadas].filter((nome) => cotasAltas.some((janela) => janela.nome === nome));
  if (aindaAltas.length !== cotasDispensadas.size) {
    setCotasDispensadas(new Set(aindaAltas));
  }

  const avisoDaMemoria =
    nivel === "normal" || memoriaDispensada === "critica" || memoriaDispensada === nivel ? null : nivel;
  const avisosDaCota = cotasAltas.filter((janela) => !cotasDispensadas.has(janela.nome));
  const atualizacao = estado?.situacao === "baixando" || (estado?.situacao === "pronta" && !avisoDispensado);

  if (avisoDaMemoria === null && avisosDaCota.length === 0 && !atualizacao) {
    return null;
  }
  return (
    <div ref={medirAPilha} className="notificacoes-do-canvas nodrag nopan nowheel" role="region" aria-label="Notificações">
      {avisoDaMemoria !== null && (
        <Notificacao
          tom={avisoDaMemoria}
          icone={<IconeAlerta tamanho={18} />}
          aoVerSistema={aoVerSistema}
          aoEntendi={() => setMemoriaDispensada(avisoDaMemoria)}
          rotuloDoEntendi="Entendi: memória"
        >
          {AVISO_DA_MEMORIA[avisoDaMemoria]}
        </Notificacao>
      )}
      {avisosDaCota.map((janela) => (
        <Notificacao
          key={janela.nome}
          tom="cota"
          icone={<IconeInfo tamanho={18} />}
          titulo={`Cota (${janela.nome}) em ${formatarPercentual(janela.utilizacao)}.`}
          aoVerSistema={aoVerSistema}
          aoEntendi={() => setCotasDispensadas((atuais) => new Set(atuais).add(janela.nome))}
          rotuloDoEntendi={`Entendi: cota ${janela.nome}`}
        >
          Passou do limite de aviso ({formatarPercentual(COTA_ALTA)}).
          {janela.renovaEm ? ` Renova ${formatarMomento(janela.renovaEm)}.` : ""}
        </Notificacao>
      ))}
      {atualizacao && (
        <div className="notificacao-da-atualizacao">
          <AvisoDeAtualizacao pedidosEmAndamento={pedidosEmAndamento} />
        </div>
      )}
    </div>
  );
}
