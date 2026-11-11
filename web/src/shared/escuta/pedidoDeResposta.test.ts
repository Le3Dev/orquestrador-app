import { describe, expect, it } from "vitest";

import { horaComSegundos, JANELA_DO_PEDIDO_MS, MAXIMO_DE_ENUNCIADOS_NO_PEDIDO, montarPedidoDeResposta } from "./pedidoDeResposta";
import type { EstadoDaEscuta } from "./sessaoDaEscuta";

type Frase = EstadoDaEscuta["legenda"]["frases"][number];

const AGORA = new Date(2026, 10, 11, 14, 2, 30).getTime();
const s = (segundos: number): number => AGORA - segundos * 1000;

const frase = (n: number, texto: string, inicioMs: number, fimMs = inicioMs + 2_000, pergunta = false): Frase => ({
  id: `enunciado-${n}`,
  texto,
  inicioMs,
  fimMs,
  pergunta,
});

describe("montarPedidoDeResposta", () => {
  it("sem texto nenhum devolve null", () => {
    expect(montarPedidoDeResposta([], null, AGORA)).toBeNull();
    expect(montarPedidoDeResposta([frase(1, "   ", s(10))], { id: "enunciado-2", confirmado: "", parcial: " ", inicioMs: s(2) }, AGORA)).toBeNull();
  });

  it("junta as falas com a hora e o enunciado em andamento no fim", () => {
    const pedido = montarPedidoDeResposta(
      [frase(1, "Fale sobre você.", s(20)), frase(2, "Qual a complexidade do quicksort?", s(10))],
      { id: "enunciado-3", confirmado: "E no pior", parcial: "caso?", inicioMs: s(3) },
      AGORA,
    );
    expect(pedido).toBe(
      [
        "O que eu devo responder agora? Use a transcrição recente da conversa abaixo (áudio do computador) e, se houver, a imagem da tela.",
        "",
        "Transcrição recente:",
        "[14:02:10] Fale sobre você.",
        "[14:02:20] Qual a complexidade do quicksort?",
        "[14:02:27] E no pior caso?",
      ].join("\n"),
    );
  });

  it("só o que está em andamento também serve", () => {
    const pedido = montarPedidoDeResposta([], { id: "enunciado-1", confirmado: "", parcial: "oi tudo bem", inicioMs: s(1) }, AGORA);
    expect(pedido).toContain("[14:02:29] oi tudo bem");
  });

  it("descarta as falas de mais de 2 min", () => {
    const pedido = montarPedidoDeResposta(
      [frase(1, "antiga", s(300)), frase(2, "no limite", s(JANELA_DO_PEDIDO_MS / 1000 + 2), s(JANELA_DO_PEDIDO_MS / 1000)), frase(3, "recente", s(5))],
      null,
      AGORA,
    );
    expect(pedido).not.toContain("antiga");
    expect(pedido).toContain("no limite");
    expect(pedido).toContain("recente");
    expect(montarPedidoDeResposta([frase(1, "antiga", s(300))], null, AGORA)).toBeNull();
  });

  it("limita aos enunciados mais recentes", () => {
    const frases = Array.from({ length: 20 }, (_, i) => frase(i, `fala ${i}`, s(100 - i * 4)));
    const pedido = montarPedidoDeResposta(frases, { id: "enunciado-20", confirmado: "fala 20", parcial: "", inicioMs: s(1) }, AGORA) ?? "";
    const linhas = pedido.split("\n").filter((linha) => linha.startsWith("["));
    expect(linhas).toHaveLength(MAXIMO_DE_ENUNCIADOS_NO_PEDIDO);
    expect(linhas.at(-1)).toContain("fala 20");
    expect(pedido).not.toContain("fala 0\n");
    expect(pedido).toContain("fala 9");
  });

  it("horaComSegundos usa dois dígitos", () => {
    expect(horaComSegundos(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe("03:04:05");
  });
});
