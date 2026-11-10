import {
  ControleDeDisparos,
  INTERVALO_MINIMO_MS,
  LIMITE_DE_SIMILARIDADE,
  MAXIMO_DE_RECENTES,
  similaridadeDePalavras,
  VALIDADE_DAS_RECENTES_MS,
} from "./ControleDeDisparos";
import { PerguntaDetectada } from "./PerguntaDetectada";

const pergunta = (texto: string, detectadaEmMs = 0): PerguntaDetectada =>
  PerguntaDetectada.criar({ pergunta: texto, contexto: "", detectadaEmMs });

/** Controle que acabou de enviar `texto` em `agoraMs`. */
function enviada(texto: string, agoraMs = 0): ControleDeDisparos {
  const { decisao, controle } = ControleDeDisparos.inicial().avaliar(pergunta(texto), agoraMs, true);
  expect(decisao).toBe("enviar");
  return controle;
}

describe("ControleDeDisparos", () => {
  it("constantes combinadas com o usuário", () => {
    expect(INTERVALO_MINIMO_MS).toBe(8_000);
    expect(LIMITE_DE_SIMILARIDADE).toBe(0.8);
    expect(VALIDADE_DAS_RECENTES_MS).toBe(10 * 60_000);
  });

  it("a primeira pergunta com o chat livre é enviada e registrada", () => {
    const inicial = ControleDeDisparos.inicial();
    const { decisao, controle } = inicial.avaliar(pergunta("Qual a complexidade do quicksort?"), 5_000, true);
    expect(decisao).toBe("enviar");
    expect(controle.ultimoDisparoMs).toBe(5_000);
    expect(controle.recentes.map((r) => r.normalizada)).toEqual(["qual a complexidade do quicksort"]);
    expect(controle.pendente).toBeNull();
    expect(inicial.ultimoDisparoMs).toBeNull();
    expect(Object.isFrozen(controle)).toBe(true);
  });

  it("intervalo: 7.999 ms recusa e 8.000 ms passa", () => {
    const controle = enviada("Como inverter uma lista ligada?", 0);
    const cedo = controle.avaliar(pergunta("Explique programação dinâmica"), 7_999, true);
    expect(cedo.decisao).toBe("aguardar_intervalo");
    expect(cedo.controle.pendente?.pergunta).toBe("Explique programação dinâmica");
    expect(controle.msAteLiberar(7_999)).toBe(1);
    expect(controle.msAteLiberar(3_000)).toBe(5_000);
    expect(controle.intervaloVencido(7_999)).toBe(false);

    const naHora = controle.avaliar(pergunta("Explique programação dinâmica"), 8_000, true);
    expect(naHora.decisao).toBe("enviar");
    expect(controle.msAteLiberar(8_000)).toBe(0);
    expect(controle.intervaloVencido(8_000)).toBe(true);
  });

  it("msAteLiberar é 0 antes do primeiro envio", () => {
    expect(ControleDeDisparos.inicial().msAteLiberar(0)).toBe(0);
  });

  it("descarta a repetida exata", () => {
    const controle = enviada("Qual a complexidade do quicksort?");
    expect(controle.avaliar(pergunta("Qual a complexidade do quicksort?"), 60_000, true).decisao).toBe(
      "descartar_repetida",
    );
  });

  it("descarta a repetida com outra pontuação ou acento", () => {
    const controle = enviada("Qual é a complexidade do quicksort?");
    expect(controle.avaliar(pergunta("qual e a complexidade do QuickSort..."), 60_000, true).decisao).toBe(
      "descartar_repetida",
    );
  });

  it("descarta a parecida demais e aceita a diferente", () => {
    const controle = enviada("Como inverter uma lista ligada em Python?");
    // 7 palavras em comum de 8: Jaccard 0,875.
    expect(controle.avaliar(pergunta("Como inverter uma lista ligada em Python agora?"), 60_000, true).decisao).toBe(
      "descartar_repetida",
    );
    expect(controle.avaliar(pergunta("Qual a complexidade do merge sort?"), 60_000, true).decisao).toBe("enviar");
  });

  it("descarta a repetida da pendente", () => {
    const { controle } = ControleDeDisparos.inicial().avaliar(pergunta("Explique o event loop"), 0, false);
    const repetida = controle.avaliar(pergunta("explique o event loop!"), 1_000, false);
    expect(repetida.decisao).toBe("descartar_repetida");
    expect(repetida.controle.pendente?.pergunta).toBe("Explique o event loop");
  });

  it("chat ocupado guarda só a mais recente", () => {
    let controle = ControleDeDisparos.inicial();
    const primeira = controle.avaliar(pergunta("Explique o event loop"), 0, false);
    expect(primeira.decisao).toBe("guardar");
    controle = primeira.controle;
    const segunda = controle.avaliar(pergunta("Como funciona o garbage collector?"), 1_000, false);
    expect(segunda.decisao).toBe("guardar");
    expect(segunda.controle.pendente?.pergunta).toBe("Como funciona o garbage collector?");
    expect(segunda.controle.ultimoDisparoMs).toBeNull();
  });

  it("a pendente sai quando o chat fica livre e o intervalo vence", () => {
    let controle = enviada("Como inverter uma lista ligada?", 0);
    controle = controle.avaliar(pergunta("Explique o event loop"), 5_000, false).controle;

    const cedo = controle.retirarPendente(7_000, true);
    expect(cedo.pergunta).toBeNull();
    expect(cedo.controle).toBe(controle);

    const ocupado = controle.retirarPendente(9_000, false);
    expect(ocupado.pergunta).toBeNull();

    const livre = controle.retirarPendente(9_000, true);
    expect(livre.pergunta?.pergunta).toBe("Explique o event loop");
    expect(livre.controle.pendente).toBeNull();
    expect(livre.controle.ultimoDisparoMs).toBe(9_000);
    expect(livre.controle.recentes.map((r) => r.normalizada)).toContain("explique o event loop");

    expect(livre.controle.retirarPendente(60_000, true).pergunta).toBeNull();
  });

  it("enviar direto descarta a pendente mais antiga", () => {
    const comPendente = ControleDeDisparos.inicial().avaliar(pergunta("Explique o event loop"), 0, false).controle;
    const { decisao, controle } = comPendente.avaliar(pergunta("Qual a complexidade do heap sort?"), 1_000, true);
    expect(decisao).toBe("enviar");
    expect(controle.pendente).toBeNull();
  });

  it("esquece as recentes depois de 10 min e guarda no máximo 20", () => {
    const controle = enviada("Qual a complexidade do quicksort?", 0);
    expect(
      controle.avaliar(pergunta("Qual a complexidade do quicksort?"), VALIDADE_DAS_RECENTES_MS + 1, true).decisao,
    ).toBe("enviar");

    let cheio = ControleDeDisparos.inicial();
    for (let i = 0; i < MAXIMO_DE_RECENTES + 5; i++) {
      cheio = cheio.avaliar(pergunta(`pergunta número ${i} sobre tema ${i * 7}`), i * INTERVALO_MINIMO_MS, true).controle;
    }
    expect(cheio.recentes).toHaveLength(MAXIMO_DE_RECENTES);
    expect(cheio.recentes[0]?.normalizada).toBe("pergunta numero 5 sobre tema 35");
  });
});

describe("similaridadeDePalavras", () => {
  it("é a razão de Jaccard das palavras normalizadas", () => {
    expect(similaridadeDePalavras("Olá, mundo!", "ola mundo")).toBe(1);
    expect(similaridadeDePalavras("a b c d", "a b c e")).toBeCloseTo(3 / 5);
    expect(similaridadeDePalavras("a b", "c d")).toBe(0);
  });
});
