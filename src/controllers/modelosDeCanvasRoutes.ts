import { Response, Router } from "express";

import { ErroDeModeloDeCanvas, MotivoDoErroDeModeloDeCanvas } from "../modelos/ErroDeModeloDeCanvas";
import {
  esquemaDaAlteracaoDoModelo,
  esquemaDoArquivoExportado,
  esquemaDoConteudoDoModelo,
} from "../modelos/ModeloDeCanvas";
import { ServicoDeModelosDeCanvas } from "../modelos/ServicoDeModelosDeCanvas";
import { criarRota, responderErroGenerico } from "./respostasHttp";

interface Dependencias {
  servico: ServicoDeModelosDeCanvas;
}

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErroDeModeloDeCanvas, number>> = {
  dados_invalidos: 400,
  nao_encontrado: 404,
  limite_atingido: 409,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeModeloDeCanvas) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado nos modelos de canvas:");
}

const rota = criarRota(responderErro);

/** O nome do arquivo baixado: o nome do modelo só com letras, números e hífens. */
function nomeDoArquivo(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `modelo-${base === "" ? "de-canvas" : base}.json`;
}

/**
 * Modelos de canvas: arranjos salvos para recriar e compartilhar. Recriar não
 * passa por aqui (a tela cria cada item pela API dele); importar é conferir o
 * arquivo aqui e, depois de o usuário confirmar o resumo, um POST comum.
 */
export function criarModelosDeCanvasRoutes({ servico }: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/modelos-de-canvas",
    rota((_requisicao, resposta) => {
      resposta.json(servico.listar());
    }),
  );

  rotas.post(
    "/modelos-de-canvas",
    rota(async (requisicao, resposta) => {
      const conteudo = esquemaDoConteudoDoModelo.parse(requisicao.body);
      resposta.status(201).json(await servico.criar(conteudo));
    }),
  );

  /** Valida um arquivo exportado e devolve o modelo como seria salvo. Não grava nada. */
  rotas.post(
    "/modelos-de-canvas/importacao/conferir",
    rota((requisicao, resposta) => {
      resposta.json(esquemaDoArquivoExportado.parse(requisicao.body).modelo);
    }),
  );

  rotas.get(
    "/modelos-de-canvas/:id/exportar",
    rota((requisicao, resposta) => {
      // Sem o parâmetro, o mais seguro: sem caminhos, comandos nem segredos.
      const semCaminhos = requisicao.query.semCaminhos !== "0";
      const arquivo = servico.exportar(requisicao.params.id, { semCaminhos });
      resposta.setHeader("Content-Disposition", `attachment; filename="${nomeDoArquivo(arquivo.modelo.nome)}"`);
      resposta.json(arquivo);
    }),
  );

  rotas.patch(
    "/modelos-de-canvas/:id",
    rota(async (requisicao, resposta) => {
      const alteracao = esquemaDaAlteracaoDoModelo.parse(requisicao.body ?? {});
      resposta.json(await servico.alterar(requisicao.params.id, alteracao));
    }),
  );

  rotas.delete(
    "/modelos-de-canvas/:id",
    rota(async (requisicao, resposta) => {
      await servico.remover(requisicao.params.id);
      resposta.status(204).end();
    }),
  );

  return rotas;
}
