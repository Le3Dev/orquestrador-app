import { render, screen } from "@testing-library/react";

import { EtiquetaDeWorktree } from "./EtiquetaDeWorktree";

const BRANCH = "orquestrador/7bdc7f01-e395-436a-b195-886f7b9fcec5";

describe("EtiquetaDeWorktree", () => {
  it("não mostra nada sem worktree", () => {
    const { container } = render(<EtiquetaDeWorktree worktree={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("encolhe e corta o branch com reticências, com o branch inteiro no tooltip", () => {
    render(
      <EtiquetaDeWorktree
        worktree={{ branch: BRANCH, caminho: "/dados/worktrees/7bdc7f01", ativo: true }}
        className="max-w-full"
      />,
    );
    const texto = screen.getByText(BRANCH);
    expect(texto).toHaveClass("min-w-0", "truncate");
    const etiqueta = texto.parentElement;
    expect(etiqueta).toHaveClass("chip", "chip-ativo", "min-w-0", "overflow-hidden", "max-w-full");
    expect(etiqueta).toHaveAttribute("title", expect.stringContaining(`Branch: ${BRANCH}`));
    expect(etiqueta).toHaveAttribute("title", expect.stringContaining("Worktree: /dados/worktrees/7bdc7f01"));
  });
});
