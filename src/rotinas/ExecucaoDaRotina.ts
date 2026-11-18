import { DadosDaEtapa, EtapaDaRotina, TipoDeEtapa } from "./EtapaDaRotina";
import { ErroDeRotina, resumirTexto } from "./ErroDeRotina";
import { Rotina } from "./Rotina";

/** A execução `pulada` nunca começou: não tem etapas, então só as outras valem para uma etapa. */
export const SITUACOES_DA_ETAPA_EXECUTADA = [
  "em_andamento",
  "aguardando_aprovacao",
  "concluida",
  "falhou",
  "cancelada",
  "recusada",
  "interrompida",
] as const;
export type SituacaoDaEtapaExecutada = (typeof SITUACOES_DA_ETAPA_EXECUTADA)[number];

export const SITUACOES_DA_EXECUCAO = [...SITUACOES_DA_ETAPA_EXECUTADA, "pulada"] as const;
export type SituacaoDaExecucao = (typeof SITUACOES_DA_EXECUCAO)[number];

export const ORIGENS_DA_EXECUCAO = ["agendada", "manual", "perdida"] as const;
/** `agendada`: a hora chegou; `manual`: o usuário pediu; `perdida`: recuperação de uma hora que passou com o app fechado. */
export type OrigemDaExecucao = (typeof ORIGENS_DA_EXECUCAO)[number];

export const TAMANHO_MAXIMO_DA_RESPOSTA = 4_000;
export const TAMANHO_MAXIMO_DO_PLANO = 20_000;
export const TAMANHO_MAXIMO_DO_MOTIVO = 2_000;

export const MOTIVO_PADRAO_DA_RECUSA = "Recusada pelo usuário.";

/** O que a execução espera do usuário. */
export type PendenciaDeAprovacao =
  | { tipo: "aprovacao"; mensagem: string }
  | { tipo: "plano"; plano: string };

/** O que aconteceu em uma etapa que já começou. */
export interface ResultadoDaEtapa {
  tipo: TipoDeEtapa;
  situacao: SituacaoDaEtapaExecutada;
  /** ISO 8601 */
  iniciadaEm: string;
  /** ISO 8601; `null` enquanto a etapa não terminou. */
  encerradaEm: string | null;
  /** Resposta do Orquestrador, resumida. */
  resposta: string | null;
  /** Plano que ficou esperando aprovação. */
  plano: string | null;
  erro: string | null;
}

export interface DadosDaExecucao {
  id: string;
  rotinaId: string;
  /** O nome que a Rotina tinha ao começar: a execução continua legível se a Rotina for renomeada. */
  rotinaNome: string;
  origem: OrigemDaExecucao;
  situacao: SituacaoDaExecucao;
  /** Posição (a partir de 0) da etapa em curso; `null` quando a execução terminou. */
  etapaAtual: number | null;
  /** As etapas da Rotina quando a execução começou: editar a Rotina depois não muda uma execução em curso. */
  etapas: DadosDaEtapa[];
  /** Uma entrada por etapa já iniciada, na ordem. */
  resultados: ResultadoDaEtapa[];
  /** ISO 8601 */
  iniciadaEm: string;
  /** ISO 8601; `null` enquanto a execução não terminou. */
  encerradaEm: string | null;
  /** Por que não concluiu: erro, cancelamento, recusa, interrupção ou salto. */
  motivo: string | null;
  pendencia: PendenciaDeAprovacao | null;
}

export interface NovaExecucao {
  id: string;
  rotina: Rotina;
  origem: OrigemDaExecucao;
  agora: Date;
}

export interface ExecucaoPulada extends NovaExecucao {
  motivo: string;
}

type SituacaoEncerrada = Exclude<SituacaoDaExecucao, "em_andamento" | "aguardando_aprovacao" | "concluida" | "pulada">;

function conflito(mensagem: string): ErroDeRotina {
  return new ErroDeRotina("conflito", mensagem);
}

/**
 * Raiz de agregado: uma rodada de uma Rotina, ligada a ela por `rotinaId`.
 * Percorre as etapas uma a uma e guarda o que cada uma deu.
 *
 * Situações: `em_andamento` -> (`aguardando_aprovacao` -> `em_andamento`)* ->
 * `concluida`; ou termina em `falhou`, `cancelada`, `recusada` ou
 * `interrompida`. `pulada` é a execução que nem chegou a começar.
 *
 * As transições valem só nas situações certas: fora delas, lançam
 * `ErroDeRotina` de conflito, e a execução não muda.
 */
export class ExecucaoDaRotina {
  private constructor(
    public readonly id: string,
    public readonly rotinaId: string,
    public readonly rotinaNome: string,
    public readonly origem: OrigemDaExecucao,
    private readonly etapas: readonly EtapaDaRotina[],
    private situacaoAtual: SituacaoDaExecucao,
    private indiceAtual: number,
    private readonly resultados: ResultadoDaEtapa[],
    private readonly iniciadaEmMs: number,
    private encerradaEmMs: number | null,
    private motivoAtual: string | null,
    private pendenciaAtual: PendenciaDeAprovacao | null,
  ) {}

