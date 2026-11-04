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
import { PreferenciasGlobais } from "../orquestracao/PreferenciasGlobais";
import { ConversaArquivada, RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { RepositorioDePreferencias } from "../orquestracao/RepositorioDePreferencias";
import { ServicoDeOrquestracao } from "../orquestracao/ServicoDeOrquestracao";
import { criarOrquestradoresRoutes } from "./orquestradoresRoutes";

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
      pastaDeTrabalho: PastaDeTrabalho.resolver(raiz, "painel"),
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

  describe("opções de trabalho direto e de propor plano", () => {
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

    const mensagemDoTrabalhoDireto =
      'A opção "Deixar o orquestrador fazer o trivial sozinho" deve ser verdadeira ou falsa.';
    const mensagemDoPlano = 'A opção "Propor plano antes de mudanças grandes" deve ser verdadeira ou falsa.';

    it("o PATCH aceita as duas opções", async () => {
      const resposta = await alterarConfiguracao({ permitirTrabalhoDireto: false, proporPlanoEmPedidosGrandes: false });

      expect(resposta.status).toBe(200);
      expect(((await resposta.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        permitirTrabalhoDireto: false,
        proporPlanoEmPedidosGrandes: false,
      });
    });

    it("o POST aceita as duas opções", async () => {
      const resposta = await postar("/orquestradores", {
        nome: "Novo",
        pastaDeTrabalho: raiz,
        modeloDoOrquestrador: "opus",
        modeloDosSubagentes: "haiku",
        quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
        nivelDePermissao: "leitura",
        permitirTrabalhoDireto: false,
        proporPlanoEmPedidosGrandes: true,
      });

      expect(resposta.status).toBe(201);
      expect(((await resposta.json()) as { configuracao: unknown }).configuracao).toMatchObject({
        permitirTrabalhoDireto: false,
        proporPlanoEmPedidosGrandes: true,
      });
    });

    it.each<[string, unknown, string]>([
      ["permitirTrabalhoDireto", "sim", mensagemDoTrabalhoDireto],
      ["permitirTrabalhoDireto", null, mensagemDoTrabalhoDireto],
      ["proporPlanoEmPedidosGrandes", 1, mensagemDoPlano],
      ["proporPlanoEmPedidosGrandes", "nao", mensagemDoPlano],
    ])("o PATCH recusa %s = %j com 400 e mensagem clara", async (campo, valor, mensagem) => {
      const resposta = await alterarConfiguracao({ [campo]: valor });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: mensagem });
    });

    it("o POST recusa opção inválida com 400", async () => {
      const resposta = await postar("/orquestradores", {
        nome: "Novo",
        pastaDeTrabalho: raiz,
        modeloDoOrquestrador: "opus",
        modeloDosSubagentes: "haiku",
        quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
        nivelDePermissao: "leitura",
        proporPlanoEmPedidosGrandes: "sim",
      });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: mensagemDoPlano });
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
      expect(await (await requisitar("GET", "/preferencias")).json()).toEqual({ instrucoesPadrao: "", subagentesProntos: [] });

      const resposta = await requisitar("PATCH", "/preferencias", { instrucoesPadrao: " Responda curto. " });
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({ instrucoesPadrao: "Responda curto.", subagentesProntos: [] });
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
      expect(await resposta.json()).toEqual({ instrucoesPadrao: "", subagentesProntos: [{ ...revisor, modelo: "herdar" }] });

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

    it("PATCH /preferencias recusa valor inválido com 400", async () => {
      const resposta = await requisitar("PATCH", "/preferencias", { instrucoesPadrao: ["a"] });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "As instruções padrão devem ser um texto." });
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
  describe("pastas: qualquer pasta do computador", () => {
    const configuracaoBasica = {
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
      nivelDePermissao: "leitura",
    } as const;

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("GET /pastas sem caminho abre a pasta dos projetos e traz os atalhos", async () => {
      const listar = vi
        .spyOn(explorador, "listar")
        .mockResolvedValue({ atual: raiz, acima: path.dirname(raiz), pastas: [{ nome: "painel", caminho: path.join(raiz, "painel") }] });
      vi.spyOn(explorador, "atalhos").mockResolvedValue([{ nome: "Projetos", caminho: raiz }]);

      const resposta = await fetch(`${base}/pastas`);

      expect(resposta.status).toBe(200);
      expect(listar).toHaveBeenCalledWith(undefined);
      expect(await resposta.json()).toEqual({
        raiz,
        atual: raiz,
        acima: path.dirname(raiz),
        pastas: [{ nome: "painel", caminho: path.join(raiz, "painel") }],
        atalhos: [{ nome: "Projetos", caminho: raiz }],
      });
    });

    it("GET /pastas?caminho= abre a pasta pedida, mesmo fora da pasta dos projetos", async () => {
      const fora = path.resolve("/outro/lugar");
      const listar = vi.spyOn(explorador, "listar").mockResolvedValue({ atual: fora, acima: null, pastas: [] });
      vi.spyOn(explorador, "atalhos").mockResolvedValue([]);

      const resposta = await fetch(`${base}/pastas?caminho=${encodeURIComponent(fora)}`);

      expect(resposta.status).toBe(200);
      expect(listar).toHaveBeenCalledWith(fora);
    });

    it("GET /pastas com pasta que não existe responde 400 com a mensagem", async () => {
      const resposta = await fetch(`${base}/pastas?caminho=${encodeURIComponent(path.join(raiz, "nao-existe"))}`);

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: `A pasta "${path.join(raiz, "nao-existe")}" não existe.` });
    });

    it("GET /pastas com dois caminhos responde 400", async () => {
      const resposta = await fetch(`${base}/pastas?caminho=a&caminho=b`);

      expect(resposta.status).toBe(400);
    });

    it("o POST cria um orquestrador numa pasta fora da pasta dos projetos", async () => {
      const fora = path.resolve("/outro/lugar");
      vi.spyOn(explorador, "existe").mockResolvedValue(true);

      const resposta = await postar("/orquestradores", { nome: "Fora", pastaDeTrabalho: fora, ...configuracaoBasica });

      expect(resposta.status).toBe(201);
      expect(((await resposta.json()) as { pastaDeTrabalho: string }).pastaDeTrabalho).toBe(fora);
    });

    it("o POST continua recusando uma pasta que não existe", async () => {
      const inexistente = path.resolve("/outro/nao-existe");
      vi.spyOn(explorador, "existe").mockResolvedValue(false);

      const resposta = await postar("/orquestradores", { nome: "X", pastaDeTrabalho: inexistente, ...configuracaoBasica });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: `A pasta "${inexistente}" não existe.` });
    });
  });
});
