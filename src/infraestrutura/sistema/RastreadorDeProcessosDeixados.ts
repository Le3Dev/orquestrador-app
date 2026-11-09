import { homedir } from "node:os";

import { descendentesVivos, formasDaPasta, mesmoProcesso, ProcessoNaArvore } from "./ArvoreDeProcessos";
import { encerrarProcesso, listarArvore } from "./Processos";
import { RegistroDeProcessos } from "./RegistroDeProcessos";
import { ProcessoDeixado, RegistroDeProcessosDeixados } from "./RegistroDeProcessosDeixados";

/**
 * O que a fachada do Claude Code avisa sobre cada processo que inicia: quando
 * nasce, quando chega um `result` (o fim do turno, com o processo ainda vivo)
 * e quando termina.
 */
export interface AcompanhamentoDeProcessos {
  iniciou(raiz: { pid: number; orquestradorId: string; pasta: string }): void;
  resultadoChegou(pid: number): void;
  terminou(pid: number): void;
}

export interface DependenciasDoRastreador {
  deixados: RegistroDeProcessosDeixados;
  /** Os Claude Code em execução: nunca encerrados por aqui (o cancelamento cuida deles). */
  agentes: RegistroDeProcessos;
  listar?: () => Promise<ProcessoNaArvore[]>;
  encerrar?: (pid: number) => Promise<void>;
  /** Nunca encerrados: o próprio servidor e quem o iniciou (o Electron). */
  protegidos?: readonly number[];
  /** O servidor, para reconhecer os shells dos terminais do canvas e o que eles abrem. */
  pidDoServidor?: number;
  pastaDoUsuario?: string;
  /** Intervalo das listagens enquanto há turno rodando. */
  intervaloMs?: number;
  /** Espera depois que o Claude Code sai, para os filhos que morrem junto com ele saírem. */
  esperaDaListagemFinalMs?: number;
  agora?: () => number;
  esperar?: (milissegundos: number) => Promise<void>;
}

/** No Windows a listagem custa 1–2 s de PowerShell; no Mac/Linux o `ps` é barato. */
export const INTERVALO_DAS_LISTAGENS_MS = process.platform === "win32" ? 30_000 : 5_000;
/** Mais de um `result` por turno (subagentes em segundo plano): no máximo uma listagem extra a cada 10 s. */
const ESPACO_ENTRE_LISTAGENS_POR_RESULTADO_MS = 10_000;
/** Até quanto a criação do Claude Code pode diferir do instante em que o servidor o iniciou. */
const FOLGA_DO_INICIO_MS = 10_000;

interface Acompanhado {
  raiz: ProcessoNaArvore;
  /** Instante em que o servidor iniciou o processo, para achá-lo na listagem. */
  iniciadoEm: number;
  raizConfirmada: boolean;
  orquestradorId: string;
  formas: string[] | null;
  /** Todos os descendentes já vistos, vivos ou não (pais possíveis). */
  vistos: Map<number, ProcessoNaArvore>;
  /** Os descendentes vivos na última listagem. */
  vivos: ProcessoNaArvore[];
  ativo: boolean;
  /** O Orquestrador foi removido enquanto o turno terminava: encerra em vez de registrar. */
  encerrarAoTerminar: boolean;
}

function paraDeixado(processo: ProcessoNaArvore, orquestradorId: string): ProcessoDeixado {
  return {
    pid: processo.pid,
    criadoEm: processo.criadoEm,
    nome: processo.nome,
    comando: processo.comando,
    orquestradorId,
  };
}

/**
 * Acha e encerra os processos que os agentes deixam rodando depois do turno
 * (`nohup npm run dev &`, `Start-Process`, um watch): eles saem da árvore do
 * Claude Code quando o shell intermediário termina, e o `taskkill /T` do
 * cancelamento não os alcança.
 *
 * Lista a árvore no fim de cada turno (no `result`, com o Claude Code ainda
 * vivo, e logo depois que ele sai) e a cada `intervaloMs` enquanto há turno
 * rodando. Os sobreviventes vão para o `RegistroDeProcessosDeixados`, ligados
 * ao Orquestrador, e são encerrados ao removê-lo, ao fechar o app e, se o
 * servidor caiu, na subida seguinte.
 */
export class RastreadorDeProcessosDeixados implements AcompanhamentoDeProcessos {
  private readonly acompanhados = new Map<number, Acompanhado>();
  private readonly alheiosVistos = new Map<number, ProcessoNaArvore>();
  private readonly listar: () => Promise<ProcessoNaArvore[]>;
  private readonly encerrarUm: (pid: number) => Promise<void>;
  private readonly agora: () => number;
  private readonly esperar: (milissegundos: number) => Promise<void>;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private emAndamento: Promise<void> | null = null;
  private pendente: Promise<void> | null = null;
  private ultimaListagemEm = Number.NEGATIVE_INFINITY;

