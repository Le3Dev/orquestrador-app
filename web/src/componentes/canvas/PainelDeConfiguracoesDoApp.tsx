import { type ReactNode, useEffect, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { AjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { definirAutorrecuperacao, useValorDaAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import { useMenuDaBarra } from "../../shared/hooks/useMenuDaBarra";
import { usePreferenciasDaTela } from "../../shared/hooks/usePreferenciasDaTela";
import "../../theme/preferencias-da-tela.css";

const DICA_DA_AUTORRECUPERACAO = "retoma sozinho quando o Claude trava ou a API falha";

/** Posição do interruptor "Autorrecuperação" na navegação por teclado: logo depois dos da Tela. */
const INDICE_DA_AUTORRECUPERACAO = 2;

/** As preferências da tela que viram interruptor na seção "Tela". */
type ChaveDoInterruptor = "chatFixoNaEsquerda" | "visualizadorDeCodigo";

/** Os interruptores da seção "Tela", na ordem. */
const INTERRUPTORES_DA_TELA: readonly { chave: ChaveDoInterruptor; rotulo: string; dica: string }[] = [
  {
    chave: "chatFixoNaEsquerda",
    rotulo: "Chat fixo à esquerda",
    dica: "O chat rápido vira uma coluna à esquerda do canvas, sempre aberta",
  },
  {
    chave: "visualizadorDeCodigo",
    rotulo: "Visualizador de código",
    dica: "mostra o botão Arquivos nos terminais",
  },
];

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
 * fixo à esquerda e visualizador de código), a seção "Orquestradores"
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
  const total = INTERRUPTORES_DA_TELA.length + 1 + (ajustes.disponivel ? 1 : 0);

  // A autorrecuperação vale para todos os orquestradores: fica no servidor, não no navegador.
  const autorrecuperacao = useValorDaAutorrecuperacao();
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Uma gravação começada depois da leitura vence a resposta dela.
  const gravacoes = useRef(0);

  const alternar = (chave: ChaveDoInterruptor) => mudarPreferencias({ [chave]: !preferencias[chave] });

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
    const item = INTERRUPTORES_DA_TELA[indice];
    if (item !== undefined) {
      alternar(item.chave);
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
            {INTERRUPTORES_DA_TELA.map((item, indice) => (
              <button
                key={item.chave}
                ref={menu.refDoItem(indice)}
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
                  {item.chave === "visualizadorDeCodigo" && <span className="mono text-muted">{item.dica}</span>}
                </span>
                <span className="interruptor-trilho" aria-hidden="true" />
              </button>
            ))}
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
