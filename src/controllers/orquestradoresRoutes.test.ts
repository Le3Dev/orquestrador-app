import { once } from "node:events";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ArmazemDeAnexosEmArquivo } from "../infraestrutura/arquivos/ArmazemDeAnexosEmArquivo";
import { ExploradorDePastas } from "../infraestrutura/arquivos/ExploradorDePastas";
import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { CanalDeEventos } from "../infraestrutura/sse/CanalDeEventos";
import { ConsumoDoTurno } from "../orquestracao/ConsumoDoTurno";
import { ConsultaDeEsforcoHerdado } from "../orquestracao/EsforcoDaMaquina";
import { EsforcoHerdado } from "../orquestracao/EsforcoHerdado";
import { EventoDeOrquestracao, EventoDoMotor, EventoRegistrado } from "../orquestracao/EventoDeOrquestracao";
import { UsoDeTokens } from "../orquestracao/UsoDeTokens";
import { MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../orquestracao/MotorDeAgentes";
import { Orquestrador } from "../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../orquestracao/PastaDeTrabalho";
import { PreferenciasGlobais } from "../orquestracao/PreferenciasGlobais";
import { ConversaArquivada, RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { RepositorioDePreferencias } from "../orquestracao/RepositorioDePreferencias";
import { ServicoDeOrquestracao } from "../orquestracao/ServicoDeOrquestracao";
import { criarOrquestradoresRoutes, MAXIMO_DE_ORQUESTRADORES_POR_CONEXAO } from "./orquestradoresRoutes";

/** Preferências globais em memória: `atuais` devolve o que o teste definiu. */
class PreferenciasEmMemoria implements RepositorioDePreferencias {
  preferencias = PreferenciasGlobais.vazias();
  atuais(): PreferenciasGlobais {
    return this.preferencias;
  }
  async salvar(preferencias: PreferenciasGlobais): Promise<void> {
    this.preferencias = preferencias;
  }
}

class RepositorioEmMemoria implements RepositorioDeOrquestradores {
  readonly orquestradores = new Map<string, Orquestrador>();
  readonly eventos: EventoRegistrado[] = [];

  listar(): readonly Orquestrador[] {
    return [...this.orquestradores.values()];
  }
  buscarPorId(id: string): Orquestrador | null {
    return this.orquestradores.get(id) ?? null;
  }
  async salvar(orquestrador: Orquestrador): Promise<void> {
    this.orquestradores.set(orquestrador.id, orquestrador);
  }
  async remover(id: string): Promise<void> {
    this.orquestradores.delete(id);
  }
  anexarEvento(_orquestradorId: string, evento: EventoDeOrquestracao): EventoRegistrado {
    const registrado = { ...evento, sequencia: this.eventos.length + 1, em: "agora" };
    this.eventos.push(registrado);
    return registrado;
  }
  arquivarConversa(orquestrador: Orquestrador, evento: EventoDeOrquestracao): ConversaArquivada {
    this.orquestradores.set(orquestrador.id, orquestrador);
    return { registrado: this.anexarEvento(orquestrador.id, evento), gravacao: Promise.resolve() };
  }
  lerEventos(): readonly EventoRegistrado[] {
    return this.eventos;
  }
}

/** Motor que conclui cada turno na hora, já com a sessão iniciada. */
class MotorImediato implements MotorDeAgentes {
  readonly pedidos: PedidoDeTurno[] = [];

  async executarTurno(pedido: PedidoDeTurno, aoObservar: (evento: EventoDoMotor) => void): Promise<ResultadoDoTurno> {
    this.pedidos.push(pedido);
    aoObservar({ tipo: "sessao_iniciada" });
    return {
      sucesso: true,
      resposta: pedido.modo === "planejamento" ? "o plano" : "feito",
      uso: { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 },
    };
  }
}

describe("rotas de orquestradores — modo de planejamento", () => {
  const raiz = path.resolve("/projetos");
  let servidor: Server;
  let base: string;
  let repositorio: RepositorioEmMemoria;
  let motor: MotorImediato;
  let servico: ServicoDeOrquestracao;
  let preferencias: PreferenciasEmMemoria;
  let explorador: ExploradorDePastas;
  let ids = 0;

  beforeAll(async () => {
    repositorio = new RepositorioEmMemoria();
    motor = new MotorImediato();
    explorador = new ExploradorDePastas(raiz);
    const anexos = new ArmazemDeAnexosEmArquivo(path.join(tmpdir(), "orquestrador-rotas-teste"));
    preferencias = new PreferenciasEmMemoria();
    servico = new ServicoDeOrquestracao({
      repositorio,
      motor,
      execucoes: new ControleDeExecucoesEmMemoria(),
      publicador: { publicar: () => undefined, sinalizar: () => undefined },
      anexos,
      worktrees: {
        preparar: async (_id, pastaDeTrabalho) => ({ cwd: pastaDeTrabalho, worktree: null }),
        concluir: async () => false,
      },
      pastaDeArtefatos: (orquestradorId) => path.join(tmpdir(), "orquestrador-rotas-teste-artefatos", orquestradorId),
      preferencias,
      gerarId: () => `id${++ids}`,
      agora: () => new Date("2026-10-28T12:00:00Z"),
    });

    const aplicacao = express();
    aplicacao.use(express.json());
    aplicacao.use(
      "/api",
      criarOrquestradoresRoutes({
        servico,
        repositorio,
        canal: new CanalDeEventos(),
        explorador,
        anexos,
        preferencias,
        pastaRaiz: raiz,
      }),
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    servidor.close();
    await once(servidor, "close");
  });

  let orquestrador: Orquestrador;

  beforeEach(async () => {
    orquestrador = await servico.criarOrquestrador({
      nome: "Painel",
      pastaDeTrabalho: PastaDeTrabalho.dentroDe(raiz, "painel"),
      configuracao: {
        modeloDoOrquestrador: "opus",
        modeloDosSubagentes: "sonnet",
        quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
        nivelDePermissao: "edicao_e_comandos",
      },
    });
  });

  async function postar(caminho: string, corpo?: unknown): Promise<Response> {
    return fetch(`${base}${caminho}`, {
      method: "POST",
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  }

  async function aguardarOcioso(): Promise<void> {
    await vi.waitFor(() => expect(orquestrador.situacao).toBe("ocioso"));
  }

  async function planejar(): Promise<void> {
    const resposta = await postar(`/orquestradores/${orquestrador.id}/mensagens`, {
      texto: "planeje",
      modo: "planejamento",
    });
    expect(resposta.status).toBe(202);
    await aguardarOcioso();
  }

  it("recusa um modo de pedido inválido com 400", async () => {
    const resposta = await postar(`/orquestradores/${orquestrador.id}/mensagens`, { texto: "oi", modo: "turbo" });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: "Modo do pedido inválido." });
    expect(orquestrador.totalDeTurnos).toBe(0);
  });

  it("sem modo, a mensagem vira um pedido de execução", async () => {
    const resposta = await postar(`/orquestradores/${orquestrador.id}/mensagens`, { texto: "analise" });

    expect(resposta.status).toBe(202);
    await aguardarOcioso();
    expect(orquestrador.ultimoTurno?.modo).toBe("execucao");
  });

  it("aprovar ou descartar sem plano pendente responde 409", async () => {
    const aprovar = await postar(`/orquestradores/${orquestrador.id}/plano/aprovar`);
    const descartar = await postar(`/orquestradores/${orquestrador.id}/plano/descartar`);

    expect(aprovar.status).toBe(409);
    expect(await aprovar.json()).toEqual({ erro: '"Painel" não tem plano aguardando aprovação.' });
    expect(descartar.status).toBe(409);
  });

  it("aprovar um plano pendente responde 202 com o turno de execução", async () => {
    await planejar();

    const resposta = await postar(`/orquestradores/${orquestrador.id}/plano/aprovar`, { observacoes: "  com calma  " });

    expect(resposta.status).toBe(202);
    const { turnoId } = (await resposta.json()) as { turnoId: string };
    await aguardarOcioso();
    expect(orquestrador.ultimoTurno?.id).toBe(turnoId);
    expect(motor.pedidos.at(-1)).toMatchObject({ modo: "execucao", sessaoIniciada: true });
    expect(motor.pedidos.at(-1)?.texto).toMatch(/Observações do usuário: com calma$/);
  });

  it("recusa observações que não são texto com 400", async () => {
    await planejar();

    const resposta = await postar(`/orquestradores/${orquestrador.id}/plano/aprovar`, { observacoes: 42 });

    expect(resposta.status).toBe(400);
    expect(orquestrador.turnoComPlanoPendente).not.toBeNull();
  });

  it("o resumo diz se há plano pendente", async () => {
    const resumo = async () =>
      ((await (await fetch(`${base}/orquestradores/${orquestrador.id}`)).json()) as { planoPendente: boolean }).planoPendente;
    expect(await resumo()).toBe(false);

    await planejar();

    expect(await resumo()).toBe(true);
  });

  it("descartar um plano pendente responde 204", async () => {
    await planejar();

    const resposta = await postar(`/orquestradores/${orquestrador.id}/plano/descartar`);

    expect(resposta.status).toBe(204);
    expect(orquestrador.paraDados().turnos.at(-1)?.decisaoDoPlano).toBe("descartado");
  });

  it("responde 404 para orquestrador inexistente", async () => {
    expect((await postar("/orquestradores/nao-existe/plano/aprovar")).status).toBe(404);
  });

  describe("opção \"Permitir commit e push\"", () => {
    async function alterarConfiguracao(corpo: unknown): Promise<Response> {
      return fetch(`${base}/orquestradores/${orquestrador.id}/configuracao`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
    }

    it("nasce desligada e aparece nos dados do orquestrador", async () => {
      const resposta = await fetch(`${base}/orquestradores/${orquestrador.id}`);

      expect(((await resposta.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        permitirCommitEPush: false,
      });
    });

    it("o PATCH liga a opção e um PATCH sem ela a mantém", async () => {
      const ligar = await alterarConfiguracao({ permitirCommitEPush: true });
      const outroCampo = await alterarConfiguracao({ nivelDePermissao: "edicao" });

      expect(ligar.status).toBe(200);
      expect(((await ligar.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        permitirCommitEPush: true,
      });
      expect(((await outroCampo.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        nivelDePermissao: "edicao",
        permitirCommitEPush: true,
      });
    });

    it.each([["sim"], [1], [null]])("recusa %j com 400 e mensagem clara", async (valor) => {
      const resposta = await alterarConfiguracao({ permitirCommitEPush: valor });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({
        erro: 'A opção "Permitir commit e push" deve ser verdadeira ou falsa.',
      });
      expect(orquestrador.configuracao.permitirCommitEPush).toBe(false);
    });
  });

  describe("esforço de raciocínio", () => {
    async function alterarConfiguracao(corpo: unknown): Promise<Response> {
      return fetch(`${base}/orquestradores/${orquestrador.id}/configuracao`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
    }

    // A pasta de trabalho do POST não existe no disco de quem roda os testes.
    beforeEach(() => {
      vi.spyOn(explorador, "existe").mockResolvedValue(true);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const criacao = {
      nome: "Novo",
      pastaDeTrabalho: raiz,
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
      nivelDePermissao: "leitura",
    };

    it("o POST sem os campos cria com o esforço padrão nos dois papéis", async () => {
      const resposta = await postar("/orquestradores", criacao);

      expect(resposta.status).toBe(201);
      expect(((await resposta.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        esforcoDoOrquestrador: "padrao",
        esforcoDosSubagentes: "padrao",
      });
    });

    it("o POST aceita os esforços escolhidos", async () => {
      const resposta = await postar("/orquestradores", {
        ...criacao,
        esforcoDoOrquestrador: "maximo",
        esforcoDosSubagentes: "baixo",
      });

      expect(resposta.status).toBe(201);
      expect(((await resposta.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        esforcoDoOrquestrador: "maximo",
        esforcoDosSubagentes: "baixo",
      });
    });

    it("o POST recusa esforço inválido com 400", async () => {
      const resposta = await postar("/orquestradores", { ...criacao, esforcoDosSubagentes: "max" });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "Esforço dos subagentes inválido." });
    });

    it("aparece no GET e o PATCH altera só o esforço informado", async () => {
      const detalhe = await fetch(`${base}/orquestradores/${orquestrador.id}`);
      const alterar = await alterarConfiguracao({ esforcoDosSubagentes: "medio" });
      const outroCampo = await alterarConfiguracao({ nivelDePermissao: "edicao" });

      expect(((await detalhe.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        esforcoDoOrquestrador: "padrao",
        esforcoDosSubagentes: "padrao",
      });
      expect(alterar.status).toBe(200);
      expect(((await alterar.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        esforcoDoOrquestrador: "padrao",
        esforcoDosSubagentes: "medio",
      });
      expect(((await outroCampo.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        nivelDePermissao: "edicao",
        esforcoDosSubagentes: "medio",
      });
    });

    it("o POST aceita ultracode no orquestrador e recusa nos subagentes", async () => {
      const aceito = await postar("/orquestradores", { ...criacao, esforcoDoOrquestrador: "ultracode" });
      const recusado = await postar("/orquestradores", { ...criacao, esforcoDosSubagentes: "ultracode" });

      expect(aceito.status).toBe(201);
      expect(((await aceito.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        esforcoDoOrquestrador: "ultracode",
        esforcoDosSubagentes: "padrao",
      });
      expect(recusado.status).toBe(400);
      expect(await recusado.json()).toEqual({
        erro: 'O esforço "ultracode" vale só para o orquestrador e o chat. Escolha outro esforço para os subagentes.',
      });
    });

    it.each<[string, unknown, string]>([
      [
        "esforcoDosSubagentes",
        "ultracode",
        'O esforço "ultracode" vale só para o orquestrador e o chat. Escolha outro esforço para os subagentes.',
      ],
      ["esforcoDoOrquestrador", "turbo", "Esforço do orquestrador inválido."],
      ["esforcoDoOrquestrador", null, "Esforço do orquestrador inválido."],
      ["esforcoDosSubagentes", "xhigh", "Esforço dos subagentes inválido."],
      ["esforcoDosSubagentes", 5, "Esforço dos subagentes inválido."],
    ])("o PATCH recusa %s = %j com 400 e mensagem clara", async (campo, valor, mensagem) => {
      const resposta = await alterarConfiguracao({ [campo]: valor });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: mensagem });
      expect(orquestrador.configuracao.esforcoDoOrquestrador).toBe("padrao");
      expect(orquestrador.configuracao.esforcoDosSubagentes).toBe("padrao");
    });
  });

  describe("limpar a conversa", () => {
    it("responde 200 com o resumo da conversa nova, sem turnos", async () => {
      const mensagem = await postar(`/orquestradores/${orquestrador.id}/mensagens`, { texto: "analise" });
      expect(mensagem.status).toBe(202);
      await aguardarOcioso();
      const sessaoAnterior = orquestrador.sessaoId;

      const resposta = await postar(`/orquestradores/${orquestrador.id}/conversa/limpar`);

      expect(resposta.status).toBe(200);
      const corpo = (await resposta.json()) as Record<string, unknown>;
      expect(corpo).toMatchObject({ id: orquestrador.id, situacao: "ocioso", totalDeTurnos: 0, ultimoTurno: null });
      expect(corpo).not.toHaveProperty("sessaoId");
      expect(orquestrador.sessaoId).not.toBe(sessaoAnterior);
      expect(orquestrador.sessaoIniciada).toBe(false);
      expect(repositorio.eventos.at(-1)).toMatchObject({ tipo: "conversa_limpa", turnosAnteriores: 1 });
    });

    it("responde 409 com um pedido em andamento", async () => {
      orquestrador.iniciarTurno("em-andamento", "analise", new Date("2026-10-28T12:00:00Z"));

      const resposta = await postar(`/orquestradores/${orquestrador.id}/conversa/limpar`);

      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual({
        erro: 'Cancele o pedido em andamento de "Painel" antes de limpar a conversa.',
      });
      expect(orquestrador.totalDeTurnos).toBe(1);
      orquestrador.cancelarTurno("em-andamento", new Date("2026-10-28T12:00:00Z"));
    });

    it("responde 404 para orquestrador inexistente", async () => {
      const resposta = await postar("/orquestradores/nao-existe/conversa/limpar");

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ erro: "Orquestrador não encontrado." });
    });
  });

  describe("fila de pedidos", () => {
    const agora = new Date("2026-10-28T12:00:00Z");

    async function enfileirar(corpo: unknown, id = orquestrador.id): Promise<Response> {
      return postar(`/orquestradores/${id}/fila`, corpo);
    }

    async function excluir(caminho: string): Promise<Response> {
      return fetch(`${base}${caminho}`, { method: "DELETE" });
    }

    it("POST /fila responde 201 com o pedidoId e o pedido fica parado, sem turno", async () => {
      const pedidosAntes = motor.pedidos.length;

      const resposta = await enfileirar({ texto: "  rode os testes  ", modo: "planejamento" });

      expect(resposta.status).toBe(201);
      const { pedidoId } = (await resposta.json()) as { pedidoId: string };
      expect(orquestrador.fila.map((pedido) => pedido.paraDados())).toEqual([
        { id: pedidoId, texto: "rode os testes", modo: "planejamento", enfileiradoEm: agora.toISOString() },
      ]);
      expect(repositorio.eventos.at(-1)).toMatchObject({ tipo: "pedido_enfileirado", pedido: { id: pedidoId } });
      expect(orquestrador.totalDeTurnos).toBe(0);
      expect(motor.pedidos).toHaveLength(pedidosAntes);
    });

    it("POST /fila sem modo enfileira um pedido de execução", async () => {
      const resposta = await enfileirar({ texto: "analise" });

      expect(resposta.status).toBe(201);
      expect(orquestrador.fila[0]?.modo).toBe("execucao");
    });

    it.each<[string, unknown, string]>([
      ["sem texto", {}, "Escreva o pedido."],
      ["com texto em branco", { texto: "   " }, "Escreva o pedido."],
      ["com texto que não é texto", { texto: 42 }, "Escreva o pedido."],
      ["com modo inválido", { texto: "oi", modo: "turbo" }, "Modo do pedido inválido."],
      ["com texto longo demais", { texto: "a".repeat(50_001) }, "O pedido deve ter até 50000 caracteres."],
      [
        "com imagens",
        { texto: "oi", imagens: [{ nome: "a.png" }] },
        "A fila aceita só texto: envie as imagens quando o orquestrador estiver livre.",
      ],
    ])("POST /fila %s responde 400", async (_caso, corpo, mensagem) => {
      const resposta = await enfileirar(corpo);

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: mensagem });
      expect(orquestrador.fila).toHaveLength(0);
    });

    it("POST /fila com a fila cheia responde 409", async () => {
      for (let numero = 1; numero <= 10; numero += 1) {
        await servico.enfileirarPedido(orquestrador.id, `pedido ${numero}`);
      }

      const resposta = await enfileirar({ texto: "o décimo primeiro" });

      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual({ erro: 'A fila de "Painel" está cheia (máximo 10 pedidos).' });
      expect(orquestrador.fila).toHaveLength(10);
    });

    it("POST /fila em orquestrador inexistente responde 404", async () => {
      const resposta = await enfileirar({ texto: "oi" }, "nao-existe");

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ erro: "Orquestrador não encontrado." });
    });

    it("DELETE /fila/:pedidoId responde 204 e tira o pedido da fila", async () => {
      const { pedidoId } = await servico.enfileirarPedido(orquestrador.id, "um");
      const outro = await servico.enfileirarPedido(orquestrador.id, "dois");

      const resposta = await excluir(`/orquestradores/${orquestrador.id}/fila/${pedidoId}`);

      expect(resposta.status).toBe(204);
      expect(orquestrador.fila.map((pedido) => pedido.id)).toEqual([outro.pedidoId]);
      expect(repositorio.eventos.at(-1)).toMatchObject({ tipo: "pedido_retirado_da_fila", pedidoId, motivo: "removido" });
    });

    it("DELETE /fila/:pedidoId responde 404 para pedido ou orquestrador inexistente", async () => {
      const semPedido = await excluir(`/orquestradores/${orquestrador.id}/fila/nao-existe`);
      const semOrquestrador = await excluir("/orquestradores/nao-existe/fila/p1");

      expect(semPedido.status).toBe(404);
      expect(await semPedido.json()).toEqual({ erro: "Pedido não encontrado na fila." });
      expect(semOrquestrador.status).toBe(404);
      expect(await semOrquestrador.json()).toEqual({ erro: "Orquestrador não encontrado." });
    });

    it("POST /fila/:pedidoId/enviar responde 202 com o turno, que usa o texto e o modo do pedido", async () => {
      const { pedidoId } = await servico.enfileirarPedido(orquestrador.id, "planeje a migração", "planejamento");
      const inicio = repositorio.eventos.length;

      const resposta = await postar(`/orquestradores/${orquestrador.id}/fila/${pedidoId}/enviar`);

      expect(resposta.status).toBe(202);
      const { turnoId } = (await resposta.json()) as { turnoId: string };
      await aguardarOcioso();
      expect(orquestrador.ultimoTurno?.id).toBe(turnoId);
      expect(orquestrador.ultimoTurno?.texto).toBe("planeje a migração");
      expect(orquestrador.ultimoTurno?.modo).toBe("planejamento");
      expect(orquestrador.fila).toEqual([]);
      expect(repositorio.eventos.slice(inicio, inicio + 2)).toMatchObject([
        { tipo: "pedido_retirado_da_fila", pedidoId, motivo: "enviado" },
        { tipo: "turno_iniciado", turnoId },
      ]);
    });

    it("POST /fila/:pedidoId/enviar com turno em andamento responde 409 e o pedido continua na fila", async () => {
      const { pedidoId } = await servico.enfileirarPedido(orquestrador.id, "depois");
      orquestrador.iniciarTurno("em-andamento", "analise", agora);

      const resposta = await postar(`/orquestradores/${orquestrador.id}/fila/${pedidoId}/enviar`);

      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual({
        erro: '"Painel" ainda está trabalhando no pedido anterior. Aguarde terminar ou cancele.',
      });
      expect(orquestrador.fila.map((pedido) => pedido.id)).toEqual([pedidoId]);
      orquestrador.cancelarTurno("em-andamento", agora);
    });

    it("POST /fila/:pedidoId/enviar responde 404 para pedido ou orquestrador inexistente", async () => {
      const semPedido = await postar(`/orquestradores/${orquestrador.id}/fila/nao-existe/enviar`);
      const semOrquestrador = await postar("/orquestradores/nao-existe/fila/p1/enviar");

      expect(semPedido.status).toBe(404);
      expect(await semPedido.json()).toEqual({ erro: "Pedido não encontrado na fila." });
      expect(semOrquestrador.status).toBe(404);
      expect(await semOrquestrador.json()).toEqual({ erro: "Orquestrador não encontrado." });
    });

    it("o resumo da lista e o detalhe trazem a fila", async () => {
      const { pedidoId } = await servico.enfileirarPedido(orquestrador.id, "rode os testes");
      const esperada = [{ id: pedidoId, texto: "rode os testes", modo: "execucao", enfileiradoEm: agora.toISOString() }];

      const detalhe = (await (await fetch(`${base}/orquestradores/${orquestrador.id}`)).json()) as Record<string, unknown>;
      const lista = (await (await fetch(`${base}/orquestradores`)).json()) as Array<Record<string, unknown>>;

      expect(detalhe.fila).toEqual(esperada);
      expect(lista.find((item) => item.id === orquestrador.id)?.fila).toEqual(esperada);
    });

    it("um orquestrador sem pedidos traz a fila vazia no resumo", async () => {
      const detalhe = (await (await fetch(`${base}/orquestradores/${orquestrador.id}`)).json()) as Record<string, unknown>;

      expect(detalhe.fila).toEqual([]);
    });
  });

  describe("trivial e plano sempre ligados: as opções antigas são ignoradas (ADR-28)", () => {
    async function alterarConfiguracao(corpo: unknown): Promise<Response> {
      return fetch(`${base}/orquestradores/${orquestrador.id}/configuracao`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
    }

    beforeEach(() => {
      vi.spyOn(explorador, "existe").mockResolvedValue(true);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const CAMPOS_ANTIGOS = ["permitirTrabalhoDireto", "proporPlanoEmPedidosGrandes"];

    function semCamposAntigos(configuracao: unknown): void {
      for (const campo of CAMPOS_ANTIGOS) {
        expect(configuracao).not.toHaveProperty(campo);
      }
    }

    it("o GET não traz mais as opções", async () => {
      const detalhe = (await (await fetch(`${base}/orquestradores/${orquestrador.id}`)).json()) as {
        configuracao: unknown;
      };
      const lista = (await (await fetch(`${base}/orquestradores`)).json()) as Array<{ id: string; configuracao: unknown }>;

      semCamposAntigos(detalhe.configuracao);
      semCamposAntigos(lista.find((item) => item.id === orquestrador.id)?.configuracao);
    });

    it.each<[unknown, unknown]>([
      [false, false],
      [true, true],
      ["sim", null],
    ])("o PATCH com trivial=%j e plano=%j responde 200 e ignora os dois", async (trivial, plano) => {
      const resposta = await alterarConfiguracao({
        permitirTrabalhoDireto: trivial,
        proporPlanoEmPedidosGrandes: plano,
      });

      expect(resposta.status).toBe(200);
      semCamposAntigos(((await resposta.json()) as { configuracao: unknown }).configuracao);
      semCamposAntigos(orquestrador.configuracao.paraDados());
      expect(orquestrador.configuracao.propoePlanoEmPedidosGrandes("execucao")).toBe(true);
    });

    it("o PATCH que manda as opções junto de outro campo aplica só o outro campo", async () => {
      const resposta = await alterarConfiguracao({ nivelDePermissao: "edicao", permitirTrabalhoDireto: false });

      expect(resposta.status).toBe(200);
      const configuracao = ((await resposta.json()) as { configuracao: unknown }).configuracao;
      expect(configuracao).toMatchObject({ nivelDePermissao: "edicao" });
      semCamposAntigos(configuracao);
    });

    it("o POST com as opções (mesmo com valores inválidos) cria o orquestrador e as ignora", async () => {
      const resposta = await postar("/orquestradores", {
        nome: "Novo",
        pastaDeTrabalho: raiz,
        modeloDoOrquestrador: "opus",
        modeloDosSubagentes: "haiku",
        quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
        nivelDePermissao: "leitura",
        permitirTrabalhoDireto: false,
        proporPlanoEmPedidosGrandes: "sim",
      });

      expect(resposta.status).toBe(201);
      const criado = (await resposta.json()) as { id: string; configuracao: unknown };
      semCamposAntigos(criado.configuracao);
      semCamposAntigos(repositorio.buscarPorId(criado.id)?.configuracao.paraDados());
    });
  });

  describe("instruções personalizadas e preferências globais", () => {
    async function requisitar(metodo: string, caminho: string, corpo?: unknown): Promise<Response> {
      return fetch(`${base}${caminho}`, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      });
    }
    const configuracaoBasica = {
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
      nivelDePermissao: "leitura",
    } as const;

    beforeEach(() => {
      vi.spyOn(explorador, "existe").mockResolvedValue(true);
      preferencias.preferencias = PreferenciasGlobais.vazias();
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("o POST aceita as instruções como campo opcional e o resumo indica que estão ativas", async () => {
      const resposta = await postar("/orquestradores", {
        nome: "Novo",
        pastaDeTrabalho: raiz,
        ...configuracaoBasica,
        instrucoesPersonalizadas: "  Comece com PIRULITO.  \n",
      });

      expect(resposta.status).toBe(201);
      const corpo = (await resposta.json()) as { configuracao: { instrucoesPersonalizadas: string }; instrucoesAtivas: string };
      expect(corpo.configuracao.instrucoesPersonalizadas).toBe("Comece com PIRULITO.");
      expect(corpo.instrucoesAtivas).toBe("orquestrador");
    });

    it("sem o campo, cria sem instruções e o resumo diz que não há nenhuma ativa", async () => {
      const resposta = await postar("/orquestradores", { nome: "Novo", pastaDeTrabalho: raiz, ...configuracaoBasica });

      const corpo = (await resposta.json()) as { configuracao: { instrucoesPersonalizadas: string }; instrucoesAtivas: unknown };
      expect(corpo.configuracao.instrucoesPersonalizadas).toBe("");
      expect(corpo.instrucoesAtivas).toBeNull();
    });

    it("o PATCH edita e limpa as instruções; o pedido seguinte já as recebe", async () => {
      const editada = await requisitar("PATCH", `/orquestradores/${orquestrador.id}/configuracao`, {
        instrucoesPersonalizadas: "Use tabelas.",
      });
      expect(editada.status).toBe(200);
      expect(await postar(`/orquestradores/${orquestrador.id}/mensagens`, { texto: "oi" })).toHaveProperty("status", 202);
      await aguardarOcioso();
      expect(motor.pedidos.at(-1)?.instrucoes).toEqual({ texto: "Use tabelas.", origem: "orquestrador" });

      const limpa = await requisitar("PATCH", `/orquestradores/${orquestrador.id}/configuracao`, {
        instrucoesPersonalizadas: "",
      });
      expect(((await limpa.json()) as { instrucoesAtivas: unknown }).instrucoesAtivas).toBeNull();
    });

    it.each<[unknown, string]>([
      [42, "As instruções personalizadas devem ser um texto."],
      ["x".repeat(8_001), "As instruções personalizadas devem ter até 4000 caracteres."],
      ["x".repeat(4_001), "As instruções personalizadas devem ter até 4000 caracteres (hoje têm 4001)."],
    ])("o PATCH recusa instruções inválidas com 400 (%#)", async (valor, mensagem) => {
      const resposta = await requisitar("PATCH", `/orquestradores/${orquestrador.id}/configuracao`, {
        instrucoesPersonalizadas: valor,
      });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: mensagem });
    });

    it("GET e PATCH /preferencias leem e gravam as instruções padrão", async () => {
      expect(await (await requisitar("GET", "/preferencias")).json()).toEqual({
        instrucoesPadrao: "",
        subagentesProntos: [],
        autorrecuperacao: true,
      });

      const resposta = await requisitar("PATCH", "/preferencias", { instrucoesPadrao: " Responda curto. " });
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({
        instrucoesPadrao: "Responda curto.",
        subagentesProntos: [],
        autorrecuperacao: true,
      });
      expect(preferencias.atuais().instrucoesPadrao).toBe("Responda curto.");

      const resumo = (await (await requisitar("GET", `/orquestradores/${orquestrador.id}`)).json()) as {
        instrucoesAtivas: string;
      };
      expect(resumo.instrucoesAtivas).toBe("padrao");
    });

    it("PATCH /preferencias grava subagentes prontos, que aparecem na prévia", async () => {
      const revisor = { nome: "revisor", descricao: "Revisa código.", prompt: "Aponte bugs." };
      const resposta = await requisitar("PATCH", "/preferencias", { subagentesProntos: [revisor] });
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({
        instrucoesPadrao: "",
        subagentesProntos: [{ ...revisor, modelo: "herdar" }],
        autorrecuperacao: true,
      });

      const previa = (await (
        await requisitar("POST", "/previa-do-prompt", { configuracao: orquestrador.configuracao.paraDados() })
      ).json()) as { mensagem: string };
      expect(previa.mensagem).toContain('  - "revisor": Revisa código.');
    });

    it.each([
      [[{ nome: "executor", descricao: "a", prompt: "b" }], 'O nome "executor" é reservado; escolha outro.'],
      [[{ nome: "a-b", descricao: "a" }], "O prompt do subagente pronto deve ser um texto."],
      ["revisor", "Os subagentes prontos devem ser uma lista."],
    ])("PATCH /preferencias recusa subagentes prontos inválidos (%j) com 400", async (subagentesProntos, mensagem) => {
      const resposta = await requisitar("PATCH", "/preferencias", { subagentesProntos });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: mensagem });
      expect(preferencias.atuais().subagentesProntos).toEqual([]);
    });

    it("GET e PATCH /preferencias leem e gravam a autorrecuperação, ligada por padrão", async () => {
      expect(await (await requisitar("GET", "/preferencias")).json()).toMatchObject({ autorrecuperacao: true });

      const desligada = await requisitar("PATCH", "/preferencias", { autorrecuperacao: false });
      expect(desligada.status).toBe(200);
      expect(await desligada.json()).toMatchObject({ autorrecuperacao: false });
      expect(preferencias.atuais().autorrecuperacao).toBe(false);

      // Mudar outro campo não religa.
      await requisitar("PATCH", "/preferencias", { instrucoesPadrao: "Curto." });
      expect(await (await requisitar("GET", "/preferencias")).json()).toMatchObject({
        instrucoesPadrao: "Curto.",
        autorrecuperacao: false,
      });

      const invalida = await requisitar("PATCH", "/preferencias", { autorrecuperacao: "sim" });
      expect(invalida.status).toBe(400);
      expect(await invalida.json()).toEqual({ erro: 'A opção "Autorrecuperação" deve ser verdadeira ou falsa.' });
      expect(preferencias.atuais().autorrecuperacao).toBe(false);
    });

    it("POST /cancelar sem pedido em andamento nem retomada agendada continua 409", async () => {
      const resposta = await postar(`/orquestradores/${orquestrador.id}/cancelar`, {});
      expect(resposta.status).toBe(409);
    });

    it("PATCH /preferencias recusa valor inválido com 400", async () => {
      const resposta = await requisitar("PATCH", "/preferencias", { instrucoesPadrao: ["a"] });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "As instruções gerais devem ser um texto." });
    });

    it("a prévia mostra o system prompt e a mensagem com as instruções que valeriam, sem salvar nada", async () => {
      preferencias.preferencias = PreferenciasGlobais.de({ instrucoesPadrao: "Global." });
      const resposta = await postar("/previa-do-prompt", {
        configuracao: { ...configuracaoBasica, instrucoesPersonalizadas: "Comece com PIRULITO." },
        pastaDeTrabalho: "painel",
      });

      expect(resposta.status).toBe(200);
      const previa = (await resposta.json()) as { instrucoesIniciais: string; mensagem: string; origemDasInstrucoes: string };
      expect(previa.origemDasInstrucoes).toBe("orquestrador");
      expect(previa.instrucoesIniciais).toContain(`Pasta de trabalho: ${path.join(raiz, "painel")}`);
      expect(previa.instrucoesIniciais).not.toContain("PIRULITO");
      expect(previa.mensagem).toContain("<instrucoes-do-usuario>\nComece com PIRULITO.\n</instrucoes-do-usuario>\n</configuracao-do-pedido>");
      expect(previa.mensagem).not.toContain("Global.");
      expect(previa.mensagem.endsWith("(aqui entra a sua mensagem)")).toBe(true);
      expect(orquestrador.configuracao.instrucoesPersonalizadas).toBe("");
    });

    it("a prévia sem instruções nem padrão não tem o bloco, e sem pasta usa um marcador", async () => {
      const resposta = await postar("/previa-do-prompt", { configuracao: configuracaoBasica });

      const previa = (await resposta.json()) as { instrucoesIniciais: string; mensagem: string; origemDasInstrucoes: unknown };
      expect(previa.origemDasInstrucoes).toBeNull();
      expect(previa.mensagem).not.toContain("instrucoes-do-usuario");
      expect(previa.instrucoesIniciais).toContain("Pasta de trabalho: <pasta de trabalho>");
    });

    it("a prévia aceita pasta fora da pasta dos projetos", async () => {
      const fora = path.resolve("/outro/lugar");
      const resposta = await postar("/previa-do-prompt", { configuracao: configuracaoBasica, pastaDeTrabalho: fora });

      expect(resposta.status).toBe(200);
      const previa = (await resposta.json()) as { instrucoesIniciais: string };
      expect(previa.instrucoesIniciais).toContain(`Pasta de trabalho: ${fora}`);
    });
  });
});

describe("rotas de orquestradores — economia de tokens", () => {
  const raiz = path.resolve("/projetos");
  let servidor: Server;
  let base: string;
  let repositorio: RepositorioEmMemoria;
  let servico: ServicoDeOrquestracao;
  let explorador: ExploradorDePastas;
  const consultas: ConsultaDeEsforcoHerdado[] = [];
  let ids = 0;

  const consumo = ConsumoDoTurno.criar({
    principal: UsoDeTokens.criar({ entrada: 6, criacaoDeCache: 33062, leituraDeCache: 62885, saida: 383 }),
    subagentes: UsoDeTokens.vazio,
    subagentesMedidos: 0,
    parcial: false,
    modeloDoPrincipal: "claude-opus-5-5",
  });

  beforeAll(async () => {
    repositorio = new RepositorioEmMemoria();
    explorador = new ExploradorDePastas(raiz);
    const anexos = new ArmazemDeAnexosEmArquivo(path.join(tmpdir(), "orquestrador-rotas-economia-teste"));
    servico = new ServicoDeOrquestracao({
      repositorio,
      motor: new MotorImediato(),
      execucoes: new ControleDeExecucoesEmMemoria(),
      publicador: { publicar: () => undefined, sinalizar: () => undefined },
      anexos,
      worktrees: {
        preparar: async (_id, pastaDeTrabalho) => ({ cwd: pastaDeTrabalho, worktree: null }),
        concluir: async () => false,
      },
      pastaDeArtefatos: (orquestradorId) => path.join(tmpdir(), "orquestrador-rotas-economia-teste-artefatos", orquestradorId),
      preferencias: new PreferenciasEmMemoria(),
      gerarId: () => `e${++ids}`,
      agora: () => new Date("2026-10-28T12:00:00Z"),
      medidor: { medirTurno: async () => consumo },
      esforcoDaMaquina: {
        herdadoPara: async (consulta) => {
          consultas.push(consulta);
          return consulta.modelo === "opus"
            ? EsforcoHerdado.criar({ nivel: "maximo", origem: "CLAUDE_CODE_EFFORT_LEVEL", modelo: consulta.modeloReal })
            : null;
        },
      },
    });

    const aplicacao = express();
    aplicacao.use(express.json());
    aplicacao.use(
      "/api",
      criarOrquestradoresRoutes({
        servico,
        repositorio,
        canal: new CanalDeEventos(),
        explorador,
        anexos,
        preferencias: new PreferenciasEmMemoria(),
        pastaRaiz: raiz,
      }),
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    servidor.close();
    await once(servidor, "close");
  });

  let orquestrador: Orquestrador;

  beforeEach(async () => {
    consultas.length = 0;
    orquestrador = await servico.criarOrquestrador({
      nome: "Painel",
      pastaDeTrabalho: PastaDeTrabalho.dentroDe(raiz, "painel"),
      configuracao: {
        modeloDoOrquestrador: "opus",
        modeloDosSubagentes: "haiku",
        quantidadeDeSubagentes: { modo: "fixa", limite: 3 },
        nivelDePermissao: "edicao_e_comandos",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function aplicar(id: string, corpo: unknown): Promise<Response> {
    return fetch(`${base}/orquestradores/${id}/configuracao/predefinicao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
  }

  it("GET /predefinicoes lista o modo econômico", async () => {
    const resposta = await fetch(`${base}/predefinicoes`);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([
      {
        nome: "economico",
        rotulo: "Modo econômico",
        descricao: expect.any(String),
        configuracao: {
          modeloDoOrquestrador: "opus",
          esforcoDoOrquestrador: "medio",
          modeloDosSubagentes: "sonnet",
          esforcoDosSubagentes: "medio",
          quantidadeDeSubagentes: { modo: "automatica", limite: 1 },
        },
      },
    ]);
  });

  it("o resumo traz predefinicaoCorrespondente null antes de aplicar", async () => {
    const detalhe = (await (await fetch(`${base}/orquestradores/${orquestrador.id}`)).json()) as Record<string, unknown>;
    const lista = (await (await fetch(`${base}/orquestradores`)).json()) as Array<Record<string, unknown>>;

    expect(detalhe.predefinicaoCorrespondente).toBeNull();
    expect(lista.find((item) => item.id === orquestrador.id)?.predefinicaoCorrespondente).toBeNull();
  });

  it("aplicar responde 200 com o mesmo corpo do PATCH da configuração", async () => {
    const resposta = await aplicar(orquestrador.id, { predefinicao: "economico" });

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as Record<string, unknown>;
    expect(corpo).toMatchObject({
      id: orquestrador.id,
      predefinicaoCorrespondente: "economico",
      configuracao: { modeloDosSubagentes: "sonnet", nivelDePermissao: "edicao_e_comandos", permitirCommitEPush: false },
    });
    expect(repositorio.eventos.at(-1)).toMatchObject({ tipo: "configuracao_alterada", predefinicao: "economico" });

    const patch = await fetch(`${base}/orquestradores/${orquestrador.id}/configuracao`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(Object.keys((await patch.json()) as object).sort()).toEqual(Object.keys(corpo).sort());

    const editado = await fetch(`${base}/orquestradores/${orquestrador.id}/configuracao`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ esforcoDoOrquestrador: "alto" }),
    });
    expect(((await editado.json()) as Record<string, unknown>).predefinicaoCorrespondente).toBeNull();
  });

  it.each([[{ predefinicao: "turbo" }], [{ predefinicao: 1 }], [{}]])(
    "aplicar recusa %j com 400",
    async (corpo) => {
      const resposta = await aplicar(orquestrador.id, corpo);

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "Predefinição desconhecida." });
    },
  );

  it("aplicar em orquestrador inexistente responde 404", async () => {
    const resposta = await aplicar("nao-existe", { predefinicao: "economico" });

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Orquestrador não encontrado." });
  });

  it("GET /orquestradores/:id/esforco-herdado usa os modelos da configuração e o modelo medido", async () => {
    const mensagem = await fetch(`${base}/orquestradores/${orquestrador.id}/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: "analise" }),
    });
    expect(mensagem.status).toBe(202);
    await vi.waitFor(() =>
      expect(repositorio.eventos.at(-1)).toMatchObject({ tipo: "consumo_do_turno_medido" }),
    );

    const resposta = await fetch(`${base}/orquestradores/${orquestrador.id}/esforco-herdado`);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      orquestrador: { nivel: "maximo", origem: "CLAUDE_CODE_EFFORT_LEVEL", modelo: "claude-opus-5-5", deveAvisar: true },
      subagentes: null,
    });
    expect(consultas).toEqual([
      { modelo: "opus", pastaDoProjeto: orquestrador.pastaDeTrabalho.caminho, modeloReal: "claude-opus-5-5" },
      { modelo: "haiku", pastaDoProjeto: orquestrador.pastaDeTrabalho.caminho, modeloReal: null },
    ]);
  });

  it("GET /orquestradores/:id/esforco-herdado responde 404 para inexistente", async () => {
    const resposta = await fetch(`${base}/orquestradores/nao-existe/esforco-herdado`);

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Orquestrador não encontrado." });
  });

  it("GET /esforco-herdado consulta os modelos e a pasta do formulário", async () => {
    vi.spyOn(explorador, "existe").mockResolvedValue(true);

    const resposta = await fetch(
      `${base}/esforco-herdado?modeloDoOrquestrador=sonnet&modeloDosSubagentes=opus&pasta=painel`,
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      orquestrador: null,
      subagentes: { nivel: "maximo", origem: "CLAUDE_CODE_EFFORT_LEVEL", modelo: null, deveAvisar: true },
    });
    expect(consultas).toEqual([
      { modelo: "sonnet", pastaDoProjeto: path.join(raiz, "painel"), modeloReal: null },
      { modelo: "opus", pastaDoProjeto: path.join(raiz, "painel"), modeloReal: null },
    ]);
  });

  it.each<[string, string]>([
    ["modeloDoOrquestrador=turbo&modeloDosSubagentes=opus&pasta=painel", "Modelo do orquestrador inválido."],
    ["modeloDoOrquestrador=opus&modeloDosSubagentes=opus", "Escolha a pasta de trabalho."],
  ])("GET /esforco-herdado recusa %s com 400", async (query, mensagem) => {
    const resposta = await fetch(`${base}/esforco-herdado?${query}`);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: mensagem });
  });

  it("GET /esforco-herdado recusa pasta fora da raiz e pasta inexistente", async () => {
    const fora = await fetch(`${base}/esforco-herdado?modeloDoOrquestrador=opus&modeloDosSubagentes=opus&pasta=..%2F..`);
    vi.spyOn(explorador, "existe").mockResolvedValue(false);
    const inexistente = await fetch(
      `${base}/esforco-herdado?modeloDoOrquestrador=opus&modeloDosSubagentes=opus&pasta=sumiu`,
    );

    expect(fora.status).toBe(400);
    expect(inexistente.status).toBe(400);
    expect(await inexistente.json()).toEqual({ erro: `A pasta "${path.join(raiz, "sumiu")}" não existe.` });
  });

  it("GET /pastas/navegar com estrito=1 recusa caminho inexistente com 400", async () => {
    const alvo = path.join(raiz, "sumiu");
    const resposta = await fetch(`${base}/pastas/navegar?caminho=${encodeURIComponent(alvo)}&estrito=1`);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: `A pasta "${alvo}" não existe.` });
  });
});

