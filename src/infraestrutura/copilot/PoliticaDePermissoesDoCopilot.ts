import path from "node:path";

import { ModoDoTurno } from "../../orquestracao/ModoDoTurno";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";

/**
 * O que o app decidiu sobre o turno e que vale para os pedidos de permissão
 * que o runtime do Copilot faz durante ele.
 */
export interface ContextoDePermissoesDoCopilot {
  nivel: NivelDePermissao;
  /** No planejamento os agentes só leem, seja qual for o nível. */
  modo: ModoDoTurno;
  pastaDeTrabalho: string;
  /** Única pasta em que se grava no nível `leitura` e no planejamento (ADR-26). */
  pastaDeArtefatos: string;
  /** Pastas liberadas só para leitura (os anexos do pedido). */
  pastasSoDeLeitura?: readonly string[];
  /** Resultado de `configuracao.permiteCommitEPush(modo)`: já considera o modo do turno. */
  permiteCommitEPush: boolean;
  /**
   * Se `Pasta` e `pasta` são lugares diferentes. Padrão: só no Linux (no
   * Windows e no Mac o sistema de arquivos ignora a caixa).
   */
  distinguirCaixa?: boolean;
}

/**
 * O pedido de permissão do runtime, só com os campos que a política lê (o
 * `PermissionRequest` do SDK é atribuível a ele). A política é pura: não
 * importa o SDK, assim os testes não carregam o runtime de 190 MB.
 */
export interface PedidoDePermissaoDoCopilot {
  /** `shell`, `write`, `read`, `url`, `mcp`, `memory`, `hook`, `custom-tool`… */
  kind: string;
  /** `write`: o arquivo que será gravado, como o agente o escreveu. */
  fileName?: string;
  /** `read`: o arquivo ou a pasta que será lido. */
  path?: string;
  /** `write` e `read`: o caminho canônico que o runtime resolveu (segue links simbólicos). */
  resolvedPath?: string;
  /** `shell`: o comando inteiro, com todos os trechos encadeados. */
  fullCommandText?: string;
  /** `shell`: arquivos que o comando pode ler ou gravar, segundo o runtime. */
  possiblePaths?: readonly string[];
  /** `url`: o endereço que será baixado. */
  url?: string;
  /** `mcp`, `custom-tool` e `hook`: o nome da ferramenta. */
  toolName?: string;
  serverName?: string;
}

export type DecisaoDePermissaoDoCopilot =
  | { aprovada: true }
  | {
      aprovada: false;
      /** Em português: volta ao modelo como `feedback` da recusa e aparece na tela. */
      motivo: string;
      /** Categoria do pedido (`shell`, `write`, `read`…), para o evento `permissao_negada`. */
      ferramenta: string;
      /** O comando ou o caminho recusado. */
      detalhe: string;
    };

const APROVADA: DecisaoDePermissaoDoCopilot = { aprovada: true };

function recusar(ferramenta: string, detalhe: string, motivo: string): DecisaoDePermissaoDoCopilot {
  return { aprovada: false, ferramenta, detalhe, motivo };
}

const NOMES_DOS_NIVEIS: Readonly<Record<NivelDePermissao, string>> = {
  leitura: "leitura",
  edicao: "edição",
  edicao_e_comandos: "edição e comandos",
};

// ---------------------------------------------------------------------------
// Caminhos
// ---------------------------------------------------------------------------

/**
 * Caminho absoluto, com `/`, sem `.` nem `..` e sem barra final. Um caminho
 * relativo vale a partir de `base`. A caixa só é preservada quando
 * `distinguirCaixa` (Linux).
 */
export function normalizarCaminhoDoCopilot(caminho: string, base: string, distinguirCaixa: boolean): string {
  const unificado = caminho.trim().replace(/\\/g, "/");
  const absoluto = /^[A-Za-z]:\//.test(unificado) || unificado.startsWith("/");
  const completo = absoluto ? unificado : `${base.replace(/\\/g, "/")}/${unificado}`;
  const normal = path.posix.normalize(completo).replace(/(?<=.)\/+$/, "");
  return distinguirCaixa ? normal : normal.toLowerCase();
}

