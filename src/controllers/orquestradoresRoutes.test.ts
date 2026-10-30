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
import { EventoDeOrquestracao, EventoDoMotor, EventoRegistrado } from "../orquestracao/EventoDeOrquestracao";
import { MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../orquestracao/MotorDeAgentes";
import { Orquestrador } from "../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../orquestracao/PastaDeTrabalho";
import { RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { ServicoDeOrquestracao } from "../orquestracao/ServicoDeOrquestracao";
import { criarOrquestradoresRoutes } from "./orquestradoresRoutes";

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
  let explorador: ExploradorDePastas;
  let ids = 0;

  beforeAll(async () => {
    repositorio = new RepositorioEmMemoria();
    motor = new MotorImediato();
    explorador = new ExploradorDePastas(raiz);
    const anexos = new ArmazemDeAnexosEmArquivo(path.join(tmpdir(), "orquestrador-rotas-teste"));
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

    it.each<[string, unknown, string]>([
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
});
