import { describe, expect, it } from "vitest";

import { DadosDaEtapa, MENSAGEM_DE_TEXTO_VAZIO } from "./EtapaDaRotina";
import { ErroDeRotina } from "./ErroDeRotina";
import {
  AlteracoesDaRotina,
  MENSAGEM_DE_AO_PERDER_INVALIDO,
  MENSAGEM_DE_ATIVACAO_PASSADA,
  MENSAGEM_DE_DATA_PASSADA,
  MENSAGEM_DE_ETAPAS_INVALIDAS,
  MENSAGEM_DE_NOME_INVALIDO,
  NovaRotina,
  Rotina,
} from "./Rotina";

/** Datas no relógio local (como as que o `Date` calcula), para valer em qualquer fuso. */
function local(dia: number, hora: number, minuto = 0): Date {
  return new Date(2026, 10, dia, hora, minuto, 0, 0);
}

const PEDIDO: DadosDaEtapa = { tipo: "pedido", orquestradorId: "orq-1", texto: "Rode os testes.", modo: "execucao" };

function nova(extras: Partial<NovaRotina> = {}): NovaRotina {
  return {
    id: "rot-1",
    nome: "Relatório",
    gatilho: { tipo: "diario", hora: "09:00" },
    etapas: [PEDIDO],
    agora: local(17, 8),
    ...extras,
  };
}

function erroDe(acao: () => unknown): ErroDeRotina {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeRotina) {
      return erro;
    }
    throw erro;
  }
  throw new Error("Esperava um ErroDeRotina, mas nada foi lançado.");
}

describe("Rotina: criar", () => {
  it("nasce ativa, com aoPerder conservador e a próxima execução calculada a partir de agora", () => {
    const rotina = Rotina.criar(nova());

    expect(rotina.paraDados()).toEqual({
      id: "rot-1",
      nome: "Relatório",
      ativa: true,
      gatilho: { tipo: "diario", hora: "09:00" },
      etapas: [PEDIDO],
      aoPerder: "pular",
      criadaEm: local(17, 8).toISOString(),
      ultimaExecucaoEm: null,
      proximaExecucaoEm: local(17, 9).toISOString(),
    });
  });

  it("aparar o nome; aceita aoPerder e ativa explícitos", () => {
    const rotina = Rotina.criar(nova({ nome: "  Relatório  ", aoPerder: "executar_ao_abrir", ativa: false }));

    expect(rotina.nome).toBe("Relatório");
    expect(rotina.aoPerder).toBe("executar_ao_abrir");
    expect(rotina.ativa).toBe(false);
    expect(rotina.proximaExecucaoEm).toBeNull();
  });

  it.each<[string, Partial<NovaRotina>, string]>([
    ["nome vazio", { nome: "   " }, MENSAGEM_DE_NOME_INVALIDO],
    ["nome longo demais", { nome: "x".repeat(101) }, MENSAGEM_DE_NOME_INVALIDO],
    ["nome que não é texto", { nome: 3 as unknown as string }, MENSAGEM_DE_NOME_INVALIDO],
    ["nenhuma etapa", { etapas: [] }, MENSAGEM_DE_ETAPAS_INVALIDAS],
    ["onze etapas", { etapas: Array.from({ length: 11 }, () => PEDIDO) }, MENSAGEM_DE_ETAPAS_INVALIDAS],
    ["etapas que não são lista", { etapas: "pedido" as unknown as DadosDaEtapa[] }, MENSAGEM_DE_ETAPAS_INVALIDAS],
    ["etapa inválida", { etapas: [{ ...PEDIDO, texto: " " }] }, MENSAGEM_DE_TEXTO_VAZIO],
    ["aoPerder desconhecido", { aoPerder: "sempre" as unknown as "pular" }, MENSAGEM_DE_AO_PERDER_INVALIDO],
    [
      "execução única que já passou",
      { gatilho: { tipo: "uma_vez", em: local(16, 9).toISOString() } },
      MENSAGEM_DE_DATA_PASSADA,
    ],
  ])("recusa %s", (_caso, extras, mensagem) => {
    const erro = erroDe(() => Rotina.criar(nova(extras)));

    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe(mensagem);
  });

  it("aceita de 1 a 10 etapas", () => {
    expect(Rotina.criar(nova({ etapas: [PEDIDO] })).etapas).toHaveLength(1);
    expect(Rotina.criar(nova({ etapas: Array.from({ length: 10 }, () => PEDIDO) })).etapas).toHaveLength(10);
  });

  it("uma rotina inativa com execução única passada pode existir (só não tem próxima)", () => {
    const rotina = Rotina.criar(
      nova({ ativa: false, gatilho: { tipo: "uma_vez", em: local(16, 9).toISOString() } }),
    );

    expect(rotina.proximaExecucaoEm).toBeNull();
  });

  it("as etapas são imutáveis", () => {
    const rotina = Rotina.criar(nova());

    expect(Object.isFrozen(rotina.etapas)).toBe(true);
  });
});

