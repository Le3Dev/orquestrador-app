import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResumoDaRotina } from "../controllers/rotinasRoutes";
import { ExecutorFalso, RelogioFalso, inicioDosTestes } from "../rotinas/duplasDeTeste";
import { DadosDaExecucao } from "../rotinas/ExecucaoDaRotina";
import { MontagemDasRotinas, montarRotinas } from "./montarRotinas";

const HORA = 60 * 60_000;
const PEDIDO = { tipo: "pedido", orquestradorId: "orq-1", texto: "Rode os testes e faça um relatório.", modo: "execucao" };
const APROVACAO = { tipo: "aprovacao", mensagem: "Confira o relatório." };

describe("montarRotinas", () => {
  let pasta: string;
  let relogio: RelogioFalso;
  let executor: ExecutorFalso;
  let servidor: Server | null;
  let montagem: MontagemDasRotinas | null;
  let base: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "montar-rotinas-teste-"));
    relogio = new RelogioFalso(inicioDosTestes());
    executor = new ExecutorFalso();
    servidor = null;
    montagem = null;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await descer();
    await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  /** O app abre: monta, liga as rotas em /api e inicia o agendador. */
  async function subir(): Promise<void> {
    montagem = await montarRotinas({
      pastaDeDados: pasta,
      executorDePedidos: executor,
      agora: relogio.agora,
      temporizador: relogio,
    });
    const aplicacao = express();
    aplicacao.use(express.json());
    aplicacao.use("/api", montagem.rotas);
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
    await montagem.iniciar();
  }

  /** O app fecha: o agendador encerra (e aborta o que roda) e o servidor cai. */
  async function descer(): Promise<void> {
    await montagem?.encerrar();
    montagem = null;
    if (servidor !== null) {
      servidor.closeAllConnections();
      servidor.close();
      await once(servidor, "close");
      servidor = null;
    }
  }

  async function enviar(metodo: string, caminho: string, corpo?: unknown): Promise<Response> {
    return fetch(`${base}${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  }

  async function criarRotina(corpo: Record<string, unknown>): Promise<ResumoDaRotina> {
    const resposta = await enviar("POST", "/rotinas", {
      nome: "Relatório semanal",
      gatilho: { tipo: "diario", hora: "09:00" },
      etapas: [PEDIDO],
      ...corpo,
    });
    expect(resposta.status).toBe(201);
    return (await resposta.json()) as ResumoDaRotina;
  }

  async function execucoesDe(rotinaId: string): Promise<DadosDaExecucao[]> {
    return (await (await fetch(`${base}/rotinas/${rotinaId}/execucoes`)).json()) as DadosDaExecucao[];
  }

  async function esperarSituacao(rotinaId: string, situacao: string): Promise<DadosDaExecucao> {
    let encontrada: DadosDaExecucao | undefined;
    await vi.waitFor(async () => {
      encontrada = (await execucoesDe(rotinaId))[0];
      expect(encontrada?.situacao).toBe(situacao);
    });
    return encontrada as DadosDaExecucao;
  }

  it("serve as rotas em /api, grava em <pasta de dados>/rotinas e guarda o que foi criado", async () => {
    await subir();

    const criada = await criarRotina({});
    await descer();
    await subir();

    await expect(access(path.join(pasta, "rotinas", `${criada.id}.json`))).resolves.toBeUndefined();
    const lista = (await (await fetch(`${base}/rotinas`)).json()) as ResumoDaRotina[];
    expect(lista.map((rotina) => rotina.id)).toEqual([criada.id]);
  });

  it("o agendador dispara a rotina na hora marcada, com o relógio e o temporizador injetados", async () => {
    executor.prepararRespostas({ situacao: "concluido", resposta: "Relatório pronto." });
    await subir();
    const rotina = await criarRotina({});

    await relogio.avancar(30 * 60_000);
    expect(executor.pedidos).toEqual([]);
    await relogio.avancar(31 * 60_000);

    const execucao = await esperarSituacao(rotina.id, "concluida");
    expect(execucao.origem).toBe("agendada");
    expect(executor.pedidos).toEqual([{ orquestradorId: "orq-1", texto: PEDIDO.texto, modo: "execucao" }]);
  });

  it("ao fechar, o que rodava fica interrompida; ao reabrir, o que esperava aprovação continua aprovável", async () => {
    await subir();
    const rodando = await criarRotina({ nome: "Roda" });
    const esperando = await criarRotina({ nome: "Espera", etapas: [APROVACAO] });
    await enviar("POST", `/rotinas/${rodando.id}/executar`);
    await vi.waitFor(() => expect(executor.quantosPendentes).toBe(1));
    await enviar("POST", `/rotinas/${esperando.id}/executar`);
    await esperarSituacao(esperando.id, "aguardando_aprovacao");

    await descer();
    await subir();

    expect((await execucoesDe(rodando.id))[0]).toMatchObject({ situacao: "interrompida" });
    const aguardando = await esperarSituacao(esperando.id, "aguardando_aprovacao");
    const aprovada = await enviar("POST", `/rotinas/execucoes/${aguardando.id}/aprovar`);
    expect(aprovada.status).toBe(200);
    await esperarSituacao(esperando.id, "concluida");
  });

  it("a hora que passou com o app fechado segue o aoPerder da rotina", async () => {
    executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    await subir();
    const quePula = await criarRotina({ nome: "Pula", aoPerder: "pular" });
    const queExecuta = await criarRotina({ nome: "Executa", aoPerder: "executar_ao_abrir" });
    await descer();

    relogio.saltar(2 * 24 * HORA);
    await subir();

    expect((await execucoesDe(quePula.id))[0]).toMatchObject({ situacao: "pulada", origem: "perdida" });
    expect((await esperarSituacao(queExecuta.id, "concluida")).origem).toBe("perdida");
    expect(await execucoesDe(quePula.id)).toHaveLength(1);
    expect(await execucoesDe(queExecuta.id)).toHaveLength(1);
  });
});
