import { Response, Router } from "express";
import { z } from "zod";

import { ErroDeMelhoriaDePrompt, MotivoDoErroDeMelhoriaDePrompt } from "../prompts/ErroDeMelhoriaDePrompt";
import { ServicoDeMelhoriaDePrompt } from "../prompts/ServicoDeMelhoriaDePrompt";
import { responderErroGenerico } from "./respostasHttp";

interface Dependencias {
  servico: ServicoDeMelhoriaDePrompt;
}

/**
 * Aqui só se confere o formato do corpo; as regras (texto vazio, tamanho,
 * destino) são do serviço, que devolve a mensagem certa.
 */
const esquemaDaMelhoria = z.object(
  {
    texto: z.string({ error: "Envie o texto do pedido." }),
    onde: z.string({ error: "Destino do pedido inválido." }),
    pasta: z.string({ error: "A pasta deve ser um texto." }).optional(),
  },
  { error: "Envie o pedido para melhorar." },
);

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErroDeMelhoriaDePrompt, number>> = {
  dados_invalidos: 400,
  falha_do_motor: 502,
  // Cancelada pelo desligamento do servidor com o cliente ainda esperando.
  cancelada: 503,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeMelhoriaDePrompt) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado:");
}

/**
 * Melhorar prompt: reescreve o pedido que o usuário está escrevendo (no chat
 * ou num Orquestrador) com uma chamada curta ao Claude. Se o cliente desistir
 * (conexão fechada antes do fim), a chamada é abortada e nada é respondido.
 */
export function criarPromptsRoutes({ servico }: Dependencias): Router {
  const rotas = Router();

  rotas.post("/prompts/melhorar", async (requisicao, resposta) => {
    const controle = new AbortController();
    resposta.on("close", () => {
      if (!resposta.writableFinished) {
        controle.abort();
      }
    });
    try {
      const pedido = esquemaDaMelhoria.parse(requisicao.body ?? {});
      const melhorado = await servico.melhorar(pedido, controle.signal);
      if (!controle.signal.aborted) {
        resposta.json(melhorado);
      }
    } catch (erro) {
      if (!controle.signal.aborted) {
        responderErro(resposta, erro);
      }
    }
  });

  return rotas;
}
