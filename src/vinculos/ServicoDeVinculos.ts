import type { OrigemDoPedido } from "../orquestracao/PedidoNaFila";
import type { VinculoDoOrquestrador, VinculosDoOrquestrador } from "../orquestracao/VinculosDoOrquestrador";
import {
  LIMITE_DE_SALTOS,
  MensagemParaVinculado,
  NotasParaVinculo,
  passouDoLimiteDeSaltos,
  saltosDaMensagemEnviadaPor,
} from "./BlocosDeVinculo";
import { ErroDeVinculo } from "./ErroDeVinculo";
import { RepositorioDeVinculos } from "./RepositorioDeVinculos";
import { Vinculo } from "./Vinculo";

/** Os Orquestradores existentes, vistos só pela identidade e pelo nome. */
export interface OrquestradoresConhecidos {
  /** O nome do Orquestrador, ou `null` se ele não existe. */
  nomeDe(orquestradorId: string): string | null;
}

/** Coloca a mensagem direto na fila do destino, sem aprovação; recusa (lança) se não couber. */
export type EntregaDeMensagem = (destinoId: string, texto: string, origem: OrigemDoPedido) => Promise<void>;

export interface DependenciasDoServicoDeVinculos {
  repositorio: RepositorioDeVinculos;
  orquestradores: OrquestradoresConhecidos;
  entregar: EntregaDeMensagem;
  gerarId: () => string;
  agora: () => Date;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Casos de uso dos Vínculos: ligar dois Orquestradores, desligá-los, manter as
 * notas compartilhadas e levar mensagens de um ao outro.
 *
 * Não guarda estado: os Vínculos vêm do repositório. Implementa a porta que a
 * orquestração usa (`VinculosDoOrquestrador`).
 */
export class ServicoDeVinculos implements VinculosDoOrquestrador {
  constructor(private readonly dependencias: DependenciasDoServicoDeVinculos) {}

  listar(): readonly Vinculo[] {
    return this.dependencias.repositorio.todos();
  }

  /** Os dois Orquestradores precisam existir; o par não se repete, em nenhuma ordem. */
  async vincular(orquestradorAId: string, orquestradorBId: string): Promise<Vinculo> {
    const { repositorio, orquestradores, gerarId, agora } = this.dependencias;
    // Antes de tudo: dois iguais é erro do pedido, exista ou não o Orquestrador.
    const vinculo = Vinculo.criar({ id: gerarId(), orquestradorAId, orquestradorBId, agora: agora() });
    for (const id of [orquestradorAId, orquestradorBId]) {
      if (orquestradores.nomeDe(id) === null) {
        throw new ErroDeVinculo("nao_encontrado", "Orquestrador não encontrado.");
      }
    }
    if (repositorio.todos().some((existente) => existente.ehEntre(orquestradorAId, orquestradorBId))) {
      throw new ErroDeVinculo("ja_vinculados", "Esses orquestradores já estão vinculados.");
    }
    await repositorio.salvar(vinculo);
    return vinculo;
  }

  async desvincular(id: string): Promise<void> {
    this.buscar(id);
    await this.dependencias.repositorio.remover(id);
  }

  async editarNotas(id: string, texto: string): Promise<Vinculo> {
    const { repositorio, agora } = this.dependencias;
    const vinculo = this.buscar(id);
    vinculo.reescreverNotas(texto, agora());
    await repositorio.salvar(vinculo);
    return vinculo;
  }

  /**
   * Mensagem escrita pelo usuário em nome de um dos lados: vai direto para a
   * fila do outro, como as dos agentes, mas começa a contagem de saltos do zero.
   */
  async enviarMensagem(id: string, deOrquestradorId: string, texto: string): Promise<void> {
    const { orquestradores, entregar } = this.dependencias;
    const vinculo = this.buscar(id);
    const destinoId = vinculo.parceiroDe(deOrquestradorId);
    if (destinoId === null) {
      throw new ErroDeVinculo("dados_invalidos", "O remetente não faz parte deste vínculo.");
    }
    if (texto.trim() === "") {
      throw new ErroDeVinculo("dados_invalidos", "Escreva a mensagem.");
    }
    const nome = orquestradores.nomeDe(deOrquestradorId);
    if (nome === null) {
      throw new ErroDeVinculo("nao_encontrado", "Orquestrador não encontrado.");
    }
    await entregar(destinoId, texto, { orquestradorId: deOrquestradorId, nome, saltos: 0 });
  }

