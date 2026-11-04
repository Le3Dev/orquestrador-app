import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { ConteudoDaPasta } from "../../shared/api/tipos";
import { nomeDaPasta } from "../../shared/pastas";

interface Props {
  /** Id do campo do caminho, para o rótulo do formulário apontar para ele. */
  id: string;
  /** A pasta escolhida ("" enquanto nenhuma foi escolhida). */
  valor: string;
  aoEscolher: (caminho: string) => void;
  /**
   * Avisa quando há um caminho digitado e ainda não aberto, ou uma pasta
   * abrindo: a pasta escolhida ainda não é a que aparece no campo.
   */
  aoMudarPendencia?: (pendente: boolean) => void;
  /** Com o servidor fora, espera ele voltar para carregar. */
  conectado: boolean;
}

/**
 * Escolha da pasta de trabalho: qualquer pasta do computador. Começa na pasta
 * dos projetos; entrar numa subpasta, subir, usar um atalho ou digitar um
 * caminho (Enter) abre e escolhe aquela pasta.
 */
export function NavegadorDePastas({ id, valor, aoEscolher, aoMudarPendencia, conectado }: Props) {
  const [conteudo, setConteudo] = useState<ConteudoDaPasta | null>(null);
  const [digitado, setDigitado] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  // Só a resposta do último clique vale: cliques rápidos não podem deixar
  // aberta uma pasta antiga que respondeu por último.
  const ultimoPedido = useRef(0);
  const campo = useRef<HTMLInputElement>(null);
  // A resposta chega depois do clique: escolhe com a versão mais nova do
  // callback, que enxerga o nome digitado nesse meio tempo.
  const aoEscolherAtual = useRef(aoEscolher);
  aoEscolherAtual.current = aoEscolher;
  const aoMudarPendenciaAtual = useRef(aoMudarPendencia);
  aoMudarPendenciaAtual.current = aoMudarPendencia;

  // Caminho longo: mostra o fim, onde está o nome da pasta aberta.
  const atual = conteudo?.atual;
  useEffect(() => {
    if (campo.current !== null && document.activeElement !== campo.current) {
      campo.current.scrollLeft = campo.current.scrollWidth;
    }
  }, [atual]);

  function abrir(caminho: string | undefined, escolher: boolean): void {
    const pedido = ++ultimoPedido.current;
    setAbrindo(true);
    api
      .listarPastas(caminho)
      .then((resposta) => {
        if (pedido !== ultimoPedido.current) {
          return;
        }
        setConteudo(resposta);
        // A carga inicial não apaga um caminho que o usuário já começou a digitar.
        setDigitado((anterior) => (escolher || anterior.trim() === "" ? resposta.atual : anterior));
        setErro(null);
        if (escolher) {
          aoEscolherAtual.current(resposta.atual);
        }
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

  // Abre a pasta dos projetos sem escolher nada: a escolha é sempre do usuário.
  // Tenta de novo quando o servidor volta: aberto com ele fora, ficaria preso
  // em "carregando pastas…".
  const carregou = conteudo !== null;
  useEffect(() => {
    if (!carregou && conectado) {
      abrir(undefined, false);
    }
  }, [carregou, conectado]);

  const pendente = abrindo || (conteudo !== null && digitado.trim() !== conteudo.atual);
  useEffect(() => {
    aoMudarPendenciaAtual.current?.(pendente);
  }, [pendente]);

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>): void {
    // Enter aqui abre o caminho digitado; não pode enviar o formulário.
    if (evento.key === "Enter") {
      evento.preventDefault();
      if (digitado.trim() !== "") {
        abrir(digitado.trim(), true);
      }
    }
  }

  const escolhida = conteudo !== null && valor === conteudo.atual;

  return (
    <div className="navegador-de-pastas flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          id={id}
          ref={campo}
          className="input mono flex-1 text-[12px]"
          value={digitado}
          placeholder={conteudo === null && erro === null ? "carregando pastas…" : "digite um caminho e tecle Enter"}
          spellCheck={false}
          autoComplete="off"
          onChange={(evento) => setDigitado(evento.target.value)}
          onKeyDown={aoTeclar}
        />
        <button
          type="button"
          className="btn btn-sm btn-outline"
          title="Pasta acima"
          aria-label="Pasta acima"
          disabled={abrindo || conteudo?.acima == null}
          onClick={() => conteudo?.acima != null && abrir(conteudo.acima, true)}
        >
          ↑
        </button>
      </div>

      {conteudo !== null && conteudo.atalhos.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Atalhos">
          {conteudo.atalhos.map((atalho) => (
            <button
              key={atalho.caminho}
              type="button"
              className="btn btn-sm btn-ghost"
              title={atalho.caminho}
              disabled={abrindo}
              onClick={() => abrir(atalho.caminho, true)}
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
                  className="item-de-pasta mono"
                  title={subpasta.caminho}
                  disabled={abrindo}
                  onClick={() => abrir(subpasta.caminho, true)}
                >
                  <span aria-hidden="true">▸</span> {subpasta.nome}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {conteudo !== null &&
        (escolhida ? (
          <span className="hint">
            ✓ Escolhida: <strong className="mono text-caption">{nomeDaPasta(conteudo.atual)}</strong>
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-outline self-start"
            disabled={abrindo}
            onClick={() => aoEscolher(conteudo.atual)}
          >
            Usar esta pasta
          </button>
        ))}

      {conteudo !== null && pendente && !abrindo && (
        <span className="hint text-warning">Tecle Enter para abrir o caminho digitado.</span>
      )}

      {erro !== null && <p className="mono texto-longo text-[11.5px] text-error">✗ {erro}</p>}

      {conteudo === null && erro !== null && (
        <button
          type="button"
          className="btn btn-sm btn-outline self-start"
          disabled={abrindo || !conectado}
          onClick={() => abrir(undefined, false)}
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}
