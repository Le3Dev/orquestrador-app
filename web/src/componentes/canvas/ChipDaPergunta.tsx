import "../../theme/animacao-pergunta.css";

/** O selo kraft da barra do terminal enquanto o Claude espera uma resposta. */
export function ChipDaPergunta() {
  return (
    <span className="chip-da-pergunta mono" role="status" title="O Claude fez uma pergunta e espera a sua resposta">
      <i className="ponto-da-pergunta" aria-hidden="true" />
      pergunta pendente
    </span>
  );
}
