import { type NodeProps, NodeResizer } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";

import { api, ErroDaApi, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaNota } from "../../shared/api/tipos";
import { TAMANHO_MINIMO_DA_NOTA } from "../../shared/canvas/layout";
import { ALCA_DA_NOTA, type NoNota as TipoDoNo } from "../../shared/canvas/nos";
import { useAcoesDasNotas, useErroAoCarregarNotas, useLojaDasNotas, useNota } from "../../shared/canvas/notas";
import { type SituacaoDoSalvamento, useEdicaoDaNota } from "../../shared/hooks/useEdicaoDaNota";

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

function IconeMinimizar() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 17h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconeRestaurar() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
    </svg>
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
 */
function ConteudoDoEditor({ inicial, minimizada }: PropsDoEditor) {
  const loja = useLojaDasNotas();
  const acoes = useAcoesDasNotas();
  const notaId = inicial.id;
  const edicao = useEdicaoDaNota(inicial, loja.guardar);
  const [editandoTitulo, setEditandoTitulo] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erroAoApagar, setErroAoApagar] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  // Recém-criada pelo "+ notas": já dá para escrever.
  useEffect(() => {
    if (loja.consumirFoco(notaId)) {
      campo.current?.focus({ preventScroll: true });
    }
  }, [loja, notaId]);

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

  return (
    <div className={`janela-nota ${minimizada ? "janela-nota-minimizada" : ""}`}>
      <div className={`barra-da-nota ${ALCA_DA_NOTA}`}>
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
          <span className="flex-1" />
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
            ⚠
          </button>
        )}
        <button
          type="button"
          className="botao-icone nodrag"
          title={minimizada ? "Restaurar a nota" : "Minimizar a nota"}
          aria-label={minimizada ? "Restaurar a nota" : "Minimizar a nota"}
          onClick={() => acoes.minimizarOuRestaurar(notaId)}
        >
          {minimizada ? <IconeRestaurar /> : <IconeMinimizar />}
        </button>
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
      </div>

      {!minimizada && (
        <>
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
