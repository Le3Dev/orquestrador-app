import { useEffect, useRef, useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import { useCanvas } from "../../shared/canvas/contexto";
import { candidatosAoVinculo, useVinculosSeHouver } from "../../shared/canvas/vinculos";

/** Dois elos de corrente: o ícone do vínculo. */
function IconeDeVinculo() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * "Vincular a…", na barra do terminal: lista os outros orquestradores (nome e
 * projeto, de qualquer projeto) que ainda não têm vínculo com este; escolher
 * um cria o vínculo, que aparece como uma linha entre os dois terminais.
 */
export function BotaoDeVincular({ orquestradorId }: { orquestradorId: string }) {
  const vinculos = useVinculosSeHouver();
  const { orquestradores } = useCanvas();
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ancora = useRef<HTMLDivElement>(null);

  // Clicar fora ou apertar Esc fecha a lista.
  useEffect(() => {
    if (!aberto) {
      return undefined;
    }
    const aoApertar = (evento: PointerEvent) => {
      if (evento.target instanceof Node && ancora.current?.contains(evento.target) !== true) {
        setAberto(false);
      }
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        setAberto(false);
      }
    };
    document.addEventListener("pointerdown", aoApertar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("pointerdown", aoApertar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  if (vinculos === null) {
    return null;
  }
  const candidatos = candidatosAoVinculo([...orquestradores.values()], vinculos.vinculos, orquestradorId);

  async function vincular(outroId: string): Promise<void> {
    setErro(null);
    setOcupado(true);
    try {
      await vinculos?.criar(orquestradorId, outroId);
      setAberto(false);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div ref={ancora} className="ancora-do-mais-da-barra nodrag">
      <button
        type="button"
        className="botao-icone"
        aria-label="Vincular a…"
        aria-haspopup="menu"
        aria-expanded={aberto}
        title="Vincular a outro orquestrador: notas compartilhadas e mensagens entre os dois"
        onClick={() => {
          setErro(null);
          setAberto((atual) => !atual);
        }}
      >
        <IconeDeVinculo />
      </button>
      {aberto && (
        <div role="menu" aria-label="Vincular a" className="menu-da-barra-do-terminal painel-flutuante">
          {candidatos.length === 0 ? (
            <span className="text-support px-1.5 py-1">Nenhum outro orquestrador para vincular.</span>
          ) : (
            candidatos.map((outro) => (
              <button
                key={outro.id}
                type="button"
                role="menuitem"
                className="item-de-vinculo"
                disabled={ocupado}
                onClick={() => void vincular(outro.id)}
              >
                <strong className="truncate">{outro.nome}</strong>
                <span className="text-support truncate">{outro.nomeDaPasta}</span>
              </button>
            ))
          )}
          {erro !== null && (
            <div className="alert alert-error" role="alert">
              {erro}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
