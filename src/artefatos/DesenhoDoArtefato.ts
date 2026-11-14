import { z } from "zod";

/*
 * O desenho que o usuário faz por cima de uma versão de um Artefato (setas,
 * rabiscos, textos soltos). Os valores aceitos são os mesmos da tela
 * (web/src/shared/canvas/layout.ts): mudou lá, muda aqui.
 */

export const TIPOS_DE_TRACO = ["caneta", "marca-texto", "linha", "seta", "retangulo", "texto"] as const;
export type TipoDoTraco = (typeof TIPOS_DE_TRACO)[number];
export const CORES_DO_DESENHO = ["laranja", "claro", "azul", "verde", "kraft", "vermelho"] as const;
export type CorDoDesenho = (typeof CORES_DO_DESENHO)[number];
export const ESPESSURAS_DO_DESENHO = [2, 3, 6] as const;
export type EspessuraDoDesenho = (typeof ESPESSURAS_DO_DESENHO)[number];

export const MAXIMO_DE_PONTOS_NO_TRACO = 5000;
export const MAXIMO_DE_CARACTERES_NO_TEXTO = 500;
export const MAXIMO_DE_TRACOS_NO_DESENHO = 2000;
export const MAXIMO_DE_INDICES_NO_CAMINHO = 64;
export const LARGURA_MINIMA_DA_PAGINA = 200;
export const LARGURA_MAXIMA_DA_PAGINA = 10000;
export const TAMANHO_MAXIMO_DA_IDENTIDADE_DO_TRACO = 64;

export const MENSAGEM_DE_DESENHO_INVALIDO = "Desenho inválido.";

export interface PontoDoTraco {
  x: number;
  y: number;
}

/**
 * Onde o traço está preso no conteúdo: caminhos de índices de filhos
 * (element children). `conteiner` parte do elemento raiz do documento até o
 * contêiner que rola ([] = o próprio documento); `elemento` parte do
 * contêiner até o elemento âncora ([] = o próprio contêiner).
 */
export interface AncoraDoTraco {
  conteiner: number[];
  elemento: number[];
}

export interface TracoGravado {
  id: string;
  tipo: TipoDoTraco;
  cor: CorDoDesenho;
  espessura: EspessuraDoDesenho;
  pontos: PontoDoTraco[];
  /** Só no tipo `texto`; nos outros tipos é descartado. */
  texto?: string;
  /** `null`: os pontos estão em coordenadas do documento. */
  ancora: AncoraDoTraco | null;
}

/**
 * O desenho de uma versão: os traços e a largura, em pixels, da página em que
 * foram feitos. Com a largura, a tela monta a página nela e escala para caber,
 * e o desenho fica no lugar em qualquer janela. `null`: desenho gravado antes
 * de a largura ser guardada, mostrado sem escala.
 */
export interface DesenhoGravado {
  tracos: TracoGravado[];
  largura: number | null;
}

function mensagem(detalhe: string): { error: string } {
  return { error: `${MENSAGEM_DE_DESENHO_INVALIDO} ${detalhe}` };
}

const esquemaDoIndice = z
  .number(mensagem("Índice do caminho deve ser número."))
  .int(mensagem("Índice do caminho deve ser inteiro."))
  .nonnegative(mensagem("Índice do caminho não pode ser negativo."));

const esquemaDoCaminho = z
  .array(esquemaDoIndice, mensagem("Caminho da âncora deve ser uma lista."))
  .max(MAXIMO_DE_INDICES_NO_CAMINHO, mensagem(`Caminho da âncora com mais de ${MAXIMO_DE_INDICES_NO_CAMINHO} índices.`));

const esquemaDoPonto = z.object(
  {
    x: z.number(mensagem("Coordenada do ponto deve ser número finito.")),
    y: z.number(mensagem("Coordenada do ponto deve ser número finito.")),
  },
  mensagem("Ponto deve ter x e y."),
);

/** `z.object` descarta os campos desconhecidos: só o que está aqui vai para o disco. */
const esquemaDoTraco = z
  .object(
    {
      id: z
        .string(mensagem("Identidade do traço deve ser texto."))
        .min(1, mensagem("Identidade do traço vazia."))
        .max(TAMANHO_MAXIMO_DA_IDENTIDADE_DO_TRACO, mensagem("Identidade do traço longa demais.")),
      tipo: z.enum(TIPOS_DE_TRACO, mensagem("Tipo de traço desconhecido.")),
      cor: z.enum(CORES_DO_DESENHO, mensagem("Cor desconhecida.")),
      espessura: z.literal(ESPESSURAS_DO_DESENHO, mensagem("Espessura desconhecida.")),
      pontos: z
        .array(esquemaDoPonto, mensagem("Pontos do traço devem ser uma lista."))
        .min(1, mensagem("Traço sem pontos."))
        .max(MAXIMO_DE_PONTOS_NO_TRACO, mensagem(`Traço com mais de ${MAXIMO_DE_PONTOS_NO_TRACO} pontos.`)),
      texto: z
        .string(mensagem("Texto do traço deve ser texto."))
        .max(MAXIMO_DE_CARACTERES_NO_TEXTO, mensagem(`Texto com mais de ${MAXIMO_DE_CARACTERES_NO_TEXTO} caracteres.`))
        .optional(),
      ancora: z
        .object(
          { conteiner: esquemaDoCaminho, elemento: esquemaDoCaminho },
          mensagem("Âncora deve ser null ou ter contêiner e elemento."),
        )
        .nullable(),
    },
    mensagem("Traço deve ser um objeto."),
  )
  .transform(({ texto, ...traco }): TracoGravado =>
    traco.tipo === "texto" && texto !== undefined ? { ...traco, texto } : traco,
  );

export const esquemaDoDesenho = z
  .array(esquemaDoTraco, mensagem("Traços devem ser uma lista."))
  .max(MAXIMO_DE_TRACOS_NO_DESENHO, mensagem(`Mais de ${MAXIMO_DE_TRACOS_NO_DESENHO} traços.`));

const MENSAGEM_DE_LARGURA_INVALIDA = `Largura da página deve ser inteiro de ${LARGURA_MINIMA_DA_PAGINA} a ${LARGURA_MAXIMA_DA_PAGINA}, ou null.`;

/** Ausente vale `null`: quem grava sem largura (o formato anterior) segue aceito. */
const esquemaDaLargura = z
  .number(mensagem(MENSAGEM_DE_LARGURA_INVALIDA))
  .int(mensagem(MENSAGEM_DE_LARGURA_INVALIDA))
  .min(LARGURA_MINIMA_DA_PAGINA, mensagem(MENSAGEM_DE_LARGURA_INVALIDA))
  .max(LARGURA_MAXIMA_DA_PAGINA, mensagem(MENSAGEM_DE_LARGURA_INVALIDA))
  .nullable()
  .default(null);

/** O corpo do PUT e o conteúdo de `v<N>.desenho.json`: `{ "tracos": [...], "largura": n | null }`. */
export const esquemaDoArquivoDoDesenho = z.object(
  { tracos: esquemaDoDesenho, largura: esquemaDaLargura },
  mensagem("Corpo deve ser { tracos: [...], largura: n | null }."),
);

/** O desenho de uma versão que não tem traços. */
export function desenhoVazio(): DesenhoGravado {
  return { tracos: [], largura: null };
}
