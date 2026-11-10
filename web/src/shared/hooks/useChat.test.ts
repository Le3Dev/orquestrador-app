import { act, renderHook, waitFor } from "@testing-library/react";

import { api } from "../api/cliente";
import { ESPERA_PARA_REABRIR_MS } from "../api/ConexoesDeEventos";
import type { EstadoDoChat, EventoDoChatRegistrado, MensagemDoChat } from "../api/tipos";
import { type FonteDeEventosDoChat, useChat } from "./useChat";

class FonteFalsa implements FonteDeEventosDoChat {
  readyState = 0;
  onopen: ((evento: Event) => unknown) | null = null;
  onerror: ((evento: Event) => unknown) | null = null;
  onmessage: ((evento: MessageEvent<string>) => unknown) | null = null;
  fechada = false;
  readonly ouvintes = new Map<string, (evento: MessageEvent<string>) => void>();

  constructor(readonly endereco: string) {}

  addEventListener(tipo: string, ouvinte: (evento: MessageEvent<string>) => void): void {
    this.ouvintes.set(tipo, ouvinte);
  }

  close(): void {
    this.fechada = true;
    this.readyState = 2;
  }

  emitir(dados: unknown, tipo?: string): void {
    const evento = new MessageEvent<string>(tipo ?? "message", { data: JSON.stringify(dados) });
    if (tipo === undefined) {
      this.onmessage?.(evento);
    } else {
      this.ouvintes.get(tipo)?.(evento);
    }
  }
}

function resposta(texto: string): MensagemDoChat {
  return {
    id: "c1",
    papel: "claude",
    texto,
    imagens: [],
    criadaEm: "2026-11-04T12:00:00Z",
    situacao: "respondendo",
    acoes: [],
    avisos: [],
    uso: null,
  };
}

function estado(ultimaSequencia: number, texto = "Olá"): EstadoDoChat {
  return {
    sessaoId: "s1",
    situacao: "respondendo",
    preferencias: { modelo: "opus", esforco: "alto", permitirArtefatosOnline: false },
    mensagens: [resposta(texto)],
    ultimaSequencia,
    cota: null,
  };
}

describe("useChat", () => {
  let fontes: FonteFalsa[];
  const criarFonte = (endereco: string) => {
    const fonte = new FonteFalsa(endereco);
    fontes.push(fonte);
    return fonte;
  };

  beforeEach(() => {
    fontes = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("carrega o estado e assina os eventos a partir da última sequência", async () => {
    vi.spyOn(api, "lerChat").mockResolvedValue(estado(7));
    const { result } = renderHook(() => useChat(true, criarFonte));

    await waitFor(() => expect(fontes).toHaveLength(1));
    expect(fontes[0]?.endereco).toBe("/api/chat/eventos?desde=7");
    expect(result.current.chat).toMatchObject({ carregado: true, ultimaSequencia: 7 });

    act(() => fontes[0]?.onopen?.(new Event("open")));
    expect(result.current.conexao).toBe("conectado");

    act(() => fontes[0]?.emitir({ mensagemId: "c1", texto: ", mundo" }, "trecho"));
    act(() => fontes[0]?.emitir({ mensagemId: "c1", ferramenta: "Read", detalhe: "README.md" }, "atividade"));
    expect(result.current.chat.mensagens[0]?.texto).toBe("Olá, mundo");
    expect(result.current.chat.atividade?.detalhe).toBe("README.md");

    const concluida: EventoDoChatRegistrado = {
      tipo: "resposta_concluida",
      mensagemId: "c1",
      texto: "Final",
      acoes: [],
      avisos: [],
      uso: null,
      sequencia: 8,
      em: "2026-11-04T12:00:01Z",
    };
    act(() => fontes[0]?.emitir(concluida));
    expect(result.current.chat.mensagens[0]).toMatchObject({ texto: "Final", situacao: "concluida" });
    expect(result.current.chat.ultimaSequencia).toBe(8);
  });

  it("quando o navegador abandona a conexão, recarrega o estado e assina de novo com ?desde=", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ler = vi.spyOn(api, "lerChat").mockResolvedValueOnce(estado(3)).mockResolvedValueOnce(estado(9, "Olá de novo"));
    const { result } = renderHook(() => useChat(true, criarFonte));
    await waitFor(() => expect(fontes).toHaveLength(1));

    act(() => {
      const primeira = fontes[0]!;
      primeira.readyState = 2;
      primeira.onerror?.(new Event("error"));
    });
    expect(result.current.conexao).toBe("reconectando");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_REABRIR_MS);
    });
    await waitFor(() => expect(fontes).toHaveLength(2));
    expect(ler).toHaveBeenCalledTimes(2);
    expect(fontes[1]?.endereco).toBe("/api/chat/eventos?desde=9");
    expect(result.current.chat.mensagens[0]?.texto).toBe("Olá de novo");
  });

  it("com o servidor voltando, fecha a conexão antiga, recarrega e assina de novo", async () => {
    const ler = vi.spyOn(api, "lerChat").mockResolvedValueOnce(estado(2)).mockResolvedValueOnce(estado(5));
    const { rerender } = renderHook(({ conectado }) => useChat(conectado, criarFonte), {
      initialProps: { conectado: true },
    });
    await waitFor(() => expect(fontes).toHaveLength(1));

    rerender({ conectado: false });
    rerender({ conectado: true });

    await waitFor(() => expect(fontes).toHaveLength(2));
    expect(ler).toHaveBeenCalledTimes(2);
    expect(fontes[0]?.fechada).toBe(true);
    expect(fontes[1]?.endereco).toBe("/api/chat/eventos?desde=5");
  });

  it("se a carga falha, avisa e tenta de novo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, "lerChat").mockRejectedValueOnce(new Error("fora do ar")).mockResolvedValueOnce(estado(1));
    const { result } = renderHook(() => useChat(true, criarFonte));

    await waitFor(() => expect(result.current.erro).toBe("fora do ar"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_REABRIR_MS);
    });
    await waitFor(() => expect(fontes).toHaveLength(1));
    expect(result.current.erro).toBeNull();
  });
});
