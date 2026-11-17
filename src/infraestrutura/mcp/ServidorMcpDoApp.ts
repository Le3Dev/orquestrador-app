import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http, { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  ContextoDaFerramenta,
  FerramentaMcp,
  GrupoDeFerramentasMcp,
  ResultadoDaFerramenta,
} from "./GrupoDeFerramentasMcp";

export const NOME_DO_SERVIDOR_MCP = "orquestrador";
export const CAMINHO_DO_SERVIDOR_MCP = "/mcp";
export const ENDERECO_DO_SERVIDOR_MCP = "127.0.0.1";
const TAMANHO_MAXIMO_DO_CORPO_EM_BYTES = 4 * 1024 * 1024;

/** Quais grupos de ferramentas o turno liga: a chave é o nome dado em `registrarGrupoDeFerramentas`. */
export type FerramentasDoTurno = Readonly<Record<string, boolean>>;

export interface PedidoDeTurnoMcp {
  readonly orquestradorId: string;
  readonly ferramentas: FerramentasDoTurno;
}

/** O que o motor precisa para conectar ao servidor neste turno. `encerrar` revoga o token. */
export interface RegistroDoTurnoMcp {
  readonly url: string;
  readonly token: string;
  encerrar(): void;
}

export interface OpcoesDoServidorMcpDoApp {
  readonly versao?: string;
}

interface TurnoRegistrado {
  readonly orquestradorId: string;
  readonly ferramentas: FerramentasDoTurno;
  readonly digestDoToken: Buffer;
  /** Aborta as chamadas em andamento quando o turno acaba. */
  readonly cancelamento: AbortController;
}

interface FalhaDeRequisicao {
  readonly status: number;
  readonly mensagem: string;
  readonly cabecalhos?: Readonly<Record<string, string>>;
}

/**
 * Servidor MCP (Streamable HTTP) do aplicativo: oferece ferramentas aos
 * agentes (hoje o navegador; depois a delegação de subtarefas).
 *
 * Segurança:
 * - escuta só em 127.0.0.1, numa porta livre, em `/mcp`;
 * - cada turno recebe um token aleatório (32 bytes), enviado como
 *   `Authorization: Bearer <token>` e revogado no fim do turno; o token também
 *   define quem chama (`orquestradorId`) e quais grupos de ferramentas valem;
 * - recusa `Origin` (um navegador não tem o que fazer aqui) e `Host` que não
 *   seja `127.0.0.1:<porta>` (DNS rebinding);
 * - sem sessão: cada requisição POST ganha um servidor MCP novo, montado só com
 *   as ferramentas dos grupos que o turno ligou.
 */
export class ServidorMcpDoApp {
  private readonly servidorHttp: Server;
  private readonly grupos = new Map<string, GrupoDeFerramentasMcp>();
  private readonly nomesDeFerramentas = new Set<string>();
  private readonly turnos = new Map<string, TurnoRegistrado>();
  private readonly versao: string;
  private porta: number | null = null;
  private iniciando: Promise<void> | null = null;

  constructor(opcoes: OpcoesDoServidorMcpDoApp = {}) {
    this.versao = opcoes.versao ?? "1.0.0";
    this.servidorHttp = http.createServer((requisicao, resposta) => {
      void this.atender(requisicao, resposta);
    });
  }

  /** A URL do servidor (existe depois de `iniciar`). */
  get url(): string {
    if (this.porta === null) throw new Error("O servidor MCP ainda não foi iniciado.");
    return `http://${ENDERECO_DO_SERVIDOR_MCP}:${this.porta}${CAMINHO_DO_SERVIDOR_MCP}`;
  }

  /**
   * Um conjunto de ferramentas que os turnos podem ligar pelo nome. Pode ser
   * chamado antes ou depois de `iniciar`.
   *
   * @throws Error se o nome do grupo ou o de alguma ferramenta já existir.
   */
  registrarGrupoDeFerramentas(nome: string, definicao: GrupoDeFerramentasMcp): void {
    if (nome.trim() === "") throw new Error("O grupo de ferramentas precisa de um nome.");
    if (this.grupos.has(nome)) throw new Error(`O grupo de ferramentas "${nome}" já está registrado.`);
    const nomes = definicao.ferramentas.map((ferramenta) => ferramenta.nome);
    for (const [indice, ferramenta] of nomes.entries()) {
      if (this.nomesDeFerramentas.has(ferramenta) || nomes.indexOf(ferramenta) !== indice) {
        throw new Error(`A ferramenta "${ferramenta}" já está registrada.`);
      }
    }
    this.grupos.set(nome, definicao);
    for (const ferramenta of nomes) this.nomesDeFerramentas.add(ferramenta);
  }

