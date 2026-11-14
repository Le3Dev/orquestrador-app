import { memo, useEffect } from "react";

import type { FerramentaDeDesenho } from "../../shared/canvas/desenho";
import type { CorDoDesenho, EspessuraDoDesenho } from "../../shared/canvas/layout";
import type { FerramentaNaPagina } from "../../shared/desenhoNaPagina";
import { BarraDeDesenho } from "./BarraDeDesenho";

/** As ferramentas da barra compacta da tela cheia. */
const FERRAMENTAS_DA_TELA_CHEIA: readonly FerramentaDeDesenho[] = ["caneta", "seta", "retangulo", "texto", "borracha"];
/** A espessura fica na média: a barra compacta não oferece a escolha. */
export const ESPESSURA_DA_TELA_CHEIA: EspessuraDoDesenho = 3;
const FECHAR_DA_TELA_CHEIA = {
  nome: "Desligar o desenho",
  dica: "Desligar o desenho (Esc); os traços continuam na página",
};

/** Foco num campo de texto: a tecla é do campo, não do desenho. */
function focoEmCampoDeTexto(alvo: EventTarget | null): boolean {
  return (
    alvo instanceof HTMLElement &&
    (alvo.isContentEditable || alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT")
  );
}

interface Props {
  ferramenta: FerramentaNaPagina;
  cor: CorDoDesenho;
  podeDesfazer: boolean;
  aoEscolherFerramenta: (ferramenta: FerramentaNaPagina) => void;
  aoEscolherCor: (cor: CorDoDesenho) => void;
  aoDesfazer: () => void;
  /** O fechar da barrinha: desliga o modo (os traços ficam). */
  aoDesligar: () => void;
}

/**
 * A barrinha do desenho sobre a página de um artefato em tela cheia, no alto do
 * corpo. Só aparece com o modo ligado. O desenho em si mora dentro da página
 * (`desenhoNaPagina.ts`): a barra só escolhe ferramenta e cor, desfaz e desliga.
 *
 * Ctrl/Cmd+Z com o foco no app desfaz aqui; com o foco dentro da página, a
 * própria página repassa a tecla. O Esc quem trata é a `JanelaEmTelaCheia`
 * (primeiro desliga o modo, depois fecha).
 */
export const DesenhoDaTelaCheia = memo(function DesenhoDaTelaCheia({
  ferramenta,
  cor,
  podeDesfazer,
  aoEscolherFerramenta,
  aoEscolherCor,
  aoDesfazer,
  aoDesligar,
}: Props) {
  useEffect(() => {
    const aoApertarTecla = (evento: KeyboardEvent) => {
      if (evento.defaultPrevented || focoEmCampoDeTexto(evento.target)) {
        return;
      }
      const comComando = evento.metaKey || evento.ctrlKey;
      if (comComando && !evento.shiftKey && !evento.altKey && (evento.code === "KeyZ" || evento.key === "z")) {
        evento.preventDefault();
        aoDesfazer();
      }
    };
    window.addEventListener("keydown", aoApertarTecla);
    return () => window.removeEventListener("keydown", aoApertarTecla);
  }, [aoDesfazer]);

  return (
    <div className="barra-do-desenho-da-tela-cheia" data-testid="barra-do-desenho-da-tela-cheia">
      <BarraDeDesenho
        ferramenta={ferramenta}
        cor={cor}
        espessura={ESPESSURA_DA_TELA_CHEIA}
        podeDesfazer={podeDesfazer}
        aoEscolherFerramenta={(nova) => {
          if (nova !== "selecionar") {
            aoEscolherFerramenta(nova);
          }
        }}
        aoEscolherCor={aoEscolherCor}
        aoEscolherEspessura={() => undefined}
        aoDesfazer={aoDesfazer}
        aoFechar={aoDesligar}
        ferramentas={FERRAMENTAS_DA_TELA_CHEIA}
        comEspessura={false}
        fechar={FECHAR_DA_TELA_CHEIA}
      />
    </div>
  );
});
