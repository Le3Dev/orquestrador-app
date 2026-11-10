import {
  CronometroDeDescarga,
  FilaDeTranscricao,
  MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO,
  TEMPO_PARA_DESCARREGAR_O_DITADO_MS,
  TranscricaoDescartada,
} from "./filaDeTranscricao";
import {
  MODELO_DA_ESCUTA,
  MODELO_DO_DITADO,
  PRECISAO_NO_NAVEGADOR,
  type PedidoAoTranscritor,
  type RespostaDoTranscritor,
} from "./mensagens";
import type {
  DescricaoDoMotor,
  MotorDeTranscricao,
  OrigemDaTranscricao,
  ProgressoDoDownload,
  ResultadoDaTranscricao,
} from "./motor";

export { MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO, TEMPO_PARA_DESCARREGAR_O_DITADO_MS, TranscricaoDescartada };
export type { OrigemDaTranscricao };

/** Em que idioma transcrever: português fixo (o ditado) ou detectado pelo Whisper (a escuta). */
export type IdiomaDaTranscricao = "portuguese" | "automatico";

/** Opções da função antiga `transcrever` (compatibilidade; o novo é `OpcoesDaPassada`, em `motor.ts`). */
export interface OpcoesDaTranscricao {
  /** Padrão: `"portuguese"`. */
  idioma?: IdiomaDaTranscricao;
  /** Padrão: `"ditado"`. */
  origem?: OrigemDaTranscricao;
  /** Só vale na escuta: o mesmo que `OpcoesDaPassada.descartavel`. */
  provisoria?: boolean;
}

/** O mínimo de um Worker que o transcritor usa (um falso nos testes). */
export interface TrabalhadorDoTranscritor {
  onmessage: ((evento: MessageEvent<RespostaDoTranscritor>) => void) | null;
  onerror: ((evento: ErrorEvent) => void) | null;
  postMessage(pedido: PedidoAoTranscritor, transferir: Transferable[]): void;
  terminate(): void;
}

export type Transcrever = (
  audio: Float32Array,
  aoBaixar?: (progresso: number) => void,
  opcoes?: OpcoesDaTranscricao,
) => Promise<string>;

/** O modelo de cada origem no navegador: o ditado com o small, a escuta com o base (os dois WASM q8). */
function modeloDa(origem: OrigemDaTranscricao): string {
  return origem === "escuta" ? MODELO_DA_ESCUTA : MODELO_DO_DITADO;
}

function origemDoModelo(modelo: string): OrigemDaTranscricao {
  return modelo === MODELO_DA_ESCUTA ? "escuta" : "ditado";
}

/** O que a reserva no navegador informa como motor de cada origem. */
export function descricaoDoMotorNoNavegador(origem: OrigemDaTranscricao): DescricaoDoMotor {
  return { dispositivo: "wasm", modelo: modeloDa(origem), precisao: PRECISAO_NO_NAVEGADOR, nativo: false };
}

/** `"automatico"` vira `null` (o worker detecta); o resto vai como veio (padrão: português). */
function idiomaParaOWorker(idioma: string): string | null {
  return idioma === "automatico" ? null : idioma;
}

interface PreparoPendente {
  readonly origem: OrigemDaTranscricao;
  readonly resolver: (motor: DescricaoDoMotor) => void;
  readonly rejeitar: (erro: Error) => void;
}

/**
 * A reserva no navegador: o Whisper (transformers.js, WASM q8) num worker.
 * Implementa `MotorDeTranscricao` sobre a `FilaDeTranscricao` (um pedido por
 * vez; o ditado na frente da escuta).
 *
 * O worker é criado só no primeiro pedido, e um para a tela toda: cada modelo
 * carrega uma vez. Com a fila vazia e nada em andamento por
 * `TEMPO_PARA_DESCARREGAR_O_DITADO_MS`, ele é encerrado; o pedido seguinte cria
 * outro. `preparar` só carrega o modelo (sem passada de aquecimento, que
 * disputaria a CPU com uma transcrição em andamento no mesmo worker).
 */
