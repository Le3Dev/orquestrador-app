import { useEffect, useState } from "react";

import type { JanelaDaCota, LeituraDeMemoria, ResumoDoOrquestrador } from "../../shared/api/tipos";
import {
  descreverQuantidade,
  formatarBytes,
  formatarDuracao,
  formatarMomento,
  formatarPercentual,
  ROTULOS_DOS_MODELOS,
  rotuloCurtoDaCota,
} from "../../shared/formatacao";
import { useRelogio } from "../../shared/hooks/useRelogio";
import type { EstadoDoServidor } from "../../shared/hooks/useServidor";
import { nivelDaMemoria } from "../../shared/memoria";
import { EtiquetaDeWorktree } from "../EtiquetaDeWorktree";
import { IconeOrquestrador, IconePasta } from "../Icones";
import { apiDaConfiguracao, rodandoNoDesktop } from "../../shared/ponteDoDesktop";

/** Por quanto tempo o aviso de "reconectado" fica na tela. */
const DURACAO_DO_AVISO_DE_VOLTA_MS = 10_000;

/**
 * Faixa no topo do canvas quando o servidor cai — e, por alguns segundos,
 * quando ele volta. Sem ela, a tela congelada parece um sistema travado.
 */
export function AvisoDeConexao({ servidor }: { servidor: EstadoDoServidor }) {
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
            Servidor desconectado · há {formatarDuracao(foraHa)}
          </strong>
          <span>
            Os orquestradores pararam de responder. A tela reconecta sozinha assim que o servidor voltar.
          </span>
          <span className="mono text-muted">
            o aplicativo religa o servidor sozinho; se não voltar, feche e abra o Orquestrador de novo
          </span>
        </div>
      </div>
    );
  }

  if (mostrarVolta) {
    return (
      <div className="aviso-de-conexao aviso-reconectado" role="status">
        <span className="ponto-de-status ponto-de-status-ok" />
        <div className="flex flex-col gap-0.5">
          <strong className="font-titulo text-[13px]">Servidor reconectado</strong>
          {servidor.reiniciou && (
            <span>
              Ele foi reiniciado: pedidos que estavam rodando aparecem como interrompidos. Reenvie se precisar — os
              orquestradores lembram da conversa.
            </span>
          )}
        </div>
        <button type="button" className="botao-icone" title="Fechar aviso" onClick={() => setMostrarVolta(false)}>
          ✕
        </button>
      </div>
    );
  }

  return null;
}

/** A partir daqui o medidor da cota fica vermelho. */
const COTA_ALTA = 0.8;

interface PropsDaBarra {
  aoCriar: () => void;
  aoCriarNota: () => void;
  aoOrganizar: () => void;
  podeOrganizar: boolean;
}

interface PropsDoRotulo {
  /** Texto inteiro (≥ 1280 px). */
  completo: string;
  /** Entre 1100 e 1280 px. */
  curto: string;
  /** Abaixo de 1100 px: o botão fica só com o ícone e a dica (`title`). */
  icone: string;
}

/**
 * O rótulo de um botão em três tamanhos; o CSS (`.rotulo-*`, pela largura da
 * janela) mostra um só. O nome acessível vem do `aria-label` do botão.
 */
function RotuloResponsivo({ completo, curto, icone }: PropsDoRotulo) {
  return (
    <>
      <span className="rotulo-completo" aria-hidden="true">
        {completo}
      </span>
      <span className="rotulo-curto" aria-hidden="true">
        {curto}
      </span>
      <span className="rotulo-icone" aria-hidden="true">
        {icone}
      </span>
    </>
  );
}

/**
 * Canto superior esquerdo: as ações do canvas. No navegador, também a
 * identidade do app; no desktop ela já está na barra de título (que é a área
 * de arraste da janela).
 */
