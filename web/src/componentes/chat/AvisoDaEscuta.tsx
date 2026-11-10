import { type KeyboardEvent, useEffect, useId, useRef } from "react";

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
      onKeyDown={aoTeclar}
    >
      <p id={idDoTitulo} className="titulo-do-aviso-da-escuta">
        Escutar o áudio do computador?
      </p>
      <ul id={idDaExplicacao} className="itens-do-aviso-da-escuta">
        <li>O áudio do computador (vídeo, chamada) é transcrito aqui mesmo, no seu computador, e não é gravado.</li>
        <li>Só os últimos 2 min de texto ficam guardados.</li>
        <li>Trechos com cara de pergunta vão ao Claude (Haiku), que confirma se são mesmo uma pergunta.</li>
        <li>
          A pergunta vai sozinha ao chat, com o print da tela. Com alterações autorizadas, ela vai para o campo, para
          você conferir antes de enviar.
        </li>
        <li>Dá para pausar no indicador ao lado do olho e desligar o automático na faixa da transcrição.</li>
      </ul>
      <div className="botoes-do-aviso-da-escuta">
        <button type="button" className="btn btn-sm btn-ghost" onClick={aoRecusar}>
          Agora não
        </button>
        <button type="button" className="btn btn-sm btn-cta" onClick={aoConfirmar}>
          Começar a escutar
        </button>
      </div>
    </div>
  );
}
