import { act, fireEvent, render, screen } from "@testing-library/react";

import {
  CHAVE_DAS_PREFERENCIAS_DA_TELA,
  type EstiloDosControlesDasJanelas,
  usePreferenciasDaTela,
} from "../../shared/hooks/usePreferenciasDaTela";
import { ControlesDoNo, type PropsDosControlesDoNo } from "./ControlesDoNo";

const ponte = vi.hoisted(() => ({ noMac: false }));

vi.mock("../../shared/ponteDoDesktop", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../shared/ponteDoDesktop")>();
  return { ...original, rodandoNoMac: () => ponte.noMac };
});

function acoes() {
  return { aoFechar: vi.fn(), aoMinimizar: vi.fn(), aoAmpliar: vi.fn() };
}

const rotulos = () => screen.getAllByRole("button").map((botao) => botao.getAttribute("aria-label"));

/** Os dois usos do componente, como o cabeçalho de um nó faz: só um deles desenha. */
function Cabecalho(props: Omit<PropsDosControlesDoNo, "lado">) {
  return (
    <div>
      <ControlesDoNo lado="inicio" {...props} />
      <span>título</span>
      <ControlesDoNo lado="fim" {...props} />
    </div>
  );
}

describe("ControlesDoNo", () => {
  afterEach(() => {
    ponte.noMac = false;
    localStorage.clear();
  });

  describe("no Windows, no Linux e no navegador", () => {
    it("desenha só no fim do cabeçalho: minimizar, ampliar e fechar, com o fechar por último", () => {
      const { container } = render(<Cabecalho objeto="o terminal" {...acoes()} />);

      expect(rotulos()).toEqual(["Minimizar o terminal", "Ampliar o terminal", "Fechar o terminal"]);
      expect(container.querySelector(".bolinha-do-no")).toBeNull();
      const grupo = screen.getByRole("group", { name: "Controles da janela" });
      expect(grupo).toHaveClass("nodrag");
      expect(grupo.previousElementSibling).toHaveTextContent("título");
      for (const botao of screen.getAllByRole("button")) {
        expect(botao).toHaveClass("botao-do-no", "nodrag");
        expect(botao).toHaveAttribute("title");
      }
      expect(screen.getByRole("button", { name: "Fechar o terminal" })).toHaveClass("botao-do-no-fechar");
    });

    it("cada ação é opcional: sem a função, o botão não existe", () => {
      const { rerender } = render(<Cabecalho objeto="a nota" aoMinimizar={vi.fn()} />);
      expect(rotulos()).toEqual(["Minimizar a nota"]);

      rerender(<Cabecalho objeto="a prévia" aoMinimizar={vi.fn()} aoFechar={vi.fn()} />);
      expect(rotulos()).toEqual(["Minimizar a prévia", "Fechar a prévia"]);

      rerender(<Cabecalho objeto="o artefato" aoAmpliar={vi.fn()} aoFechar={vi.fn()} />);
      expect(rotulos()).toEqual(["Ampliar o artefato", "Fechar o artefato"]);
    });

    it("sem nenhuma ação não renderiza nada", () => {
      const { container } = render(<Cabecalho objeto="o terminal" />);
      expect(container.querySelector(".controles-do-no")).toBeNull();
    });

    it("chama cada ação; minimizada vira Restaurar e ampliada vira Sair da tela cheia", () => {
      const funcoes = acoes();
      const { rerender } = render(<Cabecalho objeto="o terminal" {...funcoes} />);
      fireEvent.click(screen.getByRole("button", { name: "Minimizar o terminal" }));
      fireEvent.click(screen.getByRole("button", { name: "Ampliar o terminal" }));
      fireEvent.click(screen.getByRole("button", { name: "Fechar o terminal" }));
      expect(funcoes.aoMinimizar).toHaveBeenCalledTimes(1);
      expect(funcoes.aoAmpliar).toHaveBeenCalledTimes(1);
      expect(funcoes.aoFechar).toHaveBeenCalledTimes(1);

      rerender(<Cabecalho objeto="o terminal" {...funcoes} minimizada ampliada />);
      expect(rotulos()).toEqual(["Restaurar o terminal", "Sair da tela cheia", "Fechar o terminal"]);
      expect(screen.getByRole("button", { name: "Sair da tela cheia" })).toHaveAttribute("title", "Sair da tela cheia (Esc)");
    });

    it("ampliar pode ficar desabilitado e o fechar aceita uma dica própria", () => {
      render(
        <Cabecalho objeto="o artefato" aoAmpliar={vi.fn()} ampliarDesabilitado aoFechar={vi.fn()} dicaDoFechar="Fechar (continua salvo)" />,
      );
      expect(screen.getByRole("button", { name: "Ampliar o artefato" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Fechar o artefato" })).toHaveAttribute("title", "Fechar (continua salvo)");
    });
  });

  describe("no Mac", () => {
    beforeEach(() => {
      ponte.noMac = true;
    });

    it("desenha só no começo do cabeçalho: bolinhas fechar, minimizar e ampliar", () => {
      const { container } = render(<Cabecalho objeto="o terminal" {...acoes()} />);

      expect(rotulos()).toEqual(["Fechar o terminal", "Minimizar o terminal", "Ampliar o terminal"]);
      expect(container.querySelector(".botao-do-no")).toBeNull();
      const grupo = screen.getByRole("group", { name: "Controles da janela" });
      expect(grupo).toHaveClass("nodrag");
      expect(grupo.nextElementSibling).toHaveTextContent("título");
      for (const botao of screen.getAllByRole("button")) {
        expect(botao).toHaveClass("bolinha-do-no", "nodrag");
      }
      expect(screen.getByRole("button", { name: "Fechar o terminal" })).toHaveClass("bolinha-do-no-fechar");
      expect(screen.getByRole("button", { name: "Minimizar o terminal" })).toHaveClass("bolinha-do-no-minimizar");
      expect(screen.getByRole("button", { name: "Ampliar o terminal" })).toHaveClass("bolinha-do-no-ampliar");
    });

    it("a cor segue a ação, não a posição: só a amarela quando só minimiza", () => {
      const funcoes = acoes();
      render(<Cabecalho objeto="a nota" aoMinimizar={funcoes.aoMinimizar} />);

      const bolinha = screen.getByRole("button", { name: "Minimizar a nota" });
      expect(screen.getAllByRole("button")).toHaveLength(1);
      expect(bolinha).toHaveClass("bolinha-do-no-minimizar");
      fireEvent.click(bolinha);
      expect(funcoes.aoMinimizar).toHaveBeenCalledTimes(1);
    });

    it("minimizada e ampliada: os mesmos rótulos do Windows", () => {
      render(<Cabecalho objeto="o terminal" {...acoes()} minimizada ampliada />);
      expect(rotulos()).toEqual(["Fechar o terminal", "Restaurar o terminal", "Sair da tela cheia"]);
    });
  });

  describe("preferência \"Controles das janelas\"", () => {
    const guardar = (estilo: unknown) =>
      localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ controlesDasJanelas: estilo }));
    const estilos = (container: HTMLElement) => ({
      bolinhas: container.querySelectorAll(".bolinha-do-no").length,
      botoes: container.querySelectorAll(".botao-do-no").length,
    });

    it("Automático (o padrão) segue o sistema: bolinhas no Mac, botões no Windows", () => {
      ponte.noMac = true;
      const mac = render(<Cabecalho objeto="o terminal" {...acoes()} />);
      expect(estilos(mac.container)).toEqual({ bolinhas: 3, botoes: 0 });
      mac.unmount();

      guardar("automatico");
      ponte.noMac = false;
      const windows = render(<Cabecalho objeto="o terminal" {...acoes()} />);
      expect(estilos(windows.container)).toEqual({ bolinhas: 0, botoes: 3 });
    });

    it("Estilo Mac põe as bolinhas à esquerda, mesmo no Windows", () => {
      guardar("mac");
      ponte.noMac = false;
      const { container } = render(<Cabecalho objeto="o terminal" {...acoes()} />);

      expect(estilos(container)).toEqual({ bolinhas: 3, botoes: 0 });
      expect(rotulos()).toEqual(["Fechar o terminal", "Minimizar o terminal", "Ampliar o terminal"]);
      expect(screen.getByRole("group", { name: "Controles da janela" }).nextElementSibling).toHaveTextContent("título");
    });

    it("Estilo Windows põe os botões à direita, mesmo no Mac", () => {
      guardar("windows");
      ponte.noMac = true;
      const { container } = render(<Cabecalho objeto="o terminal" {...acoes()} />);

      expect(estilos(container)).toEqual({ bolinhas: 0, botoes: 3 });
      expect(rotulos()).toEqual(["Minimizar o terminal", "Ampliar o terminal", "Fechar o terminal"]);
      expect(screen.getByRole("group", { name: "Controles da janela" }).previousElementSibling).toHaveTextContent("título");
    });

    it("valor guardado inválido vale Automático", () => {
      guardar("linux");
      ponte.noMac = true;
      const { container } = render(<Cabecalho objeto="o terminal" {...acoes()} />);
      expect(estilos(container)).toEqual({ bolinhas: 3, botoes: 0 });
    });

    it("trocar a preferência muda todas as janelas na hora, sem remontar", () => {
      let mudarEstilo: (estilo: EstiloDosControlesDasJanelas) => void = () => undefined;
      function Troca() {
        const { mudarPreferencias } = usePreferenciasDaTela();
        mudarEstilo = (estilo) => mudarPreferencias({ controlesDasJanelas: estilo });
        return null;
      }
      const { container } = render(
        <>
          <Troca />
          <Cabecalho objeto="o terminal" {...acoes()} />
          <Cabecalho objeto="a nota" aoFechar={vi.fn()} />
        </>,
      );
      expect(estilos(container)).toEqual({ bolinhas: 0, botoes: 4 });

      act(() => mudarEstilo("mac"));
      expect(estilos(container)).toEqual({ bolinhas: 4, botoes: 0 });

      act(() => mudarEstilo("windows"));
      expect(estilos(container)).toEqual({ bolinhas: 0, botoes: 4 });

      act(() => mudarEstilo("automatico"));
      expect(estilos(container)).toEqual({ bolinhas: 0, botoes: 4 });
    });
  });
});
