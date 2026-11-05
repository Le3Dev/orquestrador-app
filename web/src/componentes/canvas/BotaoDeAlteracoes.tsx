import { useCallback, useEffect, useRef, useState } from "react";

import {
  apiDeAlteracoes,
  type ConsultaDasAlteracoes,
  TEXTO_SEM_ALTERACOES,
  TEXTO_SEM_GIT,
  textoDosCommitsNaBranch,
} from "../../shared/api/alteracoes";
import { mensagemDeErro } from "../../shared/api/cliente";
import type { ResumoDoOrquestrador } from "../../shared/api/tipos";
import { useCanvas } from "../../shared/canvas/contexto";
import type { EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import { PainelDeAlteracoes } from "./PainelDeAlteracoes";

/**
 * Se o Orquestrador está num pedido agora. A conversa (eventos ao vivo) manda,
 * como na janela do terminal; sem pedidos nela, vale o resumo do servidor.
 */
function estaTrabalhando(conversa: EstadoDaConversa | undefined, resumo: ResumoDoOrquestrador | undefined): boolean {
  const ultimoTurno = conversa?.turnos.at(-1);
  if (ultimoTurno !== undefined) {
    return ultimoTurno.situacao === "em_andamento";
  }
  return resumo?.situacao === "trabalhando";
}

/**
 * Lê as alterações do worktree quando pedido. Só a resposta do último pedido
 * vale: uma lenta que chega depois de outra mais nova é descartada.
 */
function useAlteracoesDoWorktree(orquestradorId: string) {
  const [consulta, setConsulta] = useState<ConsultaDasAlteracoes>({ alteracoes: null, carregando: true, erro: null });
  const ultimoPedido = useRef(0);

  const atualizar = useCallback(async (): Promise<void> => {
    ultimoPedido.current += 1;
    const pedido = ultimoPedido.current;
    setConsulta((atual) => (atual.carregando ? atual : { ...atual, carregando: true }));
    try {
      const alteracoes = await apiDeAlteracoes.consultar(orquestradorId);
      if (pedido === ultimoPedido.current) {
        setConsulta({ alteracoes, carregando: false, erro: null });
      }
    } catch (falha) {
      if (pedido === ultimoPedido.current) {
        setConsulta({ alteracoes: null, carregando: false, erro: mensagemDeErro(falha) });
      }
    }
  }, [orquestradorId]);

  return { consulta, atualizar };
}

function tituloDoBotao(consulta: ConsultaDasAlteracoes): string {
  const { alteracoes, erro } = consulta;
  if (erro !== null) {
    return `Alterações do worktree: ${erro} Clique para tentar de novo.`;
  }
  if (alteracoes === null) {
    return "Alterações do worktree: lendo…";
  }
  if (alteracoes.situacao === "sem_git") {
    return TEXTO_SEM_GIT;
  }
  const quantidade = alteracoes.arquivos.length;
  if (quantidade === 0) {
    return [TEXTO_SEM_ALTERACOES, textoDosCommitsNaBranch(alteracoes)].filter((texto) => texto !== null).join(" ");
  }
  const arquivos = quantidade === 1 ? "1 arquivo alterado" : `${quantidade} arquivos alterados`;
  return `Alterações do worktree: ${arquivos} na branch ${alteracoes.branch ?? "?"} (ver a lista e o diff)`;
}

/** Arquivo com linhas a mais e a menos: o ícone das alterações. */
function IconeDeAlteracoes({ className = "" }: { className?: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 3.5h8l4.5 4.5v12a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 8.5v5M9.5 11h5M9.5 16.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * "Alterações", na barra do terminal: mostra quantos arquivos o Orquestrador
 * deixou por commitar no worktree e abre o painel com a lista e o diff de
 * cada um. Só leitura.
 *
 * Lê a lista ao montar, quando um pedido termina (trabalhando → ocioso) e ao
 * abrir o painel — nunca a cada evento do Claude (ADR-11). Sem nada para
 * mostrar, fica esmaecido; com falha na leitura, continua clicável e o erro
 * vai no `title`.
 */
export function BotaoDeAlteracoes({ orquestradorId }: { orquestradorId: string }) {
  const { conversas, orquestradores } = useCanvas();
  const resumo = orquestradores.get(orquestradorId);
  const trabalhando = estaTrabalhando(conversas.get(orquestradorId), resumo);
  const { consulta, atualizar } = useAlteracoesDoWorktree(orquestradorId);
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const estavaTrabalhando = useRef(trabalhando);

  useEffect(() => {
    void atualizar();
  }, [atualizar]);

  // Só a virada de trabalhando para ocioso: o pedido acabou e o worktree pode ter mudado.
  useEffect(() => {
    if (estavaTrabalhando.current && !trabalhando) {
      void atualizar();
    }
    estavaTrabalhando.current = trabalhando;
  }, [trabalhando, atualizar]);

  const aoAtualizar = useCallback(() => void atualizar(), [atualizar]);

  const aoFechar = useCallback(() => {
    setAberto(false);
    botao.current?.focus({ preventScroll: true });
  }, []);

  const { alteracoes, erro } = consulta;
  const quantidade = alteracoes?.arquivos.length ?? 0;
  const temOQueMostrar =
    erro !== null || (alteracoes !== null && (quantidade > 0 || textoDosCommitsNaBranch(alteracoes) !== null));

  return (
    <>
      <button
        ref={botao}
        type="button"
        className="botao-icone nodrag relative"
        aria-label="Alterações do worktree"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title={tituloDoBotao(consulta)}
        disabled={!temOQueMostrar}
        onClick={() => {
          setAberto(true);
          void atualizar();
        }}
      >
        {/* A cor vai no ícone: a do `.botao-icone` vence os utilitários. */}
        <IconeDeAlteracoes className={erro !== null ? "text-error" : ""} />
        {quantidade > 0 && (
          <span
            data-testid="contagem-de-alteracoes"
            className="absolute -top-1 -right-1.5 min-w-[15px] rounded-full bg-active px-1 text-center font-mono text-[9.5px] leading-[15px] font-semibold text-screen-bg"
          >
            {quantidade > 99 ? "99+" : quantidade}
          </span>
        )}
      </button>
      {aberto && (
        <PainelDeAlteracoes
          orquestradorId={orquestradorId}
          nomeDoOrquestrador={resumo?.nome}
          consulta={consulta}
          aoAtualizar={aoAtualizar}
          aoFechar={aoFechar}
        />
      )}
    </>
  );
}
