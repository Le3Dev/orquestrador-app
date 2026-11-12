import { type KeyboardEvent as EventoDeTecladoDoReact, useEffect, useId, useRef } from "react";

import type { PluginInstalado } from "../../shared/api/tipos";
import { AvatarDePlugin } from "./AvatarDePlugin";
import { contar, linkDaFonte, motivosDeConfirmacao } from "./dadosDoPlugin";
import { IconeConfirmar, IconeHook, IconeLinkExterno } from "./IconesDoMarketplace";
import { IconeInfo } from "./IconesDasIlhas";

interface Props {
  plugin: PluginInstalado;
  /** De onde o plugin vem, quando se sabe: dá o "Ver o código". */
  fonte: string | null;
  /** Acabou de ser instalado (o título diz), em vez de só estar desligado. */
  recemInstalado: boolean;
  /** Ligando agora: os botões esperam. */
  ocupado: boolean;
  erro: string | null;
  aoLigar: () => void;
  /** "Manter desligado" e o Esc: o plugin segue instalado, desligado. */
  aoManterDesligado: () => void;
}

/**
 * A confirmação para ligar um plugin que pede cuidado: hook (um comando que roda sozinho), pasta bin (programas
 * no PATH do terminal) ou conteúdo que não deu para ler por inteiro. Cobre o painel de skills por dentro, com um
 * tom calmo: lista os motivos que valem, mostra o que veio no plugin e deixa a decisão com o usuário. O foco
 * inicial é "Manter desligado", e o Esc equivale a ele.
 */
export function ConfirmacaoDeHook({ plugin, fonte, recemInstalado, ocupado, erro, aoLigar, aoManterDesligado }: Props) {
  const idBase = useId();
  const idDoTitulo = `${idBase}-titulo`;
  const idDaDescricao = `${idBase}-descricao`;
  const dialogo = useRef<HTMLDivElement>(null);
  const manter = useRef<HTMLButtonElement>(null);
  const { inventario } = plugin;
  const skills = inventario.skills.length;
  const link = linkDaFonte(fonte);
  const motivos = motivosDeConfirmacao(inventario);

  useEffect(() => {
    manter.current?.focus();
  }, []);

  const aoTeclar = (evento: EventoDeTecladoDoReact<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      // Só o diálogo some: o Esc não pode fechar o painel por baixo.
      evento.preventDefault();
      evento.stopPropagation();
      if (!ocupado) {
        aoManterDesligado();
      }
    } else if (evento.key === "Tab" && dialogo.current !== null) {
      // O foco fica dentro do diálogo.
      const focaveis = [...dialogo.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")];
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (primeiro === undefined || ultimo === undefined) {
        return;
      }
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }
  };

  return (
    <div className="mk-vidro">
      <div
        ref={dialogo}
        className="mk-dialogo"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idDoTitulo}
        aria-describedby={idDaDescricao}
        onKeyDown={aoTeclar}
      >
        <div className="topo">
          <AvatarDePlugin nome={plugin.nome} tamanho={48} />
          <div>
            <h3 id={idDoTitulo}>
              {plugin.nome} {recemInstalado ? "foi instalado e está desligado" : "está desligado"}
            </h3>
            <p className="calmo" id={idDaDescricao}>
              Ele espera o seu ok antes de rodar.
            </p>
          </div>
        </div>

        <div className="mk-tiles" role="group" aria-label="O que vem dentro">
          <div className="mk-tile">
            <div className="v">{skills}</div>
            <div className="r">{skills === 1 ? "skill" : "skills"}</div>
          </div>
          <div className="mk-tile">
            <div className="v">{inventario.subagentes}</div>
            <div className="r">{inventario.subagentes === 1 ? "subagente" : "subagentes"}</div>
          </div>
          <div className="mk-tile">
            <div className="v">{inventario.servidoresMcp}</div>
            <div className="r">{inventario.servidoresMcp === 1 ? "servidor MCP" : "servidores MCP"}</div>
          </div>
          <div className={inventario.hooks > 0 ? "mk-tile hook" : "mk-tile"}>
            <div className="v">{inventario.hooks}</div>
            <div className="r">
              {inventario.hooks > 0 && <IconeHook tamanho={12} />}
              {inventario.hooks === 1 ? "hook" : "hooks"}
            </div>
          </div>
        </div>

        {motivos.length > 0 && (
          <div className="mk-explica">
            {inventario.hooks > 0 ? <IconeHook tamanho={18} /> : <IconeInfo tamanho={18} />}
            <div>
              <b>Por que ele espera o seu ok</b>
              <ul className="mk-motivos" aria-label="Motivos para confirmar">
                {motivos.map((motivo) => (
                  <li key={motivo.chave} data-motivo={motivo.chave}>
                    <span className="m">{motivo.titulo}</span>
                    <span className="e">{motivo.explicacao}</span>
                  </li>
                ))}
              </ul>
              <p>Ligue se você confia em quem publicou.</p>
            </div>
          </div>
        )}

        <ul className="mk-notas">
          {skills > 0 && (
            <li>
              <IconeConfirmar tamanho={14} />
              <span>
                {skills === 1 ? "A skill vale" : `As ${contar(skills, "skill", "skills")} valem`} nos orquestradores com
                nível de edição.
              </span>
            </li>
          )}
          {inventario.servidoresMcp > 0 && (
            <li>
              <IconeInfo tamanho={14} />
              <span>
                {inventario.servidoresMcp === 1
                  ? "O servidor MCP só funciona no terminal. Os orquestradores do app não o usam."
                  : "Os servidores MCP só funcionam no terminal. Os orquestradores do app não os usam."}
              </span>
            </li>
          )}
        </ul>

        {erro !== null && (
          <div className="alert alert-error mt-3" role="alert">
            {erro}
          </div>
        )}

        <div className="pe">
          {link !== null ? (
            <a className="btn btn-ghost mk-ver-codigo" href={link.url} target="_blank" rel="noopener noreferrer">
              Ver o código
              <IconeLinkExterno />
            </a>
          ) : (
            <span />
          )}
          <div className="botoes">
            <button ref={manter} type="button" className="btn btn-outline" disabled={ocupado} onClick={aoManterDesligado}>
              Manter desligado
            </button>
            <button type="button" className="btn btn-cta" disabled={ocupado} aria-busy={ocupado} onClick={aoLigar}>
              {ocupado ? "Ligando…" : "Ligar o plugin"}
            </button>
          </div>
        </div>
        <p className="depois">Você pode ligar ou desligar quando quiser, em Instaladas.</p>
      </div>
    </div>
  );
}
