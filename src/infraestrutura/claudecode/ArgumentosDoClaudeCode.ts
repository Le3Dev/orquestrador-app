import { EsforcoDeRaciocinio } from "../../orquestracao/EsforcoDeRaciocinio";
import { instrucoesDoSubagente, NOME_DO_SUBAGENTE, Plataforma } from "../../orquestracao/InstrucoesDoOrquestrador";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";
import { modeloDoSubagentePronto } from "../../orquestracao/SubagentesProntos";

/** Ferramenta do Claude Code que lança subagentes (aparece como `Task` em versões antigas). */
export const FERRAMENTA_DE_SUBAGENTES = "Agent";

/**
 * Ferramenta dos workflows dinâmicos do esforço `ultracode`: o agente escreve
 * um script que lança vários agentes em segundo plano. Só existe na sessão
 * principal com `ultracode`; nunca vai para os Subagentes.
 */
export const FERRAMENTA_DE_WORKFLOW = "Workflow";

/**
 * Níveis de esforço que o Claude Code aceita no `--effort`
 * (https://code.claude.com/docs/en/cli-reference). `ultracode` (xhigh mais
 * workflows dinâmicos) só existe na flag: nem a `CLAUDE_CODE_EFFORT_LEVEL`,
 * nem o `effortLevel` dos arquivos de configuração, nem o `effort` de um
 * agente o aceitam (verificado no Claude Code 2.1.301).
 */
export type NivelDeEsforcoDoClaudeCode = "low" | "medium" | "high" | "xhigh" | "max" | "ultracode";

/**
 * Níveis aceitos no campo `effort` da definição de agente
 * (https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields).
 */
export type NivelDeEsforcoDoAgente = Exclude<NivelDeEsforcoDoClaudeCode, "ultracode">;

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
  ultracode: "ultracode",
};

export function nivelDeEsforcoDoClaudeCode(esforco: EsforcoDeRaciocinio): NivelDeEsforcoDoClaudeCode | null {
  return NIVEL_DE_ESFORCO[esforco];
}

/**
 * O `effort` do executor e dos subagentes prontos. Com o Orquestrador em
 * `ultracode` e os Subagentes em `padrao`, eles recebem `xhigh`, o nível de
 * raciocínio do `ultracode` (os workflows ficam só com o Orquestrador). O
 * domínio recusa `ultracode` nos Subagentes; se chegasse, também viraria
 * `xhigh`, porque o campo `effort` não o aceita.
 */
export function nivelDeEsforcoDosSubagentes(
  esforcoDosSubagentes: EsforcoDeRaciocinio,
  esforcoDoOrquestrador: EsforcoDeRaciocinio,
): NivelDeEsforcoDoAgente | null {
  if (esforcoDosSubagentes === "padrao" && esforcoDoOrquestrador === "ultracode") {
    return "xhigh";
  }
  const nivel = nivelDeEsforcoDoClaudeCode(esforcoDosSubagentes);
  return nivel === "ultracode" ? "xhigh" : nivel;
}

/**
 * Ferramentas que o esforço acrescenta à sessão principal (`--tools` e
 * `--allowedTools`): o `Workflow` com `ultracode`, nada nos outros. Liberado
 * sem pedir autorização: ele só orquestra agentes, que seguem as permissões
 * da sessão. Sem ele em `--allowedTools`, o `dontAsk` negaria os workflows.
 */
export function ferramentasDoEsforco(esforco: EsforcoDeRaciocinio): readonly string[] {
  return esforco === "ultracode" ? [FERRAMENTA_DE_WORKFLOW] : [];
}

/**
 * Ferramenta do Claude Code que executa as skills cadastradas (do usuário, do
 * projeto e de plugins). Sem ela em `--tools`, o agente enxerga as skills mas
 * não consegue usá-las.
 */
export const FERRAMENTA_DE_SKILL = "Skill";

/**
 * `Skill` quando a sessão pode editar; nada senão. O `allowed-tools` do
 * frontmatter de uma skill libera ferramentas por conta própria (verificado no
 * Claude Code 2.1.322: uma skill com `allowed-tools: Write` gravou fora da pasta
 * de artefatos numa sessão que só liberava `Write(<artefatos>/**)`), então só
 * entra onde essa liberação já seria concedida de qualquer forma. As regras de
 * `--disallowedTools` continuam valendo dentro da skill.
 */
export function ferramentasDeSkillQuandoPodeEditar(podeEditar: boolean): readonly string[] {
  return podeEditar ? [FERRAMENTA_DE_SKILL] : [];
}

/**
 * `Agent` quando a sessão pode editar; nada senão. Mesma regra da `Skill`: um
 * subagente usa as ferramentas que ele mesmo declara (o `tools` do frontmatter,
 * como `Bash`) e não consegue pausar para pedir autorização, então só entra
 * onde essa liberação já seria concedida de qualquer forma. As regras de
 * `--disallowedTools` continuam valendo dentro do subagente.
 */
