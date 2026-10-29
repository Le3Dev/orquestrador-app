import { type ClipboardEvent, type KeyboardEvent, useRef, useState } from "react";

import { formatarBytes } from "../../shared/formatacao";
import { type ImagemAnexada, TIPOS_DE_IMAGEM } from "../../shared/imagens";

const ALTURA_MAXIMA = 140;

interface Props {
  /** Servidor fora do ar: dá para escrever, mas não para enviar nem cancelar. */
  desconectado: boolean;
  trabalhando: boolean;
  cancelando: boolean;
  imagens: readonly ImagemAnexada[];
  aoAnexar: (arquivos: File[]) => void;
  aoRemoverImagem: (id: string) => void;
  /** Devolve se a mensagem foi aceita; só então o campo é limpo. */
  aoEnviar: (texto: string) => Promise<boolean>;
  aoCancelar: () => void;
}

/**
 * Linha de comando do terminal: Enter envia, Shift+Enter quebra linha e Esc
 * cancela o pedido em andamento. Imagens entram colando (Ctrl+V), pelo botão
 * de anexo ou arrastando para o terminal. Continua editável durante o
 * trabalho, para já ir escrevendo o próximo pedido.
 */
export function PromptDoTerminal({
  desconectado,
  trabalhando,
  cancelando,
  imagens,
  aoAnexar,
  aoRemoverImagem,
  aoEnviar,
  aoCancelar,
}: Props) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const temConteudo = texto.trim() !== "" || imagens.length > 0;

  function ajustarAltura(): void {
    const elemento = campo.current;
    if (elemento !== null) {
      elemento.style.height = "auto";
      elemento.style.height = `${Math.min(elemento.scrollHeight, ALTURA_MAXIMA)}px`;
    }
  }

  async function enviar(): Promise<void> {
    if (!temConteudo || trabalhando || enviando || desconectado) {
      return;
    }
    setEnviando(true);
    try {
      if (await aoEnviar(texto)) {
        setTexto("");
        requestAnimationFrame(ajustarAltura);
      }
    } finally {
      setEnviando(false);
    }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>): void {
    if (evento.key === "Enter" && !evento.shiftKey) {
      evento.preventDefault();
      void enviar();
    }
    if (evento.key === "Escape" && trabalhando && !cancelando && !desconectado) {
      evento.preventDefault();
      aoCancelar();
    }
  }

  function aoColar(evento: ClipboardEvent<HTMLTextAreaElement>): void {
    const arquivos = [...evento.clipboardData.files].filter((arquivo) => arquivo.type.startsWith("image/"));
    if (arquivos.length > 0) {
      evento.preventDefault();
      aoAnexar(arquivos);
    }
  }

  return (
    <div className="area-do-prompt nodrag nowheel">
      {imagens.length > 0 && (
        <div className="miniaturas-do-prompt">
          {imagens.map((imagem) => (
            <figure key={imagem.id} className="miniatura" title={`${imagem.nome} · ${formatarBytes(imagem.tamanhoEmBytes)}`}>
              <img src={imagem.previa} alt={imagem.nome} />
              <button
                type="button"
                className="miniatura-remover"
                aria-label={`Remover ${imagem.nome}`}
                onClick={() => aoRemoverImagem(imagem.id)}
              >
                ✕
              </button>
            </figure>
          ))}
        </div>
      )}
      <div className="prompt-do-terminal">
        <span className="text-active">❯</span>
        <textarea
          ref={campo}
          rows={1}
          value={texto}
          onChange={(evento) => {
            setTexto(evento.target.value);
            ajustarAltura();
          }}
          onKeyDown={aoTeclar}
          onPaste={aoColar}
          placeholder={
            desconectado
              ? "servidor desconectado — dá para escrever, o envio volta quando ele voltar"
              : trabalhando
                ? "trabalhando… (esc cancela) — já pode escrever o próximo"
                : "peça algo e pressione enter · cole ou arraste imagens"
          }
          aria-label="Mensagem para o orquestrador"
        />
        <input
          ref={seletor}
          type="file"
          accept={TIPOS_DE_IMAGEM.join(",")}
          multiple
          hidden
          onChange={(evento) => {
            aoAnexar([...(evento.target.files ?? [])]);
            evento.target.value = "";
          }}
        />
        <button
          type="button"
          className="botao-icone"
          title="Anexar imagens (também dá para colar com Ctrl+V ou arrastar para o terminal)"
          onClick={() => seletor.current?.click()}
        >
          📎
        </button>
        {trabalhando ? (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={aoCancelar}
            disabled={cancelando || desconectado}
          >
            {cancelando ? "cancelando…" : "cancelar"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-cta"
            onClick={() => void enviar()}
            disabled={!temConteudo || enviando || desconectado}
          >
            {enviando ? "…" : "enviar ⏎"}
          </button>
        )}
      </div>
    </div>
  );
}
