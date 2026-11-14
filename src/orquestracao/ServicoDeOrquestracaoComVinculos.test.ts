import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { RepositorioDeVinculos } from "../vinculos/RepositorioDeVinculos";
import { ServicoDeVinculos } from "../vinculos/ServicoDeVinculos";
import { Vinculo } from "../vinculos/Vinculo";
import { Anexo } from "./Anexo";
import { ArmazemDeAnexos } from "./ArmazemDeAnexos";
import { DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import { EventoDeOrquestracao, EventoDoMotor, EventoRegistrado } from "./EventoDeOrquestracao";
import { mensagemParaOOrquestrador } from "./InstrucoesDoOrquestrador";
import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "./MotorDeAgentes";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { GerenciadorDeWorktrees, PreparoDeWorktree } from "./PreparoDeWorktree";
import { PreferenciasGlobais } from "./PreferenciasGlobais";
import { ConversaArquivada, RepositorioDeOrquestradores } from "./RepositorioDeOrquestradores";
import { RepositorioDePreferencias } from "./RepositorioDePreferencias";
import { ServicoDeOrquestracao } from "./ServicoDeOrquestracao";

class RepositorioEmMemoria implements RepositorioDeOrquestradores {
  readonly orquestradores = new Map<string, Orquestrador>();
  readonly eventos: Array<EventoRegistrado & { orquestradorId: string }> = [];

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
  anexarEvento(orquestradorId: string, evento: EventoDeOrquestracao): EventoRegistrado {
    const registrado = { ...evento, sequencia: this.eventos.length + 1, em: "agora" };
    this.eventos.push({ ...registrado, orquestradorId });
    return registrado;
  }
  arquivarConversa(orquestrador: Orquestrador, evento: EventoDeOrquestracao): ConversaArquivada {
    return { registrado: this.anexarEvento(orquestrador.id, evento), gravacao: Promise.resolve() };
  }
  lerEventos(): readonly EventoRegistrado[] {
    return this.eventos;
  }
  avisosDe(orquestradorId: string): string[] {
    return this.eventos.flatMap((e) => (e.orquestradorId === orquestradorId && e.tipo === "aviso_de_vinculo" ? [e.mensagem] : []));
  }
}

class RepositorioDeVinculosEmMemoria implements RepositorioDeVinculos {
  readonly dados = new Map<string, Vinculo>();
  todos(): readonly Vinculo[] {
    return [...this.dados.values()].map((v) => Vinculo.reconstituir(v.paraDados()));
  }
  buscar(id: string): Vinculo | null {
    const v = this.dados.get(id);
    return v === undefined ? null : Vinculo.reconstituir(v.paraDados());
  }
  async salvar(vinculo: Vinculo): Promise<void> {
    this.dados.set(vinculo.id, Vinculo.reconstituir(vinculo.paraDados()));
  }
  async remover(id: string): Promise<void> {
    this.dados.delete(id);
  }
}

/** Responde na hora, com o texto que o teste definir para cada pedido. */
class MotorQueResponde implements MotorDeAgentes {
  pedidos: PedidoDeTurno[] = [];
  constructor(private readonly responder: (pedido: PedidoDeTurno, indice: number) => string) {}

  async executarTurno(pedido: PedidoDeTurno, _aoObservar: (evento: EventoDoMotor) => void): Promise<ResultadoDoTurno> {
    const indice = this.pedidos.length;
    this.pedidos.push(pedido);
    return {
      sucesso: true,
      resposta: this.responder(pedido, indice),
      uso: { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 },
    };
  }
}

class ArmazemFalso implements ArmazemDeAnexos {
  async guardar(_o: string, _a: Anexo, _c: Uint8Array): Promise<void> {}
  caminhoDe(o: string, arquivo: string): string {
    return `/anexos/${o}/${arquivo}`;
  }
  caminhoDoTextoDe(): string | null {
    return null;
  }
  pastaDe(o: string): string {
    return `/anexos/${o}`;
  }
  async removerTodos(): Promise<void> {}
}

class WorktreesFalso implements GerenciadorDeWorktrees {
  async preparar(_id: string, pasta: string): Promise<PreparoDeWorktree> {
    return { cwd: pasta, worktree: null };
  }
  async concluir(): Promise<boolean> {
    return false;
  }
}

class PreferenciasFalsas implements RepositorioDePreferencias {
  atuais(): PreferenciasGlobais {
    return PreferenciasGlobais.vazias();
  }
  async salvar(): Promise<void> {}
}

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  modeloDosSubagentes: "haiku",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "edicao",
};

const BLOCO = (para: string, texto: string): string =>
  "```mensagem-para-vinculado\n" + JSON.stringify({ para, texto }) + "\n```";

