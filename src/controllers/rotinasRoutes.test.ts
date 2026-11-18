import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepositorioDeRotinasEmArquivo } from "../infraestrutura/arquivos/RepositorioDeRotinasEmArquivo";
import { ControleDeExecucoesDeRotinas } from "../rotinas/ControleDeExecucoesDeRotinas";
import { ExecutorFalso, RelogioFalso, inicioDosTestes } from "../rotinas/duplasDeTeste";
import { DadosDaExecucao } from "../rotinas/ExecucaoDaRotina";
import { LIMITE_DE_ROTINAS, ServicoDeRotinas } from "../rotinas/ServicoDeRotinas";
import { CanalDasRotinas, ResumoDaRotina, criarRotinasRoutes } from "./rotinasRoutes";

const PEDIDO = { tipo: "pedido", orquestradorId: "orq-1", texto: "Rode os testes e faça um relatório.", modo: "execucao" } as const;
const PLANEJAMENTO = { ...PEDIDO, texto: "Planeje a migração.", modo: "planejamento" } as const;
const APROVACAO = { tipo: "aprovacao", mensagem: "Confira o relatório." };

function corpoValido(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { nome: "Relatório semanal", gatilho: { tipo: "diario", hora: "09:00" }, etapas: [PEDIDO], ...extras };
}

