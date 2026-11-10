import { z } from "zod";

import { normalizarEnderecoDePrevia } from "../orquestracao/EnderecoLocal";
import { desarmarMarcas } from "../orquestracao/InstrucoesPersonalizadas";

/**
 * Linguagem do bloco de código com que o agente pede ao app para fechar
 * prévias ao vivo que não são mais necessárias, no fim da resposta final:
 *
 *     ```previa-do-app
 *     {"fechar":["http://localhost:5173"]}
 *     ```
 *
 * A prévia abre quando a resposta final cita um endereço local completo; este
 * bloco é o caminho de volta. Mesmo padrão do bloco `pergunta-do-app`.
 */
export const MARCA_DA_PREVIA = "previa-do-app";

/** Quantas prévias um bloco (ou o conjunto deles) fecha, no máximo. */
export const MAXIMO_DE_PREVIAS_PARA_FECHAR = 10;

/** Quantas prévias abertas um pedido informa, no máximo, e o tamanho de cada endereço. */
export const MAXIMO_DE_PREVIAS_ABERTAS = 10;
export const TAMANHO_MAXIMO_DO_ENDERECO_DA_PREVIA = 2_000;

/**
 * Os endereços das prévias ao vivo abertas no canvas, mandados com o pedido
 * (mensagem, fila e chat) para o agente fechar as que não servem mais.
 * Opcional: ausente (clientes antigos) vale nenhuma. Inválido é recusado.
 */
export const esquemaDasPreviasAbertas = z
  .array(
    z
      .string({ error: "O endereço da prévia aberta deve ser um texto." })
      .max(TAMANHO_MAXIMO_DO_ENDERECO_DA_PREVIA, { error: "O endereço da prévia aberta é longo demais." })
      .regex(/^https?:\/\/\S+$/i, { error: "O endereço da prévia aberta deve começar com http:// ou https://." }),
    { error: "As prévias abertas devem ser uma lista." },
  )
  .max(MAXIMO_DE_PREVIAS_ABERTAS, { error: `Informe até ${MAXIMO_DE_PREVIAS_ABERTAS} prévias abertas por pedido.` })
  .default([]);

export interface RespostaSemPrevias {
  texto: string;
  /** Endereços normalizados das prévias a fechar, sem repetição, até o máximo. */
  previasParaFechar: string[];
}

/**
 * Um bloco ```previa-do-app … ```, inclusive sem o fechamento (até o fim do
 * texto): mesmo malformado, ele sai da resposta. A abertura precisa começar a
 * linha, para uma menção ao bloco no meio de uma frase não virar bloco.
 */
const BLOCO_DE_PREVIA = /^[ \t]*```[ \t]*previa-do-app[^\n]*(?:\n([\s\S]*?))?(?:```[ \t]*|(?![\s\S]))/gm;

/** Tolerante: só importa uma lista em `fechar`; cada item é conferido à parte. */
const esquemaDoBlocoDePrevia = z.object({ fechar: z.array(z.unknown()) });

/** Os endereços válidos de um bloco, ou nenhum se o bloco não vale. */
function lerBloco(conteudo: string): string[] {
  let dados: unknown;
  try {
    dados = JSON.parse(conteudo.trim());
  } catch {
    return [];
  }
  const lido = esquemaDoBlocoDePrevia.safeParse(dados);
  if (!lido.success) {
    return [];
  }
  const enderecos: string[] = [];
  for (const item of lido.data.fechar) {
    const normalizado = typeof item === "string" ? normalizarEnderecoDePrevia(item) : null;
    if (normalizado !== null) {
      enderecos.push(normalizado);
    }
  }
  return enderecos;
}

/**
 * Tira da resposta todos os blocos ```previa-do-app (inclusive os malformados
 * e o que não fecha) e devolve os endereços a fechar, normalizados como os
 * endereços locais (`http://localhost:5173`), sem repetição e até 10.
 * JSON inválido, item que não é texto e endereço inválido são descartados em
 * silêncio: o turno nunca quebra por causa do bloco.
 */
