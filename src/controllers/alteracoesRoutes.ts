import { Response, Router } from "express";
import { z } from "zod";

import { ErroDeLeituraDasAlteracoes } from "../orquestracao/AlteracoesDoWorktree";
import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import { ServicoDeAlteracoes } from "../orquestracao/ServicoDeAlteracoes";
import { criarRota, responderErroGenerico, STATUS_DA_ORQUESTRACAO } from "./respostasHttp";

interface Dependencias {
  servico: ServicoDeAlteracoes;
}

/** `arquivo` repetido na URL chega como lista e também é recusado. */
const esquemaDoDiff = z.object({
  arquivo: z.string({ error: "Informe o arquivo." }).min(1, { error: "Informe o arquivo." }),
});

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeOrquestracao) {
    resposta.status(STATUS_DA_ORQUESTRACAO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ErroDeLeituraDasAlteracoes) {
    // O motivo (saída do git, timeout...) fica no log; a tela recebe a mensagem pronta.
    console.error("[alteracoes] Falha ao ler o worktree:", erro.cause);
    resposta.status(500).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado:");
}

const rota = criarRota(responderErro);

/**
 * Painel de alterações do worktree: o que o Orquestrador deixou por commitar
 * e o diff de cada arquivo. Só leitura.
 */
export function criarAlteracoesRoutes({ servico }: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/orquestradores/:id/alteracoes",
    rota(async (requisicao, resposta) => {
      const alteracoes = await servico.consultar(requisicao.params.id);
      resposta.json(alteracoes.paraDados());
    }),
  );

  rotas.get(
    "/orquestradores/:id/alteracoes/diff",
    rota(async (requisicao, resposta) => {
      const { arquivo } = esquemaDoDiff.parse(requisicao.query);
      const diff = await servico.lerDiff(requisicao.params.id, arquivo);
      resposta.json({ caminho: diff.caminho, diff: diff.diff, truncado: diff.truncado, binario: diff.binario });
    }),
  );

  return rotas;
}
