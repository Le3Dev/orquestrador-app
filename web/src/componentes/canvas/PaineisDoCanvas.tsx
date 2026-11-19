import { type MouseEvent as EventoDeMouseDoReact, useCallback, useEffect, useId, useState } from "react";

import type { JanelaDaCota, LeituraDeMemoria } from "../../shared/api/tipos";
import {
  formatarBytes,
  formatarDuracao,
  formatarMomento,
  formatarPercentual,
  rotuloCurtoDaCota,
} from "../../shared/formatacao";
import { textosAtuais, useTextos } from "../../shared/idioma/idioma";
import { textosDePaineis } from "../../shared/idioma/textos/paineis";
import { useRelogio } from "../../shared/hooks/useRelogio";
import { type FonteDeEventosDasRotinas, useRotinas } from "../../shared/hooks/useRotinas";
import { useRotinasNoDesktop } from "../../shared/hooks/useRotinasNoDesktop";
import type { EstadoDoServidor } from "../../shared/hooks/useServidor";
import { nivelDaMemoria } from "../../shared/memoria";
import { IconeFechar } from "../Icones";
import type { OrquestradorEscolhivel } from "../rotinas/EditorDeRotina";
import { PainelDeRotinas } from "../rotinas/PainelDeRotinas";
import { ATRIBUTO_DO_GATILHO, COTA_ALTA, PopoverDoUso } from "./PopoverDoUso";

/** Por quanto tempo o aviso de "reconectado" fica na tela. */
const DURACAO_DO_AVISO_DE_VOLTA_MS = 10_000;

/**
 * Faixa no topo do canvas quando o servidor cai — e, por alguns segundos,
 * quando ele volta. Sem ela, a tela congelada parece um sistema travado.
 */
export function AvisoDeConexao({ servidor }: { servidor: EstadoDoServidor }) {
  const t = useTextos(textosDePaineis).canvas;
  const agora = useRelogio(!servidor.conectado);
  const [mostrarVolta, setMostrarVolta] = useState(false);

  useEffect(() => {
    if (servidor.voltouEm === null) {
      return;
    }
    setMostrarVolta(true);
    const espera = setTimeout(() => setMostrarVolta(false), DURACAO_DO_AVISO_DE_VOLTA_MS);
    return () => clearTimeout(espera);
  }, [servidor.voltouEm]);

  if (!servidor.conectado) {
    const foraHa = servidor.caiuEm === null ? 0 : agora.getTime() - servidor.caiuEm.getTime();
    return (
      <div className="aviso-de-conexao aviso-desconectado" role="alert">
        <span className="ponto-de-status ponto-de-status-erro" />
        <div className="flex flex-col gap-0.5">
          <strong className="font-titulo text-[13px]">
            {t.desconectado(formatarDuracao(foraHa))}
          </strong>
          <span>{t.desconectadoAjuda}</span>
          <span className="mono text-muted">{t.desconectadoReligar}</span>
        </div>
      </div>
    );
  }

  if (mostrarVolta) {
    return (
      <div className="aviso-de-conexao aviso-reconectado" role="status">
        <span className="ponto-de-status ponto-de-status-ok" />
        <div className="flex flex-col gap-0.5">
          <strong className="font-titulo text-[13px]">{t.reconectado}</strong>
          {servidor.reiniciou && <span>{t.reiniciado}</span>}
        </div>
        <button type="button" className="botao-icone" title={t.fecharAviso} onClick={() => setMostrarVolta(false)}>
          <IconeFechar tamanho={14} />
        </button>
      </div>
    );
  }

  return null;
}


interface PropsDoErroDoCanvas {
  erro: string;
  aoFechar: () => void;
  /** "aviso" para recusas esperadas (ex.: limite de terminais abertos); padrão, erro. */
  nivel?: "erro" | "aviso";
}

