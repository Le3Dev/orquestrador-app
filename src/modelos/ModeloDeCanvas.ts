import { z } from "zod";

import { TAMANHO_MAXIMO_DO_TEXTO, TAMANHO_MAXIMO_DO_TITULO } from "../notas/Nota";
import { ESFORCOS_DE_RACIOCINIO } from "../orquestracao/EsforcoDeRaciocinio";
import { TAMANHO_MAXIMO_DAS_INSTRUCOES } from "../orquestracao/InstrucoesPersonalizadas";
import { MODELOS_CLAUDE } from "../orquestracao/ModeloClaude";
import { NIVEIS_DE_PERMISSAO } from "../orquestracao/NivelDePermissao";
import { TAMANHO_MAXIMO_DO_NOME } from "../orquestracao/Orquestrador";
import { LIMITE_DE_SUBAGENTES } from "../orquestracao/QuantidadeDeSubagentes";

/**
 * Modelo de canvas: um arranjo salvo (orquestradores, notas, prévias e
 * terminais, com as posições relativas) para recriar depois ou compartilhar.
 * Guarda só o que serve para recriar: nunca conversa, eventos, worktree ou id
 * de orquestrador. Quem recria é a tela, pela mesma API de criar cada item.
 */

export const MAXIMO_DE_MODELOS = 50;
export const MAXIMO_DE_ITENS_POR_MODELO = 30;
export const TAMANHO_MAXIMO_DO_NOME_DO_MODELO = 80;
export const TAMANHO_MAXIMO_DO_ICONE = 16;
export const TAMANHO_MAXIMO_DO_CAMINHO = 1_000;
export const TAMANHO_MAXIMO_DO_COMANDO = 2_000;
export const TAMANHO_MAXIMO_DO_ENDERECO = 2_000;
/** Posições relativas ao canto do arranjo: folgadas, mas finitas. */
const LIMITE_DA_POSICAO = 100_000;
const TAMANHO_MINIMO_DA_JANELA = 40;
const TAMANHO_MAXIMO_DA_JANELA = 5_000;

/** O `formato` do arquivo exportado: o que a importação aceita. */
export const FORMATO_DO_ARQUIVO = "orquestrador-de-agentes/modelo-de-canvas";
export const VERSAO_DO_ARQUIVO = 1;

const COR = /^#[0-9a-fA-F]{6}$/;

/** Texto opcional, aparado; vazio vale como ausente para quem recria. */
function textoOpcional(rotulo: string, maximo: number) {
  return z
    .string({ error: `${rotulo} deve ser um texto.` })
    .trim()
    .max(maximo, { error: `${rotulo} deve ter até ${maximo} caracteres.` })
    .optional();
}

const esquemaDaPosicao = z
  .number({ error: "A posição de cada item deve ser um número." })
  .min(-LIMITE_DA_POSICAO, { error: "A posição de um item está longe demais." })
  .max(LIMITE_DA_POSICAO, { error: "A posição de um item está longe demais." });

const esquemaDoTamanho = z
  .number({ error: "O tamanho de cada item deve ser um número." })
  .min(TAMANHO_MINIMO_DA_JANELA, { error: `Cada item deve ter pelo menos ${TAMANHO_MINIMO_DA_JANELA} px.` })
  .max(TAMANHO_MAXIMO_DA_JANELA, { error: `Cada item deve ter até ${TAMANHO_MAXIMO_DA_JANELA} px.` })
  .optional();

/** Onde o item fica, relativo ao canto de cima à esquerda do arranjo; sem tamanho, vale o padrão da tela. */
const camposDoLugar = {
  x: esquemaDaPosicao,
  y: esquemaDaPosicao,
  largura: esquemaDoTamanho,
  altura: esquemaDoTamanho,
};

/**
 * A configuração do orquestrador, no esquema do POST de orquestradores (as
 * instruções com o mesmo limite bruto folgado: o de fato é conferido ao recriar).
 */
