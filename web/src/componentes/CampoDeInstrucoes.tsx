import { type ReactNode, useId } from "react";

import { TAMANHO_MAXIMO_DAS_INSTRUCOES } from "../shared/api/tipos";
import { tamanhoDasInstrucoes } from "../shared/instrucoes";

interface Props {
  rotulo: string;
  ajuda: string;
  valor: string;
  aoMudar: (texto: string) => void;
  placeholder?: string;
  /** Explicação curta ao lado do rótulo (o ícone ⓘ da `Dica`). */
  dica?: ReactNode;
  /** Altura inicial da caixa, em linhas. */
  linhas?: number;
}

/**
 * Texto livre de instruções para o orquestrador, com contador. Passar do
 * limite não trava a digitação (colar um texto grande não some em silêncio):
 * só avisa, e o servidor recusa ao salvar com a mesma mensagem.
 */
export function CampoDeInstrucoes({ rotulo, ajuda, valor, aoMudar, placeholder, dica, linhas = 4 }: Props) {
  const id = useId();
  const idDaAjuda = useId();
  const tamanho = tamanhoDasInstrucoes(valor);
  const passou = tamanho > TAMANHO_MAXIMO_DAS_INSTRUCOES;

  return (
    <div className="field">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <label className="label" htmlFor={id}>
            {rotulo}
          </label>
          {dica}
        </span>
        <span className={`mono text-[10.5px] ${passou ? "text-error" : "text-muted"}`} aria-live="polite">
          {tamanho.toLocaleString("pt-BR")} / {TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString("pt-BR")}
        </span>
      </div>
      <textarea
        id={id}
        className="textarea textarea-instrucoes custom-scrollbar"
        rows={linhas}
        value={valor}
        placeholder={placeholder}
        aria-describedby={idDaAjuda}
        aria-invalid={passou}
        spellCheck
        onChange={(evento) => aoMudar(evento.target.value)}
      />
      <span id={idDaAjuda} className="hint">
        {ajuda}
      </span>
      {passou && (
        <span className="text-[11px] text-error" role="alert">
          Passou do limite de {TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString("pt-BR")} caracteres: encurte o texto para
          conseguir salvar.
        </span>
      )}
    </div>
  );
}
