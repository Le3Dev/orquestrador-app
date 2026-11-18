import { Artefato } from "./Artefato";
import { DesenhoGravado } from "./DesenhoDoArtefato";
import { OrigemDoArtefato } from "./OrigemDoArtefato";

/** O conteúdo de uma versão nova, gravado junto com o Artefato. */
export interface ConteudoDaVersao {
  numero: number;
  conteudo: Buffer;
}

/**
 * Os Artefatos, tratados como uma coleção em memória.
 *
 * As leituras são síncronas de propósito: entre buscar um Artefato, alterá-lo
 * e salvá-lo não há espera, então duas coletas do mesmo arquivo nunca se
 * intercalam — a segunda sempre parte do que a primeira gravou (e não
 * duplica a versão).
 *
 * `buscar`, `buscarPorArquivo` e `todos` devolvem cópias: alterar um
 * Artefato buscado não muda nada no repositório até ele ser salvo.
 */
export interface RepositorioDeArtefatos {
  /** Do atualizado mais recentemente para o mais antigo. */
  todos(): readonly Artefato[];
  buscar(id: string): Artefato | null;
  /** O Artefato que veio deste arquivo, desta origem (a chave da coleta). */
  buscarPorArquivo(origem: OrigemDoArtefato, arquivo: string): Artefato | null;
  /**
   * Resolve quando o Artefato (e o conteúdo da versão nova, se vier) estiver
   * gravado. O conteúdo é gravado antes do Artefato: o Artefato no disco
   * nunca aponta para uma versão sem conteúdo.
   */
  salvar(artefato: Artefato, novaVersao?: ConteudoDaVersao): Promise<void>;
  /** O conteúdo bruto de uma versão; `null` se o Artefato ou a versão não existirem. */
  lerConteudo(id: string, numero: number): Promise<Buffer | null>;
  /**
   * O desenho feito sobre uma versão; sem traços e com largura `null` se a
   * versão não tem desenho, e `null` se o Artefato ou a versão não existirem.
   */
  lerDesenho(id: string, numero: number): Promise<DesenhoGravado | null>;
  /**
   * Troca o desenho inteiro da versão (sem traços, apaga, e a largura não
   * conta). Resolve com `false`, sem gravar nada, se o Artefato ou a versão
   * não existirem.
   */
  salvarDesenho(id: string, numero: number, desenho: DesenhoGravado): Promise<boolean>;
  /** Remove o Artefato com todas as versões (e os desenhos delas). */
  remover(id: string): Promise<void>;
}
