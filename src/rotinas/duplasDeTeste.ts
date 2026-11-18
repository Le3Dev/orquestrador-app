import { ControleDeExecucoesDeRotinas } from "./ControleDeExecucoesDeRotinas";
import { DadosDaEtapa } from "./EtapaDaRotina";
import { EventoDeRotina, PublicadorDeRotinas } from "./EventoDeRotina";
import { DadosDaExecucao, ExecucaoDaRotina } from "./ExecucaoDaRotina";
import { ExecutorDePedidos, PedidoDaRotina, ResultadoDoPedidoDaRotina } from "./ExecutorDePedidos";
import { DiaDoCalendario, FusoHorario } from "./Gatilho";
import { RepositorioDeExecucoes } from "./RepositorioDeExecucoes";
import { RepositorioDeRotinas } from "./RepositorioDeRotinas";
import { DadosDaRotina, Rotina } from "./Rotina";
import { PedidoDeRotina, ServicoDeRotinas } from "./ServicoDeRotinas";
import { Temporizador } from "./Temporizador";

/** Só para os testes: os dublês do relógio, do executor, dos repositórios e do serviço montado com eles. */

/** Deixa rodar tudo o que está pendente nas filas de microtarefas (as gravações e esperas em memória). */
export function esvaziarFilas(): Promise<void> {
  return new Promise((resolver) => setImmediate(resolver));
}

/** Para os testes: o valor que tem de existir, sem `!`. */
export function exigir<T>(valor: T | null | undefined): T {
  if (valor === null || valor === undefined) {
    throw new Error("Esperava um valor, mas veio vazio.");
  }
  return valor;
}

/** Relógio e temporizador de mentira: o tempo só anda quando o teste manda. */
export class RelogioFalso implements Temporizador {
  private instante: number;
  private proximoNumero = 0;
  private readonly avisos = new Map<number, { quando: number; aoVencer: () => void }>();

  constructor(inicio: Date) {
    this.instante = inicio.getTime();
  }

  readonly agora = (): Date => new Date(this.instante);

  agendar(aoVencer: () => void, ms: number): () => void {
    const numero = ++this.proximoNumero;
    this.avisos.set(numero, { quando: this.instante + ms, aoVencer });
    return () => {
      this.avisos.delete(numero);
    };
  }

  get avisosPendentes(): number {
    return this.avisos.size;
  }

  /** O relógio pula (o computador dormiu) sem disparar nada: os avisos que ficaram para trás vencem no próximo `avancar`. */
  saltar(ms: number): void {
    this.instante += ms;
  }

  /** Anda no tempo, disparando os avisos que vencerem no caminho, na ordem, deixando as filas esvaziarem entre eles. */
  async avancar(ms: number): Promise<void> {
    const alvo = this.instante + ms;
    for (;;) {
      const proximo = [...this.avisos.entries()]
        .filter(([, aviso]) => aviso.quando <= alvo)
        .sort(([numeroA, a], [numeroB, b]) => a.quando - b.quando || numeroA - numeroB)[0];
      if (proximo === undefined) {
        break;
      }
      const [numero, aviso] = proximo;
      this.avisos.delete(numero);
      this.instante = Math.max(this.instante, aviso.quando);
      aviso.aoVencer();
      await esvaziarFilas();
    }
    this.instante = alvo;
    await esvaziarFilas();
  }
}

export type RespostaDoExecutor = ResultadoDoPedidoDaRotina | Error;

interface Pendente {
  resolver: (resultado: ResultadoDoPedidoDaRotina) => void;
}

/**
 * O Orquestrador de mentira. Cada pedido recebe a próxima resposta preparada;
 * sem resposta preparada, fica pendente até o teste chamar `responder`. O
 * sinal abortado resolve o pedido pendente como cancelado, como faria o de verdade.
 */
export class ExecutorFalso implements ExecutorDePedidos {
  readonly pedidos: PedidoDaRotina[] = [];
  readonly aprovacoesDePlano: string[] = [];
  readonly planosDescartados: string[] = [];
  readonly sinais: AbortSignal[] = [];
  readonly orquestradores = new Set<string>(["orq-1", "orq-2"]);
  falhaAoDescartar = false;
  private readonly prontas: RespostaDoExecutor[] = [];
  private readonly pendentes: Pendente[] = [];

  prepararRespostas(...respostas: RespostaDoExecutor[]): void {
    this.prontas.push(...respostas);
  }

  get quantosPendentes(): number {
    return this.pendentes.length;
  }

  /** Resolve o pedido pendente mais antigo. */
  responder(resultado: ResultadoDoPedidoDaRotina): void {
    this.pendentes.shift()?.resolver(resultado);
  }

