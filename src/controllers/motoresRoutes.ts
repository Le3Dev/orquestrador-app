import { Response, Router } from "express";

import { CatalogoDeMotores } from "../infraestrutura/motores/CatalogoDeMotores";
import { criarRota, responderErroGenerico } from "./respostasHttp";

interface Dependencias {
  catalogo: Pick<CatalogoDeMotores, "listar">;
}

function responderErro(resposta: Response, erro: unknown): void {
  responderErroGenerico(resposta, erro, "[http] Erro inesperado nos motores:");
}

const rota = criarRota(responderErro);

/**
 * Os motores (Claude Code, Codex, GitHub Copilot CLI) e o estado de cada um
 * nesta máquina, para a tela de configuração.
 *
 * `GET /motores` devolve uma lista com um item por motor:
 * `{ motor, rotulo, instalado, versao, caminho, logado, mensagem }`, em que
 * `logado` é `null` quando não dá para saber sem gastar cota e `mensagem` diz ao
 * usuário o que fazer (instalar, entrar) ou é `null` com tudo certo.
 * `?atualizar=1` ignora a resposta guardada (o usuário acabou de instalar ou entrar).
 */
export function criarMotoresRoutes({ catalogo }: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/motores",
    rota(async (requisicao, resposta) => {
      const atualizar = requisicao.query["atualizar"];
      const situacoes = await catalogo.listar(atualizar === "1" || atualizar === "true");
      resposta.json(situacoes);
    }),
  );

  return rotas;
}
