import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { DadosDoSubagentePronto, PerfilDeInstrucoes } from "../../shared/api/tipos";
import { PainelDeInstrucoesGerais } from "./PainelDeInstrucoesGerais";

describe("PainelDeInstrucoesGerais", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const revisor: DadosDoSubagentePronto = {
    nome: "revisor",
    descricao: "Revisa código.",
    prompt: "Aponte bugs.",
    modelo: "sonnet",
  };

  async function abrir(instrucoesPadrao = "") {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({ instrucoesPadrao, subagentesProntos: [revisor] });
    const aoFechar = vi.fn();
    const aoSalvar = vi.fn();
    render(<PainelDeInstrucoesGerais aoFechar={aoFechar} aoSalvar={aoSalvar} />);
    const campo = await screen.findByRole("textbox", { name: "Instruções gerais" });
    return { aoFechar, aoSalvar, campo };
  }

  it("carrega as instruções gerais salvas e só habilita salvar quando algo muda", async () => {
    const { campo } = await abrir("Responda curto.");

    expect(campo).toHaveValue("Responda curto.");
    expect(screen.getByRole("button", { name: "O que é Instruções gerais" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    fireEvent.change(campo, { target: { value: "Responda em tópicos." } });
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("a ajuda do campo dá a dica das variáveis {{pasta}} e {{nome}}", async () => {
    const { campo } = await abrir();

    expect(campo).toHaveAccessibleDescription(/Use \{\{pasta\}\} e \{\{nome\}\} para a pasta e o nome do orquestrador\./);
  });

  it("salva só as instruções gerais (os subagentes ficam como estão), avisa a página e fecha", async () => {
    const alterar = vi
      .spyOn(api, "alterarPreferencias")
      .mockResolvedValue({ instrucoesPadrao: "Use pt-BR.", subagentesProntos: [revisor] });
    const { aoFechar, aoSalvar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "Use pt-BR." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalled());
    expect(alterar).toHaveBeenCalledWith({ instrucoesPadrao: "Use pt-BR." });
    expect(aoSalvar).toHaveBeenCalled();
  });

  it("mostra o erro do servidor e continua aberto", async () => {
    vi.spyOn(api, "alterarPreferencias").mockRejectedValue(new Error("As instruções gerais devem ter até 4000 caracteres."));
    const { aoFechar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText(/devem ter até 4000 caracteres/)).toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("cancelar e Esc fecham sem salvar", async () => {
    const alterar = vi.spyOn(api, "alterarPreferencias");
    const { aoFechar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "rascunho" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.keyDown(campo, { key: "Escape" });

    expect(aoFechar).toHaveBeenCalledTimes(2);
    expect(alterar).not.toHaveBeenCalled();
  });

  describe("perfis de instruções", () => {
    const backend: PerfilDeInstrucoes = { nome: "Backend", texto: "Use Jest." };
    const front: PerfilDeInstrucoes = { nome: "Front", texto: "Use Vitest." };
    const perfil = (posicao: number) => screen.getByRole("group", { name: `Perfil ${posicao}` });
    const salvar = () => screen.getByRole("button", { name: "Salvar" });

    async function abrirComPerfis(perfisDeInstrucoes?: PerfilDeInstrucoes[]) {
      vi.spyOn(api, "lerPreferencias").mockResolvedValue({
        instrucoesPadrao: "Geral.",
        subagentesProntos: [revisor],
        ...(perfisDeInstrucoes === undefined ? {} : { perfisDeInstrucoes }),
      });
      const alterar = vi
        .spyOn(api, "alterarPreferencias")
        .mockImplementation(async (alteracao) => ({ instrucoesPadrao: "Geral.", subagentesProntos: [revisor], ...alteracao }));
      const aoFechar = vi.fn();
      render(<PainelDeInstrucoesGerais aoFechar={aoFechar} aoSalvar={vi.fn()} />);
      await screen.findByRole("textbox", { name: "Instruções gerais" });
      return { alterar, aoFechar };
    }

    it("servidor sem perfis: lista vazia, com o botão de criar", async () => {
      await abrirComPerfis(undefined);

      expect(screen.getByRole("heading", { name: "Perfis de instruções" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: /^Perfil/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ Novo perfil" })).toBeEnabled();
      expect(screen.getByText("0 / 20")).toBeInTheDocument();
    });

    it("carrega os salvos com nome e texto", async () => {
      await abrirComPerfis([backend, front]);

      expect(within(perfil(1)).getByRole("textbox", { name: "Nome do perfil" })).toHaveValue("Backend");
      expect(within(perfil(1)).getByRole("textbox", { name: "Texto do perfil" })).toHaveValue("Use Jest.");
      expect(within(perfil(2)).getByRole("textbox", { name: "Nome do perfil" })).toHaveValue("Front");
      expect(salvar()).toBeDisabled();
    });

    it("cria um perfil (cursor no nome) e salva só os perfis, sem as instruções gerais", async () => {
      const { alterar, aoFechar } = await abrirComPerfis([backend]);

      fireEvent.click(screen.getByRole("button", { name: "+ Novo perfil" }));
      const nome = within(perfil(2)).getByRole("textbox", { name: "Nome do perfil" });
      await waitFor(() => expect(nome).toHaveFocus());
      expect(screen.getByText("Para salvar, dê um nome.")).toBeInTheDocument();
      expect(salvar()).toBeDisabled();

      fireEvent.change(nome, { target: { value: "Revisão" } });
      expect(screen.getByText("Para salvar, escreva o texto.")).toBeInTheDocument();
      fireEvent.change(within(perfil(2)).getByRole("textbox", { name: "Texto do perfil" }), {
        target: { value: "Revise o diff." },
      });
      fireEvent.click(salvar());

      await waitFor(() => expect(aoFechar).toHaveBeenCalled());
      expect(alterar).toHaveBeenCalledWith({
        perfisDeInstrucoes: [backend, { nome: "Revisão", texto: "Revise o diff." }],
      });
    });

    it("renomeia, edita o texto e apaga; salva a lista inteira", async () => {
      const { alterar } = await abrirComPerfis([backend, front]);

      fireEvent.change(within(perfil(1)).getByRole("textbox", { name: "Nome do perfil" }), {
        target: { value: "Backend Nest" },
      });
      fireEvent.change(within(perfil(1)).getByRole("textbox", { name: "Texto do perfil" }), {
        target: { value: "Use Jest e rode o lint." },
      });
      fireEvent.click(within(perfil(2)).getByRole("button", { name: "Apagar" }));
      expect(screen.queryByRole("group", { name: "Perfil 2" })).not.toBeInTheDocument();
      fireEvent.click(salvar());

      await waitFor(() =>
        expect(alterar).toHaveBeenCalledWith({
          perfisDeInstrucoes: [{ nome: "Backend Nest", texto: "Use Jest e rode o lint." }],
        }),
      );
    });

    it("nome repetido (sem diferenciar maiúsculas) impede salvar", async () => {
      await abrirComPerfis([backend, front]);

      fireEvent.change(within(perfil(2)).getByRole("textbox", { name: "Nome do perfil" }), { target: { value: "backend" } });

      expect(screen.getAllByText(/Para salvar, troque o nome: já existe um/)).toHaveLength(2);
      expect(salvar()).toBeDisabled();
    });

    it("apagar e cancelar não salva nada", async () => {
      const { alterar, aoFechar } = await abrirComPerfis([backend]);

      fireEvent.click(within(perfil(1)).getByRole("button", { name: "Apagar" }));
      expect(salvar()).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(aoFechar).toHaveBeenCalled();
      expect(alterar).not.toHaveBeenCalled();
    });

    it("instruções gerais e perfis mudados vão juntos no mesmo salvar", async () => {
      const { alterar } = await abrirComPerfis([backend]);

      fireEvent.change(screen.getByRole("textbox", { name: "Instruções gerais" }), { target: { value: "Curto." } });
      fireEvent.click(within(perfil(1)).getByRole("button", { name: "Apagar" }));
      fireEvent.click(salvar());

      await waitFor(() => expect(alterar).toHaveBeenCalledWith({ instrucoesPadrao: "Curto.", perfisDeInstrucoes: [] }));
    });
  });

  it("Esc de fora do painel não fecha", async () => {
    const { aoFechar, campo } = await abrir();
    const fora = document.createElement("input");
    document.body.append(fora);

    fireEvent.change(campo, { target: { value: "rascunho" } });
    fireEvent.keyDown(fora, { key: "Escape" });

    expect(aoFechar).not.toHaveBeenCalled();
    expect(campo).toHaveValue("rascunho");
    fora.remove();
  });
});
