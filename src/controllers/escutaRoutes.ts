import { Response, Router } from "express";
import { z, ZodError } from "zod";

import { ErroDeEscuta, MotivoDoErroDeEscuta } from "../escuta/ErroDeEscuta";
import { ServicoDeEscuta } from "../escuta/ServicoDeEscuta";

interface Dependencias {
  servico: ServicoDeEscuta;
}

/**
 * Aqui só se confere o formato do corpo; as regras (trecho vazio, tamanhos)
 * são do serviço, que devolve a mensagem certa.
 */
const esquemaDaClassificacao = z.object(
  {
    trecho: z.string({ error: "Envie o trecho da escuta." }),
    contexto: z.string({ error: "O contexto deve ser um texto." }).optional(),
  },
  { error: "Envie o trecho da escuta para classificar." },
);

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErroDeEscuta, number>> = {
  dados_invalidos: 400,
  falha_do_motor: 502,
  // Cancelada pelo desligamento do servidor com o cliente ainda esperando.
  cancelada: 503,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeEscuta) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ZodError) {
    resposta.status(400).json({ erro: erro.issues[0]?.message ?? "Dados inválidos." });
    return;
  }
  console.error("[http] Erro inesperado:", erro);
  const detalhe = erro instanceof Error ? erro.message : String(erro);
  resposta.status(500).json({ erro: `Erro inesperado no servidor: ${detalhe}` });
}

/**
 * Escuta no modo invisível: a tela manda o trecho do áudio transcrito que a
 * regra local marcou, e a rota confirma com uma chamada curta ao Claude se é
 * uma pergunta a responder. Se o cliente desistir (conexão fechada antes do
 * fim), a chamada é abortada e nada é respondido.
 */
export function criarEscutaRoutes({ servico }: Dependencias): Router {
  const rotas = Router();

  rotas.post("/escuta/classificar", async (requisicao, resposta) => {
    const controle = new AbortController();
    resposta.on("close", () => {
      if (!resposta.writableFinished) {
        controle.abort();
      }
    });
    try {
      const pedido = esquemaDaClassificacao.parse(requisicao.body ?? {});
      const classificacao = await servico.classificar(pedido, controle.signal);
      if (!controle.signal.aborted) {
        resposta.json({ ehPergunta: classificacao.ehPergunta, pergunta: classificacao.pergunta });
      }
    } catch (erro) {
      if (!controle.signal.aborted) {
        responderErro(resposta, erro);
      }
    }
  });

  return rotas;
}