  /** Começa a escutar em 127.0.0.1, numa porta livre. Chamar de novo não faz nada. */
  iniciar(): Promise<void> {
    this.iniciando ??= new Promise<void>((resolver, rejeitar) => {
      const aoFalhar = (erro: Error): void => {
        this.iniciando = null;
        rejeitar(erro);
      };
      this.servidorHttp.once("error", aoFalhar);
      this.servidorHttp.listen({ host: ENDERECO_DO_SERVIDOR_MCP, port: 0 }, () => {
        this.servidorHttp.off("error", aoFalhar);
        this.porta = (this.servidorHttp.address() as AddressInfo).port;
        resolver();
      });
    });
    return this.iniciando;
  }

  /** Para de escutar, revoga todos os tokens e cancela as chamadas em andamento. */
  async encerrar(): Promise<void> {
    for (const turno of this.turnos.values()) turno.cancelamento.abort();
    this.turnos.clear();
    this.porta = null;
    const iniciando = this.iniciando;
    this.iniciando = null;
    if (iniciando === null) return;
    await iniciando.catch(() => undefined);
    if (!this.servidorHttp.listening) return;
    await new Promise<void>((resolver) => {
      this.servidorHttp.close(() => resolver());
      this.servidorHttp.closeAllConnections();
    });
  }

