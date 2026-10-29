import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { comNovasTentativas, ErroAoIniciarProcesso } from "../claudecode/FachadaClaudeCodeCli";
import { lerTasklistCsv } from "./Processos";
import { ehAgenteDeixadoPorNos, RegistroDeProcessos } from "./RegistroDeProcessos";

describe("lerTasklistCsv", () => {
  it("lê a memória no formato do Windows em português e em inglês", () => {
    const saida = [
      '"claude.exe","19796","Console","1","278.528 K"',
      '"claude.exe","4176","Console","1","140,636 K"',
      "",
      "INFORMAÇÕES: nenhuma tarefa em execução corresponde aos critérios especificados.",
    ].join("\r\n");

    expect(lerTasklistCsv(saida)).toEqual(
      new Map([
        [19796, 278_528 * 1024],
        [4176, 140_636 * 1024],
      ]),
    );
  });
});

describe("ehAgenteDeixadoPorNos", () => {
  const processo = { pid: 10, orquestradorId: "o1", sessaoId: "sessao-abc", iniciadoEm: "" };

  it("reconhece o agente pela sessão na linha de comando", () => {
    expect(
      ehAgenteDeixadoPorNos(processo, "claude.exe -p --input-format stream-json --resume sessao-abc --model opus"),
    ).toBe(true);
  });

  it("não derruba um PID reaproveitado por outro programa nem uma sessão interativa do usuário", () => {
    expect(ehAgenteDeixadoPorNos(processo, "notepad.exe")).toBe(false);
    expect(ehAgenteDeixadoPorNos(processo, '"C:\\...\\claude.exe"')).toBe(false);
    expect(ehAgenteDeixadoPorNos(processo, null)).toBe(false);
  });
});

describe("RegistroDeProcessos", () => {
  let pasta: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "registro-teste-"));
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it("grava em disco quem está rodando, para o próximo servidor achar os órfãos", () => {
    const arquivo = path.join(pasta, "processos.json");
    const registro = new RegistroDeProcessos(arquivo);

    registro.registrar({ pid: 1, orquestradorId: "o1", sessaoId: "s1", iniciadoEm: "agora" });
    registro.registrar({ pid: 2, orquestradorId: "o2", sessaoId: "s2", iniciadoEm: "agora" });
    registro.remover(1);

    expect(RegistroDeProcessos.lerArquivo(arquivo).map((processo) => processo.pid)).toEqual([2]);
  });

  it("lê arquivo ausente ou corrompido como lista vazia", () => {
    expect(RegistroDeProcessos.lerArquivo(path.join(pasta, "nao-existe.json"))).toEqual([]);
  });
});

describe("comNovasTentativas", () => {
  const sinal = new AbortController().signal;

  it("tenta de novo enquanto o executável some durante a atualização do Claude Code", async () => {
    let chamadas = 0;
    const resultado = await comNovasTentativas(
      async () => {
        chamadas += 1;
        if (chamadas < 3) {
          throw new ErroAoIniciarProcesso("sumiu", "ENOENT");
        }
        return "ok";
      },
      { tentativas: 6, esperaMs: 1, sinal },
    );

    expect(resultado).toBe("ok");
    expect(chamadas).toBe(3);
  });

  it("não insiste em erro que não é passageiro", async () => {
    let chamadas = 0;
    await expect(
      comNovasTentativas(
        async () => {
          chamadas += 1;
          throw new Error("argumento inválido");
        },
        { tentativas: 6, esperaMs: 1, sinal },
      ),
    ).rejects.toThrow("argumento inválido");
    expect(chamadas).toBe(1);
  });

  it("desiste depois do número de tentativas", async () => {
    let chamadas = 0;
    await expect(
      comNovasTentativas(
        async () => {
          chamadas += 1;
          throw new ErroAoIniciarProcesso("sumiu", "ENOENT");
        },
        { tentativas: 3, esperaMs: 1, sinal },
      ),
    ).rejects.toBeInstanceOf(ErroAoIniciarProcesso);
    expect(chamadas).toBe(3);
  });
});