describe("ServicoDeOrquestracao e os vínculos", () => {
  let repositorio: RepositorioEmMemoria;
  let repositorioDeVinculos: RepositorioDeVinculosEmMemoria;
  let vinculos: ServicoDeVinculos;
  let ids: number;

  function montar(motor: MotorDeAgentes): ServicoDeOrquestracao {
    const servico: ServicoDeOrquestracao = new ServicoDeOrquestracao({
      vinculos,
      repositorio,
      motor,
      execucoes: new ControleDeExecucoesEmMemoria(),
      publicador: { publicar: () => undefined, sinalizar: () => undefined },
      anexos: new ArmazemFalso(),
      worktrees: new WorktreesFalso(),
      pastaDeArtefatos: (id) => `/artefatos/${id}`,
      preferencias: new PreferenciasFalsas(),
      gerarId: () => `id${++ids}`,
      agora: () => new Date("2026-11-14T10:00:00Z"),
    });
    return servico;
  }

  async function criar(servico: ServicoDeOrquestracao, nome: string): Promise<Orquestrador> {
    return servico.criarOrquestrador({
      nome,
      pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), nome.toLowerCase()),
      configuracao,
    });
  }

  let servicoAtual: ServicoDeOrquestracao;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    repositorioDeVinculos = new RepositorioDeVinculosEmMemoria();
    ids = 0;
    vinculos = new ServicoDeVinculos({
      repositorio: repositorioDeVinculos,
      orquestradores: { nomeDe: (id) => repositorio.buscarPorId(id)?.nome ?? null },
      entregar: (destinoId, texto, origem) => servicoAtual.receberDeVinculado(destinoId, texto, origem),
      gerarId: () => `v${++ids}`,
      agora: () => new Date("2026-11-14T10:00:00Z"),
    });
  });

  it("a mensagem do agente vai direto à fila do outro, que a executa com a origem e o contexto de vínculo", async () => {
    const motor = new MotorQueResponde((pedido) =>
      pedido.orquestradorId === "id1" ? `Pronto.\n${BLOCO("Front", "A API está em /v1")}` : "Recebido.",
    );
    servicoAtual = montar(motor);
    const api = await criar(servicoAtual, "API");
    const front = await criar(servicoAtual, "Front");
    const vinculo = await vinculos.vincular(api.id, front.id);
    await vinculos.editarNotas(vinculo.id, "contrato: /v1");

    const { conclusao } = await servicoAtual.enviarMensagem(api.id, "publique a API");
    await conclusao;
    await new Promise((resolver) => setTimeout(resolver, 20));

    expect(motor.pedidos.map((p) => p.orquestradorId)).toEqual([api.id, front.id]);
    const doFront = motor.pedidos[1];
    expect(doFront?.texto).toBe("A API está em /v1");
    expect(doFront?.origemDaMensagem).toEqual({ orquestradorId: api.id, nome: "API", saltos: 0 });
    expect(doFront?.vinculados).toEqual([
      { id: api.id, nome: "API", pasta: api.pastaDeTrabalho.caminho, notas: "contrato: /v1" },
    ]);
    // O bloco saiu do texto exibido do remetente.
    expect(api.ultimoTurno?.resposta).toBe("Pronto.");
    expect(front.fila).toEqual([]);
  });

  it("com o destino ocupado, a mensagem espera na fila com a origem gravada", async () => {
    const motor = new MotorQueResponde(() => "ok");
    servicoAtual = montar(motor);
    const api = await criar(servicoAtual, "API");
    const front = await criar(servicoAtual, "Front");
    await servicoAtual.enfileirarPedido(front.id, "tarefa antiga");

    await servicoAtual.receberDeVinculado(front.id, "oi", { orquestradorId: api.id, nome: "API", saltos: 1 });

    expect(front.fila.map((p) => p.texto)).toEqual(["tarefa antiga", "oi"]);
    expect(front.fila[1]?.origem).toEqual({ orquestradorId: api.id, nome: "API", saltos: 1 });
    expect(motor.pedidos).toEqual([]);
  });

  it("descarta a mensagem que passa do limite de saltos e avisa o remetente", async () => {
    // Os dois respondem sempre mandando mensagem ao outro: um laço.
    const motor = new MotorQueResponde((pedido) => `ok\n${BLOCO(pedido.orquestradorId === "id1" ? "Front" : "API", "sua vez")}`);
    servicoAtual = montar(motor);
    const api = await criar(servicoAtual, "API");
    const front = await criar(servicoAtual, "Front");
    await vinculos.vincular(api.id, front.id);

    const { conclusao } = await servicoAtual.enviarMensagem(api.id, "comece");
    await conclusao;
    await new Promise((resolver) => setTimeout(resolver, 50));

    // 1 turno do usuário + 7 mensagens entregues (saltos 0 a 6); a de salto 7 é descartada.
    expect(motor.pedidos).toHaveLength(8);
    expect(motor.pedidos.map((p) => p.origemDaMensagem?.saltos ?? null)).toEqual([null, 0, 1, 2, 3, 4, 5, 6]);
    const avisos = [...repositorio.avisosDe(api.id), ...repositorio.avisosDe(front.id)];
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("limite de 6");
  });

  it("registra aviso no histórico para bloco inválido e para quem não é vinculado", async () => {
    const motor = new MotorQueResponde(
      () => `ok\n${BLOCO("Fantasma", "oi")}\n\`\`\`mensagem-para-vinculado\n{nao json\n\`\`\``,
    );
    servicoAtual = montar(motor);
    const api = await criar(servicoAtual, "API");

    const { conclusao } = await servicoAtual.enviarMensagem(api.id, "x");
    await conclusao;

    const avisos = repositorio.avisosDe(api.id);
    expect(avisos).toHaveLength(2);
    expect(avisos.some((a) => a.includes("JSON") || a.includes("ignorado"))).toBe(true);
    expect(avisos.some((a) => a.includes("Fantasma"))).toBe(true);
    expect(api.ultimoTurno?.resposta).toBe("ok");
  });

  it("não envia os blocos de uma resposta do modo planejamento", async () => {
    const motor = new MotorQueResponde(() => `Plano.\n${BLOCO("Front", "oi")}`);
    servicoAtual = montar(motor);
    const api = await criar(servicoAtual, "API");
    const front = await criar(servicoAtual, "Front");
    await vinculos.vincular(api.id, front.id);

    const { conclusao } = await servicoAtual.enviarMensagem(api.id, "planeje", [], "planejamento");
    await conclusao;

    expect(motor.pedidos).toHaveLength(1);
    expect(front.fila).toEqual([]);
  });

  it("atualiza as notas do vínculo pelo bloco notas-do-vinculo", async () => {
    const motor = new MotorQueResponde(() => "ok\n```notas-do-vinculo\n" + JSON.stringify({ com: "Front", texto: "decisão X" }) + "\n```");
    servicoAtual = montar(motor);
    const api = await criar(servicoAtual, "API");
    const front = await criar(servicoAtual, "Front");
    const vinculo = await vinculos.vincular(api.id, front.id);

    const { conclusao } = await servicoAtual.enviarMensagem(api.id, "x");
    await conclusao;

    expect(repositorioDeVinculos.buscar(vinculo.id)?.notas).toBe("decisão X");
  });

  it("remover o orquestrador apaga os vínculos dele", async () => {
    servicoAtual = montar(new MotorQueResponde(() => "ok"));
    const api = await criar(servicoAtual, "API");
    const front = await criar(servicoAtual, "Front");
    const infra = await criar(servicoAtual, "Infra");
    await vinculos.vincular(api.id, front.id);
    const restante = await vinculos.vincular(front.id, infra.id);

    await servicoAtual.remover(api.id);

    expect(vinculos.listar().map((v) => v.id)).toEqual([restante.id]);
  });
});

