import { useEffect, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDasPreferencias } from "../../shared/api/tipos";
import { CampoDeInstrucoes } from "../CampoDeInstrucoes";

interface Props {
  aoFechar: () => void;
  /** Depois de salvar: a lista de orquestradores é recarregada para atualizar os indicadores. */
  aoSalvar: () => void;
}

/**
 * Preferências que valem para todos os orquestradores, logo abaixo da barra
 * do canvas. Hoje: as instruções padrão, usadas por quem não tem instruções
 * próprias.
 */
export function PainelDePreferencias({ aoFechar, aoSalvar }: Props) {
  const [salvas, setSalvas] = useState<DadosDasPreferencias | null>(null);
  const [instrucoesPadrao, setInstrucoesPadrao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let atual = true;
    api
      .lerPreferencias()
      .then((preferencias) => {
        if (atual) {
          setSalvas(preferencias);
          setInstrucoesPadrao(preferencias.instrucoesPadrao);
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

  const alterado = salvas !== null && instrucoesPadrao !== salvas.instrucoesPadrao;

  async function salvar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      setSalvas(await api.alterarPreferencias({ instrucoesPadrao }));
      aoSalvar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section
      className="painel-flutuante mt-2 flex w-[30rem] max-w-[calc(100vw-2rem)] flex-col gap-3 px-4 py-3"
      aria-label="Preferências"
    >
      <span className="rotulo-tecnico">preferências · valem para todos os orquestradores</span>
      {salvas === null && erro === null ? (
        <span className="hint">carregando…</span>
      ) : (
        <CampoDeInstrucoes
          rotulo="Instruções padrão"
          ajuda="Usadas por todo orquestrador que não tem instruções próprias (as próprias substituem estas, sem somar). Valem a partir do próximo pedido."
          placeholder="Ex.: Responda sempre em português, com tópicos curtos."
          valor={instrucoesPadrao}
          aoMudar={setInstrucoesPadrao}
        />
      )}
      {erro !== null && <div className="alert alert-error">{erro}</div>}
      <div className="flex justify-end gap-2">
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