describe("rotas de rotinas", () => {
  let pasta: string;
  let servidor: Server;
  let base: string;
  let repositorio: RepositorioDeRotinasEmArquivo;
  let relogio: RelogioFalso;
  let executor: ExecutorFalso;
  let controle: ControleDeExecucoesDeRotinas;
  let servico: ServicoDeRotinas;
  let ids: number;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "rotas-rotinas-teste-"));
    repositorio = await RepositorioDeRotinasEmArquivo.abrir(pasta);
    relogio = new RelogioFalso(inicioDosTestes());
    executor = new ExecutorFalso();
    controle = new ControleDeExecucoesDeRotinas();
    ids = 0;
    const canal = new CanalDasRotinas();
    servico = new ServicoDeRotinas({
      repositorioDeRotinas: repositorio,
      repositorioDeExecucoes: repositorio,
      executor,
      publicador: canal,
      controle,
      temporizador: relogio,
      gerarId: () => `id-${++ids}`,
      agora: relogio.agora,
    });

    const aplicacao = express();
    aplicacao.use(express.json());
    aplicacao.use("/api", criarRotinasRoutes({ servico, canal }));
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await servico.interromperEmAndamento();
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
    await repositorio.aguardarGravacoes();
    await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function enviar(metodo: string, caminho: string, corpo?: unknown): Promise<Response> {
    return fetch(`${base}${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  }

  async function criarRotina(corpo: unknown = corpoValido()): Promise<ResumoDaRotina> {
    const resposta = await enviar("POST", "/rotinas", corpo);
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

  describe("rotinas", () => {
    it("GET sem rotinas responde 200 com lista vazia", async () => {
      const resposta = await fetch(`${base}/rotinas`);

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual([]);
    });

    it("POST cria com os padrões e responde 201 com a rotina e a próxima execução", async () => {
      const resposta = await enviar("POST", "/rotinas", corpoValido());

      expect(resposta.status).toBe(201);
      expect(await resposta.json()).toEqual({
        id: "id-1",
        nome: "Relatório semanal",
        ativa: true,
        gatilho: { tipo: "diario", hora: "09:00" },
        etapas: [PEDIDO],
        aoPerder: "pular",
        criadaEm: inicioDosTestes().toISOString(),
        ultimaExecucaoEm: null,
        proximaExecucaoEm: new Date(2026, 10, 17, 9, 0).toISOString(),
        execucaoAtiva: null,
      });
    });

    it("POST aceita aoPerder e ativa; GET lista em ordem de criação e GET por id devolve uma", async () => {
      const primeira = await criarRotina(corpoValido({ nome: "Primeira", aoPerder: "executar_ao_abrir" }));
      relogio.saltar(60_000);
      const segunda = await criarRotina(corpoValido({ nome: "Segunda", ativa: false }));

      const lista = (await (await fetch(`${base}/rotinas`)).json()) as ResumoDaRotina[];
      const detalhe = (await (await fetch(`${base}/rotinas/${segunda.id}`)).json()) as ResumoDaRotina;

      expect(lista.map((rotina) => [rotina.nome, rotina.aoPerder, rotina.ativa])).toEqual([
        ["Primeira", "executar_ao_abrir", true],
        ["Segunda", "pular", false],
      ]);
      expect(primeira.id).not.toBe(segunda.id);
      expect(detalhe).toMatchObject({ nome: "Segunda", ativa: false, proximaExecucaoEm: null });
    });

    it("a rotina criada sobrevive a reabrir o repositório", async () => {
      const rotina = await criarRotina();
      await repositorio.aguardarGravacoes();

      const reaberto = await RepositorioDeRotinasEmArquivo.abrir(pasta);

      expect(reaberto.buscar(rotina.id)?.nome).toBe("Relatório semanal");
    });

    it.each<[string, unknown, string]>([
      ["corpo que não é objeto", ["oi"], "Envie os dados da rotina."],
      ["nome ausente", { gatilho: corpoValido().gatilho, etapas: [PEDIDO] }, "O nome da rotina deve ter entre 1 e 100 caracteres."],
      ["nome vazio", corpoValido({ nome: "   " }), "O nome da rotina deve ter entre 1 e 100 caracteres."],
      ["nome longo", corpoValido({ nome: "x".repeat(101) }), "O nome da rotina deve ter entre 1 e 100 caracteres."],
      ["nome que não é texto", corpoValido({ nome: 42 }), "O nome da rotina deve ter entre 1 e 100 caracteres."],
      ["gatilho ausente", { nome: "x", etapas: [PEDIDO] }, "O gatilho deve ser diário, semanal, intervalo ou uma vez."],
      ["gatilho que não é objeto", corpoValido({ gatilho: "diario" }), "O gatilho deve ser diário, semanal, intervalo ou uma vez."],
      ["gatilho de tipo desconhecido", corpoValido({ gatilho: { tipo: "mensal" } }), "O gatilho deve ser diário, semanal, intervalo ou uma vez."],
      ["hora inválida", corpoValido({ gatilho: { tipo: "diario", hora: "9h" } }), "A hora deve estar no formato HH:MM, de 00:00 a 23:59."],
      [
        "intervalo curto",
        corpoValido({ gatilho: { tipo: "intervalo", minutos: 5 } }),
        "O intervalo deve ser de 15 a 525600 minutos.",
      ],
      [
        "dia da semana inválido",
        corpoValido({ gatilho: { tipo: "semanal", dias: [9], hora: "09:00" } }),
        "Escolha ao menos um dia da semana, de 0 (domingo) a 6 (sábado), sem repetir.",
      ],
      [
        "execução única que já passou",
        corpoValido({ gatilho: { tipo: "uma_vez", em: new Date(2026, 10, 16, 9, 0).toISOString() } }),
        "A data e a hora da execução única já passaram. Escolha um horário futuro.",
      ],
      ["etapas ausentes", { nome: "x", gatilho: corpoValido().gatilho }, "A rotina deve ter de 1 a 10 etapas."],
      ["nenhuma etapa", corpoValido({ etapas: [] }), "A rotina deve ter de 1 a 10 etapas."],
      ["onze etapas", corpoValido({ etapas: Array.from({ length: 11 }, () => PEDIDO) }), "A rotina deve ter de 1 a 10 etapas."],
      ["etapa que não é objeto", corpoValido({ etapas: ["pedido"] }), "Cada etapa deve ser um pedido, uma aprovação ou uma espera."],
      ["pedido sem texto", corpoValido({ etapas: [{ ...PEDIDO, texto: " " }] }), "Escreva o pedido que o orquestrador deve receber."],
      ["pedido longo", corpoValido({ etapas: [{ ...PEDIDO, texto: "x".repeat(20_001) }] }), "O pedido pode ter até 20.000 caracteres."],
      ["espera de 0 minutos", corpoValido({ etapas: [{ tipo: "espera", minutos: 0 }] }), "A espera deve ser de 1 a 1.440 minutos."],
      ["orquestrador que não existe", corpoValido({ etapas: [{ ...PEDIDO, orquestradorId: "orq-9" }] }), "O orquestrador escolhido na etapa 1 não existe."],
      ["aoPerder desconhecido", corpoValido({ aoPerder: "nunca" }), "Escolha o que fazer quando uma execução for perdida: executar ao abrir ou pular."],
      ["ativa que não é booleano", corpoValido({ ativa: "sim" }), "Informe se a rotina está ativa (verdadeiro ou falso)."],
    ])("POST com %s responde 400 e não grava nada", async (_caso, corpo, mensagem) => {
      const resposta = await enviar("POST", "/rotinas", corpo);

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: mensagem });
      expect(repositorio.todas()).toEqual([]);
    });

    it("POST sem corpo responde 400", async () => {
      const resposta = await enviar("POST", "/rotinas");

      expect(resposta.status).toBe(400);
      expect(repositorio.todas()).toEqual([]);
    });

    it(`passou de ${LIMITE_DE_ROTINAS} rotinas, responde 409`, async () => {
      for (let numero = 0; numero < LIMITE_DE_ROTINAS; numero++) {
        await servico.criar({ nome: `Rotina ${numero}`, gatilho: { tipo: "diario", hora: "09:00" }, etapas: [PEDIDO] });
      }

      const resposta = await enviar("POST", "/rotinas", corpoValido());

      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual({ erro: `Você pode ter até ${LIMITE_DE_ROTINAS} rotinas. Remova alguma para criar outra.` });
    });

    it("PATCH parcial altera só o que veio e recalcula a agenda", async () => {
      const rotina = await criarRotina();

      const resposta = await enviar("PATCH", `/rotinas/${rotina.id}`, { nome: "Novo nome", gatilho: { tipo: "diario", hora: "07:30" } });

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({
        ...rotina,
        nome: "Novo nome",
        gatilho: { tipo: "diario", hora: "07:30" },
        proximaExecucaoEm: new Date(2026, 10, 18, 7, 30).toISOString(),
      });
    });

    it("PATCH com ativa desliga e liga a rotina", async () => {
      const rotina = await criarRotina();

      const desligada = (await (await enviar("PATCH", `/rotinas/${rotina.id}`, { ativa: false })).json()) as ResumoDaRotina;
      const ligada = (await (await enviar("PATCH", `/rotinas/${rotina.id}`, { ativa: true })).json()) as ResumoDaRotina;

      expect(desligada).toMatchObject({ ativa: false, proximaExecucaoEm: null });
      expect(ligada).toMatchObject({ ativa: true, proximaExecucaoEm: new Date(2026, 10, 17, 9, 0).toISOString() });
    });

    it("ativar uma execução única que já passou responde 409", async () => {
      const rotina = await criarRotina(corpoValido({ gatilho: { tipo: "uma_vez", em: new Date(2026, 10, 17, 10, 0).toISOString() } }));
      await enviar("PATCH", `/rotinas/${rotina.id}`, { ativa: false });
      relogio.saltar(5 * 60 * 60_000);

      const resposta = await enviar("PATCH", `/rotinas/${rotina.id}`, { ativa: true });

      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual({
        erro: "O horário desta rotina de execução única já passou. Altere o gatilho antes de ativá-la.",
      });
    });

    it("PATCH inválido responde 400 e não grava nada pela metade", async () => {
      const rotina = await criarRotina();

      const resposta = await enviar("PATCH", `/rotinas/${rotina.id}`, { nome: "Novo", etapas: [] });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "A rotina deve ter de 1 a 10 etapas." });
      expect((await (await fetch(`${base}/rotinas/${rotina.id}`)).json()) as ResumoDaRotina).toEqual(rotina);
    });

    it("PATCH com corpo que não é objeto responde 400", async () => {
      const rotina = await criarRotina();

      const resposta = await enviar("PATCH", `/rotinas/${rotina.id}`, ["x"]);

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "Envie os dados da rotina." });
    });

    it("DELETE responde 204 e a rotina some da lista", async () => {
      const rotina = await criarRotina();

      const resposta = await enviar("DELETE", `/rotinas/${rotina.id}`);

      expect(resposta.status).toBe(204);
      expect(await (await fetch(`${base}/rotinas`)).json()).toEqual([]);
    });

    it.each<[string, string, unknown]>([
      ["GET", "/rotinas/nao-existe", undefined],
      ["PATCH", "/rotinas/nao-existe", { nome: "x" }],
      ["DELETE", "/rotinas/nao-existe", undefined],
      ["POST", "/rotinas/nao-existe/executar", undefined],
      ["GET", "/rotinas/nao-existe/execucoes", undefined],
    ])("%s %s de rotina inexistente responde 404", async (metodo, caminho, corpo) => {
      const resposta = await enviar(metodo, caminho, corpo);

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ erro: "Rotina não encontrada." });
    });
  });

  describe("execuções", () => {
    it("executar responde 202 e a execução anda por trás; as execuções listam o resultado", async () => {
      executor.prepararRespostas({ situacao: "concluido", resposta: "Relatório pronto." });
      const rotina = await criarRotina();

      const resposta = await enviar("POST", `/rotinas/${rotina.id}/executar`);
      const iniciada = (await resposta.json()) as DadosDaExecucao;
      const final = await esperarSituacao(rotina.id, "concluida");

      expect(resposta.status).toBe(202);
      expect(iniciada).toMatchObject({ rotinaId: rotina.id, rotinaNome: "Relatório semanal", origem: "manual", situacao: "em_andamento" });
      expect(final).toMatchObject({ id: iniciada.id, etapaAtual: null, motivo: null, pendencia: null });
      expect(final.resultados[0]).toMatchObject({ tipo: "pedido", situacao: "concluida", resposta: "Relatório pronto." });
      expect(executor.pedidos).toEqual([{ orquestradorId: "orq-1", texto: PEDIDO.texto, modo: "execucao" }]);
      const atualizada = (await (await fetch(`${base}/rotinas/${rotina.id}`)).json()) as ResumoDaRotina;
      expect(atualizada).toMatchObject({ ultimaExecucaoEm: relogio.agora().toISOString(), execucaoAtiva: null });
    });

    it("executar enquanto a execução anterior roda responde 409; a lista mostra a execução ativa", async () => {
      const rotina = await criarRotina();
      await enviar("POST", `/rotinas/${rotina.id}/executar`);
      await vi.waitFor(() => expect(executor.quantosPendentes).toBe(1));

      const resposta = await enviar("POST", `/rotinas/${rotina.id}/executar`);
      const detalhe = (await (await fetch(`${base}/rotinas/${rotina.id}`)).json()) as ResumoDaRotina;

      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual({ erro: "Esta rotina já está em execução." });
      expect(detalhe.execucaoAtiva).toMatchObject({ situacao: "em_andamento" });
    });

    it("a etapa de aprovação espera; aprovar segue e conclui", async () => {
      executor.prepararRespostas({ situacao: "concluido", resposta: "Relatório." }, { situacao: "concluido", resposta: "Y feito." });
      const rotina = await criarRotina(corpoValido({ etapas: [PEDIDO, APROVACAO, { ...PEDIDO, texto: "Agora faça Y." }] }));
      await enviar("POST", `/rotinas/${rotina.id}/executar`);
      const aguardando = await esperarSituacao(rotina.id, "aguardando_aprovacao");
      const detalhe = (await (await fetch(`${base}/rotinas/${rotina.id}`)).json()) as ResumoDaRotina;

      const resposta = await enviar("POST", `/rotinas/execucoes/${aguardando.id}/aprovar`);

      expect(aguardando.pendencia).toEqual({ tipo: "aprovacao", mensagem: "Confira o relatório." });
      expect(detalhe.execucaoAtiva?.id).toBe(aguardando.id);
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({ id: aguardando.id, situacao: "em_andamento", pendencia: null });
      const final = await esperarSituacao(rotina.id, "concluida");
      expect(final.resultados.map((resultado) => resultado.tipo)).toEqual(["pedido", "aprovacao", "pedido"]);
    });

    it("o pedido que termina em plano espera; aprovar manda o orquestrador executar o plano", async () => {
      executor.prepararRespostas(
        { situacao: "plano_para_aprovacao", plano: "1. Migrar\n2. Testar" },
        { situacao: "concluido", resposta: "Plano executado." },
      );
      const rotina = await criarRotina(corpoValido({ etapas: [PLANEJAMENTO] }));
      await enviar("POST", `/rotinas/${rotina.id}/executar`);
      const aguardando = await esperarSituacao(rotina.id, "aguardando_aprovacao");

      const resposta = await enviar("POST", `/rotinas/execucoes/${aguardando.id}/aprovar`);

      expect(aguardando.pendencia).toEqual({ tipo: "plano", plano: "1. Migrar\n2. Testar" });
      expect(resposta.status).toBe(200);
      await esperarSituacao(rotina.id, "concluida");
      expect(executor.aprovacoesDePlano).toEqual(["orq-1"]);
    });

    it("recusar responde 200, encerra como recusada com o motivo e descarta o plano", async () => {
      executor.prepararRespostas({ situacao: "plano_para_aprovacao", plano: "Plano" });
      const rotina = await criarRotina(corpoValido({ etapas: [PLANEJAMENTO] }));
      await enviar("POST", `/rotinas/${rotina.id}/executar`);
      const aguardando = await esperarSituacao(rotina.id, "aguardando_aprovacao");

      const resposta = await enviar("POST", `/rotinas/execucoes/${aguardando.id}/recusar`, { motivo: "Não é isso." });

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({ situacao: "recusada", motivo: "Não é isso.", pendencia: null });
      expect(executor.planosDescartados).toEqual(["orq-1"]);
      expect((await execucoesDe(rotina.id))[0]?.situacao).toBe("recusada");
    });

    it("recusar sem corpo usa o motivo padrão", async () => {
      const rotina = await criarRotina(corpoValido({ etapas: [APROVACAO] }));
      await enviar("POST", `/rotinas/${rotina.id}/executar`);
      const aguardando = await esperarSituacao(rotina.id, "aguardando_aprovacao");

      const resposta = await enviar("POST", `/rotinas/execucoes/${aguardando.id}/recusar`);

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({ situacao: "recusada", motivo: "Recusada pelo usuário." });
    });

    it.each<[string, unknown, string]>([
      ["motivo que não é texto", { motivo: 42 }, "O motivo da recusa deve ser um texto."],
      ["motivo longo", { motivo: "x".repeat(2_001) }, "O motivo da recusa pode ter até 2000 caracteres."],
      ["corpo que não é objeto", ["x"], "Envie os dados da recusa."],
    ])("recusar com %s responde 400", async (_caso, corpo, mensagem) => {
      const resposta = await enviar("POST", "/rotinas/execucoes/qualquer/recusar", corpo);

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: mensagem });
    });

    it("cancelar a execução que roda responde 200 e aborta o pedido em curso", async () => {
      const rotina = await criarRotina();
      const iniciada = (await (await enviar("POST", `/rotinas/${rotina.id}/executar`)).json()) as DadosDaExecucao;
      await vi.waitFor(() => expect(executor.quantosPendentes).toBe(1));

      const resposta = await enviar("POST", `/rotinas/execucoes/${iniciada.id}/cancelar`);

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({ situacao: "cancelada", motivo: "Cancelada pelo usuário." });
      expect(executor.sinais[0]?.aborted).toBe(true);
      expect((await execucoesDe(rotina.id))[0]?.situacao).toBe("cancelada");
    });

    it.each(["aprovar", "recusar", "cancelar"])("%s uma execução que não existe responde 404", async (acao) => {
      const resposta = await enviar("POST", `/rotinas/execucoes/nao-existe/${acao}`);

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ erro: "Execução não encontrada." });
    });

    it("aprovar ou recusar o que não espera aprovação, e cancelar o que já terminou, respondem 409", async () => {
      executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
      const rotina = await criarRotina();
      await enviar("POST", `/rotinas/${rotina.id}/executar`);
      const concluida = await esperarSituacao(rotina.id, "concluida");

      const aprovar = await enviar("POST", `/rotinas/execucoes/${concluida.id}/aprovar`);
      const recusar = await enviar("POST", `/rotinas/execucoes/${concluida.id}/recusar`);
      const cancelar = await enviar("POST", `/rotinas/execucoes/${concluida.id}/cancelar`);

      expect([aprovar.status, recusar.status, cancelar.status]).toEqual([409, 409, 409]);
      expect(await aprovar.json()).toEqual({ erro: "Esta execução não está aguardando aprovação." });
      expect(await cancelar.json()).toEqual({ erro: "Esta execução já terminou." });
    });

    it("GET /rotinas/:id/execucoes lista da mais recente para a mais antiga", async () => {
      executor.prepararRespostas({ situacao: "concluido", resposta: "um" }, { situacao: "falhou", motivo: "dois" });
      const rotina = await criarRotina();
      await enviar("POST", `/rotinas/${rotina.id}/executar`);
      await esperarSituacao(rotina.id, "concluida");
      relogio.saltar(60_000);
      await enviar("POST", `/rotinas/${rotina.id}/executar`);
      await esperarSituacao(rotina.id, "falhou");

      const lista = await execucoesDe(rotina.id);

      expect(lista.map((execucao) => execucao.situacao)).toEqual(["falhou", "concluida"]);
    });
  });

  describe("eventos ao vivo", () => {
    it("SSE /rotinas/eventos entrega os eventos nomeados, sem histórico e sem id", async () => {
      const controleDaConexao = new AbortController();
      const resposta = await fetch(`${base}/rotinas/eventos`, { signal: controleDaConexao.signal });
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("content-type")).toMatch(/^text\/event-stream/);
      const leitor = resposta.body!.getReader();
      const decodificador = new TextDecoder();
      let texto = "";
      const lerAte = async (trecho: string): Promise<void> => {
        while (!texto.includes(trecho)) {
          const { value, done } = await leitor.read();
          if (done) {
            throw new Error(`SSE terminou antes de "${trecho}". Recebido: ${texto}`);
          }
          texto += decodificador.decode(value, { stream: true });
        }
      };
      executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });

      await lerAte("retry: 3000");
      const rotina = await criarRotina();
      await enviar("POST", `/rotinas/${rotina.id}/executar`);
      await lerAte("event: execucao_encerrada");
      await enviar("DELETE", `/rotinas/${rotina.id}`);
      await lerAte("event: rotina_removida");
      controleDaConexao.abort();

      const eventos = texto
        .split("\n\n")
        .filter((bloco) => bloco.startsWith("event: "))
        .map((bloco) => {
          const [linhaDoEvento, linhaDosDados] = bloco.split("\n");
          return {
            evento: linhaDoEvento?.slice("event: ".length),
            dados: JSON.parse(linhaDosDados?.slice("data: ".length) ?? "null") as Record<string, unknown>,
          };
        });
      expect(eventos.map((evento) => evento.evento)).toEqual([
        "rotina_criada",
        "rotina_alterada",
        "execucao_iniciada",
        "etapa_iniciada",
        "etapa_concluida",
        "execucao_encerrada",
        "rotina_removida",
      ]);
      expect(eventos[0]?.dados).toMatchObject({ rotina: { id: rotina.id, nome: "Relatório semanal", ativa: true } });
      expect(eventos[2]?.dados).toMatchObject({ execucao: { rotinaId: rotina.id, situacao: "em_andamento" } });
      expect(eventos[4]?.dados).toMatchObject({ indice: 0, execucao: { situacao: "concluida" } });
      expect(eventos[5]?.dados).toMatchObject({ situacao: "concluida", execucao: { situacao: "concluida" } });
      expect(eventos[6]?.dados).toEqual({ id: rotina.id });
      expect(Object.keys(eventos[0]?.dados ?? {})).toEqual(["rotina"]);
      expect(texto).not.toMatch(/^id: /m);
    });
  });
});
