import { z } from "zod";

/**
 * Linguagem do bloco de código com que o Claude faz ao usuário uma pergunta
 * com opções clicáveis, no chat rápido e na conversa do Orquestrador.
 *
 * A ferramenta nativa AskUserQuestion não existe no modo `-p` (o Claude Code a
 * tira da sessão), então a pergunta vem num bloco no texto da resposta, como o
 * ```acao-do-app do chat e o marcador de plano do Orquestrador.
 */
export const MARCA_DA_PERGUNTA = "pergunta-do-app";

export const MAXIMO_DE_PERGUNTAS = 4;
export const MINIMO_DE_OPCOES = 2;
export const MAXIMO_DE_OPCOES = 6;
const TAMANHO_MAXIMO_DO_ENUNCIADO = 500;
const TAMANHO_MAXIMO_DO_ROTULO = 150;
const TAMANHO_MAXIMO_DA_DESCRICAO = 500;

/** Uma opção clicável. Objeto de valor. */
export interface OpcaoDaPergunta {
  readonly rotulo: string;
  readonly descricao: string | null;
}

/**
 * Uma pergunta com opções, já validada e normalizada: é o que vai para a
 * tela. Objeto de valor. A tela mostra as opções como botões (ou caixas de
 * marcar, com `multipla`) e um campo "Outro" para resposta livre.
 */
export interface PerguntaDoApp {
  readonly pergunta: string;
  readonly opcoes: readonly OpcaoDaPergunta[];
  readonly multipla: boolean;
}

export interface RespostaSemPerguntas {
  texto: string;
  perguntas: PerguntaDoApp[];
  avisos: string[];
}

/**
 * Um bloco ```pergunta-do-app … ```, inclusive sem o fechamento (até o fim do
 * texto): mesmo malformado, ele sai da resposta. A abertura precisa começar a
 * linha, para uma menção ao bloco no meio de uma frase não virar bloco.
 */
const BLOCO_DE_PERGUNTA = /^[ \t]*```[ \t]*pergunta-do-app[^\n]*(?:\n([\s\S]*?))?(?:```[ \t]*|(?![\s\S]))/gm;

const esquemaDaOpcao = z.union([
  z.string().trim().min(1).max(TAMANHO_MAXIMO_DO_ROTULO),
  z.object({
    rotulo: z.string().trim().min(1).max(TAMANHO_MAXIMO_DO_ROTULO),
    descricao: z.string().trim().max(TAMANHO_MAXIMO_DA_DESCRICAO).nullable().optional(),
  }),
]);

const esquemaDaPergunta = z.object({
  pergunta: z.string().trim().min(1).max(TAMANHO_MAXIMO_DO_ENUNCIADO),
  opcoes: z.array(esquemaDaOpcao).min(MINIMO_DE_OPCOES).max(MAXIMO_DE_OPCOES),
  multipla: z.boolean().optional(),
});

/** O conteúdo de um bloco: de 1 a 4 perguntas. */
export const esquemaDoBlocoDePergunta = z.object({
  perguntas: z.array(esquemaDaPergunta).min(1).max(MAXIMO_DE_PERGUNTAS),
});

type PerguntaLida = z.infer<typeof esquemaDaPergunta>;

const AVISO_DE_FORMATO = "O Claude fez uma pergunta com opções em formato inválido; ela foi ignorada.";
const AVISO_DE_EXCESSO = `O Claude fez mais de ${MAXIMO_DE_PERGUNTAS} perguntas de uma vez; só as ${MAXIMO_DE_PERGUNTAS} primeiras aparecem.`;

/** Cópia congelada: o objeto de valor não muda depois de criado. */
export function copiarPergunta(pergunta: PerguntaDoApp): PerguntaDoApp {
  return Object.freeze({
    pergunta: pergunta.pergunta,
    opcoes: Object.freeze(
      pergunta.opcoes.map((opcao) => Object.freeze({ rotulo: opcao.rotulo, descricao: opcao.descricao ?? null })),
    ),
    multipla: pergunta.multipla === true,
  });
}

