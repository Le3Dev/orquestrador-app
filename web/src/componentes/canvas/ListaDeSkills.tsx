import { useEffect, useId, useMemo, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaSkill, ListagemDeSkills, PluginInstalado } from "../../shared/api/tipos";
import { IconeSkills } from "../Icones";
import { IconeLupa } from "./IconesDasIlhas";
import { LinhaDoPluginInstalado } from "./PluginInstalado";

/** Um orquestrador aberto no canvas, o suficiente para ler as skills do projeto dele. */
export interface OrquestradorParaSkills {
  id: string;
  nome: string;
}

/** O aviso discreto do rodapé: quais orquestradores abertos estão num nível que desliga as skills. */
function avisoDeSkillsDesligadas(nomes: readonly string[]): string {
  return `Skills desligadas em ${nomes.join(", ")}: o nível de permissão é só leitura. Elas valem nos níveis com edição, fora do planejamento.`;
}

/** Minúsculas e sem acento, para a busca achar "revisao" em "Revisão". */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** O resultado das leituras, preso à consulta que o gerou (para não confundir com a de outra lista de orquestradores). */
type Leitura =
  | {
      consulta: string;
      globais: DadosDaSkill[];
      porOrquestrador: ReadonlyMap<string, ListagemDeSkills>;
      plugins: PluginInstalado[];
      /** Se os plugins não puderam ser lidos: a lista de skills segue, só sem as linhas de plugin. */
      erroDosPlugins: string | null;
    }
  | { consulta: string; erro: string };

interface Grupo {
  chave: string;
  titulo: string;
  /** Uma frase curta à direita do título. */
  nota?: string;
  skills: DadosDaSkill[];
}

interface Props {
  /** Os orquestradores abertos no canvas. Cada um com skills de projeto ganha o próprio grupo. */
  orquestradores: readonly OrquestradorParaSkills[];
  /** Muda quando algo mudou fora daqui (uma instalação): a lista lê de novo, sem piscar. */
  versao: number;
  /** Ligou, desligou ou removeu um plugin: o painel avisa o menu. */
  aoMudarPlugins: () => void;
  /** Ligar um plugin com hook passa pela confirmação do painel. */
  aoPedirConfirmacao: (plugin: PluginInstalado) => void;
}

/**
 * A aba Instaladas do painel de Skills: a busca e os grupos. Os plugins vêm primeiro, cada um com a própria
 * linha (abre para mostrar as skills dele, liga, desliga e remove). Depois, só leitura, as skills do usuário, as
 * do projeto de cada orquestrador aberto e as sincronizadas da conta Claude (de plugins que não estão nos
 * instalados). Com os estados de carregando, erro e vazio e, se algum orquestrador aberto estiver num nível que
 * desliga as skills, um aviso no rodapé.
 */
