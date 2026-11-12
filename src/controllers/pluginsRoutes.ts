import { NextFunction, Request, Response, Router } from "express";

import {
  ConsultaDoCatalogo,
  ErroDePlugin,
  MotivoDoErroDePlugin,
  OrigemDoCatalogo,
  PaginaDoCatalogo,
  PluginInstalado,
} from "../plugins/CatalogoDePlugins";
import { criarRota, responderErroGenerico } from "./respostasHttp";

interface Dependencias {
  catalogo: {
    buscarCatalogo(consulta: ConsultaDoCatalogo): Promise<PaginaDoCatalogo>;
    listarInstalados(): Promise<PluginInstalado[]>;
    instalar(id: string): Promise<{ plugin: PluginInstalado; precisaConfirmar: boolean }>;
    ligar(id: string): Promise<PluginInstalado>;
    desligar(id: string): Promise<PluginInstalado>;
    remover(id: string): Promise<void>;
  };
}

const STATUS_DO_PLUGIN: Readonly<Record<MotivoDoErroDePlugin, number>> = {
  id_invalido: 400,
  nao_encontrado: 404,
  instalacao_em_andamento: 409,
  sem_internet: 503,
  tempo_esgotado: 504,
  falha_do_cli: 502,
};

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 100;
const TAMANHO_MAXIMO_DA_BUSCA = 200;
const ORIGENS: readonly OrigemDoCatalogo[] = ["oficial", "aberto", "todos"];

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDePlugin) {
    resposta.status(STATUS_DO_PLUGIN[erro.motivo]).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado nos plugins:");
}

const rota = criarRota(responderErro);

/**
 * Rotas que mudam estado não aceitam requisição que o navegador marca como de
 * outro site (`Sec-Fetch-Site: cross-site`). Não exige Content-Type: o front
 * liga e desliga sem corpo. Sem o cabeçalho (curl, testes, mesma origem em
 * navegadores antigos) a requisição segue.
 */
function recusarOutroSite(requisicao: Request, resposta: Response, proximo: NextFunction): void {
  const mudaEstado = requisicao.method !== "GET" && requisicao.method !== "HEAD" && requisicao.method !== "OPTIONS";
  if (mudaEstado && requisicao.get("sec-fetch-site") === "cross-site") {
    resposta.status(403).json({ erro: "Requisição de outro site recusada." });
    return;
  }
  proximo();
}

/** Inteiro da consulta (texto), ou `padrao` se ausente; `null` se não for um inteiro válido. */
function lerInteiro(bruto: unknown, padrao: number): number | null {
  if (bruto === undefined || bruto === "") {
    return padrao;
  }
  return typeof bruto === "string" && /^\d{1,9}$/.test(bruto) ? Number(bruto) : null;
}

/** Valida a consulta do catálogo; devolve a mensagem de erro (400) quando algo não serve. */
function lerConsulta(consulta: Record<string, unknown>): ConsultaDoCatalogo | string {
  const busca = consulta["busca"] ?? "";
  if (typeof busca !== "string") {
    return "A busca deve ser um texto.";
  }
  const origem = consulta["origem"] ?? "oficial";
  if (typeof origem !== "string" || !ORIGENS.includes(origem as OrigemDoCatalogo)) {
    return "A origem deve ser oficial, aberto ou todos.";
  }
  const limite = lerInteiro(consulta["limite"], LIMITE_PADRAO);
  if (limite === null || limite < 1) {
    return `O limite deve ser um número inteiro de 1 a ${LIMITE_MAXIMO}.`;
  }
  const deslocamento = lerInteiro(consulta["deslocamento"], 0);
  if (deslocamento === null) {
    return "O deslocamento deve ser um número inteiro maior ou igual a zero.";
  }
  return {
    busca: busca.slice(0, TAMANHO_MAXIMO_DA_BUSCA),
    origem: origem as OrigemDoCatalogo,
    limite: Math.min(limite, LIMITE_MAXIMO),
    deslocamento,
  };
}

/**
 * Plugins do marketplace do Claude Code (que trazem skills, subagentes, servidores
 * MCP e hooks), pelo CLI `claude plugin` no escopo do usuário: o catálogo, os
 * instalados e instalar, ligar, desligar e remover. Plugin com hooks sai da
 * instalação desligado e só liga sozinho se o inventário provar que não há hooks, `bin/`
 * nem leitura duvidosa; senão responde `precisaConfirmar` e só liga pela rota de ligar.
 */
export function criarPluginsRoutes({ catalogo }: Dependencias): Router {
  const rotas = Router();
  rotas.use("/plugins", recusarOutroSite);

  rotas.get(
    "/plugins/catalogo",
    rota(async (requisicao, resposta) => {
      const consulta = lerConsulta(requisicao.query as Record<string, unknown>);
      if (typeof consulta === "string") {
        resposta.status(400).json({ erro: consulta });
        return;
      }
      resposta.json(await catalogo.buscarCatalogo(consulta));
    }),
  );

  rotas.get(
    "/plugins/instalados",
    rota(async (_requisicao, resposta) => {
      resposta.json({ plugins: await catalogo.listarInstalados() });
    }),
  );

  rotas.post(
    "/plugins/instalar",
    rota(async (requisicao, resposta) => {
      const corpo: unknown = requisicao.body;
      const id = typeof corpo === "object" && corpo !== null ? (corpo as { id?: unknown }).id : undefined;
      if (typeof id !== "string") {
        throw new ErroDePlugin("id_invalido", "Identificador de plugin inválido. Use o formato nome@marketplace.");
      }
      resposta.json(await catalogo.instalar(id));
    }),
  );

  rotas.post(
    "/plugins/:id/ligar",
    rota(async (requisicao, resposta) => {
      resposta.json({ plugin: await catalogo.ligar(requisicao.params.id) });
    }),
  );

  rotas.post(
    "/plugins/:id/desligar",
    rota(async (requisicao, resposta) => {
      resposta.json({ plugin: await catalogo.desligar(requisicao.params.id) });
    }),
  );

  rotas.delete(
    "/plugins/:id",
    rota(async (requisicao, resposta) => {
      await catalogo.remover(requisicao.params.id);
      resposta.status(204).end();
    }),
  );

  return rotas;
}
