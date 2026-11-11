import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { ListagemDeSkills, PluginDoCatalogo, PluginInstalado } from "../../shared/api/tipos";
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
// Sincronizada da conta Claude: vem com origem "plugin", mas não há plugin instalado com esse nome.
const DA_CONTA = { nome: "anthropic-skills:pdf", descricao: "Lê, cria e edita PDFs", origem: "plugin", plugin: "anthropic-skills" } as const;
const PROJETO_DA_LOJA = { nome: "publicar-site", descricao: "Publica o site da loja", origem: "projeto", plugin: null } as const;
const PROJETO_DA_API = { nome: "migrar-banco", descricao: "Roda as migrations dos pagamentos", origem: "projeto", plugin: null } as const;

const GLOBAIS: ListagemDeSkills = { liberadasNoNivel: null, skills: [USUARIO, PLUGIN, DA_CONTA] };

const CONTEXT7: PluginInstalado = {
  id: "context7@claude-plugins-official",
  nome: "context7",
  marketplace: "claude-plugins-official",
  oficial: true,
  versao: "1.0.0",
  ligado: true,
  instaladoEm: null,
  inventario: { skills: [{ nome: "context7-mcp", descricao: "Busca documentação atual de bibliotecas" }], subagentes: 0, servidoresMcp: 1, hooks: 0, verificado: true, temBin: false },
};

const APOLLO: PluginDoCatalogo = {
  id: "apollo-skills@claude-plugins-official",
  nome: "apollo-skills",
  descricao: "Skills para Apollo GraphQL.",
  marketplace: "claude-plugins-official",
  oficial: true,
  instalacoes: 431,
  versao: "0.3.1",
  fonte: "github.com/apollographql/skills",
  instalado: false,
};
const APOLLO_INSTALADO: PluginInstalado = {
  id: APOLLO.id,
  nome: APOLLO.nome,
  marketplace: APOLLO.marketplace,
  oficial: true,
  versao: "0.3.1",
  ligado: false,
  instaladoEm: null,
  inventario: { skills: [{ nome: "graphql", descricao: "" }], subagentes: 0, servidoresMcp: 1, hooks: 1, verificado: true, temBin: false },
};

/** O que a API devolve por orquestrador: as globais mais as do projeto dele. */
function listagemDe(orquestradorId: string | undefined, liberadas: Record<string, boolean> = {}): ListagemDeSkills {
  if (orquestradorId === undefined) {
    return GLOBAIS;
  }
  const doProjeto = orquestradorId === "o1" ? [PROJETO_DA_LOJA] : orquestradorId === "o2" ? [PROJETO_DA_API] : [];
  return { liberadasNoNivel: liberadas[orquestradorId] ?? true, skills: [...GLOBAIS.skills, ...doProjeto] };
}

let leitura: MockInstance<typeof api.lerSkills>;
let instalados: MockInstance<typeof api.lerPluginsInstalados>;
let catalogo: MockInstance<typeof api.lerCatalogoDePlugins>;

