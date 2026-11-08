import {
  type KeyboardEvent as EventoDeTeclado,
  memo,
  type MouseEvent as EventoDeMouse,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { api, ErroDaApi, mensagemDeErro } from "../../shared/api/cliente";
import type { ConteudoDoArquivo, EntradaDaPasta } from "../../shared/api/tipos";
import {
  destacarCodigo,
  type LinhaDestacada,
  linguagemDoArquivo,
  linhasDoTexto,
  precarregarDestaque,
} from "../../shared/destaqueDeSintaxe";
import { IconePasta } from "../Icones";
import "../../theme/visualizador-de-arquivos.css";

interface PropsDoVisualizador {
  orquestradorId: string;
  /** Nome do Orquestrador, ao lado do título. */
  nomeDoOrquestrador?: string;
  aoFechar: () => void;
}

type LeituraDaPasta =
  | { estado: "carregando" }
  | { estado: "pronta"; entradas: EntradaDaPasta[]; truncada: boolean }
  | { estado: "erro"; mensagem: string };

type LeituraDoArquivo =
  | { estado: "carregando" }
  | { estado: "pronta"; arquivo: ConteudoDoArquivo }
  | { estado: "erro"; titulo: string | null; mensagem: string; definitivo: boolean };

/** Recusas do servidor que tentar de novo não resolve, com um título amigável. */
const RECUSAS: Readonly<Record<number, string>> = {
  403: "Arquivo bloqueado",
  404: "Arquivo não encontrado",
  413: "Arquivo grande demais",
  415: "Arquivo binário",
};

function caminhoDe(pasta: string, nome: string): string {
  return pasta === "" ? nome : `${pasta}/${nome}`;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
}

/** O painel fica fora do nó no DOM, mas não na árvore do React: os eventos não podem subir até o terminal. */
function naoPropagar(evento: SyntheticEvent): void {
  evento.stopPropagation();
}

/** Arrastar arquivos sobre o painel não anexa nada ao terminal nem abre o arquivo no navegador. */
function ignorarArquivoSolto(evento: SyntheticEvent): void {
  evento.preventDefault();
  evento.stopPropagation();
}

interface PropsDaArvore {
  pastas: ReadonlyMap<string, LeituraDaPasta>;
  abertas: ReadonlySet<string>;
  escolhido: string | null;
  aoAlternarPasta: (caminho: string) => void;
  aoEscolherArquivo: (caminho: string) => void;
  aoRecarregarPasta: (caminho: string) => void;
}

/** Os itens de uma pasta já pedida; as subpastas abertas se desenham dentro, um nível mais fundo. */
function ItensDaPasta({ caminho, nivel, ...arvore }: PropsDaArvore & { caminho: string; nivel: number }) {
  const leitura = arvore.pastas.get(caminho) ?? { estado: "carregando" };
  const recuo = { paddingLeft: `${8 + nivel * 14}px` };

  if (leitura.estado === "carregando") {
    return (
      <li role="status" className="aviso-da-arvore" style={recuo}>
        lendo…
      </li>
    );
  }
  if (leitura.estado === "erro") {
    return (
      <li className="aviso-da-arvore text-error" style={recuo}>
        {leitura.mensagem}{" "}
        <button type="button" className="underline" onClick={() => arvore.aoRecarregarPasta(caminho)}>
          tentar de novo
        </button>
      </li>
    );
  }
  if (leitura.entradas.length === 0) {
    return (
      <li className="aviso-da-arvore" style={recuo}>
        pasta vazia
      </li>
    );
  }

  return (
    <>
      {leitura.entradas.map((entrada) => {
        const caminhoDoItem = caminhoDe(caminho, entrada.nome);
        if (entrada.tipo === "pasta") {
          const aberta = arvore.abertas.has(caminhoDoItem);
          return (
            <li key={`p:${entrada.nome}`}>
              <button
                type="button"
                className="item-da-arvore"
                style={recuo}
                aria-expanded={aberta}
                title={caminhoDoItem}
                onClick={() => arvore.aoAlternarPasta(caminhoDoItem)}
              >
                <span className="seta-da-pasta" aria-hidden="true">
                  ›
                </span>
                <IconePasta className="shrink-0 text-muted" />
                <span className="nome-do-item">{entrada.nome}</span>
              </button>
              {aberta && (
                <ul>
                  <ItensDaPasta {...arvore} caminho={caminhoDoItem} nivel={nivel + 1} />
                </ul>
              )}
            </li>
          );
        }
        return (
          <li key={`a:${entrada.nome}`}>
            <button
              type="button"
              className="item-da-arvore"
              style={recuo}
              aria-current={arvore.escolhido === caminhoDoItem}
              title={entrada.tamanho !== undefined ? `${caminhoDoItem} (${formatarTamanho(entrada.tamanho)})` : caminhoDoItem}
              onClick={() => arvore.aoEscolherArquivo(caminhoDoItem)}
            >
              <span className="seta-da-pasta" aria-hidden="true" />
              <span className="nome-do-item">{entrada.nome}</span>
            </button>
          </li>
        );
      })}
      {leitura.truncada && (
        <li className="aviso-da-arvore" style={recuo}>
          pasta com itens demais: só os primeiros aparecem
        </li>
      )}
    </>
  );
}

/**
 * As linhas do arquivo com os números ao lado. Começa em texto puro; quando o
 * destaque fica pronto, as mesmas linhas ganham as cores do tema.
 */
const CodigoDoArquivo = memo(function CodigoDoArquivo({ arquivo }: { arquivo: ConteudoDoArquivo }) {
  const linhas = useMemo(() => linhasDoTexto(arquivo.conteudo), [arquivo.conteudo]);
  const [destaque, setDestaque] = useState<LinhaDestacada[] | null>(null);

  useEffect(() => {
    const linguagem = linguagemDoArquivo(arquivo.caminho);
    setDestaque(null);
    if (linguagem === null) {
      return undefined;
    }
    let valido = true;
    destacarCodigo(arquivo.conteudo, linguagem).then(
      (destacado) => {
        // Só se bate linha a linha com o texto puro; senão fica o texto puro.
        if (valido && destacado !== null && destacado.length === linhas.length) {
          setDestaque(destacado);
        }
      },
      () => undefined,
    );
    return () => {
      valido = false;
    };
  }, [arquivo, linhas]);

  return (
    <div
      className="codigo-do-visualizador custom-scrollbar"
      tabIndex={0}
      aria-label={`Conteúdo de ${arquivo.caminho}`}
      data-destacado={destaque !== null}
    >
      <pre>
        {linhas.map((texto, indice) => (
          <div key={indice} className="linha-do-codigo">
            <span className="numero-da-linha" aria-hidden="true">
              {indice + 1}
            </span>
            <span className="texto-da-linha-do-codigo">
              {destaque === null
                ? texto === ""
                  ? " "
                  : texto
                : (destaque[indice] ?? []).map((pedaco, posicao) => (
                    <span
                      key={posicao}
                      style={{
                        color: pedaco.cor,
                        fontStyle: pedaco.italico ? "italic" : undefined,
                        fontWeight: pedaco.negrito ? "bold" : undefined,
                        textDecoration: pedaco.sublinhado ? "underline" : undefined,
                      }}
                    >
                      {pedaco.texto}
                    </span>
                  ))}
              {destaque !== null && (destaque[indice]?.length ?? 0) === 0 && " "}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
});

/** O arquivo escolhido: caminho no topo e o código só leitura, com rolagem própria. */
function ArquivoAberto({ orquestradorId, caminho }: { orquestradorId: string; caminho: string }) {
  const [leitura, setLeitura] = useState<LeituraDoArquivo>({ estado: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let valida = true;
    setLeitura({ estado: "carregando" });
    api.lerArquivo(orquestradorId, caminho).then(
      (arquivo) => {
        if (valida) {
          setLeitura({ estado: "pronta", arquivo });
        }
      },
      (falha: unknown) => {
        if (valida) {
          const titulo = falha instanceof ErroDaApi ? (RECUSAS[falha.status] ?? null) : null;
          setLeitura({ estado: "erro", titulo, mensagem: mensagemDeErro(falha), definitivo: titulo !== null });
        }
      },
    );
    return () => {
      valida = false;
    };
  }, [orquestradorId, caminho, tentativa]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <span className="mono min-w-0 flex-1 truncate text-primary" title={caminho}>
          {caminho}
        </span>
        {leitura.estado === "pronta" && (
          <span className="text-support shrink-0">
            {leitura.arquivo.linhas.toLocaleString("pt-BR")} {leitura.arquivo.linhas === 1 ? "linha" : "linhas"} ·{" "}
            {formatarTamanho(leitura.arquivo.tamanho)}
          </span>
        )}
      </div>

      {leitura.estado === "carregando" && (
        <p role="status" className="text-support m-0 px-4 py-3">
          Lendo o arquivo…
        </p>
      )}

      {leitura.estado === "erro" && (
        <div className="p-4">
          <div
            role="alert"
            className={`alert ${leitura.definitivo ? "alert-warning" : "alert-error"} flex items-center justify-between gap-3`}
          >
            <span className="flex flex-col gap-0.5">
              {leitura.titulo !== null && <strong>{leitura.titulo}</strong>}
              <span>{leitura.mensagem}</span>
            </span>
            {!leitura.definitivo && (
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setTentativa((atual) => atual + 1)}>
                tentar de novo
              </button>
            )}
          </div>
        </div>
      )}

      {leitura.estado === "pronta" && <CodigoDoArquivo arquivo={leitura.arquivo} />}
    </div>
  );
}

/**
 * Visualizador de código: à esquerda, a árvore da pasta do Orquestrador (o
 * worktree, se houver), com as pastas lidas só quando abertas; à direita, o
 * arquivo escolhido, só leitura. É um modal no `document.body`, fora do
 * viewport do React Flow, para não escalar com o zoom. Esc e clique fora
 * fecham. Abrir o painel já começa a baixar o destaque de sintaxe.
 */
export const VisualizadorDeArquivos = memo(function VisualizadorDeArquivos({
  orquestradorId,
  nomeDoOrquestrador,
  aoFechar,
}: PropsDoVisualizador) {
  const painel = useRef<HTMLDivElement>(null);
  const idDoTitulo = useId();
  const [pastas, setPastas] = useState<ReadonlyMap<string, LeituraDaPasta>>(new Map());
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const montado = useRef(true);

  const lerPasta = useCallback(
    (caminho: string) => {
      const guardar = (leitura: LeituraDaPasta) => {
        if (montado.current) {
          setPastas((atuais) => new Map(atuais).set(caminho, leitura));
        }
      };
      guardar({ estado: "carregando" });
      api.listarArquivos(orquestradorId, caminho).then(
        (listagem) => guardar({ estado: "pronta", entradas: listagem.entradas, truncada: listagem.truncada }),
        (falha: unknown) => guardar({ estado: "erro", mensagem: mensagemDeErro(falha) }),
      );
    },
    [orquestradorId],
  );

  useEffect(() => {
    montado.current = true;
    painel.current?.focus({ preventScroll: true });
    precarregarDestaque();
    lerPasta("");
    return () => {
      montado.current = false;
    };
  }, [lerPasta]);

  const alternarPasta = useCallback(
    (caminho: string) => {
      const aberta = abertas.has(caminho);
      setAbertas((atuais) => {
        const novas = new Set(atuais);
        if (aberta) {
          novas.delete(caminho);
        } else {
          novas.add(caminho);
        }
        return novas;
      });
      // Lida uma vez; reabrir mostra o que já veio (a não ser que tenha dado erro).
      if (!aberta && (pastas.get(caminho) === undefined || pastas.get(caminho)?.estado === "erro")) {
        lerPasta(caminho);
      }
    },
    [abertas, pastas, lerPasta],
  );

  const aoTeclar = (evento: EventoDeTeclado<HTMLDivElement>) => {
    evento.stopPropagation();
    if (evento.key === "Escape") {
      evento.preventDefault();
      aoFechar();
    }
  };

  const aoPressionarOFundo = (evento: EventoDeMouse<HTMLDivElement>) => {
    evento.stopPropagation();
    if (evento.target === evento.currentTarget) {
      aoFechar();
    }
  };

  return createPortal(
    <div
      data-testid="fundo-do-visualizador-de-arquivos"
      className="nokey nowheel nodrag fundo-que-esmaece fixed inset-0 z-50 flex items-center justify-center bg-screen-bg/60 p-6"
      onMouseDown={aoPressionarOFundo}
      onKeyDown={aoTeclar}
      onKeyUp={naoPropagar}
      onClick={naoPropagar}
      onDoubleClick={naoPropagar}
      onPointerDown={naoPropagar}
      onContextMenu={naoPropagar}
      onWheel={naoPropagar}
      onDragOver={ignorarArquivoSolto}
      onDragLeave={naoPropagar}
      onDrop={ignorarArquivoSolto}
    >
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idDoTitulo}
        tabIndex={-1}
        className="painel-flutuante surgir flex h-full max-h-[820px] w-full max-w-[1280px] flex-col overflow-hidden outline-none"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
          <h2 id={idDoTitulo} className="shrink-0">
            Arquivos
          </h2>
          {nomeDoOrquestrador !== undefined && <span className="truncate text-secondary">{nomeDoOrquestrador}</span>}
          <span className="flex-1" />
          <span className="text-support shrink-0">só leitura</span>
          <button type="button" className="botao-icone" title="Fechar (Esc)" aria-label="Fechar" onClick={aoFechar}>
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <ul aria-label="Arquivos da pasta" className="arvore-de-arquivos custom-scrollbar">
            <ItensDaPasta
              caminho=""
              nivel={0}
              pastas={pastas}
              abertas={abertas}
              escolhido={escolhido}
              aoAlternarPasta={alternarPasta}
              aoEscolherArquivo={setEscolhido}
              aoRecarregarPasta={lerPasta}
            />
          </ul>
          {escolhido === null ? (
            <p className="text-support m-0 flex-1 px-4 py-3">Escolha um arquivo para ver o conteúdo.</p>
          ) : (
            <ArquivoAberto key={escolhido} orquestradorId={orquestradorId} caminho={escolhido} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
});