describe("Rotina: alterar", () => {
  it("troca só o que veio preenchido", () => {
    const rotina = Rotina.criar(nova());

    rotina.alterar({ nome: "Novo nome", aoPerder: "executar_ao_abrir" }, local(17, 8, 30));

    expect(rotina.nome).toBe("Novo nome");
    expect(rotina.aoPerder).toBe("executar_ao_abrir");
    expect(rotina.etapas).toHaveLength(1);
    expect(rotina.gatilho.paraDados()).toEqual({ tipo: "diario", hora: "09:00" });
  });

  it("uma alteração inválida não muda nada (nem o que vinha certo junto)", () => {
    const rotina = Rotina.criar(nova());
    const antes = rotina.paraDados();
    const invalidas: AlteracoesDaRotina[] = [
      { nome: "Outro", etapas: [] },
      { nome: "Outro", gatilho: { tipo: "intervalo", minutos: 5 } },
      { nome: "Outro", aoPerder: "sempre" as unknown as "pular" },
      { nome: "Outro", gatilho: { tipo: "uma_vez", em: local(16, 9).toISOString() } },
    ];

    for (const alteracoes of invalidas) {
      expect(() => rotina.alterar(alteracoes, local(17, 8, 30))).toThrow(ErroDeRotina);
      expect(rotina.paraDados()).toEqual(antes);
    }
  });

  it("trocar o gatilho recalcula a próxima execução; repetir o mesmo não mexe nela", () => {
    const rotina = Rotina.criar(nova());

    rotina.alterar({ gatilho: { tipo: "diario", hora: "09:00" } }, local(17, 8, 30));
    expect(rotina.proximaExecucaoEm).toEqual(local(17, 9));

    rotina.alterar({ gatilho: { tipo: "diario", hora: "07:00" } }, local(17, 8, 30));
    expect(rotina.proximaExecucaoEm).toEqual(local(18, 7));

    rotina.alterar({ gatilho: { tipo: "intervalo", minutos: 60 } }, local(17, 8, 30));
    expect(rotina.proximaExecucaoEm).toEqual(local(17, 9, 30));
  });

  it("numa rotina desativada, trocar o gatilho não cria agenda", () => {
    const rotina = Rotina.criar(nova({ ativa: false }));

    rotina.alterar({ gatilho: { tipo: "diario", hora: "07:00" } }, local(17, 8));

    expect(rotina.proximaExecucaoEm).toBeNull();
  });

  it("trocar para uma execução única que já passou é recusado", () => {
    const rotina = Rotina.criar(nova());

    const erro = erroDe(() => rotina.alterar({ gatilho: { tipo: "uma_vez", em: local(16, 9).toISOString() } }, local(17, 8)));

    expect(erro.message).toBe(MENSAGEM_DE_DATA_PASSADA);
  });
});

