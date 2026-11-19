import {
  Fragment,
  type KeyboardEvent as EventoDeTecladoDoReact,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { api, ErroDaApi, mensagemDeErro } from "../../shared/api/cliente";
import type { OrigemDoCatalogo, PluginDoCatalogo, PluginInstalado } from "../../shared/api/tipos";
import { idiomaAtual, localeDoIdioma, textosAtuais, useTextos } from "../../shared/idioma/idioma";
import { textosDePaineis } from "../../shared/idioma/textos/paineis";
import { AvatarDePlugin, SeloOficial } from "./AvatarDePlugin";
import { linkDaFonte } from "./dadosDoPlugin";
import { IconeInfo, IconeLista, IconeLupa } from "./IconesDasIlhas";
import {
  IconeBaixar,
  IconeConfirmar,
  IconeHook,
  IconeLinkExterno,
  IconeOrdem,
  IconeSemInternet,
  IconeTentarDeNovo,
  IconeVoltar,
} from "./IconesDoMarketplace";

/** Quanto se espera depois da última tecla para buscar no catálogo. */
const ESPERA_DA_BUSCA_MS = 250;

/** Minúsculas e sem acento, como a lista de instaladas. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function formatar(numero: number): string {
  return numero.toLocaleString(localeDoIdioma(idiomaAtual()));
}

/** "dd/mm" de hoje: o dia em que o catálogo foi lido. */
function diaDoCatalogo(): string {
  return new Date().toLocaleDateString(localeDoIdioma(idiomaAtual()), { day: "2-digit", month: "2-digit" });
}

/** Como está a instalação de um plugin que o usuário mandou instalar agora. */
type Situacao = { tipo: "instalando" } | { tipo: "instalado" } | { tipo: "erro"; mensagem: string };

/** O resultado de uma leitura, preso à consulta que o gerou. */
type Leitura =
  | { chave: string; busca: string; origem: OrigemDoCatalogo; plugins: PluginDoCatalogo[]; total: number }
  | { chave: string; busca: string; origem: OrigemDoCatalogo; erro: string; semInternet: boolean };

interface Props {
  /** Instalou: o menu e a aba Instaladas precisam reler. */
  aoMudar: () => void;
  /** Plugin com hook, pasta bin ou não verificado chega desligado: o painel mostra a confirmação para ligar. */
  aoPedirConfirmacao: (plugin: PluginInstalado, fonte: string | null) => void;
  /** "Ver instaladas": leva à outra aba. */
  aoVerInstaladas: () => void;
}

/** A frase de erro de uma instalação: o 503 fala de internet, o resto traz a mensagem do servidor. */
function mensagemDaInstalacao(falha: unknown): string {
  if (falha instanceof ErroDaApi && falha.status === 503) {
    return textosAtuais(textosDePaineis).catalogo.semInternetAoInstalar;
  }
  return mensagemDeErro(falha);
}

/**
 * A aba Explorar: o catálogo de plugins do Claude Code. Abre no marketplace oficial, com o diretório aberto
 * atrás de um filtro (e um aviso de que lá qualquer pessoa publica). Cada linha instala com um clique; clicar
 * na linha abre o detalhe. Os estados: carregando, busca sem resultado, sem internet, erro, instalando e
 * instalado. As instalações vão uma de cada vez, em fila.
 */
export function CatalogoDePlugins({ aoMudar, aoPedirConfirmacao, aoVerInstaladas }: Props) {
  const t = useTextos(textosDePaineis).catalogo;
  const [origem, setOrigem] = useState<Exclude<OrigemDoCatalogo, "todos">>("oficial");
  const [busca, setBusca] = useState("");
  const [buscaEfetiva, setBuscaEfetiva] = useState("");
  const [tentativa, setTentativa] = useState(0);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [totais, setTotais] = useState<{ oficial: number; aberto: number } | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erroDeMais, setErroDeMais] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<PluginDoCatalogo | null>(null);
  const [situacoes, setSituacoes] = useState<Record<string, Situacao>>({});
  const fila = useRef<Promise<void>>(Promise.resolve());
  const campoDeBusca = useRef<HTMLInputElement>(null);

  const chave = `${origem}\n${buscaEfetiva}\n${tentativa}`;

  // A busca espera um pouco depois da última tecla, para não consultar a cada letra.
  useEffect(() => {
    const termo = normalizar(busca.trim());
    if (termo === buscaEfetiva) {
      return;
    }
    const espera = setTimeout(() => setBuscaEfetiva(termo), ESPERA_DA_BUSCA_MS);
    return () => clearTimeout(espera);
  }, [busca, buscaEfetiva]);

  useEffect(() => {
    let atual = true;
    const controle = new AbortController();
    api
      .lerCatalogoDePlugins({ busca: buscaEfetiva, origem }, controle.signal)
      .then((listagem) => {
        if (!atual) {
          return;
        }
        setLeitura({ chave, busca: buscaEfetiva, origem, plugins: listagem.plugins, total: listagem.total });
        setErroDeMais(null);
        // Os totais dos filtros são os do catálogo inteiro: uma busca não os troca.
        setTotais((anterior) => (buscaEfetiva === "" || anterior === null ? listagem.totais : anterior));
        setDia(diaDoCatalogo());
      })
      .catch((falha: unknown) => {
        if (atual) {
          setLeitura({
            chave,
            busca: buscaEfetiva,
            origem,
            erro: mensagemDeErro(falha),
            semInternet: falha instanceof ErroDaApi && falha.status === 503,
          });
        }
      });
    return () => {
      atual = false;
      controle.abort();
    };
  }, [chave, buscaEfetiva, origem]);

  const lida = leitura !== null && leitura.chave === chave ? leitura : null;
  const comLista = lida !== null && "plugins" in lida ? lida : null;
  const comFalha = lida !== null && "erro" in lida ? lida : null;

  const carregarMais = () => {
    if (comLista === null) {
      return;
    }
    setCarregandoMais(true);
    setErroDeMais(null);
    api
      .lerCatalogoDePlugins({ busca: buscaEfetiva, origem, deslocamento: comLista.plugins.length })
      .then((listagem) => {
        setLeitura((anterior) => {
          if (anterior === null || anterior.chave !== chave || !("plugins" in anterior)) {
            return anterior;
          }
          const jaTem = new Set(anterior.plugins.map((plugin) => plugin.id));
          const novos = listagem.plugins.filter((plugin) => !jaTem.has(plugin.id));
          return { ...anterior, plugins: [...anterior.plugins, ...novos], total: listagem.total };
        });
      })
      .catch((falha: unknown) => setErroDeMais(mensagemDeErro(falha)))
      .finally(() => setCarregandoMais(false));
  };

  const instalar = (plugin: PluginDoCatalogo) => {
    setSituacoes((atuais) => ({ ...atuais, [plugin.id]: { tipo: "instalando" } }));
    // Uma instalação por vez: a seguinte espera a anterior e a linha dela já mostra "Instalando…".
    fila.current = fila.current.then(async () => {
      try {
        const resultado = await api.instalarPlugin(plugin.id);
        setSituacoes((atuais) => ({ ...atuais, [plugin.id]: { tipo: "instalado" } }));
        aoMudar();
        if (resultado.precisaConfirmar) {
          aoPedirConfirmacao(resultado.plugin, plugin.fonte);
        }
      } catch (falha) {
        setSituacoes((atuais) => ({ ...atuais, [plugin.id]: { tipo: "erro", mensagem: mensagemDaInstalacao(falha) } }));
      }
    });
  };

  const trocarOrigem = (nova: Exclude<OrigemDoCatalogo, "todos">) => {
    setOrigem(nova);
    setErroDeMais(null);
  };

  const limparBusca = () => {
    setBusca("");
    setBuscaEfetiva("");
    campoDeBusca.current?.focus();
  };

  const tentarDeNovo = () => {
    setLeitura(null);
    setTentativa((atual) => atual + 1);
  };

  // Esc volta do detalhe para a lista; com a lista na tela, ele fecha o painel (que cuida disso).
  const aoTeclar = (evento: EventoDeTecladoDoReact<HTMLDivElement>) => {
    if (evento.key === "Escape" && detalhe !== null) {
      evento.preventDefault();
      evento.stopPropagation();
      setDetalhe(null);
    }
  };

  const rodape = (direita: string, esquerda: ReactNode = <ExplicacaoDoRodape />) => (
    <footer className="mk-rodape">
      {esquerda}
      <span className="mono">{direita}</span>
    </footer>
  );
  const catalogoDe = dia === null ? t.carregando : t.catalogoDe(dia);

  if (detalhe !== null) {
    return (
      <div className="mk-catalogo" onKeyDown={aoTeclar}>
        <DetalheDoPlugin
          plugin={detalhe}
          situacao={situacoes[detalhe.id] ?? null}
          aoVoltar={() => setDetalhe(null)}
          aoInstalar={() => instalar(detalhe)}
        />
        {rodape(
          catalogoDe,
          <span>
            <IconeSemInternet tamanho={13} />
            {t.precisaDeInternet}
          </span>,
        )}
      </div>
    );
  }

  if (comFalha !== null) {
    return (
      <div className="mk-catalogo">
        <div className="mk-vazio" role="alert">
          <span className="tile">
            <IconeSemInternet tamanho={24} />
          </span>
          {comFalha.semInternet ? (
            <>
              <h3>{t.semConexao}</h3>
              <p>{t.semConexaoTexto}</p>
            </>
          ) : (
            <>
              <h3>{t.naoAbriu}</h3>
              <p>{comFalha.erro}</p>
            </>
          )}
          <div className="botoes">
            <button type="button" className="btn btn-outline" onClick={tentarDeNovo}>
              <IconeTentarDeNovo />
              {t.tentarDeNovo}
            </button>
            <button type="button" className="btn btn-ghost" onClick={aoVerInstaladas}>
              {t.verInstaladas}
            </button>
          </div>
        </div>
        {rodape(
          t.semCatalogo,
          <span>
            <IconeInfo tamanho={13} />
            {t.instalarEBuscarPrecisam}
          </span>,
        )}
      </div>
    );
  }

  const placeholder =
    totais === null
      ? origem === "oficial"
        ? t.buscarOficiais
        : t.buscarDoDiretorio
      : origem === "oficial"
        ? t.buscarEntreOficiais(formatar(totais.oficial))
        : t.buscarEntreDoDiretorio(formatar(totais.aberto));

  return (
    <div className="mk-catalogo">
      <div className="mk-busca">
        <span className="lupa">
          <IconeLupa tamanho={16} />
        </span>
        <input
          ref={campoDeBusca}
          type="search"
          placeholder={placeholder}
          aria-label={t.buscarPlugin}
          value={busca}
          spellCheck={false}
          onChange={(evento) => setBusca(evento.target.value)}
        />
        <kbd aria-hidden="true">/</kbd>
      </div>

      <div className="mk-filtros">
        <div className="mk-seg" role="group" aria-label={t.ondeProcurar}>
          <button type="button" aria-pressed={origem === "oficial"} onClick={() => trocarOrigem("oficial")}>
            {t.oficial} {totais !== null && <span className="n">{formatar(totais.oficial)}</span>}
          </button>
          <button type="button" aria-pressed={origem === "aberto"} onClick={() => trocarOrigem("aberto")}>
            {t.diretorioAberto} {totais !== null && <span className="n">{formatar(totais.aberto)}</span>}
          </button>
        </div>
        <span className="mk-ordem">
          <IconeOrdem />
          {t.maisInstalados}
        </span>
      </div>

      {origem === "aberto" && (
        <div className="mk-aviso" role="note">
          <IconeInfo tamanho={15} />
          <span>
            <b>{t.avisoAbertoNegrito}</b> {t.avisoAbertoResto}
          </span>
        </div>
      )}

      {comLista === null ? (
        <div className="mk-lista" aria-busy="true" aria-live="polite">
          <p className="mk-meta mk-buscando">{t.buscando}</p>
          {[148, 126, 164, 138].map((largura, indice) => (
            <div key={indice} className="mk-linha mk-esqueleto" aria-hidden="true">
              <span className="mk-sk mk-sk-avatar" />
              <div>
                <span className="mk-sk" style={{ width: largura, height: 13, marginTop: 3 }} />
                <span className="mk-sk" style={{ width: "92%", height: 11, marginTop: 10 }} />
                <span className="mk-sk" style={{ width: "64%", height: 11, marginTop: 6 }} />
              </div>
              <span className="mk-sk mk-sk-botao" />
            </div>
          ))}
        </div>
      ) : comLista.plugins.length === 0 ? (
        <div className="mk-vazio">
          <span className="tile">
            <IconeLupa tamanho={24} />
          </span>
          {comLista.busca === "" ? (
            <>
              <h3>{t.nenhumPlugin}</h3>
              <p>{t.nenhumPluginTexto}</p>
              <div className="botoes">
                <button type="button" className="btn btn-outline" onClick={tentarDeNovo}>
                  <IconeTentarDeNovo />
                  {t.tentarDeNovo}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>{t.nadaPara(busca.trim(), comLista.origem === "oficial")}</h3>
              <p>
                {t.dicaDaBusca}
                {comLista.origem === "oficial" ? ` ${t.tambemNoAberto}` : ""}
              </p>
              <div className="botoes">
                {comLista.origem === "oficial" && (
                  <button type="button" className="btn btn-outline" onClick={() => trocarOrigem("aberto")}>
                    {t.procurarNoAberto}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={limparBusca}>
                  {t.limparBusca}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mk-lista custom-scrollbar" aria-live="polite">
          {comLista.plugins.map((plugin) => (
            <LinhaDoCatalogo
              key={plugin.id}
              plugin={plugin}
              situacao={situacoes[plugin.id] ?? null}
              aoAbrir={() => setDetalhe(plugin)}
              aoInstalar={() => instalar(plugin)}
            />
          ))}
          {comLista.plugins.length < comLista.total && (
            <div className="mk-mais">
              {erroDeMais !== null && (
                <span className="mk-meta erro" role="alert">
                  <IconeSemInternet tamanho={13} />
                  {erroDeMais}
                </span>
              )}
              <button type="button" className="btn btn-sm btn-ghost" disabled={carregandoMais} onClick={carregarMais}>
                {carregandoMais ? t.carregandoMais : t.mostrarMais(formatar(comLista.plugins.length), formatar(comLista.total))}
              </button>
            </div>
          )}
        </div>
      )}

      {rodape(comLista === null ? t.carregando : catalogoDe)}
    </div>
  );
}

function ExplicacaoDoRodape() {
  const t = useTextos(textosDePaineis).catalogo;
  return (
    <span>
      <IconeInfo tamanho={13} />
      {t.explicacaoDoRodape}
    </span>
  );
}

/**
 * O que a linha mostra à direita: Instalar, o giro, o visto ou "Tentar de novo". Quando o usuário já tem algo
 * parecido (`idDaExplicacao` é o da linha que diz o quê), o botão vira "Instalar mesmo assim", em contorno
 * neutro: a ação continua ao alcance, sem o peso de quem não tem nada parecido.
 */
function AcaoDeInstalar({
  plugin,
  situacao,
  aoInstalar,
  idDaExplicacao,
}: {
  plugin: PluginDoCatalogo;
  situacao: Situacao | null;
  aoInstalar: () => void;
  idDaExplicacao?: string;
}) {
  const t = useTextos(textosDePaineis).catalogo;
  const parecido = idDaExplicacao !== undefined;
  if (situacao?.tipo === "instalando") {
    return (
      <span className="mk-instalando" role="status">
        <i className="mk-giro" />
        {t.instalando}
      </span>
    );
  }
  if (situacao?.tipo === "instalado" || (situacao === null && plugin.instalado)) {
    return (
      <span className="mk-feito">
        <IconeConfirmar />
        {t.instalado}
      </span>
    );
  }
  if (situacao?.tipo === "erro") {
    return (
      <button
        type="button"
        className="btn btn-sm btn-outline"
        aria-label={t.tentarInstalarDeNovo(plugin.nome)}
        onClick={(evento) => {
          evento.stopPropagation();
          aoInstalar();
        }}
      >
        {t.tentarDeNovo}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`btn btn-sm btn-outline mk-instalar${parecido ? " mk-instalar-parecido" : ""}`}
      aria-label={parecido ? t.instalarMesmoAssimNome(plugin.nome) : t.instalarNome(plugin.nome)}
      aria-describedby={idDaExplicacao}
      onClick={(evento) => {
        evento.stopPropagation();
        aoInstalar();
      }}
    >
      {parecido ? t.instalarMesmoAssim : t.instalar}
    </button>
  );
}

/** O que o usuário já tem de parecido com o plugin; a ausência do campo (servidor antigo) vale como vazio. */
function jaTemDe(plugin: PluginDoCatalogo): { skills: string[]; servidoresMcp: string[] } {
  return { skills: plugin.jaTem?.skills ?? [], servidoresMcp: plugin.jaTem?.servidoresMcp ?? [] };
}

/** "a, b e c": vírgulas e um "e" antes do último. */
function juntarNomes(nomes: string[]): ReactNode {
  const e = textosAtuais(textosDePaineis).catalogo.e;
  return nomes.map((nome, indice) => (
    <Fragment key={nome}>
      {indice === 0 ? "" : indice === nomes.length - 1 ? ` ${e} ` : ", "}
      <span className="mono">{nome}</span>
    </Fragment>
  ));
}

/**
 * "a skill x e o servidor MCP y": o que o usuário já tem, no singular ou no plural, só com o que existe.
 * Nulo quando não há nada parecido.
 */
function oQueJaTem(plugin: PluginDoCatalogo): ReactNode {
  const t = textosAtuais(textosDePaineis).catalogo;
  const { skills, servidoresMcp } = jaTemDe(plugin);
  const partes: ReactNode[] = [];
  if (skills.length > 0) {
    partes.push(
      <Fragment key="skills">
        {skills.length === 1 ? t.umaSkill : t.variasSkills}
        {juntarNomes(skills)}
      </Fragment>,
    );
  }
  if (servidoresMcp.length > 0) {
    partes.push(
      <Fragment key="mcp">
        {servidoresMcp.length === 1 ? t.umMcp : t.variosMcp}
        {juntarNomes(servidoresMcp)}
      </Fragment>,
    );
  }
  if (partes.length === 0) {
    return null;
  }
  return partes.length === 1 ? (
    partes[0]
  ) : (
    <>
      {partes[0]} {t.e} {partes[1]}
    </>
  );
}

/**
 * A etiqueta "Já tem algo parecido" ao lado do nome. Sem balão: o que o usuário já tem está escrito na linha
 * (a meta), e é essa meta que o botão de instalar aponta com `aria-describedby`.
 */
function EtiquetaJaTem() {
  const t = useTextos(textosDePaineis).catalogo;
  return (
    <span className="mk-chip mk-ja-tem">
      <IconeInfo tamanho={10} />
      {t.jaTemAlgoParecido}
    </span>
  );
}

/** A fonte sem o "https://", para caber na meta da linha. */
function fonteCurta(fonte: string): string {
  return fonte.replace(/^https?:\/\/(www\.)?/i, "").replace(/\.git$/i, "");
}

function LinhaDoCatalogo({
  plugin,
  situacao,
  aoAbrir,
  aoInstalar,
}: {
  plugin: PluginDoCatalogo;
  situacao: Situacao | null;
  aoAbrir: () => void;
  aoInstalar: () => void;
}) {
  const t = useTextos(textosDePaineis).catalogo;
  const estado = situacao?.tipo ?? "padrao";
  const jaInstalado = situacao?.tipo === "instalado" || (situacao === null && plugin.instalado);
  const idDaExplicacao = useId();
  // Os três estados, por prioridade: instalado, depois "já tem algo parecido", depois nada a ver.
  const jaTem = jaInstalado ? null : oQueJaTem(plugin);
  const parecido = jaTem !== null;
  return (
    // O clique na linha inteira é um atalho de mouse: o teclado e o leitor de tela usam o botão do nome.
    <div
      className="mk-linha"
      data-nome={plugin.nome}
      data-estado={estado}
      data-ja-tem={parecido ? "" : undefined}
      onClick={aoAbrir}
    >
      <AvatarDePlugin nome={plugin.nome} />
      <div className="min-w-0">
        <div className="mk-titulo">
          <button type="button" className="mk-nome mk-nome-botao" title={t.verDetalhe}>
            {plugin.nome}
          </button>
          {plugin.oficial && <SeloOficial />}
          {parecido && <EtiquetaJaTem />}
        </div>
        <p className="mk-desc">{plugin.descricao}</p>
        {situacao?.tipo === "instalando" ? (
          <div className="mk-meta">{t.baixando}</div>
        ) : situacao?.tipo === "instalado" ? (
          <div className="mk-meta">
            <IconeConfirmar tamanho={12} />
            {oQueJaTem(plugin) === null ? t.pronto : t.prontoOsDois}
          </div>
        ) : situacao?.tipo === "erro" ? (
          <div className="mk-meta erro" role="alert">
            <IconeSemInternet tamanho={13} />
            {situacao.mensagem}
          </div>
        ) : jaInstalado ? (
          <div className="mk-meta">
            <IconeConfirmar tamanho={12} />
            {t.estaEmInstaladas}
          </div>
        ) : jaTem !== null ? (
          <div id={idDaExplicacao} className="mk-meta mk-ja-tem-meta">
            <IconeInfo tamanho={12} />
            <span>
              {t.voceJaTem}
              {jaTem}.
            </span>
          </div>
        ) : (
          (plugin.instalacoes !== null || (!plugin.oficial && plugin.fonte !== null)) && (
            <div className="mk-meta">
              {plugin.instalacoes !== null && (
                <>
                  <IconeBaixar tamanho={12} />
                  {formatar(plugin.instalacoes)} {plugin.instalacoes === 1 ? t.instalacaoUma : t.instalacoesVarias}
                </>
              )}
              {!plugin.oficial && plugin.fonte !== null && (
                <>
                  {plugin.instalacoes !== null && <span>·</span>}
                  <span className="mono">{fonteCurta(plugin.fonte)}</span>
                </>
              )}
            </div>
          )
        )}
      </div>
      <div className="acao">
        <AcaoDeInstalar
          plugin={plugin}
          situacao={situacao}
          aoInstalar={aoInstalar}
          idDaExplicacao={parecido && situacao === null ? idDaExplicacao : undefined}
        />
      </div>
      {situacao?.tipo === "instalando" && <div className="mk-progresso" />}
    </div>
  );
}

/** O detalhe de um plugin, no lugar da lista: o que se sabe antes de instalar, em linguagem de gente. */
function DetalheDoPlugin({
  plugin,
  situacao,
  aoVoltar,
  aoInstalar,
}: {
  plugin: PluginDoCatalogo;
  situacao: Situacao | null;
  aoVoltar: () => void;
  aoInstalar: () => void;
}) {
  const t = useTextos(textosDePaineis).catalogo;
  const voltar = useRef<HTMLButtonElement>(null);
  const link = linkDaFonte(plugin.fonte);
  const instalado = situacao?.tipo === "instalado" || (situacao === null && plugin.instalado);
  const idDoAviso = useId();
  const jaTem = instalado ? null : oQueJaTem(plugin);

  useEffect(() => {
    voltar.current?.focus();
  }, []);

  return (
    <div className="mk-detalhe custom-scrollbar">
      <button ref={voltar} type="button" className="btn btn-sm btn-ghost mk-voltar" onClick={aoVoltar}>
        <IconeVoltar />
        {t.explorar}
      </button>
      <div className="mk-heroi">
        <AvatarDePlugin nome={plugin.nome} tamanho={64} />
        <div>
          <h3>{plugin.nome}</h3>
          <div className="linha">
            {plugin.oficial && <SeloOficial />}
            <span className="mono">{plugin.marketplace}</span>
          </div>
          <p className="d">{plugin.descricao}</p>
          {jaTem !== null && (
            <p id={idDoAviso} className="mk-ja-tem-nota" role="note">
              <IconeInfo tamanho={15} />
              <span>
                {t.voceJaTem}
                {jaTem}
                {t.jaTemDetalhe}
              </span>
            </p>
          )}
          <div className="acoes">
            {situacao?.tipo === "instalando" ? (
              <span className="mk-instalando" role="status">
                <i className="mk-giro" />
                {t.instalando}
              </span>
            ) : instalado ? (
              <span className="mk-feito">
                <IconeConfirmar />
                {t.instalado}
              </span>
            ) : (
              // Com algo parecido já instalado, o botão perde o laranja: a ação segue ao alcance, sem ser a principal.
              <button
                type="button"
                className={jaTem !== null ? "btn btn-outline" : "btn btn-cta"}
                aria-describedby={jaTem !== null ? idDoAviso : undefined}
                onClick={aoInstalar}
              >
                <IconeBaixar tamanho={15} />
                {situacao?.tipo === "erro" ? t.tentarDeNovo : jaTem !== null ? t.instalarMesmoAssim : t.instalar}
              </button>
            )}
            {link !== null && (
              <a className="btn btn-ghost" href={link.url} target="_blank" rel="noopener noreferrer">
                {link.rotulo}
                <IconeLinkExterno />
              </a>
            )}
          </div>
          {situacao?.tipo === "erro" && (
            <div className="mk-meta erro" role="alert">
              <IconeSemInternet tamanho={13} />
              {situacao.mensagem}
            </div>
          )}
          {situacao?.tipo === "instalado" && (
            <div className="mk-meta">
              <IconeConfirmar tamanho={12} />
              {t.pronto}
            </div>
          )}
        </div>
      </div>

      <dl className="mk-ficha">
        {plugin.instalacoes !== null && (
          <div>
            <dt>{t.instalacoes}</dt>
            <dd>{formatar(plugin.instalacoes)}</dd>
          </div>
        )}
        {plugin.versao !== null && (
          <div>
            <dt>{t.versao}</dt>
            <dd>{plugin.versao}</dd>
          </div>
        )}
        <div>
          <dt>{t.marketplace}</dt>
          <dd>{plugin.oficial ? t.oficial : plugin.marketplace}</dd>
        </div>
        {plugin.fonte !== null && (
          <div className="largo">
            <dt>{t.fonte}</dt>
            <dd className="mono">{fonteCurta(plugin.fonte)}</dd>
          </div>
        )}
      </dl>

      <section className="mk-antes">
        <h4>{t.antesDeInstalar}</h4>
        <ul>
          <li>
            <span className="i">
              <IconeBaixar tamanho={16} />
            </span>
            <div>
              <b>{t.antes1Titulo}</b>
              <span className="t">{t.antes1Texto}</span>
            </div>
          </li>
          <li>
            <span className="i">
              <IconeLista />
            </span>
            <div>
              <b>{t.antes2Titulo}</b>
              <span className="t">{t.antes2Texto}</span>
            </div>
          </li>
          <li>
            <span className="i">
              <IconeHook tamanho={16} />
            </span>
            <div>
              <b>{t.antes3Titulo}</b>
              <span className="t">{t.antes3Texto}</span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}
