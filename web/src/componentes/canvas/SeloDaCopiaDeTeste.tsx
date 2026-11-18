import "../../theme/selo-da-copia-de-teste.css";

/**
 * O nome da branch quando o app é uma cópia de teste aberta do código
 * (`window.electron.copiaDeTeste`); null no app instalado, no navegador e na
 * ponte antiga, que não expõe o campo.
 */
function copiaDeTesteDoApp(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const copiaDeTeste = (window as unknown as { electron?: { copiaDeTeste?: unknown } }).electron?.copiaDeTeste;
  return typeof copiaDeTeste === "string" && copiaDeTeste.trim() !== "" ? copiaDeTeste.trim() : null;
}

/**
 * Selo na ilha do nome do app: "Cópia de teste: <branch>", para não confundir
 * a cópia aberta do código com o app de verdade. Fora dela, não desenha nada.
 */
export function SeloDaCopiaDeTeste() {
  const copiaDeTeste = copiaDeTesteDoApp();
  if (copiaDeTeste === null) {
    return null;
  }
  return (
    <span
      className="etiqueta etiqueta-warning selo-da-copia-de-teste"
      data-testid="selo-da-copia-de-teste"
      title={`Este app é uma cópia de teste aberta do código, na branch ${copiaDeTeste}. Não é o app instalado.`}
    >
      <span className="selo-da-copia-de-teste-texto">Cópia de teste: {copiaDeTeste}</span>
    </span>
  );
}
