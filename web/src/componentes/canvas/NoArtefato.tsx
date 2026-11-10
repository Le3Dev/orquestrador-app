import { type NodeProps, NodeResizer } from "@xyflow/react";
import {
  type CSSProperties,
  type KeyboardEvent as EventoDeTecladoDoReact,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  apiDosArtefatos,
  type FormatoDoArtefato,
  type ResumoDoArtefato,
  type VersaoDoArtefato,
} from "../../shared/api/artefatos";
import { ErroDaApi, mensagemDeErro } from "../../shared/api/cliente";
import {
  useAcoesDosArtefatos,
  useArtefato,
  useErroAoCarregarArtefatos,
  useListaDeArtefatosCarregada,
} from "../../shared/canvas/artefatos";
import { TAMANHO_MINIMO_DO_ARTEFATO } from "../../shared/canvas/layout";
import { ALCA_DO_ARTEFATO, type NoArtefato as TipoDoNo } from "../../shared/canvas/nos";
import { TAG_DO_SCRIPT_DE_NAVEGACAO, useNavegacaoDoQuadro } from "../../shared/navegacaoDoArtefato";
import { TextoFormatado } from "../TextoFormatado";
import { BotoesDeNavegacao } from "./BotoesDeNavegacao";
import { ControlesDoNo } from "./ControlesDoNo";
import { JanelaEmTelaCheia } from "./JanelaEmTelaCheia";
import { QuadroAtivavel } from "./NoPrevia";

export const CONFIRMACAO_PARA_APAGAR_O_ARTEFATO = "Apagar este artefato? Isso não pode ser desfeito.";
/**
 * A política de segurança injetada em toda página HTML: nada sai para a rede
 * (nem imagens, fontes ou scripts externos); só o que está no próprio arquivo
 * roda. Somada ao `sandbox` sem `allow-same-origin`, a página não lê nada do
 * app (cookies, armazenamento, a API) nem navega a janela principal.
 */
export const POLITICA_DO_ARTEFATO =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
/** Quanto tempo o selo "v2 nova" fica na barra depois que chega uma versão. */
export const DURACAO_DO_DESTAQUE_MS = 4_000;

const META_DA_POLITICA = `<meta http-equiv="Content-Security-Policy" content="${POLITICA_DO_ARTEFATO}">`;
const ROTULO_DO_FORMATO: Readonly<Record<FormatoDoArtefato, string>> = {
  html: "Página HTML",
  markdown: "Documento Markdown",
};
const TIPO_DO_ARQUIVO: Readonly<Record<FormatoDoArtefato, string>> = {
  html: "text/html;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
};
const EXTENSAO: Readonly<Record<FormatoDoArtefato, string>> = { html: "html", markdown: "md" };
const ESPERA_PARA_LIBERAR_O_DOWNLOAD_MS = 1_000;

/**
 * A página com a política de segurança e o script de voltar e avançar
 * (`navegacaoDoArtefato.ts`) no começo do `<head>`; sem `<head>`,
 * no começo do documento (depois do `<!DOCTYPE>`, para não cair no modo de
 * compatibilidade) — o navegador cria o `<head>` em volta dela.
 */
function comPoliticaDeSeguranca(html: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const ponto = head !== null ? head.index + head[0].length : (doctype?.[0].length ?? 0);
  return `${html.slice(0, ponto)}${META_DA_POLITICA}${TAG_DO_SCRIPT_DE_NAVEGACAO}${html.slice(ponto)}`;
}

/** O nome do arquivo baixado: o do artefato; numa versão antiga, com "-v2" antes da extensão. */
function nomeParaSalvar(artefato: ResumoDoArtefato, numero: number): string {
  const doArquivo = artefato.arquivo.split(/[\\/]/).at(-1)?.trim() ?? "";
  const base = doArquivo === "" ? `artefato.${EXTENSAO[artefato.formato]}` : doArquivo;
  if (numero === artefato.versaoAtual) {
    return base;
  }
  const ponto = base.lastIndexOf(".");
  return ponto > 0 ? `${base.slice(0, ponto)}-v${numero}${base.slice(ponto)}` : `${base}-v${numero}`;
}

