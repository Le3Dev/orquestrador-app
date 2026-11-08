import {
  type KeyboardEvent as EventoDeTeclado,
  memo,
  type MouseEvent as EventoDeMouse,
  type SyntheticEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  type AlteracoesDoWorktree,
  apiDeAlteracoes,
  type ArquivoAlterado,
  classificarLinhasDoDiff,
  type ConsultaDasAlteracoes,
  type DiffDoArquivo,
  type SituacaoDoArquivo,
  TEXTO_ARQUIVO_BINARIO,
  TEXTO_DIFF_TRUNCADO,
  TEXTO_DIFF_VAZIO,
  TEXTO_EM_USO,
  TEXTO_SEM_ALTERACOES,
  TEXTO_SEM_GIT,
  textoDosCommitsNaBranch,
  type TipoDaLinhaDoDiff,
} from "../../shared/api/alteracoes";
import { mensagemDeErro } from "../../shared/api/cliente";
import { IconeBranch } from "../Icones";

interface PropsDoPainel {
  orquestradorId: string;
  /** Nome do Orquestrador, ao lado do título. */
  nomeDoOrquestrador?: string;
  /** A lista vem de fora: o botão da barra a lê e mostra a contagem. */
  consulta: ConsultaDasAlteracoes;
  /** Lê a lista de novo ("atualizar" e "tentar de novo"). */
  aoAtualizar: () => void;
  aoFechar: () => void;
}

const SITUACOES: Readonly<Record<SituacaoDoArquivo, { rotulo: string; letra: string; cor: string }>> = {
  adicionado: { rotulo: "adicionado", letra: "A", cor: "text-success" },
  modificado: { rotulo: "modificado", letra: "M", cor: "text-warning" },
  removido: { rotulo: "removido", letra: "D", cor: "text-error" },
  renomeado: { rotulo: "renomeado", letra: "R", cor: "text-info" },
  nao_rastreado: { rotulo: "não rastreado", letra: "?", cor: "text-success" },
};

const CLASSES_DA_LINHA: Readonly<Record<TipoDaLinhaDoDiff, string>> = {
  cabecalho: "text-muted",
  trecho: "bg-info/10 text-info",
  adicao: "bg-success/10 text-success",
  remocao: "bg-error/10 text-error",
  contexto: "text-caption",
  observacao: "italic text-muted",
};

/** O painel fica fora do nó no DOM, mas não na árvore do React: os eventos não podem subir até o terminal. */
function naoPropagar(evento: SyntheticEvent): void {
  evento.stopPropagation();
}

/** Arrastar arquivos sobre o painel não anexa nada ao terminal nem abre o arquivo no navegador. */
function ignorarArquivoSolto(evento: SyntheticEvent): void {
  evento.preventDefault();
  evento.stopPropagation();
}

function ContagemDeLinhas({ arquivo }: { arquivo: ArquivoAlterado }) {
  if (arquivo.binario) {
    return <span>binário</span>;
  }
  if (arquivo.adicoes === null && arquivo.remocoes === null) {
    return null;
  }
  return (
    <span className="flex gap-1.5">
      <span className="text-success">+{arquivo.adicoes ?? "?"}</span>
      <span className="text-error">−{arquivo.remocoes ?? "?"}</span>
    </span>
  );
}

function ItemDoArquivo({
  arquivo,
  escolhido,
  aoEscolher,
}: {
  arquivo: ArquivoAlterado;
  escolhido: boolean;
  aoEscolher: (caminho: string) => void;
}) {
  const situacao = SITUACOES[arquivo.situacao];
  return (
    <li>
      <button
        type="button"
        aria-pressed={escolhido}
        title={arquivo.caminhoAnterior !== null ? `${arquivo.caminhoAnterior} → ${arquivo.caminho}` : arquivo.caminho}
        className={`item-do-menu ${escolhido ? "bg-surface-3" : ""}`}
        onClick={() => aoEscolher(arquivo.caminho)}
      >
        <span aria-hidden="true" className={`mono w-3 shrink-0 text-center font-semibold ${situacao.cor}`}>
          {situacao.letra}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="mono truncate text-primary">{arquivo.caminho}</span>
          <span className="mono flex gap-2 text-muted">
            <span>{situacao.rotulo}</span>
            <ContagemDeLinhas arquivo={arquivo} />
          </span>
        </span>
      </button>
    </li>
  );
}

