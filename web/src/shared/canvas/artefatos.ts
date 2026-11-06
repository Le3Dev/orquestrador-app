import { createContext, createElement, type ReactElement, type ReactNode, useContext, useSyncExternalStore } from "react";

import type { ResumoDoArtefato } from "../api/artefatos";
import { type Ponto, type Retangulo, sobrepoe } from "./layout";
import { areasOcupadas, ehArtefato, ehTerminal, idDoNoDoArtefato, type NoDoCanvas, novoNoDeArtefato } from "./nos";

/* ---------------------------------------------------------------------------
 * Loja: os resumos dos artefatos como o servidor os confirmou.
 *
 * Como a das notas (ADR-13), fica fora do estado do canvas e de `node.data`:
 * um evento de um artefato (versão nova, título novo) re-renderiza só a
 * janela dele, e nunca o canvas nem as outras janelas (ADR-11).
 * ------------------------------------------------------------------------- */

export interface SituacaoDaListaDeArtefatos {
  lista: readonly ResumoDoArtefato[];
  /** A lista já veio do servidor ao menos uma vez. */
  carregada: boolean;
  /** Por que a lista não carregou; nulo depois que carrega. */
  erro: string | null;
}

export interface LojaDosArtefatos {
  ler: (artefatoId: string) => ResumoDoArtefato | undefined;
  lerCarregada: () => boolean;
  lerErroAoCarregar: () => string | null;
  assinar: (aoMudar: () => void) => () => void;
  /** A lista atual. Quem lê um artefato que não mudou recebe o mesmo objeto e não re-renderiza. */
  publicar: (situacao: SituacaoDaListaDeArtefatos) => void;
}

export function criarLojaDosArtefatos(): LojaDosArtefatos {
  let porId = new Map<string, ResumoDoArtefato>();
  let carregada = false;
  let erro: string | null = null;
  let listaAtual: readonly ResumoDoArtefato[] | null = null;
  const ouvintes = new Set<() => void>();

  return {
    ler: (artefatoId) => porId.get(artefatoId),
    lerCarregada: () => carregada,
    lerErroAoCarregar: () => erro,
    assinar: (aoMudar) => {
      ouvintes.add(aoMudar);
      return () => {
        ouvintes.delete(aoMudar);
      };
    },
    publicar: (situacao) => {
      if (situacao.lista === listaAtual && situacao.carregada === carregada && situacao.erro === erro) {
        return;
      }
      if (situacao.lista !== listaAtual) {
        listaAtual = situacao.lista;
        porId = new Map(situacao.lista.map((artefato) => [artefato.id, artefato]));
      }
      carregada = situacao.carregada;
      erro = situacao.erro;
      for (const aoMudar of ouvintes) {
        aoMudar();
      }
    },
  };
}

/** O que a janela de um artefato pede: só o canvas mexe nos nós, e só o hook fala com o servidor. Funções estáveis. */
export interface AcoesDosArtefatos {
  /** PATCH do título; rejeita com a mensagem do servidor (ex.: "Título inválido."). */
  renomear: (artefatoId: string, titulo: string) => Promise<void>;
  /** DELETE; o artefato sai da lista e, com isso, do canvas. */
  apagar: (artefatoId: string) => Promise<void>;
  /** Só tira a janela do canvas (e do layout); o artefato continua no servidor. */
  fechar: (artefatoId: string) => void;
}

/** O valor do contexto dos artefatos: estável, então ler o contexto nunca re-renderiza a janela. */
export interface ValorDosArtefatos {
  loja: LojaDosArtefatos;
  acoes: AcoesDosArtefatos;
}

const ContextoDosArtefatos = createContext<ValorDosArtefatos | null>(null);

export function ProvedorDosArtefatos({ valor, children }: { valor: ValorDosArtefatos; children?: ReactNode }): ReactElement {
  return createElement(ContextoDosArtefatos.Provider, { value: valor }, children);
}

function useValorDosArtefatos(): ValorDosArtefatos {
  const valor = useContext(ContextoDosArtefatos);
  if (valor === null) {
    throw new Error("Os artefatos devem ser usados dentro do ProvedorDosArtefatos.");
  }
  return valor;
}

export function useAcoesDosArtefatos(): AcoesDosArtefatos {
  return useValorDosArtefatos().acoes;
}

/** O artefato como o servidor o confirmou; só muda com os eventos dele. */
export function useArtefato(artefatoId: string): ResumoDoArtefato | undefined {
  const { loja } = useValorDosArtefatos();
  return useSyncExternalStore(loja.assinar, () => loja.ler(artefatoId));
}

export function useListaDeArtefatosCarregada(): boolean {
  const { loja } = useValorDosArtefatos();
  return useSyncExternalStore(loja.assinar, loja.lerCarregada);
}

export function useErroAoCarregarArtefatos(): string | null {
  const { loja } = useValorDosArtefatos();
  return useSyncExternalStore(loja.assinar, loja.lerErroAoCarregar);
}

/* ---------------------------------------------------------------------------
 * Janelas no canvas: onde abrir, quais estão abertas e quais saem.
 * Posição e tamanho vão para o layout do navegador, como os das notas.
 * ------------------------------------------------------------------------- */

/** Distância entre o terminal e a janela do artefato aberta ao lado dele. */
const ESPACO_AO_LADO = 40;
/** Folga mínima entre a janela nova e o que já está no canvas. */
const MARGEM_DO_ARTEFATO = 24;
/** Quantas vezes, no máximo, a janela anda para a direita procurando um lugar livre. */
const TENTATIVAS_PARA_A_DIREITA = 50;

