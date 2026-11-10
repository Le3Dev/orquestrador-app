/**
 * ← e → como num navegador, no cabeçalho do artefato e da prévia. Desabilitados
 * quando não há para onde ir. `nodrag`: clicar neles não arrasta o nó.
 */

function Seta({ sentido }: { sentido: "voltar" | "avancar" }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={sentido === "voltar" ? "M19 12H5M11 6l-6 6 6 6" : "M5 12h14M13 6l6 6-6 6"}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BotoesDeNavegacao({
  podeVoltar,
  podeAvancar,
  aoVoltar,
  aoAvancar,
}: {
  podeVoltar: boolean;
  podeAvancar: boolean;
  aoVoltar: () => void;
  aoAvancar: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="botao-icone nodrag"
        title="Voltar"
        aria-label="Voltar"
        disabled={!podeVoltar}
        onClick={aoVoltar}
      >
        <Seta sentido="voltar" />
      </button>
      <button
        type="button"
        className="botao-icone nodrag"
        title="Avançar"
        aria-label="Avançar"
        disabled={!podeAvancar}
        onClick={aoAvancar}
      >
        <Seta sentido="avancar" />
      </button>
    </>
  );
}
