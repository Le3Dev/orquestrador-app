import { useEffect, useId, useMemo, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaSkill, ListagemDeSkills, OrigemDaSkill } from "../../shared/api/tipos";
import { IconeFechar, IconeSkills } from "../Icones";

/** Um orquestrador aberto no canvas, o suficiente para escolher de qual ler as skills do projeto. */
export interface OrquestradorParaSkills {
  id: string;
  nome: string;
}

export const AVISO_DE_SKILLS_DESLIGADAS =
  "Neste orquestrador as skills ficam desligadas: o nível de permissão é só leitura. Elas valem nos níveis com edição, fora do planejamento.";

const GRUPOS: { origem: OrigemDaSkill; titulo: string }[] = [
  { origem: "usuario", titulo: "Suas skills" },
  { origem: "projeto", titulo: "Do projeto" },
  { origem: "plugin", titulo: "De plugins" },
];

/** Minúsculas e sem acento, para a busca achar "revisao" em "Revisão". */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** O resultado de uma leitura, preso à consulta que o gerou (para não confundir com a de outro orquestrador). */
type Leitura = { consulta: string; listagem: ListagemDeSkills } | { consulta: string; erro: string };

interface Props {
  /** Os orquestradores abertos no canvas; o primeiro vem escolhido. Vazio: só as skills do usuário e de plugins. */
  orquestradores: readonly OrquestradorParaSkills[];
  aoFechar: () => void;
}

/**
 * As skills cadastradas no Claude Code, logo abaixo da ilha do canvas. Só leitura: mostra o que o Claude Code
 * enxerga (as do usuário, as do projeto do orquestrador escolhido e as de plugins) e avisa quando o nível de
 * permissão do orquestrador deixa as skills desligadas.
 */
export function PainelDeSkills({ orquestradores, aoFechar }: Props) {
  const id = useId();
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [leitura, setLeitura] = useState<Leitura | null>(null);

  // Se o escolhido fechou, vale o primeiro aberto.
  const orquestradorId =
    orquestradores.find((orquestrador) => orquestrador.id === escolhido)?.id ?? orquestradores[0]?.id ?? null;
  const consulta = orquestradorId ?? "";

  useEffect(() => {
    let atual = true;
    api
      .lerSkills(orquestradorId ?? undefined)
      .then((listagem) => {
        if (atual) {
          setLeitura({ consulta, listagem });
        }
      })
      .catch((falha: unknown) => {
        if (atual) {
          setLeitura({ consulta, erro: mensagemDeErro(falha) });
        }
      });
    return () => {
      atual = false;
    };
  }, [orquestradorId, consulta]);

  // Esc fecha, como no painel de subagentes: só o Esc dado no painel (ou sem nada focado).
  const painel = useRef<HTMLElement>(null);
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target;
      const noPainel = alvo === document.body || (alvo instanceof Node && painel.current?.contains(alvo) === true);
      if (evento.key === "Escape" && !evento.defaultPrevented && noPainel) {
        aoFechar();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  // Uma leitura de outra consulta (o orquestrador mudou) ainda não vale: segue "carregando".
  const atual = leitura !== null && leitura.consulta === consulta ? leitura : null;
  const listagem = atual !== null && "listagem" in atual ? atual.listagem : null;
  const erro = atual !== null && "erro" in atual ? atual.erro : null;

  const termo = normalizar(busca.trim());
  const filtradas = useMemo(() => {
    const todas = listagem?.skills ?? [];
    return termo === ""
      ? todas
      : todas.filter((skill) => normalizar(skill.nome).includes(termo) || normalizar(skill.descricao).includes(termo));
  }, [listagem, termo]);
  const grupos = GRUPOS.map((grupo) => ({
    ...grupo,
    skills: filtradas.filter((skill) => skill.origem === grupo.origem),
  })).filter((grupo) => grupo.skills.length > 0);

  const total = listagem?.skills.length ?? 0;

  return (
    <section ref={painel} className="painel-flutuante painel-da-barra painel-de-skills mt-2" aria-label="Skills do Claude Code">
      <header className="painel-da-barra-cabecalho">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="flex items-center gap-1.5 text-[14px]">
            <IconeSkills tamanho={16} className="text-active" />
            Skills do Claude Code
          </h2>
          <span className="text-support">
            O que o Claude Code tem cadastrado. Os agentes carregam a skill certa pelo pedido.
          </span>
        </div>
        <button type="button" className="botao-icone shrink-0" aria-label="Fechar skills" onClick={aoFechar}>
          <IconeFechar tamanho={16} />
        </button>
      </header>

      <div className="skills-barra">
        {orquestradores.length > 0 ? (
          <select
            id={`${id}-orquestrador`}
            className="select campo-escuro"
            aria-label="Orquestrador"
            value={orquestradorId ?? ""}
            onChange={(evento) => setEscolhido(evento.target.value)}
          >
            {orquestradores.map((orquestrador) => (
              <option key={orquestrador.id} value={orquestrador.id}>
                {orquestrador.nome}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-support self-center">Nenhum orquestrador aberto: só as skills globais.</span>
        )}
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

      {listagem !== null && listagem.liberadasNoNivel === false && (
        <div className="alert alert-warning mx-4 mt-3" role="note">
          {AVISO_DE_SKILLS_DESLIGADAS}
        </div>
      )}

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
        ) : grupos.length === 0 ? (
          <div className="subagentes-vazio">
            <strong className="font-titulo text-[13px]">Nenhuma skill combina com a busca</strong>
            <span className="text-support max-w-sm">Tente outra palavra do nome ou da descrição.</span>
          </div>
        ) : (
          grupos.map((grupo) => (
            <section key={grupo.origem} className="skills-grupo" aria-labelledby={`${id}-${grupo.origem}`}>
              <h3 id={`${id}-${grupo.origem}`}>
                {grupo.titulo}
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

      <div className="painel-da-barra-rodape">
        <span className="mr-auto text-support">
          Só leitura.{listagem !== null && total > 0 ? ` ${total.toLocaleString("pt-BR")} ${total === 1 ? "skill" : "skills"}.` : ""}
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={aoFechar}>
          Fechar
        </button>
      </div>
    </section>
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
