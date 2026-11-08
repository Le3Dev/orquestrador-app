import { memo, useState } from "react";

import type { DadosDaConfiguracao, DecisaoDoPlano } from "../../shared/api/tipos";
import type { TurnoNaTela } from "../../shared/estado/aplicarEvento";
import { descreverConfiguracao } from "../../shared/formatacao";
import { TextoFormatado } from "../TextoFormatado";

/** O que o usuário pode fazer com o plano pendente. Os erros ficam a cargo de quem executa. */
export interface AcoesDoPlano {
  /** `commitarAoFinal`: o usuário marcou "Commitar ao final" (só aparece com o commit liberado). */
  aoAprovar: (commitarAoFinal: boolean) => Promise<void>;
  /** Liga o Plan Mode e leva o foco ao prompt, para pedir as mudanças no plano. */
  aoAjustar: () => void;
  aoDescartar: () => Promise<void>;
}

const SUFIXOS_DA_DECISAO: Readonly<Record<DecisaoDoPlano, string>> = {
  pendente: "",
  aprovado: " · aprovado",
  descartado: " · descartado",
};

interface Props {
  turno: TurnoNaTela;
  /** Configuração atual do Orquestrador: é com ela que o plano será executado. */
  configuracao: DadosDaConfiguracao;
  /** Só o último pedido pode ter plano pendente. */
  ultimo: boolean;
  desconectado: boolean;
  acoes: AcoesDoPlano;
}

/**
 * A resposta de um pedido em Plan Mode: o plano proposto e, enquanto ele
 * espera decisão, as ações de aprovar (executa na mesma sessão), ajustar ou
 * descartar.
 *
 * Memorizado: só re-renderiza quando o turno, a configuração ou as ações mudam.
 */
export const CartaoDoPlano = memo(function CartaoDoPlano({ turno, configuracao, ultimo, desconectado, acoes }: Props) {
  const [decidindo, setDecidindo] = useState<"aprovar" | "descartar" | null>(null);
  const [commitarAoFinal, setCommitarAoFinal] = useState(false);
  const pendente = turno.decisaoDoPlano === "pendente" && ultimo;
  const bloqueado = decidindo !== null || desconectado;
  // Só com o commit liberado e o terminal (é com ele que o agente commita).
  const podeCommitar = configuracao.permitirCommitEPush && configuracao.nivelDePermissao === "edicao_e_comandos";

  async function decidir(decisao: "aprovar" | "descartar", acao: () => Promise<void>): Promise<void> {
    setDecidindo(decisao);
    try {
      await acao();
    } finally {
      setDecidindo(null);
    }
  }

  return (
    <div className="cartao-do-plano">
      <span className="rotulo-tecnico">
        plano proposto{turno.decisaoDoPlano === null ? "" : SUFIXOS_DA_DECISAO[turno.decisaoDoPlano]}
      </span>
      <TextoFormatado texto={turno.resposta ?? ""} className="markdown-terminal" />
      {pendente && (
        <>
          <p className="hint">Será executado com: {descreverConfiguracao(configuracao)}</p>
          {configuracao.nivelDePermissao === "leitura" && (
            <div className="alert alert-warning">
              As permissões estão em somente leitura: a execução não poderá alterar arquivos. Ajuste na engrenagem do terminal antes de
              aprovar.
            </div>
          )}
          {podeCommitar && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={commitarAoFinal}
                onChange={(evento) => setCommitarAoFinal(evento.target.checked)}
                disabled={bloqueado}
              />
              Commitar ao final
              <span className="hint">(commit local na branch do worktree, sem push)</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm btn-cta"
              onClick={() => void decidir("aprovar", () => acoes.aoAprovar(podeCommitar && commitarAoFinal))}
              disabled={bloqueado}
            >
              {decidindo === "aprovar" ? "Aprovando…" : "Aprovar e executar"}
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={acoes.aoAjustar} disabled={bloqueado}>
              Ajustar plano
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void decidir("descartar", acoes.aoDescartar)}
              disabled={bloqueado}
            >
              {decidindo === "descartar" ? "Descartando…" : "Descartar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
});
