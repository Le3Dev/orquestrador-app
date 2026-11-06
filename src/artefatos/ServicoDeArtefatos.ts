import { Artefato, FormatoDoArtefato } from "./Artefato";
import { EntradaDeArtefatos } from "./EntradaDeArtefatos";
import {
  ErroDeArtefato,
  MENSAGEM_DE_ARTEFATO_NAO_ENCONTRADO,
  MENSAGEM_DE_VERSAO_NAO_ENCONTRADA,
} from "./ErroDeArtefato";
import { PublicadorDeArtefatos } from "./EventoDeArtefato";
import { OrigemDoArtefato } from "./OrigemDoArtefato";
import { RepositorioDeArtefatos } from "./RepositorioDeArtefatos";

export interface DependenciasDoServicoDeArtefatos {
  repositorio: RepositorioDeArtefatos;
  entrada: EntradaDeArtefatos;
  publicador: PublicadorDeArtefatos;
  gerarId: () => string;
  agora: () => Date;
}

/** Um arquivo entregue na pasta de entrada, já lido e com o hash calculado. */
export interface ArquivoColetado {
  origem: OrigemDoArtefato;
  /** Nome do arquivo na pasta de entrada da origem. */
  arquivo: string;
  conteudo: Buffer;
  /** sha256 do conteúdo, em hexadecimal. */
  hash: string;
}

export type ResultadoDaColeta = "criado" | "versao_adicionada" | "sem_mudanca";

export interface ConteudoDaVersaoLida {
  formato: FormatoDoArtefato;
  conteudo: Buffer;
}

/**
 * Casos de uso dos Artefatos: coletar o que os agentes entregam, consultar,
 * renomear e jogar fora.
 *
 * Não guarda estado: os Artefatos vêm do repositório; o relógio e o gerador
 * de identidade são injetados.
 */
export class ServicoDeArtefatos {
  constructor(private readonly dependencias: DependenciasDoServicoDeArtefatos) {}

  /** Do atualizado mais recentemente para o mais antigo. */
  listar(): readonly Artefato[] {
    return this.dependencias.repositorio.todos();
  }

  buscar(id: string): Artefato {
    const artefato = this.dependencias.repositorio.buscar(id);
    if (artefato === null) {
      throw new ErroDeArtefato("nao_encontrado", MENSAGEM_DE_ARTEFATO_NAO_ENCONTRADO);
    }
    return artefato;
  }

  /**
   * Um arquivo foi entregue (ou regravado) na entrada: cria o Artefato ou
   * adiciona uma versão. Conteúdo igual ao da última versão não muda nada.
   *
   * Entre buscar e salvar não há espera: duas coletas do mesmo arquivo ao
   * mesmo tempo não criam dois Artefatos nem duplicam a versão.
   */
  async coletar({ origem, arquivo, conteudo, hash }: ArquivoColetado): Promise<ResultadoDaColeta> {
    const { repositorio, publicador, gerarId, agora } = this.dependencias;
    const existente = repositorio.buscarPorArquivo(origem, arquivo);

    if (existente === null) {
      const artefato = Artefato.criar({ id: gerarId(), origem, arquivo, hash, tamanho: conteudo.length, agora: agora() });
      await repositorio.salvar(artefato, { numero: artefato.versaoAtual.numero, conteudo });
      publicador.publicar({ tipo: "artefato_criado", artefato: artefato.paraDados() });
      return "criado";
    }

    const versao = existente.adicionarVersao(hash, conteudo.length, agora());
    if (versao === null) {
      return "sem_mudanca";
    }
    await repositorio.salvar(existente, { numero: versao.numero, conteudo });
    publicador.publicar({ tipo: "versao_adicionada", artefato: existente.paraDados() });
    return "versao_adicionada";
  }

  async lerVersao(id: string, numero: number): Promise<ConteudoDaVersaoLida> {
    const artefato = this.buscar(id);
    if (artefato.versao(numero) === null) {
      throw new ErroDeArtefato("nao_encontrado", MENSAGEM_DE_VERSAO_NAO_ENCONTRADA);
    }
    const conteudo = await this.dependencias.repositorio.lerConteudo(id, numero);
    if (conteudo === null) {
      throw new ErroDeArtefato("nao_encontrado", MENSAGEM_DE_VERSAO_NAO_ENCONTRADA);
    }
    return { formato: artefato.formato, conteudo };
  }

  /** Trocar pelo mesmo título não grava nem avisa as telas. */
  async renomear(id: string, titulo: string): Promise<Artefato> {
    const { repositorio, publicador, agora } = this.dependencias;
    const artefato = this.buscar(id);
    if (!artefato.renomear(titulo, agora())) {
      return artefato;
    }
    await repositorio.salvar(artefato);
    publicador.publicar({ tipo: "artefato_renomeado", artefato: artefato.paraDados() });
    return artefato;
  }

  /**
   * Apaga o Artefato e também o arquivo dele na entrada: sem isso, a próxima
   * varredura o traria de volta. O arquivo sai primeiro; se não der para
   * apagá-lo, o Artefato fica.
   */
  async remover(id: string): Promise<void> {
    const { repositorio, entrada, publicador } = this.dependencias;
    const artefato = this.buscar(id);
    await entrada.removerArquivo(artefato.origem, artefato.arquivo);
    if (repositorio.buscar(id) === null) {
      // Outro pedido de remoção chegou primeiro.
      return;
    }
    await repositorio.remover(id);
    publicador.publicar({ tipo: "artefato_removido", id });
  }
}