/** Baixa o texto como arquivo (o app desktop pergunta onde salvar). */
function baixar(texto: string, nome: string, tipo: string): void {
  const endereco = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const link = document.createElement("a");
  link.href = endereco;
  link.download = nome;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(endereco), ESPERA_PARA_LIBERAR_O_DOWNLOAD_MS);
}

const dataDaVersao = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatarDataDaVersao(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "" : dataDaVersao.format(data);
}

/** Ex.: "830 B", "2,1 kB", "1,4 MB". */
function formatarTamanho(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const quilo = bytes / 1024;
  if (quilo < 1024) {
    return `${quilo.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kB`;
  }
  return `${(quilo / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

// ---------------- Ícones ----------------

function IconeSalvar() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function IconeDoFormato({ formato }: { formato: FormatoDoArtefato }) {
  const rotulo = ROTULO_DO_FORMATO[formato];
  return (
    <span role="img" aria-label={rotulo} title={rotulo} className={`icone-do-artefato icone-do-artefato-${formato}`}>
      {formato === "html" ? "</>" : "M↓"}
    </span>
  );
}

const DICA_DE_FECHAR_O_ARTEFATO = "Fechar (o artefato continua salvo; reabra pela paleta, Ctrl+K)";

// ---------------- Conteúdo de uma versão ----------------

type ConteudoDaVersao =
  | { situacao: "carregando" }
  | { situacao: "pronto"; texto: string }
  | { situacao: "erro"; mensagem: string }
  | { situacao: "inexistente" };

const CARREGANDO: ConteudoDaVersao = { situacao: "carregando" };
const INEXISTENTE: ConteudoDaVersao = { situacao: "inexistente" };

/**
 * O conteúdo bruto da versão pedida, lido do servidor. As versões não mudam
 * depois de criadas: só busca de novo ao trocar de versão ou ao tentar de novo.
 */
function useConteudoDaVersao(
  artefatoId: string,
  numero: number,
  existe: boolean,
): { conteudo: ConteudoDaVersao; tentarDeNovo: () => void } {
  const [tentativa, setTentativa] = useState(0);
  const chave = `${artefatoId}\n${numero}\n${tentativa}`;
  const [lido, setLido] = useState<{ chave: string; conteudo: ConteudoDaVersao } | null>(null);

  useEffect(() => {
    if (!existe) {
      return;
    }
    let ativo = true;
    apiDosArtefatos.lerVersao(artefatoId, numero).then(
      (texto) => {
        if (ativo) {
          setLido({ chave, conteudo: { situacao: "pronto", texto } });
        }
      },
      (falha: unknown) => {
        if (ativo) {
          setLido({
            chave,
            conteudo:
              falha instanceof ErroDaApi && falha.status === 404
                ? INEXISTENTE
                : { situacao: "erro", mensagem: mensagemDeErro(falha) },
          });
        }
      },
    );
    return () => {
      ativo = false;
    };
  }, [artefatoId, numero, existe, chave]);

  const tentarDeNovo = useCallback(() => setTentativa((anterior) => anterior + 1), []);
  const conteudo = !existe ? INEXISTENTE : lido?.chave === chave ? lido.conteudo : CARREGANDO;
  return { conteudo, tentarDeNovo };
}

/**
 * A página (num iframe isolado) ou o documento (Markdown formatado).
 * Memorizado: o mesmo texto não recria o iframe nem re-analisa o Markdown.
 *
 * No canvas, a página fica atrás da camada de ativar (`QuadroAtivavel`): a roda
 * e a pinça em cima dela movem o canvas até um clique. Em tela cheia, não.
 */
const CorpoPronto = memo(function CorpoPronto({
  formato,
  titulo,
  texto,
  noCanvas,
  ligarQuadro,
  aoCarregarQuadro,
}: {
  formato: FormatoDoArtefato;
  titulo: string;
  texto: string;
  noCanvas: boolean;
  /** `ref` e `onLoad` do iframe: o histórico da página (voltar e avançar) vem dele. */
  ligarQuadro: (quadro: HTMLIFrameElement | null) => void;
  aoCarregarQuadro: () => void;
}) {
  const pagina = useMemo(() => (formato === "html" ? comPoliticaDeSeguranca(texto) : ""), [formato, texto]);
  if (formato === "html") {
    const quadro = (estilo?: CSSProperties) => (
      <iframe
        ref={ligarQuadro}
        onLoad={aoCarregarQuadro}
        title={`Conteúdo do artefato: ${titulo}`}
        className="corpo-do-artefato-html nodrag nowheel"
        style={estilo}
        // Sem `allow-same-origin`: a página roda numa origem opaca, sem acesso ao app.
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={pagina}
      />
    );
    return noCanvas ? <QuadroAtivavel>{quadro}</QuadroAtivavel> : quadro();
  }
  return (
    <div className="corpo-do-artefato-markdown custom-scrollbar nodrag nowheel" data-testid="documento-do-artefato">
      <TextoFormatado texto={texto} />
    </div>
  );
});

function CorpoDoArtefato({
  artefato,
  numero,
  conteudo,
  aoTentarDeNovo,
  aoVerAtual,
  noCanvas,
  ligarQuadro,
  aoCarregarQuadro,
}: {
  artefato: ResumoDoArtefato;
  numero: number;
  conteudo: ConteudoDaVersao;
  aoTentarDeNovo: () => void;
  aoVerAtual: () => void;
  /** Na janela do canvas (e não em tela cheia): a página só pega o mouse depois de ativada. */
  noCanvas: boolean;
  ligarQuadro: (quadro: HTMLIFrameElement | null) => void;
  aoCarregarQuadro: () => void;
}) {
  switch (conteudo.situacao) {
    case "carregando":
      return <p className="estado-do-artefato text-muted">carregando v{numero}…</p>;
    case "erro":
      return (
        <div className="estado-do-artefato text-error" role="alert">
          <span>✗ Não foi possível carregar a versão {numero}. {conteudo.mensagem}</span>
          <button type="button" className="botao-de-texto nodrag" onClick={aoTentarDeNovo}>
            tentar de novo
          </button>
        </div>
      );
    case "inexistente":
      return (
        <div className="estado-do-artefato text-warning" role="alert">
          <span>A versão {numero} não existe mais.</span>
          {numero !== artefato.versaoAtual && (
            <button type="button" className="botao-de-texto nodrag" onClick={aoVerAtual}>
              ver a versão atual (v{artefato.versaoAtual})
            </button>
          )}
        </div>
      );
    case "pronto":
      return (
        <CorpoPronto
          formato={artefato.formato}
          titulo={artefato.titulo}
          texto={conteudo.texto}
          noCanvas={noCanvas}
          ligarQuadro={ligarQuadro}
          aoCarregarQuadro={aoCarregarQuadro}
        />
      );
  }
}

// ---------------- Barra ----------------

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
      className="campo-do-titulo-do-artefato nodrag"
      aria-label="Título do artefato"
      defaultValue={titulo}
      placeholder="Sem título"
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

/** "v3 ▾": abre a lista das versões, da mais nova para a mais antiga, com a data e o tamanho de cada uma. */
function SeletorDeVersao({
  versoes,
  escolhida,
  atual,
  aoEscolher,
}: {
  versoes: readonly VersaoDoArtefato[];
  escolhida: number;
  atual: number;
  aoEscolher: (numero: number) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const idDoMenu = useId();
  const ordenadas = useMemo(() => [...versoes].sort((a, b) => b.numero - a.numero), [versoes]);

  // Clique fora fecha.
  useEffect(() => {
    if (!aberto) {
      return;
    }
    const aoPressionar = (evento: MouseEvent) => {
      if (raiz.current !== null && evento.target instanceof Node && !raiz.current.contains(evento.target)) {
        setAberto(false);
      }
    };
    document.addEventListener("mousedown", aoPressionar, true);
    return () => document.removeEventListener("mousedown", aoPressionar, true);
  }, [aberto]);

  const aoTeclar = (evento: EventoDeTecladoDoReact<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      setAberto(false);
    }
  };

  const antiga = escolhida !== atual;
  return (
    <div ref={raiz} className="seletor-de-versao nodrag" onKeyDown={aoTeclar}>
      <button
        type="button"
        className={`botao-da-versao nodrag ${antiga ? "botao-da-versao-antiga" : ""}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        aria-label={`Versão ${escolhida} de ${atual}: trocar de versão`}
        title={antiga ? `Vendo a versão ${escolhida} (a atual é a ${atual})` : "Trocar de versão"}
        onClick={() => setAberto((anterior) => !anterior)}
      >
        v{escolhida} ▾
      </button>
      {aberto && (
        <div id={idDoMenu} role="menu" aria-label="Versões do artefato" className="menu-de-versoes painel-flutuante custom-scrollbar nowheel">
          {ordenadas.map((versao) => (
            <button
              key={versao.numero}
              type="button"
              role="menuitemradio"
              aria-checked={versao.numero === escolhida}
              className="item-do-menu item-de-versao nodrag"
              onClick={() => {
                aoEscolher(versao.numero);
                setAberto(false);
              }}
            >
              <span className="font-medium text-primary">
                v{versao.numero}
                {versao.numero === atual ? " · atual" : ""}
              </span>
              <span className="mono text-muted">
                {formatarDataDaVersao(versao.criadaEm)} · {formatarTamanho(versao.tamanho)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Janela ----------------

/** As alças de redimensionar. Memorizadas: o arraste não as re-renderiza a cada quadro. */
const RedimensionadorDoArtefato = memo(function RedimensionadorDoArtefato({
  visivel,
  aoComecar,
  aoTerminar,
}: {
  visivel: boolean;
  aoComecar: () => void;
  aoTerminar: () => void;
}) {
  return (
    <NodeResizer
      isVisible={visivel}
      minWidth={TAMANHO_MINIMO_DO_ARTEFATO.largura}
      minHeight={TAMANHO_MINIMO_DO_ARTEFATO.altura}
      lineClassName="redimensionador-linha"
      handleClassName="redimensionador-alca"
      onResizeStart={aoComecar}
      onResizeEnd={aoTerminar}
    />
  );
});

/**
 * A janela de um artefato no canvas: arrasta pela barra, redimensiona pelas
 * bordas quando selecionada. Como no terminal e na nota, aqui fica só a
 * moldura (o React Flow re-renderiza o nó a cada quadro do arraste); o
 * conteúdo está na `JanelaDoArtefato`, memorizada, que lê o artefato da loja
 * — um evento de outro artefato não a re-renderiza (ADR-11).
 *
 * Enquanto redimensiona, a página não recebe o mouse: senão, passar por cima
 * do iframe perderia o arraste da alça.
 */
export const NoArtefato = memo(function NoArtefato({ data, selected }: NodeProps<TipoDoNo>) {
  const [redimensionando, setRedimensionando] = useState(false);
  const aoComecar = useCallback(() => setRedimensionando(true), []);
  const aoTerminar = useCallback(() => setRedimensionando(false), []);
  return (
    <div className={`moldura-do-artefato ${redimensionando ? "moldura-do-artefato-redimensionando" : ""}`}>
      <RedimensionadorDoArtefato visivel={selected} aoComecar={aoComecar} aoTerminar={aoTerminar} />
      <JanelaDoArtefato artefatoId={data.artefatoId} />
    </div>
  );
});

/** Espera o resumo do artefato chegar do servidor; se ele não existir mais, avisa. */
const JanelaDoArtefato = memo(function JanelaDoArtefato({ artefatoId }: { artefatoId: string }) {
  const artefato = useArtefato(artefatoId);
  const carregada = useListaDeArtefatosCarregada();
  const erroAoCarregar = useErroAoCarregarArtefatos();
  const acoes = useAcoesDosArtefatos();
  const aoFecharVazio = () => acoes.fechar(artefatoId);

  if (artefato === undefined) {
    const mensagem =
      erroAoCarregar !== null
        ? `✗ Não foi possível carregar o artefato. ${erroAoCarregar}`
        : carregada
          ? "Este artefato não existe mais."
          : "carregando artefato…";
    return (
      <div className="janela-artefato">
        <div className={`barra-do-artefato ${ALCA_DO_ARTEFATO}`}>
          <ControlesDoNo lado="inicio" objeto="o artefato" aoFechar={aoFecharVazio} dicaDoFechar={DICA_DE_FECHAR_O_ARTEFATO} />
          <span className="titulo-do-artefato text-muted">artefato</span>
          <span className="flex-1" />
          <ControlesDoNo lado="fim" objeto="o artefato" aoFechar={aoFecharVazio} dicaDoFechar={DICA_DE_FECHAR_O_ARTEFATO} />
        </div>
        <p className={`estado-do-artefato ${erroAoCarregar === null ? "text-muted" : "text-error"}`}>{mensagem}</p>
      </div>
    );
  }

  return <ConteudoDaJanela artefato={artefato} />;
});

function ConteudoDaJanela({ artefato }: { artefato: ResumoDoArtefato }) {
  const acoes = useAcoesDosArtefatos();
  // A versão vista: começa na atual e passa sozinha para cada versão nova.
  const [conhecida, setConhecida] = useState(artefato.versaoAtual);
  const [escolhida, setEscolhida] = useState(artefato.versaoAtual);
  const [destaque, setDestaque] = useState<number | null>(null);
  const [editandoTitulo, setEditandoTitulo] = useState(false);
  const [tituloPendente, setTituloPendente] = useState<string | null>(null);
  const [ampliado, setAmpliado] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [problema, setProblema] = useState<string | null>(null);

  if (artefato.versaoAtual !== conhecida) {
    // Ajuste durante o render (padrão do React para estado derivado de props).
    setConhecida(artefato.versaoAtual);
    if (artefato.versaoAtual > conhecida) {
      setEscolhida(artefato.versaoAtual);
      setDestaque(artefato.versaoAtual);
    }
  }

  // O selo "vN nova" some sozinho.
  useEffect(() => {
    if (destaque === null) {
      return;
    }
    const espera = setTimeout(() => setDestaque(null), DURACAO_DO_DESTAQUE_MS);
    return () => clearTimeout(espera);
  }, [destaque]);

  const existe = artefato.versoes.some((versao) => versao.numero === escolhida);
  const { conteudo, tentarDeNovo } = useConteudoDaVersao(artefato.id, escolhida, existe);
  const titulo = tituloPendente ?? artefato.titulo;
  const pronto = conteudo.situacao === "pronto";
  const historico = useNavegacaoDoQuadro();
  // Só a página HTML pronta tem histórico (o Markdown não navega) e só depois que o script dela avisou.
  const navegacao =
    pronto && artefato.formato === "html" && historico.estado.suportado ? (
      <BotoesDeNavegacao
        podeVoltar={historico.estado.podeVoltar}
        podeAvancar={historico.estado.podeAvancar}
        aoVoltar={historico.voltar}
        aoAvancar={historico.avancar}
      />
    ) : null;
  const fecharAmpliado = useCallback(() => setAmpliado(false), []);
  const verAtual = useCallback(() => setEscolhida(artefato.versaoAtual), [artefato.versaoAtual]);

  async function concluirTitulo(novo: string | null): Promise<void> {
    setEditandoTitulo(false);
    const aparado = novo?.trim() ?? "";
    // Esc ou em branco: fica o título de antes.
    if (aparado === "" || aparado === artefato.titulo) {
      return;
    }
    setProblema(null);
    setTituloPendente(aparado);
    try {
      await acoes.renomear(artefato.id, aparado);
    } catch (falha) {
      setProblema(`Não foi possível renomear: ${mensagemDeErro(falha)}`);
    } finally {
      setTituloPendente(null);
    }
  }

  async function apagar(): Promise<void> {
    if (!window.confirm(CONFIRMACAO_PARA_APAGAR_O_ARTEFATO)) {
      return;
    }
    setProblema(null);
    setApagando(true);
    try {
      // Deu certo: o artefato sai da lista e o canvas tira esta janela.
      await acoes.apagar(artefato.id);
    } catch (falha) {
      setProblema(`Não foi possível apagar o artefato: ${mensagemDeErro(falha)}`);
      setApagando(false);
    }
  }

  function salvarComo(): void {
    if (conteudo.situacao !== "pronto") {
      return;
    }
    try {
      baixar(conteudo.texto, nomeParaSalvar(artefato, escolhida), TIPO_DO_ARQUIVO[artefato.formato]);
    } catch (falha) {
      setProblema(`Não foi possível salvar o arquivo: ${mensagemDeErro(falha)}`);
    }
  }

  const controlesDaJanela = {
    objeto: "o artefato",
    aoFechar: () => acoes.fechar(artefato.id),
    dicaDoFechar: DICA_DE_FECHAR_O_ARTEFATO,
    aoAmpliar: () => setAmpliado(true),
    ampliarDesabilitado: !pronto,
  };

  const corpo = (noCanvas: boolean) => (
    <CorpoDoArtefato
      artefato={artefato}
      numero={escolhida}
      conteudo={conteudo}
      aoTentarDeNovo={tentarDeNovo}
      aoVerAtual={verAtual}
      noCanvas={noCanvas}
      ligarQuadro={historico.ligarQuadro}
      aoCarregarQuadro={historico.aoCarregarQuadro}
    />
  );

  return (
    <div className="janela-artefato">
      <div className={`barra-do-artefato ${ALCA_DO_ARTEFATO}`}>
        <ControlesDoNo lado="inicio" {...controlesDaJanela} />
        <IconeDoFormato formato={artefato.formato} />
        {editandoTitulo ? (
          <CampoDoTitulo titulo={titulo} aoConcluir={(novo) => void concluirTitulo(novo)} />
        ) : (
          <strong className="titulo-do-artefato" title={`${titulo} · clique duplo para renomear`} onDoubleClick={() => setEditandoTitulo(true)}>
            {titulo || "Sem título"}
          </strong>
        )}
        {destaque !== null && (
          <span className="destaque-de-versao-nova" role="status">
            v{destaque} nova
          </span>
        )}
        <span className="flex-1" />
        {navegacao}
        <SeletorDeVersao versoes={artefato.versoes} escolhida={escolhida} atual={artefato.versaoAtual} aoEscolher={setEscolhida} />
        <button
          type="button"
          className="botao-icone nodrag"
          title="Salvar como…"
          aria-label="Salvar o artefato como arquivo"
          disabled={!pronto}
          onClick={salvarComo}
        >
          <IconeSalvar />
        </button>
        <button
          type="button"
          className="botao-icone botao-icone-perigo nodrag"
          title="Apagar o artefato"
          aria-label="Apagar o artefato"
          disabled={apagando}
          onClick={() => void apagar()}
        >
          <IconeLixeira />
        </button>
        <ControlesDoNo lado="fim" {...controlesDaJanela} />
      </div>

      {/* Em tela cheia, a página roda só no modal: duas cópias rodariam os scripts dela duas vezes. */}
      <div className="corpo-do-artefato">
        {ampliado ? <p className="estado-do-artefato text-muted">Aberto em tela cheia.</p> : corpo(true)}
      </div>

      {problema !== null && (
        <div className="rodape-do-artefato text-error" role="alert">
          {problema}
        </div>
      )}

      {ampliado && (
        <JanelaEmTelaCheia
          titulo={artefato.titulo || "Sem título"}
          icone={<IconeDoFormato formato={artefato.formato} />}
          selo={<span className="chip">v{escolhida}</span>}
          navegacao={navegacao}
          aoFechar={fecharAmpliado}
        >
          {corpo(false)}
        </JanelaEmTelaCheia>
      )}
    </div>
  );
}
