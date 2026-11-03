import { useEffect, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDasPreferencias, DadosDoSubagentePronto } from "../../shared/api/tipos";
import { CampoDeInstrucoes } from "../CampoDeInstrucoes";
import { ListaDeSubagentesProntos, type SubagenteEmEdicao } from "./ListaDeSubagentesProntos";

function semChave({ nome, descricao, prompt, modelo }: SubagenteEmEdicao): DadosDoSubagentePronto {
  return { nome, descricao, prompt, modelo };
}

interface Props {
  aoFechar: () => void;
  /** Depois de salvar: a lista de orquestradores é recarregada para atualizar os indicadores. */
  aoSalvar: () => void;
}

/**
 * Preferências que valem para todos os orquestradores, logo abaixo da barra
 * do canvas: as instruções padrão, usadas por quem não tem instruções
 * próprias, e a biblioteca de subagentes prontos.
 */
export function PainelDePreferencias({ aoFechar, aoSalvar }: Props) {
  const [salvas, setSalvas] = useState<DadosDasPreferencias | null>(null);
  const [instrucoesPadrao, setInstrucoesPadrao] = useState("");
  const [subagentes, setSubagentes] = useState<SubagenteEmEdicao[]>([]);
  const proximaChave = useRef(0);
  const novaChave = () => `subagente-${proximaChave.current++}`;
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
          setSubagentes(
            preferencias.subagentesProntos.map((subagente, indice) => ({ ...subagente, chave: `salvo-${indice}` })),
          );
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

  const alterado =
    salvas !== null &&
    (instrucoesPadrao !== salvas.instrucoesPadrao ||
      JSON.stringify(subagentes.map(semChave)) !== JSON.stringify(salvas.subagentesProntos));

  async function salvar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      setSalvas(await api.alterarPreferencias({ instrucoesPadrao, subagentesProntos: subagentes.map(semChave) }));
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
      className="painel-flutuante custom-scrollbar mt-2 flex max-h-[calc(100vh-7rem)] w-[30rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto px-4 py-3"
      aria-label="Preferências"
    >
      <span className="rotulo-tecnico">preferências · valem para todos os orquestradores</span>
      {salvas === null && erro === null ? (
        <span className="hint">carregando…</span>
      ) : (
        <>
          <CampoDeInstrucoes
            rotulo="Instruções padrão"
            ajuda="Usadas por todo orquestrador que não tem instruções próprias (as próprias substituem estas, sem somar). Valem a partir do próximo pedido."
            placeholder="Ex.: Responda sempre em português, com tópicos curtos."
            valor={instrucoesPadrao}
            aoMudar={setInstrucoesPadrao}
          />
          <ListaDeSubagentesProntos subagentes={subagentes} aoMudar={setSubagentes} novaChave={novaChave} />
        </>
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