beforeEach(() => {
  leitura = vi.spyOn(api, "lerSkills").mockImplementation((orquestradorId) => Promise.resolve(listagemDe(orquestradorId)));
  instalados = vi.spyOn(api, "lerPluginsInstalados").mockResolvedValue({ plugins: [CONTEXT7] });
  catalogo = vi
    .spyOn(api, "lerCatalogoDePlugins")
    .mockResolvedValue({ plugins: [APOLLO], total: 1, totais: { oficial: 317, aberto: 3662 } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const titulosDosGrupos = () =>
  screen.getAllByRole("heading", { level: 3 }).map((titulo) => titulo.firstChild?.textContent);

const montar = (extras: Partial<Parameters<typeof PainelDeSkills>[0]> = {}) => {
  const chamadas = { aoFechar: vi.fn(), aoMudarPlugins: vi.fn() };
  const resultado = render(<PainelDeSkills orquestradores={ABERTOS} {...chamadas} {...extras} />);
  return { ...chamadas, ...resultado };
};

describe("PainelDeSkills: aba Instaladas", () => {
  it("abre em Instaladas: lê as globais, as de cada orquestrador e os plugins, e agrupa por origem", async () => {
    montar();

    expect(screen.getByText("carregando…")).toBeInTheDocument();
    expect(await screen.findByText("publicar-site")).toBeInTheDocument();
    expect(leitura).toHaveBeenCalledWith();
    expect(leitura).toHaveBeenCalledWith("o1");
    expect(leitura).toHaveBeenCalledWith("o2");
    expect(instalados).toHaveBeenCalledTimes(1);

    expect(titulosDosGrupos()).toEqual([
      "Plugins",
      "Suas skills",
      "Do projeto Site da loja",
      "Do projeto API de pagamentos",
      "Da sua conta Claude",
    ]);
    // As globais aparecem uma vez só, mesmo vindo também na leitura de cada projeto.
    expect(screen.getAllByText("revisor")).toHaveLength(1);
    const projeto = screen.getByRole("region", { name: /Do projeto API de pagamentos/ });
    expect(within(projeto).getByText("migrar-banco")).toBeInTheDocument();
  });

  it("o grupo De plugins deixou de existir: cada plugin instalado é a própria linha, que abre para mostrar as skills", async () => {
    montar();
    await screen.findByText("publicar-site");

    expect(screen.queryByRole("heading", { name: /De plugins/ })).not.toBeInTheDocument();
    const plugins = screen.getByRole("region", { name: /Plugins/ });
    expect(within(plugins).getByRole("button", { name: "context7" })).toBeInTheDocument();
    expect(within(plugins).getByText("Valem no app e no terminal")).toBeInTheDocument();
    // A skill do plugin só aparece dentro da linha dele, aberta.
    expect(screen.queryByText("context7-mcp")).not.toBeInTheDocument();

    fireEvent.click(within(plugins).getByRole("button", { name: "context7" }));

    expect(within(plugins).getByText("context7-mcp")).toBeInTheDocument();
    expect(within(plugins).getByText("Busca documentação atual de bibliotecas")).toBeInTheDocument();
  });

  it("as skills sincronizadas da conta (de plugin que não está instalado) não somem: grupo próprio, sem ações", async () => {
    montar();
    await screen.findByText("publicar-site");

    const conta = screen.getByRole("region", { name: /Da sua conta Claude/ });
    expect(within(conta).getByText("anthropic-skills:pdf")).toBeInTheDocument();
    expect(within(conta).getByText("Lê, cria e edita PDFs")).toBeInTheDocument();
    expect(within(conta).getByText("anthropic-skills")).toBeInTheDocument();
    expect(within(conta).queryByRole("button")).not.toBeInTheDocument();
    expect(within(conta).queryByRole("switch")).not.toBeInTheDocument();
  });

  it("não tem seletor de orquestrador", async () => {
    montar();
    await screen.findByText("publicar-site");

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("só mostra o grupo do projeto de quem tem skills de projeto", async () => {
    leitura.mockImplementation((orquestradorId) =>
      Promise.resolve(orquestradorId === "o2" ? { liberadasNoNivel: true, skills: GLOBAIS.skills } : listagemDe(orquestradorId)),
    );
    montar();
    await screen.findByText("publicar-site");

    expect(titulosDosGrupos()).toEqual(["Plugins", "Suas skills", "Do projeto Site da loja", "Da sua conta Claude"]);
  });

  it("sem orquestrador aberto, lê só as globais, sem aviso nem seletor", async () => {
    montar({ orquestradores: [] });

    expect(await screen.findByText("revisor")).toBeInTheDocument();
    expect(leitura).toHaveBeenCalledTimes(1);
    expect(leitura).toHaveBeenCalledWith();
    expect(titulosDosGrupos()).toEqual(["Plugins", "Suas skills", "Da sua conta Claude"]);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("abrir outro orquestrador no canvas lê de novo e ganha o grupo dele", async () => {
    const { rerender, aoFechar } = montar({ orquestradores: [ABERTOS[0]!] });
    await screen.findByText("publicar-site");
    expect(screen.queryByText("migrar-banco")).not.toBeInTheDocument();

    rerender(<PainelDeSkills orquestradores={ABERTOS} aoFechar={aoFechar} />);

    expect(await screen.findByText("migrar-banco")).toBeInTheDocument();
    expect(leitura).toHaveBeenCalledWith("o2");
  });

  it("a busca filtra por nome ou descrição em todos os grupos (e nas skills dos plugins), sem ligar para acento", async () => {
    montar();
    await screen.findByText("publicar-site");
    const campo = screen.getByRole("searchbox", { name: "Buscar skill por nome ou descrição" });

    fireEvent.change(campo, { target: { value: "documentacao" } });
    // O plugin context7 fica pela skill dele, que combina.
    expect(screen.getByRole("button", { name: "context7" })).toBeInTheDocument();
    expect(screen.queryByText("revisor")).not.toBeInTheDocument();
    // Um grupo sem resultado some.
    expect(screen.queryByRole("heading", { name: /Suas skills/ })).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "PAGAMENTOS" } });
    expect(screen.getByText("migrar-banco")).toBeInTheDocument();
    expect(screen.queryByText("publicar-site")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "context7" })).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "zzz" } });
    expect(screen.getByText("Nenhuma skill combina com a busca")).toBeInTheDocument();
  });

  it("avisa no rodapé, uma linha só, quais orquestradores abertos têm as skills desligadas, sem esconder a lista", async () => {
    leitura.mockImplementation((orquestradorId) => Promise.resolve(listagemDe(orquestradorId, { o1: false, o2: false })));
    montar();

    const aviso = await screen.findByRole("note");
    expect(aviso).toHaveTextContent(
      "Skills desligadas em Site da loja, API de pagamentos: o nível de permissão é só leitura. Elas valem nos níveis com edição, fora do planejamento.",
    );
    expect(aviso.closest(".mk-skills-rodape")).not.toBeNull();
    expect(screen.getByText("publicar-site")).toBeInTheDocument();
  });

  it("o aviso cita só os orquestradores com skills desligadas", async () => {
    leitura.mockImplementation((orquestradorId) => Promise.resolve(listagemDe(orquestradorId, { o2: false })));
    montar();

    expect(await screen.findByRole("note")).toHaveTextContent(/^Skills desligadas em API de pagamentos: /);
  });

  it("mostra o erro da leitura das globais", async () => {
    leitura.mockRejectedValue(new Error("Não foi possível ler as skills."));
    montar();

    expect(await screen.findByText("Não foi possível ler as skills.")).toBeInTheDocument();
  });

  it("se a leitura de um projeto falha, a lista segue sem o grupo dele", async () => {
    leitura.mockImplementation((orquestradorId) =>
      orquestradorId === "o1" ? Promise.reject(new Error("falhou")) : Promise.resolve(listagemDe(orquestradorId)),
    );
    montar();

    expect(await screen.findByText("migrar-banco")).toBeInTheDocument();
    expect(screen.queryByText("publicar-site")).not.toBeInTheDocument();
    expect(titulosDosGrupos()).toEqual(["Plugins", "Suas skills", "Do projeto API de pagamentos", "Da sua conta Claude"]);
  });

  it("se os plugins instalados não carregam, as skills seguem e o erro aparece no lugar dos plugins", async () => {
    instalados.mockRejectedValue(new ErroDaApi("O Claude Code não respondeu.", 502));
    montar();

    expect(await screen.findByRole("alert")).toHaveTextContent("Não deu para ler os plugins instalados. O Claude Code não respondeu.");
    expect(screen.getByText("revisor")).toBeInTheDocument();
    // Sem a lista de plugins, a skill de plugin cai no grupo da conta, em vez de sumir.
    expect(screen.getByText("context7-mcp")).toBeInTheDocument();
  });

  it("mostra o vazio quando não há nenhuma skill nem plugin", async () => {
    leitura.mockResolvedValue({ skills: [], liberadasNoNivel: true });
    instalados.mockResolvedValue({ plugins: [] });
    montar();

    expect(await screen.findByText("Nenhuma skill encontrada")).toBeInTheDocument();
  });

  it("a aba Instaladas leva a contagem de skills do menu", async () => {
    montar({ quantidadeDeSkills: 15 });
    await screen.findByText("publicar-site");

    expect(screen.getByRole("tab", { name: "Instaladas 15" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Explorar" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("PainelDeSkills: abas e Explorar", () => {
  it("abre em Explorar quando pedido, sem ler as instaladas enquanto a outra aba não for visitada", async () => {
    montar({ abaInicial: "explorar" });

    expect(await screen.findByText("apollo-skills")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Explorar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("searchbox", { name: "Buscar plugin" })).toBeInTheDocument();
    expect(instalados).not.toHaveBeenCalled();
    expect(leitura).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Instaladas" }));

    expect(await screen.findByText("publicar-site")).toBeInTheDocument();
    expect(instalados).toHaveBeenCalledTimes(1);
  });

  it("trocar de aba mostra uma de cada vez e Instaladas não chama o catálogo", async () => {
    montar();
    await screen.findByText("publicar-site");
    expect(catalogo).not.toHaveBeenCalled();
    expect(screen.getByText("O que o Claude Code tem cadastrado. Os agentes carregam a skill certa pelo pedido.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Explorar" }));

    expect(await screen.findByText("apollo-skills")).toBeInTheDocument();
    expect(catalogo).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Habilidades extras que seus agentes carregam sozinhos, pelo pedido.")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Buscar skill por nome ou descrição" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Buscar skill por nome ou descrição", hidden: true })).not.toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: /Instaladas/ }));
    expect(screen.getByText("publicar-site")).toBeVisible();
    // Voltar a Explorar não consulta o catálogo de novo.
    fireEvent.click(screen.getByRole("tab", { name: "Explorar" }));
    expect(catalogo).toHaveBeenCalledTimes(1);
  });

  it("o Ver instaladas da tela sem internet leva à aba Instaladas", async () => {
    catalogo.mockRejectedValue(new ErroDaApi("Sem rede.", 503));
    montar({ abaInicial: "explorar" });

    fireEvent.click(await screen.findByRole("button", { name: "Ver instaladas" }));

    expect(screen.getByRole("tab", { name: /Instaladas/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("publicar-site")).toBeInTheDocument();
  });

  it("instalar um plugin avisa o menu e a aba Instaladas lê de novo, sem piscar", async () => {
    vi.spyOn(api, "instalarPlugin").mockResolvedValue({ plugin: { ...APOLLO_INSTALADO, ligado: true, inventario: { ...APOLLO_INSTALADO.inventario, hooks: 0 } }, precisaConfirmar: false });
    const { aoMudarPlugins } = montar();
    await screen.findByText("publicar-site");
    fireEvent.click(screen.getByRole("tab", { name: "Explorar" }));
    await screen.findByText("apollo-skills");

    fireEvent.click(screen.getByRole("button", { name: "Instalar apollo-skills" }));

    await waitFor(() => expect(aoMudarPlugins).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(instalados).toHaveBeenCalledTimes(2));
    expect(screen.getByText("publicar-site")).toBeInTheDocument();
  });
});

describe("PainelDeSkills: confirmação de hook", () => {
  async function instalarApolloComHook() {
    vi.spyOn(api, "instalarPlugin").mockResolvedValue({ plugin: APOLLO_INSTALADO, precisaConfirmar: true });
    const painel = montar({ abaInicial: "explorar" });
    fireEvent.click(await screen.findByRole("button", { name: "Instalar apollo-skills" }));
    const dialogo = await screen.findByRole("dialog");
    return { ...painel, dialogo };
  }

  it("depois de instalar com hook, o plugin chega desligado e a confirmação cobre o painel, com o foco em Manter desligado", async () => {
    const { dialogo } = await instalarApolloComHook();

    expect(within(dialogo).getByRole("heading", { name: "apollo-skills foi instalado e está desligado" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Manter desligado" })).toHaveFocus();
    expect(within(dialogo).getByRole("link", { name: /Ver o código/ })).toHaveAttribute("href", "https://github.com/apollographql/skills");
  });

  it("Ligar o plugin chama a API de ligar, fecha a confirmação e avisa o menu", async () => {
    const ligar = vi.spyOn(api, "ligarPlugin").mockResolvedValue({ plugin: { ...APOLLO_INSTALADO, ligado: true } });
    const { dialogo, aoMudarPlugins } = await instalarApolloComHook();
    aoMudarPlugins.mockClear();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Ligar o plugin" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(ligar).toHaveBeenCalledWith("apollo-skills@claude-plugins-official");
    expect(aoMudarPlugins).toHaveBeenCalledTimes(1);
  });

  it("Manter desligado fecha a confirmação sem ligar nada", async () => {
    const ligar = vi.spyOn(api, "ligarPlugin");
    const { dialogo } = await instalarApolloComHook();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Manter desligado" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ligar).not.toHaveBeenCalled();
  });

  it("o Esc na confirmação equivale a Manter desligado e não fecha o painel", async () => {
    const ligar = vi.spyOn(api, "ligarPlugin");
    const { dialogo, aoFechar } = await instalarApolloComHook();

    fireEvent.keyDown(within(dialogo).getByRole("button", { name: "Manter desligado" }), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ligar).not.toHaveBeenCalled();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("se ligar falha, a confirmação fica com a mensagem do servidor", async () => {
    vi.spyOn(api, "ligarPlugin").mockRejectedValue(new ErroDaApi("O Claude Code falhou ao ligar.", 502));
    const { dialogo } = await instalarApolloComHook();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Ligar o plugin" }));

    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("O Claude Code falhou ao ligar.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Revisar e ligar, em Instaladas, abre a mesma confirmação (sem dizer que acabou de instalar) e Ligar liga", async () => {
    instalados.mockResolvedValue({ plugins: [APOLLO_INSTALADO] });
    const ligar = vi.spyOn(api, "ligarPlugin").mockResolvedValue({ plugin: { ...APOLLO_INSTALADO, ligado: true } });
    montar();

    fireEvent.click(await screen.findByRole("button", { name: "Revisar e ligar" }));

    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("heading", { name: "apollo-skills está desligado" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Ligar o plugin" }));
    await waitFor(() => expect(ligar).toHaveBeenCalledWith("apollo-skills@claude-plugins-official"));
  });
});

describe("PainelDeSkills: teclado e fechar", () => {
  it("fecha pelo X e pelo Esc, e não tem mais o botão Fechar do rodapé", async () => {
    const { aoFechar } = montar();
    await waitFor(() => expect(screen.getByText("publicar-site")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Fechar skills" }));
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(aoFechar).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Fechar" })).not.toBeInTheDocument();
  });

  it("a tecla / leva o foco à busca da aba aberta, mas não atrapalha quem já está digitando", async () => {
    montar();
    await screen.findByText("publicar-site");
    const busca = screen.getByRole("searchbox", { name: "Buscar skill por nome ou descrição" });

    fireEvent.keyDown(document.body, { key: "/" });
    expect(busca).toHaveFocus();

    const naoCapturou = fireEvent.keyDown(busca, { key: "/" });
    expect(naoCapturou).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "Explorar" }));
    await screen.findByText("apollo-skills");
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(screen.getByRole("searchbox", { name: "Buscar plugin" })).toHaveFocus();
  });

  it("a casca é o painel de skills do Claude Code, com as duas abas", async () => {
    montar();
    await screen.findByText("publicar-site");

    const painel = screen.getByRole("region", { name: "Skills do Claude Code" });
    expect(within(painel).getAllByRole("tab").map((aba) => aba.textContent)).toEqual(["Instaladas", "Explorar"]);
    expect(within(painel).getByRole("tablist")).toBeInTheDocument();
  });
});
