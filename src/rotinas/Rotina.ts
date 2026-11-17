import { DadosDaEtapa, EtapaDaRotina } from "./EtapaDaRotina";
import { ErroDeRotina } from "./ErroDeRotina";
import { DadosDoGatilho, Gatilho } from "./Gatilho";

export const AO_PERDER = ["executar_ao_abrir", "pular"] as const;
/** O que fazer com uma ocorrência que passou com o app fechado. */
export type AoPerder = (typeof AO_PERDER)[number];
/** Conservador: cada execução gasta o plano do usuário e age com as permissões do orquestrador. */
export const AO_PERDER_PADRAO: AoPerder = "pular";

export const TAMANHO_MAXIMO_DO_NOME = 100;
export const MINIMO_DE_ETAPAS = 1;
export const MAXIMO_DE_ETAPAS = 10;

export const MENSAGEM_DE_NOME_INVALIDO = `O nome da rotina deve ter entre 1 e ${TAMANHO_MAXIMO_DO_NOME} caracteres.`;
export const MENSAGEM_DE_ETAPAS_INVALIDAS = `A rotina deve ter de ${MINIMO_DE_ETAPAS} a ${MAXIMO_DE_ETAPAS} etapas.`;
export const MENSAGEM_DE_AO_PERDER_INVALIDO = "Escolha o que fazer quando uma execução for perdida: executar ao abrir ou pular.";
export const MENSAGEM_DE_DATA_PASSADA = "A data e a hora da execução única já passaram. Escolha um horário futuro.";
export const MENSAGEM_DE_ATIVACAO_PASSADA =
  "O horário desta rotina de execução única já passou. Altere o gatilho antes de ativá-la.";

export interface DadosDaRotina {
  id: string;
  nome: string;
  ativa: boolean;
  gatilho: DadosDoGatilho;
  etapas: DadosDaEtapa[];
  aoPerder: AoPerder;
  /** ISO 8601 */
  criadaEm: string;
  /** ISO 8601; `null` enquanto nunca rodou. */
  ultimaExecucaoEm: string | null;
  /** ISO 8601; `null` quando desativada ou sem mais ocorrências. */
  proximaExecucaoEm: string | null;
}

export interface NovaRotina {
  id: string;
  nome: string;
  gatilho: DadosDoGatilho;
  etapas: readonly DadosDaEtapa[];
  aoPerder?: AoPerder | undefined;
  /** Padrão: ativa. */
  ativa?: boolean | undefined;
  agora: Date;
}

/** Só o que vier preenchido muda; o resto da Rotina fica como está. */
export interface AlteracoesDaRotina {
  nome?: string | undefined;
  gatilho?: DadosDoGatilho | undefined;
  etapas?: readonly DadosDaEtapa[] | undefined;
  aoPerder?: AoPerder | undefined;
}

function nomeValido(nome: unknown): string {
  const aparado = typeof nome === "string" ? nome.trim() : "";
  if (aparado === "" || aparado.length > TAMANHO_MAXIMO_DO_NOME) {
    throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_NOME_INVALIDO);
  }
  return aparado;
}

function etapasValidas(etapas: unknown): readonly EtapaDaRotina[] {
  if (!Array.isArray(etapas) || etapas.length < MINIMO_DE_ETAPAS || etapas.length > MAXIMO_DE_ETAPAS) {
    throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_ETAPAS_INVALIDAS);
  }
  return Object.freeze((etapas as DadosDaEtapa[]).map((dados) => EtapaDaRotina.criar(dados)));
}

function aoPerderValido(aoPerder: unknown): AoPerder {
  if (aoPerder !== "executar_ao_abrir" && aoPerder !== "pular") {
    throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_AO_PERDER_INVALIDO);
  }
  return aoPerder;
}

/**
 * Raiz do agregado Rotina: um fluxo agendado de etapas (pedidos a
 * Orquestradores, aprovações e esperas). Guarda quando dispara; cada rodada
 * dela é uma `ExecucaoDaRotina`, agregado à parte.
 *
 * A agenda (`proximaExecucaoEm`) é sempre calculada a partir do gatilho e do
 * instante recebido, nunca do relógio do sistema: quem chama passa o `agora`.
 */
export class Rotina {
  private constructor(
    public readonly id: string,
    private nomeAtual: string,
    private ativaAtual: boolean,
    private gatilhoAtual: Gatilho,
    private etapasAtuais: readonly EtapaDaRotina[],
    private aoPerderAtual: AoPerder,
    private readonly criadaEmMs: number,
    private ultimaExecucaoEmMs: number | null,
    private proximaExecucaoEmMs: number | null,
  ) {}

