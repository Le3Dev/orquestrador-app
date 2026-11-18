import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ModoDoTurno } from "../../orquestracao/ModoDoTurno";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";

/**
 * O que um agente quer fazer, já traduzido do vocabulário do CLI (ACP, Codex)
 * para o do domínio. É o que a política julga.
 */
export type AcaoDoAgente =
  /** Ler arquivos, buscar no projeto, pensar. */
  | { tipo: "leitura" }
  /** Criar, alterar, apagar ou mover arquivos. `caminhos` vazio: o CLI não disse quais. */
  | { tipo: "escrita"; caminhos: readonly string[] }
  /** Rodar um comando no terminal. */
  | { tipo: "comando"; comando: string }
  /** Pesquisar na web ou baixar uma página. */
  | { tipo: "web" }
  /** Uma ferramenta do servidor MCP do próprio app (ex.: `delegar_subtarefas`). */
  | { tipo: "ferramenta_do_app" }
  /** O agente pede para mudar o próprio modo de operação (plano, piloto automático, sem confirmações). */
  | { tipo: "mudar_de_modo" }
  /** Qualquer outra ferramenta (MCP do usuário, skill...). */
  | { tipo: "outra"; descricao: string };

export type DecisaoDePermissao = { permitido: true } | { permitido: false; motivo: string };

/** O que vale para o turno: o nível, o modo e as pastas. */
export interface ContextoDePermissao {
  nivel: NivelDePermissao;
  modo: ModoDoTurno;
  pastaDeTrabalho: string;
  pastaDeArtefatos: string;
  pastaDosAnexos: string | null;
  /** `configuracao.permiteCommitEPush(modo)`: já considera o modo do turno. */
  permiteCommitEPush: boolean;
}

/** O contexto de permissão de um pedido. */
export function contextoDePermissaoDoPedido(pedido: PedidoDeTurno): ContextoDePermissao {
  return {
    nivel: pedido.configuracao.nivelDePermissao,
    modo: pedido.modo,
    pastaDeTrabalho: pedido.pastaDeTrabalho.caminho,
    pastaDeArtefatos: pedido.pastaDeArtefatos,
    pastaDosAnexos: pedido.pastaDosAnexos,
    permiteCommitEPush: pedido.configuracao.permiteCommitEPush(pedido.modo),
  };
}

/** O nível que vale no turno: no planejamento os agentes só leem, seja qual for o nível configurado. */
export function nivelEfetivo(contexto: Pick<ContextoDePermissao, "nivel" | "modo">): NivelDePermissao {
  return contexto.modo === "planejamento" ? "leitura" : contexto.nivel;
}

/** Se o turno pode rodar comandos no terminal. */
export function permiteComandos(contexto: Pick<ContextoDePermissao, "nivel" | "modo">): boolean {
  return nivelEfetivo(contexto) === "edicao_e_comandos";
}

/** Se o turno pode alterar arquivos do projeto (os artefatos são a exceção, em qualquer nível). */
export function permiteEditarOProjeto(contexto: Pick<ContextoDePermissao, "nivel" | "modo">): boolean {
  return nivelEfetivo(contexto) !== "leitura";
}

// ── Caminhos ─────────────────────────────────────────────────────────────

/**
 * O caminho real de um caminho que pode nem existir ainda: resolve o que
 * existe (nomes curtos do Windows como `LEANDR~1.CAN`, atalhos) e acrescenta o
 * resto. Sem isso, uma regra escrita com o caminho longo nunca casaria com o
 * caminho curto que o CLI informa.
 */
export function caminhoCanonico(caminho: string): string {
  const absoluto = path.resolve(caminho);
  const restante: string[] = [];
  let atual = absoluto;
  for (;;) {
    try {
      return path.join(realpathSync.native(atual), ...restante.reverse());
    } catch {
      const pai = path.dirname(atual);
      if (pai === atual) {
        return absoluto;
      }
      restante.push(path.basename(atual));
      atual = pai;
    }
  }
}

function paraComparar(caminho: string): string {
  const canonico = caminhoCanonico(caminho);
  return process.platform === "win32" ? canonico.toLowerCase() : canonico;
}

/** Se `caminho` é a pasta ou está dentro dela. */
export function estaDentroDe(caminho: string, pasta: string): boolean {
  const relativo = path.relative(paraComparar(pasta), paraComparar(caminho));
  return relativo === "" || (relativo !== ".." && !relativo.startsWith(`..${path.sep}`) && !path.isAbsolute(relativo));
}

// ── Comandos ─────────────────────────────────────────────────────────────

/** `git` com as opções que vêm antes do subcomando (`-C pasta`, `-c chave=valor`, `--git-dir=...`). */
const GIT_COM_OPCOES = String.raw`\bgit(?:\.exe)?(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?|-[pP]))*\s+`;
const COMMIT_DO_GIT = new RegExp(`${GIT_COM_OPCOES}commit\\b`, "i");
const PUSH_DO_GIT = new RegExp(`${GIT_COM_OPCOES}push\\b`, "i");

