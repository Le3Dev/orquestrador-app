import { useEffect, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type {
  AcaoDeCriarSubagente,
  AcaoDeEditarSubagente,
  DadosDoSubagentePronto,
  ModeloDoSubagentePronto,
} from "../../shared/api/tipos";
import { tamanhoDasInstrucoes } from "../../shared/instrucoes";

interface Props {
  acao: AcaoDeCriarSubagente | AcaoDeEditarSubagente;
}

type Etapa = { tipo: "pronto" } | { tipo: "executando" } | { tipo: "feito" } | { tipo: "erro"; mensagem: string };

/** Como o painel Subagentes mostra o modelo no chip. */
function rotuloDoModelo(modelo: ModeloDoSubagentePronto): string {
  return modelo === "herdar" ? "herda" : modelo;
}

/** A lista com a ação aplicada, ou a mensagem de por que ela não vale contra a lista atual. */
function aplicar(
  acao: AcaoDeCriarSubagente | AcaoDeEditarSubagente,
  lista: readonly DadosDoSubagentePronto[],
): DadosDoSubagentePronto[] | string {
  const existente = lista.find((subagente) => subagente.nome === acao.nome);
  if (acao.tipo === "criar_subagente") {
    if (existente !== undefined) {
      return `Já existe um subagente pronto chamado "${acao.nome}". Peça ao chat para editar esse ou para usar outro nome.`;
    }
    const { nome, descricao, prompt, modelo } = acao;
    return [...lista, { nome, descricao, prompt, modelo }];
  }
  if (existente === undefined) {
    return `Não existe um subagente pronto chamado "${acao.nome}". Confira o nome no botão Subagentes.`;
  }
  return lista.map((subagente) =>
    subagente === existente
      ? {
          ...subagente,
          descricao: acao.descricao ?? subagente.descricao,
          prompt: acao.prompt ?? subagente.prompt,
          modelo: acao.modelo ?? subagente.modelo,
        }
      : subagente,
  );
}

/**
 * Ação sugerida pelo Claude no chat: criar um subagente pronto ou trocar
 * campos de um existente. Só acontece no clique: relê a biblioteca, aplica a
 * ação (criar com um nome que já existe, ou editar um que não existe, vira
 * erro no cartão, sem gravar) e grava a lista inteira, como o painel
 * Subagentes. Um 400 do servidor (formato do nome, reservado, tamanhos,
 * máximo de 10) aparece no cartão com a mensagem dele.
 *
 * No editar, o cartão lê a biblioteca ao aparecer para mostrar o antes e o
 * depois de cada campo trocado; sem ela, mostra só o valor novo.
 */
export function CartaoDeSubagente({ acao }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "pronto" });
  const [antes, setAntes] = useState<DadosDoSubagentePronto | null>(null);
  const editar = acao.tipo === "editar_subagente";

  useEffect(() => {
    if (!editar) {
      return;
    }
    let atual = true;
    api
      .lerPreferencias()
      .then((preferencias) => {
        if (atual) {
          setAntes(preferencias.subagentesProntos.find((subagente) => subagente.nome === acao.nome) ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      atual = false;
    };
  }, [editar, acao.nome]);

  async function executar(): Promise<void> {
    if (etapa.tipo === "executando" || etapa.tipo === "feito") {
      return;
    }
    setEtapa({ tipo: "executando" });
    try {
      const { subagentesProntos } = await api.lerPreferencias();
      const lista = aplicar(acao, subagentesProntos);
      if (typeof lista === "string") {
        setEtapa({ tipo: "erro", mensagem: lista });
        return;
      }
      await api.alterarPreferencias({ subagentesProntos: lista });
      setEtapa({ tipo: "feito" });
    } catch (falha) {
      setEtapa({ tipo: "erro", mensagem: mensagemDeErro(falha) });
    }
  }

  const modelo = acao.tipo === "criar_subagente" ? acao.modelo : (acao.modelo ?? antes?.modelo ?? null);

  return (
    <div className="cartao-de-acao">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-titulo text-[12.5px] font-medium text-primary">
          {editar ? "Editar subagente pronto" : "Novo subagente pronto"}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="mono truncate text-secondary" title={acao.nome}>
            {acao.nome}
          </span>
          {modelo !== null && <span className="chip-de-modelo">{rotuloDoModelo(modelo)}</span>}
        </span>
        {acao.tipo === "criar_subagente" ? (
          <>
            <span className="texto-longo text-[12px] text-secondary">quando usar: {acao.descricao}</span>
            <details className="prompt-do-subagente">
              <summary>prompt ({tamanhoDasInstrucoes(acao.prompt).toLocaleString("pt-BR")} caracteres)</summary>
              <p className="texto-longo">{acao.prompt}</p>
            </details>
          </>
        ) : (
          <div className="flex flex-col gap-0.5 text-[12px]" data-testid="o-que-muda">
            {acao.descricao !== null && (
              <span className="texto-longo text-secondary">
                quando usar:{" "}
                {antes !== null && antes.descricao !== acao.descricao && (
                  <>
                    <del className="text-muted">{antes.descricao}</del> →{" "}
                  </>
                )}
                {acao.descricao}
              </span>
            )}
            {acao.modelo !== null && (
              <span className="mono text-[11.5px] text-secondary">
                modelo: {antes !== null && <>{rotuloDoModelo(antes.modelo)} → </>}
                {rotuloDoModelo(acao.modelo)}
              </span>
            )}
            {acao.prompt !== null && (
              <details className="prompt-do-subagente">
                <summary>prompt novo ({tamanhoDasInstrucoes(acao.prompt).toLocaleString("pt-BR")} caracteres)</summary>
                {antes !== null && (
                  <>
                    <span className="rotulo-do-prompt">antes</span>
                    <p className="texto-longo text-muted">{antes.prompt}</p>
                    <span className="rotulo-do-prompt">depois</span>
                  </>
                )}
                <p className="texto-longo">{acao.prompt}</p>
              </details>
            )}
          </div>
        )}
        {etapa.tipo === "erro" && (
          <span className="hint-error texto-longo" role="alert">
            {etapa.mensagem}
          </span>
        )}
      </div>
      <button
        type="button"
        className={`btn btn-sm ${etapa.tipo === "feito" ? "btn-outline" : "btn-cta"}`}
        disabled={etapa.tipo === "executando" || etapa.tipo === "feito"}
        onClick={() => void executar()}
      >
        {etapa.tipo === "executando"
          ? "salvando…"
          : etapa.tipo === "feito"
            ? editar
              ? "alterado ✓"
              : "criado ✓"
            : etapa.tipo === "erro"
              ? "tentar de novo"
              : editar
                ? "aplicar"
                : "criar"}
      </button>
    </div>
  );
}
