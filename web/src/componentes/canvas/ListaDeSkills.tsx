import { Fragment, useEffect, useId, useMemo, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaSkill, ListagemDeSkills, PluginInstalado } from "../../shared/api/tipos";
import { IconeSkills } from "../Icones";
import { contar, nomeAmigavel, normalizarParaBusca as normalizar } from "./dadosDoPlugin";
import { IconeInfo, IconeLupa } from "./IconesDasIlhas";
import { ItemDeSkill } from "./ItemDeSkill";
import { LinhaDoPluginInstalado } from "./PluginInstalado";

/** Um orquestrador aberto no canvas, o suficiente para ler as skills do projeto dele. */
export interface OrquestradorParaSkills {
  id: string;
  nome: string;
}

/** A linha do rodapé: quais orquestradores abertos estão num nível que desliga as skills. */
function avisoCurtoDeSkillsDesligadas(nomes: readonly string[]): string {
  return nomes.length === 1
    ? `Desligadas em ${nomes[0] ?? ""}, que está em só leitura.`
    : `Desligadas em ${nomes.length} orquestradores (só leitura).`;
}

/** O resto do aviso, que abre em "Entenda". */
function explicacaoDeSkillsDesligadas(nomes: readonly string[]): string {
  const onde = nomes.length === 1 ? "Nesse nível" : `Nestes orquestradores (${nomes.join(", ")})`;
  return `${onde} o agente não usa skills. Elas valem nos níveis com edição, fora do planejamento.`;
}

/** Os pacotes de skills da conta, em ordem, cada um com as skills dele em ordem alfabética. */
function porPacote(skills: readonly DadosDaSkill[]): { pacote: string; skills: DadosDaSkill[] }[] {
  const pacotes = new Map<string, DadosDaSkill[]>();
  for (const skill of skills) {
    const chave = skill.plugin ?? "";
    pacotes.set(chave, [...(pacotes.get(chave) ?? []), skill]);
  }
  return [...pacotes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pacote, doPacote]) => ({
      pacote,
      skills: [...doPacote].sort((a, b) => nomeAmigavel(a).localeCompare(nomeAmigavel(b))),
    }));
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
  /** De onde vêm as skills do grupo, em uma frase: aparece na skill aberta. */
  origem: string;
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
 * instalados). Cada skill é uma linha compacta (`ItemDeSkill`) que abre para mostrar o resto. Com os estados de
 * carregando, erro e vazio e, se algum orquestrador aberto estiver num nível que desliga as skills, uma linha de
 * aviso no rodapé, com "Entenda" para o resto.
 */
