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
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeConfiguracoes } from "../../shared/idioma/textos/configuracoes";
import "../../theme/preferencias-da-tela.css";

/** As preferências da tela que viram interruptor na seção "Tela". */
type ChaveDoInterruptor = "chatFixoNaEsquerda" | "visualizadorDeCodigo" | "manterBixinhosAteLimpar";

/** `dicaVisivel`: a dica aparece também embaixo do rótulo, não só no title. O rótulo e a dica vêm dos textos, pela chave. */
type Interruptor = { chave: ChaveDoInterruptor; dicaVisivel?: boolean };

const INTERRUPTOR_DO_CHAT_FIXO: Interruptor = { chave: "chatFixoNaEsquerda" };

/** Os dois lados do chat fixo, na ordem do controle segmentado (logo abaixo do "Chat fixo"). */
const LADOS_DO_CHAT_FIXO: readonly LadoDoChatFixo[] = ["esquerda", "direita"];

/** Os interruptores da seção "Tela" depois do lado do chat, na ordem. */
const OUTROS_INTERRUPTORES_DA_TELA: readonly Interruptor[] = [
  { chave: "visualizadorDeCodigo", dicaVisivel: true },
  { chave: "manterBixinhosAteLimpar", dicaVisivel: true },
];

/** Os estilos dos controles das janelas do canvas, na ordem do controle segmentado (o último item da seção "Tela"). */
const ESTILOS_DOS_CONTROLES: readonly { estilo: EstiloDosControlesDasJanelas }[] = [
  { estilo: "automatico" },
  { estilo: "mac" },
  { estilo: "windows" },
];

/** O rótulo e a dica de cada interruptor da seção "Tela", pela chave. */
const TEXTO_DO_INTERRUPTOR = {
  chatFixoNaEsquerda: "chatFixo",
  visualizadorDeCodigo: "visualizador",
  manterBixinhosAteLimpar: "bixinhos",
} as const satisfies Record<ChaveDoInterruptor, "chatFixo" | "visualizador" | "bixinhos">;

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
  const t = useTextos(textosDeConfiguracoes).painelDaBarra;
  const estilosDosControles = useTextos(textosDeConfiguracoes).estilosDosControles;
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
    erro ?? (autorrecuperacao === null ? (lendo ? t.carregando : t.naoDeuParaLer) : t.autorrecuperacaoDica);

  return (
    <div ref={menu.ancora} className={`ancora-do-menu ${classeDaAncora}`.trim()}>
      <button
        {...menu.propsDoBotao}
        type="button"
        className={classeDoBotao}
        aria-label={t.botaoAria}
        title={t.botaoDica}
      >
        {conteudoDoBotao}
      </button>
      {menu.aberto && (
        <div
          id={menu.idDoMenu}
          role="menu"
          aria-label={t.botaoAria}
          className={`menu-do-novo painel-de-configuracoes painel-de-configuracoes-${alinhamento} painel-flutuante surgir surgir-do-topo no-drag`}
          onKeyDown={menu.aoTeclarNoMenu}
        >
          <div role="group" aria-labelledby={`${menu.idDoMenu}-tela`}>
            <span id={`${menu.idDoMenu}-tela`} className="rotulo-tecnico titulo-da-secao-de-configuracoes">
              {t.tela}
            </span>
            {[INTERRUPTOR_DO_CHAT_FIXO, ...OUTROS_INTERRUPTORES_DA_TELA].map((item, posicao) => {
              const texto = t[TEXTO_DO_INTERRUPTOR[item.chave]];
              return (
              <Fragment key={item.chave}>
                <button
                  ref={menu.refDoItem(posicao === 0 ? 0 : INDICE_DOS_OUTROS_INTERRUPTORES + posicao - 1)}
                  type="button"
                  role="menuitemcheckbox"
                  tabIndex={-1}
                  className="item-do-menu interruptor"
                  aria-checked={preferencias[item.chave]}
                  title={texto.dica}
                  onClick={() => alternar(item.chave)}
                >
                  <span className="flex min-w-0 flex-col items-start leading-tight">
                    <span>{texto.rotulo}</span>
                    {item.dicaVisivel === true && <span className="mono text-muted">{texto.dica}</span>}
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
                    <span id={`${menu.idDoMenu}-lado`}>{t.lado}</span>
                    <div className="segmentado-do-menu">
                      {LADOS_DO_CHAT_FIXO.map((lado, indice) => (
                        <button
                          key={lado}
                          ref={menu.refDoItem(INDICE_DO_PRIMEIRO_LADO + indice)}
                          type="button"
                          role="menuitemradio"
                          tabIndex={-1}
                          aria-checked={preferencias.ladoDoChatFixo === lado}
                          title={lado === "esquerda" ? t.ladoEsquerdaDica : t.ladoDireitaDica}
                          onClick={() => escolherLado(lado)}
                        >
                          {lado === "esquerda" ? t.ladoEsquerda : t.ladoDireita}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Fragment>
              );
            })}
            {/* Como as janelas do canvas desenham fechar, minimizar e ampliar; troca na hora, em todas. */}
            <div role="group" aria-labelledby={`${menu.idDoMenu}-controles`} className="controles-das-janelas">
              <span id={`${menu.idDoMenu}-controles`}>{t.controlesDasJanelas}</span>
              <div className="segmentado-do-menu">
                {ESTILOS_DOS_CONTROLES.map((item, indice) => (
                  <button
                    key={item.estilo}
                    ref={menu.refDoItem(INDICE_DO_PRIMEIRO_ESTILO + indice)}
                    type="button"
                    role="menuitemradio"
                    tabIndex={-1}
                    aria-checked={preferencias.controlesDasJanelas === item.estilo}
                    title={estilosDosControles[item.estilo].dica}
                    onClick={() => escolherEstilo(item.estilo)}
                  >
                    {estilosDosControles[item.estilo].rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <hr className="separador-do-menu" />
          <div role="group" aria-labelledby={`${menu.idDoMenu}-orquestradores`}>
            <span id={`${menu.idDoMenu}-orquestradores`} className="rotulo-tecnico titulo-da-secao-de-configuracoes">
              {t.orquestradores}
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
              title={t.autorrecuperacaoDica}
              onClick={alternarAutorrecuperacao}
            >
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span>{t.autorrecuperacao}</span>
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
                title={t.ajustesDica}
                onClick={abrirAjustes}
              >
                {t.ajustesRotulo}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