export function BarraDoCanvas({ aoCriar, aoCriarNota, aoOrganizar, podeOrganizar }: PropsDaBarra) {
  const desktop = rodandoNoDesktop();
  const configuracao = apiDaConfiguracao();
  const [erroDosAjustes, setErroDosAjustes] = useState<string | null>(null);

  const abrirAjustes = async () => {
    if (configuracao === null) return;
    setErroDosAjustes(null);
    try {
      await configuracao.abrirAjustes();
    } catch (falha) {
      const motivo = falha instanceof Error ? falha.message : String(falha);
      setErroDosAjustes(`Não foi possível abrir os ajustes de pastas: ${motivo}`);
    }
  };

  return (
    <div className="barra-do-canvas painel-flutuante flex items-center gap-2 px-2.5 py-2">
      {!desktop && (
        <>
          <div className="no-orquestrador-icone h-8 w-8 shrink-0">
            <IconeOrquestrador tamanho={18} />
          </div>
          <div className="identidade-da-barra flex flex-col leading-tight">
            <h1 className="text-[14px] whitespace-nowrap">Orquestrador de agentes</h1>
            <span className="subtitulo-da-barra mono text-muted whitespace-nowrap">claude code · canvas · local</span>
          </div>
          <span className="mx-1 h-8 w-px shrink-0 bg-border" />
        </>
      )}
      <button
        type="button"
        className="btn btn-sm btn-cta"
        onClick={aoCriar}
        aria-label="+ Novo orquestrador"
        title="Novo orquestrador"
      >
        <RotuloResponsivo completo="+ Novo orquestrador" curto="+ Novo" icone="+" />
      </button>
      <button
        type="button"
        className="btn btn-sm btn-cta"
        onClick={aoCriarNota}
        aria-label="+ notas"
        title="Cria uma nota no centro da tela (bloco de notas, salvo automaticamente)"
      >
        <RotuloResponsivo completo="+ notas" curto="+ Nota" icone="✎" />
      </button>
      <button
        type="button"
        className="btn btn-sm btn-outline"
        onClick={aoOrganizar}
        disabled={!podeOrganizar}
        aria-label="Organizar"
        title="Coloca os terminais lado a lado, e as notas em colunas à direita deles"
      >
        <RotuloResponsivo completo="Organizar" curto="Organizar" icone="▦" />
      </button>
      {configuracao !== null && (
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => void abrirAjustes()}
          aria-label="⚙ Pastas"
          title="Pasta dos projetos e Claude Code"
        >
          <RotuloResponsivo completo="⚙ Pastas" curto="⚙" icone="⚙" />
        </button>
      )}
      {erroDosAjustes !== null && (
        <span className="mono text-error max-w-64" role="alert">
          {erroDosAjustes}
        </span>
      )}
    </div>
  );
}

interface PropsDoErroDoCanvas {
  erro: string;
  aoFechar: () => void;
  /** "aviso" para recusas esperadas (ex.: limite de terminais abertos); padrão, erro. */
  nivel?: "erro" | "aviso";
}

/** Falha ou recusa numa ação do canvas (ex.: criar uma nota), logo abaixo da barra. */
export function ErroDoCanvas({ erro, aoFechar, nivel = "erro" }: PropsDoErroDoCanvas) {
  return (
    <div
      className={`alert ${nivel === "aviso" ? "alert-warning" : "alert-error"} mt-2 flex max-w-md items-start gap-2`}
      role="alert"
    >
      <span className="flex-1">{erro}</span>
      <button type="button" className="botao-icone shrink-0" title="Fechar aviso" onClick={aoFechar}>
        ✕
      </button>
    </div>
  );
}

interface PropsDaDoca {
  orquestradores: ResumoDoOrquestrador[] | null;
  noCanvas: ReadonlySet<string>;
  erro: string | null;
  aoAbrir: (id: string) => void;
}