/** Os históricos de cada Orquestrador, para a rota de eventos ao vivo. */
class RepositorioDeHistoricos implements RepositorioDeOrquestradores {
  readonly historicos = new Map<string, EventoRegistrado[]>();

  listar(): readonly Orquestrador[] {
    return [];
  }
  buscarPorId(id: string): Orquestrador | null {
    return this.historicos.has(id) ? ({ id } as unknown as Orquestrador) : null;
  }
  async salvar(): Promise<void> {}
  async remover(): Promise<void> {}
  anexarEvento(): EventoRegistrado {
    throw new Error("não usado nestes testes");
  }
  arquivarConversa(): ConversaArquivada {
    throw new Error("não usado nestes testes");
  }
  lerEventos(orquestradorId: string, depoisDaSequencia: number): readonly EventoRegistrado[] {
    return (this.historicos.get(orquestradorId) ?? []).filter((evento) => evento.sequencia > depoisDaSequencia);
  }
}

describe("rotas de orquestradores — eventos de vários orquestradores numa conexão só", () => {
  let servidor: Server;
  let base: string;
  let repositorio: RepositorioDeHistoricos;
  let canal: CanalDeEventos;

  const evento = (sequencia: number): EventoRegistrado => ({
    tipo: "turno_cancelado",
    turnoId: "t1",
    sequencia,
    em: "agora",
  });

  beforeAll(async () => {
    repositorio = new RepositorioDeHistoricos();
    canal = new CanalDeEventos();
    const aplicacao = express();
    aplicacao.use(
      "/api",
      criarOrquestradoresRoutes({
        // A rota de eventos não usa o serviço.
        servico: {} as unknown as ServicoDeOrquestracao,
        repositorio,
        canal,
        explorador: new ExploradorDePastas(path.resolve("/projetos")),
        anexos: new ArmazemDeAnexosEmArquivo(path.join(tmpdir(), "orquestrador-rotas-teste")),
        preferencias: new PreferenciasEmMemoria(),
        pastaRaiz: path.resolve("/projetos"),
      }),
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
  });

  /** Lê o stream até ter `quantas` mensagens com dados; devolve cada uma como [tipo, dados]. */
  async function lerMensagens(
    leitor: ReadableStreamDefaultReader<Uint8Array>,
    quantas: number,
    acumulado: { texto: string },
  ): Promise<[string, unknown][]> {
    const decodificador = new TextDecoder();
    const mensagens = (): [string, unknown][] =>
      acumulado.texto
        .split("\n\n")
        .filter((bloco) => bloco.includes("data: "))
        .map((bloco) => {
          const tipo = /^event: (.+)$/m.exec(bloco)?.[1] ?? "message";
          const dados = /^data: (.+)$/m.exec(bloco)?.[1] ?? "null";
          return [tipo, JSON.parse(dados) as unknown];
        });
    while (mensagens().length < quantas) {
      const { value, done } = await leitor.read();
      if (done) {
        break;
      }
      acumulado.texto += decodificador.decode(value, { stream: true });
    }
    return mensagens();
  }

  it("manda o histórico e os eventos novos de cada orquestrador, marcados com o id, e ignora ids desconhecidos", async () => {
    repositorio.historicos.set("o1", [evento(1), evento(2), evento(3)]);
    repositorio.historicos.set("o2", [evento(1), evento(2)]);

    const resposta = await fetch(`${base}/eventos-dos-orquestradores?orquestradores=o1:1,o2:0,sumiu:0`);
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toContain("text/event-stream");
    const leitor = resposta.body!.getReader();
    const acumulado = { texto: "" };

    try {
      expect(await lerMensagens(leitor, 4, acumulado)).toEqual([
        ["message", { orquestradorId: "o1", evento: evento(2) }],
        ["message", { orquestradorId: "o1", evento: evento(3) }],
        ["message", { orquestradorId: "o2", evento: evento(1) }],
        ["message", { orquestradorId: "o2", evento: evento(2) }],
      ]);

      canal.publicar("o2", evento(3));
      canal.publicar("o2", evento(3)); // repetido: não sai de novo
      canal.sinalizar("o1", { turnoId: "t9", em: "agora", tokensPensando: 50 });

      expect((await lerMensagens(leitor, 6, acumulado)).slice(4)).toEqual([
        ["message", { orquestradorId: "o2", evento: evento(3) }],
        ["sinal", { orquestradorId: "o1", sinal: { turnoId: "t9", em: "agora", tokensPensando: 50 } }],
      ]);
      expect(acumulado.texto).not.toContain("sumiu");
    } finally {
      await leitor.cancel();
    }
  });

  it.each<[string, string]>([
    ["", "Informe de quais orquestradores quer os eventos."],
    [
      `?orquestradores=${Array.from({ length: MAXIMO_DE_ORQUESTRADORES_POR_CONEXAO + 1 }, (_, i) => `o${i}:0`).join(",")}`,
      `Acompanhe no máximo ${MAXIMO_DE_ORQUESTRADORES_POR_CONEXAO} orquestradores por conexão.`,
    ],
  ])("recusa a consulta %# com 400", async (consulta, mensagem) => {
    const resposta = await fetch(`${base}/eventos-dos-orquestradores${consulta}`);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: mensagem });
  });
});
