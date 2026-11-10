/**
 * Motor de transcrição da tela: a interface única que o ditado e a escuta usam.
 *
 * Com o app oferecendo a transcrição nativa (`window.electron.transcricaoNativa.disponivel`),
 * usa o motor nativo (`motorNativo.ts`: `onnxruntime-node` num `utilityProcess`);
 * senão, a reserva no navegador (`transcritor.ts`: worker WASM). Se o nativo
 * desiste (não conecta, não prepara, cai duas vezes ou erra seguidas vezes), a
 * tela passa para a reserva de vez e avisa `aoMudarMotor`. Um pedido que o
 * nativo não entregou é refeito na reserva: quem dita nunca recebe um erro do nativo.
 */
import {
  conexaoPelaJanela,
  criarMotorNativo,
  FalhaDoMotorNativo,
  type MotorNativo,
} from "./motorNativo";
import { motorDoNavegador, TranscricaoDescartada } from "./transcritor";
import { apiDaTranscricaoNativa } from "../ponteDoDesktop";

export type DispositivoDoMotor = "webgpu" | "dml" | "cpu" | "wasm";
export interface DescricaoDoMotor {
  readonly dispositivo: DispositivoDoMotor;
  readonly modelo: string;
  readonly precisao: string;
  readonly nativo: boolean;
}
export interface SegmentoTranscrito {
  readonly texto: string;
  readonly inicioS: number;
  readonly fimS: number;
}
export interface ResultadoDaTranscricao {
  readonly texto: string;
  readonly segmentos: readonly SegmentoTranscrito[];
  readonly idioma: string;
  readonly duracaoDaPassadaMs: number;
}
export interface ProgressoDoDownload {
  readonly progresso: number;
  readonly totalMb: number | null;
}
export type OrigemDaTranscricao = "ditado" | "escuta";
export type PrioridadeDoMotor = "velocidade" | "precisao";
export interface OpcoesDaPassada {
  readonly origem: OrigemDaTranscricao;
  /** "portuguese" (padrão), "automatico" ou um código já detectado ("pt", "en"...). */
  readonly idioma?: string;
  /** Só a escuta: passada parcial que pode ser descartada se houver fila (rejeita com TranscricaoDescartada). */
  readonly descartavel?: boolean;
}
export interface MotorDeTranscricao {
  transcrever(audio: Float32Array, opcoes: OpcoesDaPassada): Promise<ResultadoDaTranscricao>;
  /** Carrega e aquece o motor da origem (a escuta chama ao começar); resolve com a descrição. */
  preparar(origem: OrigemDaTranscricao, prioridade?: PrioridadeDoMotor): Promise<DescricaoDoMotor>;
  /** Motor em uso por origem; null antes de preparar. */
  motorAtual(origem: OrigemDaTranscricao): DescricaoDoMotor | null;
  aoMudarMotor(ouvinte: (origem: OrigemDaTranscricao, motor: DescricaoDoMotor | null) => void): () => void;
  aoBaixar(ouvinte: (origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null) => void): () => void;
}
export { TranscricaoDescartada } from "./transcritor";

/** Erros seguidos do nativo em pedidos (sem queda da porta) até a tela desistir dele. */
export const MAXIMO_DE_ERROS_SEGUIDOS_DO_NATIVO = 2;

const ORIGENS: readonly OrigemDaTranscricao[] = ["ditado", "escuta"];

export interface DependenciasDoMotor {
  /** true quando o app oferece o motor nativo; lido uma vez, no primeiro uso. */
  readonly nativoDisponivel: () => boolean;
  readonly criarNativo: () => MotorNativo;
  /** A reserva no navegador. */
  readonly navegador: MotorDeTranscricao;
}

function mesmoMotor(a: DescricaoDoMotor | null, b: DescricaoDoMotor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.dispositivo === b.dispositivo && a.modelo === b.modelo && a.precisao === b.precisao && a.nativo === b.nativo;
}

