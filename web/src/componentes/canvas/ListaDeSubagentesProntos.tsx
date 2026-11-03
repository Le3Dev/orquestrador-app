import { useId } from "react";

import {
  MAXIMO_DE_SUBAGENTES_PRONTOS,
  TAMANHO_MAXIMO_DA_DESCRICAO_DO_SUBAGENTE,
  TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE,
  type DadosDoSubagentePronto,
  type ModeloDoSubagentePronto,
} from "../../shared/api/tipos";
import { nomeDeSubagente } from "../../shared/subagentesProntos";

/** Um subagente na edição, com uma chave estável para a lista do React. */
export interface SubagenteEmEdicao extends DadosDoSubagentePronto {
  chave: string;
}

const MODELOS: { valor: ModeloDoSubagentePronto; rotulo: string }[] = [
  { valor: "herdar", rotulo: "Herdar do orquestrador" },
  { valor: "opus", rotulo: "Opus" },
  { valor: "sonnet", rotulo: "Sonnet" },
  { valor: "haiku", rotulo: "Haiku" },
];

interface PropsDoCartao {
  subagente: SubagenteEmEdicao;
  posicao: number;
  aoMudar: (alteracao: Partial<DadosDoSubagentePronto>) => void;
  aoRemover: () => void;
}

function CartaoDoSubagente({ subagente, posicao, aoMudar, aoRemover }: PropsDoCartao) {
  const id = useId();
  const passouDoPrompt = subagente.prompt.trim().length > TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE;
  return (
    <li className="cartao-subagente-pronto flex flex-col gap-2" aria-label={`Subagente pronto ${posicao}`}>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="field">
          <label className="label" htmlFor={`${id}-nome`}>
            Nome
          </label>
          <input
            id={`${id}-nome`}
            className="input mono"
            value={subagente.nome}
            placeholder="revisor-de-codigo"
            maxLength={40}
            onChange={(evento) => aoMudar({ nome: nomeDeSubagente(evento.target.value) })}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${id}-modelo`}>
            Modelo
          </label>
          <select
            id={`${id}-modelo`}
            className="select"
            value={subagente.modelo}
            onChange={(evento) => aoMudar({ modelo: evento.target.value as ModeloDoSubagentePronto })}
          >
            {MODELOS.map((modelo) => (
              <option key={modelo.valor} value={modelo.valor}>
                {modelo.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${id}-descricao`}>
          Quando usar
        </label>
        <input
          id={`${id}-descricao`}
          className="input"
          value={subagente.descricao}
          placeholder="Ex.: revisar código alterado procurando bugs"
          maxLength={TAMANHO_MAXIMO_DA_DESCRICAO_DO_SUBAGENTE}
          onChange={(evento) => aoMudar({ descricao: evento.target.value })}
        />
      </div>
      <div className="field">
        <div className="flex items-baseline justify-between gap-2">
          <label className="label" htmlFor={`${id}-prompt`}>
            Prompt
          </label>
          <span className={`mono text-[10.5px] ${passouDoPrompt ? "text-error" : "text-muted"}`}>
            {subagente.prompt.trim().length.toLocaleString("pt-BR")} /{" "}
            {TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE.toLocaleString("pt-BR")}
          </span>
        </div>
        <textarea
          id={`${id}-prompt`}
          className="textarea textarea-instrucoes custom-scrollbar"
          rows={3}
          value={subagente.prompt}
          placeholder="Ex.: Leia o diff, aponte bugs com arquivo e linha e não altere nada."
          aria-invalid={passouDoPrompt}
          onChange={(evento) => aoMudar({ prompt: evento.target.value })}
        />
      </div>
      <div className="flex justify-end">
        <button type="button" className="btn btn-sm btn-ghost" onClick={aoRemover}>
          Remover
        </button>
      </div>
    </li>
  );
}

interface Props {
  subagentes: SubagenteEmEdicao[];
  aoMudar: (subagentes: SubagenteEmEdicao[]) => void;
  /** Gera a chave de um subagente novo. */
  novaChave: () => string;
}

/**
 * Biblioteca de subagentes prontos: cada orquestrador recebe a lista e decide
 * quando usar cada um, pela descrição. Rodam com as mesmas permissões do
 * executor no pedido.
 */
export function ListaDeSubagentesProntos({ subagentes, aoMudar, novaChave }: Props) {
  const cheia = subagentes.length >= MAXIMO_DE_SUBAGENTES_PRONTOS;
  return (
    <div className="field">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">Subagentes prontos</span>
        <span className="mono text-[10.5px] text-muted">
          {subagentes.length} / {MAXIMO_DE_SUBAGENTES_PRONTOS}
        </span>
      </div>
      <span className="hint">
        Todo orquestrador recebe esta lista e decide quando usar cada um, pela descrição. Rodam com as mesmas
        permissões, ferramentas e esforço do executor no pedido, e contam na quantidade de subagentes.
      </span>
      {subagentes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {subagentes.map((subagente, indice) => (
            <CartaoDoSubagente
              key={subagente.chave}
              subagente={subagente}
              posicao={indice + 1}
              aoMudar={(alteracao) =>
                aoMudar(subagentes.map((outro) => (outro.chave === subagente.chave ? { ...outro, ...alteracao } : outro)))
              }
              aoRemover={() => aoMudar(subagentes.filter((outro) => outro.chave !== subagente.chave))}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn btn-sm btn-outline self-start"
        disabled={cheia}
        onClick={() =>
          aoMudar([...subagentes, { chave: novaChave(), nome: "", descricao: "", prompt: "", modelo: "herdar" }])
        }
      >
        + Adicionar subagente pronto
      </button>
    </div>
  );
}