type LeituraDoDiff =
  | { estado: "carregando" }
  | { estado: "pronta"; diff: DiffDoArquivo }
  | { estado: "erro"; mensagem: string };

/** O diff do arquivo escolhido. É lido de novo a cada leitura nova da lista (o arquivo pode ter mudado). */
function DiffDoArquivoEscolhido({ orquestradorId, arquivo }: { orquestradorId: string; arquivo: ArquivoAlterado }) {
  const [leitura, setLeitura] = useState<LeituraDoDiff>({ estado: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let valida = true;
    setLeitura({ estado: "carregando" });
    apiDeAlteracoes.lerDiff(orquestradorId, arquivo.caminho).then(
      (diff) => {
        if (valida) {
          setLeitura({ estado: "pronta", diff });
        }
      },
      (falha: unknown) => {
        if (valida) {
          setLeitura({ estado: "erro", mensagem: mensagemDeErro(falha) });
        }
      },
    );
    return () => {
      valida = false;
    };
  }, [orquestradorId, arquivo, tentativa]);

  const diff = leitura.estado === "pronta" ? leitura.diff.diff : "";
  const linhas = useMemo(() => classificarLinhasDoDiff(diff), [diff]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-col gap-0.5 border-b border-border px-4 py-2">
        <span className="mono truncate text-primary" title={arquivo.caminho}>
          {arquivo.caminho}
        </span>
        {arquivo.caminhoAnterior !== null && (
          <span className="mono truncate text-muted">renomeado de {arquivo.caminhoAnterior}</span>
        )}
      </div>

      {leitura.estado === "carregando" && (
        <p role="status" className="text-support px-4 py-3">
          Lendo o diff…
        </p>
      )}

      {leitura.estado === "erro" && (
        <div className="alert alert-error m-4 flex items-center justify-between gap-3">
          <span>{leitura.mensagem}</span>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTentativa((atual) => atual + 1)}>
            tentar de novo
          </button>
        </div>
      )}

      {leitura.estado === "pronta" && (
        <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
          {(leitura.diff.binario || leitura.diff.truncado) && (
            <div className="flex flex-col gap-2 px-4 pt-3">
              {leitura.diff.binario && <div className="alert alert-info">{TEXTO_ARQUIVO_BINARIO}</div>}
              {leitura.diff.truncado && <div className="alert alert-warning">{TEXTO_DIFF_TRUNCADO}</div>}
            </div>
          )}
          {!leitura.diff.binario && linhas.length === 0 && <p className="text-support px-4 py-3">{TEXTO_DIFF_VAZIO}</p>}
          {linhas.length > 0 && (
            <pre className="mono m-0 min-w-max py-2 leading-[1.6]" aria-label={`Diff de ${arquivo.caminho}`}>
              {linhas.map((linha, indice) => (
                <div key={indice} data-tipo={linha.tipo} className={`whitespace-pre px-4 ${CLASSES_DA_LINHA[linha.tipo]}`}>
                  {linha.texto === "" ? " " : linha.texto}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ListaDeAlteracoes({ orquestradorId, alteracoes }: { orquestradorId: string; alteracoes: AlteracoesDoWorktree }) {
  const [escolhido, setEscolhido] = useState<string | null>(null);
  // Uma leitura nova da lista pode tirar o arquivo escolhido dela.
  const arquivoEscolhido =
    escolhido === null ? null : (alteracoes.arquivos.find((arquivo) => arquivo.caminho === escolhido) ?? null);

  return (
    <div className="flex min-h-0 flex-1">
      <ul
        aria-label="Arquivos alterados"
        className="custom-scrollbar m-0 flex w-[300px] shrink-0 list-none flex-col gap-0.5 overflow-y-auto border-r border-border p-1.5"
      >
        {alteracoes.arquivos.map((arquivo) => (
          <ItemDoArquivo
            key={arquivo.caminho}
            arquivo={arquivo}
            escolhido={arquivo.caminho === arquivoEscolhido?.caminho}
            aoEscolher={setEscolhido}
          />
        ))}
      </ul>
      {arquivoEscolhido === null ? (
        <p className="text-support m-0 flex-1 px-4 py-3">Escolha um arquivo para ver o diff.</p>
      ) : (
        <DiffDoArquivoEscolhido orquestradorId={orquestradorId} arquivo={arquivoEscolhido} />
      )}
    </div>
  );
}

function ConteudoDoPainel({
  orquestradorId,
  consulta,
  aoAtualizar,
}: {
  orquestradorId: string;
  consulta: ConsultaDasAlteracoes;
  aoAtualizar: () => void;
}) {
  const { alteracoes, carregando, erro } = consulta;

  if (erro !== null) {
    return (
      <div className="p-4">
        <div className="alert alert-error flex items-center justify-between gap-3">
          <span>{erro}</span>
          <button type="button" className="btn btn-sm btn-outline" onClick={aoAtualizar} disabled={carregando}>
            tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (alteracoes === null) {
    return (
      <p role="status" className="text-support m-0 p-4">
        Lendo as alterações…
      </p>
    );
  }

  if (alteracoes.situacao === "sem_git") {
    return (
      <div className="p-4">
        <div className="alert alert-info">{TEXTO_SEM_GIT}</div>
      </div>
    );
  }

  const commits = textoDosCommitsNaBranch(alteracoes);
  const avisos = (
    <>
      {alteracoes.emUso && <div className="alert alert-warning">{TEXTO_EM_USO}</div>}
      {commits !== null && <div className="alert alert-info">{commits}</div>}
    </>
  );

  if (alteracoes.arquivos.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="alert">{TEXTO_SEM_ALTERACOES}</div>
        {avisos}
      </div>
    );
  }

  return (
    <>
      {(alteracoes.emUso || commits !== null) && (
        <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5">{avisos}</div>
      )}
      <ListaDeAlteracoes orquestradorId={orquestradorId} alteracoes={alteracoes} />
    </>
  );
}

/**
 * Painel de alterações do worktree: à esquerda, os arquivos que o
 * Orquestrador deixou por commitar; à direita, o diff do escolhido. Só
 * leitura. É um modal no `document.body`, fora do viewport do React Flow,
 * para não escalar com o zoom. Esc e clique fora fecham.
 *
 * Memorizado: o botão re-renderiza a cada evento do canvas, e o diff aberto
 * não precisa acompanhar.
 */
export const PainelDeAlteracoes = memo(function PainelDeAlteracoes({
  orquestradorId,
  nomeDoOrquestrador,
  consulta,
  aoAtualizar,
  aoFechar,
}: PropsDoPainel) {
  const painel = useRef<HTMLDivElement>(null);
  const idDoTitulo = useId();
  const { alteracoes, carregando } = consulta;

  useEffect(() => {
    painel.current?.focus({ preventScroll: true });
  }, []);

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
      data-testid="fundo-do-painel-de-alteracoes"
      className="nokey fundo-que-esmaece fixed inset-0 z-50 flex items-center justify-center bg-screen-bg/60 p-6"
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
        className="painel-flutuante surgir flex h-full max-h-[760px] w-full max-w-[1100px] flex-col overflow-hidden outline-none"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
          <h2 id={idDoTitulo} className="shrink-0">
            Alterações do worktree
          </h2>
          {nomeDoOrquestrador !== undefined && <span className="truncate text-secondary">{nomeDoOrquestrador}</span>}
          {alteracoes !== null && alteracoes.branch !== null && (
            <span className="chip min-w-0" title={alteracoes.caminho ?? undefined}>
              <IconeBranch tamanho={11} className="mr-1 shrink-0" />
              <span className="truncate">{alteracoes.branch}</span>
            </span>
          )}
          <span className="flex-1" />
          <span className="text-support shrink-0">só leitura</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={aoAtualizar} disabled={carregando}>
            {carregando ? "atualizando…" : "atualizar"}
          </button>
          <button type="button" className="botao-icone" title="Fechar (Esc)" aria-label="Fechar" onClick={aoFechar}>
            ✕
          </button>
        </div>
        <ConteudoDoPainel orquestradorId={orquestradorId} consulta={consulta} aoAtualizar={aoAtualizar} />
      </div>
    </div>,
    document.body,
  );
});
