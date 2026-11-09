import { Response, Router } from "express";
import { z } from "zod";

import { ErroDeArquivo, MotivoDoErroDeArquivo } from "../orquestracao/ArquivosDaPasta";
import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import { ServicoDeArquivos } from "../orquestracao/ServicoDeArquivos";
import { criarRota, responderErroGenerico } from "./respostasHttp";

interface Dependencias {
  servico: ServicoDeArquivos;
}

/** `caminho` repetido na URL chega como lista e é recusado. Ausente, lista a raiz. */
const esquemaDaListagem = z.object({
  caminho: z.string({ error: "O caminho deve ser um texto." }).optional(),
});

const esquemaDaLeitura = z.object({
  caminho: z.string({ error: "Informe o arquivo." }).min(1, { error: "Informe o arquivo." }),
});

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErroDeArquivo, number>> = {
  caminho_invalido: 400,
  tipo_errado: 400,
  bloqueado: 403,
  nao_encontrado: 404,
  grande_demais: 413,
  binario: 415,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeArquivo) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ErroDeOrquestracao) {
    resposta.status(erro.motivo === "nao_encontrado" ? 404 : 400).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[arquivos] Erro inesperado:");
}

const rota = criarRota(responderErro);

/**
 * Visualizador de código: navega pela pasta do Orquestrador (o worktree, se
 * houver) e lê arquivos de texto. Só leitura; as regras de segurança ficam no
 * `ServicoDeArquivos`.
 */
export function criarArquivosRoutes({ servico }: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/orquestradores/:id/arquivos",
    rota(async (requisicao, resposta) => {
      const { caminho } = esquemaDaListagem.parse(requisicao.query);
      const listagem = await servico.listar(requisicao.params.id, caminho ?? "");
      resposta.json({ caminho: listagem.caminho, entradas: listagem.entradas, truncada: listagem.truncada });
    }),
  );

  rotas.get(
    "/orquestradores/:id/arquivos/conteudo",
    rota(async (requisicao, resposta) => {
      const { caminho } = esquemaDaLeitura.parse(requisicao.query);
      const arquivo = await servico.ler(requisicao.params.id, caminho);
      resposta.set("Cache-Control", "no-store").json({
        caminho: arquivo.caminho,
        conteudo: arquivo.conteudo,
        tamanho: arquivo.tamanho,
        linhas: arquivo.linhas,
      });
    }),
  );

  return rotas;
}