const esquemaDaConfiguracao = z.object(
  {
    modeloDoOrquestrador: z.enum(MODELOS_CLAUDE, { error: "Modelo do orquestrador inválido." }),
    modeloDosSubagentes: z.enum(MODELOS_CLAUDE, { error: "Modelo dos subagentes inválido." }),
    quantidadeDeSubagentes: z.object(
      {
        modo: z.enum(["fixa", "automatica"], { error: "Modo da quantidade inválido." }),
        limite: z
          .number({ error: "Informe a quantidade de subagentes." })
          .int({ error: "A quantidade de subagentes deve ser um número inteiro." })
          .min(1, { error: "Use pelo menos 1 subagente." })
          .max(LIMITE_DE_SUBAGENTES, { error: `Use no máximo ${LIMITE_DE_SUBAGENTES} subagentes.` }),
      },
      { error: "Informe a quantidade de subagentes." },
    ),
    nivelDePermissao: z.enum(NIVEIS_DE_PERMISSAO, { error: "Nível de permissão inválido." }),
    permitirCommitEPush: z
      .boolean({ error: 'A opção "Permitir commit e push" deve ser verdadeira ou falsa.' })
      .optional(),
    esforcoDoOrquestrador: z.enum(ESFORCOS_DE_RACIOCINIO, { error: "Esforço do orquestrador inválido." }).optional(),
    esforcoDosSubagentes: z.enum(ESFORCOS_DE_RACIOCINIO, { error: "Esforço dos subagentes inválido." }).optional(),
    instrucoesPersonalizadas: z
      .string({ error: "As instruções personalizadas devem ser um texto." })
      .max(TAMANHO_MAXIMO_DAS_INSTRUCOES * 2, {
        error: `As instruções personalizadas devem ter até ${TAMANHO_MAXIMO_DAS_INSTRUCOES} caracteres.`,
      })
      .optional(),
    subagentesProntos: z
      .union([z.enum(["todos", "nenhum"]), z.array(z.string().max(100)).max(100)], {
        error: 'Os subagentes prontos do orquestrador devem ser "todos", "nenhum" ou uma lista de nomes.',
      })
      .optional(),
  },
  { error: "Envie a configuração do orquestrador." },
);

const esquemaDoOrquestrador = z.object({
  tipo: z.literal("orquestrador"),
  ...camposDoLugar,
  nome: z
    .string({ error: "Dê um nome ao orquestrador." })
    .trim()
    .min(1, { error: "Dê um nome ao orquestrador." })
    .max(TAMANHO_MAXIMO_DO_NOME, { error: `O nome do orquestrador deve ter até ${TAMANHO_MAXIMO_DO_NOME} caracteres.` }),
  /** Ausente (ex.: exportado sem caminhos): a tela pede a pasta ao recriar. */
  pastaDeTrabalho: textoOpcional("A pasta do orquestrador", TAMANHO_MAXIMO_DO_CAMINHO),
  configuracao: esquemaDaConfiguracao,
});

const esquemaDaNota = z.object({
  tipo: z.literal("nota"),
  ...camposDoLugar,
  titulo: z
    .string({ error: "O título da nota deve ser um texto." })
    .trim()
    .min(1, { error: `O título da nota deve ter entre 1 e ${TAMANHO_MAXIMO_DO_TITULO} caracteres.` })
    .max(TAMANHO_MAXIMO_DO_TITULO, {
      error: `O título da nota deve ter entre 1 e ${TAMANHO_MAXIMO_DO_TITULO} caracteres.`,
    }),
  texto: z
    .string({ error: "O conteúdo da nota deve ser um texto." })
    .max(TAMANHO_MAXIMO_DO_TEXTO, { error: "A nota pode ter até 100.000 caracteres." }),
});

