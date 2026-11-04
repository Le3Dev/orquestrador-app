import { createHash, timingSafeEqual } from "node:crypto";

import { NextFunction, Request, RequestHandler, Response } from "express";

export const NOME_DO_COOKIE_DE_ACESSO = "orquestrador_acesso";

export const MENSAGEM_DE_ACESSO_NEGADO = "Acesso permitido só pelo aplicativo.";

interface OpcoesDoAcesso {
  chave: string;
  urlDeDownload: string | null;
}

/**
 * Lê um cookie do cabeçalho `Cookie` (`a=1; b=2`). O valor pode conter `=`;
 * aspas em volta são retiradas. Devolve o primeiro com o nome pedido.
 */
export function lerCookie(cabecalho: string | undefined, nome: string): string | null {
  if (cabecalho === undefined || cabecalho === "") {
    return null;
  }
  for (const parte of cabecalho.split(";")) {
    const separador = parte.indexOf("=");
    if (separador < 0) {
      continue;
    }
    if (parte.slice(0, separador).trim() !== nome) {
      continue;
    }
    let valor = parte.slice(separador + 1).trim();
    if (valor.length >= 2 && valor.startsWith('"') && valor.endsWith('"')) {
      valor = valor.slice(1, -1);
    }
    try {
      return decodeURIComponent(valor);
    } catch {
      return valor;
    }
  }
  return null;
}

/**
 * Compara em tempo constante. Os resumos SHA-256 têm sempre o mesmo tamanho,
 * então chaves de tamanhos diferentes não lançam nem revelam o tamanho.
 */
function chavesIguais(recebida: string, esperada: string): boolean {
  const a = createHash("sha256").update(recebida, "utf8").digest();
  const b = createHash("sha256").update(esperada, "utf8").digest();
  return timingSafeEqual(a, b) && recebida.length === esperada.length;
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function paginaDeAcessoNegado(urlDeDownload: string | null): string {
  const link =
    urlDeDownload === null
      ? ""
      : `\n    <p><a href="${escaparHtml(urlDeDownload)}">Baixe o aplicativo</a></p>`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orquestrador de Agentes</title>
  <style>
    :root {
      --fundo: #1E1E1E;
      --superficie: #2A2A2A;
      --borda: #3A3A3A;
      --texto: #EEEEEE;
      --texto-secundario: #979797;
      --marca: #E2241C;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--fundo);
      color: var(--texto);
      font: 13px Arial, Helvetica, sans-serif;
    }
    main {
      background: var(--superficie);
      border: 1px solid var(--borda);
      border-top: 3px solid var(--marca);
      border-radius: 6px;
      padding: 24px 32px;
      text-align: center;
    }
    h1 { font-size: 18px; margin: 0 0 12px; }
    p { margin: 8px 0; color: var(--texto-secundario); }
    a { color: var(--marca); font-weight: bold; }
  </style>
</head>
<body>
  <main>
    <h1>Orquestrador de Agentes</h1>
    <p>O Orquestrador de Agentes roda só no aplicativo.</p>${link}
  </main>
</body>
</html>
`;
}

/** Quem pede HTML (navegação, ou HTML antes de JSON) recebe a página; o resto, JSON. */
function querHtml(requisicao: Request): boolean {
  if (requisicao.path === "/api" || requisicao.path.startsWith("/api/")) {
    return false;
  }
  if (requisicao.get("sec-fetch-mode") === "navigate") {
    return true;
  }
  return requisicao.accepts(["html", "json"]) === "html";
}

/**
 * Trava: o servidor só atende o aplicativo desktop, que manda a chave da
 * abertura no cookie `orquestrador_acesso`. Deve ser o primeiro middleware.
 */
export function acessoSoPeloApp(opcoes: OpcoesDoAcesso): RequestHandler {
  const { chave, urlDeDownload } = opcoes;
  return (requisicao: Request, resposta: Response, proximo: NextFunction): void => {
    const recebida = lerCookie(requisicao.headers.cookie, NOME_DO_COOKIE_DE_ACESSO);
    if (recebida !== null && chavesIguais(recebida, chave)) {
      proximo();
      return;
    }
    resposta.status(403).set("Cache-Control", "no-store").vary("Accept");
    if (querHtml(requisicao)) {
      resposta
        .set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
        .type("html")
        .send(paginaDeAcessoNegado(urlDeDownload));
      return;
    }
    resposta.json({ erro: MENSAGEM_DE_ACESSO_NEGADO });
  };
}
