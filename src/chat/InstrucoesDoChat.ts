import { z } from "zod";

import { linhasDaRegraDasPerguntas, MARCA_DA_PERGUNTA } from "../perguntas/PerguntaDoApp";
import { AcaoDoApp, abrirOrquestrador } from "./AcaoDoApp";
import type { OrquestradorExistente, ProjetoDoChat } from "./ProjetosDoChat";

/** Linguagem do bloco de código com que o Claude pede uma ação do app. */
export const MARCA_DA_ACAO = "acao-do-app";

const MARCA_DO_CONTEXTO = "contexto-do-app";

/**
 * Um bloco ```acao-do-app … ```, inclusive sem o fechamento (até o fim do
 * texto): mesmo malformado, ele sai da resposta.
 */
const BLOCO_DE_ACAO = /[ \t]*```[ \t]*acao-do-app[^\n]*(?:\n([\s\S]*?))?(?:```[ \t]*|$)/g;

const esquemaDaAcao = z.object({
  tipo: z.literal("abrir_orquestrador"),
  projeto: z.string().trim().min(1),
  pedido: z.string().nullable().optional(),
  novo: z.boolean().optional(),
});

/** Contexto do app que acompanha cada pergunta. */
export interface ContextoDoApp {
  agora: Date;
  pastaDosProjetos: string;
  projetos: readonly ProjetoDoChat[];
  orquestradores: readonly OrquestradorExistente[];
  /** Se o usuário já autorizou editar arquivos e rodar comandos nesta conversa. */
  alteracoesAutorizadas: boolean;
  /** Onde o chat grava artefatos (caminho absoluto); liberada sem autorização. */
  pastaDeArtefatos: string;
}

/** Branches em que o chat pode commitar, pela política do time. */
const PREFIXOS_DE_BRANCH = "feature/, fix/, hotfix/ ou refactor/";

/** Regra de commit e push: a mesma nas instruções e no bloco de cada mensagem. */
const REGRA_DE_COMMIT_E_PUSH = `Commit e push: só quando o usuário pedir explicitamente nesta mensagem. Sempre numa branch ${PREFIXOS_DE_BRANCH}, nunca na main; nunca push forçado; nunca a linha Co-authored-by.`;

const REGRA_DO_RELATORIO = "Se você alterou algo, termine a resposta listando os arquivos alterados e os comandos rodados.";

const REGRA_DAS_MUDANCAS_GRANDES =
  "Mudanças grandes (vários arquivos, refatoração): não faça pelo chat; sugira abrir um orquestrador no projeto, com o bloco de ação.";

const REGRA_DA_NEGACAO =
  "Se uma edição ou um comando for negado, diga em uma linha que precisa da autorização e pare. Não contorne a negação: nada de alterar por outro caminho (outra ferramenta, script, outro comando).";

/** Quando entregar um artefato (página ou relatório gravado para o usuário ver na tela). */
const QUANDO_CRIAR_ARTEFATO =
  "o usuário pedir uma visualização, relatório, diagrama, protótipo, dashboard ou página, ou quando a resposta ficar melhor como página do que como texto";

/**
 * Quando e como gravar um artefato, no bloco de cada mensagem: a pasta vai
 * aqui, com o caminho exato, porque o Claude Code não troca as instruções ao
 * retomar a sessão. Gravar nela é sempre permitido, então não pede autorização.
 */
function regrasDeArtefatos(pastaDeArtefatos: string): string[] {
  return [
    "Artefatos (liberados sempre, sem autorização; não contam como alterar projetos):",
    `- Quando ${QUANDO_CRIAR_ARTEFATO}, grave UM arquivo autocontido na pasta ${pastaDeArtefatos}`,
    "- Formato: .html com CSS e JS inline, sem CDN nem recursos externos (a rede é bloqueada) e imagens como data URI; ou .md. Até 5 MB. Nome do arquivo curto e descritivo, porque vira o título (ex.: comparativo-de-precos.html).",
    "- Para atualizar um artefato, regrave o MESMO arquivo: ele vira uma nova versão.",
    "- Na resposta, cite pelo nome o artefato criado ou atualizado.",
  ];
}

export interface RespostaSeparada {
  texto: string;
  acoes: AcaoDoApp[];
  avisos: string[];
}

