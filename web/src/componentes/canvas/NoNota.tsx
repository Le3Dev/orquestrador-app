import { type NodeProps, NodeResizer } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";

import { api, ErroDaApi, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaNota } from "../../shared/api/tipos";
import { TAMANHO_MINIMO_DA_NOTA } from "../../shared/canvas/layout";
import { ALCA_DA_NOTA, type NoNota as TipoDoNo } from "../../shared/canvas/nos";
import { useAcoesDasNotas, useErroAoCarregarNotas, useLojaDasNotas, useNota } from "../../shared/canvas/notas";
import { escreverPedidoArrastado } from "../../shared/canvas/pedidoArrastado";
import { alternarItem, linhasDaNota } from "../../shared/checklistDaNota";
import { type SituacaoDoSalvamento, useEdicaoDaNota } from "../../shared/hooks/useEdicaoDaNota";
import { rodandoNoDesktop } from "../../shared/ponteDoDesktop";
import { IconeAlerta } from "../Icones";
import { ControlesDoNo } from "./ControlesDoNo";

export const CONFIRMACAO_PARA_APAGAR = "Apagar esta nota? Isso não pode ser desfeito.";
const TAMANHO_MAXIMO_DO_TITULO = 120;
const TAMANHO_MAXIMO_DO_TEXTO = 100_000;

/** A primeira linha com texto: a prévia da nota minimizada. */
function primeiraLinha(texto: string): string {
  return (
    texto
      .split("\n")
      .map((linha) => linha.trim())
      .find((linha) => linha !== "") ?? ""
  );
}

function IconeLixeira() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconeLista() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6.5l1.5 1.5 3-3M4 13.5l1.5 1.5 3-3M11 7h9M11 14h9M5 19.5h.01M11 19.5h9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconeEditar() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14 8l3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Seis pontinhos: o desenho de "pegue aqui para arrastar". */
function IconeDeArrastar() {
  return (
    <svg width={8} height={12} viewBox="0 0 8 12" aria-hidden="true">
      {[2, 6].flatMap((x) => [2, 6, 10].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} fill="currentColor" />))}
    </svg>
  );
}

/**
 * Pega um trecho da nota (uma linha ou o texto todo) para soltar num terminal
 * como pedido. É um arraste do navegador, e não do React Flow: `nodrag` não
 * move a nota, e `nopan` não move o canvas — o canvas cancelaria o arraste.
 * Em branco, não arrasta.
 */
function AlcaDeArraste({ texto, notaId, rotulo, className = "" }: { texto: string; notaId: string; rotulo: string; className?: string }) {
  const temTexto = texto.trim() !== "";
  return (
    <span
      role="img"
      aria-label={rotulo}
      title={temTexto ? `${rotulo}: solte num terminal` : rotulo}
      className={`alca-de-arraste nodrag nopan ${className}`}
      draggable={temTexto}
      onDragStart={(evento) => {
        if (!temTexto) {
          evento.preventDefault();
          return;
        }
        escreverPedidoArrastado(evento.dataTransfer, { texto, notaId });
      }}
    >
      <IconeDeArrastar />
    </span>
  );
}

type ModoDaNota = "editar" | "lista";

/**
 * O texto da nota linha a linha: as linhas de checklist (`[ ]`, `[x]`) viram
 * caixas de marcar, e cada linha com texto pode ser arrastada até um terminal.
 */
