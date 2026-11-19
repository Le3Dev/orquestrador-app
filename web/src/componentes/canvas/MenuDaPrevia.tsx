import { type KeyboardEvent as EventoDeTecladoDoReact, useEffect, useId, useRef, useState } from "react";

import { useTextos } from "../../shared/idioma/idioma";
import { textosDeBarrasDoCanvas } from "../../shared/idioma/textos/canvasBarras";
import type { ApiDaPrevia } from "../../shared/ponteDoDesktop";

type SituacaoDoSair = "pronto" | "confirmando" | "saindo" | "feito" | "erro";

/**
 * O "⋯" da barra da prévia no app desktop: "Sair das contas" apaga o login e
 * os dados dos sites que a sessão própria das prévias externas guardou (todas
 * as prévias externas abertas recarregam). Pede confirmação, porque desfaz o
 * login de todos os sites de uma vez. Clique fora e Esc fecham.
 */
export function MenuDaPrevia({
  api,
  aberto,
  aoMudar,
}: {
  api: ApiDaPrevia;
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const idDoMenu = useId();
  const t = useTextos(textosDeBarrasDoCanvas);
  const [situacao, setSituacao] = useState<SituacaoDoSair>("pronto");

  // Clique fora fecha.
  useEffect(() => {
    if (!aberto) {
      return;
    }
    const aoPressionar = (evento: MouseEvent) => {
      if (raiz.current !== null && evento.target instanceof Node && !raiz.current.contains(evento.target)) {
        aoMudar(false);
      }
    };
    document.addEventListener("mousedown", aoPressionar, true);
    return () => document.removeEventListener("mousedown", aoPressionar, true);
  }, [aberto, aoMudar]);

  function alternar(): void {
    setSituacao("pronto");
    aoMudar(!aberto);
  }

  function aoTeclar(evento: EventoDeTecladoDoReact<HTMLDivElement>): void {
    if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      aoMudar(false);
    }
  }

  async function sair(): Promise<void> {
    if (situacao === "saindo") {
      return;
    }
    if (situacao !== "confirmando") {
      setSituacao("confirmando");
      return;
    }
    setSituacao("saindo");
    try {
      setSituacao((await api.sairDasContas()) ? "feito" : "erro");
    } catch {
      setSituacao("erro");
    }
  }

  const rotulos: Record<SituacaoDoSair, string> = {
    pronto: t.sairDasContas,
    confirmando: t.confirmarSair,
    saindo: t.saindoDasContas,
    feito: t.sairDasContas,
    erro: t.tentarSairDeNovo,
  };

  return (
    <div ref={raiz} className="ancora-do-mais-da-barra nodrag" onKeyDown={aoTeclar}>
      <button
        type="button"
        className="botao-icone nodrag"
        aria-label={t.menuDaPrevia}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        title={t.menuDaPrevia}
        onClick={alternar}
      >
        ⋯
      </button>
      {aberto && (
        <div id={idDoMenu} role="menu" aria-label={t.menuDaPrevia} className="menu-da-previa painel-flutuante nowheel">
          <button
            type="button"
            role="menuitem"
            className="item-do-menu nodrag"
            disabled={situacao === "saindo"}
            onClick={() => void sair()}
          >
            {rotulos[situacao]}
          </button>
          <p className="aviso-do-menu-da-previa" role="status">
            {situacao === "confirmando"
              ? t.avisoConfirmando
              : situacao === "feito"
                ? t.avisoFeito
                : situacao === "erro"
                  ? t.avisoErro
                  : t.avisoPadrao}
          </p>
        </div>
      )}
    </div>
  );
}
