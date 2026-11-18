import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

import type { VinculoDto } from "../api/tipos";
import { TAMANHO_DO_TERMINAL } from "./layout";
import type { ArestaDoVinculo, NoDoCanvas, NoTerminal } from "./nos";

/**
 * Vínculos entre orquestradores: o usuário liga dois (de quaisquer projetos)
 * pelo botão da barra do terminal; cada vínculo vira uma linha entre os dois
 * terminais, e clicar nela abre o painel do vínculo (notas, mensagem, desfazer).
 */

/** O que o botão "Vincular a…" e a linha pedem ao canvas. Funções estáveis. */
export interface AcoesDosVinculos {
  vinculos: readonly VinculoDto[];
  /** Cria o vínculo no servidor; lança o erro dele (400, 404, 409) para o botão mostrar. */
  criar: (orquestradorAId: string, orquestradorBId: string) => Promise<void>;
}

const ContextoDosVinculos = createContext<AcoesDosVinculos | null>(null);

export function ProvedorDosVinculos({ valor, children }: { valor: AcoesDosVinculos; children?: ReactNode }): ReactElement {
  return createElement(ContextoDosVinculos.Provider, { value: valor }, children);
}

/** Os vínculos do canvas, se houver quem os forneça (o terminal também aparece fora do canvas, nos testes). */
export function useVinculosSeHouver(): AcoesDosVinculos | null {
  return useContext(ContextoDosVinculos);
}

/** Os vínculos em que o orquestrador é um dos lados. */
export function vinculosDoOrquestrador(vinculos: readonly VinculoDto[], orquestradorId: string): VinculoDto[] {
  return vinculos.filter((vinculo) => vinculo.orquestradorAId === orquestradorId || vinculo.orquestradorBId === orquestradorId);
}

/** Os orquestradores que ainda podem ser vinculados a este: todos, menos ele e os que já têm vínculo com ele. */
export function candidatosAoVinculo<T extends { id: string }>(
  orquestradores: readonly T[],
  vinculos: readonly VinculoDto[],
  orquestradorId: string,
): T[] {
  const jaLigados = new Set(
    vinculosDoOrquestrador(vinculos, orquestradorId).map((vinculo) =>
      vinculo.orquestradorAId === orquestradorId ? vinculo.orquestradorBId : vinculo.orquestradorAId,
    ),
  );
  return orquestradores.filter((orquestrador) => orquestrador.id !== orquestradorId && !jaLigados.has(orquestrador.id));
}

/** O `id` da linha de um vínculo no canvas. */
export function idDaArestaDoVinculo(vinculoId: string): string {
  return `vinculo:${vinculoId}`;
}

/** O id do vínculo de uma linha; nulo para as outras linhas. */
export function lerIdDaArestaDoVinculo(arestaId: string): string | null {
  return arestaId.startsWith("vinculo:") ? arestaId.slice("vinculo:".length) : null;
}

type Lado = "cima" | "baixo" | "esquerda" | "direita";

const OPOSTO: Readonly<Record<Lado, Lado>> = { cima: "baixo", baixo: "cima", esquerda: "direita", direita: "esquerda" };

function centroDoTerminal(no: NoTerminal): { x: number; y: number } {
  const largura = no.measured?.width ?? no.width ?? TAMANHO_DO_TERMINAL.largura;
  const altura = no.measured?.height ?? no.height ?? TAMANHO_DO_TERMINAL.altura;
  return { x: no.position.x + largura / 2, y: no.position.y + altura / 2 };
}

/** De que lado de `origem` está `destino`: o eixo em que os centros mais se afastam. */
export function ladoDoVinculo(origem: NoTerminal, destino: NoTerminal): Lado {
  const de = centroDoTerminal(origem);
  const para = centroDoTerminal(destino);
  const dx = para.x - de.x;
  const dy = para.y - de.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? "direita" : "esquerda";
  }
  return dy >= 0 ? "baixo" : "cima";
}

/** O `id` da âncora de chegada de um vínculo em cada lado do terminal. */
export function ancoraDeChegadaDoVinculo(lado: Lado): string {
  return `vinculo-${lado}`;
}

/**
 * Uma linha entre os terminais de cada vínculo cujos dois orquestradores estão
 * abertos no canvas (o id do terminal é o do orquestrador). Vínculo com um
 * lado ausente, ou de orquestrador removido, não desenha nada. A linha sai do
 * lado de A voltado para B e chega no lado de B voltado para A. `selecionado`
 * (o vínculo com o painel aberto) vem com `selected`.
 */
export function arestasDosVinculos(
  nos: readonly NoDoCanvas[],
  vinculos: readonly VinculoDto[],
  selecionado: string | null = null,
): ArestaDoVinculo[] {
  const terminais = new Map(nos.flatMap((no) => (no.type === "terminal" ? [[no.id, no] as const] : [])));
  return vinculos.flatMap((vinculo): ArestaDoVinculo[] => {
    const a = terminais.get(vinculo.orquestradorAId);
    const b = terminais.get(vinculo.orquestradorBId);
    if (a === undefined || b === undefined || a === b) {
      return [];
    }
    const lado = ladoDoVinculo(a, b);
    const id = idDaArestaDoVinculo(vinculo.id);
    return [
      {
        id,
        type: "vinculo",
        source: a.id,
        sourceHandle: lado,
        target: b.id,
        targetHandle: ancoraDeChegadaDoVinculo(OPOSTO[lado]),
        className: "aresta-vinculo",
        selected: vinculo.id === selecionado,
        selectable: false,
        focusable: false,
        deletable: false,
      },
    ];
  });
}
