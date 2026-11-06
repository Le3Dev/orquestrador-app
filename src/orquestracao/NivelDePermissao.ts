/**
 * O quanto os agentes de um Orquestrador podem mexer na pasta de trabalho.
 *
 * - `leitura`: só leem arquivos e pesquisam na web (e gravam artefatos na
 *   pasta de artefatos do pedido, a única exceção — ver `DESCRICAO_DO_NIVEL`);
 * - `edicao`: também criam e alteram arquivos;
 * - `edicao_e_comandos`: também executam comandos no terminal.
 *
 * Com a opção `permitirTrabalhoDireto` ligada, o Orquestrador também lê,
 * busca e roda comandos curtos ele mesmo, dentro do nível — mas nunca edita
 * arquivos: toda alteração vai para um Subagente.
 *
 * Commit e push não dependem do nível: ficam proibidos, a menos que o usuário
 * ligue a opção `permitirCommitEPush` da configuração — e, mesmo assim, só
 * acontecem quando ele pede, num turno de execução, e só no nível
 * `edicao_e_comandos`, o único com terminal.
 */
export const NIVEIS_DE_PERMISSAO = ["leitura", "edicao", "edicao_e_comandos"] as const;

export type NivelDePermissao = (typeof NIVEIS_DE_PERMISSAO)[number];

export function ehNivelDePermissao(valor: unknown): valor is NivelDePermissao {
  return typeof valor === "string" && (NIVEIS_DE_PERMISSAO as readonly string[]).includes(valor);
}

/**
 * Como o nível é explicado ao Orquestrador, para ele planejar dentro do que é
 * permitido. Descreve os Subagentes, que fazem toda alteração; o que o próprio
 * Orquestrador faz sem delegar está em `TRABALHO_DIRETO_NO_NIVEL`.
 *
 * Em todo nível (e no planejamento, que usa a descrição de `leitura`), gravar
 * artefatos na pasta de artefatos do pedido é permitido (ADR-26): em `leitura`
 * isso é a única exceção ao "não podem criar nem editar"; nos outros níveis,
 * criar arquivos já é permitido.
 */
export const DESCRICAO_DO_NIVEL: Readonly<Record<NivelDePermissao, string>> = {
  leitura:
    "os subagentes só podem ler arquivos e pesquisar na web; não podem criar, editar nem executar comandos — a única exceção é gravar artefatos na pasta de artefatos do pedido",
  edicao: "os subagentes podem ler, criar e editar arquivos, mas não podem executar comandos no terminal",
  edicao_e_comandos:
    "os subagentes podem ler, criar e editar arquivos e executar comandos no terminal",
};

/**
 * O trivial que o Orquestrador pode fazer ele mesmo em cada nível, quando a
 * opção `permitirTrabalhoDireto` está ligada. Usa as mesmas ferramentas do
 * nível, mas nunca para editar: alterações ficam sempre com os Subagentes.
 * Só no nível `edicao_e_comandos` há terminal.
 */
export const TRABALHO_DIRETO_NO_NIVEL: Readonly<Record<NivelDePermissao, string>> = {
  leitura:
    "ler ou buscar em poucos arquivos/trechos, conferir um estado e responder — neste pedido você não tem terminal",
  edicao:
    "ler ou buscar em poucos arquivos/trechos, conferir um estado e responder — neste pedido você não tem terminal",
  edicao_e_comandos:
    "ler ou buscar em poucos arquivos/trechos, conferir um estado, rodar um comando curto (ex.: git status, listar pasta) e responder",
};