/** Falha ou recusa numa ação do canvas (ex.: criar uma nota), logo abaixo da barra. */
export function ErroDoCanvas({ erro, aoFechar, nivel = "erro" }: PropsDoErroDoCanvas) {
  const t = useTextos(textosDePaineis).canvas;
  return (
    <div
      className={`alert ${nivel === "aviso" ? "alert-warning" : "alert-error"} mt-2 flex max-w-md items-start gap-2`}
      role="alert"
    >
      <span className="flex-1">{erro}</span>
      <button type="button" className="botao-icone shrink-0" title={t.fecharAviso} onClick={aoFechar}>
        <IconeFechar tamanho={14} />
      </button>
    </div>
  );
}

interface PropsDasRotinasDoCanvas {
  /** O servidor respondeu há pouco: a cada vez que ele volta, a lista das rotinas é lida de novo. */
  servidorConectado: boolean;
  /** Os orquestradores que existem (a tela já os tem): quem pode receber o pedido de cada etapa. Nulo enquanto não chegaram. */
  orquestradores: readonly OrquestradorEscolhivel[] | null;
  /** O painel está aberto. Quem monta decide (um painel da barra por vez): abrir um fecha o outro. */
  aberto: boolean;
  /** Quem abre o painel é o item "Rotinas" do menu `+ Novo`; aqui só serve à notificação do Windows (`aoPedirPainel`). */
  aoAbrir: () => void;
  /** Esc ou o X do painel. */
  aoFechar: () => void;
  /**
   * Quantas execuções aguardam aprovação: avisado na primeira leitura e a cada mudança. Quem monta mostra
   * o número como selo no menu `+ Novo`, para a pendência aparecer mesmo com o painel fechado.
   */
  aoMudarAguardandoAprovacao: (total: number) => void;
  /** Só para testes: troca a conexão ao vivo. */
  criarFonte?: (endereco: string) => FonteDeEventosDasRotinas | null;
}

/**
 * Rotinas no canvas: o painel, quando `aberto`, logo abaixo da ilha do nome. Não desenha botão: o acesso é o
 * item "Rotinas" do menu `+ Novo`. Fica montado mesmo com o painel fechado: é ele que mantém as rotinas e as
 * aprovações em dia (`aoMudarAguardandoAprovacao`) e avisa o app desktop quantas rotinas estão ativas (a
 * janela fecha para a bandeja) e quando uma execução espera aprovação (notificação do Windows, cujo clique
 * pede `aoAbrir`).
 *
 * Sem o servidor das rotinas (rota ainda não ligada, servidor fora), o painel
 * mostra "Rotinas indisponíveis" e o canvas não quebra.
 */
export function RotinasDoCanvas({
  servidorConectado,
  orquestradores,
  aberto,
  aoAbrir,
  aoFechar,
  aoMudarAguardandoAprovacao,
  criarFonte,
}: PropsDasRotinasDoCanvas) {
  const rotinas = useRotinas(servidorConectado, criarFonte);
  const aguardandoAprovacao = rotinas.aprovacoesPendentes.length;
  useRotinasNoDesktop({
    carregada: rotinas.carregada,
    ativas: rotinas.ativas,
    aprovacoesPendentes: rotinas.aprovacoesPendentes,
    aoPedirPainel: aoAbrir,
  });
  useEffect(() => {
    aoMudarAguardandoAprovacao(aguardandoAprovacao);
  }, [aguardandoAprovacao, aoMudarAguardandoAprovacao]);

  return aberto ? <PainelDeRotinas rotinas={rotinas} orquestradores={orquestradores} aoFechar={aoFechar} /> : null;
}

interface PropsDoStatus {
  trabalhando: number;
  bixinhosAtivos: number;
  cota: JanelaDaCota[] | null;
  memoria: LeituraDeMemoria | null;
}


function descreverMemoria(memoria: LeituraDeMemoria): string {
  return textosAtuais(textosDePaineis).canvas.descreverMemoria(
    formatarBytes(memoria.livreBytes),
    formatarBytes(memoria.totalBytes),
    formatarBytes(memoria.agentesBytes),
    formatarBytes(memoria.servidorBytes),
  );
}

