import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exigir } from "../../rotinas/duplasDeTeste";
import { DadosDaEtapa } from "../../rotinas/EtapaDaRotina";
import { ExecucaoDaRotina } from "../../rotinas/ExecucaoDaRotina";
import { Rotina } from "../../rotinas/Rotina";
import { LIMITE_DE_EXECUCOES_GUARDADAS, RepositorioDeRotinasEmArquivo } from "./RepositorioDeRotinasEmArquivo";

const PEDIDO: DadosDaEtapa = { tipo: "pedido", orquestradorId: "orq-1", texto: "Rode os testes.", modo: "execucao" };
const APROVACAO: DadosDaEtapa = { tipo: "aprovacao", mensagem: "Confira o relatório." };
const INICIO = Date.UTC(2026, 10, 17, 8, 0);

function instante(minutos: number): Date {
  return new Date(INICIO + minutos * 60_000);
}

function rotina(id: string, minutos = 0, extras: { nome?: string; etapas?: DadosDaEtapa[] } = {}): Rotina {
  return Rotina.criar({
    id,
    nome: extras.nome ?? `Rotina ${id}`,
    gatilho: { tipo: "diario", hora: "09:00" },
    etapas: extras.etapas ?? [PEDIDO],
    agora: instante(minutos),
  });
}

function execucaoPulada(rotinaDona: Rotina, id: string, minutos: number): ExecucaoDaRotina {
  return ExecucaoDaRotina.pular({ id, rotina: rotinaDona, origem: "agendada", agora: instante(minutos), motivo: "Teste." });
}

function execucaoAguardando(rotinaDona: Rotina, id: string, minutos: number): ExecucaoDaRotina {
  const execucao = ExecucaoDaRotina.iniciar({ id, rotina: rotinaDona, origem: "manual", agora: instante(minutos) });
  execucao.iniciarEtapa(instante(minutos));
  execucao.aguardarAprovacao();
  return execucao;
}

