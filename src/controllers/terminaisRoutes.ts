import { IncomingMessage, STATUS_CODES } from "node:http";
import { Duplex } from "node:stream";
import path from "node:path";

import { Response, Router } from "express";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import { PastaDeTrabalho } from "../orquestracao/PastaDeTrabalho";
import { RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { ErroDeTerminal, MotivoDoErroDeTerminal } from "../terminais/ErroDeTerminal";
import { ServicoDeTerminais } from "../terminais/ServicoDeTerminais";
import { MENSAGEM_DE_ACESSO_NEGADO, temChaveDoApp } from "./acessoSoPeloApp";
import { criarRota, responderErroGenerico, STATUS_DA_ORQUESTRACAO } from "./respostasHttp";

interface Dependencias {
  servico: ServicoDeTerminais;
  repositorio: Pick<RepositorioDeOrquestradores, "buscarPorId">;
  /** Se o caminho é uma pasta existente (o `existe` do ExploradorDePastas). */
  pastaExiste: (caminho: string) => Promise<boolean>;
  pastaRaiz: string;
}

const MAXIMO_DE_COLUNAS = 1000;
const MAXIMO_DE_LINHAS = 500;

const esquemaDasColunas = z
  .number({ error: "Informe o número de colunas do terminal." })
  .int({ error: "As colunas do terminal devem ser um número inteiro." })
  .min(1, { error: "O terminal precisa de pelo menos 1 coluna." })
  .max(MAXIMO_DE_COLUNAS, { error: `Use no máximo ${MAXIMO_DE_COLUNAS} colunas.` });

const esquemaDasLinhas = z
  .number({ error: "Informe o número de linhas do terminal." })
  .int({ error: "As linhas do terminal devem ser um número inteiro." })
  .min(1, { error: "O terminal precisa de pelo menos 1 linha." })
  .max(MAXIMO_DE_LINHAS, { error: `Use no máximo ${MAXIMO_DE_LINHAS} linhas.` });

const esquemaDeAbertura = z.object(
  {
    pasta: z.string({ error: "A pasta deve ser um texto." }).nullish(),
    orquestradorId: z.string({ error: "O orquestrador deve ser um texto." }).nullish(),
    colunas: esquemaDasColunas,
    linhas: esquemaDasLinhas,
  },
  { error: "Dados do terminal inválidos." },
);

/** Mensagens da tela pelo WebSocket. As inválidas são ignoradas. */
const esquemaDaMensagem = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("entrada"), dados: z.string() }),
  z.object({ tipo: z.literal("tamanho"), colunas: esquemaDasColunas, linhas: esquemaDasLinhas }),
]);

