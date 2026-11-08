import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../shared/api/cliente";
import type { MensagemParaOShell } from "../../shared/api/tipos";
import { useAcoesDoCanvas } from "../../shared/canvas/contexto";
import { TAMANHO_MINIMO_DO_SHELL } from "../../shared/canvas/layout";
import { ALCA_DO_SHELL, type Ancora, type NoShell as TipoDoNo } from "../../shared/canvas/nos";
import { escreverNoPromptDoTerminal } from "../../shared/canvas/promptsDosTerminais";
import {
  enderecoDoWebSocket,
  lerMensagemDoShell,
  LINHAS_PARA_O_ORQUESTRADOR,
  nomeCurtoDaPasta,
  textoParaOOrquestrador,
  useAcoesDosShells,
} from "../../shared/canvas/shells";
import { IconeFechar, IconeOrquestrador, IconePasta, IconeShell } from "../Icones";

/**
 * Quanto esperar antes de conferir se o terminal ainda existe e religar,
 * depois que a conexão cai: a primeira vez na hora, depois cada vez mais
 * devagar (o último valor se repete enquanto o servidor estiver fora).
 */
const ESPERAS_PARA_RELIGAR_MS = [0, 1_000, 2_000, 5_000] as const;

/** As alças de redimensionar. Memorizadas: o arraste não as re-renderiza a cada quadro. */
const RedimensionadorDoShell = memo(function RedimensionadorDoShell({ visivel }: { visivel: boolean }) {
  return (
    <NodeResizer
      isVisible={visivel}
      minWidth={TAMANHO_MINIMO_DO_SHELL.largura}
      minHeight={TAMANHO_MINIMO_DO_SHELL.altura}
      lineClassName="redimensionador-linha"
      handleClassName="redimensionador-alca"
    />
  );
});

/** Onde chega a linha do Orquestrador de que o shell saiu: o meio de cada lado, como na prévia. */
const ANCORAS_DO_SHELL: readonly { id: Ancora; posicao: Position }[] = [
  { id: "cima", posicao: Position.Top },
  { id: "baixo", posicao: Position.Bottom },
  { id: "esquerda", posicao: Position.Left },
  { id: "direita", posicao: Position.Right },
];

const AncorasDoShell = memo(function AncorasDoShell() {
  return (
    <>
      {ANCORAS_DO_SHELL.map(({ id, posicao }) => (
        <Handle key={id} id={id} type="target" position={posicao} className="ancora" isConnectable={false} />
      ))}
    </>
  );
});

/**
 * O bloco "Terminal": um shell de verdade (o do computador) no canvas, numa
 * pasta escolhida ou na de um Orquestrador. Arrasta pela barra de título e
 * redimensiona pelas bordas quando selecionado; o terminal se ajusta ao
 * tamanho do bloco.
 *
 * Aqui fica só a moldura (o React Flow re-renderiza o nó a cada quadro do
 * arraste); a janela é memorizada, e o terminal não reconecta ao mover.
 */
export const NoShell = memo(function NoShell({ data, selected }: NodeProps<TipoDoNo>) {
  return (
    <>
      <RedimensionadorDoShell visivel={selected} />
      <AncorasDoShell />
      <JanelaDoShell
        shellId={data.shellId}
        terminalId={data.terminalId}
        pasta={data.pasta}
        orquestradorId={data.orquestradorId}
      />
    </>
  );
});

type SituacaoDoShell =
  | { tipo: "conectando" }
  | { tipo: "conectado" }
  | { tipo: "reconectando" }
  | { tipo: "encerrado"; codigo: number | null };

const CONECTANDO: SituacaoDoShell = { tipo: "conectando" };

/** A fonte mono e as cores do app, lidas das variáveis do tema (com o valor delas como reserva). */
function aparenciaDoApp(): { fonte: string; tema: ITheme } {
  const estilo = getComputedStyle(document.documentElement);
  const ler = (variavel: string, reserva: string): string => estilo.getPropertyValue(variavel).trim() || reserva;
  const fundo = ler("--surface", "#1c1c1a");
  return {
    fonte: ler("--fonte-mono", '"JetBrains Mono", Consolas, "Courier New", monospace'),
    tema: {
      background: fundo,
      foreground: ler("--claude-claro", "#faf9f5"),
      cursor: ler("--claude-laranja", "#d97757"),
      cursorAccent: fundo,
      selectionBackground: "rgba(106, 155, 204, 0.4)",
    },
  };
}