const esquemaDaPrevia = z.object({
  tipo: z.literal("previa"),
  ...camposDoLugar,
  /** Vazio: a prévia abre com o campo de endereço vazio. */
  url: z
    .string({ error: "O endereço da prévia deve ser um texto." })
    .trim()
    .max(TAMANHO_MAXIMO_DO_ENDERECO, { error: "O endereço da prévia é longo demais." })
    .refine((url) => url === "" || /^https?:\/\//i.test(url), {
      error: "O endereço da prévia deve começar com http:// ou https://.",
    }),
});

const esquemaDoTerminal = z.object({
  tipo: z.literal("terminal"),
  ...camposDoLugar,
  /** Ausente: a tela pede a pasta ao recriar. */
  pasta: textoOpcional("A pasta do terminal", TAMANHO_MAXIMO_DO_CAMINHO),
  /** Só guardado e mostrado: recriar nunca executa nem digita o comando. */
  comando: textoOpcional("O comando do terminal", TAMANHO_MAXIMO_DO_COMANDO),
});

const esquemaDoItem = z.discriminatedUnion(
  "tipo",
  [esquemaDoOrquestrador, esquemaDaNota, esquemaDaPrevia, esquemaDoTerminal],
  { error: 'Tipo de item do modelo inválido (use "orquestrador", "nota", "previa" ou "terminal").' },
);

const esquemaDoNomeDoModelo = z
  .string({ error: "Dê um nome ao modelo." })
  .trim()
  .min(1, { error: "Dê um nome ao modelo." })
  .max(TAMANHO_MAXIMO_DO_NOME_DO_MODELO, {
    error: `O nome do modelo deve ter até ${TAMANHO_MAXIMO_DO_NOME_DO_MODELO} caracteres.`,
  });

const esquemaDoIcone = z
  .string({ error: "Escolha um ícone para o modelo." })
  .trim()
  .min(1, { error: "Escolha um ícone para o modelo." })
  .max(TAMANHO_MAXIMO_DO_ICONE, { error: "O ícone do modelo deve ser um emoji ou um nome curto." });

const esquemaDaCor = z
  .string({ error: "Escolha uma cor para o modelo." })
  .regex(COR, { error: "A cor do modelo deve estar no formato #rrggbb." });

/** O que se salva num modelo: nome, ícone, cor e os itens (de 1 a 30). */
export const esquemaDoConteudoDoModelo = z.object(
  {
    nome: esquemaDoNomeDoModelo,
    icone: esquemaDoIcone,
    cor: esquemaDaCor,
    itens: z
      .array(esquemaDoItem, { error: "Os itens do modelo devem ser uma lista." })
      .min(1, { error: "O modelo precisa de pelo menos 1 item." })
      .max(MAXIMO_DE_ITENS_POR_MODELO, {
        error: `Um modelo pode ter até ${MAXIMO_DE_ITENS_POR_MODELO} itens.`,
      }),
  },
  { error: "Envie os dados do modelo." },
);

/** Renomear, trocar o ícone ou a cor: só o que vier muda. */
export const esquemaDaAlteracaoDoModelo = z.object(
  {
    nome: esquemaDoNomeDoModelo.optional(),
    icone: esquemaDoIcone.optional(),
    cor: esquemaDaCor.optional(),
  },
  { error: "Envie os dados do modelo." },
);

/** O arquivo exportado, como a importação o lê: o envelope com o formato e o modelo dentro. */
export const esquemaDoArquivoExportado = z.object(
  {
    formato: z.literal(FORMATO_DO_ARQUIVO, { error: "Este arquivo não é um modelo de canvas do Orquestrador." }),
    versao: z.literal(VERSAO_DO_ARQUIVO, { error: "Versão de modelo de canvas não suportada." }),
    modelo: esquemaDoConteudoDoModelo,
  },
  { error: "Este arquivo não é um modelo de canvas do Orquestrador." },
);

export type ItemDoModelo = z.infer<typeof esquemaDoItem>;
export type ConteudoDoModeloDeCanvas = z.infer<typeof esquemaDoConteudoDoModelo>;
export type AlteracaoDoModeloDeCanvas = z.infer<typeof esquemaDaAlteracaoDoModelo>;

