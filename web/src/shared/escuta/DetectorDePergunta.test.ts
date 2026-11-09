import {
  ALUCINACOES_CONHECIDAS,
  avaliar,
  DetectorDePergunta,
  ehAlucinacao,
  EXPRESSOES_DE_PEDIDO,
  TERMOS_TECNICOS,
} from "./DetectorDePergunta";

describe("DetectorDePergunta.avaliar", () => {
  it("interrogação no fim, mesmo com espaços e aspas depois", () => {
    expect(avaliar("Você já trabalhou com Kubernetes?")).toEqual({ candidata: true, motivo: "interrogacao" });
    expect(avaliar('Ele disse "isso escala?"  ')).toEqual({ candidata: true, motivo: "interrogacao" });
    expect(avaliar("Será? Acho que não.")).toEqual({ candidata: false, motivo: null });
  });

  it("pedidos em português, com e sem acento, sem diferenciar maiúsculas", () => {
    for (const texto of [
      "Resolva esse exercício pra mim",
      "Agora implemente a função de cadastro",
      "EXPLICA melhor essa parte",
      "Como faço pra subir o servidor",
      "como eu faco isso no git",
      "Então qual é a melhor abordagem.",
      "o que e uma closure",
      "me ajuda aqui com esse erro",
      "a gente precisa resolver esse bug hoje",
      "crie uma tabela de usuários",
    ]) {
      expect(avaliar(texto)).toEqual({ candidata: true, motivo: "pedido" });
    }
  });

  it("pedidos em inglês", () => {
    for (const texto of [
      "Solve this one for me",
      "Please implement the cache layer",
      "how does the event loop work",
      "What's the difference here",
      "what is a closure",
      "Can you walk me through it",
      "Write a function that returns the sum",
    ]) {
      expect(avaliar(texto)).toEqual({ candidata: true, motivo: "pedido" });
    }
  });

  it("termos técnicos de entrevista", () => {
    for (const texto of [
      "esse é um problema clássico do LeetCode",
      "temos um array de inteiros ordenado",
      "isso roda em O de N no pior caso",
      "dá pra usar programação dinâmica aqui",
      "a árvore binária precisa estar balanceada",
      "the classic two sum problem",
    ]) {
      expect(avaliar(texto)).toEqual({ candidata: true, motivo: "termo_tecnico" });
    }
  });

  it("casa por palavra inteira, não por pedaço de palavra", () => {
    expect(avaliar("eu criei o projeto ontem")).toEqual({ candidata: false, motivo: null });
    expect(avaliar("resolvido o problema da reunião")).toEqual({ candidata: false, motivo: null });
    expect(avaliar("o arrayzinho ficou bonito")).toEqual({ candidata: false, motivo: null });
  });

  it("conversa comum não é candidata", () => {
    expect(avaliar("Bom dia, pessoal, vamos começar a reunião.")).toEqual({ candidata: false, motivo: null });
    expect(avaliar("Ontem choveu bastante aqui em São Paulo.")).toEqual({ candidata: false, motivo: null });
  });

  it("alucinação nunca é candidata, mesmo com interrogação", () => {
    expect(avaliar("Obrigado.")).toEqual({ candidata: false, motivo: null });
    expect(avaliar("Qual?")).toEqual({ candidata: false, motivo: null });
    expect(avaliar("[Música]")).toEqual({ candidata: false, motivo: null });
  });

  it("o objeto do serviço expõe as mesmas funções", () => {
    expect(DetectorDePergunta.avaliar).toBe(avaliar);
    expect(DetectorDePergunta.ehAlucinacao).toBe(ehAlucinacao);
  });
});

describe("DetectorDePergunta.ehAlucinacao", () => {
  it("reconhece o que o Whisper inventa em silêncio ou música", () => {
    for (const texto of [
      "Obrigado.",
      "Obrigada.",
      "Legendas pela comunidade Amara.org",
      "Thank you.",
      "Thanks for watching!",
      "Inscreva-se",
      "♪",
      "♪ la la la ♪",
      "[Música]",
      "(música)",
      "you",
      "...",
      "",
    ]) {
      expect(ehAlucinacao(texto)).toBe(true);
    }
  });

  it("créditos de legenda no meio de outro texto também", () => {
    expect(ehAlucinacao("Legendas pela comunidade Amara.org e mais nada")).toBe(true);
  });

  it("fala de verdade não é alucinação", () => {
    expect(ehAlucinacao("Obrigado pela explicação, ficou claro.")).toBe(false);
    expect(ehAlucinacao("[Música] Qual a complexidade disso?")).toBe(false);
    expect(ehAlucinacao("thank you for the question")).toBe(false);
  });

  it("as listas são constantes congeladas", () => {
    expect(Object.isFrozen(EXPRESSOES_DE_PEDIDO)).toBe(true);
    expect(Object.isFrozen(TERMOS_TECNICOS)).toBe(true);
    expect(Object.isFrozen(ALUCINACOES_CONHECIDAS)).toBe(true);
  });
});
