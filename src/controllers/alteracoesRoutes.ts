import { Request, Response, Router } from "express";
import { z, ZodError } from "zod";

import { ErroDeLeituraDasAlteracoes } from "../orquestracao/AlteracoesDoWorktree";
import { ErroDeOrquestracao, MotivoDoErro } from "../orquestracao/ErroDeOrquestracao";
import { ServicoDeAlteracoes } from "../orquestracao/ServicoDeAlteracoes";

interface Dependencias {
  servico: ServicoDeAlteracoes;
}

/** `arquivo` repetido na URL chega como lista e também é recusado. */
const esquemaDoDiff = z.object({
  arquivo: z.string({ error: "Informe o arquivo." }).min(1, { error: "Informe o arquivo." }),
});

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErro, number>> = {
  dados_invalidos: 400,
  nao_encontrado: 404,
  turno_em_andamento: 409,
  sem_turno_em_andamento: 409,
  sem_plano_pendente: 409,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeOrquestracao) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ZodError) {
    resposta.status(400).json({ erro: erro.issues[0]?.message ?? "Dados inválidos." });
    return;
  }
  if (erro instanceof ErroDeLeituraDasAlteracoes) {
    // O motivo (saída do git, timeout...) fica no log; a tela recebe a mensagem pronta.
    console.error("[alteracoes] Falha ao ler o worktree:", erro.cause);
    resposta.status(500).json({ erro: erro.message });
    return;
  }
  console.error("[http] Erro inesperado:", erro);
  const detalhe = erro instanceof Error ? erro.message : String(erro);
  resposta.status(500).json({ erro: `Erro inesperado no servidor: ${detalhe}` });
}

type Tratador = (requisicao: Request<{ id: string }>, resposta: Response) => Promise<void>;

/** Envolve cada rota num try/catch que devolve a mensagem de erro pronta para a tela. */
function rota(tratador: Tratador): Tratador {
  return async (requisicao, resposta) => {
    try {
      await tratador(requisicao, resposta);
    } catch (erro) {
      responderErro(resposta, erro);
    }
  };
}

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