/** RAM livre do computador e quanto os agentes estão usando, com alerta quando aperta. */
function MedidorDeMemoria({ memoria }: { memoria: LeituraDeMemoria }) {
  const t = useTextos(textosDePaineis).canvas;
  const nivel = nivelDaMemoria(memoria);
  const usada = 1 - memoria.livreBytes / memoria.totalBytes;
  return (
    <span
      className={`status-detalhe flex items-center gap-1.5 mono whitespace-nowrap ${nivel === "normal" ? "text-muted" : nivel === "baixa" ? "text-warning" : "text-error"}`}
      title={descreverMemoria(memoria)}
    >
      RAM
      <span className={`medidor ${nivel === "normal" ? "" : "medidor-alto"}`}>
        <span style={{ width: `${Math.round(usada * 100)}%` }} />
      </span>
      {t.livres(formatarBytes(memoria.livreBytes))}
      {memoria.agentesBytes > 0 && (
        <span className="status-extra text-muted">{t.agentesMemoria(formatarBytes(memoria.agentesBytes))}</span>
      )}
    </span>
  );
}

interface LeituraDoResumo {
  rotulo: string;
  uso: number;
  alto: boolean;
  linha: string;
}

/** O que liga um botão do status ao popover do uso: abre, fecha e diz se está aberto. */
interface GatilhoDoUso {
  aberto: boolean;
  idDoPopover: string;
  aoAlternar: (evento: EventoDeMouseDoReact<HTMLElement>) => void;
}

/** Atributos comuns dos botões que abrem o popover do uso. */
function propsDoGatilho({ aberto, idDoPopover, aoAlternar }: GatilhoDoUso) {
  return {
    type: "button" as const,
    "aria-haspopup": "dialog" as const,
    "aria-expanded": aberto,
    "aria-controls": aberto ? idDoPopover : undefined,
    [ATRIBUTO_DO_GATILHO]: "",
    onClick: aoAlternar,
  };
}

/**
 * Abaixo de 1100 px: um só medidor (o uso mais alto entre as cotas e a RAM),
 * com o resto no balão ao passar o mouse. O clique abre o popover do uso.
 */
function ResumoDoStatus({
  bixinhosAtivos,
  cota,
  memoria,
  gatilho,
}: Omit<PropsDoStatus, "trabalhando"> & { gatilho: GatilhoDoUso }) {
  const t = useTextos(textosDePaineis).canvas;
  const leituras: LeituraDoResumo[] = (cota ?? []).map((janela) => ({
    rotulo: rotuloCurtoDaCota(janela.nome),
    uso: janela.utilizacao,
    alto: janela.utilizacao >= COTA_ALTA,
    linha: `${janela.nome}: ${formatarPercentual(janela.utilizacao)}${janela.renovaEm ? ` ${t.renovaEntreParenteses(formatarMomento(janela.renovaEm))}` : ""}`,
  }));
  if (memoria !== null) {
    leituras.push({
      rotulo: "RAM",
      uso: 1 - memoria.livreBytes / memoria.totalBytes,
      alto: nivelDaMemoria(memoria) !== "normal",
      linha: `RAM: ${descreverMemoria(memoria)}`,
    });
  }
  if (leituras.length === 0 && bixinhosAtivos === 0) {
    return null;
  }
  const principal = leituras.reduce<LeituraDoResumo | null>(
    (maior, leitura) => (maior === null || leitura.uso > maior.uso ? leitura : maior),
    null,
  );
  const dica = [
    ...(bixinhosAtivos > 0 ? [t.agentesAtivos(bixinhosAtivos)] : []),
    ...leituras.map((leitura) => leitura.linha),
  ].join("\n");
  return (
    <button
      {...propsDoGatilho(gatilho)}
      className={`status-resumo items-center gap-1.5 mono whitespace-nowrap ${leituras.some((leitura) => leitura.alto) ? "text-error" : "text-muted"}`}
      title={`${dica}\n${t.cliqueParaVerOUso}`}
      aria-label={dica}
      data-testid="resumo-do-status"
    >
      {bixinhosAtivos > 0 && <span className="text-active">{t.ativosCurto(bixinhosAtivos)}</span>}
      {principal !== null && (
        <>
          {principal.rotulo}
          <span className={`medidor medidor-curto ${principal.alto ? "medidor-alto" : ""}`}>
            <span style={{ width: `${Math.min(100, Math.round(principal.uso * 100))}%` }} />
          </span>
          {formatarPercentual(principal.uso)}
        </>
      )}
    </button>
  );
}