  constructor(private readonly dependencias: DependenciasDoRastreador) {
    this.listar = dependencias.listar ?? listarArvore;
    this.encerrarUm = dependencias.encerrar ?? encerrarProcesso;
    this.agora = dependencias.agora ?? Date.now;
    this.esperar =
      dependencias.esperar ?? ((milissegundos) => new Promise((resolver) => setTimeout(resolver, milissegundos)));
  }

  iniciou(raiz: { pid: number; orquestradorId: string; pasta: string }): void {
    const agora = this.agora();
    this.acompanhados.set(raiz.pid, {
      raiz: {
        pid: raiz.pid,
        ppid: -1,
        criadoEm: agora,
        nome: "",
        comando: "",
        // No Mac/Linux o Claude Code nasce líder de um grupo próprio (`detached`).
        grupo: process.platform === "win32" ? null : raiz.pid,
      },
      iniciadoEm: agora,
      raizConfirmada: false,
      orquestradorId: raiz.orquestradorId,
      formas: formasDaPasta(raiz.pasta, this.dependencias.pastaDoUsuario ?? homedir()),
      vistos: new Map(),
      vivos: [],
      ativo: true,
      encerrarAoTerminar: false,
    });
    this.ligarIntervalo();
  }

  resultadoChegou(pid: number): void {
    if (!this.acompanhados.has(pid) || this.agora() - this.ultimaListagemEm < ESPACO_ENTRE_LISTAGENS_POR_RESULTADO_MS) {
      return;
    }
    void this.listarAgora();
  }

  terminou(pid: number): void {
    void this.finalizar(pid).catch((erro: unknown) =>
      console.warn("[processos] Falha ao conferir o que o agente deixou rodando:", erro),
    );
  }

  /** Para a fachada e os testes: a listagem final de um turno que terminou. */
  async finalizar(pid: number): Promise<void> {
    const acompanhado = this.acompanhados.get(pid);
    // Inativo: a listagem final já foi pedida (o `error` e o `close` podem vir juntos).
    if (acompanhado === undefined || !acompanhado.ativo) {
      return;
    }
    acompanhado.ativo = false;
    await this.esperar(this.dependencias.esperaDaListagemFinalMs ?? 2_000);
    await this.listarAgora();
    this.acompanhados.delete(pid);
    this.desligarIntervaloSeOcioso();
    if (acompanhado.encerrarAoTerminar) {
      await Promise.all(acompanhado.vivos.map((processo) => this.encerrarUm(processo.pid)));
      return;
    }
    this.dependencias.deixados.registrar(
      acompanhado.vivos.map((processo) => paraDeixado(processo, acompanhado.orquestradorId)),
    );
  }

  /**
   * Os pids de cada dono (Orquestrador ou "chat") para somar a memória: os
   * descendentes vivos dos turnos em andamento na última listagem e os
   * processos deixados registrados. Os Claude Code em si vêm do registro deles.
   */
  pidsPorOrquestrador(): Map<string, Set<number>> {
    const grupos = new Map<string, Set<number>>();
    const juntar = (orquestradorId: string, pid: number): void => {
      const grupo = grupos.get(orquestradorId) ?? new Set<number>();
      grupo.add(pid);
      grupos.set(orquestradorId, grupo);
    };
    for (const acompanhado of this.acompanhados.values()) {
      for (const processo of acompanhado.vivos) {
        juntar(acompanhado.orquestradorId, processo.pid);
      }
    }
    for (const processo of this.dependencias.deixados.todos()) {
      juntar(processo.orquestradorId, processo.pid);
    }
    return grupos;
  }

  /** Ao remover o Orquestrador. Devolve quantos processos foram encerrados. */
  encerrarDoOrquestrador(orquestradorId: string): Promise<number> {
    return this.encerrar((dono) => dono === orquestradorId);
  }

  /** Ao fechar o app e, na subida, para o que o servidor anterior deixou. */
  encerrarTodos(): Promise<number> {
    return this.encerrar(() => true);
  }

  parar(): void {
    if (this.intervalo !== null) {
      clearInterval(this.intervalo);
      this.intervalo = null;
    }
  }

  /** Uma listagem por vez; pedidos durante uma listagem viram uma só, logo depois. */
  listarAgora(): Promise<void> {
    if (this.pendente !== null) {
      return this.pendente;
    }
    if (this.emAndamento !== null) {
      this.pendente = this.emAndamento.then(() => {
        this.pendente = null;
        return this.rodar();
      });
      return this.pendente;
    }
    return this.rodar();
  }

  private rodar(): Promise<void> {
    this.emAndamento = this.atualizar().finally(() => {
      this.emAndamento = null;
    });
    return this.emAndamento;
  }

  private protegidos(): Set<number> {
    return new Set([
      ...(this.dependencias.protegidos ?? []),
      ...this.dependencias.agentes.emExecucao().map((processo) => processo.pid),
    ]);
  }

