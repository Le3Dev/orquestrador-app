import { beforeEach, describe, expect, it } from "vitest";

import { OrigemDoPedido } from "../orquestracao/PedidoNaFila";
import { RepositorioDeVinculos } from "./RepositorioDeVinculos";
import { ServicoDeVinculos } from "./ServicoDeVinculos";
import { Vinculo } from "./Vinculo";

class RepositorioEmMemoria implements RepositorioDeVinculos {
  readonly dados = new Map<string, Vinculo>();
  todos(): readonly Vinculo[] {
    return [...this.dados.values()].map((v) => Vinculo.reconstituir(v.paraDados()));
  }
  buscar(id: string): Vinculo | null {
    const v = this.dados.get(id);
    return v === undefined ? null : Vinculo.reconstituir(v.paraDados());
  }
  async salvar(vinculo: Vinculo): Promise<void> {
    this.dados.set(vinculo.id, Vinculo.reconstituir(vinculo.paraDados()));
  }
  async remover(id: string): Promise<void> {
    this.dados.delete(id);
  }
}

interface Entrega {
  destinoId: string;
  texto: string;
  origem: OrigemDoPedido;
}

describe("ServicoDeVinculos", () => {
  const nomes = new Map([
    ["api", "API"],
    ["front", "Front"],
    ["infra", "Infra"],
    ["front2", "front"],
  ]);
  let repositorio: RepositorioEmMemoria;
  let entregas: Entrega[];
  let falhaNaEntrega: Error | null;
  let ids: number;
  let servico: ServicoDeVinculos;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    entregas = [];
    falhaNaEntrega = null;
    ids = 0;
    servico = new ServicoDeVinculos({
      repositorio,
      orquestradores: { nomeDe: (id) => nomes.get(id) ?? null },
      entregar: async (destinoId, texto, origem) => {
        if (falhaNaEntrega !== null) {
          throw falhaNaEntrega;
        }
        entregas.push({ destinoId, texto, origem });
      },
      gerarId: () => `v${++ids}`,
      agora: () => new Date("2026-11-14T10:00:00Z"),
    });
  });

  describe("vincular", () => {
    it("liga dois orquestradores e lista", async () => {
      const vinculo = await servico.vincular("api", "front");

      expect(vinculo.id).toBe("v1");
      expect(servico.listar().map((v) => v.id)).toEqual(["v1"]);
    });

    it("permite vários vínculos por orquestrador", async () => {
      await servico.vincular("api", "front");
      await servico.vincular("api", "infra");

      expect(servico.listar()).toHaveLength(2);
    });

    it("recusa o mesmo orquestrador nos dois lados", async () => {
      await expect(servico.vincular("api", "api")).rejects.toMatchObject({ motivo: "dados_invalidos" });
    });

    it("recusa orquestrador que não existe", async () => {
      await expect(servico.vincular("api", "fantasma")).rejects.toMatchObject({ motivo: "nao_encontrado" });
      await expect(servico.vincular("fantasma", "api")).rejects.toMatchObject({ motivo: "nao_encontrado" });
    });

    it("recusa o par repetido, em qualquer ordem", async () => {
      await servico.vincular("api", "front");

      await expect(servico.vincular("api", "front")).rejects.toMatchObject({ motivo: "ja_vinculados" });
      await expect(servico.vincular("front", "api")).rejects.toMatchObject({ motivo: "ja_vinculados" });
      expect(servico.listar()).toHaveLength(1);
    });
  });

  it("desvincula e recusa um vínculo que não existe", async () => {
    const vinculo = await servico.vincular("api", "front");

    await servico.desvincular(vinculo.id);

    expect(servico.listar()).toEqual([]);
    await expect(servico.desvincular(vinculo.id)).rejects.toMatchObject({ motivo: "nao_encontrado" });
  });

  it("edita as notas e recusa texto longo demais sem alterar nada", async () => {
    const vinculo = await servico.vincular("api", "front");

    const editado = await servico.editarNotas(vinculo.id, "contrato v1");
    expect(editado.notas).toBe("contrato v1");

    await expect(servico.editarNotas(vinculo.id, "x".repeat(8001))).rejects.toMatchObject({ motivo: "dados_invalidos" });
    expect(repositorio.buscar(vinculo.id)?.notas).toBe("contrato v1");
    await expect(servico.editarNotas("nao-existe", "x")).rejects.toMatchObject({ motivo: "nao_encontrado" });
  });

  describe("enviarMensagem (manual do usuário)", () => {
    it("entrega direto ao outro lado, com a origem e 0 saltos", async () => {
      const vinculo = await servico.vincular("api", "front");

      await servico.enviarMensagem(vinculo.id, "front", "suba o servidor");

      expect(entregas).toEqual([
        { destinoId: "api", texto: "suba o servidor", origem: { orquestradorId: "front", nome: "Front", saltos: 0 } },
      ]);
    });

    it("recusa remetente de fora, texto vazio e vínculo inexistente", async () => {
      const vinculo = await servico.vincular("api", "front");

      await expect(servico.enviarMensagem(vinculo.id, "infra", "oi")).rejects.toMatchObject({ motivo: "dados_invalidos" });
      await expect(servico.enviarMensagem(vinculo.id, "api", "  ")).rejects.toMatchObject({ motivo: "dados_invalidos" });
      await expect(servico.enviarMensagem("x", "api", "oi")).rejects.toMatchObject({ motivo: "nao_encontrado" });
      expect(entregas).toEqual([]);
    });
  });

  describe("processarBlocos (escritos pelo orquestrador)", () => {
    it("entrega a mensagem a quem está vinculado, por nome (sem diferenciar maiúsculas) ou id", async () => {
      await servico.vincular("api", "front");
      await servico.vincular("api", "infra");

      const avisos = await servico.processarBlocos(
        "api",
        { mensagens: [{ para: "FRONT", texto: "pronto" }, { para: "infra", texto: "deploy" }], notas: [] },
        null,
      );

      expect(avisos).toEqual([]);
      expect(entregas.map((e) => [e.destinoId, e.texto, e.origem.saltos, e.origem.nome])).toEqual([
        ["front", "pronto", 0, "API"],
        ["infra", "deploy", 0, "API"],
      ]);
    });

    it("herda os saltos do turno de origem e soma um", async () => {
      await servico.vincular("api", "front");

      await servico.processarBlocos(
        "api",
        { mensagens: [{ para: "Front", texto: "resposta" }], notas: [] },
        { saltos: 2 },
      );

      expect(entregas[0]?.origem.saltos).toBe(3);
    });

    it("descarta a mensagem acima do limite de saltos e avisa", async () => {
      await servico.vincular("api", "front");

      const noLimite = await servico.processarBlocos("api", { mensagens: [{ para: "Front", texto: "a" }], notas: [] }, { saltos: 5 });
      const acima = await servico.processarBlocos("api", { mensagens: [{ para: "Front", texto: "b" }], notas: [] }, { saltos: 6 });

      expect(noLimite).toEqual([]);
      expect(acima).toHaveLength(1);
      expect(acima[0]).toContain("limite de 6");
      expect(entregas.map((e) => e.texto)).toEqual(["a"]);
    });

    it("ignora mensagem e notas para quem não é vinculado, com aviso", async () => {
      await servico.vincular("api", "front");

      const avisos = await servico.processarBlocos(
        "api",
        { mensagens: [{ para: "Infra", texto: "oi" }], notas: [{ com: "Infra", texto: "n" }] },
        null,
      );

      expect(avisos).toHaveLength(2);
      expect(entregas).toEqual([]);
    });

    it("avisa quando o nome é ambíguo", async () => {
      await servico.vincular("api", "front");
      await servico.vincular("api", "front2");

      const avisos = await servico.processarBlocos("api", { mensagens: [{ para: "front", texto: "oi" }], notas: [] }, null);

      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toContain("use o id");
    });

    it("substitui as notas do vínculo e avisa se forem inválidas", async () => {
      const vinculo = await servico.vincular("api", "front");

      const avisos = await servico.processarBlocos(
        "api",
        { mensagens: [], notas: [{ com: "Front", texto: "novas" }, { com: "Front", texto: "y".repeat(9000) }] },
        null,
      );

      expect(repositorio.buscar(vinculo.id)?.notas).toBe("novas");
      expect(avisos).toHaveLength(1);
    });

    it("avisa quando a fila do destino recusa, sem lançar", async () => {
      await servico.vincular("api", "front");
      falhaNaEntrega = new Error("fila cheia");

      const avisos = await servico.processarBlocos("api", { mensagens: [{ para: "Front", texto: "oi" }], notas: [] }, null);

      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toContain("fila cheia");
    });
  });

  it("doOrquestrador devolve o parceiro e as notas de cada vínculo, dos dois lados", async () => {
    const vinculo = await servico.vincular("api", "front");
    await servico.editarNotas(vinculo.id, "n");

    expect(servico.doOrquestrador("front")).toEqual([{ vinculoId: vinculo.id, parceiroId: "api", notas: "n" }]);
    expect(servico.doOrquestrador("infra")).toEqual([]);
  });

  it("removerDoOrquestrador apaga todos os vínculos dele e só os dele", async () => {
    await servico.vincular("api", "front");
    await servico.vincular("infra", "api");
    const outro = await servico.vincular("front", "infra");

    await servico.removerDoOrquestrador("api");

    expect(servico.listar().map((v) => v.id)).toEqual([outro.id]);
  });
});
