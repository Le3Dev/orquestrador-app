import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import type { EsforcoDeRaciocinio, ModeloClaude } from "../../shared/api/tipos";
import { MenuDeModelo } from "./MenuDeModelo";

interface Registro {
  modelo: ModeloClaude;
  esforco: EsforcoDeRaciocinio;
}

function Controlado({
  inicial = { modelo: "opus", esforco: "padrao" },
  comUltracode = false,
  aoMudar,
}: {
  inicial?: Registro;
  comUltracode?: boolean;
  aoMudar?: (registro: Registro) => void;
}) {
  const [valor, setValor] = useState<Registro>(inicial);
  return (
    <MenuDeModelo
      rotulo="Modelo do orquestrador"
      modelo={valor.modelo}
      esforco={valor.esforco}
      comUltracode={comUltracode}
      aoEscolherModelo={(modelo) => {
        const novo = { ...valor, modelo };
        setValor(novo);
        aoMudar?.(novo);
      }}
      aoEscolherEsforco={(esforco) => {
        const novo = { ...valor, esforco };
        setValor(novo);
        aoMudar?.(novo);
      }}
    />
  );
}

const botao = () => screen.getByRole("button", { name: /^Modelo do orquestrador:/ });

describe("MenuDeModelo", () => {
  it("o botão resume o modelo com versão e o esforço, e começa fechado", () => {
    render(<Controlado />);

    expect(botao()).toHaveTextContent("Opus 5.5");
    expect(botao()).toHaveTextContent("· esforço padrão");
    expect(botao()).toHaveAttribute("aria-haspopup", "menu");
    expect(botao()).toHaveAttribute("aria-expanded", "false");
    expect(botao().querySelector(".menu-de-modelo-detalhe-personalizado")).toBeNull();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("abre num portal no body, com os quatro modelos, o escolhido marcado e as classes do React Flow", () => {
    const { container } = render(<Controlado />);

    fireEvent.click(botao());

    const menu = screen.getByRole("menu");
    expect(botao()).toHaveAttribute("aria-expanded", "true");
    expect(container).not.toContainElement(menu);
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveClass("menu-de-modelo-lista", "nodrag", "nowheel");
    const modelos = within(menu).getAllByRole("menuitemradio");
    expect(modelos.map((item) => item.querySelector(".menu-de-modelo-titulo")?.textContent)).toEqual([
      "Fable 5.2",
      "Opus 5.5",
      "Sonnet 5.5",
      "Haiku 5.5",
    ]);
    expect(modelos[1]).toHaveAttribute("aria-checked", "true");
    expect(modelos[1]).toHaveTextContent("✓");
    expect(modelos[0]).toHaveAttribute("aria-checked", "false");
    expect(within(menu).getByRole("menuitem", { name: /^Esforço/ })).toHaveTextContent("Padrão");
  });

  it("escolher um modelo chama o callback, fecha o menu e devolve o foco ao botão", () => {
    const aoMudar = vi.fn();
    render(<Controlado aoMudar={aoMudar} />);

    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Haiku/ }));

    expect(aoMudar).toHaveBeenCalledWith({ modelo: "haiku", esforco: "padrao" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botao()).toHaveTextContent("Haiku 5.5");
    expect(botao()).toHaveFocus();
  });

  it("entra em Esforço, escolhe o nível e volta para a vista raiz com o menu aberto", () => {
    const aoMudar = vi.fn();
    render(<Controlado aoMudar={aoMudar} />);

    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
    expect(screen.queryByRole("menuitemradio", { name: /^Opus/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voltar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Padrão" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Médio" }));

    expect(aoMudar).toHaveBeenCalledWith({ modelo: "opus", esforco: "medio" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Esforço/ })).toHaveTextContent("Médio");
    expect(botao()).toHaveTextContent("· esforço médio");
    expect(botao().querySelector(".menu-de-modelo-detalhe-personalizado")).not.toBeNull();
  });

  it("\"Voltar\" volta para os modelos sem escolher nada", () => {
    const aoMudar = vi.fn();
    render(<Controlado aoMudar={aoMudar} />);

    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("Ultracode só aparece com comUltracode", () => {
    const { unmount } = render(<Controlado />);
    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(6);
    expect(screen.queryByRole("menuitemradio", { name: "Ultracode" })).not.toBeInTheDocument();
    unmount();

    render(<Controlado comUltracode />);
    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(7);
    expect(screen.getAllByRole("menuitemradio").at(-1)).toHaveTextContent("Ultracode");
  });

  it("Esc fecha, devolve o foco ao botão e não chega a quem ouve o document depois", () => {
    const aoTeclar = vi.fn();
    document.addEventListener("keydown", aoTeclar);
    render(<Controlado />);

    fireEvent.click(botao());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botao()).toHaveFocus();
    expect(aoTeclar).not.toHaveBeenCalled();
    document.removeEventListener("keydown", aoTeclar);
  });

  it("clique fora fecha; clique dentro do menu não", () => {
    render(
      <>
        <Controlado />
        <p>fora</p>
      </>,
    );

    fireEvent.click(botao());
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText("fora"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("redimensionar a janela fecha o menu", () => {
    render(<Controlado />);

    fireEvent.click(botao());
    fireEvent(window, new Event("resize"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("as setas movem o foco entre os itens", () => {
    render(<Controlado />);

    fireEvent.click(botao());
    const modelos = screen.getAllByRole("menuitemradio");
    expect(modelos[1]).toHaveFocus();
    fireEvent.keyDown(modelos[1]!, { key: "ArrowDown" });
    expect(modelos[2]).toHaveFocus();
    fireEvent.keyDown(modelos[2]!, { key: "ArrowUp" });
    expect(modelos[1]).toHaveFocus();
  });

  it("em tela estreita, o menu vira folha", () => {
    const largura = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });
    try {
      render(<Controlado />);
      fireEvent.click(botao());
      expect(screen.getByRole("menu")).toHaveClass("menu-de-modelo-folha");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: largura });
    }
  });
});
