import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConsultaDoCatalogo, ErroDePlugin, PluginInstalado } from "../plugins/CatalogoDePlugins";
import { montarAplicacao } from "../root";
import { criarPluginsRoutes } from "./pluginsRoutes";

const PLUGIN: PluginInstalado = {
  id: "superpowers@claude-plugins-official",
  nome: "superpowers",
  marketplace: "claude-plugins-official",
  oficial: true,
  versao: "6.4.1",
  ligado: true,
  instaladoEm: "2026-04-22T11:18:06.256Z",
  inventario: { skills: [{ nome: "brainstorming", descricao: "Planeja antes de codar" }], subagentes: 1, servidoresMcp: 0, hooks: 0, verificado: true, temBin: false },
};

function criarServicoFalso() {
  return {
    consultas: [] as ConsultaDoCatalogo[],
    chamadas: [] as string[],
    erro: null as Error | null,
    async buscarCatalogo(consulta: ConsultaDoCatalogo) {
      this.consultas.push(consulta);
      if (this.erro) throw this.erro;
      return { plugins: [], total: 0, totais: { oficial: 3, aberto: 7 } };
    },
    async listarInstalados() {
      if (this.erro) throw this.erro;
      return [PLUGIN];
    },
    async instalar(id: string) {
      this.chamadas.push(`instalar ${id}`);
      if (this.erro) throw this.erro;
      return { plugin: { ...PLUGIN, ligado: false }, precisaConfirmar: true };
    },
    async ligar(id: string) {
      this.chamadas.push(`ligar ${id}`);
      if (this.erro) throw this.erro;
      return PLUGIN;
    },
    async desligar(id: string) {
      this.chamadas.push(`desligar ${id}`);
      if (this.erro) throw this.erro;
      return { ...PLUGIN, ligado: false };
    },
    async remover(id: string) {
      this.chamadas.push(`remover ${id}`);
      if (this.erro) throw this.erro;
    },
  };
}

