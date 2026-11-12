import { Response, Router } from "express";

import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import { RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { SkillCadastrada } from "../skills/LeitorDeSkills";
import { criarRota, responderErroGenerico, STATUS_DA_ORQUESTRACAO } from "./respostasHttp";

interface Dependencias {
  leitor: { listar(pastaDoProjeto: string | null): Promise<SkillCadastrada[]> };
  repositorio: Pick<RepositorioDeOrquestradores, "buscarPorId">;
}

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeOrquestracao) {
    resposta.status(STATUS_DA_ORQUESTRACAO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado nas skills:");
}

const rota = criarRota(responderErro);

/**
 * Skills do Claude Code que os agentes enxergam: as do usuário e dos plugins e,
 * com `?orquestrador=<id>`, também as da pasta do projeto dele. Só leitura. Os
 * agentes só as usam nos níveis que liberam edição (`liberadasNoNivel`); sem o
 * orquestrador, o nível é desconhecido (`null`).
 */
export function criarSkillsRoutes({ leitor, repositorio }: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/skills",
    rota(async (requisicao, resposta) => {
      const informado: unknown = requisicao.query["orquestrador"];
      if (informado !== undefined && typeof informado !== "string") {
        resposta.status(400).json({ erro: "O orquestrador deve ser um texto." });
        return;
      }
      const orquestrador = informado === undefined ? null : repositorio.buscarPorId(informado);
      if (informado !== undefined && orquestrador === null) {
        throw new ErroDeOrquestracao("nao_encontrado", "Orquestrador não encontrado.");
      }
      const skills = await leitor.listar(orquestrador === null ? null : orquestrador.pastaDeTrabalho.caminho);
      resposta.json({
        skills: skills.map(({ nome, descricao, origem, plugin }) => ({ nome, descricao, origem, plugin })),
        liberadasNoNivel: orquestrador === null ? null : orquestrador.configuracao.nivelDePermissao !== "leitura",
      });
    }),
  );

  return rotas;
}