export interface DadosDoModeloDeCanvas extends ConteudoDoModeloDeCanvas {
  id: string;
  /** ISO 8601 */
  criadoEm: string;
  /** ISO 8601 */
  atualizadoEm: string;
}

export interface ArquivoDoModeloDeCanvas {
  formato: typeof FORMATO_DO_ARQUIVO;
  versao: typeof VERSAO_DO_ARQUIVO;
  /** ISO 8601 */
  exportadoEm: string;
  modelo: ConteudoDoModeloDeCanvas;
}

/** O que fica no lugar de um segredo removido. */
export const MARCA_DE_SEGREDO_REMOVIDO = "[removido]";

/** Chaves e tokens conhecidos, soltos no texto. */
const TOKENS_CONHECIDOS: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

/** `token=…`, `API_KEY: …`, `senha = …`: o nome fica, o valor sai. */
const ATRIBUICAO_DE_SEGREDO =
  /\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|senha|password|passwd|pwd|access[_-]?key|credential|auth)[A-Za-z0-9_-]*)(\s*[:=]\s*)(["']?)[^\s"'&,;]{4,}\3/gi;

/** Parâmetros de endereço que costumam levar credenciais. */
const PARAMETRO_DE_SEGREDO = /token|key|secret|senha|password|pass|auth|sig|signature|session|credential|code/i;

/** Tira do texto o que parece chave, token ou senha. */
export function semSegredos(texto: string): string {
  let limpo = texto.replace(ATRIBUICAO_DE_SEGREDO, `$1$2$3${MARCA_DE_SEGREDO_REMOVIDO}$3`);
  for (const padrao of TOKENS_CONHECIDOS) {
    limpo = limpo.replace(padrao, MARCA_DE_SEGREDO_REMOVIDO);
  }
  return limpo;
}

/** Tira do endereço o usuário, a senha e os parâmetros com cara de credencial. */
export function enderecoSemSegredos(url: string): string {
  let endereco: URL;
  try {
    endereco = new URL(url);
  } catch {
    return semSegredos(url);
  }
  let mudou = endereco.username !== "" || endereco.password !== "";
  endereco.username = "";
  endereco.password = "";
  for (const nome of [...endereco.searchParams.keys()]) {
    if (PARAMETRO_DE_SEGREDO.test(nome)) {
      endereco.searchParams.delete(nome);
      mudou = true;
    }
  }
  return mudou ? endereco.toString() : semSegredos(url);
}

/**
 * O modelo para levar a outra máquina sem "comandos, caminhos e tokens": sem
 * as pastas dos orquestradores e dos terminais, sem os comandos e com os
 * segredos aparentes tirados dos textos e dos endereços. Os campos de fora do
 * esquema já não passam da validação.
 */
export function semCaminhosNemSegredos(conteudo: ConteudoDoModeloDeCanvas): ConteudoDoModeloDeCanvas {
  const itens = conteudo.itens.map((item): ItemDoModelo => {
    switch (item.tipo) {
      case "orquestrador": {
        const { pastaDeTrabalho: _pasta, ...semPasta } = item;
        const instrucoes = item.configuracao.instrucoesPersonalizadas;
        return {
          ...semPasta,
          configuracao: {
            ...item.configuracao,
            ...(instrucoes === undefined ? {} : { instrucoesPersonalizadas: semSegredos(instrucoes) }),
          },
        };
      }
      case "nota":
        return { ...item, titulo: semSegredos(item.titulo), texto: semSegredos(item.texto) };
      case "previa":
        return { ...item, url: item.url === "" ? "" : enderecoSemSegredos(item.url) };
      case "terminal": {
        const { pasta: _pasta, comando: _comando, ...semNada } = item;
        return semNada;
      }
    }
  });
  return { ...conteudo, itens };
}
