import { ErroDeNota } from "./ErroDeNota";
import { Nota } from "./Nota";
import { RepositorioDeNotas } from "./RepositorioDeNotas";

export interface DependenciasDoServicoDeNotas {
  repositorio: RepositorioDeNotas;
  gerarId: () => string;
  agora: () => Date;
}

export interface PedidoDeNota {
  titulo?: string | undefined;
  texto?: string | undefined;
}

/** Só o que vier preenchido muda; o resto da Nota fica como está. */
export interface AlteracoesDaNota {
  titulo?: string | undefined;
  texto?: string | undefined;
}

/**
 * Casos de uso das Notas: anotar, editar e jogar fora.
 *
 * Não guarda estado: as Notas vêm do repositório; o relógio e o gerador de
 * identidade são injetados.
 */
export class ServicoDeNotas {
  constructor(private readonly dependencias: DependenciasDoServicoDeNotas) {}

  listar(): readonly Nota[] {
    return this.dependencias.repositorio.todas();
  }

  async criar(pedido: PedidoDeNota): Promise<Nota> {
    const { repositorio, gerarId, agora } = this.dependencias;
    const nota = Nota.criar({ id: gerarId(), titulo: pedido.titulo, texto: pedido.texto, agora: agora() });
    await repositorio.salvar(nota);
    return nota;
  }

  /**
   * Aplica as alterações numa cópia buscada do repositório: se alguma for
   * inválida, a exceção descarta a cópia e nada é gravado pela metade.
   */
  async editar(id: string, alteracoes: AlteracoesDaNota): Promise<Nota> {
    const { repositorio, agora } = this.dependencias;
    const nota = this.buscar(id);
    const instante = agora();
    if (alteracoes.titulo !== undefined) {
      nota.renomear(alteracoes.titulo, instante);
    }
    if (alteracoes.texto !== undefined) {
      nota.reescrever(alteracoes.texto, instante);
    }
    await repositorio.salvar(nota);
    return nota;
  }

  async remover(id: string): Promise<void> {
    this.buscar(id);
    await this.dependencias.repositorio.remover(id);
  }

  private buscar(id: string): Nota {
    const nota = this.dependencias.repositorio.buscar(id);
    if (nota === null) {
      throw new ErroDeNota("nao_encontrada", "Nota não encontrada.");
    }
    return nota;
  }
}
