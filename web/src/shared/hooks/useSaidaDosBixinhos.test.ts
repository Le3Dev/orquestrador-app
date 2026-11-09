import { act, renderHook } from "@testing-library/react";
import { useMemo } from "react";

import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado, SituacaoDoSubagente } from "../api/tipos";
import type { BixinhosLimpos } from "../canvas/layout";
import { idDoBixinho } from "../canvas/nos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../estado/aplicarEvento";
import { DURACAO_DA_SAIDA_MS, ESPERA_ANTES_DE_SAIR_MS, esperaParaSair, useSaidaDosBixinhos } from "./useSaidaDosBixinhos";

const AGORA = new Date("2026-11-08T12:00:00Z");

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  instrucoesPersonalizadas: "",
};

function aplicar(estado: EstadoDaConversa, em: string, ...eventos: EventoDeOrquestracao[]): EstadoDaConversa {
  return eventos
    .map((evento, indice): EventoRegistrado => ({ ...evento, sequencia: estado.ultimaSequencia + indice + 1, em }))
    .reduce(aplicarEvento, estado);
}

/** Um pedido com os Subagentes dados, todos executando. */
function trabalhando(...subagentes: string[]): EstadoDaConversa {
  return aplicar(
    ESTADO_INICIAL,
    "2026-11-08T11:59:00Z",
    { tipo: "turno_iniciado", turnoId: "t1", texto: "analise", configuracao },
    ...subagentes.map(
      (subagenteId): EventoDeOrquestracao => ({
        tipo: "subagente_iniciado",
        turnoId: "t1",
        subagenteId,
        descricao: subagenteId,
        tarefa: "",
      }),
    ),
  );
}

/** O Subagente termina em `em` (padrão: agora, no relógio falso). */
function terminar(
  estado: EstadoDaConversa,
  subagenteId: string,
  situacao: Exclude<SituacaoDoSubagente, "executando">,
  em = new Date().toISOString(),
): EstadoDaConversa {
  return aplicar(estado, em, {
    tipo: "subagente_concluido",
    turnoId: "t1",
    subagenteId,
    situacao,
    resumo: "",
    tokens: 10,
    duracaoMs: 1000,
  });
}

type Props = {
  conversa: EstadoDaConversa;
  manter?: boolean;
  limpos?: ReadonlyMap<string, BixinhosLimpos>;
};

const SEM_LIMPOS: ReadonlyMap<string, BixinhosLimpos> = new Map();

function montar(inicial: Props) {
  const limpar = vi.fn();
  const resultado = renderHook(
    ({ conversa, manter = false, limpos = SEM_LIMPOS }: Props) => {
      // Como no canvas: o mesmo mapa enquanto a conversa não muda.
      const conversas = useMemo(() => new Map([["o1", conversa]]), [conversa]);
      return useSaidaDosBixinhos({ conversas, bixinhosLimpos: limpos, manter, limpar });
    },
    { initialProps: inicial },
  );
  return { limpar, ...resultado };
}

