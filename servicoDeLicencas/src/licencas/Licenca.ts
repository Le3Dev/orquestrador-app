import { ChaveDeLicenca } from './ChaveDeLicenca';
import type { DadosDaAssinatura, SituacaoDaAssinatura } from './DadosDaAssinatura';
import { ErroDeLicenca } from './ErroDeLicenca';
import type { Plano } from './Plano';

/** Tolerancia apos o fim do periodo pago para pagamento atrasado. */
export const CARENCIA_DE_PAGAMENTO_EM_MS = 3 * 24 * 60 * 60 * 1000;

/** Objeto de valor interno ao agregado Licenca. */
export class Maquina {
  constructor(
    readonly id: string,
    readonly nome: string,
    readonly ativadaEm: number,
  ) {
    Object.freeze(this);
  }
}

interface PropriedadesDaLicenca {
  readonly id: string;
  readonly chave: ChaveDeLicenca;
  readonly idDaAssinatura: string;
  readonly idDoCliente: string;
  readonly email: string;
  readonly plano: Plano;
  readonly situacao: SituacaoDaAssinatura;
  readonly pagaAte: number;
  readonly criadaEm: number;
  readonly maquinas: readonly Maquina[];
}

/** Raiz do agregado: a Licenca e suas Maquinas ativas. Imutavel: cada operacao devolve uma nova Licenca. */
export class Licenca {
  readonly id: string;
  readonly chave: ChaveDeLicenca;
  readonly idDaAssinatura: string;
  readonly idDoCliente: string;
  readonly email: string;
  readonly plano: Plano;
  readonly situacao: SituacaoDaAssinatura;
  readonly pagaAte: number;
  readonly criadaEm: number;
  readonly maquinas: readonly Maquina[];

  private constructor(p: PropriedadesDaLicenca) {
    this.id = p.id;
    this.chave = p.chave;
    this.idDaAssinatura = p.idDaAssinatura;
    this.idDoCliente = p.idDoCliente;
    this.email = p.email;
    this.plano = p.plano;
    this.situacao = p.situacao;
    this.pagaAte = p.pagaAte;
    this.criadaEm = p.criadaEm;
    this.maquinas = Object.freeze([...p.maquinas]);
  }

  /** Fabrica: nova licenca para uma assinatura paga. */
  static emitir(args: {
    id: string;
    chave: ChaveDeLicenca;
    email: string;
    assinatura: DadosDaAssinatura;
    agora: number;
  }): Licenca {
    return new Licenca({
      id: args.id,
      chave: args.chave,
      idDaAssinatura: args.assinatura.idDaAssinatura,
      idDoCliente: args.assinatura.idDoCliente,
      email: args.email,
      plano: args.assinatura.plano,
      situacao: args.assinatura.situacao,
      pagaAte: args.assinatura.pagaAte,
      criadaEm: args.agora,
      maquinas: [],
    });
  }

  static reconstituir(p: PropriedadesDaLicenca): Licenca {
    return new Licenca(p);
  }

  /** Ativa/em teste, ou atrasada ainda dentro da carencia. */
  estaAtiva(agora: number): boolean {
    switch (this.situacao) {
      case 'ativa':
      case 'em-teste':
        return true;
      case 'atrasada':
        return agora <= this.pagaAte + CARENCIA_DE_PAGAMENTO_EM_MS;
      default:
        return false;
    }
  }

  possuiMaquina(idDaMaquina: string): boolean {
    return this.maquinas.some((m) => m.id === idDaMaquina);
  }

  /** Idempotente: maquina ja ativa devolve a mesma licenca. */
  ativarMaquina(maquina: Maquina, maximoDeMaquinas: number): Licenca {
    if (this.possuiMaquina(maquina.id)) return this;
    if (this.maquinas.length >= maximoDeMaquinas) throw new ErroDeLicenca('limite-de-maquinas');
    return this.comMaquinas([...this.maquinas, maquina]);
  }

  /** Idempotente: maquina ausente devolve a mesma licenca. */
  desativarMaquina(idDaMaquina: string): Licenca {
    if (!this.possuiMaquina(idDaMaquina)) return this;
    return this.comMaquinas(this.maquinas.filter((m) => m.id !== idDaMaquina));
  }

  atualizarAssinatura(assinatura: DadosDaAssinatura): Licenca {
    return new Licenca({
      ...this,
      idDoCliente: assinatura.idDoCliente,
      plano: assinatura.plano,
      situacao: assinatura.situacao,
      pagaAte: assinatura.pagaAte,
    });
  }

  private comMaquinas(maquinas: readonly Maquina[]): Licenca {
    return new Licenca({ ...this, maquinas });
  }
}