  executar(pedido: PedidoDaRotina, sinal: AbortSignal): Promise<ResultadoDoPedidoDaRotina> {
    this.pedidos.push(pedido);
    return this.atender(sinal);
  }

  aprovarPlano(orquestradorId: string, sinal: AbortSignal): Promise<ResultadoDoPedidoDaRotina> {
    this.aprovacoesDePlano.push(orquestradorId);
    return this.atender(sinal);
  }

  descartarPlano(orquestradorId: string): Promise<void> {
    if (this.falhaAoDescartar) {
      return Promise.reject(new Error("O orquestrador não respondeu."));
    }
    this.planosDescartados.push(orquestradorId);
    return Promise.resolve();
  }

  orquestradorExiste(orquestradorId: string): Promise<boolean> {
    return Promise.resolve(this.orquestradores.has(orquestradorId));
  }

  private atender(sinal: AbortSignal): Promise<ResultadoDoPedidoDaRotina> {
    this.sinais.push(sinal);
    const pronta = this.prontas.shift();
    if (pronta instanceof Error) {
      return Promise.reject(pronta);
    }
    if (pronta !== undefined) {
      return Promise.resolve(pronta);
    }
    return new Promise((resolver) => {
      const pendente: Pendente = { resolver };
      this.pendentes.push(pendente);
      sinal.addEventListener(
        "abort",
        () => {
          const posicao = this.pendentes.indexOf(pendente);
          if (posicao >= 0) {
            this.pendentes.splice(posicao, 1);
          }
          resolver({ situacao: "cancelado", motivo: "O pedido foi abortado." });
        },
        { once: true },
      );
    });
  }
}

/** As Rotinas e as execuções em memória, com a mesma regra dos repositórios de verdade: cópias, e a memória troca na hora. */
export class RepositorioDeRotinasEmMemoria implements RepositorioDeRotinas, RepositorioDeExecucoes {
  private readonly rotinas = new Map<string, DadosDaRotina>();
  private readonly execucoes = new Map<string, DadosDaExecucao>();

  todas(): readonly Rotina[] {
    return [...this.rotinas.values()]
      .sort((a, b) => Date.parse(a.criadaEm) - Date.parse(b.criadaEm))
      .map((dados) => Rotina.reconstituir(dados));
  }

  buscar(id: string): Rotina | null {
    const dados = this.rotinas.get(id);
    return dados === undefined ? null : Rotina.reconstituir(dados);
  }

  salvar(rotina: Rotina): Promise<void> {
    const dados = rotina.paraDados();
    this.rotinas.set(dados.id, dados);
    return Promise.resolve();
  }

  remover(id: string): Promise<void> {
    this.rotinas.delete(id);
    for (const [execucaoId, dados] of this.execucoes) {
      if (dados.rotinaId === id) {
        this.execucoes.delete(execucaoId);
      }
    }
    return Promise.resolve();
  }

  daRotina(rotinaId: string): readonly ExecucaoDaRotina[] {
    return [...this.execucoes.values()]
      .filter((dados) => dados.rotinaId === rotinaId)
      .reverse()
      .sort((a, b) => Date.parse(b.iniciadaEm) - Date.parse(a.iniciadaEm))
      .map((dados) => ExecucaoDaRotina.reconstituir(dados));
  }

  buscarExecucao(id: string): ExecucaoDaRotina | null {
    const dados = this.execucoes.get(id);
    return dados === undefined ? null : ExecucaoDaRotina.reconstituir(dados);
  }

  ativaDaRotina(rotinaId: string): ExecucaoDaRotina | null {
    return this.daRotina(rotinaId).find((execucao) => execucao.ativa) ?? null;
  }

  ativas(): readonly ExecucaoDaRotina[] {
    return [...this.execucoes.values()]
      .filter((dados) => dados.situacao === "em_andamento" || dados.situacao === "aguardando_aprovacao")
      .map((dados) => ExecucaoDaRotina.reconstituir(dados));
  }

  salvarExecucao(execucao: ExecucaoDaRotina): Promise<void> {
    const dados = execucao.paraDados();
    if (this.rotinas.has(dados.rotinaId)) {
      this.execucoes.set(dados.id, dados);
    }
    return Promise.resolve();
  }
}

export class PublicadorEmLista implements PublicadorDeRotinas {
  readonly eventos: EventoDeRotina[] = [];

  publicar(evento: EventoDeRotina): void {
    this.eventos.push(evento);
  }

  get tipos(): string[] {
    return this.eventos.map((evento) => evento.tipo);
  }

  limpar(): void {
    this.eventos.length = 0;
  }
}

export interface ContextoDoServico {
  servico: ServicoDeRotinas;
  relogio: RelogioFalso;
  executor: ExecutorFalso;
  repositorio: RepositorioDeRotinasEmMemoria;
  publicador: PublicadorEmLista;
  controle: ControleDeExecucoesDeRotinas;
}