  doOrquestrador(orquestradorId: string): readonly VinculoDoOrquestrador[] {
    return this.dependencias.repositorio.todos().flatMap((vinculo) => {
      const parceiroId = vinculo.parceiroDe(orquestradorId);
      return parceiroId === null ? [] : [{ vinculoId: vinculo.id, parceiroId, notas: vinculo.notas }];
    });
  }

  async processarBlocos(
    remetenteId: string,
    blocos: { mensagens: readonly MensagemParaVinculado[]; notas: readonly NotasParaVinculo[] },
    origemDoTurno: { saltos: number } | null,
  ): Promise<string[]> {
    const { orquestradores, entregar } = this.dependencias;
    const avisos: string[] = [];
    const nomeDoRemetente = orquestradores.nomeDe(remetenteId);
    if (nomeDoRemetente === null) {
      return avisos;
    }

    for (const bloco of blocos.notas) {
      const alvo = this.resolverVinculado(remetenteId, bloco.com);
      if (typeof alvo === "string") {
        avisos.push(`Notas do vínculo não gravadas: ${alvo}`);
        continue;
      }
      try {
        await this.editarNotas(alvo.vinculoId, bloco.texto);
      } catch (erro) {
        avisos.push(`Notas do vínculo com "${bloco.com}" não gravadas: ${descreverErro(erro)}`);
      }
    }

    const saltos = saltosDaMensagemEnviadaPor(origemDoTurno);
    for (const bloco of blocos.mensagens) {
      const alvo = this.resolverVinculado(remetenteId, bloco.para);
      if (typeof alvo === "string") {
        avisos.push(`Mensagem não enviada: ${alvo}`);
        continue;
      }
      if (passouDoLimiteDeSaltos(saltos)) {
        avisos.push(
          `Mensagem para "${bloco.para}" descartada: a conversa entre vinculados passou do limite de ${LIMITE_DE_SALTOS} mensagens encadeadas.`,
        );
        continue;
      }
      try {
        await entregar(alvo.parceiroId, bloco.texto, { orquestradorId: remetenteId, nome: nomeDoRemetente, saltos });
      } catch (erro) {
        avisos.push(`Mensagem para "${bloco.para}" não enviada: ${descreverErro(erro)}`);
      }
    }
    return avisos;
  }

  async removerDoOrquestrador(orquestradorId: string): Promise<void> {
    const { repositorio } = this.dependencias;
    const dele = repositorio.todos().filter((vinculo) => vinculo.envolve(orquestradorId));
    await Promise.all(dele.map((vinculo) => repositorio.remover(vinculo.id)));
  }

  /**
   * O vínculo do remetente com o parceiro que o texto indica (identidade ou
   * nome, sem diferenciar maiúsculas), ou a frase do porquê de não achar.
   */
  private resolverVinculado(remetenteId: string, nomeOuId: string): { vinculoId: string; parceiroId: string } | string {
    const { orquestradores } = this.dependencias;
    const procurado = nomeOuId.trim().toLowerCase();
    const candidatos = this.doOrquestrador(remetenteId).filter(({ parceiroId }) => {
      const nome = orquestradores.nomeDe(parceiroId);
      return parceiroId.toLowerCase() === procurado || nome?.trim().toLowerCase() === procurado;
    });
    if (candidatos.length === 0) {
      return `"${nomeOuId}" não é um orquestrador vinculado a este.`;
    }
    const [unico] = candidatos;
    if (candidatos.length > 1 || unico === undefined) {
      return `mais de um vinculado se chama "${nomeOuId}": use o id.`;
    }
    return { vinculoId: unico.vinculoId, parceiroId: unico.parceiroId };
  }

  private buscar(id: string): Vinculo {
    const vinculo = this.dependencias.repositorio.buscar(id);
    if (vinculo === null) {
      throw new ErroDeVinculo("nao_encontrado", "Vínculo não encontrado.");
    }
    return vinculo;
  }
}
