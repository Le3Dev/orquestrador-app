import { useEffect, useState } from "react";

import { api, mensagemDeErro } from "../shared/api/cliente";
import type { DadosDaConfiguracao, PreviaDoPrompt } from "../shared/api/tipos";

/** Espera depois da última tecla antes de pedir a prévia de novo. */
const ESPERA_PARA_ATUALIZAR_MS = 400;

const ORIGEM: Readonly<Record<NonNullable<PreviaDoPrompt["origemDasInstrucoes"]>, string>> = {
  orquestrador: "valem as instruções deste orquestrador",
  padrao: "valem as instruções gerais",
};

interface Props {
  configuracao: DadosDaConfiguracao;
  /** Sem pasta (rascunho ainda sem projeto), o servidor mostra um marcador no lugar do caminho. */
  pastaDeTrabalho?: string | undefined;
  /** O nome do orquestrador, para `{{nome}}` nas instruções. Sem ele, o servidor mostra um marcador. */
  nome?: string | undefined;
  /** Na criação, o botão de abrir é um link discreto abaixo das instruções. */
  comoLink?: boolean;
}

/**
 * Mostra o que o orquestrador receberia com a configuração na tela (ainda
 * não salva): o system prompt da conversa e a mensagem de cada pedido, com
 * as instruções personalizadas no fim do bloco. Quem monta o texto é o
 * servidor, com a mesma função usada nos pedidos de verdade.
 */
export function PreviaDoPromptFinal({ configuracao, pastaDeTrabalho, nome, comoLink = false }: Props) {
  const [aberta, setAberta] = useState(false);
  const [previa, setPrevia] = useState<PreviaDoPrompt | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const chave = JSON.stringify([configuracao, pastaDeTrabalho ?? "", nome ?? ""]);

  useEffect(() => {
    if (!aberta) {
      return;
    }
    let atual = true;
    const espera = setTimeout(() => {
      api
        .previaDoPrompt(configuracao, pastaDeTrabalho, "execucao", nome)
        .then((resposta) => {
          if (atual) {
            setPrevia(resposta);
            setErro(null);
          }
        })
        .catch((falha: unknown) => {
          if (atual) {
            setErro(mensagemDeErro(falha));
          }
        });
    }, ESPERA_PARA_ATUALIZAR_MS);
    return () => {
      atual = false;
      clearTimeout(espera);
    };
    // `chave` resume configuração, pasta e nome: objetos novos com o mesmo conteúdo não refazem o pedido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, chave]);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={comoLink ? "botao-link w-fit text-[12px]" : "btn btn-sm btn-outline w-fit"}
        aria-expanded={aberta}
        onClick={() => setAberta((valor) => !valor)}
      >
        {aberta ? "Esconder prompt final" : "Pré-visualizar prompt final"}
      </button>
      {aberta && (
        <div className="previa-do-prompt flex flex-col gap-2" aria-live="polite">
          {erro !== null && <div className="alert alert-error">{erro}</div>}
          {previa === null && erro === null && <span className="hint">montando…</span>}
          {previa !== null && (
            <>
              <span className="hint">
                {previa.origemDasInstrucoes === null
                  ? "Sem instruções personalizadas: o pedido vai exatamente como antes."
                  : `Neste pedido ${ORIGEM[previa.origemDasInstrucoes]}.`}
              </span>
              <span className="rotulo-tecnico">mensagem de cada pedido</span>
              <pre className="previa-do-prompt-texto custom-scrollbar">{previa.mensagem}</pre>
              <span className="rotulo-tecnico">system prompt da conversa (fixo desde o 1º pedido)</span>
              <pre className="previa-do-prompt-texto custom-scrollbar">{previa.instrucoesIniciais}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
