import type { PerguntaAoMotorDeChat } from "../../chat/MotorDeChat";
import type { EsforcoDeRaciocinio } from "../../orquestracao/EsforcoDeRaciocinio";
import { ambienteSemSessaoPai, nivelDeEsforcoDoClaudeCode, VARIAVEL_DE_ESFORCO } from "./ArgumentosDoClaudeCode";

/**
 * As únicas ferramentas do chat rápido: pesquisar na web e ler (sem editar,
 * sem terminal, sem Subagentes).
 */
export const FERRAMENTAS_DO_CHAT: readonly string[] = ["WebSearch", "WebFetch", "Read", "Glob", "Grep"];

/** Arquivos de ambiente (`.env`, `.env.local`, `.env.production`…): podem guardar segredos. */
const ARQUIVOS_DE_AMBIENTE = ".env*";

/** Caracteres de padrão do gitignore que, num caminho real, devem valer literalmente. */
const CARACTERES_DE_PADRAO = /[[\]*?]/g;

/**
 * Caminho absoluto no formato das regras de permissão do Claude Code: o
 * Windows é normalizado para POSIX antes da comparação (`C:\Users\x` vira
 * `/c/Users/x`) e o caminho absoluto leva `//` na frente
 * (https://code.claude.com/docs/en/permissions, "How path patterns match").
 */
export function caminhoParaRegraDePermissao(caminho: string): string {
  const posix = caminho
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):(?=\/|$)/, (_, unidade: string) => `/${unidade.toLowerCase()}`)
    .replace(/\/+$/, "");
  const escapado = posix.replace(CARACTERES_DE_PADRAO, (caractere) => `\\${caractere}`);
  return `/${escapado.startsWith("/") ? escapado : `/${escapado}`}`;
}

/**
 * Regras de negação de leitura dos arquivos de ambiente. Uma ancorada na raiz
 * dos projetos (qualquer subpasta, caminho absoluto) e outra relativa à pasta
 * da sessão (nome solto casa em qualquer profundidade, como no gitignore).
 *
 * `Read` negado vale também para o Glob e o Grep, no esforço que o Claude Code
 * faz de aplicar as regras de leitura a todas as ferramentas que leem arquivos.
 */
export function regrasDeNegacaoDoChat(pastaDosProjetos: string): string[] {
  return [
    `Read(${caminhoParaRegraDePermissao(pastaDosProjetos)}/**/${ARQUIVOS_DE_AMBIENTE})`,
    `Read(${ARQUIVOS_DE_AMBIENTE})`,
  ];
}

export interface ArquivosDoChat {
  /** Arquivo temporário com as instruções; vai em `--append-system-prompt-file`. */
  instrucoes: string;
}

/**
 * Linha de comando do `claude -p` para uma pergunta do chat rápido.
 *
 * Mesmo desenho dos turnos dos Orquestradores: a mensagem vai pelo stdin em
 * `stream-json` (texto e imagens), as instruções em arquivo. A diferença é o
 * `--include-partial-messages`, que entrega a resposta em pedaços enquanto é
 * gerada, e o conjunto fechado de ferramentas de leitura e pesquisa.
 *
 * A raiz dos projetos entra em `--add-dir` para leitura: sem `Edit`/`Write`
 * nas ferramentas, a pasta adicional não dá como alterar nada.
 *
 * `--disallowedTools` é variádica e fica por último, para não engolir as
 * opções seguintes.
 */
export function montarArgumentosDoChat(pergunta: PerguntaAoMotorDeChat, arquivos: ArquivosDoChat): string[] {
  const esforco = nivelDeEsforcoDoClaudeCode(pergunta.esforco);
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--add-dir",
    pergunta.pastaDosProjetos,
    ...(pergunta.imagens.length > 0 && pergunta.pastaDasImagens !== null ? ["--add-dir", pergunta.pastaDasImagens] : []),
    ...(pergunta.sessaoIniciada ? ["--resume", pergunta.sessaoId] : ["--session-id", pergunta.sessaoId]),
    "--model",
    pergunta.modelo,
    ...(esforco === null ? [] : ["--effort", esforco]),
    "--append-system-prompt-file",
    arquivos.instrucoes,
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--tools",
    ...FERRAMENTAS_DO_CHAT,
    "--allowedTools",
    ...FERRAMENTAS_DO_CHAT,
    "--disallowedTools",
    ...regrasDeNegacaoDoChat(pergunta.pastaDosProjetos),
  ];
}

/**
 * Ambiente do processo do chat: sem as variáveis de uma sessão pai do Claude
 * Code e, com esforço escolhido, sem `CLAUDE_CODE_EFFORT_LEVEL`, que venceria
 * o `--effort`.
 */
export function montarAmbienteDoChat(base: NodeJS.ProcessEnv, esforco: EsforcoDeRaciocinio): NodeJS.ProcessEnv {
  const ambiente = ambienteSemSessaoPai(base);
  if (esforco !== "padrao") {
    delete ambiente[VARIAVEL_DE_ESFORCO];
  }
  return ambiente;
}
