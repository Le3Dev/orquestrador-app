import { ErroDeTerminal, MENSAGEM_DE_TERMINAL_NAO_ENCONTRADO } from "./ErroDeTerminal";
import { ProcessoDoPty, PtyDoTerminal } from "./PtyDoTerminal";

export const LIMITE_DE_TERMINAIS = 6;

/** Quanto da saída recente cada terminal guarda para reenviar a quem conecta (~200 KB). */
export const TAMANHO_DO_HISTORICO = 200 * 1024;

/** O que a tela recebe de cada terminal aberto. */
export interface DadosDoTerminal {
  id: string;
  pasta: string;
  orquestradorId: string | null;
  /** ISO 8601 */
  criadoEm: string;
}

export interface PedidoDeTerminal {
  pasta: string;
  orquestradorId: string | null;
  colunas: number;
  linhas: number;
}

/** Quem acompanha um terminal (uma conexão da tela). */
export interface ClienteDoTerminal {
  saida(dados: string): void;
  fim(codigo: number | null): void;
}

/** O que uma conexão pode fazer com o terminal em que está ligada. */
export interface ConexaoDoTerminal {
  escrever(dados: string): void;
  redimensionar(colunas: number, linhas: number): void;
  desconectar(): void;
}

interface Dependencias {
  pty: PtyDoTerminal;
  gerarId: () => string;
  agora: () => Date;
  limite?: number;
  tamanhoDoHistorico?: number;
}

/**
 * Buffer circular da saída: guarda só os últimos `limite` caracteres. As
 * partes pequenas (cada tecla ecoa uma) são juntadas de tempos em tempos.
 */
class HistoricoDaSaida {
  private partes: string[] = [];
  private tamanho = 0;

  constructor(private readonly limite: number) {}

  adicionar(texto: string): void {
    if (texto === "") {
      return;
    }
    this.partes.push(texto);
    this.tamanho += texto.length;
    while (this.tamanho > this.limite && this.partes.length > 0) {
      const primeira = this.partes[0] ?? "";
      const excesso = this.tamanho - this.limite;
      if (primeira.length <= excesso) {
        this.partes.shift();
        this.tamanho -= primeira.length;
      } else {
        this.partes[0] = primeira.slice(excesso);
        this.tamanho -= excesso;
      }
    }
    if (this.partes.length > 512) {
      this.partes = [this.partes.join("")];
    }
  }

  texto(): string {
    return this.partes.join("");
  }
}

interface TerminalAberto {
  dados: DadosDoTerminal;
  processo: ProcessoDoPty;
  historico: HistoricoDaSaida;
  clientes: Set<ClienteDoTerminal>;
  terminado: boolean;
}

/**
 * Terminais interativos do canvas: um shell por terminal, vivo enquanto o
 * servidor estiver no ar (não sobrevive a um reinício). Mais de uma tela pode
 * acompanhar o mesmo terminal; todas recebem a saída.
 */
export class ServicoDeTerminais {
  private readonly terminais = new Map<string, TerminalAberto>();
  private readonly pty: PtyDoTerminal;
  private readonly gerarId: () => string;
  private readonly agora: () => Date;
  private readonly limite: number;
  private readonly tamanhoDoHistorico: number;

  constructor(dependencias: Dependencias) {
    this.pty = dependencias.pty;
    this.gerarId = dependencias.gerarId;
    this.agora = dependencias.agora;
    this.limite = dependencias.limite ?? LIMITE_DE_TERMINAIS;
    this.tamanhoDoHistorico = dependencias.tamanhoDoHistorico ?? TAMANHO_DO_HISTORICO;
  }

  listar(): DadosDoTerminal[] {
    return [...this.terminais.values()].map((terminal) => ({ ...terminal.dados }));
  }

  existe(id: string): boolean {
    return this.terminais.has(id);
  }

  abrir(pedido: PedidoDeTerminal): DadosDoTerminal {
    if (this.terminais.size >= this.limite) {
      throw new ErroDeTerminal(
        "limite_atingido",
        `Já há ${this.limite} terminais abertos. Feche um deles para abrir outro.`,
      );
    }

    const processo = this.pty.abrir({ pasta: pedido.pasta, colunas: pedido.colunas, linhas: pedido.linhas });
    const terminal: TerminalAberto = {
      dados: {
        id: this.gerarId(),
        pasta: pedido.pasta,
        orquestradorId: pedido.orquestradorId,
        criadoEm: this.agora().toISOString(),
      },
      processo,
      historico: new HistoricoDaSaida(this.tamanhoDoHistorico),
      clientes: new Set(),
      terminado: false,
    };
    this.terminais.set(terminal.dados.id, terminal);

    processo.aoReceber((dados) => {
      if (terminal.terminado) {
        return;
      }
      terminal.historico.adicionar(dados);
      for (const cliente of terminal.clientes) {
        entregar(() => cliente.saida(dados));
      }
    });
    processo.aoTerminar((codigo) => this.finalizar(terminal, codigo));

    return { ...terminal.dados };
  }

  /**
   * Liga uma conexão ao terminal: reenvia o histórico recente e, dali em
   * diante, a saída ao vivo. Null quando o terminal não existe (mais).
   */
  conectar(id: string, cliente: ClienteDoTerminal): ConexaoDoTerminal | null {
    const terminal = this.terminais.get(id);
    if (terminal === undefined || terminal.terminado) {
      return null;
    }
    const historico = terminal.historico.texto();
    if (historico !== "") {
      entregar(() => cliente.saida(historico));
    }
    terminal.clientes.add(cliente);

    return {
      escrever: (dados) => {
        if (!terminal.terminado) {
          terminal.processo.escrever(dados);
        }
      },
      redimensionar: (colunas, linhas) => {
        if (terminal.terminado) {
          return;
        }
        try {
          terminal.processo.redimensionar(colunas, linhas);
        } catch {
          // O shell pode ter saído entre a mensagem e o ajuste.
        }
      },
      desconectar: () => {
        terminal.clientes.delete(cliente);
      },
    };
  }

  /** Mata o shell e tira o terminal da lista na hora. */
  encerrar(id: string): void {
    const terminal = this.terminais.get(id);
    if (terminal === undefined) {
      throw new ErroDeTerminal("nao_encontrado", MENSAGEM_DE_TERMINAL_NAO_ENCONTRADO);
    }
    this.matar(terminal);
  }

  /** No desligamento do servidor. Devolve quantos estavam abertos. */
  encerrarTodos(): number {
    const abertos = [...this.terminais.values()];
    for (const terminal of abertos) {
      this.matar(terminal);
    }
    return abertos.length;
  }

  private matar(terminal: TerminalAberto): void {
    try {
      terminal.processo.encerrar();
    } catch (erro) {
      console.warn("[terminais] Falha ao encerrar o shell:", erro);
    }
    this.finalizar(terminal, null);
  }

  /** Avisa as conexões do fim e só depois tira o terminal da lista. Idempotente. */
  private finalizar(terminal: TerminalAberto, codigo: number | null): void {
    if (terminal.terminado) {
      return;
    }
    terminal.terminado = true;
    for (const cliente of terminal.clientes) {
      entregar(() => cliente.fim(codigo));
    }
    terminal.clientes.clear();
    if (this.terminais.get(terminal.dados.id) === terminal) {
      this.terminais.delete(terminal.dados.id);
    }
  }
}

/** Uma conexão com problema não pode impedir as outras de receberem. */
function entregar(envio: () => void): void {
  try {
    envio();
  } catch (erro) {
    console.warn("[terminais] Falha ao entregar a saída a uma conexão:", erro);
  }
}
