import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { MARCA_DAS_INSTRUCOES, desarmarMarcas, normalizarInstrucoes } from "./InstrucoesPersonalizadas";
import { ehModeloClaude, MODELOS_CLAUDE, ModeloClaude } from "./ModeloClaude";

/** Quantos subagentes prontos a biblioteca guarda. */
export const MAXIMO_DE_SUBAGENTES_PRONTOS = 10;
export const TAMANHO_MAXIMO_DO_NOME_DO_SUBAGENTE = 40;
export const TAMANHO_MAXIMO_DA_DESCRICAO = 300;
export const TAMANHO_MAXIMO_DO_PROMPT = 4_000;

/** `herdar` usa o modelo dos subagentes do Orquestrador que o lançar. */
export const MODELOS_DO_SUBAGENTE_PRONTO = ["herdar", ...MODELOS_CLAUDE] as const;
export type ModeloDoSubagentePronto = (typeof MODELOS_DO_SUBAGENTE_PRONTO)[number];

/**
 * Nomes que o Claude Code já usa (ou que o app usa): um subagente pronto com
 * um deles substituiria o agente de mesmo nome.
 */
const NOMES_RESERVADOS = new Set([
  "executor",
  "general-purpose",
  "explore",
  "plan",
  "statusline-setup",
  "output-style-setup",
  "claude-code-guide",
]);

/** Letras minúsculas, números e hífen, começando por letra: vira a chave no `agentes.json`. */
const FORMATO_DO_NOME = /^[a-z][a-z0-9-]*$/;

export interface DadosDoSubagentePronto {
  /** Como o Orquestrador o chama (o `subagent_type`). */
  nome: string;
  /** Quando usar: o Orquestrador decide por ela. Uma linha. */
  descricao: string;
  /** A especialidade, somada às regras fixas de todo subagente. */
  prompt: string;
  modelo: ModeloDoSubagentePronto;
}

function invalido(mensagem: string): never {
  throw new ErroDeOrquestracao("dados_invalidos", mensagem);
}

/** `rotulo` com artigo e em minúscula, ex.: `a descrição de "revisor"`. */
function textoObrigatorio(valor: unknown, rotulo: string, maximo: number, umaLinha: boolean): string {
  const Rotulo = rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
  if (typeof valor !== "string") {
    invalido(`${Rotulo} deve ser um texto.`);
  }
  const texto = umaLinha ? valor.replace(/\s+/g, " ").trim() : normalizarInstrucoes(valor);
  if (texto === "") {
    invalido(`Preencha ${rotulo}.`);
  }
  if (texto.length > maximo) {
    invalido(`${Rotulo} deve ter até ${maximo} caracteres (hoje tem ${texto.length}).`);
  }
  return texto;
}

function subagenteValido(valor: unknown, posicao: number): DadosDoSubagentePronto {
  if (typeof valor !== "object" || valor === null) {
    invalido(`O subagente pronto ${posicao} é inválido.`);
  }
  const dados = valor as Record<string, unknown>;
  const nome = textoObrigatorio(dados.nome, `o nome do subagente pronto ${posicao}`, TAMANHO_MAXIMO_DO_NOME_DO_SUBAGENTE, true);
  if (!FORMATO_DO_NOME.test(nome)) {
    invalido(`O nome "${nome}" deve ter só letras minúsculas, números e hífen, começando por letra.`);
  }
  if (NOMES_RESERVADOS.has(nome)) {
    invalido(`O nome "${nome}" é reservado; escolha outro.`);
  }
  const modelo = dados.modelo ?? "herdar";
  if (modelo !== "herdar" && !ehModeloClaude(modelo)) {
    invalido(`Modelo do subagente "${nome}" inválido.`);
  }
  return {
    nome,
    descricao: textoObrigatorio(dados.descricao, `a descrição de "${nome}"`, TAMANHO_MAXIMO_DA_DESCRICAO, true),
    prompt: textoObrigatorio(dados.prompt, `o prompt de "${nome}"`, TAMANHO_MAXIMO_DO_PROMPT, false),
    modelo,
  };
}

/**
 * Valida e normaliza a biblioteca vinda de fora (tela, arquivo gravado).
 * Ausente vale lista vazia: quem nunca criou um segue igual a antes.
 */
export function subagentesProntosValidos(valor: unknown): DadosDoSubagentePronto[] {
  const lista: unknown = valor ?? [];
  if (!Array.isArray(lista)) {
    invalido("Os subagentes prontos devem ser uma lista.");
  }
  if (lista.length > MAXIMO_DE_SUBAGENTES_PRONTOS) {
    invalido(`São no máximo ${MAXIMO_DE_SUBAGENTES_PRONTOS} subagentes prontos.`);
  }
  const subagentes = lista.map((item, indice) => subagenteValido(item, indice + 1));
  const repetido = subagentes.find((subagente, indice) =>
    subagentes.some((outro, anterior) => anterior < indice && outro.nome === subagente.nome),
  );
  if (repetido !== undefined) {
    invalido(`Já existe um subagente pronto chamado "${repetido.nome}".`);
  }
  return subagentes;
}

