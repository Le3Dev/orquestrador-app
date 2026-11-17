import { describe, expect, it, vi } from "vitest";

import { ComandoDoNavegador } from "./ComandoDoNavegador";
import { ControleDoNavegador } from "./ControleDoNavegador";
import { ErroDoNavegador } from "./ErroDoNavegador";
import { ResultadoDoComando } from "./ResultadoDoComando";
import { ServicoDoNavegador } from "./ServicoDoNavegador";

function montar() {
  const resultado: ResultadoDoComando = { url: "https://exemplo.com/", titulo: "Exemplo", mensagem: "Página aberta." };
  const executar = vi.fn(
    async (_id: string, _comando: ComandoDoNavegador, _sinal: AbortSignal): Promise<ResultadoDoComando> => resultado,
  );
  const controle: ControleDoNavegador = { executar };
  return { servico: new ServicoDoNavegador(controle), executar, resultado };
}

describe("ServicoDoNavegador", () => {
  it("valida o comando e o repassa ao controle com o orquestrador e o sinal", async () => {
    const { servico, executar, resultado } = montar();
    const sinal = new AbortController().signal;

    await expect(servico.executar("orq-1", { tipo: "abrir", url: "exemplo.com" }, sinal)).resolves.toBe(resultado);

    expect(executar).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledWith("orq-1", { tipo: "abrir", url: "https://exemplo.com/" }, sinal);
  });

  it("não chama o controle com comando inválido ou recusado", async () => {
    const { servico, executar } = montar();
    const sinal = new AbortController().signal;

    await expect(servico.executar("orq-1", { tipo: "abrir", url: "javascript:alert(1)" }, sinal)).rejects.toMatchObject({
      motivo: "recusado",
    });
    await expect(servico.executar("orq-1", { tipo: "clicar" }, sinal)).rejects.toMatchObject({ motivo: "comando_invalido" });
    expect(executar).not.toHaveBeenCalled();
  });

  it("recusa um orquestrador com identificador inválido", async () => {
    const { servico, executar } = montar();
    for (const id of ["", "com espaço", "../outro", "a".repeat(65)]) {
      await expect(servico.executar(id, { tipo: "voltar" }, new AbortController().signal)).rejects.toBeInstanceOf(ErroDoNavegador);
    }
    expect(executar).not.toHaveBeenCalled();
  });

  it("deixa passar o erro do controle", async () => {
    const { servico, executar } = montar();
    executar.mockRejectedValueOnce(new ErroDoNavegador("pausado", "O usuário assumiu o navegador; tente depois."));

    await expect(servico.executar("orq-1", { tipo: "ler_pagina" }, new AbortController().signal)).rejects.toMatchObject({
      motivo: "pausado",
      message: "O usuário assumiu o navegador; tente depois.",
    });
  });
});