describe("Rotina: ativar e desativar", () => {
  it("desativar apaga a próxima execução; ativar recalcula a partir de agora, sem repor o que passou", () => {
    const rotina = Rotina.criar(nova());

    rotina.desativar();
    expect(rotina.ativa).toBe(false);
    expect(rotina.proximaExecucaoEm).toBeNull();

    rotina.ativar(local(19, 10));
    expect(rotina.ativa).toBe(true);
    expect(rotina.proximaExecucaoEm).toEqual(local(20, 9));
  });

  it("ativar a que já está ativa não muda nada", () => {
    const rotina = Rotina.criar(nova());

    rotina.ativar(local(19, 10));

    expect(rotina.proximaExecucaoEm).toEqual(local(17, 9));
  });

  it("não se ativa uma execução única que já passou", () => {
    const rotina = Rotina.criar(nova({ ativa: false, gatilho: { tipo: "uma_vez", em: local(16, 9).toISOString() } }));

    const erro = erroDe(() => rotina.ativar(local(17, 8)));

    expect(erro.motivo).toBe("conflito");
    expect(erro.message).toBe(MENSAGEM_DE_ATIVACAO_PASSADA);
    expect(rotina.ativa).toBe(false);
  });
});

describe("Rotina: agenda", () => {
  it("venceu quando está ativa e a hora marcada chegou; atrasoEm mede o quanto passou", () => {
    const rotina = Rotina.criar(nova());

    expect(rotina.venceu(local(17, 8, 59))).toBe(false);
    expect(rotina.atrasoEm(local(17, 8, 59))).toBe(0);
    expect(rotina.venceu(local(17, 9))).toBe(true);
    expect(rotina.atrasoEm(local(17, 9, 10))).toBe(10 * 60_000);

    rotina.desativar();
    expect(rotina.venceu(local(17, 9, 10))).toBe(false);
  });

  it("avancarAgenda parte de agora: o que passou não volta, e só uma ocorrência é consumida", () => {
    const rotina = Rotina.criar(nova({ gatilho: { tipo: "intervalo", minutos: 15 } }));

    rotina.avancarAgenda(local(17, 12));

    expect(rotina.proximaExecucaoEm).toEqual(local(17, 12, 15));
    expect(rotina.ativa).toBe(true);
  });

  it("avancarAgenda numa execução única que já passou desativa a rotina", () => {
    const rotina = Rotina.criar(nova({ gatilho: { tipo: "uma_vez", em: local(17, 9).toISOString() } }));

    rotina.avancarAgenda(local(17, 9));

    expect(rotina.proximaExecucaoEm).toBeNull();
    expect(rotina.ativa).toBe(false);
  });

  it("registrarExecucao guarda a última execução e não mexe na agenda", () => {
    const rotina = Rotina.criar(nova());

    rotina.registrarExecucao(local(17, 8, 45));

    expect(rotina.ultimaExecucaoEm).toEqual(local(17, 8, 45));
    expect(rotina.proximaExecucaoEm).toEqual(local(17, 9));
  });
});

describe("Rotina: reconstituir", () => {
  it("devolve o mesmo que foi gravado, sem recalcular a agenda", () => {
    const rotina = Rotina.criar(nova());
    rotina.registrarExecucao(local(17, 8, 45));
    const dados = rotina.paraDados();

    const reconstituida = Rotina.reconstituir({ ...dados, proximaExecucaoEm: local(30, 9).toISOString() });

    expect(reconstituida.paraDados()).toEqual({ ...dados, proximaExecucaoEm: local(30, 9).toISOString() });
  });

  it("confere as regras do domínio: dados adulterados não entram", () => {
    const dados = Rotina.criar(nova()).paraDados();

    expect(() => Rotina.reconstituir({ ...dados, nome: "" })).toThrow(ErroDeRotina);
    expect(() => Rotina.reconstituir({ ...dados, etapas: [] })).toThrow(ErroDeRotina);
    expect(() => Rotina.reconstituir({ ...dados, gatilho: { tipo: "intervalo", minutos: 1 } })).toThrow(ErroDeRotina);
  });
});
