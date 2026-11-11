/**
 * A lógica da faixa de servidores acima do prompt do orquestrador: quais
 * endereços ela lista e como um servidor tirado da lista volta.
 */

import { enderecosParaPrevia, LIMITE_DE_ENDERECOS } from "./enderecosLocais";

/** De quanto em quanto tempo a faixa confere se os servidores listados ainda respondem. */
export const INTERVALO_DA_CONSULTA_MS = 15_000;

/** Quanto tempo seguido parado até o servidor sair sozinho da faixa. */
export const TEMPO_PARADO_ATE_SAIR_MS = 5 * 60_000;

/** Quantos chips ficam à vista; o resto espera no "+N". */
export const CHIPS_A_VISTA = 3;

/** `$`, `{` e `}` num endereço são lixo de código (`${v`) que um agente citou; endereço de verdade não tem. */
const LIXO_DE_CODIGO = /[${}]/;

export function enderecoSemLixo(endereco: string): boolean {
  return !LIXO_DE_CODIGO.test(endereco);
}

/**
 * Os servidores que a faixa lista, o mais recente primeiro: os da conversa
 * (`enderecos`), menos os da própria tela, os com lixo de código e os que o
 * usuário tirou (`tirados`: endereço e a sequência do anúncio dele quando foi
 * tirado). Um anúncio com sequência maior que a de quando foi tirado, o traz de volta.
 */
export function servidoresDaFaixa(
  enderecos: readonly string[],
  sequencias: Readonly<Record<string, number>>,
  tirados: Readonly<Record<string, number>>,
  origemDaTela: string,
): string[] {
  const candidatos = enderecos.filter(enderecoSemLixo);
  return enderecosParaPrevia(candidatos, origemDaTela, LIMITE_DE_ENDERECOS).filter((endereco) => {
    const tiradoEm = tirados[endereco];
    return tiradoEm === undefined || (sequencias[endereco] ?? 0) > tiradoEm;
  });
}

/** Os `tirados` com os `enderecos` a mais, cada um com a sequência do último anúncio dele. */
export function tirarServidores(
  tirados: Readonly<Record<string, number>>,
  enderecos: readonly string[],
  sequencias: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const novos = { ...tirados };
  for (const endereco of enderecos) {
    novos[endereco] = sequencias[endereco] ?? 0;
  }
  return novos;
}