function estaDentro(alvo: string, pasta: string): boolean {
  return alvo === pasta || alvo.startsWith(pasta.endsWith("/") ? pasta : `${pasta}/`);
}

/** `.env`, `.env.local`, `.env.production`… (o mesmo `.env*` do chat): podem guardar segredos. */
export function ehArquivoDeAmbiente(caminho: string): boolean {
  const nome = caminho.replace(/\\/g, "/").split("/").pop() ?? "";
  return /^\.env/i.test(nome);
}

/** Um `.env*` citado num comando (como argumento, redirecionamento ou parte de um caminho). */
const ARQUIVO_DE_AMBIENTE_NO_COMANDO = /(?:^|[\s"'`/\\=<>])\.env(?:\.[\w.-]+)?(?=$|[\s"'`;|&)])/i;

// ---------------------------------------------------------------------------
// Comandos: commit e push
// ---------------------------------------------------------------------------

/**
 * `git commit` e `git push` em qualquer lugar do texto — depois de `;`, `&&`,
 * `|`, dentro de aspas (`pwsh -c "git push"`) e com opções antes do
 * subcomando (`git -C pasta push`, `git -c user.name=x commit`). O terceiro
 * grupo traz os argumentos, até o próximo operador de encadeamento.
 */
const SUBCOMANDO_DO_GIT =
  /(?:^|[\s;&|(`"'])git(?:\.exe)?(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=\S+)?|-\w+))*\s+(commit|push)(?=$|[\s;&|)"'`])([^;&|\r\n]*)/gi;

/** `--force`, `--force-with-lease` e `--force-if-includes`. */
const PUSH_COM_FORCE_LONGO = /(?:^|\s)--force\b/i;
/** `-f`, `-fu` e `-uf`: uma opção curta qualquer que tenha o `f`. */
const PUSH_COM_FORCE_CURTO = /(?:^|\s)-[A-Za-z]*f[A-Za-z]*(?=\s|$)/;
/** Refspec com `+` (`git push origin +main`): força aquela referência. */
const PUSH_COM_REFSPEC_FORCADO = /(?:^|\s)\+\S/;

interface UsoDoGit {
  subcomando: "commit" | "push";
  argumentos: string;
}

function usosDoGit(comando: string): UsoDoGit[] {
  return [...comando.matchAll(SUBCOMANDO_DO_GIT)].map((achado) => ({
    subcomando: achado[1]?.toLowerCase() === "push" ? "push" : "commit",
    argumentos: achado[2] ?? "",
  }));
}

function ehPushForcado(argumentos: string): boolean {
  return (
    PUSH_COM_FORCE_LONGO.test(argumentos) ||
    PUSH_COM_FORCE_CURTO.test(argumentos) ||
    PUSH_COM_REFSPEC_FORCADO.test(argumentos)
  );
}

// ---------------------------------------------------------------------------
// Ferramentas que a sessão oferece ao modelo
// ---------------------------------------------------------------------------

/** Ler, buscar e baixar páginas; `update_todo` é a lista de tarefas do agente. */
const FERRAMENTAS_DE_LEITURA_DO_COPILOT: readonly string[] = ["view", "grep", "glob", "web_fetch", "update_todo"];

/**
 * Criar e editar arquivos. Existem em todo nível (como o `Write`/`Edit` do
 * Claude Code, que também ficam na sessão do nível leitura): onde o agente
 * pode gravar quem decide é `decidirPermissaoDoCopilot`, que libera a pasta de
 * artefatos mesmo no nível `leitura` e no planejamento.
 */
const FERRAMENTAS_DE_GRAVACAO_DO_COPILOT: readonly string[] = ["create", "edit", "apply_patch", "str_replace_editor"];

/**
 * O terminal e as ferramentas de acompanhar e encerrar o que ficou em segundo
 * plano: a família `powershell` no Windows, a `bash` no Mac/Linux. (O runtime
 * avisa — `session.info` — de qualquer nome que não conheça na lista fechada.)
 */
const FERRAMENTAS_DE_TERMINAL_DO_COPILOT: Readonly<Record<"windows" | "unix", readonly string[]>> = {
  windows: ["powershell", "read_powershell", "stop_powershell", "list_powershell"],
  unix: ["bash", "read_bash", "stop_bash", "list_bash"],
};

/**
 * A lista fechada de ferramentas (`availableTools`) do turno. Sem `task` e
 * companhia: delegar a subagentes é da Fase 2. O terminal só existe no nível
 * `edicao_e_comandos` e fora do planejamento — o modelo nem o enxerga nos
 * demais, como no `--tools` do Claude Code.
 *
 * Quais dessas o modelo recebe de fato depende dele (o Haiku 5.5 vê `view`,
 * `create`, `edit`, `grep`, `glob` e `web_fetch`; os modelos GPT trazem
 * `apply_patch`): a lista só restringe, nunca acrescenta.
 */
export function ferramentasDoCopilotParaONivel(
  nivel: NivelDePermissao,
  modo: ModoDoTurno,
  plataforma: NodeJS.Platform = process.platform,
): string[] {
  const comTerminal = nivel === "edicao_e_comandos" && modo === "execucao";
  return [
    ...FERRAMENTAS_DE_LEITURA_DO_COPILOT,
    ...FERRAMENTAS_DE_GRAVACAO_DO_COPILOT,
    ...(comTerminal ? FERRAMENTAS_DE_TERMINAL_DO_COPILOT[plataforma === "win32" ? "windows" : "unix"] : []),
  ];
}

// ---------------------------------------------------------------------------
// A decisão
// ---------------------------------------------------------------------------

function decidirLeitura(contexto: ContextoDePermissoesDoCopilot, pedido: PedidoDePermissaoDoCopilot): DecisaoDePermissaoDoCopilot {
  const caminhos = [pedido.path, pedido.resolvedPath].filter((c): c is string => c !== undefined && c !== "");
  const detalhe = caminhos[0] ?? "";
  if (caminhos.length === 0) {
    return recusar("read", detalhe, "O pedido de leitura veio sem o caminho do arquivo.");
  }
  if (caminhos.some(ehArquivoDeAmbiente)) {
    return recusar("read", detalhe, "Arquivos de ambiente (.env) não podem ser lidos: podem guardar segredos.");
  }
  const liberadas = [contexto.pastaDeTrabalho, contexto.pastaDeArtefatos, ...(contexto.pastasSoDeLeitura ?? [])];
  return caminhos.every((caminho) => dentroDeAlguma(contexto, caminho, liberadas))
    ? APROVADA
    : recusar("read", detalhe, "Só é possível ler a pasta de trabalho, a pasta de artefatos e a dos anexos do pedido.");
}

function dentroDeAlguma(contexto: ContextoDePermissoesDoCopilot, caminho: string, pastas: readonly string[]): boolean {
  const distinguirCaixa = contexto.distinguirCaixa ?? process.platform === "linux";
  const alvo = normalizarCaminhoDoCopilot(caminho, contexto.pastaDeTrabalho, distinguirCaixa);
  return pastas.some((pasta) => estaDentro(alvo, normalizarCaminhoDoCopilot(pasta, contexto.pastaDeTrabalho, distinguirCaixa)));
}

function decidirGravacao(
  contexto: ContextoDePermissoesDoCopilot,
  nivel: NivelDePermissao,
  pedido: PedidoDePermissaoDoCopilot,
): DecisaoDePermissaoDoCopilot {
  const caminhos = [pedido.fileName, pedido.resolvedPath].filter((c): c is string => c !== undefined && c !== "");
  const detalhe = caminhos[0] ?? "";
  if (caminhos.length === 0) {
    return recusar("write", detalhe, "O pedido de gravação veio sem o caminho do arquivo.");
  }
  if (caminhos.every((caminho) => dentroDeAlguma(contexto, caminho, [contexto.pastaDeArtefatos]))) {
    return APROVADA;
  }
  if (nivel === "leitura") {
    const prefixo =
      contexto.modo === "planejamento" ? "No planejamento os agentes só leem" : 'O nível "leitura" não permite criar nem editar arquivos';
    return recusar("write", detalhe, `${prefixo}; só é possível gravar na pasta de artefatos.`);
  }
  return caminhos.every((caminho) => dentroDeAlguma(contexto, caminho, [contexto.pastaDeTrabalho]))
    ? APROVADA
    : recusar("write", detalhe, "Só é possível gravar na pasta de trabalho e na pasta de artefatos.");
}

function decidirComando(
  contexto: ContextoDePermissoesDoCopilot,
  nivel: NivelDePermissao,
  pedido: PedidoDePermissaoDoCopilot,
): DecisaoDePermissaoDoCopilot {
  const comando = pedido.fullCommandText ?? "";
  if (nivel !== "edicao_e_comandos") {
    const motivo =
      contexto.modo === "planejamento"
        ? "No planejamento os agentes só leem; não há terminal."
        : `O nível "${NOMES_DOS_NIVEIS[nivel]}" não permite executar comandos no terminal.`;
    return recusar("shell", comando, motivo);
  }
  if (
    ARQUIVO_DE_AMBIENTE_NO_COMANDO.test(comando) ||
    (pedido.possiblePaths ?? []).some(ehArquivoDeAmbiente)
  ) {
    return recusar("shell", comando, "Arquivos de ambiente (.env) não podem ser lidos: podem guardar segredos.");
  }
  for (const uso of usosDoGit(comando)) {
    if (uso.subcomando === "push" && ehPushForcado(uso.argumentos)) {
      return recusar("shell", comando, "Push forçado não é permitido: reescreve o histórico remoto.");
    }
    if (!contexto.permiteCommitEPush) {
      return recusar(
        "shell",
        comando,
        `git ${uso.subcomando} não é permitido: a opção "Permitir commit e push" está desligada ou o turno é de planejamento.`,
      );
    }
  }
  return APROVADA;
}

/**
 * Traduz o nível, o modo e as pastas do turno na resposta a um pedido de
 * permissão do runtime do Copilot — o equivalente, por handler, ao
 * `--allowedTools`/`--disallowedTools` do Claude Code:
 *
 * - planejamento vale como o nível `leitura`;
 * - leitura de arquivos e acesso à web: liberados nas pastas do turno;
 * - gravação: sempre na pasta de artefatos; na de trabalho só com `edicao` ou
 *   `edicao_e_comandos` e fora do planejamento;
 * - comandos: só com `edicao_e_comandos`; `git commit` e `git push` só com
 *   `permiteCommitEPush`, e push forçado nunca;
 * - `.env*` nunca é lido;
 * - MCP, memória, hooks e ferramentas customizadas: recusados (o app não
 *   registra nenhum).
 *
 * Função pura: sem relógio, disco nem SDK.
 */
export function decidirPermissaoDoCopilot(
  contexto: ContextoDePermissoesDoCopilot,
  pedido: PedidoDePermissaoDoCopilot,
): DecisaoDePermissaoDoCopilot {
  const nivel: NivelDePermissao = contexto.modo === "planejamento" ? "leitura" : contexto.nivel;
  switch (pedido.kind) {
    case "read":
      return decidirLeitura(contexto, pedido);
    case "url":
      return APROVADA;
    case "write":
      return decidirGravacao(contexto, nivel, pedido);
    case "shell":
      return decidirComando(contexto, nivel, pedido);
    case "mcp":
    case "memory":
    case "hook":
    case "custom-tool":
      return recusar(
        pedido.kind,
        pedido.toolName ?? pedido.serverName ?? "",
        `Pedidos do tipo "${pedido.kind}" não são liberados neste app.`,
      );
    default:
      return recusar(pedido.kind, pedido.toolName ?? "", `Pedidos do tipo "${pedido.kind}" não são reconhecidos e foram recusados.`);
  }
}