function ListaDaNota({
  texto,
  notaId,
  aoAlternar,
}: {
  texto: string;
  notaId: string;
  aoAlternar: (indiceDaLinha: number) => void;
}) {
  if (texto.trim() === "") {
    return (
      <p className="lista-da-nota lista-da-nota-vazia nodrag nowheel nopan">Nota vazia. Clique em editar para escrever.</p>
    );
  }
  return (
    <ul className="lista-da-nota custom-scrollbar nodrag nowheel nopan" aria-label="Linhas da nota">
      {linhasDaNota(texto).map((linha, indice) => {
        if (linha.tipo === "vazia") {
          // A posição na lista é o índice da linha no texto: é o que o checklist reescreve.
          return <li key={indice} className="linha-da-nota linha-da-nota-vazia" aria-hidden="true" />;
        }
        return (
          <li key={indice} className="linha-da-nota">
            <AlcaDeArraste texto={linha.texto} notaId={notaId} rotulo="Arrastar esta linha como pedido" />
            {linha.tipo === "item" ? (
              <label className="item-da-nota">
                <input type="checkbox" checked={linha.marcado} onChange={() => aoAlternar(indice)} />
                <span className={`texto-da-linha ${linha.marcado ? "item-da-nota-marcado" : ""}`}>{linha.texto}</span>
              </label>
            ) : (
              <span className="texto-da-linha">{linha.texto}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** As alças de redimensionar. Memorizadas: o arraste não as re-renderiza a cada quadro. */
const RedimensionadorDaNota = memo(function RedimensionadorDaNota({ visivel }: { visivel: boolean }) {
  return (
    <NodeResizer
      isVisible={visivel}
      minWidth={TAMANHO_MINIMO_DA_NOTA.largura}
      minHeight={TAMANHO_MINIMO_DA_NOTA.altura}
      lineClassName="redimensionador-linha"
      handleClassName="redimensionador-alca"
    />
  );
});

/**
 * Uma nota no canvas: um bloco de notas que se arrasta pela barra de título,
 * se redimensiona pelas bordas quando selecionado e se minimiza à barra.
 *
 * Como no terminal, aqui fica só a moldura (o React Flow re-renderiza o nó a
 * cada quadro do arraste); o conteúdo está na `JanelaDaNota`, memorizada.
 */
export const NoNota = memo(function NoNota({ data, selected }: NodeProps<TipoDoNo>) {
  return (
    <>
      <RedimensionadorDaNota visivel={selected && !data.minimizada} />
      <JanelaDaNota notaId={data.notaId} minimizada={data.minimizada} />
    </>
  );
});

interface PropsDaJanela {
  notaId: string;
  minimizada: boolean;
}

/** Espera o conteúdo da nota chegar do servidor; daí em diante, quem manda é o editor. */
const JanelaDaNota = memo(function JanelaDaNota({ notaId, minimizada }: PropsDaJanela) {
  const nota = useNota(notaId);
  const erroAoCarregar = useErroAoCarregarNotas();

  if (nota === undefined) {
    return (
      <div className={`janela-nota ${minimizada ? "janela-nota-minimizada" : ""}`}>
        <div className={`barra-da-nota ${ALCA_DA_NOTA}`}>
          <span className="titulo-da-nota text-muted">nota</span>
        </div>
        {!minimizada && (
          <p className={`mono texto-longo px-3 py-2 ${erroAoCarregar === null ? "text-muted" : "text-error"}`}>
            {erroAoCarregar === null ? "carregando nota…" : `✗ Não foi possível carregar a nota. ${erroAoCarregar}`}
          </p>
        )}
      </div>
    );
  }

  return <EditorDaNota inicial={nota} minimizada={minimizada} />;
});

function IndicadorDeSalvamento({
  situacao,
  aoTentarDeNovo,
}: {
  situacao: SituacaoDoSalvamento;
  aoTentarDeNovo: () => void;
}) {
  if (situacao === "erro") {
    return (
      <button type="button" className="botao-de-texto text-error nodrag" onClick={aoTentarDeNovo}>
        erro ao salvar — tentar de novo
      </button>
    );
  }
  return <span className="text-muted">{situacao === "salvo" ? "salvo" : "salvando…"}</span>;
}

/** Campo do título, aberto no clique duplo. Enter confirma; Esc desiste. */
function CampoDoTitulo({ titulo, aoConcluir }: { titulo: string; aoConcluir: (novo: string | null) => void }) {
  const campo = useRef<HTMLInputElement>(null);
  const desistiu = useRef(false);

  useEffect(() => {
    // Sem rolar: o foco num elemento do canvas faria o navegador deslocá-lo.
    campo.current?.focus({ preventScroll: true });
    campo.current?.select();
  }, []);

  return (
    <input
      ref={campo}
      className="campo-do-titulo-da-nota nodrag"
      aria-label="Título da nota"
      defaultValue={titulo}
      placeholder="Sem título"
      maxLength={TAMANHO_MAXIMO_DO_TITULO}
      onKeyDown={(evento) => {
        if (evento.key === "Enter") {
          evento.currentTarget.blur();
        } else if (evento.key === "Escape") {
          desistiu.current = true;
          evento.currentTarget.blur();
        }
      }}
      onBlur={(evento) => aoConcluir(desistiu.current ? null : evento.currentTarget.value)}
    />
  );
}

interface PropsDoEditor {
  inicial: DadosDaNota;
  minimizada: boolean;
}

/**
 * O título e o texto em edição. O texto fica no estado daqui, e não no canvas:
 * digitar re-renderiza só esta nota.
 *
 * Dois modos: "editar" (o texto puro, no campo) e "lista" (linha a linha, com
 * os itens de checklist marcáveis e cada linha arrastável até um terminal).
 */
function ConteudoDoEditor({ inicial, minimizada }: PropsDoEditor) {
  const loja = useLojaDasNotas();
  const acoes = useAcoesDasNotas();
  const notaId = inicial.id;
  const edicao = useEdicaoDaNota(inicial, loja.guardar);
  const [editandoTitulo, setEditandoTitulo] = useState(false);
  // Fica no estado da nota: sobrevive a minimizar e restaurar, mas não a recarregar a página.
  const [modo, setModo] = useState<ModoDaNota>("editar");
  const [apagando, setApagando] = useState(false);
  const [erroAoApagar, setErroAoApagar] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  // Recém-criada pelo "+ notas": já dá para escrever.
  useEffect(() => {
    if (loja.consumirFoco(notaId)) {
      campo.current?.focus({ preventScroll: true });
    }
  }, [loja, notaId]);

  // Fechar a aba logo depois de digitar perderia o que ainda não foi gravado.
  // Só enquanto há gravação pendente: salva na hora e, no navegador, pede
  // confirmação. No app desktop não bloqueia (o Electron cancelaria o
  // fechamento sem perguntar nada): só salva na hora, também no pagehide.
  const gravacaoPendente = edicao.situacao !== "salvo";
  const { salvarAgora } = edicao;
  useEffect(() => {
    if (!gravacaoPendente) {
      return;
    }
    const noDesktop = rodandoNoDesktop();
    const aoSair = (evento: BeforeUnloadEvent) => {
      salvarAgora();
      if (!noDesktop) {
        evento.preventDefault();
        // Navegadores antigos só perguntam com o returnValue preenchido.
        evento.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", aoSair);
    if (noDesktop) {
      window.addEventListener("pagehide", salvarAgora);
    }
    return () => {
      window.removeEventListener("beforeunload", aoSair);
      window.removeEventListener("pagehide", salvarAgora);
    };
  }, [gravacaoPendente, salvarAgora]);

  /** Marcar ou desmarcar um item reescreve o texto e salva na hora, como ao perder o foco. */
  function alternarItemDaLista(indiceDaLinha: number): void {
    const novo = alternarItem(edicao.texto, indiceDaLinha);
    if (novo !== edicao.texto) {
      edicao.mudarTexto(novo);
      edicao.salvarAgora();
    }
  }

  function concluirTitulo(novo: string | null): void {
    if (novo !== null) {
      edicao.renomear(novo);
    }
    setEditandoTitulo(false);
  }

  async function apagar(): Promise<void> {
    if (!window.confirm(CONFIRMACAO_PARA_APAGAR)) {
      return;
    }
    setErroAoApagar(null);
    setApagando(true);
    try {
      await api.removerNota(notaId);
    } catch (falha) {
      // Já apagada (em outra aba, por exemplo): basta tirá-la do canvas.
      if (!(falha instanceof ErroDaApi && falha.status === 404)) {
        setErroAoApagar(`Não foi possível apagar a nota: ${mensagemDeErro(falha)}`);
        setApagando(false);
        return;
      }
    }
    edicao.descartarPendencias();
    acoes.notaApagada(notaId);
  }

  const problema = edicao.situacao === "erro" ? `Erro ao salvar: ${edicao.erro ?? ""}` : erroAoApagar;

  // A nota só minimiza: apagar (a lixeira) é outra ação, e ela não tem tela cheia nem um "fechar" que a tire do canvas sem apagar.
  const controlesDaJanela = {
    objeto: "a nota",
    aoMinimizar: () => acoes.minimizarOuRestaurar(notaId),
    minimizada,
  };

  return (
    <div className={`janela-nota ${minimizada ? "janela-nota-minimizada" : ""}`}>
      <div className={`barra-da-nota ${ALCA_DA_NOTA}`}>
        <ControlesDoNo lado="inicio" {...controlesDaJanela} />
        {editandoTitulo ? (
          <CampoDoTitulo titulo={edicao.titulo} aoConcluir={concluirTitulo} />
        ) : (
          <strong
            className="titulo-da-nota"
            title="Clique duplo para renomear"
            onDoubleClick={() => setEditandoTitulo(true)}
          >
            {edicao.titulo || "Sem título"}
          </strong>
        )}
        {minimizada ? (
          <span className="previa-da-nota" data-testid="previa-da-nota">
            {primeiraLinha(edicao.texto)}
          </span>
        ) : (
          <>
            <span className="flex-1" />
            <AlcaDeArraste
              texto={edicao.texto}
              notaId={notaId}
              rotulo="Arrastar a nota inteira como pedido"
              className="alca-de-arraste-da-nota"
            />
            <button
              type="button"
              className="botao-icone nodrag"
              title={modo === "editar" ? "Ver como lista (marcar itens e arrastar linhas)" : "Editar o texto"}
              aria-label={modo === "editar" ? "Ver como lista" : "Editar o texto"}
              onClick={() => setModo(modo === "editar" ? "lista" : "editar")}
            >
              {modo === "editar" ? <IconeLista /> : <IconeEditar />}
            </button>
          </>
        )}
        {/* Minimizada, o rodapé some: o problema aparece aqui, e clicar restaura a nota para resolvê-lo. */}
        {minimizada && problema !== null && (
          <button
            type="button"
            className="botao-icone nodrag text-error"
            title={`${problema} Clique para abrir a nota.`}
            aria-label="Ver o problema da nota"
            onClick={() => acoes.minimizarOuRestaurar(notaId)}
          >
            <IconeAlerta tamanho={16} />
          </button>
        )}
        <button
          type="button"
          className="botao-icone botao-icone-perigo nodrag"
          title="Apagar a nota"
          aria-label="Apagar a nota"
          disabled={apagando}
          onClick={() => void apagar()}
        >
          <IconeLixeira />
        </button>
        <ControlesDoNo lado="fim" {...controlesDaJanela} />
      </div>

      {!minimizada && (
        <>
          {modo === "editar" ? (
            <textarea
              ref={campo}
              className="texto-da-nota custom-scrollbar nodrag nowheel nopan"
              aria-label="Texto da nota"
              placeholder="Escreva aqui…"
              value={edicao.texto}
              maxLength={TAMANHO_MAXIMO_DO_TEXTO}
              onChange={(evento) => edicao.mudarTexto(evento.target.value)}
              onBlur={edicao.salvarAgora}
            />
          ) : (
            <ListaDaNota texto={edicao.texto} notaId={notaId} aoAlternar={alternarItemDaLista} />
          )}
          <div className="rodape-da-nota">
            <IndicadorDeSalvamento situacao={edicao.situacao} aoTentarDeNovo={edicao.salvarAgora} />
            {edicao.situacao === "erro" && edicao.erro !== null && <span className="text-error">{edicao.erro}</span>}
            {erroAoApagar !== null && <span className="text-error">{erroAoApagar}</span>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * `inicial` só vale na montagem: depois, a tela mostra a edição, e a versão
 * salva que volta do servidor (a cada salvamento) não precisa re-renderizar.
 */
const EditorDaNota = memo(
  ConteudoDoEditor,
  (antes, depois) => antes.inicial.id === depois.inicial.id && antes.minimizada === depois.minimizada,
);
