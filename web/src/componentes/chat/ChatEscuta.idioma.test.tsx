import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { PerguntaDoApp } from "../../shared/api/tipos";
import type { EstadoDaEscuta } from "../../shared/escuta/sessaoDaEscuta";
import { definirIdioma } from "../../shared/idioma/idioma";
import { AvisoDaEscuta } from "./AvisoDaEscuta";
import { CartaoDePergunta } from "./CartaoDePergunta";
import { explicacaoDoMotor, textoDoDownload } from "./motorDaEscuta";
import { PainelDaTranscricao } from "./PainelDaTranscricao";

afterEach(() => {
  definirIdioma("pt-BR");
});

describe("Chat e escuta em inglês", () => {
  it("AvisoDaEscuta: título, itens e botões em inglês", () => {
    definirIdioma("en");
    const aoConfirmar = vi.fn();
    const aoRecusar = vi.fn();
    render(<AvisoDaEscuta aoConfirmar={aoConfirmar} aoRecusar={aoRecusar} />);

    const dialogo = screen.getByRole("dialog", { name: "Listen to the computer audio?" });
    expect(dialogo).toHaveTextContent("is not recorded");
    expect(dialogo).toHaveTextContent("Claude (Haiku)");
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoRecusar).toHaveBeenCalledTimes(1);
  });

  it("PainelDaTranscricao: cabeçalho, estado vazio e Responder agora em inglês", () => {
    definirIdioma("en");
    const vazia: EstadoDaEscuta["legenda"] = { frases: [], emAndamento: null };
    const props = { legenda: vazia, respondendo: false, aoResponderAgora: vi.fn(), aoFechar: vi.fn() };
    const { rerender } = render(<PainelDaTranscricao {...props} escutando={false} />);

    expect(screen.getByRole("heading", { name: "Transcript" })).toBeInTheDocument();
    expect(screen.getByText("Turn on listening to see the transcript here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close the transcript" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Answer now/ })).toBeDisabled();

    rerender(<PainelDaTranscricao {...props} escutando />);
    expect(screen.getByText("Listening… nothing said yet.")).toBeInTheDocument();
  });

  it("CartaoDePergunta: rótulos, 'Other…' e situação em inglês; a resposta enviada não muda", async () => {
    definirIdioma("en");
    const pergunta: PerguntaDoApp = {
      pergunta: "Which database?",
      opcoes: [
        { rotulo: "PostgreSQL", descricao: null },
        { rotulo: "SQLite", descricao: null },
      ],
      multipla: false,
    };
    const aoResponder = vi.fn<(texto: string) => Promise<void>>().mockResolvedValue(undefined);
    render(<CartaoDePergunta perguntas={[pergunta]} respondida={false} desabilitado={false} aoResponder={aoResponder} />);

    expect(screen.getByRole("group", { name: "Question from Claude" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Other…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    expect(aoResponder).toHaveBeenCalledWith("Which database? → SQLite");
    await waitFor(() => expect(screen.getByText(/· answered/)).toBeInTheDocument());
  });

  it("motorDaEscuta: balão do motor e progresso do download em inglês", () => {
    definirIdioma("en");
    expect(explicacaoDoMotor({ dispositivo: "webgpu", modelo: "onnx-community/whisper-base", precisao: "q4" })).toBe(
      "Model onnx-community/whisper-base, precision q4, running on GPU (webgpu)",
    );
    expect(textoDoDownload({ progresso: 45, totalMb: 199 })).toBe("downloading the model 45% of 199 MB");
  });
});
