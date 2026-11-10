import {
  ALUCINACOES_CONHECIDAS,
  avaliar,
  DetectorDePergunta,
  ehAlucinacao,
  ehAlucinacaoConhecida,
  EXPRESSOES_DE_PEDIDO,
  MINIMO_DE_PALAVRAS_DO_SINAL_FORTE,
  PALAVRAS_INTERROGATIVAS,
  sinalForte,
  TERMOS_TECNICOS,
} from "./DetectorDePergunta";

describe("DetectorDePergunta.avaliar", () => {
  it("interrogação no fim, mesmo com espaços e aspas depois", () => {
    expect(avaliar("Você já trabalhou com Kubernetes?")).toEqual({ candidata: true, motivo: "interrogacao", sinalForte: false });
    expect(avaliar('Ele disse "isso escala?"  ')).toEqual({ candidata: true, motivo: "interrogacao", sinalForte: false });
    expect(avaliar("Será? Acho que não.")).toEqual({ candidata: false, motivo: null, sinalForte: false });
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
      expect(avaliar(texto)).toEqual({ candidata: true, motivo: "pedido", sinalForte: false });
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
      expect(avaliar(texto)).toEqual({ candidata: true, motivo: "pedido", sinalForte: false });
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
      expect(avaliar(texto)).toEqual({ candidata: true, motivo: "termo_tecnico", sinalForte: false });
    }
  });

  it("casa por palavra inteira, não por pedaço de palavra", () => {
    expect(avaliar("eu criei o projeto ontem")).toEqual({ candidata: false, motivo: null, sinalForte: false });
    expect(avaliar("resolvido o problema da reunião")).toEqual({ candidata: false, motivo: null, sinalForte: false });
    expect(avaliar("o arrayzinho ficou bonito")).toEqual({ candidata: false, motivo: null, sinalForte: false });
  });

  it("conversa comum não é candidata", () => {
    expect(avaliar("Bom dia, pessoal, vamos começar a reunião.")).toEqual({ candidata: false, motivo: null, sinalForte: false });
    expect(avaliar("Ontem choveu bastante aqui em São Paulo.")).toEqual({ candidata: false, motivo: null, sinalForte: false });
  });

  it("alucinação nunca é candidata, mesmo com interrogação", () => {
    expect(avaliar("Obrigado.")).toEqual({ candidata: false, motivo: null, sinalForte: false });
    expect(avaliar("Qual?")).toEqual({ candidata: false, motivo: null, sinalForte: false });
    expect(avaliar("[Música]")).toEqual({ candidata: false, motivo: null, sinalForte: false });
  });

  it("pergunta com o sinal forte sai marcada na avaliação", () => {
    expect(avaliar("Qual a complexidade do quicksort?")).toEqual({ candidata: true, motivo: "interrogacao", sinalForte: true });
  });

  it("o objeto do serviço expõe as mesmas funções", () => {
    expect(DetectorDePergunta.avaliar).toBe(avaliar);
    expect(DetectorDePergunta.ehAlucinacao).toBe(ehAlucinacao);
    expect(DetectorDePergunta.ehAlucinacaoConhecida).toBe(ehAlucinacaoConhecida);
    expect(DetectorDePergunta.sinalForte).toBe(sinalForte);
  });
});

describe("DetectorDePergunta.sinalForte", () => {
  it("termina em ?, tem 4+ palavras e começa por palavra interrogativa, em português ou inglês", () => {
    expect(MINIMO_DE_PALAVRAS_DO_SINAL_FORTE).toBe(4);
    for (const texto of [
      "Qual a complexidade do quicksort?",
      "Como inverter uma lista ligada?",
      "Por que isso acontece aqui?",
      "O que é uma closure?",
      "Quanto tempo leva isso?",
      "Será que dá pra otimizar?",
      "What is a closure exactly?",
      "How does the event loop work?",
      "Can you explain dynamic programming?",
      "  qual é a diferença entre eles?  ",
    ]) {
      expect(sinalForte(texto)).toBe(true);
    }
  });

  it("sem o ?, com menos de 4 palavras ou sem começar por interrogativa, não é sinal forte", () => {
    for (const texto of [
      "Qual a complexidade do quicksort", // sem "?"
      "Como assim, cara?", // 3 palavras
      "Qual é?",
      "Você já trabalhou com Kubernetes?", // não começa por interrogativa
      "Me explica como inverter uma lista ligada?",
      "E como funciona um heap?",
      "Comoção geral no evento hoje?", // "como" só como pedaço de palavra
    ]) {
      expect(sinalForte(texto)).toBe(false);
    }
  });

  it("alucinação nunca é sinal forte", () => {
    expect(sinalForte("Legendas pela comunidade Amara.org, qual é?")).toBe(false);
  });

  it("a lista de interrogativas é congelada e tem português e inglês", () => {
    expect(Object.isFrozen(PALAVRAS_INTERROGATIVAS)).toBe(true);
    expect(PALAVRAS_INTERROGATIVAS).toEqual(expect.arrayContaining(["qual", "como", "por que", "what", "how"]));
  });
});

describe("DetectorDePergunta.ehAlucinacaoConhecida", () => {
  it("só as invenções conhecidas, sem a regra do texto curto (uma passada pode estar começando)", () => {
    for (const texto of ["Obrigado.", "Thanks for watching!", "[Música]", "♪", "...", "", "Legendas pela comunidade Amara.org"]) {
      expect(ehAlucinacaoConhecida(texto)).toBe(true);
    }
    expect(ehAlucinacaoConhecida("Bom")).toBe(false);
    expect(ehAlucinacao("Bom")).toBe(true);
    expect(ehAlucinacaoConhecida("la la la")).toBe(false);
    expect(ehAlucinacao("la la la")).toBe(true);
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
