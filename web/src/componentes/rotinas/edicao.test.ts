import type { DadosDaRotina } from "../../shared/api/rotinas";
import {
  emEdicao,
  etapaVazia,
  gatilhoParaOServidor,
  isoParaCampoLocal,
  paraAlteracoes,
  paraNovaRotina,
  problemaDaRotina,
  type RotinaEmEdicao,
  rotinaVazia,
} from "./edicao";

const EXISTENTES = new Set(["o1", "o2"]);
const AGORA = new Date(2026, 10, 17, 10, 0);

/** Uma rotina completa e válida, para cada teste estragar uma coisa só. */
function valida(alteracoes: Partial<RotinaEmEdicao> = {}): RotinaEmEdicao {
  return {
    nome: "Relatório",
    gatilho: { tipo: "diario", hora: "09:00", dias: [1], minutos: "60", em: "" },
    etapas: [{ chave: "a", tipo: "pedido", orquestradorId: "o1", texto: "Rode os testes", modo: "execucao" }],
    aoPerder: "pular",
    ...alteracoes,
  };
}

const problema = (rotina: RotinaEmEdicao, gatilhoSalvo?: DadosDaRotina["gatilho"]) =>
  problemaDaRotina(rotina, { orquestradoresExistentes: EXISTENTES, agora: AGORA, ...(gatilhoSalvo ? { gatilhoSalvo } : {}) });

describe("rotinaVazia", () => {
  it("começa com um pedido vazio, todo dia às 09:00 e 'pular' ao perder a hora", () => {
    const rotina = rotinaVazia();

    expect(rotina.nome).toBe("");
    expect(rotina.aoPerder).toBe("pular");
    expect(rotina.gatilho).toMatchObject({ tipo: "diario", hora: "09:00" });
    expect(rotina.etapas).toHaveLength(1);
    expect(rotina.etapas[0]).toMatchObject({ tipo: "pedido", orquestradorId: "", texto: "", modo: "execucao" });
  });

  it("cada etapa leva uma chave que não se repete", () => {
    expect(etapaVazia("espera").chave).not.toBe(etapaVazia("espera").chave);
  });
});

describe("problemaDaRotina", () => {
  it("uma rotina completa não tem problema", () => {
    expect(problema(valida())).toBeNull();
  });

  it("pede nome, de 1 a 100 caracteres", () => {
    expect(problema(valida({ nome: "   " }))).toBe("dê um nome à rotina.");
    expect(problema(valida({ nome: "a".repeat(101) }))).toMatch(/até 100 caracteres/);
  });

  it("confere a hora e os dias dos gatilhos diário e semanal", () => {
    const base = valida().gatilho;
    expect(problema(valida({ gatilho: { ...base, hora: "" } }))).toBe("escolha a hora da rotina.");
    expect(problema(valida({ gatilho: { ...base, tipo: "semanal", dias: [] } }))).toBe("escolha ao menos um dia da semana.");
    expect(problema(valida({ gatilho: { ...base, tipo: "semanal", dias: [2] } }))).toBeNull();
  });

  it("o intervalo vai de 15 a 525.600 minutos e só aceita inteiros", () => {
    const base = valida().gatilho;
    const intervalo = (minutos: string) => problema(valida({ gatilho: { ...base, tipo: "intervalo", minutos } }));

    expect(intervalo("14")).toMatch(/de 15 a 525\.600 minutos/);
    expect(intervalo("")).toMatch(/de 15 a 525\.600 minutos/);
    expect(intervalo("1.5")).toMatch(/de 15 a 525\.600 minutos/);
    expect(intervalo("525601")).toMatch(/de 15 a 525\.600 minutos/);
    expect(intervalo("15")).toBeNull();
    expect(intervalo("525600")).toBeNull();
  });

  it("a execução única precisa de um horário futuro, a não ser que seja o que já está salvo", () => {
    const base = valida().gatilho;
    const uma = (em: string) => valida({ gatilho: { ...base, tipo: "uma_vez", em } });

    expect(problema(uma(""))).toBe("escolha a data e a hora da execução única.");
    expect(problema(uma("2026-11-17T09:00"))).toBe("escolha um horário futuro para a execução única.");
    expect(problema(uma("2026-11-18T09:00"))).toBeNull();
    const salvo = { tipo: "uma_vez" as const, em: new Date(2026, 10, 17, 9, 0).toISOString() };
    expect(problema(uma("2026-11-17T09:00"), salvo)).toBeNull();
  });

  it("exige de 1 a 10 etapas", () => {
    expect(problema(valida({ etapas: [] }))).toBe("adicione ao menos uma etapa.");
    const onze = Array.from({ length: 11 }, () => etapaVazia("espera"));
    expect(problema(valida({ etapas: onze }))).toBe("use no máximo 10 etapas.");
  });

  it("o pedido precisa de orquestrador que exista e de texto de até 20.000 caracteres", () => {
    const pedido = (alteracoes: Record<string, string>) =>
      valida({ etapas: [{ chave: "a", tipo: "pedido", orquestradorId: "o1", texto: "Oi", modo: "execucao", ...alteracoes }] });

    expect(problema(pedido({ orquestradorId: "" }))).toBe("etapa 1: escolha o orquestrador que recebe o pedido.");
    expect(problema(pedido({ orquestradorId: "sumiu" }))).toBe("etapa 1: o orquestrador escolhido não existe mais; escolha outro.");
    expect(problema(pedido({ texto: "  " }))).toBe("etapa 1: escreva o pedido.");
    expect(problema(pedido({ texto: "a".repeat(20_001) }))).toMatch(/até 20\.000 caracteres/);
    expect(problema(pedido({ texto: "a".repeat(20_000) }))).toBeNull();
  });

  it("sem a lista de orquestradores ainda, não dá para dizer que o escolhido não existe", () => {
    expect(problemaDaRotina(valida(), { orquestradoresExistentes: null, agora: AGORA })).toBeNull();
  });

  it("a aprovação precisa de mensagem (até 1.000) e a espera, de 1 a 1.440 minutos", () => {
    const etapas = (...restantes: RotinaEmEdicao["etapas"]) => valida({ etapas: restantes });

    expect(problema(etapas({ chave: "a", tipo: "aprovacao", mensagem: " " }))).toBe("etapa 1: escreva a mensagem que pede a aprovação.");
    expect(problema(etapas({ chave: "a", tipo: "aprovacao", mensagem: "x".repeat(1_001) }))).toMatch(/até 1\.000 caracteres/);
    expect(problema(etapas({ chave: "a", tipo: "espera", minutos: "0" }))).toBe("etapa 1: a espera deve ser de 1 a 1.440 minutos.");
    expect(problema(etapas({ chave: "a", tipo: "espera", minutos: "1441" }))).toMatch(/1 a 1\.440 minutos/);
    expect(problema(etapas({ chave: "a", tipo: "espera", minutos: "" }))).toMatch(/1 a 1\.440 minutos/);
    expect(problema(etapas({ chave: "a", tipo: "espera", minutos: "1440" }))).toBeNull();
  });

  it("aponta a primeira etapa com problema, pelo número dela", () => {
    const rotina = valida({
      etapas: [
        { chave: "a", tipo: "espera", minutos: "5" },
        { chave: "b", tipo: "aprovacao", mensagem: "" },
      ],
    });

    expect(problema(rotina)).toMatch(/^etapa 2:/);
  });
});