const STATUS_DO_TERMINAL: Readonly<Record<MotivoDoErroDeTerminal, number>> = {
  dados_invalidos: 400,
  nao_encontrado: 404,
  limite_atingido: 409,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeTerminal) {
    resposta.status(STATUS_DO_TERMINAL[erro.motivo]).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ErroDeOrquestracao) {
    resposta.status(STATUS_DA_ORQUESTRACAO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado nos terminais:");
}

const rota = criarRota(responderErro);

/**
 * Terminais interativos do canvas. As rotas REST abrem, listam e fecham; a
 * entrada e a saída correm pelo WebSocket (`criarConexaoDosTerminais`).
 */
export function criarTerminaisRoutes({ servico, repositorio, pastaExiste, pastaRaiz }: Dependencias): Router {
  const rotas = Router();

  /** A pasta do terminal de um Orquestrador: o worktree atual, se existir, senão a pasta de trabalho. */
  async function pastaDoOrquestrador(orquestradorId: string): Promise<string> {
    const orquestrador = repositorio.buscarPorId(orquestradorId);
    if (orquestrador === null) {
      throw new ErroDeOrquestracao("nao_encontrado", "Orquestrador não encontrado.");
    }
    const worktree = orquestrador.worktree;
    if (worktree !== null && (await pastaExiste(worktree.caminho))) {
      return worktree.caminho;
    }
    return orquestrador.pastaDeTrabalho.caminho;
  }

  /** A mesma regra da criação de Orquestrador: absoluto vale em qualquer lugar; relativo, só sob a raiz. */
  async function pastaInformada(pasta: string): Promise<string> {
    const validada = path.isAbsolute(pasta.trim())
      ? PastaDeTrabalho.qualquer(pasta)
      : PastaDeTrabalho.dentroDe(pastaRaiz, pasta);
    if (!(await pastaExiste(validada.caminho))) {
      throw new ErroDeOrquestracao("dados_invalidos", `A pasta "${validada.caminho}" não existe.`);
    }
    return validada.caminho;
  }

  rotas.get(
    "/terminais",
    rota((_requisicao, resposta) => {
      resposta.json(servico.listar());
    }),
  );

  rotas.post(
    "/terminais",
    rota(async (requisicao, resposta) => {
      const { pasta, orquestradorId, colunas, linhas } = esquemaDeAbertura.parse(requisicao.body ?? {});
      const temOrquestrador = orquestradorId !== undefined && orquestradorId !== null && orquestradorId !== "";
      const temPasta = pasta !== undefined && pasta !== null && pasta.trim() !== "";
      if (!temOrquestrador && !temPasta) {
        throw new ErroDeTerminal("dados_invalidos", "Informe a pasta ou o orquestrador do terminal.");
      }
      const caminho = temOrquestrador ? await pastaDoOrquestrador(orquestradorId) : await pastaInformada(pasta ?? "");
      const terminal = servico.abrir({
        pasta: caminho,
        orquestradorId: temOrquestrador ? orquestradorId : null,
        colunas,
        linhas,
      });
      resposta.status(201).json(terminal);
    }),
  );

  rotas.delete(
    "/terminais/:id",
    rota((requisicao, resposta) => {
      servico.encerrar(requisicao.params.id);
      resposta.status(204).end();
    }),
  );

  return rotas;
}

// ─── WebSocket ─────────────────────────────────────────────────────────────

const CAMINHO_DA_CONEXAO = /^\/api\/terminais\/([^/]+)\/conexao\/?$/;

/** Entrada colada de uma vez pode ser grande, mas não mais que isto. */
const TAMANHO_MAXIMO_DA_MENSAGEM = 1024 * 1024;

const NOMES_LOCAIS = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface OpcoesDaConexao {
  servico: ServicoDeTerminais;
  /** A mesma verificação do `acessoSoPeloApp` (ou sempre true com o navegador liberado). */
  temAcesso: (requisicao: IncomingMessage) => boolean;
  /** Confere o cabeçalho Origin (proteção contra outra página abrir o WebSocket). */
  origemPermitida: (origem: string | undefined) => boolean;
}

export interface ConexaoDosTerminais {
  /** Ligar em `servidor.on("upgrade", ...)`. */
  aoPedirUpgrade(requisicao: IncomingMessage, socket: Duplex, cabeca: Buffer): void;
  /** Fecha as conexões abertas (desligamento). */
  encerrar(): void;
}

/** Verificação do upgrade igual à do middleware: com a trava, só quem traz a chave no cookie. */
export function acessoDoUpgrade(chaveDeAcesso: string | null): (requisicao: IncomingMessage) => boolean {
  if (chaveDeAcesso === null) {
    return () => true;
  }
  return (requisicao) => temChaveDoApp(requisicao.headers.cookie, chaveDeAcesso);
}

/**
 * Origens aceitas no WebSocket: a própria tela servida pelo servidor
 * (127.0.0.1 ou localhost na porta dele) e as `extras` (a tela do Vite no
 * `desktop:dev`). Com `qualquerPortaLocal` (navegador liberado, só em
 * desenvolvimento), vale qualquer porta de 127.0.0.1/localhost.
 */
export function origensPermitidas(opcoes: {
  porta: number;
  extras?: readonly string[];
  qualquerPortaLocal?: boolean;
}): (origem: string | undefined) => boolean {
  const extras = new Set<string>();
  for (const extra of opcoes.extras ?? []) {
    try {
      extras.add(new URL(extra).origin);
    } catch {
      // Endereço inválido não libera nada.
    }
  }
  return (origem) => {
    if (origem === undefined || origem === "") {
      return false;
    }
    let url: URL;
    try {
      url = new URL(origem);
    } catch {
      return false;
    }
    if (extras.has(url.origin)) {
      return true;
    }
    if (url.protocol !== "http:" || !NOMES_LOCAIS.has(url.hostname)) {
      return false;
    }
    return opcoes.qualquerPortaLocal === true || url.port === String(opcoes.porta);
  };
}

function recusar(socket: Duplex, status: number, mensagem: string): void {
  const corpo = JSON.stringify({ erro: mensagem });
  // Como o `abortHandshake` do ws: destrói depois de a resposta sair.
  socket.once("finish", () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\n` +
      "Connection: close\r\n" +
      "Cache-Control: no-store\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(corpo)}\r\n\r\n${corpo}`,
  );
}

function enviar(ws: WebSocket, mensagem: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(mensagem));
  }
}

