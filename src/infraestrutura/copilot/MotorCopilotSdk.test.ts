import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { EsforcoDeRaciocinio } from "../../orquestracao/EsforcoDeRaciocinio";
import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { ABORTO_POR_SILENCIO, PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import {
  ConfiguracaoDaSessaoCopilot,
  DecisorDePermissaoDoCopilot,
  EventoDaSessaoCopilot,
  ModeloDoCopilot,
  SessaoDoCopilot,
} from "./FachadaCopilotSdk";
import { esforcoDoCopilot, FachadaDoMotorCopilot, MotorCopilotSdk } from "./MotorCopilotSdk";

function lerFixture(nome: string): EventoDaSessaoCopilot[] {
  return readFileSync(path.join(__dirname, "fixtures", `${nome}.jsonl`), "utf8")
    .split(/\r?\n/)
    .filter((linha) => linha.trim() !== "")
    .map((linha) => JSON.parse(linha) as EventoDaSessaoCopilot);
}

type Roteiro = () => EventoDaSessaoCopilot[];

const IDLE_ABORTADO: EventoDaSessaoCopilot = { type: "session.idle", data: { aborted: true } };

class SessaoFalsa implements SessaoDoCopilot {
  readonly enviados: Array<{ prompt: string; temAnexos: number }> = [];
  abortos = 0;
  desconectada = false;
  decisor: DecisorDePermissaoDoCopilot | null = null;
  /** Quando verdadeiro, `abortar()` termina o turno com `session.idle` aborted. */
  respondeAoAbort = true;
  private readonly ouvintes = new Set<(evento: EventoDaSessaoCopilot) => void>();

  constructor(
    readonly id: string,
    private readonly roteiro: Roteiro,
  ) {}

  enviar(prompt: string, anexos: readonly unknown[] = []): Promise<void> {
    this.enviados.push({ prompt, temAnexos: anexos.length });
    setTimeout(() => {
      for (const evento of this.roteiro()) {
        this.emitir(evento);
      }
    }, 0);
    return Promise.resolve();
  }

  emitir(evento: EventoDaSessaoCopilot): void {
    for (const ouvinte of [...this.ouvintes]) {
      ouvinte(evento);
    }
  }

  aoEvento(ouvinte: (evento: EventoDaSessaoCopilot) => void): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  trocarDecisor(decisor: DecisorDePermissaoDoCopilot): void {
    this.decisor = decisor;
  }

  abortar(): Promise<void> {
    this.abortos += 1;
    if (this.respondeAoAbort) {
      setTimeout(() => this.emitir(IDLE_ABORTADO), 0);
    }
    return Promise.resolve();
  }

  desconectar(): Promise<void> {
    this.desconectada = true;
    return Promise.resolve();
  }

  ferramentasOferecidas(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

const CATALOGO: ModeloDoCopilot[] = [
  {
    id: "claude-haiku-5.5",
    nome: "Claude Haiku 5.5",
    esforcos: ["low", "medium", "high"],
    esforcoPadrao: "medium",
    aceitaImagens: true,
    contextoMaximo: 100_000,
    preco: { entrada: 10, saida: 50, tamanhoDoLote: 1_000_000 },
  },
];

class FachadaFalsa implements FachadaDoMotorCopilot {
  readonly criadas: Array<{ id: string; configuracao: ConfiguracaoDaSessaoCopilot }> = [];
  readonly retomadas: Array<{ id: string; configuracao: ConfiguracaoDaSessaoCopilot }> = [];
  readonly vivas = new Map<string, SessaoFalsa>();
  derrubou = 0;
  falhaAoCriar: Error | null = null;
  catalogoIndisponivel = false;
  respondeAoAbort = true;

  constructor(private readonly roteiro: Roteiro) {}

  private nova(id: string): SessaoFalsa {
    const sessao = new SessaoFalsa(id, this.roteiro);
    sessao.respondeAoAbort = this.respondeAoAbort;
    this.vivas.set(id, sessao);
    return sessao;
  }

  criarSessao(id: string, configuracao: ConfiguracaoDaSessaoCopilot): Promise<SessaoDoCopilot> {
    if (this.falhaAoCriar !== null) {
      return Promise.reject(this.falhaAoCriar);
    }
    this.criadas.push({ id, configuracao });
    const sessao = this.nova(id);
    sessao.decisor = configuracao.decisor;
    return Promise.resolve(sessao);
  }

  retomarSessao(id: string, configuracao: ConfiguracaoDaSessaoCopilot): Promise<SessaoDoCopilot> {
    this.retomadas.push({ id, configuracao });
    const sessao = this.nova(id);
    sessao.decisor = configuracao.decisor;
    return Promise.resolve(sessao);
  }

  sessaoViva(id: string): SessaoDoCopilot | null {
    return this.vivas.get(id) ?? null;
  }

  esquecerSessao(id: string): void {
    this.vivas.delete(id);
  }

  derrubar(): Promise<void> {
    this.derrubou += 1;
    this.vivas.clear();
    return Promise.resolve();
  }

  listarModelos(): Promise<ModeloDoCopilot[]> {
    return this.catalogoIndisponivel ? Promise.reject(new Error("sem catálogo")) : Promise.resolve(CATALOGO);
  }
}

let pastaDoTeste = "";

beforeAll(() => {
  pastaDoTeste = mkdtempSync(path.join(tmpdir(), "motor-copilot-"));
});

afterAll(() => {
  rmSync(pastaDoTeste, { recursive: true, force: true });
});

function pedido(alteracoes: Partial<PedidoDeTurno> = {}, nivel: NivelDePermissao = "leitura", permitirCommitEPush = false): PedidoDeTurno {
  return {
    orquestradorId: "o1",
    sessaoId: "sessao-1",
    sessaoIniciada: false,
    texto: "leia a nota",
    modo: "execucao",
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "haiku",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
      nivelDePermissao: nivel,
      permitirCommitEPush,
      esforcoDoOrquestrador: "alto",
    }),
    anexos: [],
    pastaDosAnexos: null,
    pastaDeArtefatos: path.join(pastaDoTeste, "artefatos", "o1"),
    instrucoes: null,
    revogarInstrucoesAnteriores: false,
    subagentesProntos: [],
    ...alteracoes,
  };
}

const SEM_SINAL = (): AbortSignal => new AbortController().signal;

async function executar(motor: MotorCopilotSdk, pedidoDoTurno: PedidoDeTurno, sinal: AbortSignal = SEM_SINAL()) {
  const eventos: EventoDoMotor[] = [];
  const resultado = await motor.executarTurno(pedidoDoTurno, (evento) => eventos.push(evento), sinal);
  return { eventos, resultado };
}

describe("esforcoDoCopilot", () => {
  const casos: Array<[EsforcoDeRaciocinio, string | undefined]> = [
    ["padrao", undefined],
    ["baixo", "low"],
    ["medio", "medium"],
    ["alto", "high"],
    ["extra_alto", "xhigh"],
    ["maximo", "max"],
    ["ultracode", "xhigh"],
  ];

  it.each(casos)("%s vira %s quando o modelo aceita todos os níveis", (esforco, esperado) => {
    expect(esforcoDoCopilot(esforco, ["low", "medium", "high", "xhigh", "max"])).toBe(esperado);
  });

  it("sem catálogo (nulo), manda o nível como está", () => {
    expect(esforcoDoCopilot("maximo", null)).toBe("max");
  });

  it("modelo sem esforço configurável: não envia nada", () => {
    expect(esforcoDoCopilot("alto", [])).toBeUndefined();
  });

  it("nível que o modelo não aceita: o mais alto aceito abaixo dele", () => {
    expect(esforcoDoCopilot("maximo", ["low", "medium", "high"])).toBe("high");
    expect(esforcoDoCopilot("extra_alto", ["low", "medium", "high", "max"])).toBe("high");
  });

  it("nada aceito abaixo do pedido: o mais baixo que o modelo aceita", () => {
    expect(esforcoDoCopilot("baixo", ["medium", "high"])).toBe("medium");
  });

  it("o `none` do catálogo não é um esforço que o domínio escolha", () => {
    expect(esforcoDoCopilot("baixo", ["none", "medium"])).toBe("medium");
  });
});

describe("MotorCopilotSdk — primeiro turno", () => {
  it("cria a sessão com o id do app, o modelo, o esforço, as ferramentas do nível e as pastas reais", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("streaming-com-ferramenta"));
    const pedidoDoTurno = pedido();
    const { eventos, resultado } = await executar(new MotorCopilotSdk(fachada), pedidoDoTurno);

    expect(fachada.criadas).toHaveLength(1);
    const criada = fachada.criadas[0];
    expect(criada?.id).toBe("sessao-1");
    expect(criada?.configuracao).toMatchObject({
      modelo: "claude-haiku-5.5",
      esforco: "high",
    });
    expect(criada?.configuracao.ferramentasLiberadas).toEqual(expect.arrayContaining(["view", "grep", "glob", "create"]));
    expect(criada?.configuracao.ferramentasLiberadas).not.toContain("powershell");
    const artefatos = realpathSync.native(pedidoDoTurno.pastaDeArtefatos);
    expect(criada?.configuracao.pastasAdicionais).toEqual([artefatos]);
    expect(criada?.configuracao.instrucoes).toContain(artefatos);
    expect(fachada.vivas.get("sessao-1")?.enviados).toEqual([{ prompt: "leia a nota", temAnexos: 0 }]);

    expect(eventos[0]).toEqual({ tipo: "sessao_iniciada" });
    expect(eventos.map((evento) => evento.tipo)).toEqual(
      expect.arrayContaining(["ferramenta_do_orquestrador", "texto_do_orquestrador", "uso_da_cota"]),
    );
    expect(resultado).toMatchObject({ sucesso: true, resposta: "Girassol" });
  });

  it("a duração do resultado é a de relógio do motor, não a dos instantes gravados na fixture", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    const { resultado } = await executar(new MotorCopilotSdk(fachada), pedido());
    expect(resultado.sucesso && resultado.uso.duracaoMs).toBeLessThan(1_000);
  });

  it("a tabela provisória traduz o apelido do Claude, e o modelo fixo a ignora", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    await executar(new MotorCopilotSdk(fachada), pedido());
    expect(fachada.criadas[0]?.configuracao.modelo).toBe("claude-haiku-5.5");

    const outra = new FachadaFalsa(() => lerFixture("turno-simples"));
    await executar(new MotorCopilotSdk(outra, { modeloFixo: "gpt-6-luna" }), pedido());
    expect(outra.criadas[0]?.configuracao.modelo).toBe("gpt-6-luna");
    // Sem o modelo no catálogo, o esforço segue como está (não dá para validar).
    expect(outra.criadas[0]?.configuracao.esforco).toBe("high");
  });

  it("sem catálogo, o esforço vai como o domínio pediu", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    fachada.catalogoIndisponivel = true;
    await executar(new MotorCopilotSdk(fachada), pedido());
    expect(fachada.criadas[0]?.configuracao.esforco).toBe("high");
  });

  it("o decisor da sessão segue a política do turno: sem terminal no nível leitura, push só com a opção ligada", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    await executar(new MotorCopilotSdk(fachada), pedido({}, "leitura"));
    const decisor = fachada.criadas[0]?.configuracao.decisor;
    expect(decisor?.({ kind: "shell", fullCommandText: "npm test" })).toMatchObject({ aprovada: false });
    expect(decisor?.({ kind: "write", fileName: path.join(realpathSync.native(pastaDoTeste), "artefatos", "o1", "a.md") })).toEqual({
      aprovada: true,
    });

    const comTerminal = new FachadaFalsa(() => lerFixture("turno-simples"));
    await executar(new MotorCopilotSdk(comTerminal), pedido({}, "edicao_e_comandos", true));
    const decisorComTerminal = comTerminal.criadas[0]?.configuracao.decisor;
    expect(comTerminal.criadas[0]?.configuracao.ferramentasLiberadas).toContain("powershell");
    expect(decisorComTerminal?.({ kind: "shell", fullCommandText: "git push origin main" })).toEqual({ aprovada: true });
    expect(decisorComTerminal?.({ kind: "shell", fullCommandText: "git push --force" })).toMatchObject({ aprovada: false });
  });

  it("no planejamento só a pasta de artefatos aceita gravação, mesmo no nível edicao_e_comandos", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    await executar(new MotorCopilotSdk(fachada), pedido({ modo: "planejamento" }, "edicao_e_comandos", true));
    const configuracao = fachada.criadas[0]?.configuracao;
    expect(configuracao?.ferramentasLiberadas).not.toContain("powershell");
    expect(configuracao?.instrucoes).toContain("PLANEJAMENTO");
    expect(configuracao?.decisor({ kind: "shell", fullCommandText: "git status" })).toMatchObject({ aprovada: false });
  });

  it("as instruções personalizadas entram nas instruções da sessão", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    await executar(new MotorCopilotSdk(fachada), pedido({ instrucoes: { texto: "Comece com PIRULITO.", origem: "orquestrador" } }));
    expect(fachada.criadas[0]?.configuracao.instrucoes).toContain("Comece com PIRULITO.");
  });

  it("avisa a cada evento do runtime (no máximo uma vez por segundo) para a vigia do turno", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("streaming-com-ferramenta"));
    let avisos = 0;
    await new MotorCopilotSdk(fachada).executarTurno(pedido(), () => undefined, SEM_SINAL(), () => {
      avisos += 1;
    });
    expect(avisos).toBe(1);
  });
});