export function separarPreviasDoApp(resposta: string): RespostaSemPrevias {
  const encontrados = new Set<string>();

  const texto = resposta.replace(BLOCO_DE_PREVIA, (_bloco, conteudo: string | undefined) => {
    for (const endereco of lerBloco(conteudo ?? "")) {
      encontrados.add(endereco);
    }
    return "";
  });

  const previasParaFechar = [...encontrados].slice(0, MAXIMO_DE_PREVIAS_PARA_FECHAR);
  if (texto === resposta) {
    return { texto: resposta, previasParaFechar };
  }
  return { texto: texto.replace(/\n{3,}/g, "\n\n").trim(), previasParaFechar };
}

/** O texto sem os blocos ```previa-do-app: os endereços de um bloco que fecha prévias não a abrem. */
export function semBlocosDePrevia(texto: string): string {
  return texto.replace(BLOCO_DE_PREVIA, "");
}

/** O exemplo de bloco que vai na regra. */
const EXEMPLO_DO_BLOCO = ["```" + MARCA_DA_PREVIA, '{"fechar":["http://localhost:5173"]}', "```"];

/**
 * A regra da prévia ao vivo, linha a linha, para o modelo. Vai no bloco de
 * contexto de cada mensagem (chat e Orquestrador), porque o Claude Code não
 * relê as instruções ao retomar a sessão. A primeira linha é o princípio; as
 * seguintes detalham.
 */
export function linhasDaRegraDaPrevia(): string[] {
  return [
    "Prévia ao vivo: o app abre uma prévia (um navegador dentro do canvas) quando a sua resposta final cita um endereço local completo (http://localhost:PORTA). Cite esse endereço só quando o usuário pediu para ver a página, quando você precisa mostrar algo a ele ou quando ele precisa fazer login. Nunca o cite para validar endpoint, resposta de API ou outra verificação técnica: use curl e diga só a porta (ex.: \"a API na porta 3000 respondeu 200\").",
    `Feche as prévias que você abriu quando não forem mais necessárias, com um bloco \`\`\`${MARCA_DA_PREVIA} no fim da resposta, com a lista "fechar" (endereços completos, no máximo ${MAXIMO_DE_PREVIAS_PARA_FECHAR}). Exemplo:`,
    ...EXEMPLO_DO_BLOCO,
    "Antes de encerrar a tarefa, confira as prévias abertas listadas no pedido e feche as desnecessárias, exceto se o usuário pediu para mantê-las abertas. Não repita no texto os endereços do bloco.",
  ];
}

/**
 * A linha com as prévias abertas no canvas quando o pedido saiu, para o turno
 * conferi-las e fechar as desnecessárias. Sem prévias, nenhuma linha. Os
 * endereços vêm da tela: entram como dado, sem poder fechar o bloco do pedido
 * (`marcasDoBloco`).
 */
export function linhasDasPreviasAbertas(abertas: readonly string[], marcasDoBloco: readonly string[]): string[] {
  if (abertas.length === 0) {
    return [];
  }
  const enderecos = abertas.map((endereco) => desarmarMarcas(endereco, marcasDoBloco)).join(", ");
  return [
    `Prévias abertas no canvas agora: ${enderecos}. Feche com o bloco ${MARCA_DA_PREVIA} as que não forem mais necessárias.`,
  ];
}

/**
 * A parte da regra que vale para os Subagentes: eles nunca abrem nem fecham
 * prévias (só a resposta final do Orquestrador é lida), mas o endereço no
 * relatório deles também abriria uma.
 */
export const REGRA_DA_PREVIA_NO_SUBAGENTE =
  "Não cite endereços locais (http://localhost:PORTA) no relatório para verificação técnica: diga só a porta (ex.: \"a API na porta 3000 respondeu 200\"). O app abre uma prévia ao vivo para cada endereço local citado.";
