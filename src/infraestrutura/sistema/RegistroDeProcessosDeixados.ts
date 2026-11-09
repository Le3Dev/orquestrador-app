import { readFileSync, writeFileSync } from "node:fs";

/**
 * Um processo que um agente deixou rodando depois do turno (um servidor de
 * desenvolvimento, um watch, um navegador de teste). A criação e a linha de
 * comando gravadas permitem conferir, antes de encerrar, que o pid ainda é o
 * mesmo processo.
 */
export interface ProcessoDeixado {
  pid: number;
  /** Instante de criação, em milissegundos desde 1970. */
  criadoEm: number;
  nome: string;
  comando: string;
  /** O Orquestrador (ou "chat") cujo turno deixou o processo. */
  orquestradorId: string;
}

function ehProcessoDeixado(valor: unknown): valor is ProcessoDeixado {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const { pid, criadoEm, nome, comando, orquestradorId } = valor as Record<string, unknown>;
  return (
    typeof pid === "number" &&
    typeof criadoEm === "number" &&
    typeof nome === "string" &&
    typeof comando === "string" &&
    typeof orquestradorId === "string"
  );
}

/**
 * Os processos deixados pelos agentes, por Orquestrador, gravados em disco
 * (`processos-deixados-pelos-agentes.json`, irmão do
 * `processos-em-execucao.json`) a cada mudança. Ao contrário do registro dos
 * Claude Code, este carrega o arquivo ao abrir: se o servidor caiu, o próximo
 * precisa saber o que ficou rodando para encerrar.
 */
export class RegistroDeProcessosDeixados {
  private readonly processos: ProcessoDeixado[];

  constructor(private readonly arquivo: string | null = null) {
    this.processos = arquivo === null ? [] : RegistroDeProcessosDeixados.lerArquivo(arquivo);
  }

  /** Acrescenta os processos; um pid já registrado é substituído. */
  registrar(novos: readonly ProcessoDeixado[]): void {
    if (novos.length === 0) {
      return;
    }
    const pids = new Set(novos.map((processo) => processo.pid));
    this.trocar([...this.processos.filter((processo) => !pids.has(processo.pid)), ...novos]);
  }

  todos(): ProcessoDeixado[] {
    return [...this.processos];
  }

  doOrquestrador(orquestradorId: string): ProcessoDeixado[] {
    return this.processos.filter((processo) => processo.orquestradorId === orquestradorId);
  }

  /** Tira os que não passam no filtro (os que já morreram, os já encerrados). */
  manterSo(filtro: (processo: ProcessoDeixado) => boolean): void {
    const mantidos = this.processos.filter(filtro);
    if (mantidos.length !== this.processos.length) {
      this.trocar(mantidos);
    }
  }

  static lerArquivo(arquivo: string): ProcessoDeixado[] {
    try {
      const conteudo: unknown = JSON.parse(readFileSync(arquivo, "utf8"));
      return Array.isArray(conteudo) ? conteudo.filter(ehProcessoDeixado) : [];
    } catch {
      return [];
    }
  }

  private trocar(processos: ProcessoDeixado[]): void {
    this.processos.splice(0, this.processos.length, ...processos);
    if (this.arquivo === null) {
      return;
    }
    try {
      writeFileSync(this.arquivo, JSON.stringify(this.processos, null, 2), "utf8");
    } catch (erro) {
      console.warn("[processos] Não foi possível gravar a lista de processos deixados pelos agentes:", erro);
    }
  }
}
