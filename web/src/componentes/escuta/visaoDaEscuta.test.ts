import type { SituacaoDaEscuta } from "../../shared/escuta/useEscuta";
import {
  type EstadoParaAVisao,
  type MensagemParaAVisao,
  painelVisivel,
  respostaDaEscuta,
  ultimaPerguntaForaDoCartao,
  visaoDaEscuta,
} from "./visaoDaEscuta";

function estado(alteracoes: Partial<EstadoParaAVisao> = {}): EstadoParaAVisao {
  return {
    situacao: "escutando",
    progressoDoDownload: null,
    erro: null,
    legenda: { frases: [], parcial: null },
    motor: null,
    download: null,
    ...alteracoes,
  };
}

function usuario(texto: string, origem?: "escuta"): MensagemParaAVisao {
  return { papel: "usuario", texto, situacao: "concluida", motivoDaFalha: null, ...(origem === undefined ? {} : { origem }) };
}

function claude(texto: string, situacao: MensagemParaAVisao["situacao"] = "concluida", motivoDaFalha: string | null = null) {
  const mensagem: MensagemParaAVisao = { papel: "claude", texto, situacao, motivoDaFalha };
  return mensagem;
}

describe("visaoDaEscuta", () => {
  it("a legenda vem das frases confirmadas e do parcial", () => {
    const frases = [
      { id: "f1", texto: "Bom dia.", inicioMs: 0, fimMs: 900, pergunta: false },
      { id: "f2", texto: "Qual é o prazo?", inicioMs: 900, fimMs: 2000, pergunta: true },
    ];
    const visao = visaoDaEscuta(estado({ legenda: { frases, parcial: "e o orçamento" } }), []);

    expect(visao.confirmados).toEqual(frases);
    expect(visao.parcial).toBe("e o orçamento");
  });

  it("parcial vazio vira nulo", () => {
    expect(visaoDaEscuta(estado({ legenda: { frases: [], parcial: "   " } }), []).parcial).toBeNull();
  });

  it("o motor vai sem o campo nativo", () => {
    const visao = visaoDaEscuta(
      estado({ motor: { dispositivo: "dml", modelo: "onnx-community/whisper-base", precisao: "fp16", nativo: true } }),
      [],
    );
    expect(visao.motor).toEqual({ dispositivo: "dml", modelo: "onnx-community/whisper-base", precisao: "fp16" });
  });

  it("o download com o total; sem ele, a porcentagem antiga; sem nenhum, nulo", () => {
    expect(visaoDaEscuta(estado({ download: { progresso: 45, totalMb: 199 } }), []).download).toEqual({
      progresso: 45,
      totalMb: 199,
    });
    expect(visaoDaEscuta(estado({ situacao: "baixando-modelo", progressoDoDownload: 30 }), []).download).toEqual({
      progresso: 30,
      totalMb: null,
    });
    expect(visaoDaEscuta(estado(), []).download).toBeNull();
  });

  it.each([
    ["escutando", "escutando"],
    ["pausada", "pausada"],
    ["iniciando", "iniciando"],
    ["baixando-modelo", "iniciando"],
    ["erro", "erro"],
    ["desligada", "parada"],
    ["indisponivel", "parada"],
    ["aguardando-aviso", "parada"],
  ] as const)("a situação %s vira %s", (situacao, esperada) => {
    expect(visaoDaEscuta(estado({ situacao }), []).situacao).toBe(esperada);
  });

  it("o erro passa como está", () => {
    expect(visaoDaEscuta(estado({ situacao: "erro", erro: "a captura parou" }), []).erro).toBe("a captura parou");
  });

  it("a resposta vem das mensagens do chat", () => {
    const visao = visaoDaEscuta(estado(), [usuario("Qual o prazo?", "escuta"), claude("- Sexta-feira")]);
    expect(visao.resposta).toEqual({ pergunta: "Qual o prazo?", texto: "- Sexta-feira", carregando: false });
  });
});

