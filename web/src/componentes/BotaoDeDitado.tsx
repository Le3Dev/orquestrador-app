import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { anuncioDoDitado } from "../shared/ditado/texto";
import { useDitado } from "../shared/ditado/useDitado";
import { IconeFechar, IconeMicrofone } from "./Icones";
import { PainelDoDitado } from "./PainelDoDitado";

/** Quanto tempo o aviso "texto adicionado" e o destaque no campo ficam à vista. */
export const TEMPO_DO_DESTAQUE_DO_DITADO_MS = 1_800;

/** O campo de texto do lugar onde o microfone está (chat, prompt do terminal ou campo de instruções). */
function campoDoMicrofone(raiz: HTMLElement | null): HTMLTextAreaElement | null {
  return raiz?.closest(".composer-do-chat, .prompt-do-terminal, .field")?.querySelector("textarea") ?? null;
}

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
 * Gravando, um painel ao lado mostra o cronômetro e as ondas da voz; ao
 * transcrever, o progresso; e o campo ganha um destaque rápido quando o texto
 * entra. Esc, com o foco no microfone ou no painel, descarta a gravação (e
 * Enter no botão conclui). Por isso o botão nunca fica
 * `disabled` (o navegador tira o foco de um botão focado que desabilita, e o
 * Esc iria para o corpo da página): enquanto pede o microfone ou transcreve, ele
 * fica `aria-disabled` e o clique é ignorado.
 */
export function BotaoDeDitado({ aoTranscrever, destino, className = "" }: Props) {
  const [inserido, setInserido] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const aoEntregar = useCallback(
    (texto: string) => {
      aoTranscrever(texto);
      setInserido(true);
    },
    [aoTranscrever],
  );
  const { fase, baixando, segundosDeAudio, erro, lerNivel, alternar, descartar, fecharErro } = useDitado(aoEntregar);
  const gravando = fase === "gravando";
  const ocupado = fase === "pedindo-microfone" || fase === "transcrevendo";

  const titulo = gravando
    ? "Gravando: clique para transformar em texto (Esc descarta)"
    : baixando !== null
      ? `Baixando o modelo de voz: ${baixando}% (só na primeira vez, uns 250 MB)`
      : fase === "transcrevendo"
        ? "Transformando a fala em texto…"
        : `Ditar ${destino} por voz (roda no seu computador, o áudio não sai dele)`;

  // O aviso de "texto adicionado" some sozinho.
  useEffect(() => {
    if (!inserido) return;
    const cronometro = setTimeout(() => setInserido(false), TEMPO_DO_DESTAQUE_DO_DITADO_MS);
    return () => clearTimeout(cronometro);
  }, [inserido]);

  // No campo: brilho suave enquanto transcreve e um destaque quando o texto entra (por atributo, o React não o apaga).
  const estadoDoCampo = fase === "transcrevendo" ? "transcrevendo" : inserido ? "inserido" : null;
  useEffect(() => {
    const campo = campoDoMicrofone(raiz.current);
    if (estadoDoCampo === null || campo === null) return;
    campo.setAttribute("data-ditado", estadoDoCampo);
    return () => campo.removeAttribute("data-ditado");
  }, [estadoDoCampo]);

  /** Os botões do painel somem ao agir: o foco volta ao microfone, para o Esc e o Enter seguirem valendo. */
  function agirNoPainel(acao: () => void): () => void {
    return () => {
      acao();
      botao.current?.focus();
    };
  }

  function aoTeclar(evento: KeyboardEvent<HTMLElement>): void {
    if (evento.key === "Escape" && gravando) {
      evento.preventDefault();
      evento.stopPropagation();
      descartar();
    }
  }

  return (
    <span ref={raiz} className={`ditado nodrag ${className}`} onKeyDown={aoTeclar}>
      <button
        ref={botao}
        type="button"
        className={`botao-icone ${gravando ? "botao-ditado-gravando" : ""}`}
        title={titulo}
        aria-label={gravando ? "Parar e transformar em texto" : `Ditar ${destino} por voz`}
        aria-pressed={gravando}
        aria-busy={ocupado}
        aria-disabled={ocupado}
        onClick={() => {
          if (!ocupado) {
            alternar();
          }
        }}
      >
        {ocupado ? <span className="girador-do-ditado" aria-hidden="true" /> : <IconeMicrofone />}
      </button>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {anuncioDoDitado(fase, baixando, inserido)}
      </span>
      <PainelDoDitado
        fase={fase}
        baixando={baixando}
        segundosDeAudio={segundosDeAudio}
        lerNivel={lerNivel}
        inserido={inserido}
        aoConcluir={agirNoPainel(alternar)}
        aoDescartar={agirNoPainel(descartar)}
      />
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
