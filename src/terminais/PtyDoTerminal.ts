/** O que é preciso para abrir o shell de um terminal. */
export interface AberturaDoPty {
  /** Pasta em que o shell começa (já validada). */
  pasta: string;
  colunas: number;
  linhas: number;
}

/** Um shell rodando num pseudoterminal. */
export interface ProcessoDoPty {
  escrever(dados: string): void;
  redimensionar(colunas: number, linhas: number): void;
  /** Mata o shell. Pode ser chamado mais de uma vez. */
  encerrar(): void;
  aoReceber(ouvinte: (dados: string) => void): void;
  /** `codigo` é null quando o processo foi morto por sinal. */
  aoTerminar(ouvinte: (codigo: number | null) => void): void;
}

/**
 * Porta para o pseudoterminal do sistema. O adaptador real usa o node-pty
 * (src/infraestrutura/sistema/PtyDoSistema.ts); os testes usam um falso.
 */
export interface PtyDoTerminal {
  abrir(abertura: AberturaDoPty): ProcessoDoPty;
}
