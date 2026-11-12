import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { ListagemDoCatalogo, PluginDoCatalogo, PluginInstalado } from "../../shared/api/tipos";
import { CatalogoDePlugins } from "./CatalogoDePlugins";

const TOTAIS = { oficial: 317, aberto: 3662 };

function plugin(nome: string, extras: Partial<PluginDoCatalogo> = {}): PluginDoCatalogo {
  return {
    id: `${nome}@claude-plugins-official`,
    nome,
    descricao: `Descrição de ${nome}.`,
    marketplace: "claude-plugins-official",
    oficial: true,
    instalacoes: 1204,
    versao: "0.3.1",
    fonte: "github.com/apollographql/skills",
    instalado: false,
    ...extras,
  };
}

const OFICIAIS = [plugin("frontend-design", { instalacoes: 41230 }), plugin("context7"), plugin("apollo-skills", { instalacoes: 431 })];
const ABERTOS = [
  plugin("pdf-toolkit", {
    id: "pdf-toolkit@comunidade",
    oficial: false,
    marketplace: "comunidade",
    fonte: "https://github.com/lumen-labs/pdf-toolkit",
    instalacoes: 873,
  }),
];

function pagina(plugins: PluginDoCatalogo[], total = plugins.length): ListagemDoCatalogo {
  return { plugins, total, totais: TOTAIS };
}

function instalado(dados: PluginDoCatalogo, hooks = 0): PluginInstalado {
  return {
    id: dados.id,
    nome: dados.nome,
    marketplace: dados.marketplace,
    oficial: dados.oficial,
    versao: dados.versao,
    ligado: hooks === 0,
    instaladoEm: null,
    inventario: { skills: [{ nome: "uma", descricao: "" }], subagentes: 0, servidoresMcp: 0, hooks, verificado: true, temBin: false },
  };
}

let catalogo: MockInstance<typeof api.lerCatalogoDePlugins>;

