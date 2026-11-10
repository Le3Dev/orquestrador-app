import { act, fireEvent, render, screen } from "@testing-library/react";

import type { Gravacao } from "../shared/ditado/gravacao";
import { BotaoDeDitado, TEMPO_DO_DESTAQUE_DO_DITADO_MS } from "./BotaoDeDitado";

/** Microfone e Whisper falsos: o teste decide quando a permissão, a gravação e a transcrição terminam. */
const falso = vi.hoisted(() => ({
  comecar: vi.fn(),
  transcrever: vi.fn(),
}));
vi.mock("../shared/ditado/gravacao", async (importar) => ({
  ...(await importar<typeof import("../shared/ditado/gravacao")>()),
  comecarGravacao: falso.comecar,
}));
vi.mock("../shared/ditado/transcritor", () => ({ transcrever: falso.transcrever }));

function gravacaoFalsa(): Gravacao & {
  nivel: ReturnType<typeof vi.fn<() => number | null>>;
  descartar: ReturnType<typeof vi.fn>;
  parar: ReturnType<typeof vi.fn>;
} {
  return {
    nivel: vi.fn(() => 0.4),
    parar: vi.fn(() => Promise.resolve(new Float32Array(16_000 * 7))),
    descartar: vi.fn(),
  };
}

function resolvivel<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (motivo: unknown) => void;
  const promessa = new Promise<T>((ok, erro) => {
    resolver = ok;
    rejeitar = erro;
  });
  return { promessa, resolver, rejeitar };
}

async function esvaziar(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function montar(aoTranscrever = vi.fn()) {
  const resultado = render(
    <div className="composer-do-chat">
      <textarea aria-label="Mensagem" />
      <BotaoDeDitado destino="a mensagem" aoTranscrever={aoTranscrever} />
    </div>,
  );
  return { ...resultado, aoTranscrever, campo: screen.getByRole("textbox", { name: "Mensagem" }) };
}

const microfone = () => screen.getByRole("button", { name: /Ditar a mensagem por voz|Parar e transformar em texto/ });
/** A região educada que anuncia as fases (a do painel de silêncio fica dentro dele). */
const anuncios = () => document.querySelector<HTMLElement>(".sr-only[aria-live='polite']");

describe("BotaoDeDitado: retorno visual", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    falso.comecar.mockReset();
    falso.transcrever.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("percorre as fases: permissão, gravando, transcrevendo e texto adicionado ao campo", async () => {
    const permissao = resolvivel<Gravacao>();
    falso.comecar.mockReturnValue(permissao.promessa);
    const transcricao = resolvivel<string>();
    falso.transcrever.mockReturnValue(transcricao.promessa);
    const gravacao = gravacaoFalsa();
    const { aoTranscrever, campo } = montar();
    expect(anuncios()).toBeEmptyDOMElement();

    fireEvent.click(microfone());
    expect(screen.getByText("Permita o acesso ao microfone")).toBeInTheDocument();
    expect(anuncios()).toHaveTextContent("Permita o acesso ao microfone.");

    permissao.resolver(gravacao);
    await esvaziar();
    expect(screen.getByTestId("cronometro-do-ditado")).toHaveTextContent("00:00");
    expect(screen.getByText("Enter conclui, Esc descarta")).toBeInTheDocument();
    expect(anuncios()).toHaveTextContent("Gravando");
    act(() => vi.advanceTimersByTime(3_100));
    expect(screen.getByTestId("cronometro-do-ditado")).toHaveTextContent("00:03");

    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    await esvaziar();
    expect(screen.getByText("Transcrevendo 7 s de áudio")).toBeInTheDocument();
    expect(campo).toHaveAttribute("data-ditado", "transcrevendo");

    transcricao.resolver("olá mundo");
    await esvaziar();
    expect(aoTranscrever).toHaveBeenCalledWith("olá mundo");
    expect(screen.getByText("Texto adicionado ao campo")).toBeInTheDocument();
    expect(campo).toHaveAttribute("data-ditado", "inserido");
    expect(anuncios()).toHaveTextContent("Texto adicionado ao campo.");

    // O aviso e o destaque somem sozinhos.
    act(() => vi.advanceTimersByTime(TEMPO_DO_DESTAQUE_DO_DITADO_MS + 50));
    expect(screen.queryByText("Texto adicionado ao campo")).not.toBeInTheDocument();
    expect(campo).not.toHaveAttribute("data-ditado");
  });

  it("na primeira vez mostra o progresso do download do modelo e depois a transcrição", async () => {
    falso.comecar.mockResolvedValue(gravacaoFalsa());
    const transcricao = resolvivel<string>();
    let informar: (progresso: number) => void = () => undefined;
    falso.transcrever.mockImplementation((_audio: Float32Array, aoBaixar: (progresso: number) => void) => {
      informar = aoBaixar;
      return transcricao.promessa;
    });
    montar();

    fireEvent.click(microfone());
    await esvaziar();
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    await esvaziar();

    act(() => informar(35));
    expect(screen.getByText("Baixando o modelo de voz")).toBeInTheDocument();
    expect(screen.getByTestId("porcentagem-do-ditado")).toHaveTextContent("35%");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "35");
    expect(anuncios()).toHaveTextContent("Baixando o modelo de voz");

    act(() => informar(100));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("Transcrevendo 7 s de áudio")).toBeInTheDocument();
  });

  it("o Esc descarta, de qualquer ponto do painel, e solta o microfone", async () => {
    const gravacao = gravacaoFalsa();
    falso.comecar.mockResolvedValue(gravacao);
    montar();
    fireEvent.click(microfone());
    await esvaziar();

    fireEvent.keyDown(screen.getByRole("button", { name: "Concluir" }), { key: "Escape" });
    expect(gravacao.descartar).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("cronometro-do-ditado")).not.toBeInTheDocument();
    expect(falso.transcrever).not.toHaveBeenCalled();
  });

  it("o botão Descartar do painel joga a gravação fora e devolve o foco ao microfone", async () => {
    const gravacao = gravacaoFalsa();
    falso.comecar.mockResolvedValue(gravacao);
    montar();
    fireEvent.click(microfone());
    await esvaziar();

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(gravacao.descartar).toHaveBeenCalledTimes(1);
    expect(microfone()).toHaveFocus();
  });

  it("microfone negado mostra como liberar no Mac", async () => {
    falso.comecar.mockRejectedValue(new DOMException("negado", "NotAllowedError"));
    montar();
    fireEvent.click(microfone());
    await esvaziar();
    expect(screen.getByRole("alert")).toHaveTextContent(/Ajustes do Sistema › Privacidade e Segurança › Microfone/);
    expect(screen.queryByText("Permita o acesso ao microfone")).not.toBeInTheDocument();
  });

  it("sem fala por uns 3 s, avisa que não está ouvindo nada", async () => {
    const gravacao = gravacaoFalsa();
    gravacao.nivel.mockReturnValue(0.02);
    falso.comecar.mockResolvedValue(gravacao);
    montar();
    fireEvent.click(microfone());
    await esvaziar();

    act(() => vi.advanceTimersByTime(3_300));
    expect(screen.getByText("Não estou ouvindo nada, confira o microfone")).toBeInTheDocument();
  });

  it("desmontar no meio da gravação solta o microfone e para os timers", async () => {
    const gravacao = gravacaoFalsa();
    falso.comecar.mockResolvedValue(gravacao);
    const { unmount } = montar();
    fireEvent.click(microfone());
    await esvaziar();

    unmount();
    expect(gravacao.descartar).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
