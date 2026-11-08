import type { ReactNode } from "react";

import type { DadosDoEsforcoHerdado, EsforcoDeRaciocinio, ModeloClaude, NivelDePermissao } from "../../shared/api/tipos";
import { ROTULOS_DOS_ESFORCOS, ROTULOS_DOS_MODELOS } from "../../shared/formatacao";
import { Dica } from "../Dica";

/*
 * Peças das linhas de configuração (rótulo à esquerda, controle à direita),
 * usadas pela criação (NoRascunho) e pela ⚙ do terminal (CamposDaConfiguracao).
 */

const MODELOS: readonly ModeloClaude[] = ["fable", "opus", "sonnet", "haiku"];

interface PropsDoRotulo {
  titulo: string;
  dica: string;
  explicacao: string;
  /** Liga o rótulo a um campo (`<label>`); sem ele, é texto com `id` para `aria-labelledby`. */
  htmlFor?: string;
  id?: string;
  /** Linhas altas (permissão, instruções): o rótulo fica na altura do primeiro controle. */
  alinharAoTopo?: boolean;
  /** A pasta fica acima das linhas, na largura toda: o rótulo dela é mais apagado. */
  discreto?: boolean;
}

/** Nome do campo na coluna da esquerda, com a Dica ao lado. */
export function Rotulo({ titulo, dica, explicacao, htmlFor, id, alinharAoTopo = false, discreto = false }: PropsDoRotulo) {
  const classe = `rotulo-da-criacao ${discreto ? "rotulo-da-criacao-discreto" : ""}`;
  const texto: ReactNode =
    htmlFor === undefined ? (
      <span id={id} className={classe}>
        {titulo}
      </span>
    ) : (
      <label htmlFor={htmlFor} className={classe}>
        {titulo}
      </label>
    );
  return (
    <div className={`flex items-center gap-1.5 ${alinharAoTopo ? "self-start pt-2" : discreto ? "" : "self-center"}`}>
      {texto}
      <Dica sobre={titulo} titulo={dica}>
        {explicacao}
      </Dica>
    </div>
  );
}

export function SeletorDeModelo({
  id,
  valor,
  aoEscolher,
}: {
  id: string;
  valor: ModeloClaude;
  aoEscolher: (modelo: ModeloClaude) => void;
}) {
  return (
    <select
      id={id}
      className="select select-compacto"
      value={valor}
      title={ROTULOS_DOS_MODELOS[valor].descricao}
      onChange={(evento) => {
        const escolhido = MODELOS.find((modelo) => modelo === evento.target.value);
        if (escolhido !== undefined) {
          aoEscolher(escolhido);
        }
      }}
    >
      {MODELOS.map((modelo) => (
        <option key={modelo} value={modelo} title={ROTULOS_DOS_MODELOS[modelo].descricao}>
          {ROTULOS_DOS_MODELOS[modelo].nome}
        </option>
      ))}
    </select>
  );
}

/** No automático o app não força nada: avisa quando o que o Claude Code herda gasta tokens demais. */
export function AvisoDoEsforcoHerdado({
  esforco,
  herdado,
}: {
  esforco: EsforcoDeRaciocinio;
  herdado: DadosDoEsforcoHerdado | null;
}) {
  if (esforco !== "padrao" || herdado === null || !herdado.deveAvisar) {
    return null;
  }
  return (
    <span className="hint-warning">
      No automático, o Claude Code usa <strong>{ROTULOS_DOS_ESFORCOS[herdado.nivel]}</strong> para este modelo
      (definido em <span className="mono">{herdado.origem}</span>). Isso gasta mais tokens; escolha um esforço no chip
      para controlar.
    </span>
  );
}

/** Olho, lápis e terminal: do mais seguro ao que roda comandos. */
export function IconeDaPermissao({ nivel }: { nivel: NivelDePermissao }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {nivel === "leitura" ? (
        <>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : nivel === "edicao" ? (
        <>
          <path d="M4 20h4L19 9l-4-4L4 16z" />
          <path d="m13.5 6.5 4 4" />
        </>
      ) : (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3M13 15h4" />
        </>
      )}
    </svg>
  );
}
