/**
 * O motor nativo visto da tela: o Whisper no `onnxruntime-node`, num
 * `utilityProcess` do app, alcançado por uma `MessagePort`.
 *
 * A fila fica na tela, a mesma `FilaDeTranscricao` da reserva no navegador
 * (ditado na frente; descartável só com a fila vazia; no máximo 2 pedidos da
 * escuta esperando): as regras ficam num lugar só, e o utilitário recebe um
 * pedido por vez. O campo `descartavel` segue no protocolo, e um `erro` com
 * `descartado` do utilitário vira `TranscricaoDescartada` do mesmo jeito.
 *
 * O áudio de quem pediu nunca é transferido: vai uma cópia (transferida). Assim
 * o pedido pode ser reenviado depois de uma reconexão, e a reserva no navegador
 * pode refazê-lo se o nativo falhar.
 */
import {
  CronometroDeDescarga,
  FilaDeTranscricao,
  type PedidoDaFila,
  TranscricaoDescartada,
} from "./filaDeTranscricao";
import type {
  DescricaoDoMotor,
  DispositivoDoMotor,
  MotorDeTranscricao,
  OrigemDaTranscricao,
  PrioridadeDoMotor,
  ProgressoDoDownload,
  ResultadoDaTranscricao,
  SegmentoTranscrito,
} from "./motor";
import { apiDaTranscricaoNativa } from "../ponteDoDesktop";

/** O `data.tipo` da mensagem com que o app entrega a porta (window.postMessage do preload). */
export const TIPO_DA_MENSAGEM_DA_PORTA = "orquestrador:porta-da-transcricao";

/**
 * Na segunda queda da porta com trabalho perdido (sem um resultado no meio), o
 * nativo desiste e a tela passa para a reserva. A porta que fecha sem nada em
 * andamento (o utilitário descarregou por ociosidade) não conta.
 */
export const MAXIMO_DE_QUEDAS_DO_MOTOR_NATIVO = 2;

/** Quanto a tela espera a porta chegar depois de `conectar()`. */
export const TEMPO_PARA_RECEBER_A_PORTA_MS = 15_000;

/**
 * Depois de mandar `descarregar`, a tela não manda nada novo para aquela porta
 * (o utilitário dela vai ser encerrado e responderia "repita o pedido"): espera
 * a porta nova por até este tempo; sem ela, volta a usar a mesma.
 */
export const TEMPO_PARA_TROCAR_A_PORTA_DESCARREGADA_MS = 5_000;

/** O nativo desistiu de vez (não conectou, não preparou ou caiu demais): a tela usa a reserva no navegador. */
export class FalhaDoMotorNativo extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "FalhaDoMotorNativo";
  }
}

/** O mínimo de uma `MessagePort` que o motor usa (uma falsa nos testes). */
export interface PortaDaTranscricao {
  onmessage: ((evento: MessageEvent) => void) | null;
  postMessage(mensagem: unknown, transferir: Transferable[]): void;
  addEventListener(tipo: "close", ouvinte: () => void): void;
  close(): void;
}

/** Como a tela consegue uma porta para o utilitário. */
export interface ConexaoDaTranscricaoNativa {
  /** Pede ao app uma porta nova; ela chega por `aoReceberPorta`. */
  conectar(): Promise<void>;
  /** Ouve as portas que o app entrega; devolve a função que para de ouvir. */
  aoReceberPorta(ouvinte: (porta: PortaDaTranscricao) => void): () => void;
}

/** O motor nativo e o aviso de que ele desistiu. */
export interface MotorNativo extends MotorDeTranscricao {
  aoFalhar(ouvinte: (erro: FalhaDoMotorNativo) => void): () => void;
}

/** Mensagens da tela para o utilitário (contrato com o processo do app). */
export type MensagemParaOUtilitario =
  | { tipo: "preparar"; origem: OrigemDaTranscricao; prioridade: PrioridadeDoMotor }
  | {
      tipo: "transcrever";
      id: number;
      origem: OrigemDaTranscricao;
      audio: Float32Array;
      idioma: string;
      descartavel: boolean;
    }
  | { tipo: "descarregar" };