  static criar({ id, nome, gatilho, etapas, aoPerder = AO_PERDER_PADRAO, ativa = true, agora }: NovaRotina): Rotina {
    const nomeCerto = nomeValido(nome);
    const gatilhoCerto = Gatilho.criar(gatilho);
    const etapasCertas = etapasValidas(etapas);
    const aoPerderCerto = aoPerderValido(aoPerder);
    const proxima = ativa ? gatilhoCerto.proximaOcorrencia(agora) : null;
    if (ativa && proxima === null) {
      throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_DATA_PASSADA);
    }
    return new Rotina(
      id,
      nomeCerto,
      ativa,
      gatilhoCerto,
      etapasCertas,
      aoPerderCerto,
      agora.getTime(),
      null,
      proxima?.getTime() ?? null,
    );
  }

  /** Rotina que veio do repositório: confere as regras, mas não recalcula a agenda gravada. */
  static reconstituir(dados: DadosDaRotina): Rotina {
    return new Rotina(
      dados.id,
      nomeValido(dados.nome),
      dados.ativa,
      Gatilho.reconstituir(dados.gatilho),
      etapasValidas(dados.etapas),
      aoPerderValido(dados.aoPerder),
      Date.parse(dados.criadaEm),
      dados.ultimaExecucaoEm === null ? null : Date.parse(dados.ultimaExecucaoEm),
      dados.proximaExecucaoEm === null ? null : Date.parse(dados.proximaExecucaoEm),
    );
  }

  get nome(): string {
    return this.nomeAtual;
  }

  get ativa(): boolean {
    return this.ativaAtual;
  }

  get gatilho(): Gatilho {
    return this.gatilhoAtual;
  }

  get etapas(): readonly EtapaDaRotina[] {
    return this.etapasAtuais;
  }

  get aoPerder(): AoPerder {
    return this.aoPerderAtual;
  }

  get criadaEm(): Date {
    return new Date(this.criadaEmMs);
  }

  get ultimaExecucaoEm(): Date | null {
    return this.ultimaExecucaoEmMs === null ? null : new Date(this.ultimaExecucaoEmMs);
  }

  get proximaExecucaoEm(): Date | null {
    return this.proximaExecucaoEmMs === null ? null : new Date(this.proximaExecucaoEmMs);
  }

  /**
   * Aplica as alterações de uma vez: se alguma for inválida, nada muda. Trocar
   * o gatilho recalcula a próxima execução; trocar pelo mesmo não mexe nela.
   */
  alterar(alteracoes: AlteracoesDaRotina, agora: Date): void {
    const nome = alteracoes.nome === undefined ? this.nomeAtual : nomeValido(alteracoes.nome);
    const etapas = alteracoes.etapas === undefined ? this.etapasAtuais : etapasValidas(alteracoes.etapas);
    const aoPerder = alteracoes.aoPerder === undefined ? this.aoPerderAtual : aoPerderValido(alteracoes.aoPerder);
    const gatilho = alteracoes.gatilho === undefined ? this.gatilhoAtual : Gatilho.criar(alteracoes.gatilho);

    let proxima = this.proximaExecucaoEmMs;
    if (!gatilho.igualA(this.gatilhoAtual)) {
      const calculada = this.ativaAtual ? gatilho.proximaOcorrencia(agora) : null;
      if (this.ativaAtual && calculada === null) {
        throw new ErroDeRotina("dados_invalidos", MENSAGEM_DE_DATA_PASSADA);
      }
      proxima = calculada?.getTime() ?? null;
    }

    this.nomeAtual = nome;
    this.etapasAtuais = etapas;
    this.aoPerderAtual = aoPerder;
    this.gatilhoAtual = gatilho;
    this.proximaExecucaoEmMs = proxima;
  }

  /** Ativar a rotina que já está ativa não muda nada. A agenda parte de `agora`: o que passou não volta. */
  ativar(agora: Date): void {
    if (this.ativaAtual) {
      return;
    }
    const proxima = this.gatilhoAtual.proximaOcorrencia(agora);
    if (proxima === null) {
      throw new ErroDeRotina("conflito", MENSAGEM_DE_ATIVACAO_PASSADA);
    }
    this.ativaAtual = true;
    this.proximaExecucaoEmMs = proxima.getTime();
  }

  desativar(): void {
    this.ativaAtual = false;
    this.proximaExecucaoEmMs = null;
  }

  /** Ativa e com a hora marcada já chegada (ou passada). */
  venceu(agora: Date): boolean {
    return this.ativaAtual && this.proximaExecucaoEmMs !== null && this.proximaExecucaoEmMs <= agora.getTime();
  }

  /** Quanto tempo se passou desde a hora marcada, em milissegundos (0 se ainda não chegou ou não há agenda). */
  atrasoEm(agora: Date): number {
    return this.proximaExecucaoEmMs === null ? 0 : Math.max(0, agora.getTime() - this.proximaExecucaoEmMs);
  }

  /**
   * A ocorrência marcada foi tratada (executada, pulada ou perdida): a agenda
   * segue para a próxima a partir de `agora`. Execução única que já passou
   * desativa a rotina.
   */
  avancarAgenda(agora: Date): void {
    const proxima = this.gatilhoAtual.proximaOcorrencia(agora);
    this.proximaExecucaoEmMs = proxima?.getTime() ?? null;
    if (proxima === null) {
      this.ativaAtual = false;
    }
  }

  /** Uma execução começou (agendada ou a pedido do usuário). Não mexe na agenda. */
  registrarExecucao(agora: Date): void {
    this.ultimaExecucaoEmMs = agora.getTime();
  }

  paraDados(): DadosDaRotina {
    return {
      id: this.id,
      nome: this.nomeAtual,
      ativa: this.ativaAtual,
      gatilho: this.gatilhoAtual.paraDados(),
      etapas: this.etapasAtuais.map((etapa) => etapa.paraDados()),
      aoPerder: this.aoPerderAtual,
      criadaEm: new Date(this.criadaEmMs).toISOString(),
      ultimaExecucaoEm: this.ultimaExecucaoEmMs === null ? null : new Date(this.ultimaExecucaoEmMs).toISOString(),
      proximaExecucaoEm: this.proximaExecucaoEmMs === null ? null : new Date(this.proximaExecucaoEmMs).toISOString(),
    };
  }
}