export function ferramentasDeSubagentesQuandoPodeEditar(podeEditar: boolean): readonly string[] {
  return podeEditar ? [FERRAMENTA_DE_SUBAGENTES] : [];
}

/**
 * As ferramentas de skill do turno do Orquestrador e dos Subagentes (`--tools`,
 * `--allowedTools` e o `tools` dos agentes): `Skill` só nos níveis que liberam
 * edição do projeto (`edicao` e `edicao_e_comandos`) e fora do planejamento. Em
 * `leitura` e no planejamento nenhuma.
 */
export function ferramentasDeSkill(pedido: PedidoDeTurno): readonly string[] {
  const nivel = pedido.configuracao.nivelDePermissao;
  return ferramentasDeSkillQuandoPodeEditar(pedido.modo !== "planejamento" && nivel !== "leitura");
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
 * Ferramentas do Claude Code que publicam artefatos online na conta do
 * claude.ai: `Artifact` publica, atualiza e lista; `ArtifactCheck` confere o
 * HTML antes; `ArtifactData` lê os dados de um artefato. Só entram na sessão
 * com a opção "Publicar artefatos no claude.ai" ligada (Orquestrador e chat).
 * `ArtifactComments` e o `watch` não existem em sessões como as do app.
 */
export const FERRAMENTAS_DE_ARTEFATO_ONLINE: readonly string[] = ["Artifact", "ArtifactCheck", "ArtifactData"];

/**
 * Variáveis que ligam os artefatos online numa sessão `claude -p`. Nelas o
 * Claude Code os deixa desligados (a documentação diz "off by default" com
 * `-p`) e a ferramenta nem aparece, mesmo em `--tools`. `CLAUDE_CODE_ARTIFACT=1`
 * é o interruptor (não documentado; achado no binário 2.1.322 e confirmado
 * com uma publicação real). `CLAUDE_CODE_ARTIFACT_AUTO_OPEN=0` (documentada)
 * impede abrir o navegador do computador: o link volta na resposta.
 */
export const VARIAVEL_DOS_ARTEFATOS_ONLINE = "CLAUDE_CODE_ARTIFACT";
const VARIAVEL_DE_ABERTURA_AUTOMATICA = "CLAUDE_CODE_ARTIFACT_AUTO_OPEN";

/**
 * Com a opção ligada, acrescenta ao ambiente as variáveis dos artefatos online
 * e força a abertura automática desligada (nem uma herdada do servidor abre o
 * navegador). Desligada, apaga a `CLAUDE_CODE_ARTIFACT` herdada: um valor
 * deixado no ambiente do servidor não pode publicar contra a escolha da tela.
 */
export function comVariaveisDeArtefatoOnline(ambiente: NodeJS.ProcessEnv, permitido: boolean): NodeJS.ProcessEnv {
  if (permitido) {
    ambiente[VARIAVEL_DOS_ARTEFATOS_ONLINE] = "1";
    ambiente[VARIAVEL_DE_ABERTURA_AUTOMATICA] = "0";
  } else {
    delete ambiente[VARIAVEL_DOS_ARTEFATOS_ONLINE];
  }
  return ambiente;
}

/**
 * O turno pode publicar online? A opção ligada e fora do planejamento: no
 * planejamento nada sai do computador. O nível `leitura` publica: o usuário
 * ligou a opção explicitamente.
 */
export function publicaOnlineNoTurno(pedido: PedidoDeTurno): boolean {
  return pedido.configuracao.permitirArtefatosOnline && pedido.modo !== "planejamento";
}

/** As ferramentas de artefato online, se a opção estiver ligada; senão nenhuma. */
export function ferramentasDeArtefatoOnline(permitido: boolean): readonly string[] {
  return permitido ? FERRAMENTAS_DE_ARTEFATO_ONLINE : [];
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

/**
 * Variáveis do próprio app que um agente não deve ver: a chave de acesso
 * (`ORQUESTRADOR_*`, com a qual um agente com Bash chamaria a API local para
 * mudar a própria configuração), a porta e a pasta de dados. Nada no fluxo dos
 * agentes usa a porta nem a pasta de dados: eles não chamam o app e as pastas
 * de artefatos chegam por caminho absoluto nas instruções.
 */
const VARIAVEIS_DO_APP_OCULTAS_DOS_AGENTES = ["PORTA", "PASTA_DADOS"];
const PREFIXO_DAS_VARIAVEIS_DO_APP = "ORQUESTRADOR_";

/**
 * Cópia do ambiente sem as variáveis que amarrariam o processo a uma sessão do
 * Claude Code já aberta e sem as do app (`ORQUESTRADOR_*`, porta e pasta de dados).
 */
export function ambienteSemSessaoPai(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const ambiente: NodeJS.ProcessEnv = { ...base };
  for (const variavel of VARIAVEIS_DA_SESSAO_PAI) {
    delete ambiente[variavel];
  }
  for (const variavel of VARIAVEIS_DO_APP_OCULTAS_DOS_AGENTES) {
    delete ambiente[variavel];
  }
  for (const variavel of Object.keys(ambiente)) {
    if (variavel.startsWith(PREFIXO_DAS_VARIAVEIS_DO_APP)) delete ambiente[variavel];
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
  /** Ausente com esforço `padrao` (e o Orquestrador fora do `ultracode`). */
  effort?: NivelDeEsforcoDoAgente;
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
/**
 * As ferramentas de um subagente: as do turno, as de artefato local e, só se
 * `podePublicarOnline` e a opção estiver ligada, as de artefato online. Elas
 * precisam estar aqui porque o `tools` de um agente definido em `--agents` é
 * uma lista fechada: o subagente não herda as ferramentas da sessão.
 */
function ferramentasDoSubagente(pedido: PedidoDeTurno, podePublicarOnline: boolean): string[] {
  return [
    ...comFerramentasDeArtefato(ferramentasDoTurno(pedido)),
    ...ferramentasDeSkill(pedido),
    ...ferramentasDeArtefatoOnline(podePublicarOnline && publicaOnlineNoTurno(pedido)),
  ];
}

/**
 * O executor e os subagentes prontos do usuário. Os prontos têm as mesmas
 * ferramentas, esforço e regra de commit do executor: nunca mais permissão
 * que o turno; só mudam a descrição, a especialidade e, se escolhido, o modelo.
 * O `Workflow` do `ultracode` nunca entra no `tools` deles. Só o `executor`
 * publica artefato online; os prontos não (nem ferramenta, nem instrução).
 * A `plataforma` decide a sintaxe da regra dos servidores de todos eles.
 */
export function definicaoDosAgentes(
  pedido: PedidoDeTurno,
  plataforma: Plataforma = "unix",
): Record<string, DefinicaoDeAgente> {
  const esforco = nivelDeEsforcoDosSubagentes(
    pedido.configuracao.esforcoDosSubagentes,
    pedido.configuracao.esforcoDoOrquestrador,
  );
  const permiteCommitEPush = pedido.configuracao.permiteCommitEPush(pedido.modo);
  const prontos = Object.fromEntries(
    pedido.subagentesProntos.map((subagente): [string, DefinicaoDeAgente] => [
      subagente.nome,
      {
        description: subagente.descricao,
        prompt: instrucoesDoSubagente(
          pedido.pastaDeTrabalho,
          permiteCommitEPush,
          pedido.pastaDeArtefatos,
          subagente,
          plataforma,
        ),
        tools: ferramentasDoSubagente(pedido, false),
        model: modeloDoSubagentePronto(subagente, pedido.configuracao.modeloDosSubagentes),
        ...(esforco === null ? {} : { effort: esforco }),
      },
    ]),
  );
  return {
    ...prontos,
    [NOME_DO_SUBAGENTE]: {
      description:
        "Executa uma subtarefa delegada pelo orquestrador e devolve um resultado objetivo.",
      prompt: instrucoesDoSubagente(
        pedido.pastaDeTrabalho,
        permiteCommitEPush,
        pedido.pastaDeArtefatos,
        null,
        plataforma,
        publicaOnlineNoTurno(pedido),
      ),
      tools: ferramentasDoSubagente(pedido, true),
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
 * imagens. A pasta dos anexos (imagens e documentos) entra em `--add-dir`: fora
 * da pasta do projeto, o Orquestrador e os Subagentes não teriam permissão para
 * abri-los; só as imagens vão inline, os documentos eles abrem pelo caminho.
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
 * `max` e `ultracode`, que as chaves de configuração não aceitam. Vale só
 * para este processo: cada turno a recebe de novo. Com `ultracode`, o
 * `Workflow` entra em `--tools` e em `--allowedTools` (`ferramentasDoEsforco`).
 *
 * A `Skill` entra nas duas listas só nos níveis que liberam edição e fora do
 * planejamento (`ferramentasDeSkill`).
 *
 * Com a opção de artefatos online ligada, `Artifact`, `ArtifactCheck` e
 * `ArtifactData` entram nas duas listas (`ferramentasDeArtefatoOnline`), menos
 * no planejamento (`publicaOnlineNoTurno`).
 */
export function montarArgumentos(pedido: PedidoDeTurno, arquivos: ArquivosDoTurno): string[] {
  const doNivel = [
    ...ferramentasDoTurno(pedido),
    FERRAMENTA_DE_SUBAGENTES,
    ...ferramentasDoEsforco(pedido.configuracao.esforcoDoOrquestrador),
    ...ferramentasDeSkill(pedido),
    ...ferramentasDeArtefatoOnline(publicaOnlineNoTurno(pedido)),
  ];
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
    ...(pedido.pastaDosAnexos === null ? [] : ["--add-dir", pedido.pastaDosAnexos]),
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
  return comVariaveisDeArtefatoOnline(ambiente, publicaOnlineNoTurno(pedido));
}
