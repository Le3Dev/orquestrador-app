import { useId, useState } from "react";

import type { SituacaoDaTarefa, TarefaDoOrquestrador } from "../../shared/api/tipos";

const MARCAS: Readonly<Record<SituacaoDaTarefa, string>> = {
  concluida: "✓",
  em_andamento: "▸",
  pendente: "○",
};

const SITUACOES_LEGIVEIS: Readonly<Record<SituacaoDaTarefa, string>> = {
  concluida: "concluída",
  em_andamento: "em andamento",
  pendente: "pendente",
};

/**
 * Quanto do trabalho do pedido em andamento já foi feito, pela lista de
 * tarefas que o Orquestrador mantém (`TodoWrite`): a barra com "3 de 7
 * tarefas" e a tarefa em andamento ao lado. O clique abre a lista inteira,
 * marcada por situação; o `title` mostra a mesma lista ao passar o mouse.
 */
export function ProgressoDasTarefas({ tarefas }: { tarefas: readonly TarefaDoOrquestrador[] }) {
  const [aberta, setAberta] = useState(false);
  const idDaLista = useId();
  const concluidas = tarefas.filter((tarefa) => tarefa.situacao === "concluida").length;
  const emAndamento = tarefas.find((tarefa) => tarefa.situacao === "em_andamento") ?? null;
  const contagem = `${concluidas} de ${tarefas.length} tarefas`;
  const lista = tarefas.map((tarefa) => `${MARCAS[tarefa.situacao]} ${tarefa.texto}`).join("\n");

  return (
    <div className="progresso-das-tarefas">
      <div className="linha-do-terminal">
        <span />
        <span className="linha-simbolo">≡</span>
        <button
          type="button"
          className="progresso-das-tarefas-resumo col-span-2"
          aria-expanded={aberta}
          aria-controls={idDaLista}
          title={lista}
          onClick={() => setAberta((atual) => !atual)}
        >
          <span
            className="medidor"
            role="progressbar"
            aria-label="Tarefas concluídas"
            aria-valuemin={0}
            aria-valuemax={tarefas.length}
            aria-valuenow={concluidas}
          >
            <span style={{ width: `${(concluidas / tarefas.length) * 100}%` }} />
          </span>
          <span className="progresso-das-tarefas-contagem">{contagem}</span>
          {emAndamento !== null && <span className="progresso-das-tarefas-atual">· {emAndamento.texto}</span>}
        </button>
      </div>
      {aberta && (
        <ul id={idDaLista} className="progresso-das-tarefas-lista" aria-label="Tarefas do orquestrador">
          {tarefas.map((tarefa, indice) => (
            <li key={indice} className={`tarefa-${tarefa.situacao}`}>
              <span className="tarefa-marca" aria-hidden="true">
                {MARCAS[tarefa.situacao]}
              </span>
              <span>{tarefa.texto}</span>
              <span className="sr-only"> ({SITUACOES_LEGIVEIS[tarefa.situacao]})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
