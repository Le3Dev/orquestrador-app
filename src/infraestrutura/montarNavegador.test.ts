import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import { MontagemDoNavegador, montarNavegador } from "./montarNavegador";
import { configuracaoMcpParaClaudeCode } from "./mcp/ServidorMcpDoApp";
import { PortaParaOProcessoPai } from "./navegador/ControleDoNavegadorPeloElectron";

async function conectar(montagem: MontagemDoNavegador, orquestradorId: string): Promise<{ mcp: Client; encerrar: () => void }> {
  const registro = montagem.servidorMcp.registrarTurno({ orquestradorId, ferramentas: { navegador: true } });
  const configuracao = configuracaoMcpParaClaudeCode(registro).mcpServers.orquestrador;
  const mcp = new Client({ name: "teste", version: "1.0.0" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(configuracao.url), { requestInit: { headers: configuracao.headers } }));
  return { mcp, encerrar: () => registro.encerrar() };
}

describe("montarNavegador", () => {
  const abertos: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fechar of abertos.splice(0)) await fechar();
  });

  it("sobe o servidor MCP com o grupo navegador e fala com o app pela parentPort", async () => {
    const recebidas: Array<Record<string, unknown>> = [];
    let ouvinte: ((mensagem: { data: unknown }) => void) | null = null;
    const porta: PortaParaOProcessoPai = {
      on: (_evento, o) => {
        ouvinte = o;
      },
      postMessage: (mensagem) => {
        const dados = mensagem as Record<string, unknown>;
        recebidas.push(dados);
        if (dados["tipo"] !== "navegador:comando") return;
        ouvinte?.({
          data: {
            tipo: "navegador:resposta",
            id: dados["id"],
            ok: true,
            resultado: { url: "https://exemplo.com/", titulo: "Exemplo", mensagem: "Página aberta." },
          },
        });
      },
    };
    const montagem = montarNavegador({ portaDoProcessoPai: porta });
    abertos.push(() => montagem.encerrar());
    await montagem.iniciar();
    const { mcp, encerrar } = await conectar(montagem, "orq-1");
    abertos.push(async () => {
      await mcp.close();
      encerrar();
    });

    expect((await mcp.listTools()).tools).toHaveLength(11);
    const resposta = await mcp.callTool({ name: "navegador_abrir", arguments: { url: "https://exemplo.com" } });

    expect(resposta.isError).toBeFalsy();
    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]).toMatchObject({ tipo: "navegador:comando", orquestradorId: "orq-1", comando: { tipo: "abrir" } });
  });

  it("sem parentPort (fora do app), a ferramenta responde que só funciona no desktop", async () => {
    const montagem = montarNavegador({ portaDoProcessoPai: null });
    abertos.push(() => montagem.encerrar());
    await montagem.iniciar();
    const { mcp, encerrar } = await conectar(montagem, "orq-1");
    abertos.push(async () => {
      await mcp.close();
      encerrar();
    });

    const resposta = await mcp.callTool({ name: "navegador_ler_pagina", arguments: {} });

    expect(resposta.isError).toBe(true);
    expect(resposta.content).toEqual([{ type: "text", text: "O navegador do agente só funciona no aplicativo desktop." }]);
  });

  it("encerrar para o servidor e cancela os comandos em espera", async () => {
    // O app nunca responde: o comando fica em espera até o encerramento.
    const porta: PortaParaOProcessoPai = { on: () => undefined, postMessage: () => undefined };
    const montagem = montarNavegador({ portaDoProcessoPai: porta });
    await montagem.iniciar();
    const { mcp, encerrar } = await conectar(montagem, "orq-1");
    const chamada = mcp.callTool({ name: "navegador_ler_pagina", arguments: {} }).catch((erro: unknown) => erro);

    await montagem.encerrar();
    const resposta = await chamada;
    await mcp.close().catch(() => undefined);
    encerrar();

    // A conexão cai ou a ferramenta responde "cancelado": de qualquer forma, a chamada termina.
    expect(resposta instanceof Error || (resposta as { isError?: boolean }).isError === true).toBe(true);
    expect(() => montagem.servidorMcp.registrarTurno({ orquestradorId: "orq-1", ferramentas: {} })).toThrow(/não foi iniciado/);
  });
});
