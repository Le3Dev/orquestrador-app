import { Request, Response, Router } from "express";
import { z, ZodError } from "zod";

import { ErroDeNota, MotivoDoErroDeNota } from "../notas/ErroDeNota";
import { ServicoDeNotas } from "../notas/ServicoDeNotas";

interface Dependencias {
  servico: ServicoDeNotas;
}

/**
 * Aqui só se confere o formato do corpo; as regras (tamanho do título e do
 * texto) são da própria Nota, que devolve a mensagem certa.
 */
const esquemaDaNota = z.object(
  {
    titulo: z.string({ error: "O título da nota deve ser um texto." }).optional(),
    texto: z.string({ error: "O conteúdo da nota deve ser um texto." }).optional(),
  },
  { error: "Envie os dados da nota." },
);

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErroDeNota, number>> = {
  dados_invalidos: 400,
  nao_encontrada: 404,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeNota) {
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

type Tratador<Parametros> = (requisicao: Request<Parametros>, resposta: Response) => Promise<void> | void;

/** Envolve cada rota num try/catch que devolve a mensagem de erro pronta para a tela. */
function rota<Parametros = { id: string }>(tratador: Tratador<Parametros>): Tratador<Parametros> {
  return async (requisicao, resposta) => {
    try {
      await tratador(requisicao, resposta);
    } catch (erro) {
      responderErro(resposta, erro);
    }
  };
}

/**
 * Notas do usuário no canvas. Só o conteúdo passa por aqui: posição, tamanho
 * e "minimizada" ficam no layout do navegador.
 */
export function criarNotasRoutes({ servico }: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/notas",
    rota((_requisicao, resposta) => {
      resposta.json(servico.listar().map((nota) => nota.paraDados()));
    }),
  );

  rotas.post(
    "/notas",
    rota(async (requisicao, resposta) => {
      const pedido = esquemaDaNota.parse(requisicao.body ?? {});
      const nota = await servico.criar(pedido);
      resposta.status(201).json(nota.paraDados());
    }),
  );

  rotas.patch(
    "/notas/:id",
    rota(async (requisicao, resposta) => {
      const alteracoes = esquemaDaNota.parse(requisicao.body ?? {});
      const nota = await servico.editar(requisicao.params.id, alteracoes);
      resposta.json(nota.paraDados());
    }),
  );

  rotas.delete(
    "/notas/:id",
    rota(async (requisicao, resposta) => {
      await servico.remover(requisicao.params.id);
      resposta.status(204).end();
    }),
  );

  return rotas;
}
