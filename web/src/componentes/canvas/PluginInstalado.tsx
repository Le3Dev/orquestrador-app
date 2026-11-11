import { useEffect, useId, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { PluginInstalado } from "../../shared/api/tipos";
import { AvatarDePlugin } from "./AvatarDePlugin";
import { motivosDeConfirmacao, precisaDeConfirmacao, resumoDoInventario } from "./dadosDoPlugin";
import { IconeHook, IconeLixeira } from "./IconesDoMarketplace";
import { IconeInfo, IconeSetaDireita } from "./IconesDasIlhas";
import { ItemDeSkill } from "./ItemDeSkill";

interface Props {
  plugin: PluginInstalado;
  /** Ligou ou desligou: o plugin já atualizado. */
  aoAlterar: (plugin: PluginInstalado) => void;
  aoRemovido: (id: string) => void;
  /** Ligar um plugin com hook, pasta bin ou inventário não verificado não liga na hora: o painel mostra a confirmação. */
  aoPedirConfirmacao: (plugin: PluginInstalado) => void;
  /** O que está no campo de busca da aba: a palavra achada nas skills do plugin aberto ganha destaque. */
  termo?: string;
}

/**
 * A linha de um plugin instalado, na aba Instaladas: avatar, nome, o resumo do que há dentro e, à direita, o
 * interruptor e a lixeira. Clicar no nome abre os motivos de pedir confirmação (quando há) e a lista das skills,
 * cada uma na mesma linha compacta da lista de Instaladas.
 * Plugin desligado que pede confirmação (hook, pasta bin ou inventário não verificado) mostra "Revisar e ligar"
 * no lugar do interruptor. Remover pede um sim na própria linha.
 */
export function LinhaDoPluginInstalado({ plugin, aoAlterar, aoRemovido, aoPedirConfirmacao, termo = "" }: Props) {
  const idDasSkills = useId();
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState<"alternando" | "removendo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const cancelar = useRef<HTMLButtonElement>(null);
  const lixeira = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  const { inventario } = plugin;
  const comHook = inventario.hooks > 0;
  const motivos = motivosDeConfirmacao(inventario);
  // Hook, pasta bin ou inventário não verificado: ligar passa pela confirmação.
  const pedeConfirmacao = precisaDeConfirmacao(inventario);
  const espera = !plugin.ligado && pedeConfirmacao;

  // O foco acompanha a confirmação: vai para "Cancelar" ao abrir e volta à lixeira ao cancelar.
  useEffect(() => {
    if (confirmando) {
      cancelar.current?.focus();
    } else if (devolverFoco.current) {
      devolverFoco.current = false;
      lixeira.current?.focus();
    }
  }, [confirmando]);

  const alternar = () => {
    if (ocupado !== null) {
      return;
    }
    setErro(null);
    if (!plugin.ligado && pedeConfirmacao) {
      aoPedirConfirmacao(plugin);
      return;
    }
    setOcupado("alternando");
    (plugin.ligado ? api.desligarPlugin(plugin.id) : api.ligarPlugin(plugin.id))
      .then((resposta) => aoAlterar(resposta.plugin))
      .catch((falha: unknown) => setErro(mensagemDeErro(falha)))
      .finally(() => setOcupado(null));
  };

  const remover = () => {
    setOcupado("removendo");
    setErro(null);
    api
      .removerPlugin(plugin.id)
      .then(() => aoRemovido(plugin.id))
      .catch((falha: unknown) => {
        setErro(mensagemDeErro(falha));
        setOcupado(null);
      });
  };

  const cancelarRemocao = () => {
    devolverFoco.current = true;
    setConfirmando(false);
    setErro(null);
  };

  return (
    <div className="mk-plugin-bloco">
      <div className={`mk-plugin ${confirmando ? "confirmando" : ""}`} data-ligado={plugin.ligado} data-nome={plugin.nome}>
        {confirmando ? (
          <div className="mk-remover" role="alertdialog" aria-label={`Remover ${plugin.nome}`}>
            <div>
              <b>Remover {plugin.nome}?</b>
              <span className="t">Ele sai também do seu terminal. Dá para instalar de novo depois.</span>
              {erro !== null && (
                <span className="t mk-erro-inline" role="alert">
                  {erro}
                </span>
              )}
            </div>
            <div className="mk-remover-botoes">
              <button
                ref={cancelar}
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={ocupado === "removendo"}
                onClick={cancelarRemocao}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={ocupado === "removendo"}
                aria-busy={ocupado === "removendo"}
                onClick={remover}
              >
                {ocupado === "removendo" ? "Removendo…" : "Remover"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <AvatarDePlugin nome={plugin.nome} />
            <div className="min-w-0">
              <div className="nome">
                <button
                  type="button"
                  className="mk-nome mk-nome-botao"
                  aria-expanded={aberto}
                  aria-controls={aberto ? idDasSkills : undefined}
                  title={aberto ? "Esconder as skills do plugin" : "Ver as skills do plugin"}
                  onClick={() => setAberto((atual) => !atual)}
                >
                  <span className="truncate">{plugin.nome}</span>
                  <IconeSetaDireita tamanho={13} className="mk-chev" />
                </button>
                {comHook && (
                  <span className="mk-chip hook" title="Comando que roda sozinho em toda sessão">
                    <IconeHook tamanho={10} />
                    {inventario.hooks} {inventario.hooks === 1 ? "hook" : "hooks"}
                  </span>
                )}
                {!inventario.verificado && (
                  <span className="mk-chip nao-verificado" title="Não conseguimos ler tudo o que vem neste plugin">
                    Não verificado
                  </span>
                )}
                {espera && <span className="mk-chip espera">Pede sua confirmação</span>}
              </div>
              <div className="conta">
                <span>{resumoDoInventario(inventario)}</span>
              </div>
              {erro !== null && (
                <div className="mk-meta erro" role="alert">
                  <IconeInfo tamanho={13} />
                  {erro}
                </div>
              )}
            </div>
            <div className="dir">
              {espera ? (
                <button type="button" className="btn btn-sm btn-outline" onClick={() => aoPedirConfirmacao(plugin)}>
                  Revisar e ligar
                </button>
              ) : (
                <button
                  type="button"
                  className="interruptor"
                  role="switch"
                  aria-checked={plugin.ligado}
                  aria-label={`${plugin.ligado ? "Desligar" : "Ligar"} ${plugin.nome}`}
                  aria-disabled={ocupado !== null}
                  onClick={alternar}
                >
                  <span className="interruptor-trilho" />
                  <span>{plugin.ligado ? "Ligado" : "Desligado"}</span>
                </button>
              )}
              <button
                ref={lixeira}
                type="button"
                className="botao-icone botao-icone-perigo rem"
                aria-label={`Remover ${plugin.nome}`}
                title="Remover"
                onClick={() => setConfirmando(true)}
              >
                <IconeLixeira tamanho={16} />
              </button>
            </div>
          </>
        )}
      </div>

      {aberto && !confirmando && motivos.length > 0 && (
        <ul className="mk-plugin-motivos" aria-label={`Por que ${plugin.nome} pede confirmação`}>
          {motivos.map((motivo) => (
            <li key={motivo.chave} data-motivo={motivo.chave}>
              {motivo.chave === "hooks" ? <IconeHook tamanho={14} /> : <IconeInfo tamanho={14} />}
              <span>{motivo.titulo}</span>
            </li>
          ))}
        </ul>
      )}

      {aberto && !confirmando && (
        <ul id={idDasSkills} className="mk-plugin-skills" aria-label={`Skills de ${plugin.nome}`}>
          {inventario.skills.length === 0 ? (
            <li className="mk-skill-vazio">Este plugin não traz skills.</li>
          ) : (
            inventario.skills.map((skill) => (
              // Dentro do plugin a skill já vem sem prefixo; o nome completo é o que o Claude Code chama.
              <ItemDeSkill
                key={skill.nome}
                nome={skill.nome}
                nomeCompleto={`${plugin.nome}:${skill.nome}`}
                descricao={skill.descricao}
                origem={`Do plugin ${plugin.nome}`}
                termo={termo}
              />
            ))
          )}
        </ul>
      )}
    </div>
  );
}