describe("respostaDaEscuta", () => {
  it("sem pergunta da escuta, nula (as digitadas não contam)", () => {
    expect(respostaDaEscuta([])).toBeNull();
    expect(respostaDaEscuta([usuario("Oi"), claude("Olá!")])).toBeNull();
  });

  it("a última pergunta da escuta e a resposta logo depois dela", () => {
    const resposta = respostaDaEscuta([
      usuario("Primeira?", "escuta"),
      claude("- Resposta antiga"),
      usuario("  Qual a complexidade?  ", "escuta"),
      claude("- O(n log n)"),
      usuario("Obrigado"),
      claude("De nada."),
    ]);
    expect(resposta).toEqual({ pergunta: "Qual a complexidade?", texto: "- O(n log n)", carregando: false });
  });

  it("respondendo: carregando, já com o texto parcial", () => {
    expect(respostaDaEscuta([usuario("Qual o prazo?", "escuta"), claude("- Sexta", "respondendo")])).toEqual({
      pergunta: "Qual o prazo?",
      texto: "- Sexta",
      carregando: true,
    });
  });

  it("respondendo sem texto ainda: carregando, sem texto", () => {
    expect(respostaDaEscuta([usuario("Qual o prazo?", "escuta"), claude("", "respondendo")])).toEqual({
      pergunta: "Qual o prazo?",
      texto: null,
      carregando: true,
    });
  });

  it("tira os blocos de ação do app do texto", () => {
    const resposta = respostaDaEscuta([
      usuario("Abre o projeto?", "escuta"),
      claude('Abrindo.\n\n```acao-do-app\n{"tipo":"abrir_orquestrador"}\n```'),
    ]);
    expect(resposta?.texto).toBe("Abrindo.");
  });

  it("falhou: o motivo no texto, sem carregar", () => {
    expect(respostaDaEscuta([usuario("Qual o prazo?", "escuta"), claude("", "falhou", "cota esgotada")])).toEqual({
      pergunta: "Qual o prazo?",
      texto: "A resposta falhou: cota esgotada",
      carregando: false,
    });
    expect(respostaDaEscuta([usuario("Qual o prazo?", "escuta"), claude("- Sex", "falhou")])?.texto).toBe(
      "- Sex\n\nA resposta falhou.",
    );
  });

  it("cancelada: avisa no texto", () => {
    expect(respostaDaEscuta([usuario("Qual o prazo?", "escuta"), claude("", "cancelada")])?.texto).toBe(
      "A resposta foi cancelada.",
    );
  });

  it("sem a mensagem do Claude depois: sem resposta e sem carregar", () => {
    expect(respostaDaEscuta([usuario("Qual o prazo?", "escuta")])).toEqual({
      pergunta: "Qual o prazo?",
      texto: null,
      carregando: false,
    });
  });
});

describe("painelVisivel", () => {
  it.each([
    ["indisponivel", false],
    ["desligada", false],
    ["aguardando-aviso", false],
    ["iniciando", true],
    ["baixando-modelo", true],
    ["escutando", true],
    ["pausada", true],
    ["erro", true],
  ] as [SituacaoDaEscuta, boolean][])("%s: %s", (situacao, esperado) => {
    expect(painelVisivel(situacao)).toBe(esperado);
  });
});

describe("ultimaPerguntaForaDoCartao", () => {
  const resposta = { pergunta: "Qual o prazo?", texto: "- Sexta", carregando: false };

  it("sem pergunta, nula", () => {
    expect(ultimaPerguntaForaDoCartao(null, resposta, false)).toBeNull();
    expect(ultimaPerguntaForaDoCartao("  ", null, false)).toBeNull();
  });

  it("a mesma do cartão, fora do compacto, não se repete", () => {
    expect(ultimaPerguntaForaDoCartao("Qual o prazo? ", resposta, false)).toBeNull();
  });

  it("no compacto (sem cartão), aparece", () => {
    expect(ultimaPerguntaForaDoCartao("Qual o prazo?", resposta, true)).toBe("Qual o prazo?");
  });

  it("outra pergunta (ex.: a posta no campo), aparece", () => {
    expect(ultimaPerguntaForaDoCartao("E o orçamento?", resposta, false)).toBe("E o orçamento?");
    expect(ultimaPerguntaForaDoCartao("E o orçamento?", null, false)).toBe("E o orçamento?");
  });
});