beforeEach(() => {
  catalogo = vi.spyOn(api, "lerCatalogoDePlugins").mockImplementation((consulta) =>
    Promise.resolve(pagina(consulta?.origem === "aberto" ? ABERTOS : OFICIAIS)),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function montar() {
  const chamadas = { aoMudar: vi.fn(), aoPedirConfirmacao: vi.fn(), aoVerInstaladas: vi.fn() };
  render(<CatalogoDePlugins {...chamadas} />);
  return chamadas;
}

const linha = (nome: string) => {
  const elemento = document.querySelector<HTMLElement>(`.mk-linha[data-nome="${nome}"]`);
  if (elemento === null) {
    throw new Error(`Sem a linha de ${nome}`);
  }
  return elemento;
};

/** Espera a lista do catálogo aparecer. */
const esperarLista = () => screen.findByText("frontend-design");

describe("CatalogoDePlugins", () => {
  it("carrega o marketplace oficial por padrão, com o esqueleto enquanto espera", async () => {
    montar();

    expect(screen.getByText("Buscando o catálogo de plugins…")).toBeInTheDocument();
    expect(screen.getByText("Buscando o catálogo de plugins…").closest(".mk-lista")).toHaveAttribute("aria-busy", "true");
    await esperarLista();

    expect(catalogo).toHaveBeenCalledWith({ busca: "", origem: "oficial" }, expect.any(AbortSignal));
    expect(screen.queryByText("Buscando o catálogo de plugins…")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Instalar / })).toHaveLength(3);
  });

  it("cada linha mostra o avatar de iniciais, o selo Oficial, a descrição e o número de instalações", async () => {
    montar();
    await esperarLista();

    const primeira = linha("frontend-design");
    expect(within(primeira).getByText("FD")).toBeInTheDocument();
    expect(within(primeira).getByText("Oficial")).toBeInTheDocument();
    expect(within(primeira).getByText("Descrição de frontend-design.")).toBeInTheDocument();
    expect(within(primeira).getByText("41.230 instalações")).toBeInTheDocument();
    expect(within(primeira).getByRole("button", { name: "Instalar frontend-design" })).toBeInTheDocument();
    expect(within(linha("context7")).getByText("CO")).toBeInTheDocument();
  });

  it("a busca e os filtros usam os totais do catálogo, em pt-BR", async () => {
    montar();
    await esperarLista();

    expect(screen.getByRole("searchbox", { name: "Buscar plugin" })).toHaveAttribute("placeholder", "Buscar entre 317 plugins oficiais");
    const filtros = screen.getByRole("group", { name: "Onde procurar" });
    expect(within(filtros).getByRole("button", { name: /Oficial/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(filtros).getByRole("button", { name: /Oficial/ })).toHaveTextContent("317");
    expect(within(filtros).getByRole("button", { name: /Diretório aberto/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(filtros).getByRole("button", { name: /Diretório aberto/ })).toHaveTextContent("3.662");
    expect(screen.getByText("Mais instalados")).toBeInTheDocument();
    expect(screen.getByText(/^Catálogo de \d{2}\/\d{2}$/)).toBeInTheDocument();
  });

  it("o diretório aberto fica atrás do filtro, com o aviso de quem publica e a fonte na linha", async () => {
    montar();
    await esperarLista();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Diretório aberto/ }));

    expect(await screen.findByText("pdf-toolkit")).toBeInTheDocument();
    expect(catalogo).toHaveBeenLastCalledWith({ busca: "", origem: "aberto" }, expect.any(AbortSignal));
    expect(screen.getByRole("note")).toHaveTextContent(
      "Aqui qualquer pessoa publica. A Anthropic não revisa estes plugins. Olhe a fonte antes de instalar.",
    );
    expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", "Buscar entre 3.662 plugins do diretório");
    expect(within(linha("pdf-toolkit")).queryByText("Oficial")).not.toBeInTheDocument();
    expect(within(linha("pdf-toolkit")).getByText("github.com/lumen-labs/pdf-toolkit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Oficial/ }));
    expect(await screen.findByText("frontend-design")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("a busca espera um instante depois da última tecla e vai sem acento nem maiúscula", async () => {
    montar();
    await esperarLista();
    catalogo.mockClear();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Banco de Dádos" } });
    expect(catalogo).not.toHaveBeenCalled();

    await waitFor(() => expect(catalogo).toHaveBeenCalledTimes(1));
    expect(catalogo).toHaveBeenCalledWith({ busca: "banco de dados", origem: "oficial" }, expect.any(AbortSignal));
  });

  it("busca sem resultado no oficial oferece o diretório aberto e limpar a busca", async () => {
    montar();
    await esperarLista();
    catalogo.mockImplementation((consulta) =>
      Promise.resolve(pagina(consulta?.busca === "planilha xl" && consulta.origem === "oficial" ? [] : ABERTOS)),
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "planilha xl" } });

    expect(await screen.findByRole("heading", { name: "Nada para “planilha xl” no oficial" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Tente uma palavra só, ou em inglês, como o catálogo (por exemplo, spreadsheet). Também dá para procurar no diretório aberto.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Procurar no diretório aberto" }));
    expect(await screen.findByText("pdf-toolkit")).toBeInTheDocument();
    expect(catalogo).toHaveBeenLastCalledWith({ busca: "planilha xl", origem: "aberto" }, expect.any(AbortSignal));
  });

  it("limpar a busca volta ao catálogo inteiro", async () => {
    montar();
    await esperarLista();
    catalogo.mockImplementation((consulta) => Promise.resolve(pagina(consulta?.busca === "zzz" ? [] : OFICIAIS)));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    await screen.findByRole("heading", { name: "Nada para “zzz” no oficial" });

    fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));

    expect(await screen.findByText("frontend-design")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("no diretório aberto, a busca vazia não oferece procurar no próprio diretório", async () => {
    montar();
    await esperarLista();
    fireEvent.click(screen.getByRole("button", { name: /Diretório aberto/ }));
    await screen.findByText("pdf-toolkit");
    catalogo.mockResolvedValue(pagina([]));

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });

    expect(await screen.findByRole("heading", { name: "Nada para “xyz” no diretório aberto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Procurar no diretório aberto" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpar busca" })).toBeInTheDocument();
  });

  it("sem internet (503), mostra a tela própria, tenta de novo e leva às instaladas", async () => {
    catalogo.mockRejectedValue(new ErroDaApi("Sem conexão.", 503));
    const chamadas = montar();

    const alerta = await screen.findByRole("alert");
    expect(within(alerta).getByRole("heading", { name: "Sem conexão com a internet" })).toBeInTheDocument();
    expect(alerta).toHaveTextContent("Não deu para falar com o marketplace. Confira a rede e tente de novo. O que já está instalado continua funcionando.");
    expect(screen.getByText("sem catálogo")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver instaladas" }));
    expect(chamadas.aoVerInstaladas).toHaveBeenCalledTimes(1);

    catalogo.mockResolvedValue(pagina(OFICIAIS));
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("frontend-design")).toBeInTheDocument();
  });

  it("outro erro (504, 502) mostra a mensagem do servidor, não a de internet", async () => {
    catalogo.mockRejectedValue(new ErroDaApi("O catálogo demorou demais.", 504));
    montar();

    const alerta = await screen.findByRole("alert");

    expect(within(alerta).getByRole("heading", { name: "Não deu para abrir o catálogo" })).toBeInTheDocument();
    expect(alerta).toHaveTextContent("O catálogo demorou demais.");
    expect(alerta).not.toHaveTextContent("Sem conexão com a internet");
  });

  it("instalar mostra Instalando… com o texto de baixando, depois Instalado e o aviso de que já está em Instaladas", async () => {
    let concluir: (resultado: { plugin: PluginInstalado; precisaConfirmar: boolean }) => void = () => undefined;
    const instalar = vi.spyOn(api, "instalarPlugin").mockImplementation(
      () => new Promise((resolver) => (concluir = resolver)),
    );
    const chamadas = montar();
    await esperarLista();

    fireEvent.click(screen.getByRole("button", { name: "Instalar frontend-design" }));

    const primeira = linha("frontend-design");
    await waitFor(() => expect(instalar).toHaveBeenCalledWith("frontend-design@claude-plugins-official"));
    expect(within(primeira).getByRole("status")).toHaveTextContent("Instalando…");
    expect(within(primeira).getByText("Baixando do GitHub e preparando…")).toBeInTheDocument();
    expect(primeira.querySelector(".mk-progresso")).not.toBeNull();
    expect(within(primeira).queryByRole("button")).toBeInTheDocument(); // só o nome

    concluir({ plugin: instalado(OFICIAIS[0]!), precisaConfirmar: false });

    expect(await within(primeira).findByText("Instalado")).toBeInTheDocument();
    expect(within(primeira).getByText("Pronto. Ele já aparece em Instaladas.")).toBeInTheDocument();
    expect(chamadas.aoMudar).toHaveBeenCalledTimes(1);
    expect(chamadas.aoPedirConfirmacao).not.toHaveBeenCalled();
  });

  it("depois de instalar um plugin com hook, pede a confirmação com o plugin e a fonte", async () => {
    const dado = OFICIAIS[2]!;
    const doPlugin = instalado(dado, 1);
    vi.spyOn(api, "instalarPlugin").mockResolvedValue({ plugin: doPlugin, precisaConfirmar: true });
    const chamadas = montar();
    await esperarLista();

    fireEvent.click(screen.getByRole("button", { name: "Instalar apollo-skills" }));

    await waitFor(() => expect(chamadas.aoPedirConfirmacao).toHaveBeenCalledWith(doPlugin, "github.com/apollographql/skills"));
    expect(chamadas.aoMudar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["pasta bin", { temBin: true }],
    ["inventário não verificado", { verificado: false }],
  ])("depois de instalar um plugin com %s, também pede a confirmação", async (_nome, extras) => {
    const dado = OFICIAIS[2]!;
    const base = instalado(dado);
    const doPlugin = { ...base, ligado: false, inventario: { ...base.inventario, ...extras } };
    vi.spyOn(api, "instalarPlugin").mockResolvedValue({ plugin: doPlugin, precisaConfirmar: true });
    const chamadas = montar();
    await esperarLista();

    fireEvent.click(screen.getByRole("button", { name: "Instalar apollo-skills" }));

    await waitFor(() => expect(chamadas.aoPedirConfirmacao).toHaveBeenCalledWith(doPlugin, "github.com/apollographql/skills"));
  });

  it("erro de instalação sem internet diz isso e oferece Tentar de novo", async () => {
    const instalar = vi.spyOn(api, "instalarPlugin").mockRejectedValueOnce(new ErroDaApi("Sem rede.", 503));
    montar();
    await esperarLista();

    fireEvent.click(screen.getByRole("button", { name: "Instalar context7" }));

    const dela = linha("context7");
    expect(await within(dela).findByRole("alert")).toHaveTextContent("Não deu para baixar: sem conexão com a internet.");

    instalar.mockResolvedValueOnce({ plugin: instalado(OFICIAIS[1]!), precisaConfirmar: false });
    fireEvent.click(within(dela).getByRole("button", { name: "Tentar instalar context7 de novo" }));
    expect(await within(dela).findByText("Instalado")).toBeInTheDocument();
    expect(instalar).toHaveBeenCalledTimes(2);
  });

  it("outro erro de instalação mostra a mensagem do servidor", async () => {
    vi.spyOn(api, "instalarPlugin").mockRejectedValue(new ErroDaApi("O Claude Code falhou ao instalar.", 502));
    montar();
    await esperarLista();

    fireEvent.click(screen.getByRole("button", { name: "Instalar context7" }));

    expect(await within(linha("context7")).findByRole("alert")).toHaveTextContent("O Claude Code falhou ao instalar.");
  });

  it("as instalações vão uma por vez: a segunda só começa quando a primeira termina, e já mostra Instalando…", async () => {
    const concluidas: Array<() => void> = [];
    const instalar = vi.spyOn(api, "instalarPlugin").mockImplementation(
      (id) =>
        new Promise((resolver) =>
          concluidas.push(() => resolver({ plugin: instalado(OFICIAIS.find((p) => p.id === id)!), precisaConfirmar: false })),
        ),
    );
    montar();
    await esperarLista();

    fireEvent.click(screen.getByRole("button", { name: "Instalar frontend-design" }));
    fireEvent.click(screen.getByRole("button", { name: "Instalar context7" }));

    expect(within(linha("context7")).getByRole("status")).toHaveTextContent("Instalando…");
    await waitFor(() => expect(instalar).toHaveBeenCalledTimes(1));
    expect(instalar).toHaveBeenCalledWith("frontend-design@claude-plugins-official");

    concluidas[0]!();
    await waitFor(() => expect(instalar).toHaveBeenCalledTimes(2));
    expect(instalar).toHaveBeenLastCalledWith("context7@claude-plugins-official");
    concluidas[1]!();
    expect(await within(linha("context7")).findByText("Instalado")).toBeInTheDocument();
  });

  it("um plugin que o servidor diz já instalado mostra Instalado, sem botão de instalar", async () => {
    catalogo.mockResolvedValue(pagina([plugin("frontend-design", { instalado: true }), plugin("context7")]));
    montar();
    await esperarLista();

    expect(within(linha("frontend-design")).getByText("Instalado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Instalar frontend-design" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Instalar context7" })).toBeInTheDocument();
  });

  it("mostra mais: pede a próxima página a partir de quantos já chegaram e junta sem repetir", async () => {
    catalogo.mockImplementation((consulta) =>
      Promise.resolve(
        (consulta?.deslocamento ?? 0) > 0
          ? { plugins: [OFICIAIS[2]!, plugin("supabase")], total: 4, totais: TOTAIS }
          : { plugins: OFICIAIS.slice(0, 2), total: 4, totais: TOTAIS },
      ),
    );
    montar();
    await esperarLista();

    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais (2 de 4)" }));

    expect(await screen.findByText("supabase")).toBeInTheDocument();
    expect(catalogo).toHaveBeenLastCalledWith({ busca: "", origem: "oficial", deslocamento: 2 });
    expect(document.querySelectorAll(".mk-linha")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /Mostrar mais/ })).not.toBeInTheDocument();
  });

  it("sem mais plugins para carregar, não há o botão Mostrar mais", async () => {
    montar();
    await esperarLista();

    expect(screen.queryByRole("button", { name: /Mostrar mais/ })).not.toBeInTheDocument();
  });

  describe("você já tem", () => {
    const etiqueta = (nome: string) => within(linha(nome)).queryByText("Já tem algo parecido");

    it("a etiqueta aparece na linha com jaTem preenchido, sem balão, e a linha diz o quê (visível, não só para o leitor de tela)", async () => {
      catalogo.mockResolvedValue(
        pagina([
          plugin("context7", { jaTem: { skills: ["context7-mcp"], servidoresMcp: ["context7"] } }),
          plugin("frontend-design"),
        ]),
      );
      montar();
      await esperarLista();

      const marca = etiqueta("context7");
      expect(marca).toBeInTheDocument();
      expect(marca).not.toHaveAttribute("title");
      expect(marca?.querySelector(".sr-only")).toBeNull();
      const explicacao = within(linha("context7")).getByText(/^Você já tem a skill/);
      expect(explicacao).toHaveTextContent("Você já tem a skill context7-mcp e o servidor MCP context7.");
      expect(explicacao.closest(".mk-meta")).toHaveClass("mk-ja-tem-meta");
      expect(etiqueta("frontend-design")).not.toBeInTheDocument();
      expect(within(linha("frontend-design")).queryByText(/Você já tem/)).not.toBeInTheDocument();
    });

    describe("os três estados da linha", () => {
      const jaTem = { skills: ["context7-mcp"], servidoresMcp: ["context7"] };

      it("já tem algo parecido: botão Instalar mesmo assim em contorno neutro, ligado à linha do quê, sem laranja no hover", async () => {
        catalogo.mockResolvedValue(pagina([plugin("context7", { jaTem }), plugin("frontend-design")]));
        montar();
        await esperarLista();

        const botao = within(linha("context7")).getByRole("button", { name: "Instalar context7 mesmo assim" });
        expect(botao).toHaveTextContent("Instalar mesmo assim");
        expect(botao).toHaveClass("btn-outline", "mk-instalar-parecido");
        expect(botao).not.toHaveClass("btn-cta");
        const explicacao = within(linha("context7")).getByText(/^Você já tem a skill/).closest(".mk-meta") as HTMLElement;
        expect(botao).toHaveAttribute("aria-describedby", explicacao.id);
        // O CSS só pinta o botão de laranja no hover de linha sem data-ja-tem: a marca precisa estar na linha.
        expect(linha("context7")).toHaveAttribute("data-ja-tem");
        expect(linha("frontend-design")).not.toHaveAttribute("data-ja-tem");
        expect(within(linha("frontend-design")).getByRole("button", { name: "Instalar frontend-design" })).not.toHaveClass(
          "mk-instalar-parecido",
        );
        // O balão de antes saiu.
        expect(document.querySelector('[title*="duplicar"]')).toBeNull();
      });

      it("Instalar mesmo assim ainda instala, e a linha vira Instalado com o aviso de que agora tem os dois", async () => {
        const instalar = vi.spyOn(api, "instalarPlugin").mockResolvedValue({ plugin: instalado(OFICIAIS[1]!), precisaConfirmar: false });
        catalogo.mockResolvedValue(pagina([plugin("context7", { jaTem }), plugin("frontend-design")]));
        const chamadas = montar();
        await esperarLista();

        fireEvent.click(screen.getByRole("button", { name: "Instalar context7 mesmo assim" }));

        expect(await within(linha("context7")).findByText("Instalado")).toBeInTheDocument();
        expect(instalar).toHaveBeenCalledWith("context7@claude-plugins-official");
        expect(chamadas.aoMudar).toHaveBeenCalledTimes(1);
        expect(within(linha("context7")).getByText("Pronto. Ele já aparece em Instaladas. Você agora tem os dois.")).toBeInTheDocument();
        expect(within(linha("context7")).queryByRole("button", { name: /mesmo assim/ })).not.toBeInTheDocument();
      });

      it("instalado vence o já tem: só o ✓ Instalado, sem botão de instalar nem etiqueta, mesmo com jaTem preenchido", async () => {
        catalogo.mockResolvedValue(pagina([plugin("context7", { instalado: true, jaTem }), plugin("frontend-design")]));
        montar();
        await esperarLista();

        const dele = within(linha("context7"));
        expect(dele.getByText("Instalado")).toBeInTheDocument();
        expect(dele.getByText("Está em Instaladas.")).toBeInTheDocument();
        expect(dele.queryByRole("button", { name: /^Instalar / })).not.toBeInTheDocument();
        expect(dele.queryByText("Já tem algo parecido")).not.toBeInTheDocument();
        expect(dele.queryByText(/Você já tem/)).not.toBeInTheDocument();
        expect(linha("context7")).not.toHaveAttribute("data-ja-tem");
      });

      it("nada a ver: segue como sempre, com Instalar, a contagem de instalações e o hover laranja", async () => {
        catalogo.mockResolvedValue(pagina([plugin("playwright", { instalacoes: 12045 }), plugin("frontend-design")]));
        montar();
        await screen.findByText("playwright");

        const dele = within(linha("playwright"));
        expect(dele.getByRole("button", { name: "Instalar playwright" })).toHaveTextContent(/^Instalar$/);
        expect(dele.getByRole("button", { name: "Instalar playwright" })).not.toHaveAttribute("aria-describedby");
        expect(dele.getByText("12.045 instalações")).toBeInTheDocument();
        expect(linha("playwright")).not.toHaveAttribute("data-ja-tem");
      });
    });

    it.each([
      ["vazio", { jaTem: { skills: [], servidoresMcp: [] } }],
      ["ausente (resposta de servidor antigo)", {}],
      ["com o plugin já instalado", { instalado: true, jaTem: { skills: ["context7-mcp"], servidoresMcp: [] } }],
    ])("a etiqueta some com jaTem %s", async (_nome, extras: Partial<PluginDoCatalogo>) => {
      catalogo.mockResolvedValue(pagina([plugin("context7", extras), plugin("frontend-design")]));
      montar();
      await esperarLista();

      expect(etiqueta("context7")).not.toBeInTheDocument();
    });

    it("depois de instalar, a etiqueta sai da linha", async () => {
      vi.spyOn(api, "instalarPlugin").mockResolvedValue({ plugin: instalado(OFICIAIS[1]!), precisaConfirmar: false });
      catalogo.mockResolvedValue(
        pagina([plugin("context7", { jaTem: { skills: ["context7-mcp"], servidoresMcp: [] } }), plugin("frontend-design")]),
      );
      montar();
      await esperarLista();

      fireEvent.click(screen.getByRole("button", { name: "Instalar context7 mesmo assim" }));

      expect(await within(linha("context7")).findByText("Instalado")).toBeInTheDocument();
      expect(etiqueta("context7")).not.toBeInTheDocument();
    });

    const abrirDetalhe = async (jaTem: PluginDoCatalogo["jaTem"]) => {
      catalogo.mockResolvedValue(pagina([plugin("context7", { jaTem }), plugin("frontend-design")]));
      const chamadas = montar();
      await esperarLista();
      fireEvent.click(linha("context7"));
      await screen.findByRole("heading", { level: 3, name: "context7" });
      return chamadas;
    };

    it("com skill e servidor MCP, a frase cita os dois e o botão vira Instalar mesmo assim", async () => {
      await abrirDetalhe({ skills: ["context7-mcp"], servidoresMcp: ["context7"] });

      const aviso = screen.getByRole("note");
      expect(aviso).toHaveTextContent(
        "Você já tem a skill context7-mcp e o servidor MCP context7. Este plugin parece trazer o mesmo serviço, e instalar pode duplicar.",
      );
      const botao = screen.getByRole("button", { name: "Instalar mesmo assim" });
      expect(botao).toHaveAttribute("aria-describedby", aviso.id);
      // Contorno neutro: o laranja cheio é do Instalar de quem não tem nada parecido.
      expect(botao).toHaveClass("btn-outline");
      expect(botao).not.toHaveClass("btn-cta");
      expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();
    });

    it("só com servidor MCP, a frase fala só do servidor", async () => {
      await abrirDetalhe({ skills: [], servidoresMcp: ["context7"] });

      expect(screen.getByRole("note")).toHaveTextContent(
        "Você já tem o servidor MCP context7. Este plugin parece trazer o mesmo serviço, e instalar pode duplicar.",
      );
    });

    it("só com skill, a frase fala só da skill", async () => {
      await abrirDetalhe({ skills: ["context7-mcp"], servidoresMcp: [] });

      expect(screen.getByRole("note")).toHaveTextContent("Você já tem a skill context7-mcp. Este plugin");
    });

    it("com vários nomes, usa o plural e junta com vírgula e e", async () => {
      await abrirDetalhe({ skills: ["a-um", "a-dois", "a-tres"], servidoresMcp: ["m-um", "m-dois"] });

      expect(screen.getByRole("note")).toHaveTextContent(
        "Você já tem as skills a-um, a-dois e a-tres e os servidores MCP m-um e m-dois. Este plugin",
      );
    });

    it("sem nada parecido, o detalhe segue com Instalar e sem aviso", async () => {
      await abrirDetalhe({ skills: [], servidoresMcp: [] });

      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Instalar" })).not.toHaveAttribute("aria-describedby");
      expect(screen.getByRole("button", { name: "Instalar" })).toHaveClass("btn-cta");
      expect(screen.queryByRole("button", { name: "Instalar mesmo assim" })).not.toBeInTheDocument();
    });

    it("Instalar mesmo assim continua instalando, e o aviso some quando termina", async () => {
      const instalar = vi.spyOn(api, "instalarPlugin").mockResolvedValue({ plugin: instalado(OFICIAIS[1]!), precisaConfirmar: false });
      const chamadas = await abrirDetalhe({ skills: ["context7-mcp"], servidoresMcp: [] });

      fireEvent.click(screen.getByRole("button", { name: "Instalar mesmo assim" }));

      expect(await screen.findByText("Instalado")).toBeInTheDocument();
      expect(instalar).toHaveBeenCalledWith("context7@claude-plugins-official");
      expect(chamadas.aoMudar).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });
  });

  describe("detalhe", () => {
    it("clicar na linha abre o detalhe com a ficha, o link do código e o que se sabe antes de instalar", async () => {
      montar();
      await esperarLista();

      fireEvent.click(linha("apollo-skills"));

      expect(await screen.findByRole("heading", { level: 3, name: "apollo-skills" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Explorar" })).toHaveFocus();
      expect(screen.getByText("claude-plugins-official")).toBeInTheDocument();
      expect(screen.getByText("Descrição de apollo-skills.")).toBeInTheDocument();
      const ficha = document.querySelector(".mk-ficha") as HTMLElement;
      expect(ficha).toHaveTextContent("Instalações431");
      expect(ficha).toHaveTextContent("Versão0.3.1");
      expect(ficha).toHaveTextContent("MarketplaceOficial");
      expect(ficha).toHaveTextContent("Fontegithub.com/apollographql/skills");
      const ver = screen.getByRole("link", { name: /Ver no GitHub/ });
      expect(ver).toHaveAttribute("href", "https://github.com/apollographql/skills");
      expect(ver).toHaveAttribute("target", "_blank");
      expect(screen.getByText("Antes de instalar")).toBeInTheDocument();
      expect(screen.getByText("Instala no Claude Code, não só aqui")).toBeInTheDocument();
      expect(screen.getByText("O que vem dentro, você vê depois")).toBeInTheDocument();
      expect(screen.getByText("Se pedir cuidado, ele chega desligado")).toBeInTheDocument();
      expect(screen.getByText("Precisa de internet para instalar.")).toBeInTheDocument();
      // A lista saiu do lugar.
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });

    it("o nome da linha também abre o detalhe, e Explorar e o Esc voltam para a lista", async () => {
      montar();
      await esperarLista();

      fireEvent.click(within(linha("context7")).getByRole("button", { name: "context7" }));
      expect(await screen.findByRole("heading", { level: 3, name: "context7" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Explorar" }));
      expect(await screen.findByRole("searchbox")).toBeInTheDocument();

      fireEvent.click(linha("context7"));
      const caixa = await screen.findByRole("heading", { level: 3, name: "context7" });
      const naoFechou = fireEvent.keyDown(caixa, { key: "Escape" });
      expect(naoFechou).toBe(false); // o Esc foi tratado aqui (preventDefault): não fecha o painel
      expect(await screen.findByRole("searchbox")).toBeInTheDocument();
    });

    it("instalar pelo detalhe usa a mesma instalação e mostra o resultado ali", async () => {
      vi.spyOn(api, "instalarPlugin").mockResolvedValue({ plugin: instalado(OFICIAIS[1]!), precisaConfirmar: false });
      const chamadas = montar();
      await esperarLista();
      fireEvent.click(linha("context7"));

      fireEvent.click(await screen.findByRole("button", { name: "Instalar" }));

      expect(await screen.findByText("Instalado")).toBeInTheDocument();
      expect(screen.getByText("Pronto. Ele já aparece em Instaladas.")).toBeInTheDocument();
      expect(chamadas.aoMudar).toHaveBeenCalledTimes(1);
    });

    it("sem fonte conhecida, o detalhe não mostra Fonte nem link, e o diretório mostra o marketplace", async () => {
      catalogo.mockResolvedValue(pagina([plugin("sem-fonte", { fonte: null, instalacoes: null, versao: null, oficial: false, marketplace: "comunidade" })]));
      montar();
      await screen.findByText("sem-fonte");

      fireEvent.click(linha("sem-fonte"));

      const ficha = (await screen.findByRole("heading", { level: 3, name: "sem-fonte" })).closest(".mk-detalhe")!.querySelector(".mk-ficha") as HTMLElement;
      expect(ficha).toHaveTextContent("Marketplacecomunidade");
      expect(ficha).not.toHaveTextContent("Fonte");
      expect(ficha).not.toHaveTextContent("Instalações");
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });
});
