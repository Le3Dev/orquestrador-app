/**
 * O quanto os agentes de um Orquestrador podem mexer na pasta de trabalho.
 *
 * - `leitura`: só leem arquivos e pesquisam na web;
 * - `edicao`: também criam e alteram arquivos;
 * - `edicao_e_comandos`: também executam comandos no terminal.
 *
 * Em nenhum nível há commit ou push — essa decisão é sempre do usuário.
 */
export const NIVEIS_DE_PERMISSAO = ["leitura", "edicao", "edicao_e_comandos"] as const;

export type NivelDePermissao = (typeof NIVEIS_DE_PERMISSAO)[number];

export function ehNivelDePermissao(valor: unknown): valor is NivelDePermissao {
  return typeof valor === "string" && (NIVEIS_DE_PERMISSAO as readonly string[]).includes(valor);
}

/** Como o nível é explicado ao Orquestrador, para ele planejar dentro do que é permitido. */
export const DESCRICAO_DO_NIVEL: Readonly<Record<NivelDePermissao, string>> = {
  leitura:
    "os subagentes só podem ler arquivos e pesquisar na web; não podem criar, editar nem executar comandos",
  edicao: "os subagentes podem ler, criar e editar arquivos, mas não podem executar comandos no terminal",
  edicao_e_comandos:
    "os subagentes podem ler, criar e editar arquivos e executar comandos no terminal",
};
