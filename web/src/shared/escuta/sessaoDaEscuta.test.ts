import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErroDaApi } from "../api/cliente";
import type { ClassificacaoDaEscuta, PedidoDeClassificacaoDaEscuta } from "../api/tipos";
import { type OpcoesDaTranscricao, TranscricaoDescartada } from "../ditado/transcritor";
import type { CapturaDoAudio, OuvintesDaCaptura } from "./capturaDoAudio";
import { ControleDeDisparos } from "./ControleDeDisparos";
import { mensagemDaEscuta } from "./mensagemDaEscuta";
import { PerguntaDetectada } from "./PerguntaDetectada";
import type { ArmazenamentoDasPreferencias, PreferenciasDaEscuta } from "./preferenciasDaEscuta";
import { controleSemPendente, ESPERA_PARA_DESLIGAR_MS, SessaoDaEscuta } from "./sessaoDaEscuta";
import type { OpcoesDaEscuta } from "./useEscuta";

/** 1 s de "voz" (energia constante) seguido de 1 s de silêncio: o cortador entrega um trecho. */
const VOZ = new Float32Array(16_000).fill(0.3);
const SILENCIO = new Float32Array(16_000);

type Transcricao = { resolver: (texto: string) => void; rejeitar: (erro: Error) => void; aoBaixar?: (p: number) => void };

function montar(
  opcoes: { avisoVisto?: boolean; automatico?: boolean; automaticoManual?: boolean; falhaNaCaptura?: Error } = {},
) {
  let preferencias: PreferenciasDaEscuta = {
    automatico: opcoes.automatico ?? true,
    automaticoManual: opcoes.automaticoManual ?? false,
    avisoVisto: opcoes.avisoVisto ?? true,
  };
  const armazenamento: ArmazenamentoDasPreferencias = {
    ler: () => preferencias,
    gravar: vi.fn((novas: PreferenciasDaEscuta) => {
      preferencias = novas;
    }),
  };

  const capturas: { ouvintes: OuvintesDaCaptura; parar: ReturnType<typeof vi.fn> }[] = [];
  const iniciarCaptura = vi.fn(async (ouvintes: OuvintesDaCaptura): Promise<CapturaDoAudio> => {
    if (opcoes.falhaNaCaptura !== undefined) throw opcoes.falhaNaCaptura;
    const parar = vi.fn();
    capturas.push({ ouvintes, parar });
    return { parar };
  });

  /** Textos que o Whisper falso devolve, na ordem; sem texto na fila, a transcrição fica pendente. */
  const textos: (string | Error)[] = [];
  const pendentes: Transcricao[] = [];
  const transcrever = vi.fn<
    (audio: Float32Array, aoBaixar?: (p: number) => void, opcoes?: OpcoesDaTranscricao) => Promise<string>
  >(
    (...[, aoBaixar]) =>
      new Promise<string>((resolver, rejeitar) => {
        const proximo = textos.shift();
        if (proximo === undefined) pendentes.push({ resolver, rejeitar, aoBaixar });
        else if (proximo instanceof Error) rejeitar(proximo);
        else resolver(proximo);
      }),
  );

  const respostas: (ClassificacaoDaEscuta | Error)[] = [];
  const classificar = vi.fn<(pedido: PedidoDeClassificacaoDaEscuta) => Promise<ClassificacaoDaEscuta>>(async () => {
    const resposta = respostas.shift() ?? { ehPergunta: false, pergunta: null };
    if (resposta instanceof Error) throw resposta;
    return resposta;
  });

  const enviar = vi.fn<(texto: string) => Promise<void>>(async () => undefined);
  const preencherComposer = vi.fn<(texto: string) => void>();

  const sessao = new SessaoDaEscuta({
    iniciarCaptura,
    transcrever,
    classificar,
    agora: () => Date.now(),
    preferencias: armazenamento,
  });

  let atuais: OpcoesDaEscuta = {
    modoInvisivelAtivo: false,
    escutaManualLigada: false,
    escutaDisponivel: true,
    chatLivre: true,
    autorizacaoAtiva: false,
    enviar,
    preencherComposer,
  };
  const opcoesDaTela = (mudanca: Partial<OpcoesDaEscuta>) => {
    atuais = { ...atuais, ...mudanca };
    sessao.atualizarOpcoes(atuais);
  };

  const ultimaCaptura = () => {
    const captura = capturas.at(-1);
    if (captura === undefined) throw new Error("nenhuma captura iniciada");
    return captura;
  };

  /** Toca um trecho de fala na captura atual e deixa a transcrição e a classificação andarem. */
  const falar = async (texto: string) => {
    textos.push(texto);
    const { ouvintes } = ultimaCaptura();
    ouvintes.aoReceberAmostras(VOZ);
    ouvintes.aoReceberAmostras(SILENCIO);
    await vi.advanceTimersByTimeAsync(0);
  };

  const entrar = async () => {
    opcoesDaTela({ modoInvisivelAtivo: true });
    await vi.advanceTimersByTimeAsync(0);
  };

  return {
    sessao,
    armazenamento,
    preferencias: () => preferencias,
    iniciarCaptura,
    capturas,
    ultimaCaptura,
    transcrever,
    textos,
    pendentes,
    classificar,
    respostas,
    enviar,
    preencherComposer,
    opcoesDaTela,
    falar,
    entrar,
  };
}

