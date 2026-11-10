import { fireEvent, render, screen } from "@testing-library/react";

import { PainelDaEscuta } from "./PainelDaEscuta";
import { type AparenciaDaEscuta, APARENCIA_PADRAO, type MotorDaEscuta, type VisaoDaEscuta } from "./tipos";

function visao(alteracoes: Partial<VisaoDaEscuta> = {}): VisaoDaEscuta {
  return {
    confirmados: [{ id: "1", texto: "Bom dia a todos.", inicioMs: 0, fimMs: 1200, pergunta: false }],
    parcial: null,
    motor: null,
    download: null,
    situacao: "escutando",
    erro: null,
    resposta: null,
    ...alteracoes,
  };
}

function renderizar(alteracoes: Partial<VisaoDaEscuta> = {}, aparencia: AparenciaDaEscuta = APARENCIA_PADRAO) {
  const aoMudarAparencia = vi.fn<(aparencia: AparenciaDaEscuta) => void>();
  const resultado = render(
    <PainelDaEscuta visao={visao(alteracoes)} aparencia={aparencia} aoMudarAparencia={aoMudarAparencia} />,
  );
  return { ...resultado, aoMudarAparencia };
}

describe("PainelDaEscuta", () => {
  describe("cabeçalho", () => {
    it.each([
      ["webgpu", "GPU"],
      ["dml", "GPU"],
      ["wasm", "CPU"],
      ["cpu", "CPU"],
    ] as const)("selo do motor em %s: %s, com modelo e precisão no title", (dispositivo, tipo) => {
      const motor: MotorDaEscuta = { dispositivo, modelo: "onnx-community/whisper-base", precisao: "q4" };
      renderizar({ motor });

      const selo = screen.getByText(`${tipo} · base · q4`);
      expect(selo).toHaveClass(`selo-do-motor-${tipo.toLowerCase()}`);
      expect(selo.getAttribute("title")).toContain("onnx-community/whisper-base");
      expect(selo.getAttribute("title")).toContain("q4");
    });

    it("sem motor, sem selo", () => {
      const { container } = renderizar();
      expect(container.querySelector(".selo-do-motor")).toBeNull();
    });

    it("download com o total", () => {
      renderizar({ download: { progresso: 45, totalMb: 199 } });

      const barra = screen.getByRole("progressbar", { name: "Download do modelo de transcrição" });
      expect(barra).toHaveAttribute("aria-valuenow", "45");
      expect(barra).toHaveTextContent("baixando o modelo 45% de 199 MB");
    });

    it("download sem o total", () => {
      renderizar({ download: { progresso: 12.6, totalMb: null } });

      const barra = screen.getByRole("progressbar", { name: "Download do modelo de transcrição" });
      expect(barra).toHaveAttribute("aria-valuenow", "13");
      expect(barra).toHaveTextContent(/^baixando o modelo 13%$/);
    });

    it("sem download, sem barra", () => {
      renderizar();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("mostra a situação com a classe dela", () => {
      renderizar({ situacao: "pausada" });
      expect(screen.getByTestId("painel-da-escuta")).toHaveClass("painel-da-escuta-pausada");
      expect(screen.getByText("pausada")).toBeInTheDocument();
    });
  });

  describe("aparência", () => {
    it("A+ e A− mudam a fonte de 1 em 1", () => {
      const { aoMudarAparencia } = renderizar();

      fireEvent.click(screen.getByRole("button", { name: "Aumentar a fonte" }));
      expect(aoMudarAparencia).toHaveBeenLastCalledWith({ ...APARENCIA_PADRAO, tamanhoDaFonte: 15 });

      fireEvent.click(screen.getByRole("button", { name: "Diminuir a fonte" }));
      expect(aoMudarAparencia).toHaveBeenLastCalledWith({ ...APARENCIA_PADRAO, tamanhoDaFonte: 13 });
    });

    it("nos limites, o botão do lado do limite fica desligado", () => {
      const { aoMudarAparencia, unmount } = renderizar({}, { ...APARENCIA_PADRAO, tamanhoDaFonte: 22 });
      const aumentar = screen.getByRole("button", { name: "Aumentar a fonte" });
      expect(aumentar).toBeDisabled();
      fireEvent.click(aumentar);
      expect(aoMudarAparencia).not.toHaveBeenCalled();
      unmount();

      renderizar({}, { ...APARENCIA_PADRAO, tamanhoDaFonte: 12 });
      expect(screen.getByRole("button", { name: "Diminuir a fonte" })).toBeDisabled();
    });

    it("aparência fora dos limites é presa antes de mudar", () => {
      const { aoMudarAparencia } = renderizar({}, { tamanhoDaFonte: 40, opacidade: 3, compacto: false });

      fireEvent.click(screen.getByRole("button", { name: "Diminuir a fonte" }));
      expect(aoMudarAparencia).toHaveBeenLastCalledWith({ tamanhoDaFonte: 21, opacidade: 1, compacto: false });
    });

    it("a fonte escolhida vale para a legenda", () => {
      const { container } = renderizar({}, { ...APARENCIA_PADRAO, tamanhoDaFonte: 19 });
      expect(container.querySelector(".legenda-ao-vivo")).toHaveStyle({ fontSize: "19px" });
    });

    it("a transparência muda a opacidade dentro dos limites e só pela variável do fundo", () => {
      const { aoMudarAparencia } = renderizar();
      const painel = screen.getByTestId("painel-da-escuta");
      expect(painel.style.getPropertyValue("--opacidade-da-escuta")).toBe("92%");
      expect(painel.style.opacity).toBe("");

      const controle = screen.getByRole("slider", { name: "Opacidade do fundo" });
      expect(controle).toHaveAttribute("min", "0.4");
      expect(controle).toHaveAttribute("max", "1");
      expect(controle).toHaveAttribute("step", "0.05");

      fireEvent.change(controle, { target: { value: "0.55" } });
      expect(aoMudarAparencia).toHaveBeenLastCalledWith({ ...APARENCIA_PADRAO, opacidade: 0.55 });

      fireEvent.change(controle, { target: { value: "0.1" } });
      const ultima = aoMudarAparencia.mock.lastCall?.[0];
      expect(ultima?.opacidade).toBe(0.4);
    });

    it("compactar esconde o cartão e expandir o traz de volta", () => {
      const { aoMudarAparencia, rerender } = renderizar();
      expect(screen.getByRole("region", { name: "Resposta da escuta" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Compactar a escuta" }));
      expect(aoMudarAparencia).toHaveBeenLastCalledWith({ ...APARENCIA_PADRAO, compacto: true });

      rerender(
        <PainelDaEscuta
          visao={visao()}
          aparencia={{ ...APARENCIA_PADRAO, compacto: true }}
          aoMudarAparencia={aoMudarAparencia}
        />,
      );
      expect(screen.queryByRole("region", { name: "Resposta da escuta" })).not.toBeInTheDocument();
      expect(screen.getByTestId("painel-da-escuta")).toHaveClass("painel-da-escuta-compacto");
      expect(screen.getByText("Bom dia a todos.")).toBeInTheDocument();

      const expandir = screen.getByRole("button", { name: "Expandir a escuta" });
      expect(expandir).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(expandir);
      expect(aoMudarAparencia).toHaveBeenLastCalledWith({ ...APARENCIA_PADRAO, compacto: false });
    });
  });

  describe("corpo", () => {
    it("legenda e cartão juntos, com a resposta", () => {
      renderizar({
        parcial: "e agora",
        resposta: { pergunta: "Qual é o prazo?", texto: "- Sexta-feira", carregando: false },
      });

      expect(screen.getByText("e agora")).toHaveClass("legenda-parcial");
      expect(screen.getByRole("listitem")).toHaveTextContent("Sexta-feira");
    });

    it("o erro aparece num alert", () => {
      renderizar({ situacao: "erro", erro: "a captura do áudio parou" });

      expect(screen.getByRole("alert")).toHaveTextContent("a captura do áudio parou");
      expect(screen.getByRole("alert")).toHaveClass("erro-do-painel-da-escuta");
    });

    it("sem erro, sem alert", () => {
      renderizar();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("com aoDescartarErro, o erro ganha o fechar", () => {
      const aoDescartarErro = vi.fn();
      render(
        <PainelDaEscuta
          visao={visao({ situacao: "erro", erro: "a captura do áudio parou" })}
          aparencia={APARENCIA_PADRAO}
          aoMudarAparencia={vi.fn()}
          aoDescartarErro={aoDescartarErro}
        />,
      );

      expect(screen.getByRole("alert")).toHaveTextContent("a captura do áudio parou");
      fireEvent.click(screen.getByRole("button", { name: "fechar" }));
      expect(aoDescartarErro).toHaveBeenCalledTimes(1);
    });

    it("sem aoDescartarErro, o erro não tem fechar", () => {
      renderizar({ situacao: "erro", erro: "a captura do áudio parou" });
      expect(screen.queryByRole("button", { name: "fechar" })).not.toBeInTheDocument();
    });
  });

  describe("rodapé", () => {
    it("aparece no pé do painel, também no compacto", () => {
      const { container, rerender } = render(
        <PainelDaEscuta
          visao={visao()}
          aparencia={APARENCIA_PADRAO}
          aoMudarAparencia={vi.fn()}
          rodape={<button type="button">Automático</button>}
        />,
      );
      const rodape = container.querySelector(".rodape-do-painel-da-escuta");
      expect(rodape).not.toBeNull();
      expect(rodape).toContainElement(screen.getByRole("button", { name: "Automático" }));
      expect(screen.getByTestId("painel-da-escuta").lastElementChild).toBe(rodape);

      rerender(
        <PainelDaEscuta
          visao={visao()}
          aparencia={{ ...APARENCIA_PADRAO, compacto: true }}
          aoMudarAparencia={vi.fn()}
          rodape={<button type="button">Automático</button>}
        />,
      );
      expect(screen.getByRole("button", { name: "Automático" })).toBeInTheDocument();
    });

    it("sem rodapé, sem o pé", () => {
      const { container } = renderizar();
      expect(container.querySelector(".rodape-do-painel-da-escuta")).toBeNull();
    });
  });
});
