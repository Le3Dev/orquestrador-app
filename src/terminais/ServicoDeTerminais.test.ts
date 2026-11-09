import { beforeEach, describe, expect, it } from "vitest";

import { ErroDeTerminal } from "./ErroDeTerminal";
import { AberturaDoPty, ProcessoDoPty, PtyDoTerminal } from "./PtyDoTerminal";
import { ClienteDoTerminal, ServicoDeTerminais } from "./ServicoDeTerminais";

/** Shell de mentira para os testes: registra o que recebe e emite saída e fim sob comando. */
class ProcessoFalso implements ProcessoDoPty {
  readonly escritos: string[] = [];
  readonly tamanhos: Array<[number, number]> = [];
  encerrado = false;
  private readonly ouvintesDaSaida: Array<(dados: string) => void> = [];
  private readonly ouvintesDoFim: Array<(codigo: number | null) => void> = [];

  constructor(readonly abertura: AberturaDoPty) {}

  escrever(dados: string): void {
    this.escritos.push(dados);
  }

  redimensionar(colunas: number, linhas: number): void {
    this.tamanhos.push([colunas, linhas]);
  }

  encerrar(): void {
    this.encerrado = true;
  }

  aoReceber(ouvinte: (dados: string) => void): void {
    this.ouvintesDaSaida.push(ouvinte);
  }

  aoTerminar(ouvinte: (codigo: number | null) => void): void {
    this.ouvintesDoFim.push(ouvinte);
  }

  emitir(dados: string): void {
    for (const ouvinte of this.ouvintesDaSaida) {
      ouvinte(dados);
    }
  }

  terminar(codigo: number | null): void {
    for (const ouvinte of this.ouvintesDoFim) {
      ouvinte(codigo);
    }
  }
}

class PtyFalso implements PtyDoTerminal {
  readonly processos: ProcessoFalso[] = [];

  abrir(abertura: AberturaDoPty): ProcessoFalso {
    const processo = new ProcessoFalso(abertura);
    this.processos.push(processo);
    return processo;
  }

  ultimo(): ProcessoFalso {
    const processo = this.processos[this.processos.length - 1];
    if (processo === undefined) {
      throw new Error("Nenhum processo aberto.");
    }
    return processo;
  }
}

class ClienteFalso implements ClienteDoTerminal {
  readonly saidas: string[] = [];
  readonly fins: Array<number | null> = [];

  saida(dados: string): void {
    this.saidas.push(dados);
  }

  fim(codigo: number | null): void {
    this.fins.push(codigo);
  }
}

