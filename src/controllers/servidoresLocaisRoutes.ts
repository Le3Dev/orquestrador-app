import { Response, Router } from "express";

import { SondaDeEndereco } from "../infraestrutura/claudecode/SondaDeEnderecoLocal";
import { normalizarEnderecoLocal } from "../orquestracao/EnderecoLocal";
import { criarRota, responderErroGenerico } from "./respostasHttp";

interface Dependencias {
  sondar: SondaDeEndereco;
}

const MAXIMO_DE_ENDERECOS = 10;

function responderErro(resposta: Response, erro: unknown): void {
  responderErroGenerico(resposta, erro, "[http] Erro inesperado:");
}

const rota = criarRota(responderErro);

/** Os `url` da consulta como lista de textos; nulo se algum não for texto (ex.: `url[a]=b`). */
function lerEnderecos(consulta: unknown): string[] | null {
  const bruto = (consulta as { url?: unknown }).url;
  if (bruto === undefined) {
    return [];
  }
  const lista = Array.isArray(bruto) ? (bruto as unknown[]) : [bruto];
  return lista.every((item): item is string => typeof item === "string") ? lista : null;
}

/**
 * Faixa de servidores da tela: confere se cada endereço local que os agentes
 * citaram ainda responde. Só aceita endereços locais com porta (a rota não pode
 * virar porta de acesso a outros hosts) e só sonda a porta, em paralelo.
 */
export function criarServidoresLocaisRoutes({ sondar }: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/servidores-locais/situacao",
    rota(async (requisicao, resposta) => {
      const informados = lerEnderecos(requisicao.query);
      if (informados === null || informados.length === 0) {
        resposta.status(400).json({ erro: "Informe ao menos um endereço local em url." });
        return;
      }
      const normalizados = new Set<string>();
      for (const informado of informados) {
        const normalizado = normalizarEnderecoLocal(informado);
        if (normalizado === null) {
          resposta.status(400).json({
            erro: "Só endereços locais com porta são aceitos (ex.: http://localhost:5173).",
          });
          return;
        }
        normalizados.add(normalizado);
      }
      if (normalizados.size > MAXIMO_DE_ENDERECOS) {
        resposta.status(400).json({ erro: `Informe até ${MAXIMO_DE_ENDERECOS} endereços por consulta.` });
        return;
      }
      const situacoes = await Promise.all(
        [...normalizados].map(async (url) => ({ url, noAr: await sondar(url).catch(() => false) })),
      );
      resposta.json({ situacoes });
    }),
  );

  return rotas;
}