/** Mensagens do utilitário para a tela, já conferidas. */
export type MensagemDoUtilitario =
  | { tipo: "motor"; origem: OrigemDaTranscricao; motor: DescricaoDoMotor }
  | { tipo: "baixando"; origem: OrigemDaTranscricao; progresso: number; totalMb: number | null }
  | { tipo: "pronto"; origem: OrigemDaTranscricao }
  | { tipo: "resultado"; id: number; resultado: ResultadoDaTranscricao }
  | {
      tipo: "erro";
      id: number | null;
      mensagem: string;
      descartado: boolean;
      /** Extra do app: o motor nativo foi desligado (caiu demais); a tela passa para a reserva. */
      indisponivel: boolean;
    };

const DISPOSITIVOS: readonly DispositivoDoMotor[] = ["webgpu", "dml", "cpu", "wasm"];

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function ehOrigem(valor: unknown): valor is OrigemDaTranscricao {
  return valor === "ditado" || valor === "escuta";
}

function ehDispositivo(valor: unknown): valor is DispositivoDoMotor {
  return typeof valor === "string" && (DISPOSITIVOS as readonly string[]).includes(valor);
}

function numeroFinito(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function lerSegmentos(valor: unknown): SegmentoTranscrito[] {
  if (!Array.isArray(valor)) return [];
  const segmentos: SegmentoTranscrito[] = [];
  for (const item of valor) {
    if (!ehRegistro(item) || typeof item.texto !== "string") continue;
    const inicioS = numeroFinito(item.inicioS);
    const fimS = numeroFinito(item.fimS);
    if (inicioS === null || fimS === null) continue;
    segmentos.push({ texto: item.texto, inicioS, fimS });
  }
  return segmentos;
}

/** Confere uma mensagem do utilitário; null para o que não é do protocolo. */
export function lerMensagemDoUtilitario(dados: unknown): MensagemDoUtilitario | null {
  if (!ehRegistro(dados)) return null;
  switch (dados.tipo) {
    case "motor": {
      const motor = dados.motor;
      if (!ehOrigem(dados.origem) || !ehRegistro(motor) || !ehDispositivo(motor.dispositivo)) return null;
      if (typeof motor.modelo !== "string" || typeof motor.precisao !== "string") return null;
      return {
        tipo: "motor",
        origem: dados.origem,
        motor: { dispositivo: motor.dispositivo, modelo: motor.modelo, precisao: motor.precisao, nativo: true },
      };
    }
    case "baixando": {
      const progresso = numeroFinito(dados.progresso);
      if (!ehOrigem(dados.origem) || progresso === null) return null;
      return { tipo: "baixando", origem: dados.origem, progresso, totalMb: numeroFinito(dados.totalMb) };
    }
    case "pronto":
      return ehOrigem(dados.origem) ? { tipo: "pronto", origem: dados.origem } : null;
    case "resultado": {
      const id = numeroFinito(dados.id);
      if (id === null || typeof dados.texto !== "string") return null;
      return {
        tipo: "resultado",
        id,
        resultado: {
          texto: dados.texto,
          segmentos: lerSegmentos(dados.segmentos),
          idioma: typeof dados.idioma === "string" ? dados.idioma : "pt",
          duracaoDaPassadaMs: numeroFinito(dados.duracaoDaPassadaMs) ?? 0,
        },
      };
    }
    case "erro":
      return {
        tipo: "erro",
        id: numeroFinito(dados.id),
        mensagem: typeof dados.mensagem === "string" ? dados.mensagem : "A transcrição nativa falhou.",
        descartado: dados.descartado === true,
        indisponivel: dados.indisponivel === true,
      };
    default:
      return null;
  }
}

/** A prioridade do motor quando quem prepara não diz: a escuta quer velocidade; o ditado, precisão. */
function prioridadePadrao(origem: OrigemDaTranscricao): PrioridadeDoMotor {
  return origem === "escuta" ? "velocidade" : "precisao";
}

/** O utilitário disse "pronto" sem ter dito qual motor carregou. */
const MOTOR_NATIVO_SEM_DESCRICAO: DescricaoDoMotor = {
  dispositivo: "cpu",
  modelo: "desconhecido",
  precisao: "desconhecida",
  nativo: true,
};

function mesmoMotor(a: DescricaoDoMotor | null, b: DescricaoDoMotor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.dispositivo === b.dispositivo && a.modelo === b.modelo && a.precisao === b.precisao && a.nativo === b.nativo;
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** A conexão de verdade: `window.electron.transcricaoNativa` e o `message` da janela. */
export function conexaoPelaJanela(janela: Window = window): ConexaoDaTranscricaoNativa {
  return {
    conectar() {
      const api = apiDaTranscricaoNativa();
      if (api === null) return Promise.reject(new Error("O app não oferece a transcrição nativa."));
      return api.conectar();
    },
    aoReceberPorta(ouvinte) {
      const aoMensagem = (evento: MessageEvent) => {
        // Só a mensagem do preload (a própria janela), nunca a de um iframe ou de outra origem.
        if (evento.source !== janela) return;
        const dados: unknown = evento.data;
        const porta = evento.ports[0];
        if (ehRegistro(dados) && dados.tipo === TIPO_DA_MENSAGEM_DA_PORTA && porta !== undefined) ouvinte(porta);
      };
      janela.addEventListener("message", aoMensagem);
      return () => janela.removeEventListener("message", aoMensagem);
    },
  };
}

interface PreparoPendente {
  readonly resolver: (motor: DescricaoDoMotor) => void;
  readonly rejeitar: (erro: Error) => void;
}

interface TentativaDeConexao {
  readonly promessa: Promise<void>;
  readonly resolver: () => void;
  readonly rejeitar: (erro: Error) => void;
  readonly cronometro: ReturnType<typeof setTimeout>;
}

/**
 * Cria o motor nativo. Conecta no primeiro uso. Se a porta fechar, devolve o
 * pedido em andamento à fila e reconecta; a origem preparada é preparada de
 * novo (com a mesma prioridade) só quando voltar a ser usada, para a descarga
 * por ociosidade não recarregar o modelo. Desiste, rejeitando tudo com
 * `FalhaDoMotorNativo` e avisando `aoFalhar`, na `MAXIMO_DE_QUEDAS_DO_MOTOR_NATIVO`ª
 * queda com trabalho perdido, se a porta não chega, se o preparo falha ou se o
 * app avisa que desligou o motor (`indisponivel`). Ocioso por
 * `TEMPO_PARA_DESCARREGAR_O_DITADO_MS`, manda `descarregar` ao utilitário.
 */
export function criarMotorNativo(conexao: ConexaoDaTranscricaoNativa): MotorNativo {
  let porta: PortaDaTranscricao | null = null;
  let tentativa: TentativaDeConexao | null = null;
  let pararDeOuvirPortas: (() => void) | null = null;
  let falha: FalhaDoMotorNativo | null = null;
  let quedas = 0;
  let proximoId = 1;
  /** A porta que recebeu `descarregar` (o app vai trocá-la): nada novo vai para ela. */
  let portaDescarregada: PortaDaTranscricao | null = null;
  let esperaDaTroca: ReturnType<typeof setTimeout> | null = null;
  const motores = new Map<OrigemDaTranscricao, DescricaoDoMotor>();
  /** As origens preparadas e com que prioridade: um utilitário novo (reconexão) é preparado de novo no uso. */
  const prioridades = new Map<OrigemDaTranscricao, PrioridadeDoMotor>();
  /** As origens que já receberam `preparar` na porta atual. */
  const preparadasNaPorta = new Set<OrigemDaTranscricao>();
  const preparos = new Map<OrigemDaTranscricao, PreparoPendente[]>();
  const baixando = new Set<OrigemDaTranscricao>();
  const ouvintesDoMotor = new Set<(origem: OrigemDaTranscricao, motor: DescricaoDoMotor | null) => void>();
  const ouvintesDoDownload = new Set<(origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null) => void>();
  const ouvintesDaFalha = new Set<(erro: FalhaDoMotorNativo) => void>();

  function haPreparos(): boolean {
    for (const lista of preparos.values()) if (lista.length > 0) return true;
    return false;
  }

  /** A porta que pode receber pedidos agora (conectada e fora da descarga), ou null. */
  function portaPronta(): PortaDaTranscricao | null {
    return porta !== null && porta !== portaDescarregada ? porta : null;
  }

  function pararEsperaDaTroca(): void {
    portaDescarregada = null;
    if (esperaDaTroca !== null) {
      clearTimeout(esperaDaTroca);
      esperaDaTroca = null;
    }
  }

  const descarga = new CronometroDeDescarga(
    () => portaPronta() !== null && !fila.ocupada && !haPreparos(),
    () => {
      const descarregada = portaPronta();
      if (descarregada === null) return;
      descarregada.postMessage({ tipo: "descarregar" } satisfies MensagemParaOUtilitario, []);
      preparadasNaPorta.clear();
      portaDescarregada = descarregada;
      esperaDaTroca = setTimeout(() => {
        esperaDaTroca = null;
        // O utilitário não foi encerrado (nada carregado): segue nesta porta.
        if (portaDescarregada === descarregada) {
          portaDescarregada = null;
          aoFicarPronta();
        }
      }, TEMPO_PARA_TROCAR_A_PORTA_DESCARREGADA_MS);
    },
  );

  const fila: FilaDeTranscricao = new FilaDeTranscricao({
    pronto: () => portaPronta() !== null,
    iniciar: (pedido: PedidoDaFila) => {
      const destino = portaPronta();
      if (destino === null) throw new Error("A transcrição nativa não está conectada.");
      // Origem preparada antes (talvez noutro utilitário): o preparo vai na frente, com a prioridade dela.
      const prioridade = prioridades.get(pedido.origem);
      if (prioridade !== undefined && !preparadasNaPorta.has(pedido.origem)) {
        enviarPreparo(destino, pedido.origem, prioridade);
      }
      const copia = pedido.audio.slice();
      const mensagem: MensagemParaOUtilitario = {
        tipo: "transcrever",
        id: pedido.id,
        origem: pedido.origem,
        audio: copia,
        idioma: pedido.idioma,
        descartavel: pedido.descartavel,
      };
      destino.postMessage(mensagem, [copia.buffer]);
    },
    aoAndar: () => descarga.reiniciar(),
  });

  function enviarPreparo(destino: PortaDaTranscricao, origem: OrigemDaTranscricao, prioridade: PrioridadeDoMotor): void {
    const mensagem: MensagemParaOUtilitario = { tipo: "preparar", origem, prioridade };
    destino.postMessage(mensagem, []);
    preparadasNaPorta.add(origem);
  }

  /** A porta ficou pronta (chegou ou saiu da descarga): manda os preparos que esperam e anda a fila. */
  function aoFicarPronta(): void {
    const destino = portaPronta();
    if (destino === null) return;
    for (const [origem, lista] of preparos) {
      const prioridade = prioridades.get(origem);
      if (lista.length > 0 && prioridade !== undefined) enviarPreparo(destino, origem, prioridade);
    }
    fila.processar();
  }

  function informarDownload(origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null): void {
    if (progresso === null) {
      if (!baixando.delete(origem)) return;
    } else {
      baixando.add(origem);
    }
    for (const ouvinte of ouvintesDoDownload) ouvinte(origem, progresso);
  }

  function definirMotor(origem: OrigemDaTranscricao, motor: DescricaoDoMotor): void {
    if (mesmoMotor(motores.get(origem) ?? null, motor)) return;
    motores.set(origem, motor);
    for (const ouvinte of ouvintesDoMotor) ouvinte(origem, motor);
  }

  function retirarPreparos(origem: OrigemDaTranscricao): PreparoPendente[] {
    const lista = preparos.get(origem) ?? [];
    preparos.delete(origem);
    return lista;
  }

  function falhar(erro: FalhaDoMotorNativo): void {
    if (falha !== null) return;
    falha = erro;
    descarga.parar();
    pararEsperaDaTroca();
    if (tentativa !== null) {
      clearTimeout(tentativa.cronometro);
      tentativa.rejeitar(erro);
      tentativa = null;
    }
    const antiga = porta;
    porta = null;
    if (antiga !== null) soltar(antiga);
    pararDeOuvirPortas?.();
    pararDeOuvirPortas = null;
    // O download some antes do aviso: quem troca de motor não fica com uma barra presa.
    for (const origem of [...baixando]) informarDownload(origem, null);
    for (const ouvinte of ouvintesDaFalha) ouvinte(erro);
    motores.clear();
    const afetados = [...preparos.values()].flat();
    preparos.clear();
    for (const preparo of afetados) preparo.rejeitar(erro);
    fila.rejeitarTodos(erro);
  }

  function soltar(antiga: PortaDaTranscricao): void {
    antiga.onmessage = null;
    try {
      antiga.close();
    } catch {
      // Já fechada: nada a fazer.
    }
  }

  function adotarPorta(nova: PortaDaTranscricao): void {
    if (falha !== null) {
      soltar(nova);
      return;
    }
    if (nova === porta) return;
    const antiga = porta;
    porta = nova;
    pararEsperaDaTroca();
    // Um utilitário novo não sabe o que já estava preparado: o preparo vai de novo no uso (ou já, se alguém espera).
    preparadasNaPorta.clear();
    if (antiga !== null) {
      // Uma porta nova sem a antiga ter avisado que fechou: o que estava nela se perdeu.
      soltar(antiga);
      fila.devolverEmAndamento();
    }
    nova.onmessage = (evento) => {
      if (porta === nova) receber(evento.data);
    };
    nova.addEventListener("close", () => {
      if (porta === nova) aoFecharPorta(nova);
    });
    if (tentativa !== null) {
      clearTimeout(tentativa.cronometro);
      tentativa.resolver();
      tentativa = null;
    }
    aoFicarPronta();
  }

  function aoFecharPorta(fechada: PortaDaTranscricao): void {
    // Fechar depois de `descarregar`, ou sem nada em andamento (o utilitário descarregou sozinho), não é queda.
    const perdeuTrabalho = fechada !== portaDescarregada && (fila.atual !== null || haPreparos());
    porta = null;
    pararEsperaDaTroca();
    preparadasNaPorta.clear();
    fila.devolverEmAndamento();
    for (const origem of [...baixando]) informarDownload(origem, null);
    if (perdeuTrabalho && ++quedas >= MAXIMO_DE_QUEDAS_DO_MOTOR_NATIVO) {
      falhar(new FalhaDoMotorNativo("A transcrição nativa caiu duas vezes; seguindo no navegador."));
      return;
    }
    // Com trabalho esperando, reconecta já; senão, no próximo uso.
    if (fila.ocupada || haPreparos()) garantirPorta().catch(() => undefined);
  }

  /** Resolve com a porta pronta; uma falha aqui já passou por `falhar` (que rejeita fila e preparos). */
  function garantirPorta(): Promise<void> {
    if (falha !== null) return Promise.reject(falha);
    if (porta !== null) return Promise.resolve();
    if (tentativa !== null) return tentativa.promessa;
    if (pararDeOuvirPortas === null) pararDeOuvirPortas = conexao.aoReceberPorta(adotarPorta);
    let resolver: () => void = () => undefined;
    let rejeitar: (erro: Error) => void = () => undefined;
    const promessa = new Promise<void>((resolverPromessa, rejeitarPromessa) => {
      resolver = resolverPromessa;
      rejeitar = rejeitarPromessa;
    });
    const cronometro = setTimeout(() => {
      falhar(new FalhaDoMotorNativo("A transcrição nativa não respondeu: a porta não chegou."));
    }, TEMPO_PARA_RECEBER_A_PORTA_MS);
    tentativa = { promessa, resolver, rejeitar, cronometro };
    Promise.resolve()
      .then(() => conexao.conectar())
      .catch((erro: unknown) => {
        falhar(new FalhaDoMotorNativo(`Não foi possível conectar à transcrição nativa: ${mensagemDe(erro)}`));
      });
    return promessa;
  }

  function receber(dados: unknown): void {
    const mensagem = lerMensagemDoUtilitario(dados);
    if (mensagem === null) return;
    switch (mensagem.tipo) {
      case "motor":
        definirMotor(mensagem.origem, mensagem.motor);
        return;
      case "baixando":
        informarDownload(
          mensagem.origem,
          mensagem.progresso >= 100 ? null : { progresso: mensagem.progresso, totalMb: mensagem.totalMb },
        );
        return;
      case "pronto": {
        informarDownload(mensagem.origem, null);
        const motor = motores.get(mensagem.origem) ?? MOTOR_NATIVO_SEM_DESCRICAO;
        for (const preparo of retirarPreparos(mensagem.origem)) preparo.resolver(motor);
        descarga.reiniciar();
        return;
      }
      case "resultado": {
        const atual = fila.atual;
        if (atual === null || atual.id !== mensagem.id) return;
        // Um pedido entregue: as quedas contam de novo do zero.
        quedas = 0;
        informarDownload(atual.origem, null);
        fila.resolver(mensagem.id, mensagem.resultado);
        return;
      }
      case "erro": {
        if (mensagem.indisponivel) {
          falhar(new FalhaDoMotorNativo(`A transcrição nativa foi desligada: ${mensagem.mensagem}`));
          return;
        }
        if (mensagem.id === null) {
          // Erro fora de um pedido: o preparo (carregar o modelo) falhou. Sem preparo esperando, não há quem avisar.
          if (haPreparos()) falhar(new FalhaDoMotorNativo(`A transcrição nativa não carregou: ${mensagem.mensagem}`));
          return;
        }
        const atual = fila.atual;
        if (atual === null || atual.id !== mensagem.id) return;
        informarDownload(atual.origem, null);
        fila.rejeitar(mensagem.id, mensagem.descartado ? new TranscricaoDescartada() : new Error(mensagem.mensagem));
        return;
      }
    }
  }

  return {
    transcrever(audio, opcoes) {
      if (falha !== null) return Promise.reject(falha);
      const id = proximoId++;
      const promessa = new Promise<ResultadoDaTranscricao>((resolver, rejeitar) => {
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
      if (porta === null) garantirPorta().catch(() => undefined);
      return promessa;
    },

    preparar(origem, prioridade = prioridadePadrao(origem)) {
      if (falha !== null) return Promise.reject(falha);
      prioridades.set(origem, prioridade);
      const promessa = new Promise<DescricaoDoMotor>((resolver, rejeitar) => {
        preparos.set(origem, [...(preparos.get(origem) ?? []), { resolver, rejeitar }]);
      });
      descarga.parar();
      // Sem porta (ou com ela em descarga), o preparo sai quando ela ficar pronta (`aoFicarPronta`).
      const destino = portaPronta();
      if (destino !== null) enviarPreparo(destino, origem, prioridade);
      else if (porta === null) garantirPorta().catch(() => undefined);
      return promessa;
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

    aoFalhar(ouvinte) {
      ouvintesDaFalha.add(ouvinte);
      return () => {
        ouvintesDaFalha.delete(ouvinte);
      };
    },
  };
}