  private async atualizar(): Promise<void> {
    let arvore: ProcessoNaArvore[];
    try {
      arvore = await this.listar();
    } catch (erro) {
      console.warn("[processos] Não foi possível listar os processos:", erro);
      return;
    }
    this.ultimaListagemEm = this.agora();
    if (arvore.length === 0) {
      return;
    }
    const protegidos = this.protegidos();
    const alheios = this.atualizarAlheios(arvore, protegidos);

    for (const acompanhado of this.acompanhados.values()) {
      if (!acompanhado.raizConfirmada) {
        const raiz = arvore.find(
          (processo) =>
            processo.pid === acompanhado.raiz.pid &&
            Math.abs(processo.criadoEm - acompanhado.iniciadoEm) <= FOLGA_DO_INICIO_MS,
        );
        if (raiz !== undefined) {
          acompanhado.raiz = raiz;
          acompanhado.raizConfirmada = true;
        }
      }
      acompanhado.vivos = descendentesVivos({
        raiz: acompanhado.raiz,
        arvore,
        vistos: [...acompanhado.vistos.values()],
        protegidos,
        adocao: acompanhado.formas === null ? null : { formasDaPasta: acompanhado.formas, ate: this.agora() },
        alheios,
      });
      for (const processo of acompanhado.vivos) {
        acompanhado.vistos.set(processo.pid, processo);
      }
    }

    // Os que morreram sozinhos (ou foram parados pelo agente) saem do registro.
    this.dependencias.deixados.manterSo((deixado) => arvore.some((processo) => mesmoProcesso(processo, deixado)));
  }

  /** O que o próprio servidor abriu fora dos Claude Code (os shells dos terminais do canvas). */
  private atualizarAlheios(arvore: readonly ProcessoNaArvore[], protegidos: ReadonlySet<number>): ProcessoNaArvore[] {
    const pidDoServidor = this.dependencias.pidDoServidor;
    const servidor = arvore.find((processo) => processo.pid === pidDoServidor);
    if (servidor === undefined) {
      return [...this.alheiosVistos.values()];
    }
    const doServidor = descendentesVivos({
      raiz: { ...servidor, grupo: null },
      arvore,
      vistos: [...this.alheiosVistos.values()],
      protegidos,
      adocao: null,
    });
    for (const processo of doServidor) {
      this.alheiosVistos.set(processo.pid, processo);
    }
    return [...this.alheiosVistos.values()];
  }

  private async encerrar(doDono: (orquestradorId: string) => boolean): Promise<number> {
    const registrados = this.dependencias.deixados.todos().filter((processo) => doDono(processo.orquestradorId));
    const acompanhados = [...this.acompanhados.values()].filter((acompanhado) => doDono(acompanhado.orquestradorId));
    for (const acompanhado of acompanhados) {
      acompanhado.encerrarAoTerminar = true;
    }
    if (registrados.length === 0 && acompanhados.every((acompanhado) => acompanhado.vistos.size === 0)) {
      return 0;
    }

    let arvore: ProcessoNaArvore[];
    try {
      arvore = await this.listar();
    } catch (erro) {
      // Sem a listagem não dá para conferir se os pids ainda são os mesmos: não encerra nada.
      console.warn("[processos] Não foi possível listar os processos para encerrar:", erro);
      return 0;
    }
    const protegidos = this.protegidos();
    const conhecidos = [...registrados, ...acompanhados.flatMap((acompanhado) => [...acompanhado.vistos.values()])];
    const alvos = new Map<number, ProcessoNaArvore>();
    for (const conhecido of conhecidos) {
      const vivo = arvore.find((processo) => mesmoProcesso(processo, conhecido));
      if (vivo !== undefined) {
        alvos.set(vivo.pid, vivo);
      }
    }
    // O que eles abriram depois da última listagem também vai.
    for (const alvo of [...alvos.values()]) {
      for (const filho of descendentesVivos({
        raiz: { ...alvo, grupo: null },
        arvore,
        vistos: [],
        protegidos,
        adocao: null,
      })) {
        alvos.set(filho.pid, filho);
      }
    }
    for (const pid of protegidos) {
      alvos.delete(pid);
    }

    await Promise.all([...alvos.keys()].map((pid) => this.encerrarUm(pid)));
    this.dependencias.deixados.manterSo((processo) => !doDono(processo.orquestradorId));
    return alvos.size;
  }

  private ligarIntervalo(): void {
    if (this.intervalo !== null) {
      return;
    }
    this.intervalo = setInterval(
      () => void this.listarAgora(),
      this.dependencias.intervaloMs ?? INTERVALO_DAS_LISTAGENS_MS,
    );
    this.intervalo.unref();
  }

  private desligarIntervaloSeOcioso(): void {
    if ([...this.acompanhados.values()].every((acompanhado) => !acompanhado.ativo)) {
      this.parar();
    }
  }
}