const PERGUNTA = "Como inverter uma lista ligada?";
const pergunta = (texto: string): ClassificacaoDaEscuta => ({ ehPergunta: true, pergunta: texto });

describe("SessaoDaEscuta", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("começa indisponível e fica desligada fora do modo invisível", () => {
    const t = montar();
    expect(t.sessao.instantaneo().situacao).toBe("indisponivel");
    t.opcoesDaTela({});
    expect(t.sessao.instantaneo().situacao).toBe("desligada");
    t.opcoesDaTela({ modoInvisivelAtivo: true, escutaDisponivel: false });
    expect(t.sessao.instantaneo().situacao).toBe("indisponivel");
    expect(t.iniciarCaptura).not.toHaveBeenCalled();
  });

  it("candidata → classificação → envio do texto de mensagemDaEscuta", async () => {
    const t = montar();
    await t.entrar();
    expect(t.sessao.instantaneo().situacao).toBe("escutando");

    t.respostas.push(pergunta(PERGUNTA));
    await t.falar("Me explica como inverter uma lista ligada?");

    expect(t.transcrever).toHaveBeenCalledWith(expect.any(Float32Array), expect.any(Function), {
      idioma: "automatico",
      origem: "escuta",
    });
    expect(t.classificar).toHaveBeenCalledWith({ trecho: "Me explica como inverter uma lista ligada?" }, expect.any(AbortSignal));
    const esperada = mensagemDaEscuta(
      PerguntaDetectada.criar({
        pergunta: PERGUNTA,
        contexto: "Me explica como inverter uma lista ligada?",
        detectadaEmMs: Date.now(),
      }),
    );
    expect(t.enviar).toHaveBeenCalledWith(esperada);
    expect(t.sessao.instantaneo().ultimaPergunta).toBe(PERGUNTA);
    expect(t.sessao.instantaneo().linhas).toEqual(["Me explica como inverter uma lista ligada?"]);
  });

  it("manda à classificação o contexto dos 60 s anteriores ao trecho", async () => {
    const t = montar();
    await t.entrar();
    await t.falar("Vamos falar de estruturas de dados hoje.");
    await t.falar("Qual a complexidade da busca binária?");
    expect(t.classificar).toHaveBeenLastCalledWith(
      { trecho: "Qual a complexidade da busca binária?", contexto: "Vamos falar de estruturas de dados hoje." },
      expect.any(AbortSignal),
    );
  });

  it("com alterações autorizadas, a pergunta vai para o campo de mensagem, não é enviada", async () => {
    const t = montar();
    t.opcoesDaTela({ autorizacaoAtiva: true });
    await t.entrar();
    t.respostas.push(pergunta(PERGUNTA));
    await t.falar("Me explica como inverter uma lista ligada?");
    expect(t.enviar).not.toHaveBeenCalled();
    expect(t.preencherComposer).toHaveBeenCalledWith(expect.stringContaining(PERGUNTA));
    expect(t.sessao.instantaneo().ultimaPergunta).toBe(PERGUNTA);
  });

  it("409 no envio: a pergunta volta a ser a pendente e sai quando o chat fica livre", async () => {
    const t = montar();
    await t.entrar();
    t.enviar.mockRejectedValueOnce(new ErroDaApi("O chat está respondendo.", 409));
    t.respostas.push(pergunta(PERGUNTA));
    await t.falar("Me explica como inverter uma lista ligada?");
    expect(t.enviar).toHaveBeenCalledTimes(1);
    expect(t.sessao.instantaneo().erro).toBeNull();

    t.opcoesDaTela({ chatLivre: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.enviar).toHaveBeenCalledTimes(1);

    t.opcoesDaTela({ chatLivre: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.enviar).toHaveBeenCalledTimes(2);
    expect(t.enviar.mock.calls[1]?.[0]).toBe(t.enviar.mock.calls[0]?.[0]);
  });

  it("409 sem a tela perceber o chat ocupado: tenta de novo depois de uma espera, não em laço", async () => {
    const t = montar();
    await t.entrar();
    t.enviar.mockRejectedValueOnce(new ErroDaApi("ocupado", 409));
    t.respostas.push(pergunta(PERGUNTA));
    await t.falar("Me explica como inverter uma lista ligada?");
    expect(t.enviar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(t.enviar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.enviar).toHaveBeenCalledTimes(2);
  });

  it("chat ocupado: guarda só a mais recente e envia quando ele fica livre", async () => {
    const t = montar();
    t.opcoesDaTela({ chatLivre: false });
    await t.entrar();
    t.respostas.push(pergunta("Qual a complexidade do quicksort?"), pergunta("Como funciona um heap?"));
    await t.falar("Qual a complexidade do quicksort?");
    await t.falar("E como funciona um heap?");
    expect(t.enviar).not.toHaveBeenCalled();

    t.opcoesDaTela({ chatLivre: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.enviar).toHaveBeenCalledTimes(1);
    expect(t.enviar.mock.calls[0]?.[0]).toContain("Como funciona um heap?");
  });

  it("respeita o intervalo de 20 s entre envios", async () => {
    const t = montar();
    await t.entrar();
    t.respostas.push(pergunta("Qual a complexidade do quicksort?"), pergunta("Como funciona um heap?"));
    await t.falar("Qual a complexidade do quicksort?");
    expect(t.enviar).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    await t.falar("E como funciona um heap?");
    expect(t.enviar).toHaveBeenCalledTimes(1);

    // O relógio falso só anda com os timers: o primeiro envio foi há 3 s; faltam 17 s.
    await vi.advanceTimersByTimeAsync(16_000);
    expect(t.enviar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.enviar).toHaveBeenCalledTimes(2);
    expect(t.enviar.mock.calls[1]?.[0]).toContain("Como funciona um heap?");
  });

  it("descarta a pergunta repetida", async () => {
    const t = montar();
    await t.entrar();
    t.respostas.push(pergunta(PERGUNTA), pergunta(PERGUNTA));
    await t.falar("Me explica como inverter uma lista ligada?");
    await vi.advanceTimersByTimeAsync(30_000);
    await t.falar("Me explica como inverter uma lista ligada?");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.enviar).toHaveBeenCalledTimes(1);
  });

  it("com o automático desligado, só transcreve: nada é classificado nem enviado", async () => {
    const t = montar();
    await t.entrar();
    t.sessao.alternarAutomatico();
    expect(t.sessao.instantaneo().automatico).toBe(false);
    expect(t.preferencias().automatico).toBe(false);

    await t.falar("Qual a complexidade da busca binária?");
    expect(t.sessao.instantaneo().linhas).toEqual(["Qual a complexidade da busca binária?"]);
    expect(t.classificar).not.toHaveBeenCalled();
    expect(t.enviar).not.toHaveBeenCalled();
  });

  it("a escuta manual liga a escuta fora do modo invisível, com o automático desligado de início", async () => {
    const t = montar();
    t.opcoesDaTela({ escutaManualLigada: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sessao.instantaneo()).toMatchObject({ situacao: "escutando", automatico: false });

    // Sem o automático da escuta manual, só transcreve.
    t.respostas.push(pergunta(PERGUNTA));
    await t.falar("Me explica como inverter uma lista ligada?");
    expect(t.classificar).not.toHaveBeenCalled();
    expect(t.sessao.instantaneo().linhas).toEqual(["Me explica como inverter uma lista ligada?"]);

    t.opcoesDaTela({ escutaManualLigada: false });
    await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS);
    expect(t.sessao.instantaneo().situacao).toBe("desligada");
  });

  it("escutaManualLigada sem escuta disponível não escuta", async () => {
    const t = montar();
    t.opcoesDaTela({ escutaManualLigada: true, escutaDisponivel: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sessao.instantaneo().situacao).toBe("indisponivel");
    expect(t.iniciarCaptura).not.toHaveBeenCalled();
  });

  it("o automático é separado por contexto, e o modo invisível tem prioridade", async () => {
    const t = montar();
    t.opcoesDaTela({ escutaManualLigada: true });
    t.sessao.alternarAutomatico();
    expect(t.sessao.instantaneo().automatico).toBe(true);
    expect(t.preferencias()).toMatchObject({ automatico: true, automaticoManual: true });

    // No modo invisível vale a preferência dele; alternar mexe só nela.
    t.opcoesDaTela({ modoInvisivelAtivo: true });
    t.sessao.alternarAutomatico();
    expect(t.sessao.instantaneo().automatico).toBe(false);
    expect(t.preferencias()).toMatchObject({ automatico: false, automaticoManual: true });

    // Com o modo invisível ligado junto da manual, o automático da manual não classifica por ele.
    t.opcoesDaTela({ modoInvisivelAtivo: false });
    expect(t.sessao.instantaneo().automatico).toBe(true);
  });

  it("a escuta manual com o automático ligado classifica e envia", async () => {
    const t = montar({ automaticoManual: true });
    t.opcoesDaTela({ escutaManualLigada: true });
    await vi.advanceTimersByTimeAsync(0);
    t.respostas.push(pergunta(PERGUNTA));
    await t.falar("Me explica como inverter uma lista ligada?");
    expect(t.enviar).toHaveBeenCalledTimes(1);
  });

  it("o aviso da primeira vez vale também para a escuta manual", async () => {
    const t = montar({ avisoVisto: false });
    t.opcoesDaTela({ escutaManualLigada: true });
    expect(t.sessao.instantaneo().situacao).toBe("aguardando-aviso");
    expect(t.iniciarCaptura).not.toHaveBeenCalled();
  });

  it("trechos finais vão para a conversa, ficam ao desligar e só limparTrechos os apaga", async () => {
    const t = montar();
    await t.entrar();
    await t.falar("Bom dia a todos, vamos começar.");
    await t.falar("Hoje falamos de listas ligadas.");
    const { trechos } = t.sessao.instantaneo();
    expect(trechos.map((x) => x.texto)).toEqual(["Bom dia a todos, vamos começar.", "Hoje falamos de listas ligadas."]);
    expect(new Set(trechos.map((x) => x.id)).size).toBe(2);
    expect(trechos[0]?.inicioMs).toBeGreaterThanOrEqual(1_000_000);
    expect(trechos[0]?.fimMs).toBeGreaterThan(trechos[0]?.inicioMs ?? 0);

    t.opcoesDaTela({ modoInvisivelAtivo: false });
    await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS);
    expect(t.sessao.instantaneo()).toMatchObject({ situacao: "desligada", linhas: [] });
    expect(t.sessao.instantaneo().trechos).toHaveLength(2);

    t.sessao.limparTrechos();
    expect(t.sessao.instantaneo().trechos).toEqual([]);
  });

  it("guarda no máximo 200 trechos: os mais antigos saem", async () => {
    const t = montar();
    await t.entrar();
    for (let i = 0; i < 202; i++) await t.falar(`Trecho número ${i} da aula de hoje.`);
    const { trechos } = t.sessao.instantaneo();
    expect(trechos).toHaveLength(200);
    expect(trechos[0]?.texto).toBe("Trecho número 2 da aula de hoje.");
  });

  describe("transcrição provisória", () => {
    /** 1,5 s de voz seguida (o trecho continua aberto): pede a provisória. */
    const falarSemFechar = async (t: ReturnType<typeof montar>) => {
      const { ouvintes } = t.ultimaCaptura();
      ouvintes.aoReceberAmostras(VOZ);
      ouvintes.aoReceberAmostras(VOZ.subarray(0, 8_000));
      await vi.advanceTimersByTimeAsync(0);
    };
    const provisorias = (t: ReturnType<typeof montar>) =>
      t.transcrever.mock.calls.filter(([, , opcoes]) => opcoes?.provisoria === true);

    it("a cada 1,5 s de áudio novo pede o texto provisório, que vai para linhaProvisoria", async () => {
      const t = montar();
      await t.entrar();
      t.textos.push("Me explica como");
      await falarSemFechar(t);

      expect(provisorias(t)).toHaveLength(1);
      expect(t.transcrever).toHaveBeenCalledWith(expect.any(Float32Array), undefined, {
        idioma: "automatico",
        origem: "escuta",
        provisoria: true,
      });
      expect(t.sessao.instantaneo().linhaProvisoria).toBe("Me explica como");
      expect(t.sessao.instantaneo().trechos).toEqual([]);
      expect(t.sessao.instantaneo().linhas).toEqual([]);
      expect(t.classificar).not.toHaveBeenCalled();
    });

    it("no máximo uma provisória em voo: com uma rodando, as seguintes são puladas", async () => {
      const t = montar();
      await t.entrar();
      await falarSemFechar(t); // fica pendente
      await falarSemFechar(t);
      await falarSemFechar(t);
      expect(provisorias(t)).toHaveLength(1);

      t.pendentes.shift()?.resolver("primeira");
      await vi.advanceTimersByTimeAsync(0);
      await falarSemFechar(t);
      expect(provisorias(t)).toHaveLength(2);
    });

    it("o trecho final troca a provisória pelo trecho definitivo e só ele classifica", async () => {
      const t = montar({ automatico: true });
      await t.entrar();
      t.textos.push("Me explica como inverter");
      await falarSemFechar(t);
      expect(t.sessao.instantaneo().linhaProvisoria).toBe("Me explica como inverter");

      t.respostas.push(pergunta(PERGUNTA));
      t.textos.push("Me explica como inverter uma lista ligada?");
      t.ultimaCaptura().ouvintes.aoReceberAmostras(SILENCIO);
      await vi.advanceTimersByTimeAsync(0);

      const estado = t.sessao.instantaneo();
      expect(estado.linhaProvisoria).toBeNull();
      expect(estado.trechos.map((x) => x.texto)).toEqual(["Me explica como inverter uma lista ligada?"]);
      expect(t.classificar).toHaveBeenCalledTimes(1);
      expect(t.classificar).toHaveBeenCalledWith({ trecho: "Me explica como inverter uma lista ligada?" }, expect.any(AbortSignal));
    });

    it("provisória atrasada, de trecho já fechado, é ignorada", async () => {
      const t = montar();
      await t.entrar();
      await falarSemFechar(t); // provisória pendente
      t.textos.push("Texto final do trecho.");
      t.ultimaCaptura().ouvintes.aoReceberAmostras(SILENCIO);
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sessao.instantaneo().trechos).toHaveLength(1);

      t.pendentes.shift()?.resolver("texto provisório velho");
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sessao.instantaneo().linhaProvisoria).toBeNull();
    });

    it("provisória de uma captura anterior (geração antiga) é ignorada", async () => {
      const t = montar();
      await t.entrar();
      await falarSemFechar(t);
      t.sessao.pausar();
      t.pendentes.shift()?.resolver("texto velho");
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sessao.instantaneo().linhaProvisoria).toBeNull();
    });

    it("provisória descartada ou com falha não gera erro na tela", async () => {
      const t = montar();
      await t.entrar();
      t.textos.push(new TranscricaoDescartada());
      await falarSemFechar(t);
      expect(t.sessao.instantaneo()).toMatchObject({ linhaProvisoria: null, erro: null });
    });

    it("a provisória não classifica nem entra nos trechos mesmo com o automático ligado", async () => {
      const t = montar({ automatico: true });
      await t.entrar();
      t.textos.push("Qual a complexidade da busca binária?");
      await falarSemFechar(t);
      expect(t.classificar).not.toHaveBeenCalled();
      expect(t.sessao.instantaneo().trechos).toEqual([]);
    });
  });

  it("desligar o automático durante a classificação não envia a resposta dela", async () => {
    const t = montar();
    await t.entrar();
    let responder: (resposta: ClassificacaoDaEscuta) => void = () => undefined;
    t.classificar.mockImplementationOnce(
      () => new Promise<ClassificacaoDaEscuta>((resolver) => {
        responder = resolver;
      }),
    );
    await t.falar("Qual a complexidade da busca binária?");
    t.sessao.alternarAutomatico();
    responder(pergunta("Qual a complexidade da busca binária?"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.enviar).not.toHaveBeenCalled();
  });

  it("alucinação do Whisper é descartada", async () => {
    const t = montar();
    await t.entrar();
    await t.falar("Obrigado.");
    await t.falar("   ");
    expect(t.sessao.instantaneo().linhas).toEqual([]);
    expect(t.classificar).not.toHaveBeenCalled();
  });

  it("uma candidata nova durante a classificação substitui a que esperava", async () => {
    const t = montar();
    await t.entrar();
    let responder: (resposta: ClassificacaoDaEscuta) => void = () => undefined;
    t.classificar.mockImplementationOnce(
      () => new Promise<ClassificacaoDaEscuta>((resolver) => {
        responder = resolver;
      }),
    );
    await t.falar("Qual a complexidade do quicksort?");
    await t.falar("O que é um heap?");
    await t.falar("O que é uma trie?");
    expect(t.classificar).toHaveBeenCalledTimes(1);

    responder({ ehPergunta: false, pergunta: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.classificar).toHaveBeenCalledTimes(2);
    expect(t.classificar.mock.calls[1]?.[0].trecho).toBe("O que é uma trie?");
  });

  it("erro na classificação aparece e a escuta continua, sem tentar a que esperava em seguida", async () => {
    const t = montar();
    await t.entrar();
    t.respostas.push(new ErroDaApi("O Claude Code não respondeu.", 502));
    await t.falar("Qual a complexidade do quicksort?");
    const estado = t.sessao.instantaneo();
    expect(estado.erro).toBe("A escuta não conseguiu avaliar a pergunta: O Claude Code não respondeu.");
    expect(estado.situacao).toBe("escutando");

    t.sessao.descartarErro();
    t.respostas.push(pergunta("O que é um heap?"));
    await t.falar("O que é um heap?");
    expect(t.enviar).toHaveBeenCalledTimes(1);
  });

  it("erro no envio aparece e a escuta continua", async () => {
    const t = montar();
    await t.entrar();
    t.enviar.mockRejectedValueOnce(new ErroDaApi("Falha interna.", 500));
    t.respostas.push(pergunta(PERGUNTA));
    await t.falar("Me explica como inverter uma lista ligada?");
    expect(t.sessao.instantaneo().erro).toBe("A pergunta da escuta não foi enviada: Falha interna.");
    expect(t.sessao.instantaneo().situacao).toBe("escutando");
  });

  it("transcrição descartada pela fila é ignorada em silêncio", async () => {
    const t = montar();
    await t.entrar();
    t.transcrever.mockRejectedValueOnce(new TranscricaoDescartada());
    const { ouvintes } = t.ultimaCaptura();
    ouvintes.aoReceberAmostras(VOZ);
    ouvintes.aoReceberAmostras(SILENCIO);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sessao.instantaneo().erro).toBeNull();
  });

  it("mostra o download do modelo enquanto a primeira transcrição espera", async () => {
    const t = montar();
    await t.entrar();
    const { ouvintes } = t.ultimaCaptura();
    ouvintes.aoReceberAmostras(VOZ);
    ouvintes.aoReceberAmostras(SILENCIO);
    const pendente = t.pendentes[0];
    if (pendente === undefined) throw new Error("sem transcrição pendente");
    pendente.aoBaixar?.(42.4);
    expect(t.sessao.instantaneo()).toMatchObject({ situacao: "baixando-modelo", progressoDoDownload: 42 });
    pendente.resolver("Bom dia a todos.");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sessao.instantaneo()).toMatchObject({ situacao: "escutando", progressoDoDownload: null });
  });

  it("sair do modo para tudo: captura, transcrição em memória e envios", async () => {
    const t = montar();
    await t.entrar();
    await t.falar("Bom dia a todos, vamos começar.");
    const captura = t.ultimaCaptura();

    t.opcoesDaTela({ modoInvisivelAtivo: false });
    expect(t.sessao.instantaneo().situacao).toBe("desligada");
    // Áudio que chega na espera para desligar não é ouvido.
    t.textos.push("Isto não deveria ser transcrito.");
    captura.ouvintes.aoReceberAmostras(VOZ);
    captura.ouvintes.aoReceberAmostras(SILENCIO);
    expect(t.transcrever).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS);
    expect(captura.parar).toHaveBeenCalled();
    expect(t.sessao.instantaneo()).toMatchObject({ situacao: "desligada", linhas: [], erro: null, ultimaPergunta: null });
  });

  it("voltar ao modo antes da espera (remontagem do chat) mantém a mesma captura", async () => {
    const t = montar();
    await t.entrar();
    t.opcoesDaTela({ modoInvisivelAtivo: false });
    await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS / 2);
    await t.entrar();
    await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS);
    expect(t.iniciarCaptura).toHaveBeenCalledTimes(1);
    expect(t.ultimaCaptura().parar).not.toHaveBeenCalled();
    expect(t.sessao.instantaneo().situacao).toBe("escutando");
  });

  it("na primeira vez, o aviso bloqueia a captura até ser confirmado", async () => {
    const t = montar({ avisoVisto: false });
    await t.entrar();
    expect(t.sessao.instantaneo().situacao).toBe("aguardando-aviso");
    expect(t.iniciarCaptura).not.toHaveBeenCalled();

    t.sessao.confirmarAviso();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.iniciarCaptura).toHaveBeenCalledTimes(1);
    expect(t.preferencias().avisoVisto).toBe(true);
    expect(t.sessao.instantaneo().situacao).toBe("escutando");
  });

  it("recusar o aviso não escuta nesta entrada; retomar mostra o aviso de novo", async () => {
    const t = montar({ avisoVisto: false });
    await t.entrar();
    t.sessao.recusarAviso();
    expect(t.sessao.instantaneo().situacao).toBe("pausada");
    expect(t.iniciarCaptura).not.toHaveBeenCalled();
    expect(t.preferencias().avisoVisto).toBe(false);

    t.sessao.retomar();
    expect(t.sessao.instantaneo().situacao).toBe("aguardando-aviso");
    expect(t.iniciarCaptura).not.toHaveBeenCalled();
  });

  it("pausar libera a captura; retomar captura de novo", async () => {
    const t = montar();
    await t.entrar();
    const primeira = t.ultimaCaptura();
    t.sessao.pausar();
    expect(primeira.parar).toHaveBeenCalled();
    expect(t.sessao.instantaneo().situacao).toBe("pausada");

    t.textos.push("Isto não deveria ser transcrito.");
    primeira.ouvintes.aoReceberAmostras(VOZ);
    primeira.ouvintes.aoReceberAmostras(SILENCIO);
    expect(t.transcrever).not.toHaveBeenCalled();

    t.sessao.retomar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.iniciarCaptura).toHaveBeenCalledTimes(2);
    expect(t.sessao.instantaneo().situacao).toBe("escutando");
  });

  it("erro ao iniciar a captura vira situação de erro; descartar deixa pausada e retomar tenta de novo", async () => {
    const t = montar({ falhaNaCaptura: new Error("A captura do áudio não foi liberada. Clique em retomar no indicador da escuta.") });
    await t.entrar();
    expect(t.sessao.instantaneo()).toMatchObject({
      situacao: "erro",
      erro: "A captura do áudio não foi liberada. Clique em retomar no indicador da escuta.",
    });

    t.sessao.descartarErro();
    expect(t.sessao.instantaneo()).toMatchObject({ situacao: "pausada", erro: null });
    t.sessao.retomar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.iniciarCaptura).toHaveBeenCalledTimes(2);
  });

  it("a captura que termina sozinha vira erro", async () => {
    const t = montar();
    await t.entrar();
    t.ultimaCaptura().ouvintes.aoEncerrar("A captura terminou.");
    expect(t.sessao.instantaneo()).toMatchObject({ situacao: "erro", erro: "A captura terminou." });
  });

  it("só avisa os assinantes quando o retrato muda, e o retrato é estável entre mudanças", async () => {
    const t = montar();
    const ouvinte = vi.fn();
    const cancelar = t.sessao.assinar(ouvinte);
    t.opcoesDaTela({});
    const retrato = t.sessao.instantaneo();
    t.opcoesDaTela({ chatLivre: true });
    expect(t.sessao.instantaneo()).toBe(retrato);
    const chamadas = ouvinte.mock.calls.length;
    await t.entrar();
    expect(ouvinte.mock.calls.length).toBeGreaterThan(chamadas);
    expect(Object.isFrozen(t.sessao.instantaneo())).toBe(true);
    cancelar();
  });
});