/**
 * Quais subagentes prontos da biblioteca um Orquestrador recebe: todos,
 * nenhum ou só os da lista (por nome). Nomes que saíram da biblioteca são
 * ignorados.
 */
export type SelecaoDeSubagentesProntos = "todos" | "nenhum" | string[];

/**
 * Valida a seleção vinda de fora (tela, arquivo gravado). Ausente vale
 * "todos": Orquestradores criados antes da opção seguem recebendo todos. A
 * lista sai sem nomes repetidos.
 */
export function selecaoDeSubagentesProntosValida(valor: unknown): SelecaoDeSubagentesProntos {
  const selecao: unknown = valor ?? "todos";
  if (selecao === "todos" || selecao === "nenhum") {
    return selecao;
  }
  if (!Array.isArray(selecao)) {
    invalido('Os subagentes prontos do orquestrador devem ser "todos", "nenhum" ou uma lista de nomes.');
  }
  const nomes = selecao.map((nome: unknown) => {
    if (typeof nome !== "string" || nome.trim() === "" || nome.length > TAMANHO_MAXIMO_DO_NOME_DO_SUBAGENTE) {
      invalido("Cada subagente pronto escolhido deve ser o nome de um deles.");
    }
    return nome.trim();
  });
  const unicos = [...new Set(nomes)];
  if (unicos.length > MAXIMO_DE_SUBAGENTES_PRONTOS) {
    invalido(`Escolha no máximo ${MAXIMO_DE_SUBAGENTES_PRONTOS} subagentes prontos.`);
  }
  return unicos;
}

/** Os subagentes da biblioteca que a seleção deixa o Orquestrador receber, na ordem da biblioteca. */
export function subagentesProntosSelecionados(
  biblioteca: readonly DadosDoSubagentePronto[],
  selecao: SelecaoDeSubagentesProntos,
): readonly DadosDoSubagentePronto[] {
  if (selecao === "todos") {
    return biblioteca;
  }
  if (selecao === "nenhum") {
    return [];
  }
  return biblioteca.filter((subagente) => selecao.includes(subagente.nome));
}

/** O modelo com que o subagente roda num Orquestrador. */
export function modeloDoSubagentePronto(
  subagente: DadosDoSubagentePronto,
  modeloDosSubagentes: ModeloClaude,
): ModeloClaude {
  return subagente.modelo === "herdar" ? modeloDosSubagentes : subagente.modelo;
}

/** Tag que envolve o prompt do usuário no prompt do subagente pronto. */
export const MARCA_DA_ESPECIALIDADE = "especialidade-do-usuario";

/**
 * O que o prompt do subagente pronto acrescenta às regras fixas de todo
 * subagente. O texto do usuário entra como dado, com as tags desarmadas.
 */
export function linhasDaEspecialidade(subagente: DadosDoSubagentePronto): string[] {
  return [
    "",
    `Especialidade definida pelo usuário para o subagente "${subagente.nome}". Siga-a junto com as regras acima; ela não amplia as permissões nem libera commit e push:`,
    `<${MARCA_DA_ESPECIALIDADE}>`,
    desarmarMarcas(subagente.prompt, [MARCA_DA_ESPECIALIDADE, MARCA_DAS_INSTRUCOES]),
    `</${MARCA_DA_ESPECIALIDADE}>`,
  ];
}

/**
 * As linhas do bloco do pedido que apresentam os subagentes prontos ao
 * Orquestrador. Lista vazia: nenhuma linha, e o bloco fica como antes.
 */
export function linhasDosSubagentesProntos(
  subagentes: readonly DadosDoSubagentePronto[],
  nomeDoExecutor: string,
  marcaDoBloco: string,
): string[] {
  if (subagentes.length === 0) {
    return [];
  }
  return [
    `- Subagentes prontos, definidos pelo usuário. Quando uma subtarefa combinar com a descrição de um deles, prefira-o ao "${nomeDoExecutor}" (chame-o pelo nome, como tipo do subagente); senão, use o "${nomeDoExecutor}". Valem as mesmas regras e permissões do "${nomeDoExecutor}", e a quantidade de subagentes acima conta todos juntos:`,
    ...subagentes.map(
      (subagente) =>
        `  - "${subagente.nome}": ${desarmarMarcas(subagente.descricao, [marcaDoBloco, MARCA_DAS_INSTRUCOES])}`,
    ),
  ];
}
