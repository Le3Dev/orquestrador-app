import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { api } from "../../shared/api/cliente";
import type { ListagemDeSkills } from "../../shared/api/tipos";
import { PainelDeSkills } from "./PainelDeSkills";

const ABERTOS = [
  { id: "o1", nome: "Site da loja" },
  { id: "o2", nome: "API de pagamentos" },
];

const USUARIO = { nome: "revisor", descricao: "Revisa o diff procurando bugs", origem: "usuario", plugin: null } as const;
const PLUGIN = {
  nome: "context7-mcp",
  descricao: "Busca documentação atual de bibliotecas",
  origem: "plugin",
  plugin: "context7",
} as const;
const PROJETO_DA_LOJA = { nome: "publicar-site", descricao: "Publica o site da loja", origem: "projeto", plugin: null } as const;
const PROJETO_DA_API = { nome: "migrar-banco", descricao: "Roda as migrations dos pagamentos", origem: "projeto", plugin: null } as const;

const GLOBAIS: ListagemDeSkills = { liberadasNoNivel: null, skills: [USUARIO, PLUGIN] };

/** O que a API devolve por orquestrador: as globais mais as do projeto dele. */
function listagemDe(orquestradorId: string | undefined, liberadas: Record<string, boolean> = {}): ListagemDeSkills {
  if (orquestradorId === undefined) {
    return GLOBAIS;
  }
  const doProjeto = orquestradorId === "o1" ? [PROJETO_DA_LOJA] : orquestradorId === "o2" ? [PROJETO_DA_API] : [];
  return { liberadasNoNivel: liberadas[orquestradorId] ?? true, skills: [USUARIO, PLUGIN, ...doProjeto] };
}

let leitura: MockInstance<typeof api.lerSkills>;