describe("paraNovaRotina e paraAlteracoes", () => {
  it("monta o corpo do servidor: nome aparado, gatilho convertido, etapas e 'pular'", () => {
    const corpo = paraNovaRotina(
      valida({
        nome: "  Relatório  ",
        gatilho: { tipo: "semanal", hora: "08:30", dias: [5, 1, 5], minutos: "60", em: "" },
        etapas: [
          { chave: "a", tipo: "pedido", orquestradorId: "o1", texto: "Oi", modo: "planejamento" },
          { chave: "b", tipo: "aprovacao", mensagem: " Posso? " },
          { chave: "c", tipo: "espera", minutos: "10" },
        ],
      }),
    );

    expect(corpo).toEqual({
      nome: "Relatório",
      gatilho: { tipo: "semanal", dias: [1, 5], hora: "08:30" },
      etapas: [
        { tipo: "pedido", orquestradorId: "o1", texto: "Oi", modo: "planejamento" },
        { tipo: "aprovacao", mensagem: "Posso?" },
        { tipo: "espera", minutos: 10 },
      ],
      aoPerder: "pular",
    });
  });

  it("a execução única vai como ISO", () => {
    const gatilho = gatilhoParaOServidor({ tipo: "uma_vez", em: "2026-12-01T09:00", hora: "", dias: [], minutos: "" });

    expect(gatilho).toEqual({ tipo: "uma_vez", em: new Date(2026, 11, 1, 9, 0).toISOString() });
  });

  it("emEdicao e paraAlteracoes fazem a viagem de ida e volta: sem mudança, nada a enviar", () => {
    const salva: DadosDaRotina = {
      id: "r1",
      nome: "Relatório",
      ativa: true,
      gatilho: { tipo: "semanal", dias: [1, 3], hora: "09:00" },
      etapas: [
        { tipo: "pedido", modo: "execucao", texto: "Oi", orquestradorId: "o1" },
        { tipo: "espera", minutos: 5 },
      ],
      aoPerder: "executar_ao_abrir",
      criadaEm: "2026-11-05T12:00:00Z",
      ultimaExecucaoEm: null,
      proximaExecucaoEm: null,
    };

    expect(paraAlteracoes(emEdicao(salva), salva)).toEqual({});
  });

  it("paraAlteracoes envia só o que mudou", () => {
    const salva: DadosDaRotina = {
      id: "r1",
      nome: "Relatório",
      ativa: true,
      gatilho: { tipo: "diario", hora: "09:00" },
      etapas: [{ tipo: "espera", minutos: 5 }],
      aoPerder: "pular",
      criadaEm: "2026-11-05T12:00:00Z",
      ultimaExecucaoEm: null,
      proximaExecucaoEm: null,
    };
    const editada = emEdicao(salva);
    editada.nome = "Outro nome";
    editada.aoPerder = "executar_ao_abrir";

    expect(paraAlteracoes(editada, salva)).toEqual({ nome: "Outro nome", aoPerder: "executar_ao_abrir" });

    const outraHora = emEdicao(salva);
    outraHora.gatilho.hora = "10:00";
    expect(paraAlteracoes(outraHora, salva)).toEqual({ gatilho: { tipo: "diario", hora: "10:00" } });
  });

  it("isoParaCampoLocal escreve a hora local do jeito do datetime-local", () => {
    expect(isoParaCampoLocal(new Date(2026, 11, 1, 9, 5).toISOString())).toBe("2026-12-01T09:05");
    expect(isoParaCampoLocal("lixo")).toBe("");
  });
});
