import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

import type { MensagemDoShell } from "../api/tipos";

/**
 * O bloco "Terminal" do canvas: um shell de verdade, vivo no servidor. No
 * código ele se chama "shell", para não confundir com o terminal de um
 * Orquestrador.
 */

/** De onde o shell abre: uma pasta escolhida, ou a pasta (ou worktree) de um Orquestrador. */
export type OrigemDoShell = { pasta: string } | { orquestradorId: string };

/**
 * O que o bloco (e o cartão do Orquestrador) pede ao canvas: só o canvas mexe
 * nos nós, e uma recusa do servidor (ex.: 409, o limite de terminais) aparece
 * abaixo da barra do canvas. Funções estáveis.
 */
export interface AcoesDosShells {
  /** Cria o shell no servidor e abre o bloco: no centro da tela ou, saindo de um Orquestrador, ao lado dele. */
  abrirShell: (origem: OrigemDoShell) => void;
  /** Encerra o shell no servidor e tira o bloco do canvas (e do layout). */
  fecharShell: (shellId: string) => void;
  /** O shell encerrou: abre outro na mesma pasta, no mesmo bloco. */
  reabrirShell: (shellId: string) => void;
}

const ContextoDosShells = createContext<AcoesDosShells | null>(null);

export function ProvedorDosShells({ valor, children }: { valor: AcoesDosShells; children?: ReactNode }): ReactElement {
  return createElement(ContextoDosShells.Provider, { value: valor }, children);
}

/** As ações dos shells; o bloco só existe dentro do canvas, que as fornece. */
export function useAcoesDosShells(): AcoesDosShells {
  const valor = useContext(ContextoDosShells);
  if (valor === null) {
    throw new Error("Os shells devem ser usados dentro do ProvedorDosShells.");
  }
  return valor;
}

/** As ações dos shells, se houver quem as forneça (o cartão do Orquestrador também aparece fora do canvas, nos testes). */
export function useAcoesDosShellsSeHouver(): AcoesDosShells | null {
  return useContext(ContextoDosShells);
}

/** O tamanho, em caracteres, pedido na criação; o bloco manda o real assim que se ajusta. */
export const TAMANHO_INICIAL_DO_SHELL = { colunas: 80, linhas: 24 } as const;

/** Quantas linhas do fim vão ao Orquestrador quando nada está selecionado. */
export const LINHAS_PARA_O_ORQUESTRADOR = 40;

/** O endereço `ws://` (ou `wss://`, numa página https) de um caminho da mesma origem. */
export function enderecoDoWebSocket(caminho: string, local: Pick<Location, "protocol" | "host">): string {
  return `${local.protocol === "https:" ? "wss:" : "ws:"}//${local.host}${caminho}`;
}

/** Uma mensagem do servidor pelo WebSocket; nula se não for uma das conhecidas. */
export function lerMensagemDoShell(texto: unknown): MensagemDoShell | null {
  if (typeof texto !== "string") {
    return null;
  }
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof valor !== "object" || valor === null || !("tipo" in valor)) {
    return null;
  }
  if (valor.tipo === "saida" && "dados" in valor && typeof valor.dados === "string") {
    return { tipo: "saida", dados: valor.dados };
  }
  if (valor.tipo === "fim") {
    const codigo = "codigo" in valor && typeof valor.codigo === "number" ? valor.codigo : null;
    return { tipo: "fim", codigo };
  }
  return null;
}

/** O nome curto de uma pasta, para a barra do bloco: a última parte do caminho. */
export function nomeCurtoDaPasta(caminho: string): string {
  const partes = caminho.split(/[\\/]/).filter((parte) => parte !== "");
  return partes[partes.length - 1] ?? caminho;
}

/** As últimas `quantidade` linhas, sem as linhas em branco do fim (a tela abaixo do prompt). */
export function ultimasLinhas(linhas: readonly string[], quantidade: number): string[] {
  let fim = linhas.length;
  while (fim > 0 && (linhas[fim - 1] ?? "").trim() === "") {
    fim--;
  }
  return linhas.slice(Math.max(0, fim - quantidade), fim);
}

/**
 * O trecho do terminal como vai ao prompt do Orquestrador: num bloco de
 * código. A cerca tem mais crases que qualquer sequência do próprio texto,
 * para um ``` da saída não fechar o bloco antes da hora.
 */
export function blocoParaOOrquestrador(texto: string): string {
  const maiorSequencia = Math.max(0, ...(texto.match(/`+/g) ?? []).map((crases) => crases.length));
  const cerca = "`".repeat(Math.max(3, maiorSequencia + 1));
  const corpo = texto.replace(/\s+$/, "");
  return `${cerca}\n${corpo}\n${cerca}`;
}

/**
 * O que mandar ao Orquestrador: a seleção do terminal ou, sem ela, as últimas
 * linhas do buffer. Nulo quando não há nada além de espaços.
 */
export function textoParaOOrquestrador(selecao: string, linhasDoBuffer: readonly string[]): string | null {
  const texto = selecao.trim() !== "" ? selecao : ultimasLinhas(linhasDoBuffer, LINHAS_PARA_O_ORQUESTRADOR).join("\n");
  return texto.trim() === "" ? null : blocoParaOOrquestrador(texto);
}
