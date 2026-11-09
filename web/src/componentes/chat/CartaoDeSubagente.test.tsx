import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type {
  AcaoDeCriarSubagente,
  AcaoDeEditarSubagente,
  DadosDasPreferencias,
  DadosDoSubagentePronto,
} from "../../shared/api/tipos";
import { aoMudarSubagentesProntos } from "../../shared/subagentesProntos";
import { CartaoDeSubagente } from "./CartaoDeSubagente";

const REVISOR: DadosDoSubagentePronto = {
  nome: "revisor",
  descricao: "Revisa o diff",
  prompt: "Leia o diff e aponte bugs.",
  modelo: "herdar",
};

const TESTADOR: DadosDoSubagentePronto = {
  nome: "testador",
  descricao: "Escreve testes",
  prompt: "Cubra os casos.",
  modelo: "sonnet",
};

function preferencias(subagentesProntos: DadosDoSubagentePronto[]): DadosDasPreferencias {
  return { instrucoesPadrao: "", subagentesProntos, autorrecuperacao: true };
}

const CRIAR: AcaoDeCriarSubagente = {
  tipo: "criar_subagente",
  nome: "documentador",
  descricao: "Atualiza o README",
  prompt: "Documente o que mudou.",
  modelo: "haiku",
};

function editar(campos: Partial<AcaoDeEditarSubagente> = {}): AcaoDeEditarSubagente {
  return { tipo: "editar_subagente", nome: "revisor", descricao: null, prompt: null, modelo: null, ...campos };
}