  /** Começa a rodar a primeira etapa (quem conduz chama `iniciarEtapa`). */
  static iniciar({ id, rotina, origem, agora }: NovaExecucao): ExecucaoDaRotina {
    return new ExecucaoDaRotina(
      id,
      rotina.id,
      rotina.nome,
      origem,
      rotina.etapas,
      "em_andamento",
      0,
      [],
      agora.getTime(),
      null,
      null,
      null,
    );
  }

  /** O registro de uma hora que passou sem rodar: já nasce encerrada, com o motivo. */
  static pular({ id, rotina, origem, agora, motivo }: ExecucaoPulada): ExecucaoDaRotina {
    return new ExecucaoDaRotina(
      id,
      rotina.id,
      rotina.nome,
      origem,
      rotina.etapas,
      "pulada",
      0,
      [],
      agora.getTime(),
      agora.getTime(),
      resumirTexto(motivo, TAMANHO_MAXIMO_DO_MOTIVO),
      null,
    );
  }

  /** Execução que veio do repositório: confere o que não pode estar errado, sem refazer a história. */
  static reconstituir(dados: DadosDaExecucao): ExecucaoDaRotina {
    if (!SITUACOES_DA_EXECUCAO.includes(dados.situacao) || !ORIGENS_DA_EXECUCAO.includes(dados.origem)) {
      throw new ErroDeRotina("dados_invalidos", "A situação ou a origem da execução é desconhecida.");
    }
    if (dados.situacao === "aguardando_aprovacao" && dados.pendencia === null) {
      throw new ErroDeRotina("dados_invalidos", "A execução aguarda aprovação, mas não diz o quê.");
    }
    return new ExecucaoDaRotina(
      dados.id,
      dados.rotinaId,
      dados.rotinaNome,
      dados.origem,
      dados.etapas.map((etapa) => EtapaDaRotina.reconstituir(etapa)),
      dados.situacao,
      dados.etapaAtual ?? dados.resultados.length,
      dados.resultados.map((resultado) => ({ ...resultado })),
      Date.parse(dados.iniciadaEm),
      dados.encerradaEm === null ? null : Date.parse(dados.encerradaEm),
      dados.motivo,
      dados.pendencia === null ? null : { ...dados.pendencia },
    );
  }

  get situacao(): SituacaoDaExecucao {
    return this.situacaoAtual;
  }

  /** Ainda não terminou: roda ou espera o usuário. */
  get ativa(): boolean {
    return this.situacaoAtual === "em_andamento" || this.situacaoAtual === "aguardando_aprovacao";
  }

  get iniciadaEm(): Date {
    return new Date(this.iniciadaEmMs);
  }

  get encerradaEm(): Date | null {
    return this.encerradaEmMs === null ? null : new Date(this.encerradaEmMs);
  }

  get motivo(): string | null {
    return this.motivoAtual;
  }

  get pendencia(): PendenciaDeAprovacao | null {
    return this.pendenciaAtual === null ? null : { ...this.pendenciaAtual };
  }

  /** A etapa em curso; `null` quando a execução terminou. */
  get etapaAtual(): EtapaDaRotina | null {
    return this.ativa ? (this.etapas[this.indiceAtual] ?? null) : null;
  }

  get posicaoDaEtapaAtual(): number | null {
    return this.etapaAtual === null ? null : this.indiceAtual;
  }

  /** A etapa em curso já foi iniciada (e ainda não terminou). */
  get etapaIniciada(): boolean {
    return this.resultados.length > this.indiceAtual;
  }

  iniciarEtapa(agora: Date): void {
    const etapa = this.exigirEmAndamento();
    if (this.etapaIniciada) {
      throw conflito("A etapa desta execução já foi iniciada.");
    }
    this.resultados.push({
      tipo: etapa.tipo,
      situacao: "em_andamento",
      iniciadaEm: agora.toISOString(),
      encerradaEm: null,
      resposta: null,
      plano: null,
      erro: null,
    });
  }

  /** A etapa em curso terminou bem; segue para a próxima ou conclui a execução. */
  concluirEtapa(resposta: string | null, agora: Date): void {
    this.exigirEmAndamento();
    const resultado = this.resultadoEmCurso();
    resultado.resposta = resposta === null ? null : resumirTexto(resposta, TAMANHO_MAXIMO_DA_RESPOSTA);
    this.fecharEtapaEAvancar(resultado, agora);
  }

  /** A etapa `aprovacao` chegou: para até o usuário decidir. */
  aguardarAprovacao(): void {
    const etapa = this.exigirEmAndamento();
    if (etapa.dados.tipo !== "aprovacao") {
      throw conflito("A etapa em curso não é uma aprovação.");
    }
    this.resultadoEmCurso().situacao = "aguardando_aprovacao";
    this.situacaoAtual = "aguardando_aprovacao";
    this.pendenciaAtual = { tipo: "aprovacao", mensagem: etapa.dados.mensagem };
  }