describe("controleSemPendente", () => {
  const criar = (texto: string, ms: number) => PerguntaDetectada.criar({ pergunta: texto, contexto: "", detectadaEmMs: ms });

  it("tira a pendente e mantém as recentes e o último envio", () => {
    let controle = ControleDeDisparos.inicial();
    controle = controle.avaliar(criar("qual a complexidade do quicksort", 0), 0, true).controle;
    controle = controle.avaliar(criar("como funciona um heap", 25_000), 25_000, true).controle;
    controle = controle.avaliar(criar("o que é uma trie", 30_000), 30_000, true).controle;
    expect(controle.pendente).not.toBeNull();

    const refeito = controleSemPendente(controle);
    expect(refeito.pendente).toBeNull();
    expect(refeito.ultimoDisparoMs).toBe(controle.ultimoDisparoMs);
    expect(refeito.recentes).toEqual(controle.recentes);
  });

  it("pode tirar uma pergunta das recentes (o envio que falhou)", () => {
    let controle = ControleDeDisparos.inicial();
    controle = controle.avaliar(criar("qual a complexidade do quicksort", 0), 0, true).controle;
    controle = controle.avaliar(criar("como funciona um heap", 25_000), 25_000, true).controle;
    const refeito = controleSemPendente(controle, { normalizada: "como funciona um heap", enviadaEmMs: 25_000 });
    expect(refeito.recentes.map((recente) => recente.normalizada)).toEqual(["qual a complexidade do quicksort"]);
    expect(refeito.ultimoDisparoMs).toBe(0);
  });
});
