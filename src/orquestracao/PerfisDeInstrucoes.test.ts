import { describe, expect, it } from "vitest";

import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { TAMANHO_MAXIMO_DAS_INSTRUCOES } from "./InstrucoesPersonalizadas";
import { MAXIMO_DE_PERFIS_DE_INSTRUCOES, perfisDeInstrucoesValidos } from "./PerfisDeInstrucoes";
import { PreferenciasGlobais } from "./PreferenciasGlobais";

const revisao = { nome: "Revisão", texto: "Revise o diff antes de concluir." };

function mensagemDe(erro: () => unknown): string {
  try {
    erro();
  } catch (falha) {
    expect(falha).toBeInstanceOf(ErroDeOrquestracao);
    return (falha as ErroDeOrquestracao).message;
  }
  throw new Error("deveria ter recusado");
}

describe("perfisDeInstrucoesValidos", () => {
  it("ausente vale lista vazia", () => {
    expect(perfisDeInstrucoesValidos(undefined)).toEqual([]);
    expect(perfisDeInstrucoesValidos(null)).toEqual([]);
  });

  it("normaliza: nome numa linha e aparado, texto como as instruções personalizadas", () => {
    expect(perfisDeInstrucoesValidos([{ nome: "  Backend\n Nest ", texto: "  Use Jest.  \r\n\r\n\r\n\r\nFim " }])).toEqual([
      { nome: "Backend Nest", texto: "Use Jest.\n\nFim" },
    ]);
  });

  it("aceita o texto no limite das instruções", () => {
    const [perfil] = perfisDeInstrucoesValidos([{ nome: "Longo", texto: "x".repeat(TAMANHO_MAXIMO_DAS_INSTRUCOES) }]);
    expect(perfil?.texto).toHaveLength(TAMANHO_MAXIMO_DAS_INSTRUCOES);
  });

  it.each<[unknown, string]>([
    [{ ...revisao, nome: " " }, "Dê um nome ao perfil de instruções 1."],
    [{ ...revisao, nome: 3 }, "O nome do perfil de instruções 1 deve ser um texto."],
    [{ ...revisao, nome: "n".repeat(41) }, `O nome do perfil "${"n".repeat(41)}" deve ter até 40 caracteres.`],
    [{ ...revisao, texto: " \n " }, 'Preencha o texto do perfil "Revisão".'],
    [{ nome: "Revisão" }, 'O texto do perfil "Revisão" deve ser um texto.'],
    [
      { ...revisao, texto: "x".repeat(TAMANHO_MAXIMO_DAS_INSTRUCOES + 1) },
      'O texto do perfil "Revisão" deve ter até 4000 caracteres (hoje tem 4001).',
    ],
    ["Revisão", "O perfil de instruções 1 é inválido."],
  ])("recusa %j", (perfil, mensagem) => {
    expect(mensagemDe(() => perfisDeInstrucoesValidos([perfil]))).toBe(mensagem);
  });

  it("recusa o que não é lista, nomes repetidos (sem diferenciar maiúsculas) e mais que o máximo", () => {
    expect(mensagemDe(() => perfisDeInstrucoesValidos("Revisão"))).toBe("Os perfis de instruções devem ser uma lista.");
    expect(mensagemDe(() => perfisDeInstrucoesValidos([revisao, { ...revisao, nome: " revisão " }]))).toBe(
      'Já existe um perfil de instruções chamado "revisão".',
    );
    const muitos = Array.from({ length: MAXIMO_DE_PERFIS_DE_INSTRUCOES + 1 }, (_, i) => ({ ...revisao, nome: `p${i}` }));
    expect(mensagemDe(() => perfisDeInstrucoesValidos(muitos))).toBe("São no máximo 20 perfis de instruções.");
  });
});

describe("PreferenciasGlobais.perfisDeInstrucoes", () => {
  it("vazias e arquivos antigos não têm perfis; com() troca a lista inteira e mantém o resto", () => {
    expect(PreferenciasGlobais.vazias().perfisDeInstrucoes).toEqual([]);
    expect(PreferenciasGlobais.de({ instrucoesPadrao: "X", subagentesProntos: [] }).perfisDeInstrucoes).toEqual([]);

    const preferencias = PreferenciasGlobais.vazias().com({ instrucoesPadrao: "X", perfisDeInstrucoes: [revisao] });
    expect(preferencias.perfisDeInstrucoes).toEqual([revisao]);
    expect(preferencias.com({ instrucoesPadrao: "Y" }).perfisDeInstrucoes).toEqual([revisao]);
    expect(preferencias.com({ perfisDeInstrucoes: [] }).paraDados()).toEqual({
      instrucoesPadrao: "X",
      subagentesProntos: [],
      perfisDeInstrucoes: [],
      autorrecuperacao: true,
    });
  });

  it("com() recusa perfis inválidos sem mudar o que havia", () => {
    const preferencias = PreferenciasGlobais.vazias().com({ perfisDeInstrucoes: [revisao] });
    expect(() => preferencias.com({ perfisDeInstrucoes: [revisao, revisao] })).toThrow(ErroDeOrquestracao);
    expect(preferencias.perfisDeInstrucoes).toEqual([revisao]);
  });
});
