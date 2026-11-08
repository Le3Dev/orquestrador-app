import { useEffect, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import { DICA_DAS_VARIAVEIS } from "../../shared/instrucoes";
import { CampoDeInstrucoes } from "../CampoDeInstrucoes";
import { Dica } from "../Dica";

interface Props {
  aoFechar: () => void;
  /** Depois de salvar: a página recarrega o que depende das instruções (os indicadores dos terminais). */
  aoSalvar: () => void;
}

/**
 * Instruções gerais, logo abaixo da barra do canvas: valem para todo
 * orquestrador sem instruções próprias. Salva só `instrucoesPadrao`; os
 * subagentes prontos têm o painel deles.
 */
export function PainelDeInstrucoesGerais({ aoFechar, aoSalvar }: Props) {
  const [salvas, setSalvas] = useState<string | null>(null);
  const [instrucoes, setInstrucoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let atual = true;
    api
      .lerPreferencias()
      .then((preferencias) => {
        if (atual) {
          setSalvas(preferencias.instrucoesPadrao);
          setInstrucoes(preferencias.instrucoesPadrao);
        }
      })
      .catch((falha: unknown) => {
        if (atual) {
          setErro(mensagemDeErro(falha));
        }
      });
    return () => {
      atual = false;
    };
  }, []);

  // Esc fecha sem salvar, como o Cancelar. Só o Esc dado no painel (ou sem
  // nada focado): o painel não é modal, e um Esc num terminal, numa nota ou
  // num menu da criação não pode jogar fora a edição daqui.
  const painel = useRef<HTMLElement>(null);
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target;
      const noPainel = alvo === document.body || (alvo instanceof Node && painel.current?.contains(alvo) === true);
      if (evento.key === "Escape" && !evento.defaultPrevented && noPainel) {
        aoFechar();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const alterado = salvas !== null && instrucoes !== salvas;

  async function salvar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      const preferencias = await api.alterarPreferencias({ instrucoesPadrao: instrucoes });
      setSalvas(preferencias.instrucoesPadrao);
      aoSalvar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section ref={painel} className="painel-flutuante painel-da-barra mt-2 w-[40rem]" aria-label="Instruções gerais">
      <div className="painel-da-barra-corpo custom-scrollbar">
        {salvas === null && erro === null ? (
          <span className="hint">carregando…</span>
        ) : (
          <CampoDeInstrucoes
            rotulo="Instruções gerais"
            ajuda={`Valem a partir do próximo pedido de cada orquestrador. ${DICA_DAS_VARIAVEIS}`}
            placeholder="Ex.: Responda sempre em português, com tópicos curtos."
            valor={instrucoes}
            aoMudar={setInstrucoes}
            linhas={10}
            dica={
              <Dica sobre="Instruções gerais" titulo="Valem para todos os orquestradores.">
                Entram no prompt de todo orquestrador que não tem instruções próprias. As instruções de um orquestrador
                substituem estas. Valem a partir do próximo pedido.
              </Dica>
            }
          />
        )}
        {erro !== null && <div className="alert alert-error">{erro}</div>}
      </div>
      <div className="painel-da-barra-rodape">
        <button type="button" className="btn btn-sm btn-ghost" onClick={aoFechar}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-sm btn-cta"
          onClick={() => void salvar()}
          disabled={salvando || !alterado}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </section>
  );
}
