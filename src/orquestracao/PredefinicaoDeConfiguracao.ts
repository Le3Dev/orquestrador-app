import { AlteracoesDaConfiguracao, ConfiguracaoDoOrquestrador, DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";

export type NomeDaPredefinicao = "economico";

export interface DadosDaPredefinicao {
  nome: NomeDaPredefinicao;
  rotulo: string;
  descricao: string;
  configuracao: AlteracoesDaConfiguracao;
}

function congelar(alteracoes: AlteracoesDaConfiguracao): AlteracoesDaConfiguracao {
  const copia: AlteracoesDaConfiguracao = { ...alteracoes };
  if (copia.quantidadeDeSubagentes !== undefined) {
    copia.quantidadeDeSubagentes = Object.freeze({ ...copia.quantidadeDeSubagentes });
  }
  return Object.freeze(copia);
}

/**
 * Um conjunto pronto de escolhas de configuração, aplicado de uma vez. Só os
 * campos da predefinição mudam; o resto da configuração fica como estava, e
 * tudo continua editável depois. Objeto de valor.
 */
export class PredefinicaoDeConfiguracao {
  public readonly alteracoes: AlteracoesDaConfiguracao;

  constructor(
    public readonly nome: NomeDaPredefinicao,
    public readonly rotulo: string,
    public readonly descricao: string,
    alteracoes: AlteracoesDaConfiguracao,
  ) {
    this.alteracoes = congelar(alteracoes);
    Object.freeze(this);
  }

  aplicarEm(configuracao: ConfiguracaoDoOrquestrador): ConfiguracaoDoOrquestrador {
    return configuracao.com(this.alteracoes);
  }

  /** Se todos os campos da predefinição estão com o valor dela nesta configuração. */
  correspondeA(configuracao: ConfiguracaoDoOrquestrador): boolean {
    const atual = configuracao.paraDados();
    return (Object.keys(this.alteracoes) as Array<keyof DadosDaConfiguracao>).every((campo) => {
      const esperado = this.alteracoes[campo];
      return esperado === undefined || JSON.stringify(esperado) === JSON.stringify(atual[campo]);
    });
  }

  paraDados(): DadosDaPredefinicao {
    const configuracao: AlteracoesDaConfiguracao = { ...this.alteracoes };
    if (configuracao.quantidadeDeSubagentes !== undefined) {
      configuracao.quantidadeDeSubagentes = { ...configuracao.quantidadeDeSubagentes };
    }
    return { nome: this.nome, rotulo: this.rotulo, descricao: this.descricao, configuracao };
  }
}

/**
 * "Modo econômico": o modo orquestrador chegou a gastar de 1,1× a 2,2× o
 * Claude Code direto no benchmark. Esta predefinição corta o que mais pesa —
 * esforço alto e muitos Subagentes — sem mexer em permissões nem em commit e
 * push. Fazer o trivial sozinho e propor plano em pedidos grandes valem
 * sempre, também aqui (ADR-28).
 */
const ECONOMICO = new PredefinicaoDeConfiguracao(
  "economico",
  "Modo econômico",
  "Orquestrador no Opus e subagentes no Sonnet, os dois com esforço médio; no máximo 1 subagente. " +
    "Permissões e commit/push não mudam.",
  {
    modeloDoOrquestrador: "opus",
    esforcoDoOrquestrador: "medio",
    modeloDosSubagentes: "sonnet",
    esforcoDosSubagentes: "medio",
    quantidadeDeSubagentes: { modo: "automatica", limite: 1 },
  },
);

export const PREDEFINICOES: readonly PredefinicaoDeConfiguracao[] = Object.freeze([ECONOMICO]);

export function predefinicaoPorNome(nome: string): PredefinicaoDeConfiguracao | null {
  return PREDEFINICOES.find((predefinicao) => predefinicao.nome === nome) ?? null;
}

/** A primeira predefinição cujos campos batem com a configuração, ou `null`. */
export function predefinicaoCorrespondente(configuracao: ConfiguracaoDoOrquestrador): NomeDaPredefinicao | null {
  return PREDEFINICOES.find((predefinicao) => predefinicao.correspondeA(configuracao))?.nome ?? null;
}