/**
 * As regras fixas do chat. Vão uma vez, ao criar a sessão: ao retomá-la, o
 * Claude Code ignora instruções novas — o que muda entre perguntas (como a
 * autorização para alterar) vai no bloco de contexto de cada mensagem
 * (`mensagemParaOChat`), que prevalece sobre estas regras.
 */
export function instrucoesDoChat(): string {
  return [
    'Você é o assistente do chat rápido do app "Orquestrador de agentes", que o usuário usa para conversar com Orquestradores do Claude em seus projetos.',
    "",
    "Regras:",
    "1. Responda sempre em português, de forma direta e curta; use Markdown quando ajudar.",
    "2. Você pode pesquisar na web (WebSearch, WebFetch), ler (Read, Glob, Grep), editar arquivos (Edit, Write, NotebookEdit) e rodar comandos (PowerShell, Bash), mas só dentro das pastas dos projetos da pasta raiz. Arquivos .env* são bloqueados. A exceção é a pasta de artefatos (regra 9).",
    `3. Editar arquivos e rodar comandos exige uma autorização única do usuário, que vale até o próximo /clear. O bloco <${MARCA_DO_CONTEXTO}> diz se ela já foi dada. Sem ela, quando precisar editar ou rodar um comando, use a ferramenta mesmo assim: o app pede a autorização ao usuário. ${REGRA_DA_NEGACAO}`,
    `4. ${REGRA_DE_COMMIT_E_PUSH}`,
    `5. ${REGRA_DO_RELATORIO}`,
    `6. Cada mensagem do usuário começa com um bloco <${MARCA_DO_CONTEXTO}> com a data, a pasta raiz, os projetos, os orquestradores existentes e as permissões. Use-o para responder e não o comente; se ele divergir destas regras, vale o bloco.`,
    `7. Quando o usuário pedir para abrir ou criar um orquestrador num projeto, siga a regra de ações do bloco <${MARCA_DO_CONTEXTO}>: explique o que vai acontecer e inclua o bloco \`\`\`${MARCA_DA_ACAO}. Você não executa a ação — o usuário confirma clicando no cartão que aparece na tela.`,
    `8. ${REGRA_DAS_MUDANCAS_GRANDES}`,
    `9. Artefatos: quando ${QUANDO_CRIAR_ARTEFATO}, grave UM arquivo autocontido (.html ou .md) na pasta de artefatos que o bloco <${MARCA_DO_CONTEXTO}> indica, seguindo as regras dele. Gravar artefatos não precisa da autorização e não conta como alterar projetos.`,
    `10. Quando precisar que o usuário escolha entre opções claras, siga a regra de perguntas do bloco <${MARCA_DO_CONTEXTO}>: inclua o bloco \`\`\`${MARCA_DA_PERGUNTA}, que vira botões clicáveis na tela, e espere a resposta.`,
  ].join("\n");
}

/**
 * As permissões da pergunta. Declaram substituir as regras anteriores porque
 * sessões criadas antes da autorização existir guardam instruções antigas
 * ("nunca altera nada"), e o Claude Code não as troca ao retomar a sessão.
 */
function regrasDePermissao(contexto: ContextoDoApp): string[] {
  const situacao = contexto.alteracoesAutorizadas
    ? [
        "- Alterações AUTORIZADAS pelo usuário até o próximo /clear: edite arquivos e rode comandos quando o pedido exigir, sem pedir confirmação.",
        "- Se mesmo assim uma ação for bloqueada, é uma regra fixa do app: avise em uma linha e não contorne.",
      ]
    : [
        "- Alterações NÃO autorizadas ainda (gravar artefatos não depende disso). Se precisar editar um arquivo de projeto ou rodar um comando, use a ferramenta mesmo assim: o app pede a autorização ao usuário.",
        `- ${REGRA_DA_NEGACAO}`,
      ];
  return [
    "Permissões (substituem qualquer regra anterior sobre o que você pode alterar, inclusive as das instruções iniciais):",
    `- Você pode ler, editar arquivos e rodar comandos, mas só dentro das pastas dos projetos da pasta raiz (${contexto.pastaDosProjetos}). Rode os comandos na pasta do projeto. Arquivos .env* são bloqueados. A única pasta fora dos projetos em que você grava é a de artefatos (abaixo).`,
    ...situacao,
    `- ${REGRA_DE_COMMIT_E_PUSH}`,
    `- ${REGRA_DO_RELATORIO}`,
    `- ${REGRA_DAS_MUDANCAS_GRANDES}`,
  ];
}

