import { Response, Router } from "express";
import { z } from "zod";

import { ErroDeNota, MotivoDoErroDeNota } from "../notas/ErroDeNota";
import { ServicoDeNotas } from "../notas/ServicoDeNotas";
import { criarRota, responderErroGenerico } from "./respostasHttp";

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
  responderErroGenerico(resposta, erro, "[http] Erro inesperado:");
}

const rota = criarRota(responderErro);

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
