import { tamanhoLegivel } from "../shared/imagens";
import { IconeDocumento, IconeFechar } from "./Icones";

interface Props {
  nome: string;
  tamanhoEmBytes?: number;
  /** Documento já enviado: o chip vira um link de download. */
  href?: string;
  /** Documento pendente: mostra o botão de remover. */
  aoRemover?: () => void;
}

/** Documento anexado (PDF, Word, Excel, CSV, TXT, MD): ícone, nome e tamanho. */
export function ChipDeDocumento({ nome, tamanhoEmBytes, href, aoRemover }: Props) {
  const conteudo = (
    <>
      <IconeDocumento tamanho={14} />
      <span className="chip-nome">{nome}</span>
      {tamanhoEmBytes !== undefined && <span className="chip-tamanho">{tamanhoLegivel(tamanhoEmBytes)}</span>}
    </>
  );
  const titulo = tamanhoEmBytes === undefined ? nome : `${nome} · ${tamanhoLegivel(tamanhoEmBytes)}`;
  if (href !== undefined) {
    return (
      <a className="chip-de-documento" href={href} download={nome} title={`${titulo} — baixar`}>
        {conteudo}
      </a>
    );
  }
  return (
    <span className="chip-de-documento" title={titulo}>
      {conteudo}
      {aoRemover !== undefined && (
        <button type="button" className="chip-remover" aria-label={`Remover ${nome}`} onClick={aoRemover}>
          <IconeFechar tamanho={10} />
        </button>
      )}
    </span>
  );
}