/**
 * O primeiro lugar livre para uma janela do tamanho dado: o primeiro dos
 * `desejados` em que ela (com a folga) não cobre nenhum obstáculo; se nenhum
 * servir, anda para a direita a partir do primeiro, cada passo logo depois do
 * obstáculo mais à direita no caminho — o mesmo jeito dos bixinhos, que
 * descem. Se nada servir, fica o primeiro desejado.
 */
export function lugarLivre(
  desejados: readonly Ponto[],
  tamanho: { largura: number; altura: number },
  obstaculos: readonly Retangulo[],
): Ponto {
  const ocupado = (ponto: Ponto): Retangulo => ({
    x: ponto.x - MARGEM_DO_ARTEFATO,
    y: ponto.y - MARGEM_DO_ARTEFATO,
    largura: tamanho.largura + 2 * MARGEM_DO_ARTEFATO,
    altura: tamanho.altura + 2 * MARGEM_DO_ARTEFATO,
  });
  const noCaminho = (ponto: Ponto): Retangulo[] => obstaculos.filter((obstaculo) => sobrepoe(ocupado(ponto), obstaculo));

  const primeiro = desejados[0];
  if (primeiro === undefined) {
    return { x: 0, y: 0 };
  }
  const livre = desejados.find((ponto) => noCaminho(ponto).length === 0);
  if (livre !== undefined) {
    return livre;
  }
  let ponto = primeiro;
  for (let tentativa = 0; tentativa < TENTATIVAS_PARA_A_DIREITA; tentativa++) {
    const bloqueios = noCaminho(ponto);
    if (bloqueios.length === 0) {
      return ponto;
    }
    ponto = { x: Math.max(...bloqueios.map((obstaculo) => obstaculo.x + obstaculo.largura)) + MARGEM_DO_ARTEFATO, y: ponto.y };
  }
  return primeiro;
}

/**
 * Onde abrir a janela de um artefato. Com o terminal do Orquestrador que o
 * criou aberto (`terminalId`), ao lado dele: à direita, com o topo alinhado,
 * ou à esquerda; sem ele (ou criado pelo chat), centralizada em `centro`. Em
 * qualquer caso, no primeiro lugar livre: não cobre terminais, notas, outros
 * artefatos nem bixinhos.
 */
export function posicaoParaArtefato(
  nos: readonly NoDoCanvas[],
  tamanho: { largura: number; altura: number },
  terminalId: string | null,
  centro: Ponto,
): Ponto {
  const areas = areasOcupadas(nos);
  const terminal = terminalId === null ? undefined : areas.find((area) => area.id === terminalId)?.retangulo;
  const desejados: Ponto[] =
    terminal === undefined
      ? [{ x: centro.x - tamanho.largura / 2, y: centro.y - tamanho.altura / 2 }]
      : [
          { x: terminal.x + terminal.largura + ESPACO_AO_LADO, y: terminal.y },
          { x: terminal.x - ESPACO_AO_LADO - tamanho.largura, y: terminal.y },
        ];
  const { x, y } = lugarLivre(
    desejados,
    tamanho,
    areas.map((area) => area.retangulo),
  );
  return { x: Math.round(x), y: Math.round(y) };
}

/** O id do nó do terminal que criou o artefato, se ele estiver aberto no canvas. */
export function terminalDaOrigem(nos: readonly NoDoCanvas[], artefato: Pick<ResumoDoArtefato, "origem">): string | null {
  const { tipo, id } = artefato.origem;
  if (tipo !== "orquestrador" || id === null) {
    return null;
  }
  return nos.filter(ehTerminal).find((terminal) => terminal.data.orquestradorId === id)?.id ?? null;
}

export function artefatoAberto(nos: readonly NoDoCanvas[], artefatoId: string): boolean {
  const id = idDoNoDoArtefato(artefatoId);
  return nos.some((no) => no.id === id);
}

/**
 * Abre a janela do artefato na posição dada; se já estiver aberta, devolve o
 * mesmo array (nada muda).
 */
export function comArtefatoAberto(nos: NoDoCanvas[], artefatoId: string, posicao: Ponto): NoDoCanvas[] {
  return artefatoAberto(nos, artefatoId) ? nos : [...nos, novoNoDeArtefato(artefatoId, posicao)];
}

/** Fecha a janela do artefato (só no canvas); sem ela aberta, devolve o mesmo array. */
export function semArtefato(nos: NoDoCanvas[], artefatoId: string): NoDoCanvas[] {
  const restantes = nos.filter((no) => !ehArtefato(no) || no.data.artefatoId !== artefatoId);
  return restantes.length === nos.length ? nos : restantes;
}

/**
 * Acerta as janelas com a lista do servidor: as dos artefatos que não existem
 * mais saem do canvas e, com isso, do layout. Nenhuma abre aqui — abrir é só
 * pelo usuário ou quando um artefato é criado. Devolve o mesmo array quando
 * nada muda.
 */
export function sincronizarArtefatos(nos: NoDoCanvas[], existentes: ReadonlySet<string>): NoDoCanvas[] {
  const restantes = nos.filter((no) => !ehArtefato(no) || existentes.has(no.data.artefatoId));
  return restantes.length === nos.length ? nos : restantes;
}