/** Terça-feira, 17/11/2026, 8h no relógio local: os gatilhos de teste usam horas locais, e assim valem em qualquer fuso. */
export function inicioDosTestes(): Date {
  return new Date(2026, 10, 17, 8, 0, 0, 0);
}

let contextosMontados = 0;

/** O serviço ligado aos dublês. Passar os dublês de um contexto anterior simula reabrir o app. */
export function montarContextoDoServico(anterior?: Partial<ContextoDoServico>): ContextoDoServico {
  const relogio = anterior?.relogio ?? new RelogioFalso(inicioDosTestes());
  const executor = anterior?.executor ?? new ExecutorFalso();
  const repositorio = anterior?.repositorio ?? new RepositorioDeRotinasEmMemoria();
  const publicador = anterior?.publicador ?? new PublicadorEmLista();
  const controle = new ControleDeExecucoesDeRotinas();
  // Cada serviço sorteia de uma faixa própria: reabrir o app sobre os mesmos dados não repete identidades.
  let numero = ++contextosMontados * 1_000;
  const servico = new ServicoDeRotinas({
    repositorioDeRotinas: repositorio,
    repositorioDeExecucoes: repositorio,
    executor,
    publicador,
    controle,
    temporizador: relogio,
    gerarId: () => `id-${++numero}`,
    agora: relogio.agora,
  });
  return { servico, relogio, executor, repositorio, publicador, controle };
}

export const PEDIDO_DE_TESTE: Extract<DadosDaEtapa, { tipo: "pedido" }> = {
  tipo: "pedido",
  orquestradorId: "orq-1",
  texto: "Rode os testes e faça um relatório.",
  modo: "execucao",
};

export const APROVACAO_DE_TESTE: Extract<DadosDaEtapa, { tipo: "aprovacao" }> = { tipo: "aprovacao", mensagem: "Confira o relatório antes de seguir." };

/** Uma rotina diária às 9h com um só pedido; `extras` sobrescreve o que o teste precisar. */
export function rotinaDeTeste(extras: Partial<PedidoDeRotina> = {}): PedidoDeRotina {
  return {
    nome: "Relatório semanal",
    gatilho: { tipo: "diario", hora: "09:00" },
    etapas: [PEDIDO_DE_TESTE],
    ...extras,
  };
}

function partesNoFuso(instante: Date, fuso: string): Record<string, number> {
  const formato = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const partes: Record<string, number> = {};
  for (const parte of formato.formatToParts(instante)) {
    if (parte.type !== "literal") {
      partes[parte.type] = Number(parte.value);
    }
  }
  return partes;
}

/** Diferença, em ms, entre o relógio de parede do fuso e o UTC naquele instante. */
function deslocamentoDoFuso(instante: Date, fuso: string): number {
  const p = partesNoFuso(instante, fuso);
  const arredondado = Math.floor(instante.getTime() / 1000) * 1000;
  return Date.UTC(p["year"] ?? 0, (p["month"] ?? 1) - 1, p["day"] ?? 1, p["hour"] ?? 0, p["minute"] ?? 0, p["second"] ?? 0) - arredondado;
}

const UM_DIA_EM_MS = 86_400_000;

/**
 * Um fuso horário de verdade (por exemplo "America/New_York"), com horário de
 * verão, para provar os gatilhos fora do fuso da máquina que roda os testes.
 */
export function fusoDe(fuso: string): FusoHorario {
  return {
    diaDe(instante: Date): DiaDoCalendario {
      const p = partesNoFuso(instante, fuso);
      return { ano: p["year"] ?? 0, mes: (p["month"] ?? 1) - 1, dia: p["day"] ?? 1 };
    },
    instanteDe(ano: number, mes: number, dia: number, hora: number, minuto: number): Date {
      const alvo = Date.UTC(ano, mes, dia, hora, minuto);
      const validos: number[] = [];
      for (const base of [alvo - UM_DIA_EM_MS, alvo + UM_DIA_EM_MS]) {
        const deslocamento = deslocamentoDoFuso(new Date(base), fuso);
        const candidato = alvo - deslocamento;
        if (deslocamentoDoFuso(new Date(candidato), fuso) === deslocamento) {
          validos.push(candidato);
        }
      }
      if (validos.length > 0) {
        // Hora que existe duas vezes (volta do horário de verão): a primeira.
        return new Date(Math.min(...validos));
      }
      // Hora que não existe (salto do horário de verão): vale como a hora seguinte.
      return new Date(alvo - deslocamentoDoFuso(new Date(alvo - UM_DIA_EM_MS), fuso));
    },
  };
}
