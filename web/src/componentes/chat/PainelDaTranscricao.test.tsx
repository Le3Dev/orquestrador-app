import { fireEvent, render, screen } from "@testing-library/react";

import type { EstadoDaEscuta } from "../../shared/escuta/sessaoDaEscuta";
import { PainelDaTranscricao, type PropsDoPainelDaTranscricao } from "./PainelDaTranscricao";

const AGORA = Date.now();
const VAZIA: EstadoDaEscuta["legenda"] = { frases: [], emAndamento: null };

function montar(sobrescrever: Partial<PropsDoPainelDaTranscricao> = {}) {
  const aoResponderAgora = vi.fn();
  const aoFechar = vi.fn();
  const props: PropsDoPainelDaTranscricao = {
    legenda: VAZIA,
    escutando: true,
    respondendo: false,
    aoResponderAgora,
    aoFechar,
    ...sobrescrever,
  };
  const resultado = render(<PainelDaTranscricao {...props} />);
  return { ...resultado, aoResponderAgora, aoFechar };
}

const COM_FALAS: EstadoDaEscuta["legenda"] = {
  frases: [
    { id: "enunciado-1", texto: "Bom dia, vamos começar.", inicioMs: AGORA - 20_000, fimMs: AGORA - 18_000, pergunta: false },
    { id: "enunciado-2", texto: "Qual a complexidade do quicksort?", inicioMs: AGORA - 10_000, fimMs: AGORA - 8_000, pergunta: true },
  ],
  emAndamento: { id: "enunciado-3", confirmado: "E no pior", parcial: "caso será", inicioMs: AGORA - 2_000 },
};

describe("PainelDaTranscricao", () => {
  it("é uma área clicável do modo invisível, com o cabeçalho e o log acessível", () => {
    const { container } = montar();
    expect(container.firstElementChild).toHaveAttribute("data-area-clicavel");
    expect(screen.getByRole("heading", { name: "Transcrição" })).toBeInTheDocument();
    const lista = screen.getByRole("log");
    expect(lista).toHaveAttribute("aria-live", "polite");
  });

  it("estado vazio: pede para ligar a escuta ou diz que está ouvindo", () => {
    const { rerender, aoResponderAgora, aoFechar } = montar({ escutando: false });
    expect(screen.getByText("Ligue a escuta para ver a transcrição aqui.")).toBeInTheDocument();
    rerender(<PainelDaTranscricao legenda={VAZIA} escutando respondendo={false} aoResponderAgora={aoResponderAgora} aoFechar={aoFechar} />);
    expect(screen.getByText("Ouvindo… nada falado ainda.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Responder agora" })).toBeDisabled();
  });

  it("lista as falas com hora, destaca a pergunta e mostra o parcial em cinza", () => {
    montar({ legenda: COM_FALAS });
    const falas = screen.getAllByTestId("fala-da-transcricao");
    expect(falas).toHaveLength(2);
    expect(falas[0]?.querySelector("time")).not.toBeNull();
    expect(falas[0]).not.toHaveClass("painel-transcricao-pergunta");
    expect(falas[1]).toHaveClass("painel-transcricao-pergunta");
    expect(falas[1]).toHaveTextContent("pergunta");

    const andamento = screen.getByTestId("fala-em-andamento");
    expect(andamento.querySelector(".painel-transcricao-confirmado")).toHaveTextContent("E no pior");
    expect(andamento.querySelector(".painel-transcricao-parcial")).toHaveTextContent("caso será");
  });

  it("Responder agora envia o pedido montado e mostra o atalho no title", () => {
    const { aoResponderAgora } = montar({ legenda: COM_FALAS });
    const botao = screen.getByRole("button", { name: "Responder agora" });
    expect(botao).toHaveAttribute("title", expect.stringContaining("Ctrl+Shift+Enter"));
    fireEvent.click(botao);
    expect(aoResponderAgora).toHaveBeenCalledTimes(1);
    const pedido = aoResponderAgora.mock.calls[0]?.[0] as string;
    expect(pedido).toContain("Transcrição recente:");
    expect(pedido).toContain("Qual a complexidade do quicksort?");
    expect(pedido).toContain("E no pior caso será");
  });

  it("respondendo desabilita o botão", () => {
    const { aoResponderAgora } = montar({ legenda: COM_FALAS, respondendo: true });
    const botao = screen.getByRole("button", { name: "Responder agora" });
    expect(botao).toBeDisabled();
    fireEvent.click(botao);
    expect(aoResponderAgora).not.toHaveBeenCalled();
  });

  it("fechar chama aoFechar e o indicador aparece no cabeçalho", () => {
    const { aoFechar } = montar({ indicador: <span data-testid="indicador-falso" /> });
    expect(screen.getByTestId("indicador-falso")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar a transcrição" }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("rola para o fim com fala nova, mas não se o usuário rolou para cima", () => {
    const { rerender, aoResponderAgora, aoFechar } = montar({ legenda: COM_FALAS });
    const lista = screen.getByRole("log");
    Object.defineProperty(lista, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(lista, "clientHeight", { configurable: true, value: 200 });
    const nova = (texto: string): EstadoDaEscuta["legenda"] => ({
      frases: [...COM_FALAS.frases, { id: "enunciado-3", texto, inicioMs: AGORA - 1_000, fimMs: AGORA, pergunta: false }],
      emAndamento: null,
    });
    const props = { escutando: true, respondendo: false, aoResponderAgora, aoFechar };

    lista.scrollTop = 800; // no fim
    fireEvent.scroll(lista);
    rerender(<PainelDaTranscricao {...props} legenda={nova("primeira")} />);
    expect(lista.scrollTop).toBe(1000);

    lista.scrollTop = 100; // rolou para cima
    fireEvent.scroll(lista);
    rerender(<PainelDaTranscricao {...props} legenda={nova("segunda")} />);
    expect(lista.scrollTop).toBe(100);
  });
});
