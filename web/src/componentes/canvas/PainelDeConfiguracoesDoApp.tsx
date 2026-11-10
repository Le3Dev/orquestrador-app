import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { AjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { definirAutorrecuperacao, useValorDaAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import { useMenuDaBarra } from "../../shared/hooks/useMenuDaBarra";
import {
  type EstiloDosControlesDasJanelas,
  type LadoDoChatFixo,
  usePreferenciasDaTela,
} from "../../shared/hooks/usePreferenciasDaTela";
import "../../theme/preferencias-da-tela.css";

const DICA_DA_AUTORRECUPERACAO = "retoma sozinho quando o Claude trava ou a API falha";

/** As preferências da tela que viram interruptor na seção "Tela". */
type ChaveDoInterruptor = "chatFixoNaEsquerda" | "visualizadorDeCodigo" | "manterBixinhosAteLimpar";

/** `dicaVisivel`: a dica aparece também embaixo do rótulo, não só no title. */
type Interruptor = { chave: ChaveDoInterruptor; rotulo: string; dica: string; dicaVisivel?: boolean };

const INTERRUPTOR_DO_CHAT_FIXO: Interruptor = {
  chave: "chatFixoNaEsquerda",
  rotulo: "Chat fixo",
  dica: "O chat rápido vira uma coluna ao lado do canvas, sempre aberta",
};

/** Os dois lados do chat fixo, na ordem do controle segmentado (logo abaixo do "Chat fixo"). */
const LADOS_DO_CHAT_FIXO: readonly LadoDoChatFixo[] = ["esquerda", "direita"];

/** Os interruptores da seção "Tela" depois do lado do chat, na ordem. */
const OUTROS_INTERRUPTORES_DA_TELA: readonly Interruptor[] = [
  {
    chave: "visualizadorDeCodigo",
    rotulo: "Visualizador de código",
    dica: "mostra o botão Arquivos nos terminais",
    dicaVisivel: true,
  },
  {
    chave: "manterBixinhosAteLimpar",
    rotulo: "Manter bixinhos até limpar à mão",
    dica: "desligado, os que terminam saem sozinhos do canvas",
    dicaVisivel: true,
  },
];

/** Os estilos dos controles das janelas do canvas, na ordem do controle segmentado (o último item da seção "Tela"). */
const ESTILOS_DOS_CONTROLES: readonly { estilo: EstiloDosControlesDasJanelas; rotulo: string; dica: string }[] = [
  { estilo: "automatico", rotulo: "Automático", dica: "Os controles das janelas seguem o sistema" },
  { estilo: "mac", rotulo: "Estilo Mac", dica: "Bolinhas à esquerda do cabeçalho das janelas" },
  { estilo: "windows", rotulo: "Estilo Windows", dica: "Botões à direita do cabeçalho das janelas" },
];

/**
 * A ordem da navegação por teclado: "Chat fixo" (0), os dois lados (1 e 2),
 * os outros interruptores da Tela, os três estilos dos controles das janelas,
 * a "Autorrecuperação" e, no desktop, os Ajustes.
 */
const INDICE_DO_PRIMEIRO_LADO = 1;
const INDICE_DOS_OUTROS_INTERRUPTORES = INDICE_DO_PRIMEIRO_LADO + LADOS_DO_CHAT_FIXO.length;
const INDICE_DO_PRIMEIRO_ESTILO = INDICE_DOS_OUTROS_INTERRUPTORES + OUTROS_INTERRUPTORES_DA_TELA.length;
const INDICE_DA_AUTORRECUPERACAO = INDICE_DO_PRIMEIRO_ESTILO + ESTILOS_DOS_CONTROLES.length;

interface PropsDoPainelDeConfiguracoes {
  /** Os Ajustes do app desktop (pastas e Claude Code); quem usa mostra o `erro`. */
  ajustes: AjustesDoAplicativo;
  /** O que vai dentro do botão ⚙ (o nome acessível é sempre "Configurações"). */
  conteudoDoBotao: ReactNode;
  classeDoBotao: string;
  /** De que lado do botão o painel se alinha: na barra do canvas, à esquerda; na barra de título, à direita. */
  alinhamento: "esquerda" | "direita";
  /** Classes a mais na âncora (ex.: `no-drag` na barra de título). */
  classeDaAncora?: string;
}

/**
 * O ⚙ Configurações e o painel dele, ancorado no botão: a seção "Tela" (chat
 * fixo, o lado dele, visualizador de código, manter os bixinhos e o estilo dos
 * controles das janelas), a seção "Orquestradores"
 * (autorrecuperação, preferência do servidor) e, no app desktop, "Pastas e
 * Claude Code…", que abre a janela dos Ajustes. Ligar ou desligar não fecha o
 * painel (dá para mexer em vários); a navegação por teclado é a do `+ Novo ▾`.
 */
export function PainelDeConfiguracoesDoApp({
  ajustes,
  conteudoDoBotao,
  classeDoBotao,
  alinhamento,
  classeDaAncora = "",
}: PropsDoPainelDeConfiguracoes) {
  const { preferencias, mudarPreferencias } = usePreferenciasDaTela();
  const total = INDICE_DA_AUTORRECUPERACAO + 1 + (ajustes.disponivel ? 1 : 0);

  // A autorrecuperação vale para todos os orquestradores: fica no servidor, não no navegador.
  const autorrecuperacao = useValorDaAutorrecuperacao();
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Uma gravação começada depois da leitura vence a resposta dela.
  const gravacoes = useRef(0);

  const alternar = (chave: ChaveDoInterruptor) => mudarPreferencias({ [chave]: !preferencias[chave] });
  const escolherLado = (lado: LadoDoChatFixo) => mudarPreferencias({ ladoDoChatFixo: lado });
  const escolherEstilo = (estilo: EstiloDosControlesDasJanelas) => mudarPreferencias({ controlesDasJanelas: estilo });

  const alternarAutorrecuperacao = () => {
    if (autorrecuperacao === null || gravando) {
      return;
    }
    const nova = !autorrecuperacao;
    gravacoes.current += 1;
    setErro(null);
    setGravando(true);
    definirAutorrecuperacao(nova);
    api
      .alterarPreferencias({ autorrecuperacao: nova })
      .then((gravadas) => definirAutorrecuperacao(gravadas.autorrecuperacao ?? nova))
      .catch((falha: unknown) => {
        definirAutorrecuperacao(!nova);
        setErro(mensagemDeErro(falha));
      })
      .finally(() => setGravando(false));
  };

  const abrirAjustes = () => {
    menu.fechar(true);
    void ajustes.abrir();
  };

  const menu = useMenuDaBarra(total, (indice) => {
    const lado = LADOS_DO_CHAT_FIXO[indice - INDICE_DO_PRIMEIRO_LADO];
    const outro = OUTROS_INTERRUPTORES_DA_TELA[indice - INDICE_DOS_OUTROS_INTERRUPTORES];
    const estilo = ESTILOS_DOS_CONTROLES[indice - INDICE_DO_PRIMEIRO_ESTILO];
    if (indice === 0) {
      alternar(INTERRUPTOR_DO_CHAT_FIXO.chave);
    } else if (lado !== undefined) {
      escolherLado(lado);
    } else if (outro !== undefined) {
      alternar(outro.chave);
    } else if (estilo !== undefined) {
      escolherEstilo(estilo.estilo);
    } else if (indice === INDICE_DA_AUTORRECUPERACAO) {
      alternarAutorrecuperacao();
    } else if (ajustes.disponivel) {
      abrirAjustes();
    }
  });

  // Relê a cada abertura: outra janela pode ter mudado.
  useEffect(() => {
    if (!menu.aberto) {
      return;
    }
    let vivo = true;
    const gravacoesAntes = gravacoes.current;
    setLendo(true);
    setErro(null);
    api
      .lerPreferencias()
      .then((lidas) => {
        if (vivo && gravacoes.current === gravacoesAntes) {
          definirAutorrecuperacao(lidas.autorrecuperacao);
        }
      })
      .catch((falha: unknown) => {
        if (vivo) {
          setErro(mensagemDeErro(falha));
        }
      })
      .finally(() => {
        if (vivo) {
          setLendo(false);
        }
      });
    return () => {
      vivo = false;
    };
  }, [menu.aberto]);

  const indisponivel = autorrecuperacao === null || gravando;
  const situacaoDaAutorrecuperacao =
    erro ?? (autorrecuperacao === null ? (lendo ? "carregando…" : "não deu para ler") : DICA_DA_AUTORRECUPERACAO);

  return (
    <div ref={menu.ancora} className={`ancora-do-menu ${classeDaAncora}`.trim()}>
      <button
        {...menu.propsDoBotao}
        type="button"
        className={classeDoBotao}
        aria-label="Configurações"
        title="Configurações: tela, pastas e Claude Code"
      >
        {conteudoDoBotao}
      </button>
      {menu.aberto && (
        <div
          id={menu.idDoMenu}
          role="menu"
          aria-label="Configurações"
          className={`menu-do-novo painel-de-configuracoes painel-de-configuracoes-${alinhamento} painel-flutuante surgir surgir-do-topo no-drag`}
          onKeyDown={menu.aoTeclarNoMenu}
        >
          <div role="group" aria-labelledby={`${menu.idDoMenu}-tela`}>
            <span id={`${menu.idDoMenu}-tela`} className="rotulo-tecnico titulo-da-secao-de-configuracoes">
              Tela
            </span>
            {[INTERRUPTOR_DO_CHAT_FIXO, ...OUTROS_INTERRUPTORES_DA_TELA].map((item, posicao) => (
              <Fragment key={item.chave}>
                <button
                  ref={menu.refDoItem(posicao === 0 ? 0 : INDICE_DOS_OUTROS_INTERRUPTORES + posicao - 1)}
                  type="button"
                  role="menuitemcheckbox"
                  tabIndex={-1}
                  className="item-do-menu interruptor"
                  aria-checked={preferencias[item.chave]}
                  title={item.dica}
                  onClick={() => alternar(item.chave)}
                >
                  <span className="flex min-w-0 flex-col items-start leading-tight">
                    <span>{item.rotulo}</span>
                    {item.dicaVisivel === true && <span className="mono text-muted">{item.dica}</span>}
                  </span>
                  <span className="interruptor-trilho" aria-hidden="true" />
                </button>
                {/* Logo abaixo do "Chat fixo": de que lado a coluna fica (vale ao fixar; dá para escolher antes). */}
                {posicao === 0 && (
                  <div
                    role="group"
                    aria-labelledby={`${menu.idDoMenu}-lado`}
                    className={`lado-do-chat-fixo ${preferencias.chatFixoNaEsquerda ? "" : "lado-do-chat-solto"}`}
                  >
                    <span id={`${menu.idDoMenu}-lado`}>Lado</span>
                    <div className="segmentado-do-menu">
                      {LADOS_DO_CHAT_FIXO.map((lado, indice) => (
                        <button
                          key={lado}
                          ref={menu.refDoItem(INDICE_DO_PRIMEIRO_LADO + indice)}
                          type="button"
                          role="menuitemradio"
                          tabIndex={-1}
                          aria-checked={preferencias.ladoDoChatFixo === lado}
                          title={`O chat fixo fica à ${lado} do canvas`}
                          onClick={() => escolherLado(lado)}
                        >
                          {lado}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
            {/* Como as janelas do canvas desenham fechar, minimizar e ampliar; troca na hora, em todas. */}
            <div role="group" aria-labelledby={`${menu.idDoMenu}-controles`} className="controles-das-janelas">
              <span id={`${menu.idDoMenu}-controles`}>Controles das janelas</span>
              <div className="segmentado-do-menu">
                {ESTILOS_DOS_CONTROLES.map((item, indice) => (
                  <button
                    key={item.estilo}
                    ref={menu.refDoItem(INDICE_DO_PRIMEIRO_ESTILO + indice)}
                    type="button"
                    role="menuitemradio"
                    tabIndex={-1}
                    aria-checked={preferencias.controlesDasJanelas === item.estilo}
                    title={item.dica}
                    onClick={() => escolherEstilo(item.estilo)}
                  >
                    {item.rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <hr className="separador-do-menu" />
          <div role="group" aria-labelledby={`${menu.idDoMenu}-orquestradores`}>
            <span id={`${menu.idDoMenu}-orquestradores`} className="rotulo-tecnico titulo-da-secao-de-configuracoes">
              Orquestradores
            </span>
            {/* aria-disabled, não disabled: lendo ou gravando, o item continua na navegação por teclado. */}
            <button
              ref={menu.refDoItem(INDICE_DA_AUTORRECUPERACAO)}
              type="button"
              role="menuitemcheckbox"
              tabIndex={-1}
              className="item-do-menu interruptor"
              aria-checked={autorrecuperacao ?? false}
              aria-disabled={indisponivel}
              aria-busy={lendo || gravando}
              title={DICA_DA_AUTORRECUPERACAO}
              onClick={alternarAutorrecuperacao}
            >
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span>Autorrecuperação</span>
                <span className={`mono ${erro === null ? "text-muted" : "text-error"}`}>{situacaoDaAutorrecuperacao}</span>
              </span>
              <span className="interruptor-trilho" aria-hidden="true" />
            </button>
          </div>
          {ajustes.disponivel && (
            <>
              <hr className="separador-do-menu" />
              <button
                ref={menu.refDoItem(INDICE_DA_AUTORRECUPERACAO + 1)}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="item-do-menu"
                title="Abre os ajustes: pasta dos projetos e Claude Code"
                onClick={abrirAjustes}
              >
                Pastas e Claude Code…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
