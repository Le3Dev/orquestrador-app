import type { PerguntaAoMotorDeChat } from "../../chat/MotorDeChat";
import type { EsforcoDeRaciocinio } from "../../orquestracao/EsforcoDeRaciocinio";
import {
  ambienteSemSessaoPai,
  COMANDOS_DE_PUSH_FORCADO,
  type ConfiguracoesDaSessao,
  nivelDeEsforcoDoClaudeCode,
  VARIAVEL_DE_ESFORCO,
} from "./ArgumentosDoClaudeCode";

/** Pesquisar na web e ler: liberadas sempre. */
export const FERRAMENTAS_DE_LEITURA_DO_CHAT: readonly string[] = ["WebSearch", "WebFetch", "Read", "Glob", "Grep"];

/** Editar arquivos: só com a autorização do usuário. */
export const FERRAMENTAS_DE_EDICAO_DO_CHAT: readonly string[] = ["Edit", "Write", "NotebookEdit"];

/**
 * Rodar comandos: só com a autorização do usuário. No Windows o terminal é a
 * ferramenta `PowerShell`; `Bash` entra junto para quando o Git Bash estiver
 * configurado.
 */
export const FERRAMENTAS_DE_COMANDO_DO_CHAT: readonly string[] = ["PowerShell", "Bash"];

/**
 * Todas as ferramentas que existem na sessão do chat (`--tools`), com ou sem
 * autorização — sem Subagentes. As de edição e comando existem sempre, para
 * que o Claude tente usá-las e a negação vire o pedido de autorização na tela.
 */
export const FERRAMENTAS_DO_CHAT: readonly string[] = [
  ...FERRAMENTAS_DE_LEITURA_DO_CHAT,
  ...FERRAMENTAS_DE_EDICAO_DO_CHAT,
  ...FERRAMENTAS_DE_COMANDO_DO_CHAT,
];

/** O que vai em `--allowedTools`: com `dontAsk`, o resto é negado em vez de perguntado. */
export function ferramentasLiberadasDoChat(alteracoesAutorizadas: boolean): readonly string[] {
  return alteracoesAutorizadas ? FERRAMENTAS_DO_CHAT : FERRAMENTAS_DE_LEITURA_DO_CHAT;
}

/**
 * Configuração da sessão do chat (`--settings`), sempre: desliga a atribuição
 * do Claude Code (o trailer `Co-Authored-By` nos commits e o "Generated with
 * Claude Code" nos PRs), que a política do usuário proíbe. Mesmo formato dos
 * Orquestradores com commit e push liberados (`configuracoesDaSessao`).
 */
export function configuracoesDaSessaoDoChat(): ConfiguracoesDaSessao {
  return { attribution: { commit: "", pr: "" } };
}

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

/**
 * Tudo o que vai em `--disallowedTools`, com ou sem autorização: a leitura
 * dos arquivos de ambiente e o push forçado (o mesmo bloqueio dos
 * Orquestradores, com os mesmos limites do casamento por texto).
 */
export function comandosProibidosDoChat(pastaDosProjetos: string): string[] {
  return [...regrasDeNegacaoDoChat(pastaDosProjetos), ...COMANDOS_DE_PUSH_FORCADO];
}

export interface ArquivosDoChat {
  /** Arquivo temporário com as instruções; vai em `--append-system-prompt-file`. */
  instrucoes: string;
  /** Arquivo temporário com `configuracoesDaSessaoDoChat`; vai em `--settings`. */
  configuracoes: string;
}

/**
 * Linha de comando do `claude -p` para uma pergunta do chat rápido.
 *
 * Mesmo desenho dos turnos dos Orquestradores: a mensagem vai pelo stdin em
 * `stream-json` (texto e imagens), as instruções em arquivo. A diferença é o
 * `--include-partial-messages`, que entrega a resposta em pedaços enquanto é
 * gerada.
 *
 * `--tools` traz sempre as dez ferramentas; `--allowedTools`, só as de
 * leitura e pesquisa até o usuário autorizar alterações. Com `dontAsk`, a
 * edição ou o comando sem autorização é negado (e vira o pedido de
 * autorização na tela), em vez de esperar por alguém no terminal.
 *
 * A raiz dos projetos entra em `--add-dir`: leitura sempre e, autorizado,
 * edição. `--settings` entra sempre, para nenhum commit sair com a linha
 * Co-authored-by.
 *
 * `--disallowedTools` é variádica e fica por último, para não engolir as
 * opções seguintes.
 */
export function montarArgumentosDoChat(pergunta: PerguntaAoMotorDeChat, arquivos: ArquivosDoChat): string[] {
  const esforco = nivelDeEsforcoDoClaudeCode(pergunta.esforco);
  const liberadas = ferramentasLiberadasDoChat(pergunta.alteracoesAutorizadas);
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
    "--settings",
    arquivos.configuracoes,
    "--permission-mode",
    "dontAsk",
    "--tools",
    ...FERRAMENTAS_DO_CHAT,
    "--allowedTools",
    ...liberadas,
    "--disallowedTools",
    ...comandosProibidosDoChat(pergunta.pastaDosProjetos),
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