function normalizar(lida: PerguntaLida): PerguntaDoApp | null {
  const opcoes = lida.opcoes.map((opcao) =>
    typeof opcao === "string"
      ? { rotulo: opcao, descricao: null }
      : // Descrição vazia (depois do trim) vale como ausente.
        { rotulo: opcao.rotulo, descricao: opcao.descricao ? opcao.descricao : null },
  );
  // Duas opções com o mesmo rótulo não dão para distinguir na tela nem na resposta.
  const rotulos = new Set(opcoes.map((opcao) => opcao.rotulo.toLocaleLowerCase("pt-BR")));
  if (rotulos.size !== opcoes.length) {
    return null;
  }
  return copiarPergunta({ pergunta: lida.pergunta, opcoes, multipla: lida.multipla ?? false });
}

/** As perguntas válidas de um bloco, ou nulo se o bloco não vale. */
function lerBloco(conteudo: string): PerguntaDoApp[] | null {
  let dados: unknown;
  try {
    dados = JSON.parse(conteudo.trim());
  } catch {
    return null;
  }
  const lido = esquemaDoBlocoDePergunta.safeParse(dados);
  if (!lido.success) {
    return null;
  }
  const perguntas = lido.data.perguntas.map(normalizar);
  return perguntas.every((pergunta): pergunta is PerguntaDoApp => pergunta !== null) ? perguntas : null;
}

/**
 * Tira da resposta todos os blocos ```pergunta-do-app (inclusive os
 * malformados e o que não fecha) e devolve as perguntas válidas, juntando as
 * de vários blocos até o máximo de 4. Bloco inválido vira aviso legível, sem
 * perguntas; o que passar do máximo é descartado com aviso.
 */
export function separarPerguntasDoApp(resposta: string): RespostaSemPerguntas {
  const perguntas: PerguntaDoApp[] = [];
  const avisos: string[] = [];
  let excedeu = false;

  const texto = resposta.replace(BLOCO_DE_PERGUNTA, (_bloco, conteudo: string | undefined) => {
    const lidas = lerBloco(conteudo ?? "");
    if (lidas === null) {
      avisos.push(AVISO_DE_FORMATO);
      return "";
    }
    const vagas = MAXIMO_DE_PERGUNTAS - perguntas.length;
    if (lidas.length > vagas) {
      excedeu = true;
    }
    perguntas.push(...lidas.slice(0, Math.max(vagas, 0)));
    return "";
  });

  if (excedeu) {
    avisos.push(AVISO_DE_EXCESSO);
  }
  if (texto === resposta) {
    return { texto: resposta, perguntas, avisos };
  }
  return { texto: texto.replace(/\n{3,}/g, "\n\n").trim(), perguntas, avisos };
}

/** O exemplo de bloco que vai na regra. */
const EXEMPLO_DO_BLOCO = [
  "```" + MARCA_DA_PERGUNTA,
  '{"perguntas":[{"pergunta":"Qual banco usar?","opcoes":[{"rotulo":"Postgres","descricao":"já usado no projeto"},"SQLite"],"multipla":false}]}',
  "```",
];

/**
 * A regra do bloco de perguntas, linha a linha, para o modelo. Vai no bloco de
 * contexto de cada mensagem (chat e Orquestrador), porque o Claude Code não
 * relê as instruções ao retomar a sessão.
 */
export function linhasDaRegraDasPerguntas(): string[] {
  return [
    `Perguntas com opções: quando precisar que o usuário decida entre opções claras (qual abordagem, qual biblioteca, qual escopo), não pergunte só no texto; inclua um bloco \`\`\`${MARCA_DA_PERGUNTA}, que o app mostra como botões clicáveis. Não use o bloco para perguntas abertas, que pedem resposta livre: essas vão no texto normal.`,
    `Formato: JSON com "perguntas" (de 1 a ${MAXIMO_DE_PERGUNTAS}); cada uma com "pergunta", "opcoes" (de ${MINIMO_DE_OPCOES} a ${MAXIMO_DE_OPCOES}; cada opção é um texto curto ou {"rotulo","descricao"}, com a descrição opcional) e "multipla" (true quando dá para escolher mais de uma; padrão false). Exemplo:`,
    ...EXEMPLO_DO_BLOCO,
    'Não repita a pergunta nem as opções no texto fora do bloco. O app já mostra um campo "Outro" para resposta livre: não inclua "Outro" nas opções.',
    'Depois do bloco, encerre a resposta e espere: a escolha do usuário chega como a próxima mensagem, uma linha por pergunta, no formato "pergunta → escolha".',
  ];
}
