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
  return numero.toLocaleString("pt-BR");
}

/** "dd/mm" de hoje: o dia em que o catálogo foi lido. */
function diaDoCatalogo(): string {
  return new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
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
    return "Não deu para baixar: sem conexão com a internet.";
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
  const catalogoDe = dia === null ? "carregando…" : `Catálogo de ${dia}`;

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
            Precisa de internet para instalar.
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
              <h3>Sem conexão com a internet</h3>
              <p>
                Não deu para falar com o marketplace. Confira a rede e tente de novo. O que já está instalado continua
                funcionando.
              </p>
            </>
          ) : (
            <>
              <h3>Não deu para abrir o catálogo</h3>
              <p>{comFalha.erro}</p>
            </>
          )}
          <div className="botoes">
            <button type="button" className="btn btn-outline" onClick={tentarDeNovo}>
              <IconeTentarDeNovo />
              Tentar de novo
            </button>
            <button type="button" className="btn btn-ghost" onClick={aoVerInstaladas}>
              Ver instaladas
            </button>
          </div>
        </div>
        {rodape(
          "sem catálogo",
          <span>
            <IconeInfo tamanho={13} />
            Instalar e buscar precisam de internet.
          </span>,
        )}
      </div>
    );
  }

  const placeholder =
    totais === null
      ? origem === "oficial"
        ? "Buscar plugins oficiais"
        : "Buscar plugins do diretório"
      : origem === "oficial"
        ? `Buscar entre ${formatar(totais.oficial)} plugins oficiais`
        : `Buscar entre ${formatar(totais.aberto)} plugins do diretório`;

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
          aria-label="Buscar plugin"
          value={busca}
          spellCheck={false}
          onChange={(evento) => setBusca(evento.target.value)}
        />
        <kbd aria-hidden="true">/</kbd>
      </div>

      <div className="mk-filtros">
        <div className="mk-seg" role="group" aria-label="Onde procurar">
          <button type="button" aria-pressed={origem === "oficial"} onClick={() => trocarOrigem("oficial")}>
            Oficial {totais !== null && <span className="n">{formatar(totais.oficial)}</span>}
          </button>
          <button type="button" aria-pressed={origem === "aberto"} onClick={() => trocarOrigem("aberto")}>
            Diretório aberto {totais !== null && <span className="n">{formatar(totais.aberto)}</span>}
          </button>
        </div>
        <span className="mk-ordem">
          <IconeOrdem />
          Mais instalados
        </span>
      </div>

      {origem === "aberto" && (
        <div className="mk-aviso" role="note">
          <IconeInfo tamanho={15} />
          <span>
            <b>Aqui qualquer pessoa publica.</b> A Anthropic não revisa estes plugins. Olhe a fonte antes de instalar.
          </span>
        </div>
      )}

      {comLista === null ? (
        <div className="mk-lista" aria-busy="true" aria-live="polite">
          <p className="mk-meta mk-buscando">Buscando o catálogo de plugins…</p>
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
              <h3>Nenhum plugin por aqui</h3>
              <p>O catálogo não trouxe plugins agora. Tente de novo daqui a pouco.</p>
              <div className="botoes">
                <button type="button" className="btn btn-outline" onClick={tentarDeNovo}>
                  <IconeTentarDeNovo />
                  Tentar de novo
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>
                Nada para “{busca.trim()}” {comLista.origem === "oficial" ? "no oficial" : "no diretório aberto"}
              </h3>
              <p>
                Tente uma palavra só, ou em inglês, como o catálogo (por exemplo, spreadsheet).
                {comLista.origem === "oficial" ? " Também dá para procurar no diretório aberto." : ""}
              </p>
              <div className="botoes">
                {comLista.origem === "oficial" && (
                  <button type="button" className="btn btn-outline" onClick={() => trocarOrigem("aberto")}>
                    Procurar no diretório aberto
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={limparBusca}>
                  Limpar busca
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
                {carregandoMais
                  ? "Carregando…"
                  : `Mostrar mais (${formatar(comLista.plugins.length)} de ${formatar(comLista.total)})`}
              </button>
            </div>
          )}
        </div>
      )}

      {rodape(comLista === null ? "carregando…" : catalogoDe)}
    </div>
  );
}

