import { z } from "zod";

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
});

/** Contexto do app que acompanha cada pergunta. */
export interface ContextoDoApp {
  agora: Date;
  pastaDosProjetos: string;
  projetos: readonly ProjetoDoChat[];
  orquestradores: readonly OrquestradorExistente[];
}

export interface RespostaSeparada {
  texto: string;
  acoes: AcaoDoApp[];
  avisos: string[];
}

/**
 * As regras fixas do chat. Vão uma vez, ao criar a sessão: ao retomá-la, o
 * Claude Code ignora instruções novas — o que muda entre perguntas vai no
 * bloco de contexto de cada mensagem (`mensagemParaOChat`).
 */
export function instrucoesDoChat(): string {
  return [
    'Você é o assistente do chat rápido do app "Orquestrador de agentes", que o usuário usa para conversar com Orquestradores do Claude em seus projetos.',
    "",
    "Regras:",
    "1. Responda sempre em português, de forma direta e curta; use Markdown quando ajudar.",
    "2. Você pode pesquisar na web (WebSearch, WebFetch) e LER os projetos da pasta raiz (Read, Glob, Grep). Nunca altera nada: não edita arquivos, não roda comandos, não faz commits. Arquivos .env* são bloqueados.",
    `3. Cada mensagem do usuário começa com um bloco <${MARCA_DO_CONTEXTO}> com a data, a pasta raiz, os projetos e os orquestradores existentes. Use-o para responder e não o comente.`,
    `4. Quando o usuário pedir para abrir ou criar um orquestrador num projeto, siga a regra de ações do bloco <${MARCA_DO_CONTEXTO}>: explique o que vai acontecer e inclua o bloco \`\`\`${MARCA_DA_ACAO}. Você não executa a ação — o usuário confirma clicando no cartão que aparece na tela.`,
    "5. Para trabalho de verdade num projeto (alterar código, rodar testes), sugira abrir um orquestrador.",
  ].join("\n");
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
    "Ações do app: quando o usuário pedir para abrir ou criar um orquestrador num projeto (opcionalmente com um pedido para ele), responda explicando e inclua UM bloco por ação, exatamente assim:",
    "```" + MARCA_DA_ACAO,
    '{"tipo":"abrir_orquestrador","projeto":"<nome exato da pasta>","pedido":"<texto do pedido ou null>"}',
    "```",
    "Diga que o usuário confirma clicando no cartão. Use só projetos da lista acima; nunca invente um projeto.",
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
    acoes.push(abrirOrquestrador(projeto.nome, projeto.caminho, lida.data.pedido ?? null));
    return "";
  });

  if (texto === resposta) {
    return { texto: resposta, acoes, avisos };
  }
  return { texto: texto.replace(/\n{3,}/g, "\n\n").trim(), acoes, avisos };
}