  /**
   * Abre um turno: gera o token que o motor usa para conectar e diz quais
   * grupos de ferramentas ele enxerga (`ferramentas: { navegador: true }`).
   * `encerrar()` do registro revoga o token e cancela o que estiver rodando.
   *
   * @throws Error se o servidor não foi iniciado ou se um grupo ligado não existe.
   */
  registrarTurno(pedido: PedidoDeTurnoMcp): RegistroDoTurnoMcp {
    const url = this.url;
    for (const [grupo, ligado] of Object.entries(pedido.ferramentas)) {
      if (ligado && !this.grupos.has(grupo)) throw new Error(`Grupo de ferramentas desconhecido: "${grupo}".`);
    }
    const token = randomBytes(32).toString("base64url");
    const idDoTurno = randomUUID();
    const turno: TurnoRegistrado = {
      orquestradorId: pedido.orquestradorId,
      ferramentas: { ...pedido.ferramentas },
      digestDoToken: digestDe(token),
      cancelamento: new AbortController(),
    };
    this.turnos.set(idDoTurno, turno);
    return {
      url,
      token,
      encerrar: () => {
        if (this.turnos.delete(idDoTurno)) turno.cancelamento.abort();
      },
    };
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  private async atender(requisicao: IncomingMessage, resposta: ServerResponse): Promise<void> {
    try {
      const verificacao = this.verificar(requisicao);
      if ("status" in verificacao) {
        responderComErro(resposta, verificacao);
        return;
      }
      await this.atenderComoMcp(requisicao, resposta, verificacao);
    } catch (erro) {
      console.error("[mcp] Falha ao atender a requisição:", erro);
      if (!resposta.headersSent) responderComErro(resposta, { status: 500, mensagem: "Erro interno do servidor MCP." });
      else resposta.end();
    }
  }

  /** Host, Origin, token, caminho, método e tamanho, nessa ordem. Devolve o turno ou a falha. */
  private verificar(requisicao: IncomingMessage): TurnoRegistrado | FalhaDeRequisicao {
    const porta = this.porta;
    if (porta === null || requisicao.headers.host !== `${ENDERECO_DO_SERVIDOR_MCP}:${porta}`) {
      return { status: 403, mensagem: "Host não permitido." };
    }
    if (requisicao.headers.origin !== undefined) return { status: 403, mensagem: "Origin não permitido." };

    const turno = this.turnoDoCabecalho(requisicao.headers.authorization);
    if (turno === null) {
      return { status: 401, mensagem: "Token ausente ou inválido.", cabecalhos: { "WWW-Authenticate": "Bearer" } };
    }

    if (caminhoDe(requisicao) !== CAMINHO_DO_SERVIDOR_MCP) return { status: 404, mensagem: "Não encontrado." };
    if (requisicao.method !== "POST") {
      // Sem sessão não há fluxo SSE de servidor para cliente nem o que encerrar.
      return { status: 405, mensagem: "Método não permitido.", cabecalhos: { Allow: "POST" } };
    }
    const tamanho = Number(requisicao.headers["content-length"] ?? 0);
    if (Number.isFinite(tamanho) && tamanho > TAMANHO_MAXIMO_DO_CORPO_EM_BYTES) {
      return { status: 413, mensagem: "Corpo grande demais." };
    }
    return turno;
  }

  /** Compara o token contra todos os turnos, sem parar no primeiro que bate. */
  private turnoDoCabecalho(autorizacao: string | undefined): TurnoRegistrado | null {
    const token = /^Bearer\s+(\S+)\s*$/i.exec(autorizacao ?? "")?.[1];
    if (token === undefined) return null;
    const digest = digestDe(token);
    let encontrado: TurnoRegistrado | null = null;
    for (const turno of this.turnos.values()) {
      const igual = timingSafeEqual(turno.digestDoToken, digest);
      if (igual && encontrado === null) encontrado = turno;
    }
    return encontrado;
  }

  private async atenderComoMcp(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    turno: TurnoRegistrado,
  ): Promise<void> {
    const servidorMcp = this.criarServidorParaOTurno(turno);
    // Sem `sessionIdGenerator` o transporte fica sem sessão; `enableJsonResponse` responde JSON puro em vez de SSE.
    const transporte = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    // Cliente que desiste (ou resposta já entregue): solta o transporte e aborta o que ainda roda.
    resposta.once("close", () => {
      void servidorMcp.close().catch(() => undefined);
    });
    await servidorMcp.connect(transporte);
    await transporte.handleRequest(requisicao, resposta);
  }

  private criarServidorParaOTurno(turno: TurnoRegistrado): McpServer {
    const servidorMcp = new McpServer({ name: NOME_DO_SERVIDOR_MCP, version: this.versao });
    for (const [nomeDoGrupo, ligado] of Object.entries(turno.ferramentas)) {
      const grupo = ligado ? this.grupos.get(nomeDoGrupo) : undefined;
      if (grupo === undefined) continue;
      for (const ferramenta of grupo.ferramentas) this.registrarFerramenta(servidorMcp, ferramenta, turno);
    }
    return servidorMcp;
  }

  private registrarFerramenta(servidorMcp: McpServer, ferramenta: FerramentaMcp, turno: TurnoRegistrado): void {
    servidorMcp.registerTool(
      ferramenta.nome,
      { description: ferramenta.descricao, inputSchema: ferramenta.entrada },
      async (argumentos, extra): Promise<CallToolResult> => {
        const contexto: ContextoDaFerramenta = {
          orquestradorId: turno.orquestradorId,
          sinal: AbortSignal.any([extra.signal, turno.cancelamento.signal]),
        };
        try {
          return paraResultadoMcp(await ferramenta.executar(argumentos, contexto));
        } catch (erro) {
          console.error(`[mcp] A ferramenta ${ferramenta.nome} falhou:`, erro);
          return {
            isError: true,
            content: [{ type: "text", text: `A ferramenta ${ferramenta.nome} falhou de forma inesperada.` }],
          };
        }
      },
    );
  }
}

/**
 * O trecho `mcpServers` do `--mcp-config` do Claude Code para o turno
 * registrado (transporte HTTP, com o token no cabeçalho `Authorization`).
 */
export function configuracaoMcpParaClaudeCode(registro: Pick<RegistroDoTurnoMcp, "url" | "token">): {
  mcpServers: {
    [NOME_DO_SERVIDOR_MCP]: { type: "http"; url: string; headers: { Authorization: string } };
  };
} {
  return {
    mcpServers: {
      [NOME_DO_SERVIDOR_MCP]: {
        type: "http",
        url: registro.url,
        headers: { Authorization: `Bearer ${registro.token}` },
      },
    },
  };
}

/** O nome que o Claude Code dá à ferramenta do servidor (`mcp__orquestrador__<nome>`). */
export function nomeDaFerramentaNoClaudeCode(nome: string): string {
  return `mcp__${NOME_DO_SERVIDOR_MCP}__${nome}`;
}

function digestDe(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function caminhoDe(requisicao: IncomingMessage): string | null {
  try {
    return new URL(requisicao.url ?? "/", `http://${ENDERECO_DO_SERVIDOR_MCP}`).pathname;
  } catch {
    return null;
  }
}

function paraResultadoMcp(resultado: ResultadoDaFerramenta): CallToolResult {
  const conteudo = resultado.conteudo.map((parte) =>
    parte.tipo === "texto"
      ? ({ type: "text", text: parte.texto } as const)
      : ({ type: "image", data: parte.base64, mimeType: parte.tipoDeMidia } as const),
  );
  return resultado.erro === true ? { content: conteudo, isError: true } : { content: conteudo };
}

function responderComErro(resposta: ServerResponse, falha: FalhaDeRequisicao): void {
  resposta.writeHead(falha.status, { "Content-Type": "application/json", ...falha.cabecalhos });
  resposta.end(JSON.stringify({ error: falha.mensagem }));
}
