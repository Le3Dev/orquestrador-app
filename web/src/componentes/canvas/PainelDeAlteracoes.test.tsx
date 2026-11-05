import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  type AlteracoesDoWorktree,
  apiDeAlteracoes,
  type ArquivoAlterado,
  type ConsultaDasAlteracoes,
  type DiffDoArquivo,
  TEXTO_ARQUIVO_BINARIO,
  TEXTO_DIFF_TRUNCADO,
  TEXTO_DIFF_VAZIO,
  TEXTO_EM_USO,
  TEXTO_SEM_ALTERACOES,
  TEXTO_SEM_GIT,
} from "../../shared/api/alteracoes";
import { PainelDeAlteracoes } from "./PainelDeAlteracoes";

const ARQUIVOS: ArquivoAlterado[] = [
  { caminho: "src/app.ts", caminhoAnterior: null, situacao: "modificado", adicoes: 2, remocoes: 1, binario: false },
  { caminho: "src/novo.ts", caminhoAnterior: "src/velho.ts", situacao: "renomeado", adicoes: 0, remocoes: 0, binario: false },
  { caminho: "logo.png", caminhoAnterior: null, situacao: "adicionado", adicoes: null, remocoes: null, binario: true },
];

function comWorktree(parcial: Partial<AlteracoesDoWorktree> = {}): AlteracoesDoWorktree {
  return {
    situacao: "com_worktree",
    branch: "orquestrador/o1",
    caminho: "C:/dados/worktrees/o1",
    emUso: false,
    commitsNaBranch: 0,
    arquivos: ARQUIVOS,
    ...parcial,
  };
}

function pronta(alteracoes: AlteracoesDoWorktree): ConsultaDasAlteracoes {
  return { alteracoes, carregando: false, erro: null };
}

function diff(parcial: Partial<DiffDoArquivo> = {}): DiffDoArquivo {
  return {
    caminho: "src/app.ts",
    diff: "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n contexto\n-velha\n+nova\n",
    truncado: false,
    binario: false,
    ...parcial,
  };
}

function renderizar(consulta: ConsultaDasAlteracoes) {
  const aoAtualizar = vi.fn();
  const aoFechar = vi.fn();
  const aoTeclarNoTerminal = vi.fn();
  const aoClicarNoTerminal = vi.fn();
  const { container } = render(
    <div data-testid="terminal" onKeyDown={aoTeclarNoTerminal} onClick={aoClicarNoTerminal}>
      <PainelDeAlteracoes
        orquestradorId="o1"
        nomeDoOrquestrador="Painel de vendas"
        consulta={consulta}
        aoAtualizar={aoAtualizar}
        aoFechar={aoFechar}
      />
    </div>,
  );
  return {
    container,
    aoAtualizar,
    aoFechar,
    aoTeclarNoTerminal,
    aoClicarNoTerminal,
    dialogo: screen.getByRole("dialog", { name: "Alterações do worktree" }),
  };
}