describe("RepositorioDeRotinasEmArquivo", () => {
  let pasta: string;
  let repositorio: RepositorioDeRotinasEmArquivo;
  let pastaDasRotinas: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "repositorio-rotinas-teste-"));
    pastaDasRotinas = path.join(pasta, "rotinas");
    repositorio = await RepositorioDeRotinasEmArquivo.abrir(pasta);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await repositorio.aguardarGravacoes();
    await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function reabrir(): Promise<RepositorioDeRotinasEmArquivo> {
    await repositorio.aguardarGravacoes();
    return RepositorioDeRotinasEmArquivo.abrir(pasta);
  }

  describe("rotinas", () => {
    it("abre vazio e cria a pasta rotinas", async () => {
      expect(repositorio.todas()).toEqual([]);
      expect(await readdir(pastaDasRotinas)).toEqual([]);
    });

    it("salva em rotinas/<id>.json e devolve igual depois de reabrir", async () => {
      const original = rotina("rot-1");
      await repositorio.salvar(original);

      const arquivo = JSON.parse(await readFile(path.join(pastaDasRotinas, "rot-1.json"), "utf8")) as unknown;
      const reaberto = await reabrir();

      expect(arquivo).toEqual(original.paraDados());
      expect(reaberto.buscar("rot-1")?.paraDados()).toEqual(original.paraDados());
      expect(reaberto.buscar("nao-existe")).toBeNull();
    });

    it("lista da mais antiga para a mais nova", async () => {
      await repositorio.salvar(rotina("rot-b", 10));
      await repositorio.salvar(rotina("rot-a", 20));
      await repositorio.salvar(rotina("rot-c", 5));

      expect(repositorio.todas().map((item) => item.id)).toEqual(["rot-c", "rot-b", "rot-a"]);
      expect((await reabrir()).todas().map((item) => item.id)).toEqual(["rot-c", "rot-b", "rot-a"]);
    });

    it("quem busca recebe uma cópia: mexer nela só vale depois de salvar", async () => {
      await repositorio.salvar(rotina("rot-1"));

      const copia = exigir(repositorio.buscar("rot-1"));
      copia.alterar({ nome: "Mudei" }, instante(1));

      expect(exigir(repositorio.buscar("rot-1")).nome).toBe("Rotina rot-1");
      await repositorio.salvar(copia);
      expect(exigir(repositorio.buscar("rot-1")).nome).toBe("Mudei");
    });

    it("duas gravações seguidas da mesma rotina: o disco termina com a última pedida", async () => {
      const item = rotina("rot-1");
      void repositorio.salvar(item);
      item.alterar({ nome: "Segunda versão" }, instante(1));
      void repositorio.salvar(item);
      item.alterar({ nome: "Terceira versão" }, instante(2));
      void repositorio.salvar(item);
      await repositorio.aguardarGravacoes();

      const arquivo = JSON.parse(await readFile(path.join(pastaDasRotinas, "rot-1.json"), "utf8")) as { nome: string };

      expect(arquivo.nome).toBe("Terceira versão");
      expect((await readdir(pastaDasRotinas)).filter((nome) => nome.endsWith(".tmp"))).toEqual([]);
    });

    it("remover apaga a rotina e as execuções dela do disco e da memória", async () => {
      const dona = rotina("rot-1");
      await repositorio.salvar(dona);
      await repositorio.salvarExecucao(execucaoPulada(dona, "exe-1", 1));
      await repositorio.salvar(rotina("rot-2", 1));

      await repositorio.remover("rot-1");

      expect(await readdir(pastaDasRotinas)).toEqual(["rot-2.json"]);
      expect(repositorio.buscar("rot-1")).toBeNull();
      expect(repositorio.daRotina("rot-1")).toEqual([]);
      expect(repositorio.buscarExecucao("exe-1")).toBeNull();
      expect((await reabrir()).todas().map((item) => item.id)).toEqual(["rot-2"]);
    });

    it("recusa identidade que escaparia da pasta", async () => {
      expect(() => repositorio.salvar(rotina("..\\fora"))).toThrow("Identidade de rotina inválida");
      expect(() => void repositorio.remover("../fora")).toThrow("Identidade de rotina inválida");
    });
  });

  describe("execuções", () => {
    it("salva em rotinas/<id>/execucoes/<execucaoId>.json; da mais recente para a mais antiga", async () => {
      const dona = rotina("rot-1");
      await repositorio.salvar(dona);
      await repositorio.salvarExecucao(execucaoPulada(dona, "exe-1", 10));
      await repositorio.salvarExecucao(execucaoPulada(dona, "exe-2", 30));
      await repositorio.salvarExecucao(execucaoPulada(dona, "exe-3", 20));

      expect((await readdir(path.join(pastaDasRotinas, "rot-1", "execucoes"))).sort()).toEqual([
        "exe-1.json",
        "exe-2.json",
        "exe-3.json",
      ]);
      expect(repositorio.daRotina("rot-1").map((execucao) => execucao.id)).toEqual(["exe-2", "exe-3", "exe-1"]);
      expect((await reabrir()).daRotina("rot-1").map((execucao) => execucao.id)).toEqual(["exe-2", "exe-3", "exe-1"]);
    });

    it("buscarExecucao, ativaDaRotina e ativas enxergam só o que roda ou espera aprovação", async () => {
      const a = rotina("rot-a");
      const b = rotina("rot-b", 1, { etapas: [APROVACAO] });
      await repositorio.salvar(a);
      await repositorio.salvar(b);
      const rodando = ExecucaoDaRotina.iniciar({ id: "exe-rodando", rotina: a, origem: "manual", agora: instante(5) });
      await repositorio.salvarExecucao(rodando);
      await repositorio.salvarExecucao(execucaoAguardando(b, "exe-aguardando", 3));
      await repositorio.salvarExecucao(execucaoPulada(a, "exe-pulada", 9));

      expect(repositorio.buscarExecucao("exe-rodando")?.situacao).toBe("em_andamento");
      expect(repositorio.buscarExecucao("exe-9")).toBeNull();
      expect(repositorio.ativaDaRotina("rot-a")?.id).toBe("exe-rodando");
      expect(repositorio.ativaDaRotina("rot-b")?.id).toBe("exe-aguardando");
      expect(repositorio.ativas().map((execucao) => execucao.id)).toEqual(["exe-aguardando", "exe-rodando"]);

      rodando.iniciarEtapa(instante(6));
      rodando.cancelar("Cancelada.", instante(7));
      await repositorio.salvarExecucao(rodando);
      expect(repositorio.ativaDaRotina("rot-a")).toBeNull();
    });

    it("a memória troca na hora: a próxima leitura já enxerga a execução, sem esperar o disco", async () => {
      const dona = rotina("rot-1");
      await repositorio.salvar(dona);

      void repositorio.salvarExecucao(ExecucaoDaRotina.iniciar({ id: "exe-1", rotina: dona, origem: "manual", agora: instante(1) }));

      expect(repositorio.ativaDaRotina("rot-1")?.id).toBe("exe-1");
    });

    it("a execução que espera aprovação sobrevive a reabrir e continua aprovável", async () => {
      const dona = rotina("rot-1", 0, { etapas: [APROVACAO, PEDIDO] });
      await repositorio.salvar(dona);
      await repositorio.salvarExecucao(execucaoAguardando(dona, "exe-1", 1));

      const reaberto = await reabrir();
      const execucao = exigir(reaberto.ativaDaRotina("rot-1"));

      expect(execucao.situacao).toBe("aguardando_aprovacao");
      expect(execucao.pendencia).toEqual({ tipo: "aprovacao", mensagem: "Confira o relatório." });
      expect(execucao.aprovar(instante(60))).toBe("aprovacao");
    });

    it("execução de uma rotina que não existe (mais) é ignorada", async () => {
      const removida = rotina("rot-1");

      await repositorio.salvarExecucao(execucaoPulada(removida, "exe-1", 1));

      expect(repositorio.buscarExecucao("exe-1")).toBeNull();
      expect(await readdir(pastaDasRotinas)).toEqual([]);
    });

    it(`guarda só as últimas ${LIMITE_DE_EXECUCOES_GUARDADAS} execuções, na memória e no disco`, async () => {
      const dona = rotina("rot-1");
      await repositorio.salvar(dona);
      for (let numero = 1; numero <= 55; numero++) {
        await repositorio.salvarExecucao(execucaoPulada(dona, `exe-${numero}`, numero));
      }
      await repositorio.aguardarGravacoes();

      const guardadas = repositorio.daRotina("rot-1").map((execucao) => execucao.id);
      const noDisco = await readdir(path.join(pastaDasRotinas, "rot-1", "execucoes"));

      expect(guardadas).toHaveLength(LIMITE_DE_EXECUCOES_GUARDADAS);
      expect(guardadas[0]).toBe("exe-55");
      expect(guardadas.at(-1)).toBe("exe-6");
      expect(noDisco).toHaveLength(LIMITE_DE_EXECUCOES_GUARDADAS);
      expect(noDisco).not.toContain("exe-5.json");
      expect((await reabrir()).daRotina("rot-1")).toHaveLength(LIMITE_DE_EXECUCOES_GUARDADAS);
    });

    it("a execução ativa nunca sai, por mais antiga que seja", async () => {
      const dona = rotina("rot-1", 0, { etapas: [APROVACAO] });
      await repositorio.salvar(dona);
      await repositorio.salvarExecucao(execucaoAguardando(dona, "exe-aguardando", 0));
      for (let numero = 1; numero <= 60; numero++) {
        await repositorio.salvarExecucao(execucaoPulada(dona, `exe-${numero}`, numero));
      }
      await repositorio.aguardarGravacoes();

      expect(repositorio.ativaDaRotina("rot-1")?.id).toBe("exe-aguardando");
      expect(repositorio.daRotina("rot-1")).toHaveLength(LIMITE_DE_EXECUCOES_GUARDADAS + 1);
      expect(await readdir(path.join(pastaDasRotinas, "rot-1", "execucoes"))).toContain("exe-aguardando.json");
    });

    it("a mesma execução salva várias vezes ocupa um lugar só", async () => {
      const dona = rotina("rot-1");
      await repositorio.salvar(dona);
      const execucao = ExecucaoDaRotina.iniciar({ id: "exe-1", rotina: dona, origem: "manual", agora: instante(1) });
      void repositorio.salvarExecucao(execucao);
      execucao.iniciarEtapa(instante(2));
      void repositorio.salvarExecucao(execucao);
      execucao.concluirEtapa("ok", instante(3));
      void repositorio.salvarExecucao(execucao);
      await repositorio.aguardarGravacoes();

      const arquivo = JSON.parse(
        await readFile(path.join(pastaDasRotinas, "rot-1", "execucoes", "exe-1.json"), "utf8"),
      ) as { situacao: string };

      expect(repositorio.daRotina("rot-1")).toHaveLength(1);
      expect(arquivo.situacao).toBe("concluida");
    });
  });

  describe("arquivos ilegíveis", () => {
    it("pula o que não dá para ler (e mantém o arquivo), sem impedir as outras de abrir", async () => {
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const boa = rotina("rot-boa");
      await repositorio.salvar(boa);
      await repositorio.salvarExecucao(execucaoPulada(boa, "exe-boa", 1));
      await repositorio.aguardarGravacoes();
      const dados = boa.paraDados();
      const pastaDasExecucoes = path.join(pastaDasRotinas, "rot-boa", "execucoes");
      await writeFile(path.join(pastaDasRotinas, "quebrada.json"), "{ isto não é json");
      await writeFile(path.join(pastaDasRotinas, "de-outra.json"), JSON.stringify({ ...dados, id: "rot-outra" }));
      await writeFile(
        path.join(pastaDasRotinas, "intervalo-curto.json"),
        JSON.stringify({ ...dados, id: "intervalo-curto", gatilho: { tipo: "intervalo", minutos: 5 } }),
      );
      await writeFile(path.join(pastaDasRotinas, "sem-nome.json"), JSON.stringify({ id: "sem-nome" }));
      await writeFile(path.join(pastaDasExecucoes, "quebrada.json"), "não é json");
      const execucaoBoa = JSON.parse(await readFile(path.join(pastaDasExecucoes, "exe-boa.json"), "utf8")) as object;
      await writeFile(path.join(pastaDasExecucoes, "exe-de-outra.json"), JSON.stringify({ ...execucaoBoa, id: "exe-de-outra", rotinaId: "rot-outra" }));
      await writeFile(path.join(pastaDasExecucoes, "exe-situacao.json"), JSON.stringify({ ...execucaoBoa, id: "exe-situacao", situacao: "voando" }));

      const reaberto = await RepositorioDeRotinasEmArquivo.abrir(pasta);

      expect(reaberto.todas().map((item) => item.id)).toEqual(["rot-boa"]);
      expect(reaberto.daRotina("rot-boa").map((execucao) => execucao.id)).toEqual(["exe-boa"]);
      expect(aviso).toHaveBeenCalledTimes(7);
      expect((await readdir(pastaDasRotinas)).sort()).toContain("quebrada.json");
    });

    it("arquivos temporários de uma gravação interrompida e arquivos que não são .json são ignorados", async () => {
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await repositorio.salvar(rotina("rot-1"));
      await repositorio.aguardarGravacoes();
      await writeFile(path.join(pastaDasRotinas, "rot-2.json.tmp"), "{ pela metade");
      await writeFile(path.join(pastaDasRotinas, "anotacao.txt"), "oi");
      await mkdir(path.join(pastaDasRotinas, "sem-rotina", "execucoes"), { recursive: true });

      const reaberto = await RepositorioDeRotinasEmArquivo.abrir(pasta);

      expect(reaberto.todas().map((item) => item.id)).toEqual(["rot-1"]);
      expect(aviso).not.toHaveBeenCalled();
    });
  });
});