export function criarTranscritor(criarTrabalhador: () => TrabalhadorDoTranscritor): MotorDeTranscricao {
  let trabalhador: TrabalhadorDoTranscritor | null = null;
  let proximoId = 1;
  const motores = new Map<OrigemDaTranscricao, DescricaoDoMotor>();
  const preparos = new Map<number, PreparoPendente>();
  const baixando = new Set<OrigemDaTranscricao>();
  const ouvintesDoMotor = new Set<(origem: OrigemDaTranscricao, motor: DescricaoDoMotor | null) => void>();
  const ouvintesDoDownload = new Set<(origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null) => void>();

  const descarga = new CronometroDeDescarga(
    () => trabalhador !== null && !fila.ocupada && preparos.size === 0,
    () => {
      const ocioso = trabalhador;
      trabalhador = null;
      ocioso?.terminate();
    },
  );

  const fila: FilaDeTranscricao = new FilaDeTranscricao({
    pronto: () => true,
    iniciar: (pedido) => {
      usarMotor(pedido.origem);
      // O buffer só é transferido aqui, quando o pedido começa: na fila ele ainda é de quem pediu.
      obterTrabalhador().postMessage(
        {
          tipo: "transcrever",
          id: pedido.id,
          audio: pedido.audio,
          idioma: idiomaParaOWorker(pedido.idioma),
          modelo: modeloDa(pedido.origem),
        },
        [pedido.audio.buffer],
      );
    },
    // Com trabalho, a contagem para; sem nada em andamento nem na fila, recomeça do zero.
    aoAndar: () => descarga.reiniciar(),
  });

  function usarMotor(origem: OrigemDaTranscricao): DescricaoDoMotor {
    const existente = motores.get(origem);
    if (existente !== undefined) return existente;
    const motor = descricaoDoMotorNoNavegador(origem);
    motores.set(origem, motor);
    for (const ouvinte of ouvintesDoMotor) ouvinte(origem, motor);
    return motor;
  }

  function informarDownload(origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null): void {
    if (progresso === null) {
      if (!baixando.delete(origem)) return;
    } else {
      baixando.add(origem);
    }
    for (const ouvinte of ouvintesDoDownload) ouvinte(origem, progresso);
  }

  function obterTrabalhador(): TrabalhadorDoTranscritor {
    if (trabalhador !== null) return trabalhador;
    const novo = criarTrabalhador();
    novo.onmessage = (evento) => {
      const resposta = evento.data;
      switch (resposta.tipo) {
        case "baixando": {
          const origem = origemDoModelo(resposta.modelo);
          informarDownload(
            origem,
            resposta.progresso >= 100 ? null : { progresso: resposta.progresso, totalMb: resposta.totalMb },
          );
          return;
        }
        case "pronto": {
          const preparo = preparos.get(resposta.id);
          if (preparo === undefined) return;
          preparos.delete(resposta.id);
          informarDownload(preparo.origem, null);
          preparo.resolver(usarMotor(preparo.origem));
          descarga.reiniciar();
          return;
        }
        case "resultado": {
          const atual = fila.atual;
          if (atual === null || atual.id !== resposta.id) return;
          informarDownload(atual.origem, null);
          const resultado: ResultadoDaTranscricao = {
            texto: resposta.texto,
            segmentos: resposta.segmentos,
            idioma: resposta.idioma,
            duracaoDaPassadaMs: resposta.duracaoDaPassadaMs,
          };
          fila.resolver(resposta.id, resultado);
          return;
        }
        case "erro": {
          const preparo = preparos.get(resposta.id);
          if (preparo !== undefined) {
            preparos.delete(resposta.id);
            informarDownload(preparo.origem, null);
            preparo.rejeitar(new Error(resposta.mensagem));
            descarga.reiniciar();
            return;
          }
          const atual = fila.atual;
          if (atual !== null && atual.id === resposta.id) informarDownload(atual.origem, null);
          fila.rejeitar(resposta.id, new Error(resposta.mensagem));
          return;
        }
      }
    };
    novo.onerror = (evento) => {
      // O worker nem subiu (ex.: falha ao carregar o script): ninguém espera para sempre.
      const erro = new Error(evento.message || "O reconhecimento de voz falhou ao iniciar.");
      descarga.parar();
      novo.terminate();
      if (trabalhador === novo) trabalhador = null;
      const afetados = [...preparos.values()];
      preparos.clear();
      for (const origem of [...baixando]) informarDownload(origem, null);
      for (const preparo of afetados) preparo.rejeitar(erro);
      fila.rejeitarTodos(erro);
    };
    trabalhador = novo;
    return novo;
  }

  return {
    transcrever(audio, opcoes) {
      const id = proximoId++;
      return new Promise<ResultadoDaTranscricao>((resolver, rejeitar) => {
        fila.adicionar({
          id,
          audio,
          origem: opcoes.origem,
          idioma: opcoes.idioma ?? "portuguese",
          descartavel: opcoes.origem === "escuta" && opcoes.descartavel === true,
          resolver,
          rejeitar,
        });
      });
    },

    preparar(origem) {
      const id = proximoId++;
      // A descrição é conhecida de antemão: quem escuta `aoMudarMotor` já fica sabendo.
      usarMotor(origem);
      return new Promise<DescricaoDoMotor>((resolver, rejeitar) => {
        try {
          // Registrado antes de mandar: um worker que cai na criação rejeita este preparo também.
          preparos.set(id, { origem, resolver, rejeitar });
          descarga.parar();
          obterTrabalhador().postMessage({ tipo: "preparar", id, modelo: modeloDa(origem) }, []);
        } catch (erro) {
          preparos.delete(id);
          rejeitar(erro instanceof Error ? erro : new Error(String(erro)));
        }
      });
    },

    motorAtual(origem) {
      return motores.get(origem) ?? null;
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
 * A reserva no navegador da tela toda (um worker, criado no primeiro pedido).
 * Use `motorDeTranscricao` (em `motor.ts`), que escolhe entre o nativo e esta.
 */
export const motorDoNavegador: MotorDeTranscricao = criarTranscritor(
  () => new Worker(new URL("./transcritor.worker.ts", import.meta.url), { type: "module" }),
);

/**
 * Compatibilidade (a escuta antiga): transcreve na reserva do navegador e
 * devolve só o texto. `aoBaixar` recebe o progresso de 0 a 100 enquanto o
 * pedido espera (100 ao terminar o download). O buffer do áudio é transferido
 * ao worker quando o pedido começa: não use o `audio` depois de chamar. Um
 * pedido da escuta pode ser rejeitado com `TranscricaoDescartada`. Prefira
 * `motorDeTranscricao.transcrever`.
 */
export const transcrever: Transcrever = (audio, aoBaixar, opcoes = {}) => {
  const pararDeOuvir =
    aoBaixar === undefined
      ? null
      : motorDoNavegador.aoBaixar((_origem, progresso) => aoBaixar(progresso?.progresso ?? 100));
  return motorDoNavegador
    .transcrever(audio, {
      origem: opcoes.origem ?? "ditado",
      idioma: opcoes.idioma ?? "portuguese",
      descartavel: opcoes.provisoria === true,
    })
    .then((resultado) => resultado.texto)
    .finally(() => pararDeOuvir?.());
};