describe("PainelDeAlteracoes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("abre como modal no body, fora do canvas, com o foco no painel", () => {
    const { container, dialogo } = renderizar(pronta(comWorktree()));

    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(dialogo).toHaveFocus();
    expect(container).not.toContainElement(dialogo);
    expect(document.body).toContainElement(dialogo);
    expect(screen.getByText("orquestrador/o1")).toBeInTheDocument();
  });

  it("lista os arquivos com a situação e as linhas a mais e a menos", () => {
    renderizar(pronta(comWorktree()));

    const lista = screen.getByRole("list", { name: "Arquivos alterados" });
    expect(lista.querySelectorAll("li")).toHaveLength(3);
    const app = screen.getByRole("button", { name: /src\/app\.ts/ });
    expect(app).toHaveTextContent("modificado");
    expect(app).toHaveTextContent("+2");
    expect(app).toHaveTextContent("−1");
    expect(screen.getByRole("button", { name: /src\/novo\.ts/ })).toHaveTextContent("renomeado");
    expect(screen.getByRole("button", { name: /logo\.png/ })).toHaveTextContent("binário");
    expect(screen.getByText("Escolha um arquivo para ver o diff.")).toBeInTheDocument();
  });

  it("escolher um arquivo busca o diff e pinta as linhas +, - e @@", async () => {
    const lerDiff = vi.spyOn(apiDeAlteracoes, "lerDiff").mockResolvedValue(diff());
    renderizar(pronta(comWorktree()));

    fireEvent.click(screen.getByRole("button", { name: /src\/app\.ts/ }));

    expect(lerDiff).toHaveBeenCalledWith("o1", "src/app.ts");
    expect(await screen.findByText("+nova")).toHaveAttribute("data-tipo", "adicao");
    expect(screen.getByText("-velha")).toHaveAttribute("data-tipo", "remocao");
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toHaveAttribute("data-tipo", "trecho");
    expect(screen.getByText("+++ b/src/app.ts")).toHaveAttribute("data-tipo", "cabecalho");
    expect(screen.getByText("+nova").className).toContain("text-success");
    expect(screen.getByText("-velha").className).toContain("text-error");
    expect(screen.getByRole("button", { name: /src\/app\.ts/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("avisa quando o diff foi cortado", async () => {
    vi.spyOn(apiDeAlteracoes, "lerDiff").mockResolvedValue(diff({ truncado: true }));
    renderizar(pronta(comWorktree()));

    fireEvent.click(screen.getByRole("button", { name: /src\/app\.ts/ }));

    expect(await screen.findByText(TEXTO_DIFF_TRUNCADO)).toBeInTheDocument();
    expect(screen.getByText("+nova")).toBeInTheDocument();
  });

  it("avisa que o arquivo é binário, sem diff de texto", async () => {
    vi.spyOn(apiDeAlteracoes, "lerDiff").mockResolvedValue({ caminho: "logo.png", diff: "", truncado: false, binario: true });
    renderizar(pronta(comWorktree()));

    fireEvent.click(screen.getByRole("button", { name: /logo\.png/ }));

    expect(await screen.findByText(TEXTO_ARQUIVO_BINARIO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_DIFF_VAZIO)).not.toBeInTheDocument();
  });

  it("mostra a falha do diff e tenta de novo", async () => {
    const lerDiff = vi
      .spyOn(apiDeAlteracoes, "lerDiff")
      .mockRejectedValueOnce(new Error("Não foi possível ler as alterações do worktree."))
      .mockResolvedValueOnce(diff());
    renderizar(pronta(comWorktree()));

    fireEvent.click(screen.getByRole("button", { name: /src\/app\.ts/ }));
    expect(await screen.findByText("Não foi possível ler as alterações do worktree.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tentar de novo" }));

    expect(await screen.findByText("+nova")).toBeInTheDocument();
    expect(lerDiff).toHaveBeenCalledTimes(2);
  });

  it("Esc fecha, sem o evento chegar ao terminal", () => {
    const { dialogo, aoFechar, aoTeclarNoTerminal } = renderizar(pronta(comWorktree()));

    fireEvent.keyDown(dialogo, { key: "Escape" });

    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(aoTeclarNoTerminal).not.toHaveBeenCalled();
  });

  it("clique fora fecha; clique dentro não fecha nem chega ao terminal", () => {
    const { dialogo, aoFechar, aoClicarNoTerminal } = renderizar(pronta(comWorktree()));

    fireEvent.mouseDown(dialogo);
    fireEvent.click(dialogo);
    expect(aoFechar).not.toHaveBeenCalled();
    expect(aoClicarNoTerminal).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId("fundo-do-painel-de-alteracoes"));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("o botão de fechar e o atualizar avisam quem abriu", () => {
    const { aoFechar, aoAtualizar } = renderizar(pronta(comWorktree()));

    fireEvent.click(screen.getByRole("button", { name: "atualizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(aoAtualizar).toHaveBeenCalledTimes(1);
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("explica a pasta sem git", () => {
    renderizar(
      pronta({ situacao: "sem_git", branch: null, caminho: null, emUso: false, commitsNaBranch: 0, arquivos: [] }),
    );

    expect(screen.getByText(TEXTO_SEM_GIT)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("diz que não há alterações sem worktree", () => {
    renderizar(
      pronta({ situacao: "sem_worktree", branch: null, caminho: null, emUso: false, commitsNaBranch: 0, arquivos: [] }),
    );

    expect(screen.getByText(TEXTO_SEM_ALTERACOES)).toBeInTheDocument();
  });

  it("avisa os commits da branch e o pedido em andamento", () => {
    renderizar(pronta(comWorktree({ emUso: true, commitsNaBranch: 3 })));

    expect(screen.getByText("3 commits na branch orquestrador/o1 não aparecem aqui.")).toBeInTheDocument();
    expect(screen.getByText(TEXTO_EM_USO)).toBeInTheDocument();
  });

  it("avisa os commits da branch mesmo sem arquivos pendentes", () => {
    renderizar(pronta(comWorktree({ arquivos: [], commitsNaBranch: 2 })));

    expect(screen.getByText(TEXTO_SEM_ALTERACOES)).toBeInTheDocument();
    expect(screen.getByText("2 commits na branch orquestrador/o1 não aparecem aqui.")).toBeInTheDocument();
  });

  it("mostra o carregamento e, na falha, o erro com tentar de novo", () => {
    const { aoAtualizar } = renderizar({ alteracoes: null, carregando: false, erro: "Não foi possível falar com o servidor." });

    expect(screen.getByText("Não foi possível falar com o servidor.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tentar de novo" }));
    expect(aoAtualizar).toHaveBeenCalledTimes(1);
  });

  it("mostra que está lendo antes da primeira resposta", () => {
    renderizar({ alteracoes: null, carregando: true, erro: null });

    expect(screen.getByRole("status")).toHaveTextContent("Lendo as alterações…");
    expect(screen.getByRole("button", { name: "atualizando…" })).toBeDisabled();
  });

  it("tira a escolha quando o arquivo some da lista", async () => {
    vi.spyOn(apiDeAlteracoes, "lerDiff").mockResolvedValue(diff());
    const aoFechar = vi.fn();
    const { rerender } = render(
      <PainelDeAlteracoes orquestradorId="o1" consulta={pronta(comWorktree())} aoAtualizar={vi.fn()} aoFechar={aoFechar} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /src\/app\.ts/ }));
    expect(await screen.findByText("+nova")).toBeInTheDocument();

    rerender(
      <PainelDeAlteracoes
        orquestradorId="o1"
        consulta={pronta(comWorktree({ arquivos: ARQUIVOS.slice(1) }))}
        aoAtualizar={vi.fn()}
        aoFechar={aoFechar}
      />,
    );

    await waitFor(() => expect(screen.queryByText("+nova")).not.toBeInTheDocument());
    expect(screen.getByText("Escolha um arquivo para ver o diff.")).toBeInTheDocument();
  });
});
