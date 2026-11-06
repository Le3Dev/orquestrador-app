import { EsforcoDeRaciocinio } from "../../orquestracao/EsforcoDeRaciocinio";
import { instrucoesDoSubagente, NOME_DO_SUBAGENTE } from "../../orquestracao/InstrucoesDoOrquestrador";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";

/** Ferramenta do Claude Code que lança subagentes (aparece como `Task` em versões antigas). */
const FERRAMENTA_DE_SUBAGENTES = "Agent";

/**
 * Níveis de esforço que o Claude Code aceita no `--effort` e no campo `effort`
 * da definição de agente (https://code.claude.com/docs/en/cli-reference e
 * https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields).
 */
export type NivelDeEsforcoDoClaudeCode = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Adaptador do Esforço de Raciocínio para o nível do Claude Code. `padrao` não
 * vira nível nenhum: nada é enviado, e vale o padrão do modelo ou o que o
 * usuário salvou nas configurações do Claude Code.
 *
 * Não validamos nível por modelo: o domínio guarda só o apelido (`opus`,
 * `sonnet`, `haiku`), que resolve para modelos diferentes conforme o provedor.
 * O Claude Code sabe o modelo real e roda o nível mais alto suportado até o
 * escolhido (`xhigh` vira `high` no Opus 4.6); em modelo sem esforço, como o
 * Haiku 4.5, não envia o parâmetro (https://code.claude.com/docs/en/model-config
 * e https://code.claude.com/docs/en/env-vars, `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT`).
 */
const NIVEL_DE_ESFORCO: Readonly<Record<EsforcoDeRaciocinio, NivelDeEsforcoDoClaudeCode | null>> = {
  padrao: null,
  baixo: "low",
  medio: "medium",
  alto: "high",
  extra_alto: "xhigh",
  maximo: "max",
};

export function nivelDeEsforcoDoClaudeCode(esforco: EsforcoDeRaciocinio): NivelDeEsforcoDoClaudeCode | null {
  return NIVEL_DE_ESFORCO[esforco];
}

/**
 * Vence o `--effort` e o `effort` dos agentes
 * (https://code.claude.com/docs/en/model-config#adjust-effort-level).
 */
export const VARIAVEL_DE_ESFORCO = "CLAUDE_CODE_EFFORT_LEVEL";

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
 * Ferramentas com que os agentes gravam artefatos (páginas e relatórios para
 * o usuário). Existem em toda sessão — Orquestrador, Subagentes e chat —,
 * mesmo nos níveis só de leitura e no Plan Mode.
 */
export const FERRAMENTAS_DE_ARTEFATO: readonly string[] = ["Write", "Edit"];

/** As ferramentas recebidas, mais as de artefato que ainda não estiverem nelas. */
export function comFerramentasDeArtefato(ferramentas: readonly string[]): string[] {
  return [...ferramentas, ...FERRAMENTAS_DE_ARTEFATO.filter((ferramenta) => !ferramentas.includes(ferramenta))];
}

/**
 * As ferramentas liberadas (`--allowedTools`), mais a gravação na pasta de
 * artefatos: `Write(<pasta>/**)` e `Edit(<pasta>/**)` para as de artefato que
 * não estiverem livres. Com `dontAsk`, gravar fora dessa pasta continua
 * negado; onde `Write`/`Edit` já são livres, nada muda.
 */
export function liberadasComArtefatos(liberadas: readonly string[], pastaDeArtefatos: string): string[] {
  const pasta = caminhoParaRegraDePermissao(pastaDeArtefatos);
  const regras = FERRAMENTAS_DE_ARTEFATO.filter((ferramenta) => !liberadas.includes(ferramenta)).map(
    (ferramenta) => `${ferramenta}(${pasta}/**)`,
  );
  return [...liberadas, ...regras];
}

/**
 * Negados em qualquer nível enquanto a opção "Permitir commit e push" não os
 * libera no turno (desligada, ou turno de planejamento).
 */
export const COMANDOS_DE_COMMIT_E_PUSH: readonly string[] = [
  "PowerShell(git commit:*)",
  "PowerShell(git push:*)",
  "Bash(git commit:*)",
  "Bash(git push:*)",
];

/**
 * Push forçado continua negado mesmo com commit e push liberados: reescreve o
 * histórico remoto. Os padrões cobrem `--force`, `--force-with-lease` e
 * `--force-if-includes` em qualquer posição depois de `push`, `-f` (inclusive
 * `-fu`) e o refspec com `+` (`git push origin +main`).
 *
 * Limites: as regras casam o texto do comando como o agente o escreve. Não
 * pegam `git -C pasta push --force`, `git -c ... push -f`, flags curtas
 * combinadas com `f` no meio (`-uf`) nem o comando dentro de outro
 * interpretador (`pwsh -c "..."`, `bash -c '...'`) ou de um script.
 */
const PADROES_DE_PUSH_FORCADO: readonly string[] = [
  "git push *--force*",
  "git push -f*",
  "git push * -f*",
  "git push * +*",
];

export const COMANDOS_DE_PUSH_FORCADO: readonly string[] = ["PowerShell", "Bash"].flatMap((ferramenta) =>
  PADROES_DE_PUSH_FORCADO.map((padrao) => `${ferramenta}(${padrao})`),
);

/** O que vai em `--disallowedTools` neste turno. */
export function comandosProibidosDoTurno(pedido: PedidoDeTurno): readonly string[] {
  return pedido.configuracao.permiteCommitEPush(pedido.modo) ? COMANDOS_DE_PUSH_FORCADO : COMANDOS_DE_COMMIT_E_PUSH;
}

/** Chaves de configuração do Claude Code passadas só para a sessão do turno (`--settings`). */
export interface ConfiguracoesDaSessao {
  attribution: { commit: string; pr: string };
}

/**
 * Com commit e push liberados, desliga a atribuição que o Claude Code põe por
 * padrão — o trailer `Co-Authored-By` nos commits e o "Generated with Claude
 * Code" nos PRs —, que a política do usuário proíbe. Texto vazio esconde cada
 * uma (https://code.claude.com/docs/en/settings-reference, chave
 * `attribution`). Não usamos `attribution: false`: só existe a partir da
 * v2.1.281, e versões anteriores descartam o arquivo inteiro.
 *
 * Nulo quando commit e push estão proibidos: nada a configurar.
 */
export function configuracoesDaSessao(pedido: PedidoDeTurno): ConfiguracoesDaSessao | null {
  return pedido.configuracao.permiteCommitEPush(pedido.modo) ? { attribution: { commit: "", pr: "" } } : null;
}

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

/** Cópia do ambiente sem as variáveis que amarrariam o processo a uma sessão do Claude Code já aberta. */
export function ambienteSemSessaoPai(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const ambiente: NodeJS.ProcessEnv = { ...base };
  for (const variavel of VARIAVEIS_DA_SESSAO_PAI) {
    delete ambiente[variavel];
  }
  return ambiente;
}

export interface ArquivosDoTurno {
  agentes: string;
  instrucoes: string;
  /** Gravado só quando `configuracoesDaSessao` não é nulo; vai em `--settings`. */
  configuracoes: string;
}

export interface DefinicaoDeAgente {
  description: string;
  prompt: string;
  tools: string[];
  model: string;
  /** Ausente com esforço `padrao`. */
  effort?: NivelDeEsforcoDoClaudeCode;
}

/**
 * As ferramentas do nível neste turno, para o projeto. No planejamento a trava
 * é aqui: só as de leitura valem no projeto, seja qual for o nível configurado
 * — não usamos o `--permission-mode plan`, que em modo headless não tem quem
 * aprove a saída do plano.
 *
 * As de artefato (`FERRAMENTAS_DE_ARTEFATO`) entram à parte, em todo turno,
 * liberadas só na pasta de artefatos (`liberadasComArtefatos`).
 */
export function ferramentasDoTurno(pedido: PedidoDeTurno): readonly string[] {
  return pedido.modo === "planejamento"
    ? FERRAMENTAS_POR_NIVEL.leitura
    : FERRAMENTAS_POR_NIVEL[pedido.configuracao.nivelDePermissao];
}

/**
 * O `tools` do executor leva sempre `Write` e `Edit`, para ele poder gravar
 * artefatos mesmo nos níveis só de leitura e no planejamento. O que ele pode
 * gravar quem decide são as regras da sessão (`--allowedTools` com `dontAsk`),
 * que valem também para os Subagentes: fora da pasta de artefatos, só no nível
 * que libera a edição.
 */
export function definicaoDosAgentes(pedido: PedidoDeTurno): Record<string, DefinicaoDeAgente> {
  const esforco = nivelDeEsforcoDoClaudeCode(pedido.configuracao.esforcoDosSubagentes);
  return {
    [NOME_DO_SUBAGENTE]: {
      description:
        "Executa uma subtarefa delegada pelo orquestrador e devolve um resultado objetivo.",
      prompt: instrucoesDoSubagente(
        pedido.pastaDeTrabalho,
        pedido.configuracao.permiteCommitEPush(pedido.modo),
        pedido.pastaDeArtefatos,
      ),
      tools: comFerramentasDeArtefato(ferramentasDoTurno(pedido)),
      model: pedido.configuracao.modeloDosSubagentes,
      ...(esforco === null ? {} : { effort: esforco }),
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
 *
 * Artefatos: a pasta de artefatos do Orquestrador entra em `--add-dir`, e
 * `Write`/`Edit` existem em todo nível e no planejamento. Onde o nível não
 * libera a edição, as permitidas levam só `Write(<pasta>/**)` e
 * `Edit(<pasta>/**)`: gravar no projeto continua negado.
 *
 * `--settings` entra só quando há configuração da sessão (commit e push
 * liberados): fica acima das configurações do usuário e do projeto, abaixo
 * das gerenciadas pela organização.
 *
 * `--effort` entra só com esforço escolhido para o Orquestrador. É a flag, e
 * não a chave `effortLevel` em `--settings`, porque vence as configurações do
 * usuário (inclusive o nível salvo por modelo em `modelSettings`) e aceita
 * `max`, que as chaves de configuração não aceitam. Vale só para este
 * processo: cada turno a recebe de novo.
 */
export function montarArgumentos(pedido: PedidoDeTurno, arquivos: ArquivosDoTurno): string[] {
  const doNivel = [...ferramentasDoTurno(pedido), FERRAMENTA_DE_SUBAGENTES];
  const ferramentas = comFerramentasDeArtefato(doNivel);
  const liberadas = liberadasComArtefatos(doNivel, pedido.pastaDeArtefatos);
  const configuracoes = configuracoesDaSessao(pedido) === null ? [] : ["--settings", arquivos.configuracoes];
  const esforco = nivelDeEsforcoDoClaudeCode(pedido.configuracao.esforcoDoOrquestrador);

  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--add-dir",
    pedido.pastaDeArtefatos,
    ...(pedido.pastaDasImagens === null ? [] : ["--add-dir", pedido.pastaDasImagens]),
    ...(pedido.sessaoIniciada ? ["--resume", pedido.sessaoId] : ["--session-id", pedido.sessaoId]),
    "--model",
    pedido.configuracao.modeloDoOrquestrador,
    ...(esforco === null ? [] : ["--effort", esforco]),
    "--agents",
    arquivos.agentes,
    "--append-system-prompt-file",
    arquivos.instrucoes,
    "--strict-mcp-config",
    ...configuracoes,
    "--permission-mode",
    "dontAsk",
    "--tools",
    ...ferramentas,
    "--allowedTools",
    ...liberadas,
    "--disallowedTools",
    ...comandosProibidosDoTurno(pedido),
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

/**
 * Ambiente do processo do turno. Uma `CLAUDE_CODE_EFFORT_LEVEL` herdada do
 * servidor venceria o `--effort` e o `effort` do executor e anularia o esforço
 * escolhido na tela; por isso sai sempre que algum dos dois papéis tem esforço
 * escolhido. Com os dois em `padrao`, o ambiente fica como está.
 */
export function montarAmbiente(base: NodeJS.ProcessEnv, pedido: PedidoDeTurno): NodeJS.ProcessEnv {
  const ambiente = ambienteSemSessaoPai(base);
  const { esforcoDoOrquestrador, esforcoDosSubagentes } = pedido.configuracao;
  if (esforcoDoOrquestrador !== "padrao" || esforcoDosSubagentes !== "padrao") {
    delete ambiente[VARIAVEL_DE_ESFORCO];
  }
  ambiente.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = String(
    pedido.configuracao.quantidadeDeSubagentes.limite,
  );
  return ambiente;
}
