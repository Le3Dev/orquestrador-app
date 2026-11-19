import { render, screen } from "@testing-library/react";

import { PainelDoDitado } from "../../componentes/PainelDoDitado";
import { definirIdioma } from "../idioma/idioma";
import { anuncioDoDitado, mensagemDoErroDeDitado, textoDoSilencio } from "./texto";

afterEach(() => {
  definirIdioma("pt-BR");
});

describe("Ditado em inglês", () => {
  it("as mensagens de erro, o silêncio e os anúncios trocam de idioma", () => {
    expect(textoDoSilencio()).toBe("Não estou ouvindo nada, confira o microfone");
    definirIdioma("en");
    expect(textoDoSilencio()).toBe("I can't hear anything, check your microphone");
    expect(anuncioDoDitado("gravando", null, false)).toBe("Recording. Enter finishes, Esc discards.");
    expect(mensagemDoErroDeDitado(new DOMException("x", "NotFoundError"))).toBe("No microphone found.");
    expect(mensagemDoErroDeDitado(new Error("outra coisa"))).toBe("Dictation failed. Try again or type the text.");
  });

  it("PainelDoDitado: transcrevendo e texto adicionado em inglês", () => {
    definirIdioma("en");
    const base = { baixando: null, lerNivel: () => 0, aoConcluir: vi.fn(), aoDescartar: vi.fn() };
    const { rerender } = render(<PainelDoDitado {...base} fase="transcrevendo" segundosDeAudio={4} inserido={false} />);
    expect(screen.getByText("Transcribing 4 s of audio")).toBeInTheDocument();

    rerender(<PainelDoDitado {...base} fase="parado" segundosDeAudio={null} inserido />);
    expect(screen.getByText("Text added to the field")).toBeInTheDocument();
  });
});
