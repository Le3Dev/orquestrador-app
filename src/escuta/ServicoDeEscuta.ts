import { z } from "zod";

import type { ControleDeExecucoes } from "../orquestracao/ControleDeExecucoes";
import { limparRespostaDaMelhoria } from "../prompts/ServicoDeMelhoriaDePrompt";
import type { ClassificadorDePergunta } from "./ClassificadorDePergunta";
import { ErroDeEscuta } from "./ErroDeEscuta";
import { INSTRUCOES_DA_ESCUTA } from "./InstrucoesDaEscuta";

export const LIMITE_DO_TRECHO = 4_000;
export const LIMITE_DO_CONTEXTO = 12_000;
export const LIMITE_DA_PERGUNTA = 2_000;

/** Depois disso a classificação é abortada: uma pergunta velha já não ajuda o usuário. */
export const TEMPO_LIMITE_DA_CLASSIFICACAO_MS = 30_000;

export interface PedidoDeClassificacao {
  /** O trecho da transcrição que a regra local da tela marcou como possível pedido. */
  trecho: string;
  /** A transcrição recente da mesma fala, para completar a pergunta. */
  contexto?: string | undefined;
}

/** O veredito sobre o trecho: só traz `pergunta` quando há uma a responder. */
export interface ClassificacaoDaEscuta {
  readonly ehPergunta: boolean;
  readonly pergunta: string | null;
}

/** O formato que a instrução pede ao modelo; `pergunta` pode faltar quando não é pergunta. */
const esquemaDaResposta = z.object({
  ehPergunta: z.boolean(),
  pergunta: z.string().nullable().optional(),
});

/**
 * Lê o JSON da resposta já sem envoltório. Se o modelo escreveu algo em volta
 * do objeto, tenta o trecho entre a primeira `{` e a última `}`.
 */
function lerJson(resposta: string): unknown {
  try {
    return JSON.parse(resposta);
  } catch {
    const inicio = resposta.indexOf("{");
    const fim = resposta.lastIndexOf("}");
    if (inicio === -1 || fim <= inicio) {
      throw new ErroDeEscuta(
        "falha_do_motor",
        "O Claude devolveu uma classificação que não é um JSON válido. Tente de novo.",
      );
    }
    try {
      return JSON.parse(resposta.slice(inicio, fim + 1));
    } catch {
      throw new ErroDeEscuta(
        "falha_do_motor",
        "O Claude devolveu uma classificação que não é um JSON válido. Tente de novo.",
      );
    }
  }
}

/** Valida o formato e normaliza: sem pergunta de verdade, não é pergunta. */
function interpretarResposta(texto: string): ClassificacaoDaEscuta {
  const limpo = limparRespostaDaMelhoria(texto);
  if (limpo === "") {
    throw new ErroDeEscuta("falha_do_motor", "O Claude devolveu uma classificação vazia. Tente de novo.");
  }
  const lido = esquemaDaResposta.safeParse(lerJson(limpo));
  if (!lido.success) {
    throw new ErroDeEscuta(
      "falha_do_motor",
      'O Claude devolveu uma classificação fora do formato esperado ({"ehPergunta", "pergunta"}). Tente de novo.',
    );
  }
  const pergunta = (lido.data.pergunta ?? "").trim().slice(0, LIMITE_DA_PERGUNTA);
  if (!lido.data.ehPergunta || pergunta === "") {
    return { ehPergunta: false, pergunta: null };
  }
  return { ehPergunta: true, pergunta };
}

interface Dependencias {
  classificador: ClassificadorDePergunta;
  /** O mesmo controle dos turnos: ao desligar o servidor, a classificação em andamento é cancelada. */
  execucoes: ControleDeExecucoes;
  gerarId: () => string;
}

/**
 * Escuta no modo invisível: confirma, com uma chamada curta e barata, se um
 * trecho do áudio transcrito (que a regra local da tela marcou) é mesmo uma
 * pergunta ou um pedido a responder, e devolve a pergunta autocontida. Não
 * grava nada; stateless.
 */
export class ServicoDeEscuta {
  constructor(private readonly dependencias: Dependencias) {}

  async classificar(pedido: PedidoDeClassificacao, sinalDoCliente: AbortSignal): Promise<ClassificacaoDaEscuta> {
    const trecho = pedido.trecho.trim();
    if (trecho === "") {
      throw new ErroDeEscuta("dados_invalidos", "Envie o trecho da escuta para classificar.");
    }
    if (trecho.length > LIMITE_DO_TRECHO) {
      throw new ErroDeEscuta(
        "dados_invalidos",
        `O trecho deve ter até ${LIMITE_DO_TRECHO} caracteres para ser classificado.`,
      );
    }
    const contexto = (pedido.contexto ?? "").trim();
    if (contexto.length > LIMITE_DO_CONTEXTO) {
      throw new ErroDeEscuta("dados_invalidos", `O contexto deve ter até ${LIMITE_DO_CONTEXTO} caracteres.`);
    }

    const { classificador, execucoes, gerarId } = this.dependencias;
    const execucaoId = `escuta-classificacao-${gerarId()}`;
    const sinal = execucoes.iniciar(execucaoId);
    const cancelar = (): void => {
      execucoes.cancelar(execucaoId);
    };
    if (sinalDoCliente.aborted) {
      cancelar();
    } else {
      sinalDoCliente.addEventListener("abort", cancelar, { once: true });
    }
    // Num objeto: o temporizador preenche, e o TypeScript não estreita para `false`.
    const tempo = { estourou: false };
    const relogio = setTimeout(() => {
      tempo.estourou = true;
      cancelar();
    }, TEMPO_LIMITE_DA_CLASSIFICACAO_MS);

    try {
      const resultado = await classificador.classificar(
        { trecho, contexto: contexto === "" ? null : contexto, instrucoes: INSTRUCOES_DA_ESCUTA },
        sinal,
      );
      if (tempo.estourou) {
        throw new ErroDeEscuta(
          "falha_do_motor",
          `A classificação da escuta demorou demais (mais de ${TEMPO_LIMITE_DA_CLASSIFICACAO_MS / 1000} s).`,
        );
      }
      if (sinal.aborted) {
        throw new ErroDeEscuta("cancelada", "A classificação da escuta foi cancelada.");
      }
      if (!resultado.sucesso) {
        throw new ErroDeEscuta("falha_do_motor", resultado.motivo);
      }
      return interpretarResposta(resultado.texto);
    } finally {
      clearTimeout(relogio);
      sinalDoCliente.removeEventListener("abort", cancelar);
      execucoes.encerrar(execucaoId);
    }
  }
}
