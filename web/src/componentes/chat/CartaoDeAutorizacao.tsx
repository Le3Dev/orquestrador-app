import { useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { AutorizacaoPendente } from "../../shared/api/tipos";

/** A pergunta que vai depois de autorizar, para o Claude retomar o que parou. */
export const PERGUNTA_APOS_AUTORIZAR = "Autorizado. Continue de onde parou.";

interface Props {
  autorizacao: AutorizacaoPendente;
  /** O chat já está autorizado (o evento chegou): o cartão some, a menos que mostre um erro. */
  autorizado: boolean;
  /** Durante uma resposta ou com o servidor desconectado não dá para autorizar. */
  desabilitado: boolean;
  /** Envia a pergunta pelo mesmo fluxo do campo do chat; lança se o servidor recusar. */
  aoEnviarPergunta: (pergunta: string) => Promise<void>;
}

type Etapa =
  | { tipo: "pronto" }
  | { tipo: "autorizando" }
  | { tipo: "feito" }
  | { tipo: "dispensado" }
  | { tipo: "erro"; mensagem: string };

/**
 * Pedido de autorização na última resposta do Claude: ele parou porque
 * precisava editar um arquivo ou rodar um comando. Autorizar vale até o
 * próximo `/clear`, para editar e para rodar comandos, e já manda o Claude
 * continuar. "Agora não" só esconde o cartão.
 */
export function CartaoDeAutorizacao({ autorizacao, autorizado, desabilitado, aoEnviarPergunta }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "pronto" });

  async function autorizar(): Promise<void> {
    if (etapa.tipo === "autorizando" || desabilitado) {
      return;
    }
    setEtapa({ tipo: "autorizando" });
    try {
      // Primeiro a autorização: a pergunta de continuar só vai com ela gravada.
      await api.autorizarAlteracoesDoChat(true);
      await aoEnviarPergunta(PERGUNTA_APOS_AUTORIZAR);
      setEtapa({ tipo: "feito" });
    } catch (falha) {
      setEtapa({ tipo: "erro", mensagem: mensagemDeErro(falha) });
    }
  }

  // Já autorizado, o cartão só continua na tela se estiver no meio do envio ou com um erro para mostrar.
  if (
    etapa.tipo === "dispensado" ||
    etapa.tipo === "feito" ||
    (autorizado && etapa.tipo === "pronto")
  ) {
    return null;
  }

  const autorizando = etapa.tipo === "autorizando";
  const verbo = autorizacao.acao === "editar" ? "editar" : "rodar";

  return (
    <div className="cartao-de-autorizacao" role="group" aria-label="Pedido de autorização do chat">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-titulo text-[12.5px] font-medium text-primary">
          O chat quer {verbo} <code className="detalhe-da-autorizacao">{autorizacao.detalhe}</code>
        </span>
        <span className="texto-longo text-[12px] text-secondary">
          Autorizando, ele poderá editar arquivos e rodar comandos nos projetos sem perguntar de novo, até o próximo
          /clear.
        </span>
        {etapa.tipo === "erro" && (
          <span className="hint-error texto-longo" role="alert">
            {etapa.mensagem}
          </span>
        )}
      </div>
      <div className="acoes-da-autorizacao">
        <button
          type="button"
          className="btn btn-sm botao-de-autorizar"
          disabled={desabilitado || autorizando}
          onClick={() => void autorizar()}
        >
          {autorizando
            ? "autorizando…"
            : etapa.tipo === "erro"
              ? "tentar de novo"
              : "Autorizar até o /clear e continuar"}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={autorizando}
          onClick={() => setEtapa({ tipo: "dispensado" })}
        >
          Agora não
        </button>
      </div>
    </div>
  );
}