describe("CartaoDeSubagente", () => {
  afterEach(() => vi.restoreAllMocks());

  it("criar: mostra a prévia e não grava antes do clique", () => {
    const ler = vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias([]));
    const alterar = vi.spyOn(api, "alterarPreferencias");
    render(<CartaoDeSubagente acao={CRIAR} />);

    expect(screen.getByText("Novo subagente pronto")).toBeInTheDocument();
    expect(screen.getByText("documentador")).toBeInTheDocument();
    expect(screen.getByText("haiku")).toHaveClass("chip-de-modelo");
    expect(screen.getByText("quando usar: Atualiza o README")).toBeInTheDocument();
    // O prompt fica recolhido num details, com o tamanho no resumo.
    expect(screen.getByText("prompt (22 caracteres)").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Documente o que mudou.")).toBeInTheDocument();
    expect(ler).not.toHaveBeenCalled();
    expect(alterar).not.toHaveBeenCalled();
  });

  it("criar: relê a lista no clique, acrescenta ao fim e mostra concluído", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias([REVISOR]));
    const alterar = vi.spyOn(api, "alterarPreferencias").mockResolvedValue(preferencias([REVISOR]));
    render(<CartaoDeSubagente acao={CRIAR} />);

    fireEvent.click(screen.getByRole("button", { name: "criar" }));

    expect(await screen.findByRole("button", { name: "criado ✓" })).toBeDisabled();
    expect(alterar).toHaveBeenCalledWith({
      subagentesProntos: [
        REVISOR,
        { nome: "documentador", descricao: "Atualiza o README", prompt: "Documente o que mudou.", modelo: "haiku" },
      ],
    });
  });

  it("criar: avisa que a biblioteca mudou só depois de gravar (a barra do topo relê a contagem)", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias([REVISOR]));
    const alterar = vi.spyOn(api, "alterarPreferencias").mockResolvedValue(preferencias([REVISOR]));
    const aviso = vi.fn();
    const cancelar = aoMudarSubagentesProntos(aviso);
    render(<CartaoDeSubagente acao={CRIAR} />);

    fireEvent.click(screen.getByRole("button", { name: "criar" }));
    await screen.findByRole("button", { name: "criado ✓" });
    expect(alterar).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledTimes(1);
    cancelar();
  });

  it("criar com falha na gravação: não avisa", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias([REVISOR]));
    vi.spyOn(api, "alterarPreferencias").mockRejectedValue(new Error("fora do ar"));
    const aviso = vi.fn();
    const cancelar = aoMudarSubagentesProntos(aviso);
    render(<CartaoDeSubagente acao={CRIAR} />);

    fireEvent.click(screen.getByRole("button", { name: "criar" }));
    await screen.findByRole("alert");
    expect(aviso).not.toHaveBeenCalled();
    cancelar();
  });

  it("criar com um nome que já existe: erro no cartão, sem gravar", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias([REVISOR]));
    const alterar = vi.spyOn(api, "alterarPreferencias");
    render(<CartaoDeSubagente acao={{ ...CRIAR, nome: "revisor" }} />);

    fireEvent.click(screen.getByRole("button", { name: "criar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('Já existe um subagente pronto chamado "revisor".');
    expect(screen.getByRole("button", { name: "tentar de novo" })).toBeEnabled();
    expect(alterar).not.toHaveBeenCalled();
  });

  it("erro 400 do servidor aparece no cartão com a mensagem dele, e dá para tentar de novo", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias([]));
    const alterar = vi
      .spyOn(api, "alterarPreferencias")
      .mockRejectedValueOnce(new ErroDaApi('O nome "explore" é reservado; escolha outro.', 400))
      .mockResolvedValueOnce(preferencias([]));
    render(<CartaoDeSubagente acao={CRIAR} />);

    fireEvent.click(screen.getByRole("button", { name: "criar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('O nome "explore" é reservado; escolha outro.');

    fireEvent.click(screen.getByRole("button", { name: "tentar de novo" }));
    expect(await screen.findByRole("button", { name: "criado ✓" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(alterar).toHaveBeenCalledTimes(2);
  });

  it("editar: mostra o antes e o depois só dos campos trocados", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias([REVISOR]));
    render(<CartaoDeSubagente acao={editar({ descricao: "Revisa o diff e os testes", prompt: "Leia tudo.", modelo: "opus" })} />);

    expect(screen.getByText("Editar subagente pronto")).toBeInTheDocument();
    expect((await screen.findByText("Revisa o diff")).tagName).toBe("DEL");
    expect(screen.getByText("modelo: herda → opus")).toBeInTheDocument();
    expect(screen.getByText("prompt novo (10 caracteres)")).toBeInTheDocument();
    expect(screen.getByText("Leia o diff e aponte bugs.")).toBeInTheDocument();
    expect(screen.getByText("Leia tudo.")).toBeInTheDocument();
  });

  it("editar: troca só os campos indicados, mantém os outros e a posição na lista", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias([TESTADOR, REVISOR]));
    const alterar = vi.spyOn(api, "alterarPreferencias").mockResolvedValue(preferencias([]));
    render(<CartaoDeSubagente acao={editar({ modelo: "opus" })} />);

    expect(screen.queryByText(/quando usar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/prompt novo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "aplicar" }));

    expect(await screen.findByRole("button", { name: "alterado ✓" })).toBeDisabled();
    expect(alterar).toHaveBeenCalledWith({ subagentesProntos: [TESTADOR, { ...REVISOR, modelo: "opus" }] });
  });

  it("editar um nome que não existe: erro no cartão, sem gravar", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias([TESTADOR]));
    const alterar = vi.spyOn(api, "alterarPreferencias");
    render(<CartaoDeSubagente acao={editar({ nome: "diretor-de-video", prompt: "Roteiro." })} />);

    // Sem o antes, mostra só o valor novo.
    expect(screen.getByText("Roteiro.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "aplicar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('Não existe um subagente pronto chamado "diretor-de-video".');
    expect(alterar).not.toHaveBeenCalled();
    expect(screen.queryByText("antes")).not.toBeInTheDocument();
  });

  it("falha ao ler a lista no clique vira erro no cartão", async () => {
    vi.spyOn(api, "lerPreferencias").mockRejectedValue(new Error("Servidor fora do ar."));
    const alterar = vi.spyOn(api, "alterarPreferencias");
    render(<CartaoDeSubagente acao={CRIAR} />);

    fireEvent.click(screen.getByRole("button", { name: "criar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Servidor fora do ar."));
    expect(alterar).not.toHaveBeenCalled();
  });
});
