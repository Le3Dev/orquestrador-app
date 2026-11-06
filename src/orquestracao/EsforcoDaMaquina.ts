import { EsforcoHerdado } from "./EsforcoHerdado";
import { ModeloClaude } from "./ModeloClaude";

export interface ConsultaDeEsforcoHerdado {
  modelo: ModeloClaude;
  /** Pasta do projeto, onde podem estar as configurações do Claude Code do projeto. */
  pastaDoProjeto: string;
  /** ID do modelo que o agente usou de fato no último turno medido, se houver. */
  modeloReal: string | null;
}

/**
 * Configurações de esforço de raciocínio da máquina do usuário. Porta: a
 * implementação lê o ambiente e os arquivos de configuração do Claude Code.
 */
export interface EsforcoDaMaquina {
  /** Esforço que o Claude Code usaria para este modelo quando o app manda "padrao"; null se nada estiver definido. */
  herdadoPara(consulta: ConsultaDeEsforcoHerdado): Promise<EsforcoHerdado | null>;
}