/** Lista de todos os Orquestradores: clicar abre (ou encontra) o terminal no canvas. */
export function Doca({ orquestradores, noCanvas, erro, aoAbrir }: PropsDaDoca) {
  const [recolhida, setRecolhida] = useState(false);

  return (
    <div className="painel-flutuante mt-2 flex w-72 flex-col">
      <button
        type="button"
        className="flex cursor-pointer items-center justify-between px-3 py-2"
        aria-expanded={!recolhida}
        onClick={() => setRecolhida((atual) => !atual)}
      >
        <span className="rotulo-tecnico">orquestradores · {orquestradores?.length ?? 0}</span>
        <span className="mono text-muted">{recolhida ? "▸" : "▾"}</span>
      </button>
      {!recolhida && (
        <div className="custom-scrollbar max-h-[50vh] overflow-y-auto border-t border-border p-1.5">
          {erro !== null && <div className="alert alert-error m-1">{erro}</div>}
          {orquestradores === null ? (
            <p className="mono text-muted px-2 py-1.5">carregando…</p>
          ) : orquestradores.length === 0 ? (
            <p className="text-support px-2 py-1.5">Nenhum orquestrador ainda.</p>
          ) : (
            orquestradores.map((orquestrador) => {
              const trabalhando = orquestrador.situacao === "trabalhando";
              const aberto = noCanvas.has(orquestrador.id);
              return (
                <button
                  key={orquestrador.id}
                  type="button"
                  className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
                  onClick={() => aoAbrir(orquestrador.id)}
                  title={aberto ? "Ir até o terminal" : "Abrir o terminal no canvas"}
                >
                  <span className="flex items-center gap-2">
                    <span className={`ponto-de-status ${trabalhando ? "ponto-de-status-ativo" : ""}`} />
                    <strong className="truncate font-titulo text-[12px] font-medium">{orquestrador.nome}</strong>
                    {!aberto && <span className="mono ml-auto text-muted">abrir</span>}
                  </span>
                  <span className="flex items-center gap-1 pl-4 mono text-muted">
                    <IconePasta className="shrink-0" />
                    <span className="truncate">{orquestrador.nomeDaPasta}</span>
                    <span className="shrink-0">
                      · {ROTULOS_DOS_MODELOS[orquestrador.configuracao.modeloDoOrquestrador].nome.toLowerCase()} ·{" "}
                      {descreverQuantidade(orquestrador.configuracao.quantidadeDeSubagentes)}
                    </span>
                  </span>
                  {orquestrador.worktree !== null && (
                    <span className="flex items-center pl-4">
                      <EtiquetaDeWorktree worktree={orquestrador.worktree} className="max-w-full" />
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}


interface PropsDoStatus {
  trabalhando: number;
  bixinhosAtivos: number;
  cota: JanelaDaCota[] | null;
  memoria: LeituraDeMemoria | null;
}

const AVISO_DA_MEMORIA = {
  baixa: "Memória baixa: novos pedidos (sobretudo com Opus nos subagentes) podem deixar o computador lento.",
  critica:
    "Memória quase esgotada: espere os pedidos em andamento terminarem, feche programas ou use Haiku/Sonnet nos subagentes.",
} as const;

function descreverMemoria(memoria: LeituraDeMemoria): string {
  return `Livre: ${formatarBytes(memoria.livreBytes)} de ${formatarBytes(memoria.totalBytes)}. Agentes: ${formatarBytes(memoria.agentesBytes)}. Servidor: ${formatarBytes(memoria.servidorBytes)}.`;
}

/** RAM livre do computador e quanto os agentes estão usando, com alerta quando aperta. */
function MedidorDeMemoria({ memoria }: { memoria: LeituraDeMemoria }) {
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
      {formatarBytes(memoria.livreBytes)} livres
      {memoria.agentesBytes > 0 && (
        <span className="status-extra text-muted">· agentes {formatarBytes(memoria.agentesBytes)}</span>
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

/**
 * Abaixo de 1100 px: um só medidor (o uso mais alto entre as cotas e a RAM),
 * com o resto no balão ao passar o mouse.
 */
function ResumoDoStatus({ bixinhosAtivos, cota, memoria }: Omit<PropsDoStatus, "trabalhando">) {
  const leituras: LeituraDoResumo[] = (cota ?? []).map((janela) => ({
    rotulo: rotuloCurtoDaCota(janela.nome),
    uso: janela.utilizacao,
    alto: janela.utilizacao >= COTA_ALTA,
    linha: `${janela.nome}: ${formatarPercentual(janela.utilizacao)}${janela.renovaEm ? ` (renova ${formatarMomento(janela.renovaEm)})` : ""}`,
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
    ...(bixinhosAtivos > 0 ? [`${bixinhosAtivos} ${bixinhosAtivos === 1 ? "agente ativo" : "agentes ativos"}`] : []),
    ...leituras.map((leitura) => leitura.linha),
  ].join("\n");
  return (
    <span
      className={`status-resumo items-center gap-1.5 mono whitespace-nowrap ${leituras.some((leitura) => leitura.alto) ? "text-error" : "text-muted"}`}
      title={dica}
      aria-label={dica}
      role="note"
      tabIndex={0}
      data-testid="resumo-do-status"
    >
      {bixinhosAtivos > 0 && <span className="text-active">{bixinhosAtivos} ativos ·</span>}
      {principal !== null && (
        <>
          {principal.rotulo}
          <span className={`medidor medidor-curto ${principal.alto ? "medidor-alto" : ""}`}>
            <span style={{ width: `${Math.min(100, Math.round(principal.uso * 100))}%` }} />
          </span>
          {formatarPercentual(principal.uso)}
        </>
      )}
    </span>
  );
}

/** Situação, agentes ativos, cotas e RAM: o conteúdo do status, em linha. */
function ConteudoDoStatus({ trabalhando, bixinhosAtivos, cota, memoria }: PropsDoStatus) {
  return (
    <>
      <span className={`etiqueta shrink-0 ${trabalhando > 0 ? "etiqueta-ativa etiqueta-pulso" : ""}`}>
        {trabalhando > 0 ? `${trabalhando} trabalhando` : "todos ociosos"}
      </span>
      {bixinhosAtivos > 0 && (
        <span className="status-detalhe mono text-active whitespace-nowrap">
          {bixinhosAtivos} {bixinhosAtivos === 1 ? "agente ativo" : "agentes ativos"}
        </span>
      )}
      {cota !== null &&
        cota.map((janela) => (
          <span
            key={janela.nome}
            className="status-detalhe flex items-center gap-1.5 mono text-muted whitespace-nowrap"
            title={janela.renovaEm ? `Renova ${formatarMomento(janela.renovaEm)}` : undefined}
          >
            <span className="rotulo-completo">{janela.nome}</span>
            <span className="rotulo-curto">{rotuloCurtoDaCota(janela.nome)}</span>
            <span className={`medidor ${janela.utilizacao >= COTA_ALTA ? "medidor-alto" : ""}`}>
              <span style={{ width: `${Math.min(100, Math.round(janela.utilizacao * 100))}%` }} />
            </span>
            {formatarPercentual(janela.utilizacao)}
          </span>
        ))}
      {memoria !== null && <MedidorDeMemoria memoria={memoria} />}
      <ResumoDoStatus bixinhosAtivos={bixinhosAtivos} cota={cota} memoria={memoria} />
    </>
  );
}

/** Alerta de memória baixa/crítica: abaixo do status (navegador) ou no canto direito do canvas (desktop). */
export function AvisoDeMemoria({ memoria }: { memoria: LeituraDeMemoria | null }) {
  const nivel = memoria === null ? "normal" : nivelDaMemoria(memoria);
  if (nivel === "normal") {
    return null;
  }
  return (
    <div className={`aviso-de-memoria ${nivel === "critica" ? "aviso-de-memoria-critica" : ""}`} role="status">
      ⚠ {AVISO_DA_MEMORIA[nivel]}
    </div>
  );
}

interface PropsDoStatusDoCanvas extends PropsDoStatus {
  /** No desktop, o status vai na barra de título: sem moldura e sem o alerta de memória. */
  naBarraDeTitulo?: boolean;
}

/**
 * Quem está trabalhando agora, a cota da assinatura e a RAM. No navegador, é
 * o painel do canto superior direito; no desktop, fica na barra de título. A
 * largura da janela decide o detalhe (CSS): rótulos curtos abaixo de 1280 px
 * e só a situação com um medidor resumido abaixo de 1100 px.
 */
export function StatusDoCanvas({ naBarraDeTitulo = false, ...status }: PropsDoStatusDoCanvas) {
  if (naBarraDeTitulo) {
    return (
      <div className="status-do-canvas status-na-barra-de-titulo no-drag" data-testid="status-do-canvas">
        <ConteudoDoStatus {...status} />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <div className="status-do-canvas painel-flutuante px-3 py-2" data-testid="status-do-canvas">
        <ConteudoDoStatus {...status} />
      </div>
      <AvisoDeMemoria memoria={status.memoria} />
    </div>
  );
}
