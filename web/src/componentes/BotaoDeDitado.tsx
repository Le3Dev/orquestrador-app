import type { KeyboardEvent } from "react";

import { useDitado } from "../shared/ditado/useDitado";
import { IconeFechar, IconeMicrofone } from "./Icones";

interface Props {
  /** Recebe o texto transcrito, para juntar ao campo. */
  aoTranscrever: (texto: string) => void;
  /** Onde o texto vai parar, para o rótulo do botão (ex.: "a mensagem"). */
  destino: string;
  className?: string;
}

/**
 * Microfone: clica para falar, clica de novo para virar texto. A
 * transcrição roda no próprio computador (Whisper), e o áudio não sai dele.
 * Esc, com o botão focado, descarta a gravação.
 */
export function BotaoDeDitado({ aoTranscrever, destino, className = "" }: Props) {
  const { fase, baixando, erro, alternar, descartar, fecharErro } = useDitado(aoTranscrever);
  const gravando = fase === "gravando";
  const ocupado = fase === "pedindo-microfone" || fase === "transcrevendo";

  const titulo = gravando
    ? "Gravando: clique para transformar em texto (Esc descarta)"
    : baixando !== null
      ? `Baixando o modelo de voz: ${baixando}% (só na primeira vez, uns 250 MB)`
      : fase === "transcrevendo"
        ? "Transformando a fala em texto…"
        : `Ditar ${destino} por voz (roda no seu computador, o áudio não sai dele)`;

  function aoTeclar(evento: KeyboardEvent<HTMLButtonElement>): void {
    if (evento.key === "Escape" && gravando) {
      evento.preventDefault();
      evento.stopPropagation();
      descartar();
    }
  }

  return (
    <span className={`ditado nodrag ${className}`}>
      <button
        type="button"
        className={`botao-icone ${gravando ? "botao-ditado-gravando" : ""}`}
        title={titulo}
        aria-label={gravando ? "Parar e transformar em texto" : `Ditar ${destino} por voz`}
        aria-pressed={gravando}
        aria-busy={ocupado}
        disabled={ocupado}
        onClick={alternar}
        onKeyDown={aoTeclar}
      >
        {ocupado ? <span className="girador-do-ditado" aria-hidden="true" /> : <IconeMicrofone />}
      </button>
      {(baixando !== null || fase === "transcrevendo") && (
        <span className="balao-do-ditado mono" role="status">
          {baixando !== null ? `baixando modelo de voz · ${baixando}%` : "transcrevendo…"}
        </span>
      )}
      {erro !== null && (
        <span className="balao-do-ditado balao-do-ditado-erro" role="alert">
          <span className="flex-1">{erro}</span>
          <button type="button" className="botao-icone shrink-0" aria-label="Fechar aviso do ditado" onClick={fecharErro}>
            <IconeFechar tamanho={12} />
          </button>
        </span>
      )}
    </span>
  );
}