/** `git push` com `--force`, `--force-with-lease`, `-f` (inclusive agrupado, como `-fu` ou `-uf`) ou refspec com `+`. */
function ehPushForcado(comando: string): boolean {
  for (const trecho of comando.split(new RegExp(`(?=${GIT_COM_OPCOES}push\\b)`, "i"))) {
    const empurrar = new RegExp(`^${GIT_COM_OPCOES}push\\b([^;&|\\n]*)`, "i").exec(trecho);
    if (empurrar === null) {
      continue;
    }
    const argumentos = (empurrar[1] ?? "").split(/\s+/).filter((argumento) => argumento !== "");
    if (
      argumentos.some(
        (argumento) =>
          argumento.startsWith("--force") || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(argumento) || /^\+\S/.test(argumento),
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * O comando tem `git commit` ou `git push` em qualquer ponto (depois de `;`,
 * `&&`, dentro de `pwsh -c "..."`...). Mais amplo que as regras do Claude Code,
 * que casam só o início do comando.
 */
export function contemCommitOuPush(comando: string): boolean {
  return COMMIT_DO_GIT.test(comando) || PUSH_DO_GIT.test(comando);
}

// ── Decisão ──────────────────────────────────────────────────────────────

const SO_LEITURA =
  "Neste pedido os agentes só leem arquivos e pesquisam: criar, editar e executar comandos não é permitido (só gravar artefatos na pasta de artefatos).";
const SEM_COMANDOS = "Neste pedido os agentes não podem executar comandos no terminal.";
const SEM_COMMIT =
  "Commit e push não estão liberados neste pedido: não faça commit nem push; deixe as alterações sem commitar.";
const SEM_PUSH_FORCADO = "Push forçado é sempre proibido: ele reescreve o histórico remoto.";
const SEM_COAUTORIA = "A mensagem do commit não pode ter a linha Co-authored-by: refaça o commit sem ela.";
const COAUTORIA = /co-authored-by/i;

function recusa(motivo: string): DecisaoDePermissao {
  return { permitido: false, motivo };
}

/** Pastas onde o nível `edicao`+ pode gravar: o projeto, os artefatos e a pasta temporária do sistema. */
function pastasGravaveis(contexto: ContextoDePermissao): string[] {
  return [contexto.pastaDeTrabalho, contexto.pastaDeArtefatos, tmpdir()];
}

/**
 * A política única de permissões dos agentes dos motores Codex e Copilot —
 * a mesma que o Claude Code recebe como `--tools`/`--allowedTools`:
 *
 * - leitura e pesquisa na web: sempre;
 * - gravar artefatos na pasta de artefatos: sempre, em qualquer nível e no
 *   planejamento;
 * - editar o projeto: do nível `edicao` em diante, fora do planejamento, e só
 *   dentro da pasta de trabalho (ou da temporária);
 * - comandos: só no nível `edicao_e_comandos`, fora do planejamento; `git
 *   commit` e `git push` só com a opção ligada, e push forçado nunca;
 * - ferramentas do próprio app: sempre (a delegação aplica as mesmas regras às
 *   subtarefas);
 * - mudar o modo do agente (plano, piloto automático): nunca, o app decide;
 * - o resto (MCP do usuário, skills...): só onde há edição e comandos.
 */
export function decidirPermissao(acao: AcaoDoAgente, contexto: ContextoDePermissao): DecisaoDePermissao {
  switch (acao.tipo) {
    case "leitura":
    case "web":
    case "ferramenta_do_app":
      return { permitido: true };
    case "mudar_de_modo":
      return recusa("O modo do agente é definido pelo app e não pode ser alterado durante o pedido.");
    case "escrita": {
      const caminhos = acao.caminhos;
      if (caminhos.length > 0 && caminhos.every((caminho) => estaDentroDe(caminho, contexto.pastaDeArtefatos))) {
        return { permitido: true };
      }
      if (!permiteEditarOProjeto(contexto)) {
        return recusa(SO_LEITURA);
      }
      if (caminhos.length === 0 || !caminhos.every((caminho) => pastasGravaveis(contexto).some((pasta) => estaDentroDe(caminho, pasta)))) {
        return recusa(`Só é permitido gravar dentro da pasta de trabalho (${contexto.pastaDeTrabalho}) e da pasta de artefatos.`);
      }
      return { permitido: true };
    }
    case "comando": {
      if (!permiteComandos(contexto)) {
        return recusa(nivelEfetivo(contexto) === "leitura" ? SO_LEITURA : SEM_COMANDOS);
      }
      if (ehPushForcado(acao.comando)) {
        return recusa(SEM_PUSH_FORCADO);
      }
      if (!contexto.permiteCommitEPush && contemCommitOuPush(acao.comando)) {
        return recusa(SEM_COMMIT);
      }
      // O Copilot instrui o modelo a acrescentar `Co-authored-by` aos commits (a configuração `includeCoAuthoredBy`
      // do usuário, ligada por padrão): a regra do app é nunca ter essa linha, então o commit com ela é recusado.
      if (contemCommitOuPush(acao.comando) && COAUTORIA.test(acao.comando)) {
        return recusa(SEM_COAUTORIA);
      }
      return { permitido: true };
    }
    case "outra":
      return permiteComandos(contexto)
        ? { permitido: true }
        : recusa(`A ferramenta "${acao.descricao}" não é permitida neste pedido (nível de permissão ou planejamento).`);
  }
}

/**
 * Padrões `shell(...)` do `--deny-tool` do Copilot: a segunda barreira, na
 * entrada do próprio CLI, para o que a política recusa. Com commit e push
 * liberados, nada vai ao CLI: o push forçado fica só com a política.
 */
export function padroesDeNegacaoDeComandos(contexto: Pick<ContextoDePermissao, "permiteCommitEPush">): string[] {
  return contexto.permiteCommitEPush ? [] : ["shell(git commit)", "shell(git push)"];
}