describe("mensagemParaOOrquestrador e os vínculos", () => {
  const config = ConfiguracaoDoOrquestrador.de(configuracao);
  const montarMensagem = (...args: Partial<Parameters<typeof mensagemParaOOrquestrador>>): string =>
    mensagemParaOOrquestrador("faça isso", config, [], "execucao", null, null, false, [], "unix", [], [], ...(args as []));

  it("sem vínculos a mensagem fica como antes", () => {
    const mensagem = montarMensagem();

    expect(mensagem).not.toContain("<vinculos>");
    expect(mensagem.endsWith("\n\nfaça isso")).toBe(true);
  });

  it("injeta a seção de vínculos com parceiro, pasta, notas e os dois blocos", () => {
    const mensagem = mensagemParaOOrquestrador(
      "faça isso", config, [], "execucao", null, null, false, [], "unix", [], [],
      [{ id: "o2", nome: "Front", pasta: "C:\\projetos\\front", notas: "API em /v1" }],
    );

    expect(mensagem).toContain("<vinculos>");
    expect(mensagem).toContain('"Front" (id o2), pasta C:\\projetos\\front');
    expect(mensagem).toContain("API em /v1");
    expect(mensagem).toContain("```mensagem-para-vinculado");
    expect(mensagem).toContain("```notas-do-vinculo");
    expect(mensagem.indexOf("<vinculos>")).toBeGreaterThan(mensagem.indexOf("</configuracao-do-pedido>"));
    expect(mensagem.indexOf("</vinculos>")).toBeLessThan(mensagem.indexOf("faça isso"));
  });

  it("abre o pedido com a linha de quem enviou e o salto", () => {
    const mensagem = mensagemParaOOrquestrador(
      "rode os testes", config, [], "execucao", null, null, false, [], "unix", [], [], [],
      { orquestradorId: "o1", nome: "API", saltos: 3 },
    );

    expect(mensagem.endsWith("\n\nMensagem do orquestrador API (salto 3):\nrode os testes")).toBe(true);
  });
});