export function ListaDeSkills({ orquestradores, versao, aoMudarPlugins, aoPedirConfirmacao }: Props) {
  const id = useId();
  const [busca, setBusca] = useState("");
  const [entenda, setEntenda] = useState(false);
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
        doProjeto.push({
          chave: `projeto:${orquestrador.id}`,
          titulo: `Do projeto ${orquestrador.nome}`,
          origem: `Do projeto ${orquestrador.nome}`,
          skills,
        });
      }
    }
    const completos: Grupo[] = [
      { chave: "usuario", titulo: "Suas skills", origem: "Da pasta de skills do Claude Code", skills: doUsuario },
      ...doProjeto,
      {
        chave: "conta",
        titulo: "Da sua conta Claude",
        nota: "Sincronizadas pela conta, só leitura",
        origem: "Da sua conta Claude, só leitura",
        skills: daConta,
      },
    ].filter((grupo) => grupo.skills.length > 0);
    return { grupos: completos, desligadosEm: desligados };
  }, [lida, orquestradores]);

  const plugins = lida?.plugins ?? [];
  const pluginsVisiveis = plugins.filter(pluginCombina);
  const erroDosPlugins = lida?.erroDosPlugins ?? null;
  const total = plugins.length + grupos.reduce((soma, grupo) => soma + grupo.skills.length, 0);
  const visiveis = grupos
    .map((grupo) => ({ ...grupo, totalDoGrupo: grupo.skills.length, skills: grupo.skills.filter(combina) }))
    .filter((grupo) => grupo.skills.length > 0);
  const totalVisivelDeSkills = visiveis.reduce((soma, grupo) => soma + grupo.skills.length, 0);
  const termoDigitado = busca.trim();

  /** O número do grupo; com a busca vira "3 de 13", para ver quanto da lista sobrou. */
  const contadorDoGrupo = (visiveisNoGrupo: number, totalDoGrupo: number) =>
    termoDigitado === "" ? (
      <span className="mono">{visiveisNoGrupo}</span>
    ) : (
      <span className="mk-contador">
        {visiveisNoGrupo} de {totalDoGrupo}
      </span>
    );

  const itemDaLista = (skill: DadosDaSkill, origem: string) => (
    <ItemDeSkill
      key={`${skill.origem}:${skill.plugin ?? ""}:${skill.nome}`}
      nome={nomeAmigavel(skill)}
      nomeCompleto={skill.nome}
      descricao={skill.descricao}
      origem={origem}
      termo={termoDigitado}
    />
  );

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
          placeholder="Buscar por nome ou descrição (em inglês)"
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
            <h3>Nenhuma skill combina com “{termoDigitado}”</h3>
            <p>As descrições estão em inglês: tente spreadsheet no lugar de planilha.</p>
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
                  {contadorDoGrupo(pluginsVisiveis.length, plugins.length)}
                  <span className="nota">Valem no app e no terminal</span>
                </h3>
                {pluginsVisiveis.map((plugin) => (
                  <LinhaDoPluginInstalado
                    key={plugin.id}
                    plugin={plugin}
                    termo={termoDigitado}
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
                  {contadorDoGrupo(grupo.skills.length, grupo.totalDoGrupo)}
                  {grupo.nota !== undefined && <span className="nota">{grupo.nota}</span>}
                </h3>
                {grupo.chave === "conta" ? (
                  // O prefixo saiu da linha da skill: o pacote aparece uma vez, como subtítulo.
                  porPacote(grupo.skills).map(({ pacote, skills }) => (
                    <Fragment key={pacote}>
                      {pacote !== "" && (
                        <div className="mk-pacote">
                          <span>{pacote}</span>
                          <span>{skills.length}</span>
                        </div>
                      )}
                      <ul className="mk-skills-lista" aria-label={pacote === "" ? undefined : `Skills do pacote ${pacote}`}>
                        {skills.map((skill) => itemDaLista(skill, grupo.origem))}
                      </ul>
                    </Fragment>
                  ))
                ) : (
                  <ul className="mk-skills-lista">{grupo.skills.map((skill) => itemDaLista(skill, grupo.origem))}</ul>
                )}
              </section>
            ))}
          </>
        )}
      </div>
      {termoDigitado !== "" && atual !== null && erro === null && (
        <p className="sr-only" role="status">
          {contar(pluginsVisiveis.length + totalVisivelDeSkills, "resultado encontrado", "resultados encontrados")}
        </p>
      )}

      {desligadosEm.length > 0 && (
        <div className="mk-skills-rodape">
          <div className="lin">
            <IconeInfo tamanho={13} />
            <span>{avisoCurtoDeSkillsDesligadas(desligadosEm)}</span>
            <button
              type="button"
              className="mk-entenda"
              aria-expanded={entenda}
              aria-controls={entenda ? `${id}-entenda` : undefined}
              onClick={() => setEntenda((aberto) => !aberto)}
            >
              Entenda
            </button>
          </div>
          {entenda && (
            <p id={`${id}-entenda`} className="mk-entenda-txt" role="note">
              {explicacaoDeSkillsDesligadas(desligadosEm)}
            </p>
          )}
        </div>
      )}
    </>
  );
}