/**
 * Situação, agentes ativos, cotas e RAM: o conteúdo do status, em linha. Cada
 * medidor da cota (e o resumo, na janela estreita) abre o popover do uso; sem
 * cota ainda, um "cota —" faz o mesmo papel.
 */
function ConteudoDoStatus({ trabalhando, bixinhosAtivos, cota, memoria }: PropsDoStatus) {
  const t = useTextos(textosDePaineis).canvas;
  // O botão que abriu o popover; nulo com ele fechado. Um clique em qualquer gatilho fecha.
  const [gatilhoAberto, setGatilhoAberto] = useState<HTMLElement | null>(null);
  const idDoPopover = `${useId()}-uso`;
  const fecharUso = useCallback(() => setGatilhoAberto(null), []);
  const gatilho: GatilhoDoUso = {
    aberto: gatilhoAberto !== null,
    idDoPopover,
    aoAlternar: (evento) => {
      const alvo = evento.currentTarget;
      setGatilhoAberto((atual) => (atual === null ? alvo : null));
    },
  };

  return (
    <>
      <span className={`etiqueta shrink-0 ${trabalhando > 0 ? "etiqueta-ativa etiqueta-pulso" : ""}`}>
        {trabalhando > 0 ? t.trabalhando(trabalhando) : t.todosOciosos}
      </span>
      {bixinhosAtivos > 0 && (
        <span className="status-detalhe mono text-active whitespace-nowrap">
          {t.agentesAtivos(bixinhosAtivos)}
        </span>
      )}
      {cota !== null && cota.length > 0 ? (
        cota.map((janela) => (
          <button
            key={janela.nome}
            {...propsDoGatilho(gatilho)}
            className="status-detalhe status-da-cota flex items-center gap-1.5 mono text-muted whitespace-nowrap"
            aria-label={t.cotaDe(janela.nome, formatarPercentual(janela.utilizacao))}
            title={`${janela.renovaEm ? `${t.renova(formatarMomento(janela.renovaEm))} · ` : ""}${t.cliqueParaVerOUso}`}
          >
            <span className="rotulo-completo">{janela.nome}</span>
            <span className="rotulo-curto">{rotuloCurtoDaCota(janela.nome)}</span>
            <span className={`medidor ${janela.utilizacao >= COTA_ALTA ? "medidor-alto" : ""}`}>
              <span style={{ width: `${Math.min(100, Math.round(janela.utilizacao * 100))}%` }} />
            </span>
            {formatarPercentual(janela.utilizacao)}
          </button>
        ))
      ) : (
        <button
          {...propsDoGatilho(gatilho)}
          className="status-detalhe status-da-cota flex items-center gap-1.5 mono text-muted whitespace-nowrap"
          aria-label={t.cotaSemDados}
          title={`${t.cotaAparece} · ${t.cliqueParaVerOUso}`}
        >
          {t.cotaTraco}
        </button>
      )}
      {memoria !== null && <MedidorDeMemoria memoria={memoria} />}
      <ResumoDoStatus bixinhosAtivos={bixinhosAtivos} cota={cota} memoria={memoria} gatilho={gatilho} />
      {gatilhoAberto !== null && (
        <PopoverDoUso id={idDoPopover} cota={cota} gatilho={gatilhoAberto} aoFechar={fecharUso} />
      )}
    </>
  );
}

/**
 * Situação, agentes ativos, cotas e RAM, para a aba Sistema das Configurações
 * (abre pelo anel de memória da ilha da direita). Cada medidor da cota abre o
 * popover do uso. Sempre completo: não depende da largura da janela.
 */
export function StatusDoCanvas(status: PropsDoStatus) {
  return (
    <div className="status-do-canvas status-do-sistema" data-testid="status-do-canvas">
      <ConteudoDoStatus {...status} />
    </div>
  );
}
