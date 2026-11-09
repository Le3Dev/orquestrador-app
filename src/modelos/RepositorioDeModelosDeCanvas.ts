import { DadosDoModeloDeCanvas } from "./ModeloDeCanvas";

/**
 * Os Modelos de canvas do usuário, guardados como uma lista só (são poucos).
 * `todos` lê da memória e devolve cópias; `salvar` troca a lista inteira e
 * passa a valer na hora. Ler e salvar sem espera no meio: duas alterações
 * seguidas nunca se intercalam.
 */
export interface RepositorioDeModelosDeCanvas {
  /** Em ordem de criação, do mais antigo para o mais novo. */
  todos(): DadosDoModeloDeCanvas[];
  /** Resolve quando a lista estiver gravada; gravações seguidas chegam ao disco na ordem pedida. */
  salvar(modelos: readonly DadosDoModeloDeCanvas[]): Promise<void>;
}