function descreverData(agora: Date): string {
  try {
    return agora.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  } catch {
    return agora.toISOString();
  }
}

/**
 * A mensagem que o Claude recebe: o contexto do app e o texto do usuário.
 *
 * O contexto vai em cada mensagem, e não nas instruções, porque muda entre
 * perguntas (projetos e orquestradores novos) e porque o Claude Code ignora
 * instruções novas ao retomar a sessão.
 */
export function mensagemParaOChat(texto: string, contexto: ContextoDoApp): string {
  const projetos =
    contexto.projetos.length === 0
      ? ["- (nenhum projeto na pasta raiz)"]
      : contexto.projetos.map((projeto) => `- ${projeto.nome}`);
  const orquestradores =
    contexto.orquestradores.length === 0
      ? ["- (nenhum)"]
      : contexto.orquestradores.map((orquestrador) => `- ${orquestrador.nome} → ${orquestrador.pasta}`);
  const pergunta = texto.trim() === "" ? "Veja a imagem anexada." : texto;

  return [
    `<${MARCA_DO_CONTEXTO}>`,
    `Data e hora: ${descreverData(contexto.agora)} (${contexto.agora.toISOString()})`,
    `Pasta raiz dos projetos: ${contexto.pastaDosProjetos}`,
    "Projetos (nome da pasta):",
    ...projetos,
    "Orquestradores existentes (nome → pasta):",
    ...orquestradores,
    "",
    ...regrasDePermissao(contexto),
    "",
    ...regrasDeArtefatos(contexto.pastaDeArtefatos),
    "",
    "Ações do app: quando o usuário pedir para abrir ou criar um orquestrador num projeto (opcionalmente com um pedido para ele), responda explicando e inclua UM bloco por ação, exatamente assim:",
    "```" + MARCA_DA_ACAO,
    '{"tipo":"abrir_orquestrador","projeto":"<nome exato da pasta>","pedido":"<texto do pedido ou null>","novo":false}',
    "```",
    'Use "novo":true só quando o usuário pedir explicitamente outro (ou um novo) orquestrador num projeto que já tem um; caso contrário, omita o campo ou use false, e o app reaproveita o orquestrador existente.',
    "Diga que o usuário confirma clicando no cartão. Use só projetos da lista acima; nunca invente um projeto.",
    "",
    ...linhasDaRegraDasPerguntas(),
    `</${MARCA_DO_CONTEXTO}>`,
    "",
    pergunta,
  ].join("\n");
}

/**
 * Tira da resposta todos os blocos ```acao-do-app (inclusive os malformados)
 * e devolve as ações válidas, com a pasta resolvida pela lista de projetos.
 * O que não vale vira aviso legível, sem ação.
 */
export function separarAcoesDoApp(resposta: string, projetos: readonly ProjetoDoChat[]): RespostaSeparada {
  const acoes: AcaoDoApp[] = [];
  const avisos: string[] = [];

  const texto = resposta.replace(BLOCO_DE_ACAO, (_bloco, conteudo: string | undefined) => {
    const json = (conteudo ?? "").trim();
    let dados: unknown;
    try {
      dados = JSON.parse(json);
    } catch {
      avisos.push("O Claude sugeriu uma ação do app em formato inválido; ela foi ignorada.");
      return "";
    }
    const lida = esquemaDaAcao.safeParse(dados);
    if (!lida.success) {
      avisos.push("O Claude sugeriu uma ação do app em formato inválido; ela foi ignorada.");
      return "";
    }
    const nome = lida.data.projeto.toLocaleLowerCase("pt-BR");
    const projeto = projetos.find((candidato) => candidato.nome.toLocaleLowerCase("pt-BR") === nome);
    if (projeto === undefined) {
      avisos.push(`O projeto "${lida.data.projeto}" não existe na pasta raiz; a ação foi ignorada.`);
      return "";
    }
    acoes.push(abrirOrquestrador(projeto.nome, projeto.caminho, lida.data.pedido ?? null, lida.data.novo ?? false));
    return "";
  });

  if (texto === resposta) {
    return { texto: resposta, acoes, avisos };
  }
  return { texto: texto.replace(/\n{3,}/g, "\n\n").trim(), acoes, avisos };
}
