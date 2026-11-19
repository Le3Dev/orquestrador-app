import { type KeyboardEvent, useEffect, useId, useRef } from "react";

import { useTextos } from "../../shared/idioma/idioma";
import { textosDeChat } from "../../shared/idioma/textos/chat";

interface Props {
  /** "Começar a escutar": só então a captura do áudio começa. */
  aoConfirmar: () => void;
  /** "Agora não" (ou Esc): não escuta nesta entrada no modo invisível. */
  aoRecusar: () => void;
}

/**
 * O aviso da primeira vez, dentro do chat rápido, antes de qualquer captura:
 * explica o que a escuta faz com o áudio do computador e só a liga quando o
 * usuário confirma.
 */
export function AvisoDaEscuta({ aoConfirmar, aoRecusar }: Props) {
  const t = useTextos(textosDeChat).aviso;
  const idDoTitulo = useId();
  const idDaExplicacao = useId();
  const cartao = useRef<HTMLDivElement>(null);

  // O foco vai ao cartão (e não a um botão): um Enter perdido não liga a escuta sem querer.
  useEffect(() => {
    cartao.current?.focus();
  }, []);

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>): void {
    if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      aoRecusar();
    }
  }

  return (
    <div
      ref={cartao}
      role="dialog"
      aria-labelledby={idDoTitulo}
      aria-describedby={idDaExplicacao}
      tabIndex={-1}
      className="aviso-da-escuta painel-flutuante"
      data-area-clicavel
      onKeyDown={aoTeclar}
    >
      <p id={idDoTitulo} className="titulo-do-aviso-da-escuta">
        {t.titulo}
      </p>
      <ul id={idDaExplicacao} className="itens-do-aviso-da-escuta">
        <li>{t.item1}</li>
        <li>{t.item2}</li>
        <li>{t.item3}</li>
        <li>{t.item4}</li>
        <li>{t.item5}</li>
      </ul>
      <div className="botoes-do-aviso-da-escuta">
        <button type="button" className="btn btn-sm btn-ghost" onClick={aoRecusar}>
          {t.agoraNao}
        </button>
        <button type="button" className="btn btn-sm btn-cta" onClick={aoConfirmar}>
          {t.comecar}
        </button>
      </div>
    </div>
  );
}