function lerMensagem(dados: RawData, binaria: boolean) {
  if (binaria) {
    return null;
  }
  try {
    const texto = Array.isArray(dados)
      ? Buffer.concat(dados).toString("utf8")
      : Buffer.isBuffer(dados)
        ? dados.toString("utf8")
        : Buffer.from(new Uint8Array(dados)).toString("utf8");
    const resultado = esquemaDaMensagem.safeParse(JSON.parse(texto));
    return resultado.success ? resultado.data : null;
  } catch {
    return null;
  }
}

/**
 * WebSocket de cada terminal em `/api/terminais/:id/conexao`. O upgrade não
 * passa pelo Express: a trava do aplicativo e a origem são conferidas aqui.
 */
export function criarConexaoDosTerminais({ servico, temAcesso, origemPermitida }: OpcoesDaConexao): ConexaoDosTerminais {
  const servidorWs = new WebSocketServer({ noServer: true, maxPayload: TAMANHO_MAXIMO_DA_MENSAGEM });

  function ligar(ws: WebSocket, id: string): void {
    ws.on("error", () => {
      // Queda da conexão: o "close" a seguir desliga do terminal.
    });
    const conexao = servico.conectar(id, {
      saida: (dados) => enviar(ws, { tipo: "saida", dados }),
      fim: (codigo) => {
        enviar(ws, { tipo: "fim", codigo });
        ws.close(1000);
      },
    });
    if (conexao === null) {
      enviar(ws, { tipo: "fim", codigo: null });
      ws.close(1000);
      return;
    }
    ws.on("message", (dados, binaria) => {
      const mensagem = lerMensagem(dados, binaria);
      if (mensagem === null) {
        return;
      }
      if (mensagem.tipo === "entrada") {
        conexao.escrever(mensagem.dados);
      } else {
        conexao.redimensionar(mensagem.colunas, mensagem.linhas);
      }
    });
    ws.on("close", () => conexao.desconectar());
  }

  return {
    aoPedirUpgrade(requisicao, socket, cabeca) {
      socket.on("error", () => socket.destroy());
      const caminho = new URL(requisicao.url ?? "/", "http://127.0.0.1").pathname;
      const encontrado = CAMINHO_DA_CONEXAO.exec(caminho);
      if (encontrado === null) {
        recusar(socket, 404, "Endereço não encontrado.");
        return;
      }
      if (!temAcesso(requisicao)) {
        recusar(socket, 403, MENSAGEM_DE_ACESSO_NEGADO);
        return;
      }
      if (!origemPermitida(requisicao.headers.origin)) {
        recusar(socket, 403, "Origem não permitida.");
        return;
      }
      let id: string;
      try {
        id = decodeURIComponent(encontrado[1] ?? "");
      } catch {
        recusar(socket, 404, "Terminal não encontrado.");
        return;
      }
      if (!servico.existe(id)) {
        recusar(socket, 404, "Terminal não encontrado.");
        return;
      }
      servidorWs.handleUpgrade(requisicao, socket, cabeca, (ws) => ligar(ws, id));
    },
    encerrar() {
      for (const cliente of servidorWs.clients) {
        cliente.terminate();
      }
      servidorWs.close();
    },
  };
}
