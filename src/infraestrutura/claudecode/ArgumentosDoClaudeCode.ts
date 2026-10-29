import { instrucoesDoSubagente, NOME_DO_SUBAGENTE } from "../../orquestracao/InstrucoesDoOrquestrador";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";

/** Ferramenta do Claude Code que lança subagentes (aparece como `Task` em versões antigas). */
const FERRAMENTA_DE_SUBAGENTES = "Agent";

/**
 * O que cada nível de permissão libera, em nomes de ferramentas do Claude
 * Code. No Windows o terminal é a ferramenta `PowerShell`; `Bash` entra junto
 * para quando o Git Bash estiver configurado.
 */
export const FERRAMENTAS_POR_NIVEL: Readonly<Record<NivelDePermissao, readonly string[]>> = {
  leitura: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  edicao: ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Edit", "Write", "NotebookEdit"],
  edicao_e_comandos: [
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "Edit",
    "Write",
    "NotebookEdit",
    "PowerShell",
    "Bash",
  ],
};

/** Negadas em qualquer nível: commit e push são decisão do usuário. */
export const COMANDOS_PROIBIDOS: readonly string[] = [
  "PowerShell(git commit:*)",
  "PowerShell(git push:*)",
  "Bash(git commit:*)",
  "Bash(git push:*)",
];

/**
 * Variáveis que amarram um processo a uma sessão do Claude Code já aberta.
 * Se o servidor for iniciado de dentro de um terminal do Claude Code, elas
 * vazariam para os Orquestradores e os fariam se comportar como sessões filhas.
 */
const VARIAVEIS_DA_SESSAO_PAI = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "AI_AGENT",
];

export interface ArquivosDoTurno {
  agentes: string;
  instrucoes: string;
}

export interface DefinicaoDeAgente {
  description: string;
  prompt: string;
  tools: string[];
  model: string;
}

export function definicaoDosAgentes(pedido: PedidoDeTurno): Record<string, DefinicaoDeAgente> {
  return {
    [NOME_DO_SUBAGENTE]: {
      description:
        "Executa uma subtarefa delegada pelo orquestrador e devolve um resultado objetivo.",
      prompt: instrucoesDoSubagente(pedido.pastaDeTrabalho),
      tools: [...FERRAMENTAS_POR_NIVEL[pedido.configuracao.nivelDePermissao]],
      model: pedido.configuracao.modeloDosSubagentes,
    },
  };
}

/**
 * Linha de comando do `claude -p` para um turno.
 *
 * O texto do usuário não entra aqui: vai pelo stdin, e as instruções e os
 * agentes vão em arquivos. Assim nenhuma entrada livre passa por argumento,
 * onde aspas e quebras de linha seriam um problema no Windows.
 *
 * A entrada é `stream-json`, e não texto puro, para a mensagem poder levar
 * imagens. A pasta das imagens entra em `--add-dir`: fora da pasta do projeto,
 * os Subagentes não teriam permissão para abri-las.
 *
 * `--tools` define o que existe na sessão; `--allowedTools` com
 * `--permission-mode dontAsk` faz o resto ser negado em vez de perguntado —
 * não há ninguém no terminal para responder.
 */
export function montarArgumentos(pedido: PedidoDeTurno, arquivos: ArquivosDoTurno): string[] {
  const ferramentas = [...FERRAMENTAS_POR_NIVEL[pedido.configuracao.nivelDePermissao], FERRAMENTA_DE_SUBAGENTES];

  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    ...(pedido.pastaDasImagens === null ? [] : ["--add-dir", pedido.pastaDasImagens]),
    ...(pedido.sessaoIniciada ? ["--resume", pedido.sessaoId] : ["--session-id", pedido.sessaoId]),
    "--model",
    pedido.configuracao.modeloDoOrquestrador,
    "--agents",
    arquivos.agentes,
    "--append-system-prompt-file",
    arquivos.instrucoes,
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--tools",
    ...ferramentas,
    "--allowedTools",
    ...ferramentas,
    "--disallowedTools",
    ...COMANDOS_PROIBIDOS,
  ];
}

export interface ImagemEmBase64 {
  tipoDeMidia: string;
  base64: string;
}

/**
 * A mensagem do turno no formato `stream-json` de entrada: uma linha JSON com
 * o texto e as imagens. O stdin é fechado logo depois — o Claude Code
 * responde e encerra.
 */
export function linhaDeEntrada(texto: string, imagens: readonly ImagemEmBase64[]): string {
  const conteudo = [
    { type: "text", text: texto },
    ...imagens.map((imagem) => ({
      type: "image",
      source: { type: "base64", media_type: imagem.tipoDeMidia, data: imagem.base64 },
    })),
  ];
  return `${JSON.stringify({ type: "user", message: { role: "user", content: conteudo } })}\n`;
}

export function montarAmbiente(base: NodeJS.ProcessEnv, pedido: PedidoDeTurno): NodeJS.ProcessEnv {
  const ambiente: NodeJS.ProcessEnv = { ...base };
  for (const variavel of VARIAVEIS_DA_SESSAO_PAI) {
    delete ambiente[variavel];
  }
  ambiente.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = String(
    pedido.configuracao.quantidadeDeSubagentes.limite,
  );
  return ambiente;
}
