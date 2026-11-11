import { AVISO_DO_FORMATO_ANTIGO, formatoDoDocumento } from "../shared/anexos";
import { formatarBytes } from "../shared/formatacao";
import { IconeDocumento, IconeFechar } from "./Icones";

interface Props {
  nome: string;
  /** Rótulo do formato ("PDF", "Word"...); sem ele, deduz-se da extensão do nome. */
  rotulo?: string;
  /** Formato antigo (.doc, .xls); sem ele, deduz-se da extensão do nome. */
  legado?: boolean;
  tamanhoEmBytes?: number | undefined;
  /** Documento já enviado: a etiqueta vira um link que baixa o arquivo com o nome original. */
  href?: string;
  /** Documento pendente: mostra o botão de remover. */
  aoRemover?: () => void;
}

/** Etiqueta de um documento anexado (PDF, Word, Excel, texto...): ícone, nome, formato e tamanho. */
export function ChipDeAnexo({ nome, rotulo, legado, tamanhoEmBytes, href, aoRemover }: Props) {
  const formato = formatoDoDocumento(nome);
  const rotuloDoFormato = rotulo ?? formato?.rotulo ?? "Documento";
  const formatoAntigo = legado ?? formato?.legado ?? false;
  const tamanho = tamanhoEmBytes === undefined ? null : tamanhoLegivel(tamanhoEmBytes);
  const descricao = [rotuloDoFormato, tamanho].filter((parte) => parte !== null).join(" · ");
  const titulo = [`${nome} (${descricao})`, formatoAntigo ? AVISO_DO_FORMATO_ANTIGO : null, href !== undefined ? "Clique para baixar." : null]
    .filter((parte) => parte !== null)
    .join(" ");

  const conteudo = (
    <>
      <IconeDocumento tamanho={16} />
      <span className="chip-de-anexo-textos">
        <span className="chip-de-anexo-nome">{nome}</span>
        <span className="chip-de-anexo-detalhe">
          {formatoAntigo ? (
            <span className="chip-de-anexo-selo" title={AVISO_DO_FORMATO_ANTIGO}>
              {rotuloDoFormato}
            </span>
          ) : (
            rotuloDoFormato
          )}
          {tamanho !== null && ` · ${tamanho}`}
        </span>
      </span>
    </>
  );

  if (href !== undefined) {
    return (
      <a className="chip-de-anexo" href={href} download={nome} title={titulo}>
        {conteudo}
      </a>
    );
  }
  return (
    <span className="chip-de-anexo" title={titulo}>
      {conteudo}
      {aoRemover !== undefined && (
        <button type="button" className="chip-de-anexo-remover" aria-label={`Remover ${nome}`} onClick={aoRemover}>
          <IconeFechar tamanho={10} />
        </button>
      )}
    </span>
  );
}

/** "845 KB" abaixo de 1 MB (o `formatarBytes` mostraria "1 MB" ou "0 MB") e, daí em diante, o formato do resto da tela. */
function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 ** 2) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return formatarBytes(bytes);
}
