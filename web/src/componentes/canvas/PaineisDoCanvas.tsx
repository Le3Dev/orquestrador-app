import { useEffect, useState } from "react";

import type { JanelaDaCota, LeituraDeMemoria, ResumoDoOrquestrador } from "../../shared/api/tipos";
import {
  descreverQuantidade,
  formatarBytes,
  formatarDuracao,
  formatarMomento,
  formatarPercentual,
  ROTULOS_DOS_MODELOS,
} from "../../shared/formatacao";
import { useRelogio } from "../../shared/hooks/useRelogio";
import type { EstadoDoServidor } from "../../shared/hooks/useServidor";
import { nivelDaMemoria } from "../../shared/memoria";
import { EtiquetaDeWorktree } from "../EtiquetaDeWorktree";
import { IconeOrquestrador, IconePasta } from "../Icones";

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
            para subir: abra iniciar-orquestrador.cmd, ou rode npm start na pasta orquestrador-agentes-app
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

/** Canto superior esquerdo: identidade do app e as ações do canvas. */
export function BarraDoCanvas({ aoCriar, aoCriarNota, aoOrganizar, podeOrganizar }: PropsDaBarra) {
  return (
    <div className="painel-flutuante flex items-center gap-3 px-3 py-2">
      <div className="no-orquestrador-icone h-8 w-8">
        <IconeOrquestrador tamanho={18} />
      </div>
      <div className="flex flex-col leading-tight">
        <h1 className="text-[14px]">Orquestrador de agentes</h1>
        <span className="mono text-muted">claude code · canvas · local</span>
      </div>
      <span className="mx-1 h-8 w-px bg-border" />
      <button type="button" className="btn btn-sm btn-cta" onClick={aoCriar}>
        + Novo orquestrador
      </button>
      <button
        type="button"
        className="btn btn-sm btn-cta"
        onClick={aoCriarNota}
        title="Cria uma nota no centro da tela (bloco de notas, salvo automaticamente)"
      >
        + notas
      </button>
      <button
        type="button"
        className="btn btn-sm btn-outline"
        onClick={aoOrganizar}
        disabled={!podeOrganizar}
        title="Coloca os terminais lado a lado, e as notas em colunas à direita deles"
      >
        Organizar
      </button>
    </div>
  );
}

/** Falha numa ação do canvas (ex.: criar uma nota), logo abaixo da barra. */
export function ErroDoCanvas({ erro, aoFechar }: { erro: string; aoFechar: () => void }) {
  return (
    <div className="alert alert-error mt-2 flex max-w-md items-start gap-2" role="alert">
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

/** RAM livre do computador e quanto os agentes estão usando, com alerta quando aperta. */
function MedidorDeMemoria({ memoria }: { memoria: LeituraDeMemoria }) {
  const nivel = nivelDaMemoria(memoria);
  const usada = 1 - memoria.livreBytes / memoria.totalBytes;
  return (
    <span
      className={`flex items-center gap-1.5 mono ${nivel === "normal" ? "text-muted" : nivel === "baixa" ? "text-warning" : "text-error"}`}
      title={`Livre: ${formatarBytes(memoria.livreBytes)} de ${formatarBytes(memoria.totalBytes)}. Agentes: ${formatarBytes(memoria.agentesBytes)}. Servidor: ${formatarBytes(memoria.servidorBytes)}.`}
    >
      RAM
      <span className={`medidor ${nivel === "normal" ? "" : "medidor-alto"}`}>
        <span style={{ width: `${Math.round(usada * 100)}%` }} />
      </span>
      {formatarBytes(memoria.livreBytes)} livres
      {memoria.agentesBytes > 0 && <span className="text-muted">· agentes {formatarBytes(memoria.agentesBytes)}</span>}
    </span>
  );
}

/** Canto superior direito: quem está trabalhando agora e a cota da assinatura. */
export function StatusDoCanvas({ trabalhando, bixinhosAtivos, cota, memoria }: PropsDoStatus) {
  const nivel = memoria === null ? "normal" : nivelDaMemoria(memoria);
  return (
    <div className="flex flex-col items-end gap-2">
    <div className="painel-flutuante flex items-center gap-4 px-3 py-2">
      <span className={`etiqueta ${trabalhando > 0 ? "etiqueta-ativa etiqueta-pulso" : ""}`}>
        {trabalhando > 0 ? `${trabalhando} trabalhando` : "todos ociosos"}
      </span>
      {bixinhosAtivos > 0 && (
        <span className="mono text-active">
          {bixinhosAtivos} {bixinhosAtivos === 1 ? "agente ativo" : "agentes ativos"}
        </span>
      )}
      {cota !== null &&
        cota.map((janela) => (
          <span
            key={janela.nome}
            className="flex items-center gap-1.5 mono text-muted"
            title={janela.renovaEm ? `Renova ${formatarMomento(janela.renovaEm)}` : undefined}
          >
            {janela.nome}
            <span className={`medidor ${janela.utilizacao >= COTA_ALTA ? "medidor-alto" : ""}`}>
              <span style={{ width: `${Math.min(100, Math.round(janela.utilizacao * 100))}%` }} />
            </span>
            {formatarPercentual(janela.utilizacao)}
          </span>
        ))}
      {memoria !== null && <MedidorDeMemoria memoria={memoria} />}
    </div>
    {nivel !== "normal" && (
      <div className={`aviso-de-memoria ${nivel === "critica" ? "aviso-de-memoria-critica" : ""}`} role="status">
        ⚠ {AVISO_DA_MEMORIA[nivel]}
      </div>
    )}
    </div>
  );
}