export function ListaDeSkills({ orquestradores, versao, aoMudarPlugins, aoPedirConfirmacao }: Props) {
  const id = useId();
  const [busca, setBusca] = useState("");
  const [leitura, setLeitura] = useState<Leitura | null>(null);

  const consulta = orquestradores.map((orquestrador) => orquestrador.id).join("\n");

  useEffect(() => {
    let atual = true;
    const ids = consulta === "" ? [] : consulta.split("\n");
    Promise.all([
      api.lerSkills(),
      // Uma falha na leitura de um projeto não derruba a lista: o grupo dele só não aparece.
      Promise.allSettled(ids.map((orquestradorId) => api.lerSkills(orquestradorId))),
      api.lerPluginsInstalados().then(
        (resposta) => ({ plugins: resposta.plugins, erro: null }),
        (falha: unknown) => ({ plugins: [] as PluginInstalado[], erro: mensagemDeErro(falha) }),
      ),
    ])
      .then(([globais, doProjeto, instalados]) => {
        if (!atual) {
          return;
        }
        const porOrquestrador = new Map<string, ListagemDeSkills>();
        doProjeto.forEach((resultado, indice) => {
          const orquestradorId = ids[indice];
          if (resultado.status === "fulfilled" && orquestradorId !== undefined) {
            porOrquestrador.set(orquestradorId, resultado.value);
          }
        });
        setLeitura({
          consulta,
          globais: globais.skills,
          porOrquestrador,
          plugins: instalados.plugins,
          erroDosPlugins: instalados.erro,
        });
      })
      .catch((falha: unknown) => {
        if (atual) {
          setLeitura({ consulta, erro: mensagemDeErro(falha) });
        }
      });
    return () => {
      atual = false;
    };
  }, [consulta, versao]);

  // Uma leitura de outra consulta (um orquestrador abriu ou fechou) ainda não vale: segue "carregando".
  const atual = leitura !== null && leitura.consulta === consulta ? leitura : null;
  const lida = atual !== null && "globais" in atual ? atual : null;
  const erro = atual !== null && "erro" in atual ? atual.erro : null;

  const termo = normalizar(busca.trim());
  const combina = (skill: { nome: string; descricao: string }) =>
    termo === "" || normalizar(skill.nome).includes(termo) || normalizar(skill.descricao).includes(termo);
  const pluginCombina = (plugin: PluginInstalado) =>
    termo === "" || normalizar(plugin.nome).includes(termo) || plugin.inventario.skills.some(combina);

  const { grupos, desligadosEm } = useMemo(() => {
    if (lida === null) {
      return { grupos: [] as Grupo[], desligadosEm: [] as string[] };
    }
    const doUsuario = lida.globais.filter((skill) => skill.origem === "usuario");
    // As skills de plugin que aparecem na linha de um plugin instalado não se repetem aqui; sobram as da conta
    // (como as `anthropic-skills:*`), sincronizadas pelo Claude e sem plugin instalado para ligar ou remover.
    const nomesDosInstalados = new Set(lida.plugins.flatMap((plugin) => [plugin.nome, plugin.id]));
    const daConta = lida.globais.filter(
      (skill) => skill.origem === "plugin" && (skill.plugin === null || !nomesDosInstalados.has(skill.plugin)),
    );
    const doProjeto: Grupo[] = [];
    const desligados: string[] = [];
    for (const orquestrador of orquestradores) {
      const listagem = lida.porOrquestrador.get(orquestrador.id);
      if (listagem === undefined) {
        continue;
      }
      if (listagem.liberadasNoNivel === false) {
        desligados.push(orquestrador.nome);
      }
      const skills = listagem.skills.filter((skill) => skill.origem === "projeto");
      if (skills.length > 0) {
        doProjeto.push({ chave: `projeto:${orquestrador.id}`, titulo: `Do projeto ${orquestrador.nome}`, skills });
      }
    }
    const completos: Grupo[] = [
      { chave: "usuario", titulo: "Suas skills", skills: doUsuario },
      ...doProjeto,
      { chave: "conta", titulo: "Da sua conta Claude", nota: "Sincronizadas pela conta, só leitura", skills: daConta },
    ].filter((grupo) => grupo.skills.length > 0);
    return { grupos: completos, desligadosEm: desligados };
  }, [lida, orquestradores]);

  const plugins = lida?.plugins ?? [];
  const pluginsVisiveis = plugins.filter(pluginCombina);
  const erroDosPlugins = lida?.erroDosPlugins ?? null;
  const total = plugins.length + grupos.reduce((soma, grupo) => soma + grupo.skills.length, 0);
  const visiveis = grupos
    .map((grupo) => ({ ...grupo, skills: grupo.skills.filter(combina) }))
    .filter((grupo) => grupo.skills.length > 0);

  const trocarPlugins = (troca: (anteriores: PluginInstalado[]) => PluginInstalado[]) => {
    setLeitura((anterior) =>
      anterior !== null && "globais" in anterior ? { ...anterior, plugins: troca(anterior.plugins) } : anterior,
    );
    aoMudarPlugins();
  };

  return (
    <>
      <div className="mk-busca mk-busca-instaladas">
        <span className="lupa">
          <IconeLupa tamanho={16} />
        </span>
        <input
          type="search"
          aria-label="Buscar skill por nome ou descrição"
          placeholder="Buscar por nome ou descrição"
          value={busca}
          spellCheck={false}
          onChange={(evento) => setBusca(evento.target.value)}
        />
        <kbd aria-hidden="true">/</kbd>
      </div>

      <div className="mk-instaladas custom-scrollbar" aria-live="polite" aria-busy={atual === null}>
        {atual === null ? (
          <span className="hint mk-carregando">carregando…</span>
        ) : erro !== null ? (
          <div className="alert alert-error mk-alerta">{erro}</div>
        ) : total === 0 && erroDosPlugins === null ? (
          <div className="mk-vazio">
            <span className="tile">
              <IconeSkills tamanho={24} />
            </span>
            <h3>Nenhuma skill encontrada</h3>
            <p>As skills ficam na pasta do Claude Code do usuário, na do projeto e nos plugins instalados.</p>
          </div>
        ) : pluginsVisiveis.length === 0 && visiveis.length === 0 && erroDosPlugins === null ? (
          <div className="mk-vazio">
            <h3>Nenhuma skill combina com a busca</h3>
            <p>Tente outra palavra do nome ou da descrição.</p>
          </div>
        ) : (
          <>
            {erroDosPlugins !== null && (
              <section className="mk-grupo">
                <div className="alert alert-error" role="alert">
                  Não deu para ler os plugins instalados. {erroDosPlugins}
                </div>
              </section>
            )}
            {pluginsVisiveis.length > 0 && (
              <section className="mk-grupo" aria-labelledby={`${id}-plugins`}>
                <h3 id={`${id}-plugins`}>
                  <span className="truncate">Plugins</span>
                  <span className="mono">{pluginsVisiveis.length}</span>
                  <span className="nota">Valem no app e no terminal</span>
                </h3>
                {pluginsVisiveis.map((plugin) => (
                  <LinhaDoPluginInstalado
                    key={plugin.id}
                    plugin={plugin}
                    aoAlterar={(novo) =>
                      trocarPlugins((anteriores) => anteriores.map((item) => (item.id === novo.id ? novo : item)))
                    }
                    aoRemovido={(removido) =>
                      trocarPlugins((anteriores) => anteriores.filter((item) => item.id !== removido))
                    }
                    aoPedirConfirmacao={aoPedirConfirmacao}
                  />
                ))}
              </section>
            )}
            {visiveis.map((grupo) => (
              <section key={grupo.chave} className="mk-grupo" aria-labelledby={`${id}-${grupo.chave}`}>
                <h3 id={`${id}-${grupo.chave}`}>
                  <span className="truncate">{grupo.titulo}</span>
                  <span className="mono">{grupo.skills.length}</span>
                  {grupo.nota !== undefined && <span className="nota">{grupo.nota}</span>}
                </h3>
                <ul className="mk-skills-lista">
                  {grupo.skills.map((skill) => (
                    <ItemDeSkill key={`${skill.origem}:${skill.plugin ?? ""}:${skill.nome}`} skill={skill} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>

      {desligadosEm.length > 0 && (
        <div className="mk-skills-rodape">
          <span role="note">{avisoDeSkillsDesligadas(desligadosEm)}</span>
        </div>
      )}
    </>
  );
}

function ItemDeSkill({ skill }: { skill: DadosDaSkill }) {
  return (
    <li className="mk-skill">
      <span className="flex items-center gap-1.5">
        <span className="mono truncate">{skill.nome}</span>
        {skill.origem === "plugin" && skill.plugin !== null && (
          <span className="chip-de-modelo" title={`Plugin ${skill.plugin}`}>
            {skill.plugin}
          </span>
        )}
      </span>
      <span className="d" title={skill.descricao === "" ? undefined : skill.descricao}>
        {skill.descricao === "" ? "Sem descrição." : skill.descricao}
      </span>
    </li>
  );
}
