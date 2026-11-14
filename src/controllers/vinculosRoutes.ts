import { Response, Router } from "express";
import { z } from "zod";

import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import { ErroDeFilaCheia } from "../orquestracao/Orquestrador";
import { ErroDeVinculo, MotivoDoErroDeVinculo } from "../vinculos/ErroDeVinculo";
import { ServicoDeVinculos } from "../vinculos/ServicoDeVinculos";
import { DadosDoVinculo, Vinculo } from "../vinculos/Vinculo";
import { criarRota, responderErroGenerico, STATUS_DA_ORQUESTRACAO } from "./respostasHttp";

interface Dependencias {
  servico: ServicoDeVinculos;
}

/** O formato do vínculo na API: os mesmos campos dos dados do domínio. */
export type VinculoDto = DadosDoVinculo;

const esquemaDoPar = z.object(
  {
    orquestradorAId: z.string({ error: "Informe o primeiro orquestrador." }).min(1, { error: "Informe o primeiro orquestrador." }),
    orquestradorBId: z.string({ error: "Informe o segundo orquestrador." }).min(1, { error: "Informe o segundo orquestrador." }),
  },
  { error: "Informe os dois orquestradores a vincular." },
);

const esquemaDasNotas = z.object(
  { texto: z.string({ error: "O texto das notas deve ser um texto." }) },
  { error: "Envie o texto das notas." },
);

const esquemaDaMensagem = z.object(
  {
    de: z.string({ error: "Informe quem envia a mensagem." }).min(1, { error: "Informe quem envia a mensagem." }),
    texto: z.string({ error: "A mensagem deve ser um texto." }),
  },
  { error: "Envie a mensagem." },
);

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErroDeVinculo, number>> = {
  dados_invalidos: 400,
  nao_encontrado: 404,
  ja_vinculados: 409,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeVinculo) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  // Da entrega da mensagem à fila do destino.
  if (erro instanceof ErroDeOrquestracao) {
    resposta.status(STATUS_DA_ORQUESTRACAO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ErroDeFilaCheia) {
    resposta.status(409).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado:");
}

const rota = criarRota(responderErro);

function paraDto(vinculo: Vinculo): VinculoDto {
  return vinculo.paraDados();
}

/** Vínculos entre Orquestradores: criar, desfazer, notas compartilhadas e mensagem manual do usuário. */
export function criarVinculosRoutes({ servico }: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/vinculos",
    rota((_requisicao, resposta) => {
      resposta.json({ vinculos: servico.listar().map(paraDto) });
    }),
  );

  rotas.post(
    "/vinculos",
    rota(async (requisicao, resposta) => {
      const { orquestradorAId, orquestradorBId } = esquemaDoPar.parse(requisicao.body ?? {});
      const vinculo = await servico.vincular(orquestradorAId, orquestradorBId);
      resposta.status(201).json({ vinculo: paraDto(vinculo) });
    }),
  );

  rotas.delete(
    "/vinculos/:id",
    rota(async (requisicao, resposta) => {
      await servico.desvincular(requisicao.params.id);
      resposta.status(204).end();
    }),
  );

  rotas.put(
    "/vinculos/:id/notas",
    rota(async (requisicao, resposta) => {
      const { texto } = esquemaDasNotas.parse(requisicao.body ?? {});
      const vinculo = await servico.editarNotas(requisicao.params.id, texto);
      resposta.json({ vinculo: paraDto(vinculo) });
    }),
  );

  rotas.post(
    "/vinculos/:id/mensagens",
    rota(async (requisicao, resposta) => {
      const { de, texto } = esquemaDaMensagem.parse(requisicao.body ?? {});
      await servico.enviarMensagem(requisicao.params.id, de, texto);
      resposta.status(202).json({ enfileirada: true });
    }),
  );

  return rotas;
}
