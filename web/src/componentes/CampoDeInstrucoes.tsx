import { type ReactNode, useId, useRef } from "react";

import { TAMANHO_MAXIMO_DAS_INSTRUCOES } from "../shared/api/tipos";
import { juntarDitado } from "../shared/ditado/texto";
import { useIdioma, useTextos, localeDoIdioma } from "../shared/idioma/idioma";
import { textosDeComponentesComuns } from "../shared/idioma/textos/componentesComuns";
import { tamanhoDasInstrucoes } from "../shared/instrucoes";
import { BotaoDeDitado } from "./BotaoDeDitado";

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
  const t = useTextos(textosDeComponentesComuns).instrucoes;
  const locale = localeDoIdioma(useIdioma());
  const id = useId();
  const idDaAjuda = useId();
  const campo = useRef<HTMLTextAreaElement>(null);
  const tamanho = tamanhoDasInstrucoes(valor);
  const passou = tamanho > TAMANHO_MAXIMO_DAS_INSTRUCOES;

  function receberDitado(ditado: string): void {
    const elemento = campo.current;
    const selecao =
      elemento === null ? undefined : { inicio: elemento.selectionStart, fim: elemento.selectionEnd };
    const novo = juntarDitado(valor, ditado, selecao);
    aoMudar(novo);
    if (elemento !== null && selecao !== undefined && selecao.inicio !== valor.length) {
      const posicao = novo.length - (valor.length - selecao.fim);
      requestAnimationFrame(() => {
        elemento.focus();
        elemento.setSelectionRange(posicao, posicao);
      });
    }
  }

  return (
    <div className="field">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <label className="label" htmlFor={id}>
            {rotulo}
          </label>
          {dica}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`mono text-[10.5px] ${passou ? "text-error" : "text-muted"}`} aria-live="polite">
            {tamanho.toLocaleString(locale)} / {TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString(locale)}
          </span>
          <BotaoDeDitado
            destino={t.ditarDestino}
            className="ditado-abaixo"
            aoTranscrever={receberDitado}
          />
        </span>
      </div>
      <textarea
        id={id}
        ref={campo}
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
          {t.passouDoLimite(TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString(locale))}
        </span>
      )}
    </div>
  );
}