describe("MotorCopilotSdk — turnos seguintes", () => {
  it("reusa a sessão viva, sem criar nem retomar, e troca o decisor de permissões pelo do turno", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    const motor = new MotorCopilotSdk(fachada);
    await executar(motor, pedido());
    const sessao = fachada.vivas.get("sessao-1");
    const decisorDoPrimeiro = sessao?.decisor;

    const { resultado } = await executar(motor, pedido({ sessaoIniciada: true, texto: "e agora?" }));

    expect(fachada.criadas).toHaveLength(1);
    expect(fachada.retomadas).toHaveLength(0);
    expect(sessao?.desconectada).toBe(false);
    expect(sessao?.enviados.map((enviado) => enviado.prompt)).toEqual(["leia a nota", "e agora?"]);
    expect(sessao?.decisor).not.toBe(decisorDoPrimeiro);
    expect(resultado.sucesso).toBe(true);
  });

  it("o modo do turno vai nas instruções da sessão: planejar e depois executar retoma a sessão (a retomada fria aplica as instruções novas)", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    const motor = new MotorCopilotSdk(fachada);
    await executar(motor, pedido({ modo: "planejamento" }));
    const planejamento = fachada.vivas.get("sessao-1");

    await executar(motor, pedido({ sessaoIniciada: true, modo: "execucao", texto: "aprovado, execute" }));

    expect(planejamento?.desconectada).toBe(true);
    expect(fachada.retomadas).toHaveLength(1);
    expect(fachada.retomadas[0]?.configuracao.instrucoes).not.toContain("PLANEJAMENTO");
  });

  it("sem sessão viva (o app ou o runtime reiniciou), retoma do disco com a configuração completa", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    const { eventos } = await executar(new MotorCopilotSdk(fachada), pedido({ sessaoIniciada: true }));

    expect(fachada.criadas).toHaveLength(0);
    expect(fachada.retomadas).toHaveLength(1);
    expect(fachada.retomadas[0]?.configuracao).toMatchObject({
      modelo: "claude-haiku-5.5",
      pastasAdicionais: [realpathSync.native(path.join(pastaDoTeste, "artefatos", "o1"))],
    });
    expect(fachada.retomadas[0]?.configuracao.ferramentasLiberadas.length).toBeGreaterThan(0);
    expect(eventos[0]).toEqual({ tipo: "sessao_iniciada" });
  });

  it("mudou o nível entre turnos: solta a sessão viva e a retoma com as ferramentas novas", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    const motor = new MotorCopilotSdk(fachada);
    await executar(motor, pedido({}, "leitura"));
    const primeira = fachada.vivas.get("sessao-1");

    await executar(motor, pedido({ sessaoIniciada: true }, "edicao_e_comandos"));

    expect(primeira?.desconectada).toBe(true);
    expect(fachada.retomadas).toHaveLength(1);
    expect(fachada.retomadas[0]?.configuracao.ferramentasLiberadas).toContain("powershell");
  });

  it("encerrarSessao solta a sessão do runtime", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("turno-simples"));
    const motor = new MotorCopilotSdk(fachada);
    await executar(motor, pedido());
    const sessao = fachada.vivas.get("sessao-1");
    await motor.encerrarSessao("sessao-1");
    expect(sessao?.desconectada).toBe(true);
    expect(fachada.sessaoViva("sessao-1")).toBeNull();
  });
});