/** Monta o motor que escolhe entre o nativo e a reserva (dependências trocáveis nos testes). */
export function criarMotorDeTranscricao(dependencias: DependenciasDoMotor): MotorDeTranscricao {
  const { navegador } = dependencias;
  let decidido = false;
  /** O nativo em uso; null antes de decidir, sem nativo ou depois que ele desistiu. */
  let nativo: MotorNativo | null = null;
  let errosSeguidos = 0;
  /** As origens preparadas: na troca para a reserva, ela é preparada para cada uma. */
  const preparadas = new Map<OrigemDaTranscricao, PrioridadeDoMotor | undefined>();
  const preparosNaReserva = new Map<OrigemDaTranscricao, Promise<DescricaoDoMotor>>();
  const ultimoMotorAvisado = new Map<OrigemDaTranscricao, DescricaoDoMotor | null>();
  const ouvintesDoMotor = new Set<(origem: OrigemDaTranscricao, motor: DescricaoDoMotor | null) => void>();
  const ouvintesDoDownload = new Set<(origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null) => void>();

  function avisarMotor(origem: OrigemDaTranscricao, motor: DescricaoDoMotor | null): void {
    if (mesmoMotor(ultimoMotorAvisado.get(origem) ?? null, motor)) return;
    ultimoMotorAvisado.set(origem, motor);
    for (const ouvinte of ouvintesDoMotor) ouvinte(origem, motor);
  }

  function avisarDownload(origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null): void {
    for (const ouvinte of ouvintesDoDownload) ouvinte(origem, progresso);
  }

  // O download da reserva sempre chega (ela também refaz pedidos que o nativo não entregou);
  // a troca de motor dela, só quando é ela o motor em uso.
  navegador.aoBaixar(avisarDownload);
  navegador.aoMudarMotor((origem, motor) => {
    if (nativo === null) avisarMotor(origem, motor);
  });

  function nativoEmUso(): MotorNativo | null {
    if (decidido) return nativo;
    decidido = true;
    try {
      if (!dependencias.nativoDisponivel()) return null;
      const criado = dependencias.criarNativo();
      criado.aoMudarMotor((origem, motor) => {
        if (nativo === criado) avisarMotor(origem, motor);
      });
      criado.aoBaixar((origem, progresso) => {
        if (nativo === criado) avisarDownload(origem, progresso);
      });
      criado.aoFalhar(() => passarParaAReserva(criado));
      nativo = criado;
    } catch {
      // Sem conseguir montar o nativo, a reserva atende desde já.
      nativo = null;
    }
    return nativo;
  }

  /** Desiste do nativo de vez: a reserva é preparada para as origens preparadas e `aoMudarMotor` avisa. */
  function passarParaAReserva(antigo: MotorNativo): void {
    if (nativo !== antigo) return;
    nativo = null;
    for (const [origem, prioridade] of preparadas) {
      const preparo = navegador.preparar(origem, prioridade);
      // Quem pediu o preparo recebe o resultado pelo próprio `preparar`.
      preparo.catch(() => undefined);
      preparosNaReserva.set(origem, preparo);
    }
    for (const origem of ORIGENS) {
      if (preparadas.has(origem) || antigo.motorAtual(origem) !== null || ultimoMotorAvisado.has(origem)) {
        avisarMotor(origem, navegador.motorAtual(origem));
      }
    }
  }

  return {
    async transcrever(audio, opcoes) {
      const atual = nativoEmUso();
      if (atual === null) return navegador.transcrever(audio, opcoes);
      try {
        // O nativo trabalha numa cópia: `audio` segue intacto para a reserva refazer.
        const resultado = await atual.transcrever(audio, opcoes);
        errosSeguidos = 0;
        return resultado;
      } catch (erro) {
        if (erro instanceof TranscricaoDescartada) throw erro;
        if (erro instanceof FalhaDoMotorNativo || ++errosSeguidos >= MAXIMO_DE_ERROS_SEGUIDOS_DO_NATIVO) {
          passarParaAReserva(atual);
        }
        return navegador.transcrever(audio, opcoes);
      }
    },

    async preparar(origem, prioridade) {
      preparadas.set(origem, prioridade);
      const atual = nativoEmUso();
      if (atual !== null) {
        try {
          return await atual.preparar(origem, prioridade);
        } catch {
          passarParaAReserva(atual);
          // A troca já preparou a reserva para esta origem: aproveita o mesmo preparo.
          const preparo = preparosNaReserva.get(origem);
          preparosNaReserva.delete(origem);
          return preparo ?? navegador.preparar(origem, prioridade);
        }
      }
      return navegador.preparar(origem, prioridade);
    },

    motorAtual(origem) {
      return nativo !== null ? nativo.motorAtual(origem) : navegador.motorAtual(origem);
    },

    aoMudarMotor(ouvinte) {
      ouvintesDoMotor.add(ouvinte);
      return () => {
        ouvintesDoMotor.delete(ouvinte);
      };
    },

    aoBaixar(ouvinte) {
      ouvintesDoDownload.add(ouvinte);
      return () => {
        ouvintesDoDownload.delete(ouvinte);
      };
    },
  };
}

/**
 * O motor da tela toda. Nada é criado na importação: o nativo conecta (ou o
 * worker da reserva sobe) no primeiro `preparar` ou `transcrever`.
 */
export const motorDeTranscricao: MotorDeTranscricao = criarMotorDeTranscricao({
  nativoDisponivel: () => apiDaTranscricaoNativa()?.disponivel === true,
  criarNativo: () => criarMotorNativo(conexaoPelaJanela()),
  navegador: motorDoNavegador,
});