describe("rotas dos plugins", () => {
  let servidor: Server;
  let base: string;
  let servico: ReturnType<typeof criarServicoFalso>;

  beforeEach(async () => {
    servico = criarServicoFalso();
    const aplicacao = express();
    aplicacao.use(express.json());
    aplicacao.use("/api", criarPluginsRoutes({ catalogo: servico }));
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
  });

  const enviar = (caminho: string, metodo: string, corpo?: unknown) =>
    fetch(`${base}${caminho}`, {
      method: metodo,
      ...(corpo === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
    });

  describe("GET /plugins/catalogo", () => {
    it("usa os padrões: origem oficial, limite 50, deslocamento 0, busca vazia", async () => {
      const resposta = await fetch(`${base}/plugins/catalogo`);

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({ plugins: [], total: 0, totais: { oficial: 3, aberto: 7 } });
      expect(servico.consultas).toEqual([{ busca: "", origem: "oficial", limite: 50, deslocamento: 0 }]);
    });

    it("repassa busca, origem, limite e deslocamento, com o limite no máximo de 100", async () => {
      await fetch(`${base}/plugins/catalogo?busca=${encodeURIComponent("açúcar")}&origem=aberto&limite=500&deslocamento=20`);

      expect(servico.consultas).toEqual([{ busca: "açúcar", origem: "aberto", limite: 100, deslocamento: 20 }]);
    });

    it.each([
      ["origem=qualquer", "A origem deve ser oficial, aberto ou todos."],
      ["limite=0", "O limite deve ser um número inteiro de 1 a 100."],
      ["limite=abc", "O limite deve ser um número inteiro de 1 a 100."],
      ["limite=-1", "O limite deve ser um número inteiro de 1 a 100."],
      ["deslocamento=-1", "O deslocamento deve ser um número inteiro maior ou igual a zero."],
      ["busca=a&busca=b", "A busca deve ser um texto."],
      ["origem=todos&origem=aberto", "A origem deve ser oficial, aberto ou todos."],
    ])("consulta %s dá 400", async (consulta, mensagem) => {
      const resposta = await fetch(`${base}/plugins/catalogo?${consulta}`);

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: mensagem });
      expect(servico.consultas).toEqual([]);
    });
  });

  it("GET /plugins/instalados devolve a lista", async () => {
    const resposta = await fetch(`${base}/plugins/instalados`);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ plugins: [PLUGIN] });
  });

  it("POST /plugins/instalar devolve o plugin e precisaConfirmar", async () => {
    const resposta = await enviar("/plugins/instalar", "POST", { id: PLUGIN.id });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ plugin: { ...PLUGIN, ligado: false }, precisaConfirmar: true });
    expect(servico.chamadas).toEqual([`instalar ${PLUGIN.id}`]);
  });

  it.each([[{}], [{ id: 5 }], [["a@b"]]])("POST /plugins/instalar com o corpo %j dá 400", async (corpo) => {
    const resposta = await enviar("/plugins/instalar", "POST", corpo);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: "Identificador de plugin inválido. Use o formato nome@marketplace." });
    expect(servico.chamadas).toEqual([]);
  });

  it("POST ligar e desligar devolvem o plugin, com o @ do id na URL", async () => {
    const ligado = await enviar("/plugins/superpowers@claude-plugins-official/ligar", "POST");
    const desligado = await enviar(`/plugins/${encodeURIComponent(PLUGIN.id)}/desligar`, "POST");

    expect(ligado.status).toBe(200);
    expect(await ligado.json()).toEqual({ plugin: PLUGIN });
    expect(desligado.status).toBe(200);
    expect(await desligado.json()).toEqual({ plugin: { ...PLUGIN, ligado: false } });
    expect(servico.chamadas).toEqual([`ligar ${PLUGIN.id}`, `desligar ${PLUGIN.id}`]);
  });

  it("DELETE /plugins/:id responde 204 sem corpo", async () => {
    const resposta = await enviar(`/plugins/${PLUGIN.id}`, "DELETE");

    expect(resposta.status).toBe(204);
    expect(await resposta.text()).toBe("");
    expect(servico.chamadas).toEqual([`remover ${PLUGIN.id}`]);
  });

  it.each([
    ["id_invalido", 400],
    ["nao_encontrado", 404],
    ["instalacao_em_andamento", 409],
    ["sem_internet", 503],
    ["tempo_esgotado", 504],
    ["falha_do_cli", 502],
  ] as const)("o erro %s vira %i com a mensagem pronta para a tela", async (motivo, status) => {
    servico.erro = new ErroDePlugin(motivo, "Mensagem para a tela.");

    const respostas = await Promise.all([
      fetch(`${base}/plugins/catalogo`),
      fetch(`${base}/plugins/instalados`),
      enviar("/plugins/instalar", "POST", { id: PLUGIN.id }),
      enviar(`/plugins/${PLUGIN.id}/ligar`, "POST"),
      enviar(`/plugins/${PLUGIN.id}/desligar`, "POST"),
      enviar(`/plugins/${PLUGIN.id}`, "DELETE"),
    ]);

    for (const resposta of respostas) {
      expect(resposta.status).toBe(status);
      expect(await resposta.json()).toEqual({ erro: "Mensagem para a tela." });
    }
  });

  describe("Sec-Fetch-Site cross-site", () => {
    const cruzado = { "sec-fetch-site": "cross-site" };
    const MUTACOES: [string, string][] = [
      ["POST", "/plugins/instalar"],
      ["POST", `/plugins/${PLUGIN.id}/ligar`],
      ["POST", `/plugins/${PLUGIN.id}/desligar`],
      ["DELETE", `/plugins/${PLUGIN.id}`],
    ];

    it.each(MUTACOES)("%s %s é recusado com 403 e não chega ao serviço", async (metodo, caminho) => {
      const resposta = await fetch(`${base}${caminho}`, {
        method: metodo,
        headers: { ...cruzado, "content-type": "application/json" },
        ...(metodo === "POST" && caminho.endsWith("instalar") ? { body: JSON.stringify({ id: PLUGIN.id }) } : {}),
      });

      expect(resposta.status).toBe(403);
      expect(await resposta.json()).toEqual({ erro: "Requisição de outro site recusada." });
      expect(servico.chamadas).toEqual([]);
    });

    it.each(["same-origin", "same-site", "none"])("Sec-Fetch-Site %s segue, sem Content-Type e sem corpo", async (valor) => {
      const resposta = await fetch(`${base}/plugins/${PLUGIN.id}/ligar`, { method: "POST", headers: { "sec-fetch-site": valor } });

      expect(resposta.status).toBe(200);
      expect(servico.chamadas).toEqual([`ligar ${PLUGIN.id}`]);
    });

    it("as leituras (GET) não são barradas", async () => {
      const resposta = await fetch(`${base}/plugins/instalados`, { headers: cruzado });

      expect(resposta.status).toBe(200);
    });
  });

  it("erro inesperado vira 500 com { erro }", async () => {
    servico.erro = new Error("estourou");

    const resposta = await fetch(`${base}/plugins/instalados`);

    expect(resposta.status).toBe(500);
    expect(((await resposta.json()) as { erro: string }).erro).toContain("estourou");
  });
});

describe("plugins atrás da trava do aplicativo", () => {
  const CHAVE = "0123456789abcdef".repeat(4);
  let servidor: Server;
  let pasta: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "rotas-plugins-teste-"));
  });

  afterEach(async () => {
    servidor.close();
    await once(servidor, "close");
    await rm(pasta, { recursive: true, force: true });
  });

  it("sem a chave do app nenhuma rota de plugins chega ao serviço", async () => {
    const servico = criarServicoFalso();
    const aplicacao = montarAplicacao(
      { chaveDeAcesso: CHAVE, permitirNavegador: false, urlDeDownload: null, pastaDaTela: path.join(pasta, "nao-existe-tela") },
      (rotas) => {
        rotas.use("/api", criarPluginsRoutes({ catalogo: servico }));
      },
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;

    const respostas = [
      await fetch(`${base}/plugins/catalogo`),
      await fetch(`${base}/plugins/instalados`),
      await fetch(`${base}/plugins/instalar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: PLUGIN.id }) }),
      await fetch(`${base}/plugins/${PLUGIN.id}`, { method: "DELETE" }),
    ];

    expect(respostas.map((resposta) => resposta.status)).toEqual([403, 403, 403, 403]);
    expect(servico.consultas).toEqual([]);
    expect(servico.chamadas).toEqual([]);
  });
});
