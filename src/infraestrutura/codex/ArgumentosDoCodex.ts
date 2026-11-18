import { NOME_DO_SERVIDOR_MCP } from "../mcp/ServidorMcpDoApp";
import { ContextoDePermissao, nivelEfetivo } from "../motores/PoliticaDePermissao";

/** O app decide cada comando e cada alteração: o Codex pergunta sobre tudo o que não é leitura conhecida. */
export const POLITICA_DE_APROVACAO_DO_CODEX = "untrusted";

/** A variável do processo com o token do servidor MCP do app (o Codex a lê em `bearer_token_env_var`). */
export const VARIAVEL_DO_TOKEN_MCP = "ORQUESTRADOR_MCP_TOKEN_DO_TURNO";

export type ModoDoSandboxDoCodex = "read-only" | "workspace-write";

/**
 * O sandbox do Codex, a segunda barreira depois da política do app (que
 * responde a cada pedido de aprovação):
 * - leitura e planejamento: `read-only`;
 * - edição e edição com comandos: `workspace-write` (a pasta de trabalho e a de
 *   artefatos gravam; o `.git` fica protegido pelo próprio Codex).
 */
export function modoDoSandbox(contexto: Pick<ContextoDePermissao, "nivel" | "modo">): ModoDoSandboxDoCodex {
  return nivelEfetivo(contexto) === "leitura" ? "read-only" : "workspace-write";
}

/**
 * O `sandboxPolicy` de um turno. No `workspace-write` a rede só vale com
 * terminal liberado (instalar dependências, baixar pacotes), e a pasta de
 * artefatos entra como pasta gravável.
 */
export function politicaDeSandboxDoTurno(contexto: ContextoDePermissao): Record<string, unknown> {
  if (modoDoSandbox(contexto) === "read-only") {
    return { type: "readOnly" };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [contexto.pastaDeArtefatos],
    networkAccess: nivelEfetivo(contexto) === "edicao_e_comandos",
  };
}

/**
 * Quanto uma chamada de ferramenta do app pode levar (em segundos). O padrão do
 * Codex é 60 s, e `delegar_subtarefas` espera subagentes que levam minutos.
 */
export const TEMPO_MAXIMO_DA_FERRAMENTA_DO_APP_S = 3_600;

/**
 * O `config` de uma thread: o servidor MCP do app (HTTP, com o token numa
 * variável de ambiente, para ele não aparecer na linha de comando), com as
 * ferramentas já aprovadas — o app não precisa perguntar a si mesmo — e com
 * tempo de sobra para a delegação.
 */
export function configuracaoDaThread(servidorMcp: { url: string } | null): Record<string, unknown> {
  if (servidorMcp === null) {
    return {};
  }
  return {
    mcp_servers: {
      [NOME_DO_SERVIDOR_MCP]: {
        url: servidorMcp.url,
        bearer_token_env_var: VARIAVEL_DO_TOKEN_MCP,
        default_tools_approval_mode: "approve",
        tool_timeout_sec: TEMPO_MAXIMO_DA_FERRAMENTA_DO_APP_S,
      },
    },
  };
}
