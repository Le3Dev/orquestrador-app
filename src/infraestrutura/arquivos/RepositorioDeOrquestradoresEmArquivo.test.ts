import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { Orquestrador } from "../../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import { RepositorioDeOrquestradoresEmArquivo } from "./RepositorioDeOrquestradoresEmArquivo";

const agora = new Date("2026-10-28T12:00:00Z");

function novoOrquestrador(id: string): Orquestrador {
  return Orquestrador.criar({
    id,
    nome: `Orquestrador ${id}`,
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), id),
    sessaoId: `sessao-${id}`,
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "sonnet",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
      nivelDePermissao: "edicao",
    }),
    agora,
  });
}

describe("RepositorioDeOrquestradoresEmArquivo", () => {
  let pasta: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "repositorio-teste-"));
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it("reabre os orquestradores e os eventos exatamente como ficaram", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    const orquestrador = novoOrquestrador("a");
    await repositorio.salvar(orquestrador);
    repositorio.anexarEvento("a", orquestrador.iniciarTurno("t1", "analise", agora));
    repositorio.anexarEvento("a", orquestrador.registrarDoMotor("t1", { tipo: "texto_do_orquestrador", texto: "ok" }));
    await repositorio.salvar(orquestrador);
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

    expect(reaberto.buscarPorId("a")?.paraDados()).toEqual(orquestrador.paraDados());
    expect(reaberto.lerEventos("a", 0).map((evento) => [evento.sequencia, evento.tipo])).toEqual([
      [1, "turno_iniciado"],
      [2, "texto_do_orquestrador"],
    ]);
    expect(reaberto.lerEventos("a", 1)).toHaveLength(1);
  });

  it("numera os eventos por orquestrador, de forma independente", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    await repositorio.salvar(novoOrquestrador("a"));
    await repositorio.salvar(novoOrquestrador("b"));

    const doA = repositorio.anexarEvento("a", { tipo: "turno_cancelado", turnoId: "x" });
    const doB = repositorio.anexarEvento("b", { tipo: "turno_cancelado", turnoId: "y" });
    const outroDoA = repositorio.anexarEvento("a", { tipo: "turno_cancelado", turnoId: "z" });
    await repositorio.aguardarGravacoes();

    expect([doA.sequencia, doB.sequencia, outroDoA.sequencia]).toEqual([1, 1, 2]);
  });

  it("remove o orquestrador e o histórico do disco", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    await repositorio.salvar(novoOrquestrador("a"));
    await repositorio.remover("a");

    const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

    expect(reaberto.listar()).toEqual([]);
  });
});