beforeEach(() => {
  leitura = vi.spyOn(api, "lerSkills").mockImplementation((orquestradorId) => Promise.resolve(listagemDe(orquestradorId)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const titulosDosGrupos = () =>
  screen.getAllByRole("heading", { level: 3 }).map((titulo) => titulo.firstChild?.textContent);

describe("PainelDeSkills", () => {
  it("lê as globais e as de cada orquestrador aberto, sem repetir as globais, e agrupa por origem", async () => {
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    expect(screen.getByText("carregando…")).toBeInTheDocument();
    expect(await screen.findByText("publicar-site")).toBeInTheDocument();
    expect(leitura).toHaveBeenCalledWith();
    expect(leitura).toHaveBeenCalledWith("o1");
    expect(leitura).toHaveBeenCalledWith("o2");

    expect(titulosDosGrupos()).toEqual([
      "Suas skills",
      "Do projeto Site da loja",
      "Do projeto API de pagamentos",
      "De plugins",
    ]);
    // As globais aparecem uma vez só, mesmo vindo também na leitura de cada projeto.
    expect(screen.getAllByText("revisor")).toHaveLength(1);
    const projeto = screen.getByRole("region", { name: /Do projeto API de pagamentos/ });
    expect(within(projeto).getByText("migrar-banco")).toBeInTheDocument();
    const plugins = screen.getByRole("region", { name: /De plugins/ });
    expect(within(plugins).getByText("context7-mcp")).toBeInTheDocument();
    expect(within(plugins).getByText("context7")).toBeInTheDocument();
    expect(within(plugins).getByText("Busca documentação atual de bibliotecas")).toBeInTheDocument();
    expect(screen.getByText(/4 skills\./)).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("não tem seletor de orquestrador", async () => {
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);
    await screen.findByText("publicar-site");

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("só mostra o grupo do projeto de quem tem skills de projeto", async () => {
    leitura.mockImplementation((orquestradorId) =>
      Promise.resolve(orquestradorId === "o2" ? { liberadasNoNivel: true, skills: [USUARIO, PLUGIN] } : listagemDe(orquestradorId)),
    );
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);
    await screen.findByText("publicar-site");

    expect(titulosDosGrupos()).toEqual(["Suas skills", "Do projeto Site da loja", "De plugins"]);
  });

  it("sem orquestrador aberto, lê só as globais, sem aviso nem seletor", async () => {
    render(<PainelDeSkills orquestradores={[]} aoFechar={vi.fn()} />);

    expect(await screen.findByText("revisor")).toBeInTheDocument();
    expect(leitura).toHaveBeenCalledTimes(1);
    expect(leitura).toHaveBeenCalledWith();
    expect(titulosDosGrupos()).toEqual(["Suas skills", "De plugins"]);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("abrir outro orquestrador no canvas lê de novo e ganha o grupo dele", async () => {
    const { rerender } = render(<PainelDeSkills orquestradores={[ABERTOS[0]!]} aoFechar={vi.fn()} />);
    await screen.findByText("publicar-site");
    expect(screen.queryByText("migrar-banco")).not.toBeInTheDocument();

    rerender(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    expect(await screen.findByText("migrar-banco")).toBeInTheDocument();
    expect(leitura).toHaveBeenCalledWith("o2");
  });

  it("a busca filtra por nome ou descrição em todos os grupos, sem ligar para acento, e mostra o vazio da busca", async () => {
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);
    await screen.findByText("publicar-site");
    const campo = screen.getByRole("searchbox", { name: "Buscar skill por nome ou descrição" });

    fireEvent.change(campo, { target: { value: "documentacao" } });
    expect(screen.getByText("context7-mcp")).toBeInTheDocument();
    expect(screen.queryByText("revisor")).not.toBeInTheDocument();
    // Um grupo sem resultado some.
    expect(screen.queryByRole("heading", { name: /Suas skills/ })).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "PAGAMENTOS" } });
    expect(screen.getByText("migrar-banco")).toBeInTheDocument();
    expect(screen.queryByText("publicar-site")).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "zzz" } });
    expect(screen.getByText("Nenhuma skill combina com a busca")).toBeInTheDocument();
  });

  it("avisa no rodapé, uma linha só, quais orquestradores abertos têm as skills desligadas, sem esconder a lista", async () => {
    leitura.mockImplementation((orquestradorId) => Promise.resolve(listagemDe(orquestradorId, { o1: false, o2: false })));
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    const aviso = await screen.findByRole("note");
    expect(aviso).toHaveTextContent(
      "Skills desligadas em Site da loja, API de pagamentos: o nível de permissão é só leitura. Elas valem nos níveis com edição, fora do planejamento.",
    );
    expect(aviso.closest(".skills-rodape")).not.toBeNull();
    expect(screen.getByText("publicar-site")).toBeInTheDocument();
  });

  it("o aviso cita só os orquestradores com skills desligadas", async () => {
    leitura.mockImplementation((orquestradorId) => Promise.resolve(listagemDe(orquestradorId, { o2: false })));
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    expect(await screen.findByRole("note")).toHaveTextContent(/^Skills desligadas em API de pagamentos: /);
  });

  it("mostra o erro da leitura das globais", async () => {
    leitura.mockRejectedValue(new Error("Não foi possível ler as skills."));
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    expect(await screen.findByText("Não foi possível ler as skills.")).toBeInTheDocument();
  });

  it("se a leitura de um projeto falha, a lista segue sem o grupo dele", async () => {
    leitura.mockImplementation((orquestradorId) =>
      orquestradorId === "o1" ? Promise.reject(new Error("falhou")) : Promise.resolve(listagemDe(orquestradorId)),
    );
    render(<PainelDeSkills orquestradores={ABERTOS} aoFechar={vi.fn()} />);

    expect(await screen.findByText("migrar-banco")).toBeInTheDocument();
    expect(screen.queryByText("publicar-site")).not.toBeInTheDocument();
    expect(titulosDosGrupos()).toEqual(["Suas skills", "Do projeto API de pagamentos", "De plugins"]);
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
    await waitFor(() => expect(screen.getByText("publicar-site")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Fechar skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(3);
  });
});
