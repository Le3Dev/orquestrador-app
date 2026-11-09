import { fireEvent, render, screen, within } from "@testing-library/react";

import type { ResumoDoGrupo } from "../../shared/canvas/nos";
import { BarraDoGrupo } from "./BarraDoGrupo";

const tresTerminais: ResumoDoGrupo = {
  ids: ["o1", "o2", "o3"],
  minimizaveis: 3,
  todasMinimizadas: false,
  fechaveis: 3,
  shells: 0,
};

function renderizar(resumo: ResumoDoGrupo = tresTerminais) {
  const acoes = {
    aoAlinhar: vi.fn(),
    aoDistribuir: vi.fn(),
    aoPorLadoALado: vi.fn(),
    aoMinimizar: vi.fn(),
    aoFechar: vi.fn(),
  };
  render(<BarraDoGrupo resumo={resumo} {...acoes} />);
  return { acoes, barra: screen.getByRole("toolbar", { name: "Ações do grupo" }) };
}

describe("BarraDoGrupo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mostra quantas telas e não deixa o React Flow arrastar, mover nem rolar por cima dela", () => {
    const { barra } = renderizar();

    expect(barra).toHaveTextContent("3 telas");
    expect(barra).toHaveClass("barra-do-grupo", "painel-flutuante", "nodrag", "nopan", "nowheel");
  });

  it("os seis alinhamentos, os dois distribuir e o lado a lado chamam a ação certa", () => {
    const { acoes, barra } = renderizar();
    const botao = (nome: string) => within(barra).getByRole("button", { name: nome });

    const alinhamentos = [
      ["Alinhar à esquerda", "esquerda"],
      ["Alinhar ao centro", "centro"],
      ["Alinhar à direita", "direita"],
      ["Alinhar ao topo", "topo"],
      ["Alinhar ao meio", "meio"],
      ["Alinhar à base", "base"],
    ] as const;
    for (const [nome, como] of alinhamentos) {
      fireEvent.click(botao(nome));
      expect(acoes.aoAlinhar).toHaveBeenLastCalledWith(como);
    }
    fireEvent.click(botao("Distribuir na horizontal"));
    expect(acoes.aoDistribuir).toHaveBeenLastCalledWith("horizontal");
    fireEvent.click(botao("Distribuir na vertical"));
    expect(acoes.aoDistribuir).toHaveBeenLastCalledWith("vertical");
    fireEvent.click(botao("Lado a lado"));
    expect(acoes.aoPorLadoALado).toHaveBeenCalledTimes(1);
    fireEvent.click(botao("Minimizar"));
    expect(acoes.aoMinimizar).toHaveBeenCalledTimes(1);
  });

  it("com duas telas, distribuir fica desabilitado e diz por quê", () => {
    renderizar({ ...tresTerminais, ids: ["o1", "o2"], minimizaveis: 2, fechaveis: 2 });

    const distribuir = screen.getByRole("button", { name: "Distribuir na horizontal" });
    expect(distribuir).toBeDisabled();
    expect(distribuir).toHaveAttribute("title", "Distribuir na horizontal: selecione 3 ou mais telas");
    expect(screen.getByRole("button", { name: "Alinhar à esquerda" })).toBeEnabled();
  });

  it("com todas as minimizáveis já minimizadas, o botão vira Restaurar", () => {
    renderizar({ ...tresTerminais, todasMinimizadas: true });

    expect(screen.getByRole("button", { name: "Restaurar" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Minimizar" })).not.toBeInTheDocument();
  });

  it("sem nada que minimize ou feche (artefatos e notas, rascunhos), os botões ficam desabilitados", () => {
    renderizar({ ids: ["n1", "rascunho:1"], minimizaveis: 0, todasMinimizadas: false, fechaveis: 0, shells: 0 });

    expect(screen.getByRole("button", { name: "Minimizar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fechar" })).toBeDisabled();
  });

  it("Fechar pede confirmação: cancelar não fecha; confirmar fecha", () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { acoes } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(confirmar).toHaveBeenCalledWith("Fechar 3 telas? Os orquestradores continuam salvos e voltam pela Doca.");
    expect(acoes.aoFechar).not.toHaveBeenCalled();

    confirmar.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(acoes.aoFechar).toHaveBeenCalledTimes(1);
  });

  it("a confirmação avisa que o shell é encerrado e que notas e rascunhos ficam", () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderizar({ ids: ["o1", "shell:s1", "nota:n1"], minimizaveis: 2, todasMinimizadas: false, fechaveis: 2, shells: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(confirmar).toHaveBeenCalledWith(
      "Fechar 2 telas? Os orquestradores continuam salvos e voltam pela Doca. O terminal de shell é encerrado. Notas e rascunhos ficam no canvas.",
    );
  });

  it("\"Salvar como modelo\" só aparece com a ação, e o clique a chama", () => {
    const { barra } = renderizar();
    expect(within(barra).queryByRole("button", { name: "Salvar como modelo" })).not.toBeInTheDocument();

    const aoSalvarComoModelo = vi.fn();
    render(
      <BarraDoGrupo
        resumo={tresTerminais}
        aoAlinhar={vi.fn()}
        aoDistribuir={vi.fn()}
        aoPorLadoALado={vi.fn()}
        aoMinimizar={vi.fn()}
        aoFechar={vi.fn()}
        aoSalvarComoModelo={aoSalvarComoModelo}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar como modelo" }));

    expect(aoSalvarComoModelo).toHaveBeenCalledTimes(1);
  });
});
