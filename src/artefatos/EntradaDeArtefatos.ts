import { OrigemDoArtefato } from "./OrigemDoArtefato";

/**
 * Porta: a pasta onde os agentes entregam os arquivos. O domínio só precisa
 * dela para jogar fora o arquivo de um Artefato apagado — senão ele voltaria
 * na próxima varredura.
 */
export interface EntradaDeArtefatos {
  /** Apaga o arquivo entregue; não existir mais não é erro. */
  removerArquivo(origem: OrigemDoArtefato, arquivo: string): Promise<void>;
}
