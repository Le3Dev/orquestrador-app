import { TipoDeImagem } from "./Anexo";
import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { EventoDoMotor, UsoDoTurno } from "./EventoDeOrquestracao";
import { ModoDoTurno } from "./ModoDoTurno";
import { PastaDeTrabalho } from "./PastaDeTrabalho";

/** Imagem anexada ao pedido, já guardada em disco. */
export interface ImagemDoPedido {
  caminho: string;
  tipoDeMidia: TipoDeImagem;
}

export interface PedidoDeTurno {
  orquestradorId: string;
  sessaoId: string;
  /** Falso no primeiro turno: o motor cria a sessão; verdadeiro nos seguintes: retoma. */
  sessaoIniciada: boolean;
  texto: string;
  configuracao: ConfiguracaoDoOrquestrador;
  /** No planejamento, os agentes só leem, seja qual for o nível da configuração. */
  modo: ModoDoTurno;
  pastaDeTrabalho: PastaDeTrabalho;
  imagens: readonly ImagemDoPedido[];
  /** Pasta das imagens, liberada para leitura dos Subagentes; nula sem imagens. */
  pastaDasImagens: string | null;
}

export type ResultadoDoTurno =
  | { sucesso: true; resposta: string; uso: UsoDoTurno }
  | { sucesso: false; motivo: string; uso: UsoDoTurno | null };

/**
 * Quem de fato executa o Orquestrador e seus Subagentes.
 *
 * Porta do domínio: hoje é o Claude Code em modo headless, que usa o login da
 * assinatura do usuário; para oferecer o app a outras pessoas num servidor,
 * basta outro adaptador (Agent SDK com API key) sem mexer no domínio.
 *
 * Quando `sinal` é abortado, o motor encerra tudo o que lançou e resolve a
 * promessa — cabe ao chamador saber que foi um cancelamento.
 */
export interface MotorDeAgentes {
  executarTurno(
    pedido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
  ): Promise<ResultadoDoTurno>;
}
