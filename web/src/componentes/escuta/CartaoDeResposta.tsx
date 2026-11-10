import { TextoFormatado } from "../TextoFormatado";
import type { RespostaDaEscuta } from "./tipos";

interface Props {
  readonly resposta: RespostaDaEscuta | null;
  /** Em px; sem ele, o tamanho do tema. */
  readonly tamanhoDaFonte?: number;
}

/**
 * A resposta à pergunta que a escuta detectou: a pergunta numa linha no topo
 * (inteira no balão) e a resposta em tópicos curtos, em Markdown. Esperando a
 * resposta, um aviso discreto; sem pergunta ainda, um texto que orienta.
 */
export function CartaoDeResposta({ resposta, tamanhoDaFonte }: Props) {
  const texto = resposta?.texto ?? "";
  const temTexto = texto.trim() !== "";
  const carregando = resposta?.carregando ?? false;

  return (
    <section
      className="cartao-de-resposta"
      aria-label="Resposta da escuta"
      aria-busy={carregando}
      style={tamanhoDaFonte === undefined ? undefined : { fontSize: `${tamanhoDaFonte}px` }}
    >
      {resposta === null ? (
        <p className="cartao-de-resposta-vazio">As respostas às perguntas detectadas aparecem aqui.</p>
      ) : (
        <>
          <p className="pergunta-do-cartao-de-resposta">
            <span className="rotulo-tecnico">pergunta</span>
            <span className="texto-da-pergunta-do-cartao" title={resposta.pergunta}>
              {resposta.pergunta}
            </span>
          </p>
          {temTexto && <TextoFormatado texto={texto} className="texto-do-cartao-de-resposta custom-scrollbar" />}
          {carregando && (
            <p className="espera-do-cartao-de-resposta" role="status">
              <span className="pontos-de-espera" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              preparando a resposta…
            </p>
          )}
          {!temTexto && !carregando && <p className="cartao-de-resposta-vazio">Sem resposta para esta pergunta.</p>}
        </>
      )}
    </section>
  );
}
