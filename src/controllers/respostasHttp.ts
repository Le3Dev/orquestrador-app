import { Request, Response } from "express";
import { ZodError } from "zod";

import { MotivoDoErro } from "../orquestracao/ErroDeOrquestracao";

/** Status HTTP de cada motivo de erro da orquestração. */
export const STATUS_DA_ORQUESTRACAO: Readonly<Record<MotivoDoErro, number>> = {
  dados_invalidos: 400,
  nao_encontrado: 404,
  turno_em_andamento: 409,
  sem_turno_em_andamento: 409,
  sem_plano_pendente: 409,
};

/**
 * O fim comum do `responderErro` de cada arquivo de rotas, depois dos erros
 * do próprio contexto: dados inválidos viram 400 com a primeira mensagem; o
 * resto vira 500, com o erro no log (`prefixoDoLog` é o texto antes dele).
 */
export function responderErroGenerico(resposta: Response, erro: unknown, prefixoDoLog: string): void {
  if (erro instanceof ZodError) {
    resposta.status(400).json({ erro: erro.issues[0]?.message ?? "Dados inválidos." });
    return;
  }
  console.error(prefixoDoLog, erro);
  const detalhe = erro instanceof Error ? erro.message : String(erro);
  resposta.status(500).json({ erro: `Erro inesperado no servidor: ${detalhe}` });
}

type Tratador<Parametros> = (requisicao: Request<Parametros>, resposta: Response) => Promise<void> | void;

/**
 * A `rota` de um arquivo de rotas, ligada ao `responderErro` dele: envolve
 * cada rota num try/catch que devolve a mensagem de erro pronta para a tela.
 * `ParametrosPadrao` é o tipo dos params quando a rota não diz outro.
 */
export function criarRota<ParametrosPadrao = { id: string }>(
  responderErro: (resposta: Response, erro: unknown) => void,
) {
  return function rota<Parametros = ParametrosPadrao>(tratador: Tratador<Parametros>): Tratador<Parametros> {
    return async (requisicao, resposta) => {
      try {
        await tratador(requisicao, resposta);
      } catch (erro) {
        responderErro(resposta, erro);
      }
    };
  };
}