  /** O pedido terminou num plano: para até o usuário aprovar ou recusar. */
  aguardarAprovacaoDoPlano(plano: string): void {
    const etapa = this.exigirEmAndamento();
    if (etapa.dados.tipo !== "pedido") {
      throw conflito("A etapa em curso não é um pedido.");
    }
    const resultado = this.resultadoEmCurso();
    const resumido = resumirTexto(plano, TAMANHO_MAXIMO_DO_PLANO);
    resultado.situacao = "aguardando_aprovacao";
    resultado.plano = resumido;
    this.situacaoAtual = "aguardando_aprovacao";
    this.pendenciaAtual = { tipo: "plano", plano: resumido };
  }

  /**
   * O usuário aprovou. Devolve o que foi aprovado: uma `aprovacao` já segue
   * sozinha para a próxima etapa; um `plano` volta a rodar a mesma etapa, e
   * quem conduz precisa mandar o Orquestrador executá-lo.
   */
  aprovar(agora: Date): PendenciaDeAprovacao["tipo"] {
    const pendencia = this.exigirAguardandoAprovacao();
    const resultado = this.resultadoEmCurso();
    this.pendenciaAtual = null;
    this.situacaoAtual = "em_andamento";
    if (pendencia.tipo === "plano") {
      resultado.situacao = "em_andamento";
      return "plano";
    }
    this.fecharEtapaEAvancar(resultado, agora);
    return "aprovacao";
  }

  recusar(agora: Date, motivo?: string): void {
    this.exigirAguardandoAprovacao();
    const texto = motivo?.trim() ?? "";
    this.encerrar("recusada", texto === "" ? MOTIVO_PADRAO_DA_RECUSA : texto, agora);
  }

  falhar(motivo: string, agora: Date): void {
    this.exigirEmAndamento();
    this.encerrar("falhou", motivo, agora);
  }

  /** Vale para a execução que roda e para a que espera aprovação. */
  cancelar(motivo: string, agora: Date): void {
    if (!this.ativa) {
      throw conflito("Esta execução já terminou.");
    }
    this.encerrar("cancelada", motivo, agora);
  }

  /** O app fechou (ou caiu) no meio da execução. */
  interromper(motivo: string, agora: Date): void {
    this.exigirEmAndamento();
    this.encerrar("interrompida", motivo, agora);
  }

  paraDados(): DadosDaExecucao {
    return {
      id: this.id,
      rotinaId: this.rotinaId,
      rotinaNome: this.rotinaNome,
      origem: this.origem,
      situacao: this.situacaoAtual,
      etapaAtual: this.posicaoDaEtapaAtual,
      etapas: this.etapas.map((etapa) => etapa.paraDados()),
      resultados: this.resultados.map((resultado) => ({ ...resultado })),
      iniciadaEm: new Date(this.iniciadaEmMs).toISOString(),
      encerradaEm: this.encerradaEmMs === null ? null : new Date(this.encerradaEmMs).toISOString(),
      motivo: this.motivoAtual,
      pendencia: this.pendencia,
    };
  }

  private exigirEmAndamento(): EtapaDaRotina {
    const etapa = this.etapaAtual;
    if (this.situacaoAtual !== "em_andamento" || etapa === null) {
      throw conflito("Esta execução não está em andamento.");
    }
    return etapa;
  }

  private exigirAguardandoAprovacao(): PendenciaDeAprovacao {
    if (this.situacaoAtual !== "aguardando_aprovacao" || this.pendenciaAtual === null) {
      throw conflito("Esta execução não está aguardando aprovação.");
    }
    return this.pendenciaAtual;
  }

  private resultadoEmCurso(): ResultadoDaEtapa {
    const resultado = this.etapaIniciada ? this.resultados[this.indiceAtual] : undefined;
    if (resultado === undefined) {
      throw conflito("A etapa desta execução ainda não foi iniciada.");
    }
    return resultado;
  }

  private fecharEtapaEAvancar(resultado: ResultadoDaEtapa, agora: Date): void {
    resultado.situacao = "concluida";
    resultado.encerradaEm = agora.toISOString();
    this.indiceAtual += 1;
    if (this.indiceAtual >= this.etapas.length) {
      this.situacaoAtual = "concluida";
      this.encerradaEmMs = agora.getTime();
    }
  }

  private encerrar(situacao: SituacaoEncerrada, motivo: string, agora: Date): void {
    const resumido = resumirTexto(motivo, TAMANHO_MAXIMO_DO_MOTIVO);
    const resultado = this.etapaIniciada ? this.resultados[this.indiceAtual] : undefined;
    if (resultado !== undefined) {
      resultado.situacao = situacao;
      resultado.encerradaEm = agora.toISOString();
      if (situacao === "falhou") {
        resultado.erro = resumido;
      }
    }
    this.situacaoAtual = situacao;
    this.encerradaEmMs = agora.getTime();
    this.motivoAtual = resumido;
    this.pendenciaAtual = null;
  }
}