function ExplicacaoDoRodape() {
  return (
    <span>
      <IconeInfo tamanho={13} />
      Plugins instalam no Claude Code e valem também no seu terminal.
    </span>
  );
}

/** O que a linha mostra à direita: Instalar, o giro, o visto ou "Tentar de novo". */
function AcaoDeInstalar({
  plugin,
  situacao,
  aoInstalar,
}: {
  plugin: PluginDoCatalogo;
  situacao: Situacao | null;
  aoInstalar: () => void;
}) {
  if (situacao?.tipo === "instalando") {
    return (
      <span className="mk-instalando" role="status">
        <i className="mk-giro" />
        Instalando…
      </span>
    );
  }
  if (situacao?.tipo === "instalado" || (situacao === null && plugin.instalado)) {
    return (
      <span className="mk-feito">
        <IconeConfirmar />
        Instalado
      </span>
    );
  }
  if (situacao?.tipo === "erro") {
    return (
      <button
        type="button"
        className="btn btn-sm btn-outline"
        aria-label={`Tentar instalar ${plugin.nome} de novo`}
        onClick={(evento) => {
          evento.stopPropagation();
          aoInstalar();
        }}
      >
        Tentar de novo
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-sm btn-outline mk-instalar"
      aria-label={`Instalar ${plugin.nome}`}
      onClick={(evento) => {
        evento.stopPropagation();
        aoInstalar();
      }}
    >
      Instalar
    </button>
  );
}

/** O que o usuário já tem de parecido com o plugin; a ausência do campo (servidor antigo) vale como vazio. */
function jaTemDe(plugin: PluginDoCatalogo): { skills: string[]; servidoresMcp: string[] } {
  return { skills: plugin.jaTem?.skills ?? [], servidoresMcp: plugin.jaTem?.servidoresMcp ?? [] };
}

/** "a, b e c": vírgulas e um "e" antes do último. */
function juntarNomes(nomes: string[]): ReactNode {
  return nomes.map((nome, indice) => (
    <Fragment key={nome}>
      {indice === 0 ? "" : indice === nomes.length - 1 ? " e " : ", "}
      <span className="mono">{nome}</span>
    </Fragment>
  ));
}

/**
 * "a skill x e o servidor MCP y": o que o usuário já tem, no singular ou no plural, só com o que existe.
 * Nulo quando não há nada parecido.
 */
function oQueJaTem(plugin: PluginDoCatalogo): ReactNode {
  const { skills, servidoresMcp } = jaTemDe(plugin);
  const partes: ReactNode[] = [];
  if (skills.length > 0) {
    partes.push(
      <Fragment key="skills">
        {skills.length === 1 ? "a skill " : "as skills "}
        {juntarNomes(skills)}
      </Fragment>,
    );
  }
  if (servidoresMcp.length > 0) {
    partes.push(
      <Fragment key="mcp">
        {servidoresMcp.length === 1 ? "o servidor MCP " : "os servidores MCP "}
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
      {partes[0]} e {partes[1]}
    </>
  );
}

/** A etiqueta "Você já tem" ao lado do nome: o detalhe fica para quem usa leitor de tela e para o balão. */
function EtiquetaJaTem({ plugin }: { plugin: PluginDoCatalogo }) {
  const que = oQueJaTem(plugin);
  if (que === null) {
    return null;
  }
  return (
    <span className="mk-chip mk-ja-tem" title="Instalar este plugin pode duplicar algo que você já tem">
      Você já tem
      <span className="sr-only">: {que}</span>
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
  const estado = situacao?.tipo ?? "padrao";
  const jaInstalado = situacao?.tipo === "instalado" || (situacao === null && plugin.instalado);
  return (
    // O clique na linha inteira é um atalho de mouse: o teclado e o leitor de tela usam o botão do nome.
    <div className="mk-linha" data-nome={plugin.nome} data-estado={estado} onClick={aoAbrir}>
      <AvatarDePlugin nome={plugin.nome} />
      <div className="min-w-0">
        <div className="mk-titulo">
          <button type="button" className="mk-nome mk-nome-botao" title="Ver o detalhe do plugin">
            {plugin.nome}
          </button>
          {plugin.oficial && <SeloOficial />}
          {!jaInstalado && <EtiquetaJaTem plugin={plugin} />}
        </div>
        <p className="mk-desc">{plugin.descricao}</p>
        {situacao?.tipo === "instalando" ? (
          <div className="mk-meta">Baixando do GitHub e preparando…</div>
        ) : situacao?.tipo === "instalado" ? (
          <div className="mk-meta">
            <IconeConfirmar tamanho={12} />
            Pronto. Ele já aparece em Instaladas.
          </div>
        ) : situacao?.tipo === "erro" ? (
          <div className="mk-meta erro" role="alert">
            <IconeSemInternet tamanho={13} />
            {situacao.mensagem}
          </div>
        ) : (
          (plugin.instalacoes !== null || (!plugin.oficial && plugin.fonte !== null)) && (
            <div className="mk-meta">
              {plugin.instalacoes !== null && (
                <>
                  <IconeBaixar tamanho={12} />
                  {formatar(plugin.instalacoes)} {plugin.instalacoes === 1 ? "instalação" : "instalações"}
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
        <AcaoDeInstalar plugin={plugin} situacao={situacao} aoInstalar={aoInstalar} />
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
        Explorar
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
          <div className="acoes">
            {situacao?.tipo === "instalando" ? (
              <span className="mk-instalando" role="status">
                <i className="mk-giro" />
                Instalando…
              </span>
            ) : instalado ? (
              <span className="mk-feito">
                <IconeConfirmar />
                Instalado
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-cta"
                aria-describedby={jaTem !== null ? idDoAviso : undefined}
                onClick={aoInstalar}
              >
                <IconeBaixar tamanho={15} />
                {situacao?.tipo === "erro" ? "Tentar de novo" : jaTem !== null ? "Instalar mesmo assim" : "Instalar"}
              </button>
            )}
            {link !== null && (
              <a className="btn btn-ghost" href={link.url} target="_blank" rel="noopener noreferrer">
                {link.rotulo}
                <IconeLinkExterno />
              </a>
            )}
          </div>
          {jaTem !== null && (
            <p id={idDoAviso} className="mk-ja-tem-nota" role="note">
              <IconeInfo tamanho={15} />
              <span>
                Você já tem {jaTem}. Este plugin parece trazer o mesmo serviço, e instalar pode duplicar.
              </span>
            </p>
          )}
          {situacao?.tipo === "erro" && (
            <div className="mk-meta erro" role="alert">
              <IconeSemInternet tamanho={13} />
              {situacao.mensagem}
            </div>
          )}
          {situacao?.tipo === "instalado" && (
            <div className="mk-meta">
              <IconeConfirmar tamanho={12} />
              Pronto. Ele já aparece em Instaladas.
            </div>
          )}
        </div>
      </div>

      <dl className="mk-ficha">
        {plugin.instalacoes !== null && (
          <div>
            <dt>Instalações</dt>
            <dd>{formatar(plugin.instalacoes)}</dd>
          </div>
        )}
        {plugin.versao !== null && (
          <div>
            <dt>Versão</dt>
            <dd>{plugin.versao}</dd>
          </div>
        )}
        <div>
          <dt>Marketplace</dt>
          <dd>{plugin.oficial ? "Oficial" : plugin.marketplace}</dd>
        </div>
        {plugin.fonte !== null && (
          <div className="largo">
            <dt>Fonte</dt>
            <dd className="mono">{fonteCurta(plugin.fonte)}</dd>
          </div>
        )}
      </dl>

      <section className="mk-antes">
        <h4>Antes de instalar</h4>
        <ul>
          <li>
            <span className="i">
              <IconeBaixar tamanho={16} />
            </span>
            <div>
              <b>Instala no Claude Code, não só aqui</b>
              <span className="t">O plugin também aparece no seu terminal.</span>
            </div>
          </li>
          <li>
            <span className="i">
              <IconeLista />
            </span>
            <div>
              <b>O que vem dentro, você vê depois</b>
              <span className="t">
                Só com o plugin instalado dá para contar skills, subagentes, servidores MCP e hooks.
              </span>
            </div>
          </li>
          <li>
            <span className="i">
              <IconeHook tamanho={16} />
            </span>
            <div>
              <b>Se pedir cuidado, ele chega desligado</b>
              <span className="t">
                Hooks, programas próprios (pasta bin) ou algo que não deu para ler: você revisa e decide se liga.
              </span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}
