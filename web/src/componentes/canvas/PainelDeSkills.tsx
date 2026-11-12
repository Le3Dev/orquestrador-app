import { useCallback, useEffect, useId, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { PluginInstalado } from "../../shared/api/tipos";
import { IconeFechar, IconeSkills } from "../Icones";
import { CatalogoDePlugins } from "./CatalogoDePlugins";
import { ConfirmacaoDeHook } from "./ConfirmacaoDeHook";
import { ListaDeSkills, type OrquestradorParaSkills } from "./ListaDeSkills";
import "../../theme/marketplace-de-skills.css";

/** As duas abas do painel: o que já está instalado e o catálogo do marketplace. */
export type AbaDoPainelDeSkills = "instaladas" | "explorar";

interface Props {
  /** Os orquestradores abertos no canvas: cada um com skills de projeto ganha um grupo. */
  orquestradores: readonly OrquestradorParaSkills[];
  /** Em qual aba o painel abre: "Explorar marketplace" do menu abre em Explorar, o resto em Instaladas. */
  abaInicial?: AbaDoPainelDeSkills;
  /** Quantas skills o Claude Code tem (a contagem do menu), no número da aba Instaladas. Nulo enquanto não se sabe. */
  quantidadeDeSkills?: number | null;
  /** Instalou, ligou, desligou ou removeu um plugin: o menu relê a lista de skills. */
  aoMudarPlugins?: () => void;
  aoFechar: () => void;
}

/** O plugin que espera o ok do usuário para ligar, e se acabou de ser instalado. */
interface Pendencia {
  plugin: PluginInstalado;
  fonte: string | null;
  recemInstalado: boolean;
}

/**
 * As skills do Claude Code e o marketplace de plugins, logo abaixo da ilha do canvas (aberto pelo item Skills do
 * menu `+ Novo`). Duas abas: Instaladas (plugins com interruptor, mais as skills do usuário, do projeto e da
 * conta, só leitura) e Explorar (o catálogo, que instala). Plugin com hook chega desligado e só liga depois de
 * uma confirmação, que cobre o painel. Esc fecha (ou volta do detalhe de um plugin, ou dispensa a confirmação) e
 * a tecla `/` leva o foco à busca.
 */
export function PainelDeSkills({
  orquestradores,
  abaInicial = "instaladas",
  quantidadeDeSkills = null,
  aoMudarPlugins,
  aoFechar,
}: Props) {
  const idBase = useId();
  const [aba, setAba] = useState<AbaDoPainelDeSkills>(abaInicial);
  // Cada aba só abre na primeira visita (o catálogo não vai à rede à toa) e depois fica montada, para não
  // perder uma instalação em andamento ao trocar de aba.
  const [visitadas, setVisitadas] = useState<ReadonlySet<AbaDoPainelDeSkills>>(() => new Set([abaInicial]));
  // Muda a cada instalação, ligada, desligada ou remoção: a lista de Instaladas lê de novo.
  const [versao, setVersao] = useState(0);
  const [pendencia, setPendencia] = useState<Pendencia | null>(null);
  const [ligando, setLigando] = useState(false);
  const [erroAoLigar, setErroAoLigar] = useState<string | null>(null);
  const painel = useRef<HTMLElement>(null);

  const escolherAba = (nova: AbaDoPainelDeSkills) => {
    setAba(nova);
    setVisitadas((atuais) => (atuais.has(nova) ? atuais : new Set([...atuais, nova])));
  };

  const mudouPlugins = useCallback(() => {
    setVersao((atual) => atual + 1);
    aoMudarPlugins?.();
  }, [aoMudarPlugins]);

  const pedirConfirmacao = useCallback((plugin: PluginInstalado, fonte: string | null, recemInstalado: boolean) => {
    setErroAoLigar(null);
    setPendencia({ plugin, fonte, recemInstalado });
  }, []);

  const ligarPendente = () => {
    if (pendencia === null) {
      return;
    }
    setLigando(true);
    setErroAoLigar(null);
    api
      .ligarPlugin(pendencia.plugin.id)
      .then(() => {
        setPendencia(null);
        mudouPlugins();
      })
      .catch((falha: unknown) => setErroAoLigar(mensagemDeErro(falha)))
      .finally(() => setLigando(false));
  };

  // Esc fecha, como no painel de subagentes: só o Esc dado no painel (ou sem nada focado). A confirmação e o
  // detalhe de um plugin tratam o Esc deles antes (e o marcam como tratado).
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target;
      const noPainel = alvo === document.body || (alvo instanceof Node && painel.current?.contains(alvo) === true);
      if (evento.defaultPrevented || !noPainel) {
        return;
      }
      if (evento.key === "Escape") {
        aoFechar();
      } else if (evento.key === "/" && !evento.ctrlKey && !evento.metaKey && !evento.altKey) {
        // "/" leva à busca da aba aberta, a não ser que já se esteja digitando.
        const digitando = alvo instanceof HTMLElement && (alvo.matches("input, textarea, select") || alvo.isContentEditable);
        const busca = painel.current?.querySelector<HTMLInputElement>(".mk-corpo:not([hidden]) input[type='search']");
        if (!digitando && busca) {
          evento.preventDefault();
          busca.focus();
        }
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const idDaAba = (nome: AbaDoPainelDeSkills) => `${idBase}-aba-${nome}`;
  const idDoCorpo = (nome: AbaDoPainelDeSkills) => `${idBase}-corpo-${nome}`;

  return (
    <section ref={painel} className="painel-flutuante painel-da-barra painel-de-skills mt-2" aria-label="Skills do Claude Code">
      <header className="mk-cab">
        <div className="min-w-0">
          <h2>
            <IconeSkills tamanho={18} />
            Skills
          </h2>
          <p className="sub">
            {aba === "explorar"
              ? "Habilidades extras que seus agentes carregam sozinhos, pelo pedido."
              : "O que o Claude Code tem cadastrado. Os agentes carregam a skill certa pelo pedido."}
          </p>
        </div>
        <button type="button" className="botao-icone shrink-0" aria-label="Fechar skills" onClick={aoFechar}>
          <IconeFechar tamanho={16} />
        </button>
      </header>

      <div className="mk-abas" role="tablist" aria-label="Skills">
        <button
          type="button"
          id={idDaAba("instaladas")}
          role="tab"
          className="mk-aba"
          aria-selected={aba === "instaladas"}
          aria-controls={idDoCorpo("instaladas")}
          onClick={() => escolherAba("instaladas")}
        >
          Instaladas
          {quantidadeDeSkills !== null && <span className="n">{quantidadeDeSkills}</span>}
        </button>
        <button
          type="button"
          id={idDaAba("explorar")}
          role="tab"
          className="mk-aba"
          aria-selected={aba === "explorar"}
          aria-controls={idDoCorpo("explorar")}
          onClick={() => escolherAba("explorar")}
        >
          Explorar
        </button>
      </div>

      {visitadas.has("instaladas") && (
        <div
          id={idDoCorpo("instaladas")}
          role="tabpanel"
          aria-labelledby={idDaAba("instaladas")}
          className="mk-corpo"
          hidden={aba !== "instaladas"}
        >
          <ListaDeSkills
            orquestradores={orquestradores}
            versao={versao}
            aoMudarPlugins={mudouPlugins}
            aoPedirConfirmacao={(plugin) => pedirConfirmacao(plugin, null, false)}
          />
        </div>
      )}
      {visitadas.has("explorar") && (
        <div
          id={idDoCorpo("explorar")}
          role="tabpanel"
          aria-labelledby={idDaAba("explorar")}
          className="mk-corpo mk-corpo-explorar"
          hidden={aba !== "explorar"}
        >
          <CatalogoDePlugins
            aoMudar={mudouPlugins}
            aoPedirConfirmacao={(plugin, fonte) => pedirConfirmacao(plugin, fonte, true)}
            aoVerInstaladas={() => escolherAba("instaladas")}
          />
        </div>
      )}

      {pendencia !== null && (
        <ConfirmacaoDeHook
          plugin={pendencia.plugin}
          fonte={pendencia.fonte}
          recemInstalado={pendencia.recemInstalado}
          ocupado={ligando}
          erro={erroAoLigar}
          aoLigar={ligarPendente}
          aoManterDesligado={() => setPendencia(null)}
        />
      )}
    </section>
  );
}
