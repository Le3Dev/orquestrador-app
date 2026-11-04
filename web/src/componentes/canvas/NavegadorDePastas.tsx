import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { ConteudoDaPasta } from "../../shared/api/tipos";
import { nomeDaPasta } from "../../shared/pastas";
import { IconePasta, IconeSetaAcima } from "../Icones";

interface Props {
  aoEscolher: (caminho: string) => void;
  /** Com o servidor fora, espera ele voltar para carregar. */
  conectado: boolean;
}

/**
 * Reserva da janela do sistema: navegar pelas pastas aqui dentro. Clicar
 * numa pasta só entra nela; quem escolhe é o botão "Usar", sempre com o nome
 * da pasta aberta. Dá também para colar um caminho e teclar Enter.
 */
export function NavegadorDePastas({ aoEscolher, conectado }: Props) {
  const [conteudo, setConteudo] = useState<ConteudoDaPasta | null>(null);
  const [digitado, setDigitado] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  // Só a resposta do último pedido vale: cliques rápidos não podem deixar
  // aberta uma pasta antiga que respondeu por último.
  const ultimoPedido = useRef(0);
  const campo = useRef<HTMLInputElement>(null);

  // Caminho longo: mostra o fim, onde está o nome da pasta aberta.
  const atual = conteudo?.atual;
  useEffect(() => {
    if (campo.current !== null && document.activeElement !== campo.current) {
      campo.current.scrollLeft = campo.current.scrollWidth;
    }
  }, [atual]);

  function abrir(caminho?: string): void {
    const pedido = ++ultimoPedido.current;
    setAbrindo(true);
    api
      .listarPastas(caminho)
      .then((resposta) => {
        if (pedido !== ultimoPedido.current) {
          return;
        }
        setConteudo(resposta);
        // A carga inicial não apaga um caminho que a pessoa já começou a digitar.
        setDigitado((anterior) => (caminho !== undefined || anterior.trim() === "" ? resposta.atual : anterior));
        setErro(null);
      })
      .catch((falha: unknown) => {
        if (pedido === ultimoPedido.current) {
          setErro(mensagemDeErro(falha));
        }
      })
      .finally(() => {
        if (pedido === ultimoPedido.current) {
          setAbrindo(false);
        }
      });
  }

  // Abre a pasta dos projetos. Tenta de novo quando o servidor volta.
  const carregou = conteudo !== null;
  useEffect(() => {
    if (!carregou && conectado) {
      abrir();
    }
  }, [carregou, conectado]);

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>): void {
    // Enter aqui abre o caminho digitado; não pode enviar o formulário.
    if (evento.key === "Enter") {
      evento.preventDefault();
      if (digitado.trim() !== "") {
        abrir(digitado.trim());
      }
    }
  }

  return (
    <div className="navegador-de-pastas flex flex-col gap-2">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          className="btn btn-outline botao-pasta-acima"
          title="Pasta acima"
          aria-label="Pasta acima"
          disabled={abrindo || conteudo?.acima == null}
          onClick={() => conteudo?.acima != null && abrir(conteudo.acima)}
        >
          <IconeSetaAcima />
        </button>
        <input
          ref={campo}
          className="input mono min-w-0 flex-1 text-[12px]"
          aria-label="Caminho da pasta aberta"
          value={digitado}
          placeholder={conteudo === null && erro === null ? "carregando pastas…" : "cole um caminho e tecle Enter"}
          spellCheck={false}
          autoComplete="off"
          onChange={(evento) => setDigitado(evento.target.value)}
          onKeyDown={aoTeclar}
          onBlur={() => conteudo !== null && digitado.trim() === "" && setDigitado(conteudo.atual)}
        />
      </div>

      {conteudo !== null && conteudo.atalhos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Atalhos">
          {conteudo.atalhos.map((atalho) => (
            <button
              key={atalho.caminho}
              type="button"
              className={`atalho-de-pasta ${conteudo.atual === atalho.caminho ? "atalho-de-pasta-atual" : ""}`}
              title={atalho.caminho}
              disabled={abrindo}
              onClick={() => abrir(atalho.caminho)}
            >
              {atalho.nome}
            </button>
          ))}
        </div>
      )}

      {conteudo !== null && (
        <ul className="lista-de-pastas custom-scrollbar" aria-label="Subpastas" aria-busy={abrindo}>
          {conteudo.pastas.length === 0 ? (
            <li className="mono text-[11.5px] text-muted px-2 py-1.5">nenhuma subpasta</li>
          ) : (
            conteudo.pastas.map((subpasta) => (
              <li key={subpasta.caminho}>
                <button
                  type="button"
                  className="item-de-pasta"
                  title={`Abrir ${subpasta.caminho}`}
                  disabled={abrindo}
                  onClick={() => abrir(subpasta.caminho)}
                >
                  <IconePasta tamanho={14} className="shrink-0" />
                  <span className="truncate">{subpasta.nome}</span>
                  <span className="ml-auto" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {conteudo !== null && (
        <button
          type="button"
          className="btn btn-sm btn-cta self-end"
          disabled={abrindo}
          onClick={() => aoEscolher(conteudo.atual)}
        >
          Usar “{nomeDaPasta(conteudo.atual)}”
        </button>
      )}

      {erro !== null && <p className="mono texto-longo text-[11.5px] text-error">✗ {erro}</p>}

      {conteudo === null && erro !== null && (
        <button
          type="button"
          className="btn btn-sm btn-outline self-start"
          disabled={abrindo || !conectado}
          onClick={() => abrir()}
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}
