import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { api } from "../../shared/api/cliente";
import type { ListagemDeSkills } from "../../shared/api/tipos";
import { AVISO_DE_SKILLS_DESLIGADAS, PainelDeSkills } from "./PainelDeSkills";

const ABERTOS = [
  { id: "o1", nome: "Site da loja" },
  { id: "o2", nome: "API de pagamentos" },
];

const GLOBAIS: ListagemDeSkills = {
  liberadasNoNivel: null,
  skills: [
    { nome: "revisor", descricao: "Revisa o diff procurando bugs", origem: "usuario", plugin: null },
    { nome: "context7-mcp", descricao: "Busca documentação atual de bibliotecas", origem: "plugin", plugin: "context7" },
  ],
};

const DO_PROJETO: ListagemDeSkills = {
  liberadasNoNivel: true,
  skills: [
    ...GLOBAIS.skills,
    { nome: "publicar-site", descricao: "Publica o site da loja", origem: "projeto", plugin: null },
  ],
};

let leitura: MockInstance<typeof api.lerSkills>;

beforeEach(() => {
  leitura = vi.spyOn(api, "lerSkills").mockResolvedValue(DO_PROJETO);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PainelDeSkills", () => {
  it("lê as skills do primeiro orquestrador aberto e agrupa por origem, com o nome do plugin", async () => {
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    expect(screen.getByText("carregando…")).toBeInTheDocument();
    expect(await screen.findByText("publicar-site")).toBeInTheDocument();
    expect(leitura).toHaveBeenCalledWith("o1");

    const titulos = screen.getAllByRole("heading", { level: 3 }).map((titulo) => titulo.firstChild?.textContent);
    expect(titulos).toEqual(["Suas skills", "Do projeto", "De plugins"]);
    const plugins = screen.getByRole("region", { name: /De plugins/ });
    expect(within(plugins).getByText("context7-mcp")).toBeInTheDocument();
    expect(within(plugins).getByText("context7")).toBeInTheDocument();
    expect(within(plugins).getByText("Busca documentação atual de bibliotecas")).toBeInTheDocument();
    expect(screen.queryByText(AVISO_DE_SKILLS_DESLIGADAS)).not.toBeInTheDocument();
  });

  it("trocar o orquestrador lê de novo, com o id escolhido", async () => {
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);
    await screen.findByText("publicar-site");

    leitura.mockResolvedValueOnce(GLOBAIS);
    fireEvent.change(screen.getByRole("combobox", { name: "Orquestrador" }), { target: { value: "o2" } });

    await waitFor(() => expect(screen.queryByText("publicar-site")).not.toBeInTheDocument());
    expect(leitura).toHaveBeenLastCalledWith("o2");
    expect(screen.getByText("revisor")).toBeInTheDocument();
  });

  it("sem orquestrador aberto, lê só as globais e avisa", async () => {
    leitura.mockResolvedValue(GLOBAIS);
    render(<PainelDeSkills orquestradores={[]} aoFechar={vi.fn()} />);

    expect(await screen.findByText("revisor")).toBeInTheDocument();
    expect(leitura).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Nenhum orquestrador aberto: só as skills globais.")).toBeInTheDocument();
  });

  it("a busca filtra por nome ou descrição, sem ligar para acento, e mostra o vazio da busca", async () => {
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);
    await screen.findByText("publicar-site");
    const campo = screen.getByRole("searchbox", { name: "Buscar skill por nome ou descrição" });

    fireEvent.change(campo, { target: { value: "documentacao" } });
    expect(screen.getByText("context7-mcp")).toBeInTheDocument();
    expect(screen.queryByText("revisor")).not.toBeInTheDocument();
    // Um grupo sem resultado some.
    expect(screen.queryByRole("heading", { name: /Suas skills/ })).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "PUBLICAR" } });
    expect(screen.getByText("publicar-site")).toBeInTheDocument();
    expect(screen.queryByText("context7-mcp")).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "zzz" } });
    expect(screen.getByText("Nenhuma skill combina com a busca")).toBeInTheDocument();
  });

  it("avisa quando o nível do orquestrador deixa as skills desligadas, sem esconder a lista", async () => {
    leitura.mockResolvedValue({ ...DO_PROJETO, liberadasNoNivel: false });
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    expect(await screen.findByText(AVISO_DE_SKILLS_DESLIGADAS)).toBeInTheDocument();
    expect(screen.getByText("publicar-site")).toBeInTheDocument();
  });

  it("mostra o erro da leitura", async () => {
    leitura.mockRejectedValue(new Error("Não foi possível ler as skills."));
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    expect(await screen.findByText("Não foi possível ler as skills.")).toBeInTheDocument();
  });

  it("mostra o vazio quando não há nenhuma skill", async () => {
    leitura.mockResolvedValue({ skills: [], liberadasNoNivel: true });
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    expect(await screen.findByText("Nenhuma skill encontrada")).toBeInTheDocument();
  });

  it("não tem como criar, editar ou apagar: só fechar", async () => {
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);
    await screen.findByText("publicar-site");

    const painel = screen.getByRole("region", { name: "Skills do Claude Code" });
    expect(within(painel).getAllByRole("button").map((botao) => botao.textContent || botao.getAttribute("aria-label"))).toEqual([
      "Fechar skills",
      "Fechar",
    ]);
  });

  it("fecha pelo X, pelo botão Fechar e pelo Esc", async () => {
    const aoFechar = vi.fn();
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={aoFechar} />);
    await screen.findByText("publicar-site");

    fireEvent.click(screen.getByRole("button", { name: "Fechar skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(3);
  });
});
