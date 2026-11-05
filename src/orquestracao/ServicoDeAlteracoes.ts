import {
  AlteracoesDoWorktree,
  ArquivoAlterado,
  DiffDoArquivo,
  ErroDeLeituraDasAlteracoes,
  LeitorDeAlteracoes,
} from "./AlteracoesDoWorktree";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { Orquestrador } from "./Orquestrador";
import { RepositorioDeOrquestradores } from "./RepositorioDeOrquestradores";

export interface DependenciasDoServicoDeAlteracoes {
  repositorio: RepositorioDeOrquestradores;
  leitor: LeitorDeAlteracoes;
}

/**
 * Casos de uso do painel de alterações: o que o Orquestrador deixou por
 * commitar no worktree e o diff de cada arquivo. Só leitura — nada é gravado
 * no agregado nem no worktree. Stateless: tudo vem das dependências.
 */
export class ServicoDeAlteracoes {
  constructor(private readonly dependencias: DependenciasDoServicoDeAlteracoes) {}

  /**
   * Sem worktree, diz se a pasta é repositório git (`sem_worktree`) ou não
   * (`sem_git`). Com worktree, lista o que nele não foi commitado.
   */
  async consultar(orquestradorId: string): Promise<AlteracoesDoWorktree> {
    const orquestrador = this.buscar(orquestradorId);
    const worktree = orquestrador.worktree;
    const pastaOriginal = orquestrador.pastaDeTrabalho.caminho;
    const { leitor } = this.dependencias;
    try {
      if (worktree === null) {
        return (await leitor.ehRepositorioComHead(pastaOriginal))
          ? AlteracoesDoWorktree.semWorktree()
          : AlteracoesDoWorktree.semGit();
      }
      const [arquivos, commitsNaBranch] = await Promise.all([
        leitor.listarArquivos(worktree.caminho),
        leitor.contarCommitsNaBranch(worktree.caminho, pastaOriginal),
      ]);
      return AlteracoesDoWorktree.comWorktree({
        branch: worktree.branch,
        caminho: worktree.caminho,
        emUso: worktree.ativo,
        commitsNaBranch,
        arquivos,
      });
    } catch (falha) {
      throw new ErroDeLeituraDasAlteracoes(falha);
    }
  }

  /**
   * O diff de um arquivo. O caminho pedido só vale se estiver, exatamente
   * igual, na lista atual de alterações: nunca se monta caminho a partir dele.
   */
  async lerDiff(orquestradorId: string, caminhoDoArquivo: string): Promise<DiffDoArquivo> {
    const orquestrador = this.buscar(orquestradorId);
    const worktree = orquestrador.worktree;
    if (worktree === null) {
      throw arquivoForaDaLista();
    }
    const { leitor } = this.dependencias;
    let arquivo: ArquivoAlterado | undefined;
    try {
      arquivo = (await leitor.listarArquivos(worktree.caminho)).find(
        (candidato) => candidato.caminho === caminhoDoArquivo,
      );
    } catch (falha) {
      throw new ErroDeLeituraDasAlteracoes(falha);
    }
    if (arquivo === undefined) {
      throw arquivoForaDaLista();
    }
    try {
      return await leitor.lerDiff(worktree.caminho, arquivo);
    } catch (falha) {
      throw new ErroDeLeituraDasAlteracoes(falha);
    }
  }

  private buscar(orquestradorId: string): Orquestrador {
    const orquestrador = this.dependencias.repositorio.buscarPorId(orquestradorId);
    if (orquestrador === null) {
      throw new ErroDeOrquestracao("nao_encontrado", "Orquestrador não encontrado.");
    }
    return orquestrador;
  }
}

function arquivoForaDaLista(): ErroDeOrquestracao {
  return new ErroDeOrquestracao("nao_encontrado", "Arquivo não está entre as alterações.");
}
