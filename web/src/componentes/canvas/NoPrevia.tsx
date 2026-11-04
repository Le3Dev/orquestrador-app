import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from "react";

import { useAcoesDoCanvas } from "../../shared/canvas/contexto";
import { TAMANHO_MINIMO_DA_PREVIA } from "../../shared/canvas/layout";
import { ALCA_DA_PREVIA, type Ancora, type NoPrevia as TipoDoNo } from "../../shared/canvas/nos";
import { enderecoDigitado } from "../../shared/enderecosLocais";
import { Dica } from "../Dica";
import {
  IconeAbrirFora,
  IconeFechar,
  IconeMinimizar,
  IconeNavegador,
  IconeRecarregar,
  IconeRestaurar,
} from "../Icones";

export const ENDERECO_INVALIDO = "Endereço inválido: use http ou https (ex.: localhost:5173).";

/** As alças de redimensionar. Memorizadas: o arraste não as re-renderiza a cada quadro. */
const RedimensionadorDaPrevia = memo(function RedimensionadorDaPrevia({ visivel }: { visivel: boolean }) {
  return (
    <NodeResizer
      isVisible={visivel}
      minWidth={TAMANHO_MINIMO_DA_PREVIA.largura}
      minHeight={TAMANHO_MINIMO_DA_PREVIA.altura}
      lineClassName="redimensionador-linha"
      handleClassName="redimensionador-alca"
    />
  );
});

/** Onde chega a linha do terminal de que a prévia saiu: o meio de cada lado (`ladoDaPrevia`). */
const ANCORAS_DA_PREVIA: readonly { id: Ancora; posicao: Position }[] = [
  { id: "cima", posicao: Position.Top },
  { id: "baixo", posicao: Position.Bottom },
  { id: "esquerda", posicao: Position.Left },
  { id: "direita", posicao: Position.Right },
];

const AncorasDaPrevia = memo(function AncorasDaPrevia() {
  return (
    <>
      {ANCORAS_DA_PREVIA.map(({ id, posicao }) => (
        <Handle key={id} id={id} type="target" position={posicao} className="ancora" isConnectable={false} />
      ))}
    </>
  );
});

/**
 * Uma prévia ao vivo no canvas: um navegador pequeno com o site que um agente
 * subiu (o recarregamento automático do Vite ou do Next a mantém em dia).
 * Arrasta pela barra de título, redimensiona pelas bordas quando selecionada e
 * se minimiza à barra, como a nota.
 *
 * Aqui fica só a moldura (o React Flow re-renderiza o nó a cada quadro do
 * arraste); a janela é memorizada e o site não recarrega ao mover.
 */
export const NoPrevia = memo(function NoPrevia({ data, selected }: NodeProps<TipoDoNo>) {
  return (
    <>
      <RedimensionadorDaPrevia visivel={selected && !data.minimizada} />
      <AncorasDaPrevia />
      <JanelaDaPrevia
        previaId={data.previaId}
        url={data.url}
        minimizada={data.minimizada}
        focarAoAbrir={selected && data.url === ""}
      />
    </>
  );
});

interface PropsDoCampo {
  url: string;
  /** Recém-criada sem endereço: o campo já nasce com o foco. Só vale na montagem. */
  focarAoAbrir: boolean;
  aoNavegar: (url: string) => void;
}

/** A barra de endereço: Enter navega (só http e https), Esc volta ao endereço aberto. */
function CampoDoEndereco({ url, focarAoAbrir, aoNavegar }: PropsDoCampo) {
  const [texto, setTexto] = useState(url);
  const [invalido, setInvalido] = useState(false);
  const [focarNaMontagem] = useState(focarAoAbrir);
  const [urlAnterior, setUrlAnterior] = useState(url);
  const campo = useRef<HTMLInputElement>(null);

  // O endereço mudou por fora (navegou, ou o canvas reabriu a prévia): o campo acompanha.
  if (url !== urlAnterior) {
    setUrlAnterior(url);
    setTexto(url);
    setInvalido(false);
  }

  useEffect(() => {
    if (focarNaMontagem) {
      // Sem rolar: o foco num elemento do canvas faria o navegador deslocá-lo.
      campo.current?.focus({ preventScroll: true });
    }
  }, [focarNaMontagem]);

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>): void {
    if (evento.key === "Enter") {
      evento.preventDefault();
      const destino = enderecoDigitado(texto);
      if (destino === null) {
        setInvalido(true);
        return;
      }
      setTexto(destino);
      aoNavegar(destino);
    } else if (evento.key === "Escape") {
      setTexto(url);
      setInvalido(false);
      evento.currentTarget.blur();
    }
  }

  return (
    <input
      ref={campo}
      className={`campo-do-endereco nodrag ${invalido ? "campo-do-endereco-invalido" : ""}`}
      aria-label="Endereço da prévia"
      aria-invalid={invalido}
      title={invalido ? ENDERECO_INVALIDO : "Digite o endereço e pressione Enter"}
      placeholder="localhost:5173"
      spellCheck={false}
      autoComplete="off"
      value={texto}
      onChange={(evento) => {
        setTexto(evento.target.value);
        setInvalido(false);
      }}
      onKeyDown={aoTeclar}
    />
  );
}