describe("ServicoDeTerminais", () => {
  let pty: PtyFalso;
  let servico: ServicoDeTerminais;
  let ids: number;

  function criar(opcoes: { limite?: number; tamanhoDoHistorico?: number } = {}): ServicoDeTerminais {
    return new ServicoDeTerminais({
      pty,
      gerarId: () => `t-${++ids}`,
      agora: () => new Date("2026-11-07T10:00:00Z"),
      ...opcoes,
    });
  }

  const pedido = { pasta: "/projetos/app", orquestradorId: null, colunas: 80, linhas: 24 };

  beforeEach(() => {
    pty = new PtyFalso();
    ids = 0;
    servico = criar();
  });

  it("abre o shell na pasta e no tamanho pedidos e lista o terminal", () => {
    const terminal = servico.abrir({ ...pedido, orquestradorId: "orq-1" });

    expect(terminal).toEqual({
      id: "t-1",
      pasta: "/projetos/app",
      orquestradorId: "orq-1",
      criadoEm: "2026-11-07T10:00:00.000Z",
    });
    expect(pty.ultimo().abertura).toEqual({ pasta: "/projetos/app", colunas: 80, linhas: 24 });
    expect(servico.listar()).toEqual([terminal]);
    expect(servico.existe("t-1")).toBe(true);
  });

  it("ao remover um Orquestrador, encerra só os terminais ligados a ele", () => {
    const cliente = new ClienteFalso();
    const doOrquestrador = servico.abrir({ ...pedido, orquestradorId: "orq-1" });
    const outro = servico.abrir({ ...pedido, orquestradorId: "orq-2" });
    const solto = servico.abrir(pedido);
    const tambemDoOrquestrador = servico.abrir({ ...pedido, orquestradorId: "orq-1" });
    servico.conectar(doOrquestrador.id, cliente);

    expect(servico.encerrarDoOrquestrador("orq-1")).toBe(2);

    expect(pty.processos.map((processo) => processo.encerrado)).toEqual([true, false, false, true]);
    expect(servico.listar().map((terminal) => terminal.id)).toEqual([outro.id, solto.id]);
    expect(servico.existe(tambemDoOrquestrador.id)).toBe(false);
    expect(cliente.fins).toEqual([null]);
    expect(servico.encerrarDoOrquestrador("orq-1")).toBe(0);
  });

  it("recusa o sétimo terminal e libera a vaga quando um é fechado", () => {
    for (let i = 0; i < 6; i++) {
      servico.abrir(pedido);
    }

    expect(() => servico.abrir(pedido)).toThrowError(ErroDeTerminal);
    try {
      servico.abrir(pedido);
    } catch (erro) {
      expect((erro as ErroDeTerminal).motivo).toBe("limite_atingido");
      expect((erro as ErroDeTerminal).message).toBe("Já há 6 terminais abertos. Feche um deles para abrir outro.");
    }
    expect(pty.processos).toHaveLength(6);

    servico.encerrar("t-1");
    expect(servico.abrir(pedido).id).toBe("t-7");
  });

  it("reenvia só o fim recente da saída (buffer circular) a quem conecta, depois o ao vivo", () => {
    servico = criar({ tamanhoDoHistorico: 10 });
    servico.abrir(pedido);
    pty.ultimo().emitir("abcdef");
    pty.ultimo().emitir("ghijkl");

    const cliente = new ClienteFalso();
    servico.conectar("t-1", cliente);
    expect(cliente.saidas).toEqual(["cdefghijkl"]);

    pty.ultimo().emitir("mn");
    expect(cliente.saidas).toEqual(["cdefghijkl", "mn"]);

    const outro = new ClienteFalso();
    servico.conectar("t-1", outro);
    expect(outro.saidas).toEqual(["efghijklmn"]);
  });

  it("descarta trechos inteiros quando um só ultrapassa o tamanho do histórico", () => {
    servico = criar({ tamanhoDoHistorico: 4 });
    servico.abrir(pedido);
    pty.ultimo().emitir("ab");
    pty.ultimo().emitir("0123456789");

    const cliente = new ClienteFalso();
    servico.conectar("t-1", cliente);
    expect(cliente.saidas).toEqual(["6789"]);
  });

  it("sem saída ainda, conectar não envia histórico vazio", () => {
    servico.abrir(pedido);
    const cliente = new ClienteFalso();
    servico.conectar("t-1", cliente);
    expect(cliente.saidas).toEqual([]);
  });

  it("entrega a saída a todas as conexões, e a quem desconectou não", () => {
    servico.abrir(pedido);
    const a = new ClienteFalso();
    const b = new ClienteFalso();
    servico.conectar("t-1", a);
    const conexaoB = servico.conectar("t-1", b);

    pty.ultimo().emitir("oi");
    conexaoB?.desconectar();
    pty.ultimo().emitir("tchau");

    expect(a.saidas).toEqual(["oi", "tchau"]);
    expect(b.saidas).toEqual(["oi"]);
  });

  it("repassa a entrada e o tamanho ao shell", () => {
    servico.abrir(pedido);
    const conexao = servico.conectar("t-1", new ClienteFalso());

    conexao?.escrever("ls\r");
    conexao?.redimensionar(120, 40);

    expect(pty.ultimo().escritos).toEqual(["ls\r"]);
    expect(pty.ultimo().tamanhos).toEqual([[120, 40]]);
  });

  it("quando o shell termina, avisa o fim às conexões e depois tira o terminal da lista", () => {
    servico.abrir(pedido);
    const cliente = new ClienteFalso();
    const listaNoFim: number[] = [];
    servico.conectar("t-1", {
      saida: () => undefined,
      fim: () => listaNoFim.push(servico.listar().length),
    });
    const conexao = servico.conectar("t-1", cliente);

    pty.ultimo().terminar(3);

    expect(cliente.fins).toEqual([3]);
    // Ainda estava na lista quando o fim foi enviado.
    expect(listaNoFim).toEqual([1]);
    expect(servico.listar()).toEqual([]);
    expect(servico.conectar("t-1", new ClienteFalso())).toBeNull();

    conexao?.escrever("depois do fim");
    pty.ultimo().emitir("saída tardia");
    expect(pty.ultimo().escritos).toEqual([]);
    expect(cliente.saidas).toEqual([]);
  });

  it("encerrar mata o shell, avisa o fim uma vez só e tira da lista", () => {
    servico.abrir(pedido);
    const cliente = new ClienteFalso();
    servico.conectar("t-1", cliente);

    servico.encerrar("t-1");
    pty.ultimo().terminar(0);

    expect(pty.ultimo().encerrado).toBe(true);
    expect(cliente.fins).toEqual([null]);
    expect(servico.listar()).toEqual([]);
  });

  it("encerrar um terminal que não existe é nao_encontrado", () => {
    expect(() => servico.encerrar("nada")).toThrowError(
      expect.objectContaining({ motivo: "nao_encontrado" }) as unknown as Error,
    );
  });

  it("encerrarTodos mata todos os shells e devolve quantos eram", () => {
    servico.abrir(pedido);
    servico.abrir(pedido);

    expect(servico.encerrarTodos()).toBe(2);
    expect(pty.processos.every((processo) => processo.encerrado)).toBe(true);
    expect(servico.listar()).toEqual([]);
    expect(servico.encerrarTodos()).toBe(0);
  });

  it("uma conexão que falha não impede as outras de receberem", () => {
    servico.abrir(pedido);
    const boa = new ClienteFalso();
    servico.conectar("t-1", {
      saida: () => {
        throw new Error("socket quebrado");
      },
      fim: () => undefined,
    });
    servico.conectar("t-1", boa);

    pty.ultimo().emitir("x");
    expect(boa.saidas).toEqual(["x"]);
  });
});
