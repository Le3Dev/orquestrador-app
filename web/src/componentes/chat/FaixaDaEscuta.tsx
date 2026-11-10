import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import type { IdiomaDaEscuta, PrioridadeDoMotor } from "../../shared/escuta/preferenciasDaEscuta";
import type { EscutaNaTela } from "../../shared/escuta/useEscuta";

type Props = Pick<
  EscutaNaTela,
  "automatico" | "alternarAutomatico" | "ultimaPergunta" | "preferenciasDaTela" | "mudarIdioma" | "mudarPrioridadeDoMotor"
>;

const IDIOMAS: readonly { readonly valor: IdiomaDaEscuta; readonly rotulo: string; readonly explicacao: string }[] = [
  { valor: "portuguese", rotulo: "Português", explicacao: "Transcreve sempre em português (acerta mais nas falas em português)" },
  { valor: "automatico", rotulo: "Automático", explicacao: "Detecta o idioma de cada fala" },
];

const PRIORIDADES: readonly { readonly valor: PrioridadeDoMotor; readonly rotulo: string; readonly explicacao: string }[] = [
  { valor: "velocidade", rotulo: "Velocidade", explicacao: "Modelo mais leve: a legenda chega mais rápido" },
  { valor: "precisao", rotulo: "Precisão", explicacao: "Modelo maior: acerta mais, com um pouco mais de atraso" },
];

/**
 * O menu discreto de ajustes da escuta (⚙): o idioma da transcrição e o que
 * pesa na escolha do motor. Abre para cima, sobre a legenda; fecha no Esc, ao
 * clicar fora ou no próprio botão.
 */
function AjustesDaEscuta({
  preferenciasDaTela,
  mudarIdioma,
  mudarPrioridadeDoMotor,
}: Pick<Props, "preferenciasDaTela" | "mudarIdioma" | "mudarPrioridadeDoMotor">) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const idDoMenu = useId();
  const nomeDoGrupo = useId();

  useEffect(() => {
    if (!aberto) {
      return undefined;
    }
    const aoApertarFora = (evento: PointerEvent) => {
      if (evento.target instanceof Node && raiz.current?.contains(evento.target) !== true) {
        setAberto(false);
      }
    };
    document.addEventListener("pointerdown", aoApertarFora);
    return () => document.removeEventListener("pointerdown", aoApertarFora);
  }, [aberto]);

  const aoTeclar = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      evento.stopPropagation();
      setAberto(false);
      botao.current?.focus();
    }
  };

  return (
    <div ref={raiz} className="ajustes-da-escuta" onKeyDown={aoTeclar}>
      <button
        ref={botao}
        type="button"
        className="botao-do-painel-da-escuta"
        aria-label="Ajustes da escuta"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        title="Ajustes da escuta: idioma e motor da transcrição"
        onClick={() => setAberto((atual) => !atual)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {aberto && (
        <div id={idDoMenu} className="menu-de-ajustes-da-escuta" role="group" aria-label="Ajustes da escuta">
          <fieldset className="grupo-de-ajustes-da-escuta">
            <legend className="rotulo-tecnico">idioma</legend>
            {IDIOMAS.map(({ valor, rotulo, explicacao }) => (
              <label key={valor} className="opcao-de-ajuste-da-escuta" title={explicacao}>
                <input
                  type="radio"
                  name={`${nomeDoGrupo}-idioma`}
                  value={valor}
                  checked={preferenciasDaTela.idioma === valor}
                  onChange={() => mudarIdioma(valor)}
                />
                {rotulo}
              </label>
            ))}
          </fieldset>
          <fieldset className="grupo-de-ajustes-da-escuta">
            <legend className="rotulo-tecnico">prioridade do motor</legend>
            {PRIORIDADES.map(({ valor, rotulo, explicacao }) => (
              <label key={valor} className="opcao-de-ajuste-da-escuta" title={explicacao}>
                <input
                  type="radio"
                  name={`${nomeDoGrupo}-prioridade`}
                  value={valor}
                  checked={preferenciasDaTela.prioridadeDoMotor === valor}
                  onChange={() => mudarPrioridadeDoMotor(valor)}
                />
                {rotulo}
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </div>
  );
}

/**
 * O pé do painel da escuta, numa linha: a chave "Automático", a última
 * pergunta (quando não está à vista no cartão) e os ajustes. A legenda, o
 * download e o erro (com fechar) ficam no próprio painel.
 */
export function FaixaDaEscuta({
  automatico,
  alternarAutomatico,
  ultimaPergunta,
  preferenciasDaTela,
  mudarIdioma,
  mudarPrioridadeDoMotor,
}: Props) {
  return (
    <div className="faixa-enxuta-da-escuta" role="group" aria-label="Controles da escuta" data-testid="faixa-da-escuta">
      <button
        type="button"
        role="switch"
        className="interruptor interruptor-da-escuta"
        aria-checked={automatico}
        title={
          automatico
            ? "Automático: a pergunta detectada vai sozinha ao chat"
            : "Automático desligado: a escuta só transcreve, nada é enviado"
        }
        onClick={alternarAutomatico}
      >
        <span className="interruptor-trilho" aria-hidden="true" />
        Automático
      </button>
      {ultimaPergunta === null ? (
        <span className="flex-1" />
      ) : (
        <p className="ultima-pergunta-da-escuta" title={ultimaPergunta}>
          <span className="rotulo-tecnico">última pergunta</span> {ultimaPergunta}
        </p>
      )}
      <AjustesDaEscuta
        preferenciasDaTela={preferenciasDaTela}
        mudarIdioma={mudarIdioma}
        mudarPrioridadeDoMotor={mudarPrioridadeDoMotor}
      />
    </div>
  );
}