describe("MotorCopilotSdk — cancelamento", () => {
  /** A sessão nunca termina sozinha: só o abort (ou a derrubada) a libera. */
  const SEM_FIM: Roteiro = () => [];

  it("session.abort() e o session.idle aborted devolvem a falha de turno interrompido", async () => {
    const fachada = new FachadaFalsa(SEM_FIM);
    const controle = new AbortController();
    const turno = executar(new MotorCopilotSdk(fachada), pedido(), controle.signal);
    await new Promise((resolver) => setTimeout(resolver, 20));
    controle.abort();
    const { resultado } = await turno;

    expect(fachada.vivas.get("sessao-1")?.abortos).toBeGreaterThanOrEqual(1);
    expect(resultado).toMatchObject({ sucesso: false, motivo: "O turno foi interrompido antes de terminar." });
    expect(fachada.derrubou).toBe(0);
  });

  it("com o motivo `silencio` (a autorrecuperação desistiu), resolve causa silencio", async () => {
    const fachada = new FachadaFalsa(SEM_FIM);
    const controle = new AbortController();
    const turno = executar(new MotorCopilotSdk(fachada), pedido(), controle.signal);
    await new Promise((resolver) => setTimeout(resolver, 20));
    controle.abort(ABORTO_POR_SILENCIO);
    const { resultado } = await turno;
    expect(resultado).toMatchObject({ sucesso: false, causa: "silencio" });
  });

  it("se o runtime não responde ao abort, derruba o runtime à força e libera o turno", async () => {
    const fachada = new FachadaFalsa(SEM_FIM);
    fachada.respondeAoAbort = false;
    const controle = new AbortController();
    const turno = executar(new MotorCopilotSdk(fachada, { esperaDoAbortMs: 30 }), pedido(), controle.signal);
    await new Promise((resolver) => setTimeout(resolver, 20));
    controle.abort(ABORTO_POR_SILENCIO);
    const { resultado } = await turno;

    expect(fachada.derrubou).toBe(1);
    expect(resultado).toMatchObject({ sucesso: false, causa: "silencio" });
  });

  it("um sinal já abortado não cria sessão nenhuma", async () => {
    const fachada = new FachadaFalsa(SEM_FIM);
    const controle = new AbortController();
    controle.abort(ABORTO_POR_SILENCIO);
    const { resultado } = await executar(new MotorCopilotSdk(fachada), pedido(), controle.signal);
    expect(fachada.criadas).toHaveLength(0);
    expect(resultado).toMatchObject({ sucesso: false, causa: "silencio", uso: null });
  });
});

describe("MotorCopilotSdk — falhas", () => {
  it("falha ao criar a sessão vira resultado de falha com a mensagem, sem lançar", async () => {
    const fachada = new FachadaFalsa(() => []);
    fachada.falhaAoCriar = new Error("Não foi possível criar a sessão do GitHub Copilot: Not authenticated. Please authenticate first.");
    const { resultado, eventos } = await executar(new MotorCopilotSdk(fachada), pedido());
    expect(resultado).toMatchObject({ sucesso: false, causa: "outro" });
    expect(resultado.sucesso === false && resultado.motivo).toContain("copilot login");
    // A sessão nem nasceu: o domínio não deve marcá-la como iniciada.
    expect(eventos).toEqual([]);
  });

  it("um limite de uso no meio do turno chega como causa limite_de_uso", async () => {
    const fachada = new FachadaFalsa(() => lerFixture("cota-esgotada.sintetica"));
    const { resultado } = await executar(new MotorCopilotSdk(fachada), pedido());
    expect(resultado).toMatchObject({ sucesso: false, causa: "limite_de_uso", liberaEm: "2026-12-01T00:00:00Z" });
  });
});