/** O que o site da prévia pode fazer. Fica de fora a navegação da janela de cima (`allow-top-navigation`). */
const PERMISSOES_DA_PREVIA =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

/**
 * O site. O iframe nasce sem `src`: a tela é servida com
 * `Cross-Origin-Embedder-Policy: credentialless` (isolarOrigem, em
 * src/root.ts), e um site de outra origem só carrega num iframe que já tem o
 * atributo `credentialless` quando o endereço chega. Por isso os dois são
 * definidos aqui, nessa ordem, quando o iframe entra na página.
 *
 * O `sandbox` (também antes do endereço) deixa o site rodar como num
 * navegador, mas sem navegar a janela de cima: um link `target="_top"` ou um
 * `top.location = ...` trocaria a tela inteira pelo site, e no app desktop não
 * há como voltar.
 *
 * Memorizado: só recarrega quando o endereço muda ou a `versao` (o botão
 * recarregar, que recria o iframe) muda; nunca ao mover ou redimensionar.
 */
const QuadroDoSite = memo(function QuadroDoSite({ url, versao }: { url: string; versao: number }) {
  const ligar = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      if (iframe !== null) {
        iframe.setAttribute("credentialless", "");
        iframe.setAttribute("sandbox", PERMISSOES_DA_PREVIA);
        iframe.src = url;
      }
    },
    [url],
  );
  return <iframe key={versao} ref={ligar} title={`Prévia de ${url}`} className="quadro-da-previa nodrag nowheel" />;
});

interface PropsDaJanela {
  previaId: string;
  url: string;
  minimizada: boolean;
  focarAoAbrir: boolean;
}

const JanelaDaPrevia = memo(function JanelaDaPrevia({ previaId, url, minimizada, focarAoAbrir }: PropsDaJanela) {
  const acoes = useAcoesDoCanvas();
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((atual) => atual + 1), []);
  const semEndereco = url === "";

  const navegar = useCallback(
    (destino: string) => {
      // O mesmo endereço de novo: o usuário quer ver a página outra vez.
      if (destino === url) {
        recarregar();
      } else {
        acoes.navegarPrevia(previaId, destino);
      }
    },
    [acoes, previaId, url, recarregar],
  );

  return (
    <div className={`janela-previa ${minimizada ? "janela-previa-minimizada" : ""}`}>
      <div className={`barra-da-previa ${ALCA_DA_PREVIA}`}>
        <IconeNavegador className="shrink-0 text-info" />
        <CampoDoEndereco url={url} focarAoAbrir={focarAoAbrir} aoNavegar={navegar} />
        <button
          type="button"
          className="botao-icone nodrag"
          title="Recarregar a página"
          aria-label="Recarregar a página"
          disabled={semEndereco}
          onClick={recarregar}
        >
          <IconeRecarregar />
        </button>
        {semEndereco ? (
          <button
            type="button"
            className="botao-icone nodrag"
            title="Abrir no navegador"
            aria-label="Abrir no navegador"
            disabled
          >
            <IconeAbrirFora />
          </button>
        ) : (
          <a
            className="botao-icone nodrag"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir no navegador"
            aria-label="Abrir no navegador"
          >
            <IconeAbrirFora />
          </a>
        )}
        <span className="nodrag flex">
          <Dica sobre="a prévia" titulo="Ficou em branco?">
            Alguns sites não aceitam abrir dentro de outra página; use abrir no navegador. Login com cookie também pode
            não manter a sessão aqui.
          </Dica>
        </span>
        <button
          type="button"
          className="botao-icone nodrag"
          title={minimizada ? "Restaurar a prévia" : "Minimizar a prévia"}
          aria-label={minimizada ? "Restaurar a prévia" : "Minimizar a prévia"}
          onClick={() => acoes.minimizarOuRestaurarPrevia(previaId)}
        >
          {minimizada ? <IconeRestaurar /> : <IconeMinimizar />}
        </button>
        <button
          type="button"
          className="botao-icone nodrag"
          title="Fechar a prévia"
          aria-label="Fechar a prévia"
          onClick={() => acoes.fecharPrevia(previaId)}
        >
          <IconeFechar tamanho={14} />
        </button>
      </div>
      {/* Minimizada, o site continua carregado (só escondido): restaurar não o recarrega. */}
      <div className="corpo-da-previa" hidden={minimizada}>
        {semEndereco ? (
          <p className="mensagem-da-previa">
            Digite acima o endereço do servidor de desenvolvimento (por exemplo, localhost:5173) e pressione Enter.
          </p>
        ) : (
          <QuadroDoSite url={url} versao={versao} />
        )}
      </div>
    </div>
  );
});