function avancar(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("esperaParaSair", () => {
  const agora = AGORA.getTime();

  it("conta do fim do Subagente: acabou de terminar, os 5 s; há 2 s, o que falta; sem a hora, os 5 s", () => {
    expect(esperaParaSair(AGORA.toISOString(), agora)).toBe(ESPERA_ANTES_DE_SAIR_MS);
    expect(esperaParaSair(new Date(agora - 2000).toISOString(), agora)).toBe(3000);
    expect(esperaParaSair(new Date(agora - 7000).toISOString(), agora)).toBe(0);
    expect(esperaParaSair(null, agora)).toBe(ESPERA_ANTES_DE_SAIR_MS);
    // Relógio do servidor adiantado: não espera mais que os 5 s.
    expect(esperaParaSair(new Date(agora + 60_000).toISOString(), agora)).toBe(ESPERA_ANTES_DE_SAIR_MS);
  });

  it("o fim antigo (o histórico reenviado ao abrir) é nulo: sai na hora", () => {
    expect(esperaParaSair(new Date(agora - 10_000).toISOString(), agora)).toBeNull();
    expect(esperaParaSair("2026-10-01T00:00:00Z", agora)).toBeNull();
  });
});

describe("useSaidaDosBixinhos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("concluiu agora: fica 5 s com a expressão final, sai com a animação e só então é limpo", () => {
    const { result, rerender, limpar } = montar({ conversa: trabalhando("s1", "s2") });
    const concluiu = terminar(trabalhando("s1", "s2"), "s1", "concluido");
    rerender({ conversa: concluiu });

    avancar(ESPERA_ANTES_DE_SAIR_MS - 1);
    expect(result.current.size).toBe(0);
    expect(limpar).not.toHaveBeenCalled();

    avancar(1);
    expect([...result.current]).toEqual([idDoBixinho("o1", "s1")]);
    expect(limpar).not.toHaveBeenCalled();

    avancar(DURACAO_DA_SAIDA_MS);
    expect(limpar).toHaveBeenCalledTimes(1);
    expect(limpar).toHaveBeenCalledWith("o1", ["s1"]);
    // Quem ainda executa não sai.
    expect(limpar).not.toHaveBeenCalledWith("o1", expect.arrayContaining(["s2"]));

    // Limpo, o bixinho some da conversa visível e da lista dos que saem.
    rerender({ conversa: concluiu, limpos: new Map([["o1", { turnoId: "t1", subagentes: ["s1"] }]]) });
    expect(result.current.size).toBe(0);
  });

  it("cancelado também sai; quem falhou fica até a pessoa limpar", () => {
    const { rerender, limpar } = montar({ conversa: trabalhando("s1", "s2") });
    rerender({ conversa: terminar(terminar(trabalhando("s1", "s2"), "s1", "cancelado"), "s2", "falhou") });

    avancar(ESPERA_ANTES_DE_SAIR_MS + DURACAO_DA_SAIDA_MS + 60_000);

    expect(limpar).toHaveBeenCalledTimes(1);
    expect(limpar).toHaveBeenCalledWith("o1", ["s1"]);
  });

  it("os que já tinham terminado ao abrir saem na hora, juntos, sem esperar nem animar", () => {
    const antigo = "2026-11-08T11:30:00Z";
    const conversa = terminar(terminar(trabalhando("s1", "s2", "s3"), "s1", "concluido", antigo), "s2", "cancelado", antigo);

    const { result, limpar } = montar({ conversa });

    expect(limpar).toHaveBeenCalledTimes(1);
    expect(limpar).toHaveBeenCalledWith("o1", ["s1", "s2"]);
    expect(result.current.size).toBe(0);
  });

  it("com reduzir movimento, sai depois dos 5 s sem passar pela animação", () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: consulta.includes("reduce") }));
    const { result, rerender, limpar } = montar({ conversa: trabalhando("s1") });
    rerender({ conversa: terminar(trabalhando("s1"), "s1", "concluido") });

    avancar(ESPERA_ANTES_DE_SAIR_MS);

    expect(limpar).toHaveBeenCalledWith("o1", ["s1"]);
    expect(result.current.size).toBe(0);
  });

  it("com \"Manter bixinhos até limpar à mão\", ninguém sai; ligar no meio da espera ou da animação desfaz", () => {
    const concluiu = terminar(trabalhando("s1", "s2"), "s1", "concluido");
    const { result, rerender, limpar } = montar({ conversa: concluiu, manter: true });
    avancar(60_000);
    expect(limpar).not.toHaveBeenCalled();

    // Desligada: conta de novo, pelo fim (há um minuto, já antigo), e sai na hora.
    rerender({ conversa: concluiu, manter: false });
    expect(limpar).toHaveBeenCalledWith("o1", ["s1"]);
    limpar.mockClear();

    // Um que conclui agora, e a preferência é ligada no meio da animação.
    const outro = terminar(concluiu, "s2", "concluido");
    rerender({ conversa: outro, manter: false, limpos: new Map([["o1", { turnoId: "t1", subagentes: ["s1"] }]]) });
    avancar(ESPERA_ANTES_DE_SAIR_MS);
    expect([...result.current]).toEqual([idDoBixinho("o1", "s2")]);
    rerender({ conversa: outro, manter: true, limpos: new Map([["o1", { turnoId: "t1", subagentes: ["s1"] }]]) });
    expect(result.current.size).toBe(0);
    avancar(60_000);
    expect(limpar).not.toHaveBeenCalled();
  });

  it("limpo à mão durante a espera: o timer é desfeito e não limpa de novo", () => {
    const concluiu = terminar(trabalhando("s1"), "s1", "concluido");
    const { rerender, limpar } = montar({ conversa: trabalhando("s1") });
    rerender({ conversa: concluiu });
    avancar(2000);

    rerender({ conversa: concluiu, limpos: new Map([["o1", { turnoId: "t1", subagentes: ["s1"] }]]) });
    avancar(60_000);

    expect(limpar).not.toHaveBeenCalled();
  });

  it("ao desmontar, nenhum timer fica para trás", () => {
    const { rerender, unmount, limpar } = montar({ conversa: trabalhando("s1") });
    rerender({ conversa: terminar(trabalhando("s1"), "s1", "concluido") });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    avancar(60_000);
    expect(limpar).not.toHaveBeenCalled();
  });
});
