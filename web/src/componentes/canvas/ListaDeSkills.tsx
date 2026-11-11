import { useEffect, useId, useMemo, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaSkill, ListagemDeSkills } from "../../shared/api/tipos";
import { IconeSkills } from "../Icones";

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
  | { consulta: string; globais: DadosDaSkill[]; porOrquestrador: ReadonlyMap<string, ListagemDeSkills> }
  | { consulta: string; erro: string };

interface Grupo {
  chave: string;
  titulo: string;
  skills: DadosDaSkill[];
}

interface Props {
  /** Os orquestradores abertos no canvas. Cada um com skills de projeto ganha o próprio grupo. */
  orquestradores: readonly OrquestradorParaSkills[];
}

/**
 * A lista das skills do Claude Code, só leitura: a busca, os grupos (as do usuário, as do projeto de cada
 * orquestrador aberto e as de plugins), os estados de carregando, erro e vazio, e no rodapé o total e, se
 * algum orquestrador aberto estiver num nível que desliga as skills, um aviso. Usada no painel da ilha e na
 * aba Skills das Configurações.
 */
export function ListaDeSkills({ orquestradores }: Props) {
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
    ])
      .then(([globais, doProjeto]) => {
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
        setLeitura({ consulta, globais: globais.skills, porOrquestrador });
      })
      .catch((falha: unknown) => {
        if (atual) {
          setLeitura({ consulta, erro: mensagemDeErro(falha) });
        }
      });
    return () => {
      atual = false;
    };
  }, [consulta]);

  // Uma leitura de outra consulta (um orquestrador abriu ou fechou) ainda não vale: segue "carregando".
  const atual = leitura !== null && leitura.consulta === consulta ? leitura : null;
  const lida = atual !== null && "globais" in atual ? atual : null;
  const erro = atual !== null && "erro" in atual ? atual.erro : null;

  const termo = normalizar(busca.trim());
  const combina = (skill: DadosDaSkill) =>
    termo === "" || normalizar(skill.nome).includes(termo) || normalizar(skill.descricao).includes(termo);

  const { grupos, desligadosEm } = useMemo(() => {
    if (lida === null) {
      return { grupos: [] as Grupo[], desligadosEm: [] as string[] };
    }
    const doUsuario = lida.globais.filter((skill) => skill.origem === "usuario");
    const dePlugins = lida.globais.filter((skill) => skill.origem === "plugin");
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
      { chave: "plugin", titulo: "De plugins", skills: dePlugins },
    ].filter((grupo) => grupo.skills.length > 0);
    return { grupos: completos, desligadosEm: desligados };
  }, [lida, orquestradores]);

  const total = grupos.reduce((soma, grupo) => soma + grupo.skills.length, 0);
  const visiveis = grupos
    .map((grupo) => ({ ...grupo, skills: grupo.skills.filter(combina) }))
    .filter((grupo) => grupo.skills.length > 0);

  return (
    <>
      <div className="skills-barra">
        <input
          type="search"
          className="input campo-escuro"
          aria-label="Buscar skill por nome ou descrição"
          placeholder="Buscar por nome ou descrição"
          value={busca}
          spellCheck={false}
          onChange={(evento) => setBusca(evento.target.value)}
        />
      </div>

      <div className="skills-corpo custom-scrollbar" aria-live="polite" aria-busy={atual === null}>
        {atual === null ? (
          <span className="hint">carregando…</span>
        ) : erro !== null ? (
          <div className="alert alert-error">{erro}</div>
        ) : total === 0 ? (
          <div className="subagentes-vazio">
            <IconeSkills tamanho={22} className="text-muted" />
            <strong className="font-titulo text-[13px]">Nenhuma skill encontrada</strong>
            <span className="text-support max-w-sm">
              As skills ficam na pasta do Claude Code do usuário, na do projeto e nos plugins instalados.
            </span>
          </div>
        ) : visiveis.length === 0 ? (
          <div className="subagentes-vazio">
            <strong className="font-titulo text-[13px]">Nenhuma skill combina com a busca</strong>
            <span className="text-support max-w-sm">Tente outra palavra do nome ou da descrição.</span>
          </div>
        ) : (
          visiveis.map((grupo) => (
            <section key={grupo.chave} className="skills-grupo" aria-labelledby={`${id}-${grupo.chave}`}>
              <h3 id={`${id}-${grupo.chave}`}>
                <span className="truncate">{grupo.titulo}</span>
                <span className="mono text-muted">{grupo.skills.length}</span>
              </h3>
              <ul>
                {grupo.skills.map((skill) => (
                  <ItemDeSkill key={`${skill.origem}:${skill.plugin ?? ""}:${skill.nome}`} skill={skill} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="skills-rodape">
        <span className="text-support">
          Só leitura.{lida !== null && total > 0 ? ` ${total.toLocaleString("pt-BR")} ${total === 1 ? "skill" : "skills"}.` : ""}
        </span>
        {desligadosEm.length > 0 && (
          <span className="text-support" role="note">
            {avisoDeSkillsDesligadas(desligadosEm)}
          </span>
        )}
      </div>
    </>
  );
}

function ItemDeSkill({ skill }: { skill: DadosDaSkill }) {
  return (
    <li className="skill-item">
      <span className="flex items-center gap-1.5">
        <span className="mono truncate">{skill.nome}</span>
        {skill.origem === "plugin" && skill.plugin !== null && (
          <span className="chip-de-modelo" title={`Plugin ${skill.plugin}`}>
            {skill.plugin}
          </span>
        )}
      </span>
      <span className="skill-item-descricao" title={skill.descricao === "" ? undefined : skill.descricao}>
        {skill.descricao === "" ? "Sem descrição." : skill.descricao}
      </span>
    </li>
  );
}
