import { useId } from "react";

import type { DadosDaQuantidade } from "../../shared/api/tipos";

const LIMITE_DE_SUBAGENTES = 10;

const MODOS: readonly { modo: DadosDaQuantidade["modo"]; titulo: string; descricao: string }[] = [
  { modo: "automatica", titulo: "Automática", descricao: "Ele decide, até o máximo" },
  { modo: "fixa", titulo: "Fixa", descricao: "Sempre essa quantidade" },
];

interface Props {
  valor: DadosDaQuantidade;
  aoMudar: (quantidade: DadosDaQuantidade) => void;
}

/** Quantos subagentes ao mesmo tempo: ele decide até um máximo, ou sempre o mesmo número. */
export function QuantidadeDeSubagentes({ valor, aoMudar }: Props) {
  const idDoGrupo = useId();
  const idDoNumero = useId();
  const { modo, limite } = valor;

  function mudarLimite(novo: number): void {
    if (!Number.isFinite(novo)) {
      return;
    }
    aoMudar({ modo, limite: Math.min(LIMITE_DE_SUBAGENTES, Math.max(1, Math.round(novo))) });
  }

  return (
    <div className="quantidade-de-subagentes">
      <div className="quantidade-de-subagentes-modos" role="radiogroup" aria-label="Quantidade de subagentes">
        {MODOS.map((opcao) => (
          <label key={opcao.modo} className="quantidade-de-subagentes-opcao">
            <input
              type="radio"
              name={`${idDoGrupo}-modo`}
              value={opcao.modo}
              checked={modo === opcao.modo}
              onChange={() => aoMudar({ modo: opcao.modo, limite })}
            />
            <span className="quantidade-de-subagentes-titulo">{opcao.titulo}</span>
            <span className="quantidade-de-subagentes-descricao">{opcao.descricao}</span>
          </label>
        ))}
      </div>
      <div className="quantidade-de-subagentes-passo">
        <label htmlFor={idDoNumero} className="quantidade-de-subagentes-rotulo">
          {modo === "automatica" ? "Máximo" : "Quantidade"}
        </label>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          aria-label="Diminuir"
          disabled={limite <= 1}
          onClick={() => mudarLimite(limite - 1)}
        >
          −
        </button>
        <input
          id={idDoNumero}
          type="number"
          inputMode="numeric"
          className="input quantidade-de-subagentes-numero"
          min={1}
          max={LIMITE_DE_SUBAGENTES}
          value={limite}
          onChange={(evento) => {
            if (evento.target.value !== "") {
              mudarLimite(Number(evento.target.value));
            }
          }}
        />
        <button
          type="button"
          className="btn btn-sm btn-outline"
          aria-label="Aumentar"
          disabled={limite >= LIMITE_DE_SUBAGENTES}
          onClick={() => mudarLimite(limite + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
