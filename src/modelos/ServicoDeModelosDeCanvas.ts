import { ErroDeModeloDeCanvas } from "./ErroDeModeloDeCanvas";
import {
  AlteracaoDoModeloDeCanvas,
  ArquivoDoModeloDeCanvas,
  ConteudoDoModeloDeCanvas,
  DadosDoModeloDeCanvas,
  FORMATO_DO_ARQUIVO,
  MAXIMO_DE_MODELOS,
  semCaminhosNemSegredos,
  VERSAO_DO_ARQUIVO,
} from "./ModeloDeCanvas";
import { RepositorioDeModelosDeCanvas } from "./RepositorioDeModelosDeCanvas";

export interface DependenciasDoServicoDeModelosDeCanvas {
  repositorio: RepositorioDeModelosDeCanvas;
  gerarId: () => string;
  agora: () => Date;
}

/**
 * Casos de uso dos Modelos de canvas: salvar um arranjo, renomear, apagar e
 * exportar. Recriar não passa por aqui: a tela cria cada item pela API dele.
 * O conteúdo chega já validado (`esquemaDoConteudoDoModelo`, na rota).
 */
export class ServicoDeModelosDeCanvas {
  constructor(private readonly dependencias: DependenciasDoServicoDeModelosDeCanvas) {}

  listar(): DadosDoModeloDeCanvas[] {
    return this.dependencias.repositorio.todos();
  }

  async criar(conteudo: ConteudoDoModeloDeCanvas): Promise<DadosDoModeloDeCanvas> {
    const { repositorio, gerarId, agora } = this.dependencias;
    const modelos = repositorio.todos();
    if (modelos.length >= MAXIMO_DE_MODELOS) {
      throw new ErroDeModeloDeCanvas(
        "limite_atingido",
        `Você já tem ${MAXIMO_DE_MODELOS} modelos. Apague um antes de salvar outro.`,
      );
    }
    const instante = agora().toISOString();
    const modelo: DadosDoModeloDeCanvas = { ...conteudo, id: gerarId(), criadoEm: instante, atualizadoEm: instante };
    await repositorio.salvar([...modelos, modelo]);
    return modelo;
  }

  /** Só o que vier muda; trocar pelo mesmo valor não conta como alteração. */
  async alterar(id: string, alteracao: AlteracaoDoModeloDeCanvas): Promise<DadosDoModeloDeCanvas> {
    const { repositorio, agora } = this.dependencias;
    const modelos = repositorio.todos();
    const atual = this.buscarEm(modelos, id);
    const novo = {
      ...atual,
      ...(alteracao.nome === undefined ? {} : { nome: alteracao.nome }),
      ...(alteracao.icone === undefined ? {} : { icone: alteracao.icone }),
      ...(alteracao.cor === undefined ? {} : { cor: alteracao.cor }),
    };
    if (novo.nome === atual.nome && novo.icone === atual.icone && novo.cor === atual.cor) {
      return atual;
    }
    novo.atualizadoEm = agora().toISOString();
    await repositorio.salvar(modelos.map((modelo) => (modelo.id === id ? novo : modelo)));
    return novo;
  }

  async remover(id: string): Promise<void> {
    const { repositorio } = this.dependencias;
    const modelos = repositorio.todos();
    this.buscarEm(modelos, id);
    await repositorio.salvar(modelos.filter((modelo) => modelo.id !== id));
  }

  /**
   * O arquivo para baixar. `semCaminhos` (o padrão da tela) tira as pastas, os
   * comandos e o que parece segredo (`semCaminhosNemSegredos`).
   */
  exportar(id: string, { semCaminhos }: { semCaminhos: boolean }): ArquivoDoModeloDeCanvas {
    const { nome, icone, cor, itens } = this.buscarEm(this.dependencias.repositorio.todos(), id);
    const conteudo = { nome, icone, cor, itens };
    return {
      formato: FORMATO_DO_ARQUIVO,
      versao: VERSAO_DO_ARQUIVO,
      exportadoEm: this.dependencias.agora().toISOString(),
      modelo: semCaminhos ? semCaminhosNemSegredos(conteudo) : conteudo,
    };
  }

  private buscarEm(modelos: readonly DadosDoModeloDeCanvas[], id: string): DadosDoModeloDeCanvas {
    const modelo = modelos.find((candidato) => candidato.id === id);
    if (modelo === undefined) {
      throw new ErroDeModeloDeCanvas("nao_encontrado", "Modelo não encontrado.");
    }
    return modelo;
  }
}