/** As linhas do buffer do terminal, com as quebradas pela largura juntadas de volta. */
function linhasDoBuffer(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const linhas: string[] = [];
  for (let indice = 0; indice < buffer.length; indice++) {
    const linha = buffer.getLine(indice);
    if (linha === undefined) {
      continue;
    }
    const texto = linha.translateToString(true);
    if (linha.isWrapped && linhas.length > 0) {
      linhas.push(`${linhas.pop() ?? ""}${texto}`);
    } else {
      linhas.push(texto);
    }
  }
  return linhas;
}

interface PropsDaJanela {
  shellId: string;
  terminalId: string;
  pasta: string;
  orquestradorId: string | null;
}

const JanelaDoShell = memo(function JanelaDoShell({ shellId, terminalId, pasta, orquestradorId }: PropsDaJanela) {
  const acoesDoCanvas = useAcoesDoCanvas();
  const acoes = useAcoesDosShells();
  const quadro = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [situacao, setSituacao] = useState<SituacaoDoShell>(CONECTANDO);
  const [terminalAnterior, setTerminalAnterior] = useState(terminalId);

  // Aberto de novo (outro terminal no servidor, no mesmo bloco): começa conectando.
  if (terminalId !== terminalAnterior) {
    setTerminalAnterior(terminalId);
    setSituacao(CONECTANDO);
  }

  useEffect(() => {
    const elemento = quadro.current;
    if (elemento === null) {
      return undefined;
    }
    const { fonte, tema } = aparenciaDoApp();
    const xterm = new Terminal({
      fontFamily: fonte,
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5_000,
      theme: tema,
    });
    const ajuste = new FitAddon();
    xterm.loadAddon(ajuste);
    xterm.open(elemento);
    terminal.current = xterm;

    let socket: WebSocket | null = null;
    let encerrado = false;
    let desmontado = false;
    let jaConectou = false;
    let tentativas = 0;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    let quadroPendente: number | undefined;

    const enviar = (mensagem: MensagemParaOShell): void => {
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(mensagem));
      }
    };

    const ajustar = (): void => {
      try {
        ajuste.fit();
      } catch {
        // Ainda sem tamanho (o bloco acabou de entrar na página): o próximo ajuste resolve.
      }
    };

    const encerrar = (codigo: number | null): void => {
      encerrado = true;
      setSituacao({ tipo: "encerrado", codigo });
    };

    // Uma tecla, um colar: vai para o shell. O tamanho novo (o bloco mudou) também.
    const entrada = xterm.onData((dados) => enviar({ tipo: "entrada", dados }));
    const redimensionamento = xterm.onResize(({ cols, rows }) => enviar({ tipo: "tamanho", colunas: cols, linhas: rows }));

    function conectar(): void {
      const conexao = new WebSocket(enderecoDoWebSocket(api.enderecoDaConexaoDoShell(terminalId), window.location));
      socket = conexao;
      conexao.onopen = () => {
        tentativas = 0;
        // Religando: o servidor reenvia o histórico recente, que já estava na tela.
        if (jaConectou) {
          xterm.reset();
        }
        jaConectou = true;
        setSituacao({ tipo: "conectado" });
        ajustar();
        enviar({ tipo: "tamanho", colunas: xterm.cols, linhas: xterm.rows });
      };
      conexao.onmessage = (evento: MessageEvent) => {
        const mensagem = lerMensagemDoShell(evento.data);
        if (mensagem?.tipo === "saida") {
          xterm.write(mensagem.dados);
        } else if (mensagem?.tipo === "fim") {
          encerrar(mensagem.codigo);
        }
      };
      conexao.onclose = () => {
        if (socket !== conexao) {
          return;
        }
        socket = null;
        if (encerrado || desmontado) {
          return;
        }
        setSituacao({ tipo: "reconectando" });
        agendarVerificacao();
      };
    }

    /** A conexão caiu: se o terminal ainda está no servidor, religa; se não, ele encerrou. */
    function agendarVerificacao(): void {
      const espera = ESPERAS_PARA_RELIGAR_MS[Math.min(tentativas, ESPERAS_PARA_RELIGAR_MS.length - 1)] ?? 0;
      tentativas++;
      relogio = setTimeout(() => {
        api
          .listarShells()
          .then((vivos) => {
            if (desmontado || encerrado) {
              return;
            }
            if (vivos.some((vivo) => vivo.id === terminalId)) {
              conectar();
            } else {
              encerrar(null);
            }
          })
          .catch(() => {
            // Servidor fora: tenta de novo, mais devagar.
            if (!desmontado && !encerrado) {
              agendarVerificacao();
            }
          });
      }, espera);
    }

    // O bloco mudou de tamanho (redimensionar, minimizar a janela): o terminal acompanha.
    const observador =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (quadroPendente !== undefined) {
              cancelAnimationFrame(quadroPendente);
            }
            quadroPendente = requestAnimationFrame(() => {
              quadroPendente = undefined;
              ajustar();
            });
          });
    observador?.observe(elemento);
    // A fonte mono pode chegar depois: com ela, a medida das letras muda.
    void document.fonts?.ready.then(() => {
      if (!desmontado) {
        ajustar();
      }
    });

    ajustar();
    conectar();

    return () => {
      desmontado = true;
      clearTimeout(relogio);
      if (quadroPendente !== undefined) {
        cancelAnimationFrame(quadroPendente);
      }
      observador?.disconnect();
      entrada.dispose();
      redimensionamento.dispose();
      const aberta = socket;
      socket = null;
      aberta?.close();
      xterm.dispose();
      terminal.current = null;
    };
  }, [terminalId]);

  /**
   * Leva ao prompt do Orquestrador ligado a seleção do terminal (ou, sem ela,
   * as últimas linhas), num bloco de código. Só escreve: quem envia é o
   * usuário. Com o terminal do Orquestrador fechado, ele abre com o texto.
   */
  const enviarAoOrquestrador = useCallback(() => {
    const xterm = terminal.current;
    if (xterm === null || orquestradorId === null) {
      return;
    }
    const texto = textoParaOOrquestrador(xterm.hasSelection() ? xterm.getSelection() : "", linhasDoBuffer(xterm));
    if (texto === null) {
      return;
    }
    if (!escreverNoPromptDoTerminal(orquestradorId, texto)) {
      acoesDoCanvas.abrirTerminal(orquestradorId);
    }
  }, [acoesDoCanvas, orquestradorId]);

  const encerrado = situacao.tipo === "encerrado";

  return (
    <div className="janela-shell">
      <div className={`barra-do-shell ${ALCA_DO_SHELL}`}>
        <IconeShell className="shrink-0 text-success" />
        <strong className="font-titulo text-[12.5px] font-semibold">Terminal</strong>
        <span className="flex min-w-0 items-center gap-1 mono text-muted" title={pasta}>
          <IconePasta className="shrink-0" />
          <span className="truncate">{nomeCurtoDaPasta(pasta)}</span>
        </span>
        <span className="flex-1" />
        {situacao.tipo === "conectando" && <span className="mono shrink-0 text-muted">conectando…</span>}
        {situacao.tipo === "reconectando" && <span className="mono shrink-0 text-error">reconectando…</span>}
        {encerrado && <span className="chip shrink-0">encerrado</span>}
        {orquestradorId !== null && (
          <button
            type="button"
            className="botao-icone nodrag"
            title={`Enviar ao orquestrador: a seleção (ou as últimas ${LINHAS_PARA_O_ORQUESTRADOR} linhas) vai para o prompt dele, sem enviar`}
            aria-label="Enviar ao orquestrador"
            onClick={enviarAoOrquestrador}
          >
            <IconeOrquestrador tamanho={15} />
          </button>
        )}
        <button
          type="button"
          className="botao-icone nodrag"
          title="Fechar o terminal (encerra o shell)"
          aria-label="Fechar este terminal"
          onClick={() => acoes.fecharShell(shellId)}
        >
          <IconeFechar tamanho={14} />
        </button>
      </div>
      <div className="corpo-do-shell">
        {/* nowheel: a roda do mouse rola o terminal, não o canvas; nodrag: o mouse seleciona texto. */}
        <div ref={quadro} className="quadro-do-shell nodrag nowheel" />
        {encerrado && (
          <div className="aviso-do-shell nodrag" role="status">
            <span className="mono">
              {situacao.codigo === null ? "o shell encerrou" : `o shell encerrou (código ${situacao.codigo})`}
            </span>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => acoes.reabrirShell(shellId)}>
              abrir de novo
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
