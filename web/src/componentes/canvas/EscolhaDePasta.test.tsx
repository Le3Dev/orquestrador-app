import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { ConteudoDaPasta } from "../../shared/api/tipos";
import { EscolhaDePasta } from "./EscolhaDePasta";

const recentes = [
  { nome: "meu-app", caminho: "/u/projetos/meu-app" },
  { nome: "site", caminho: "/d/site" },
];

const projetos: ConteudoDaPasta = {
  raiz: "/u/projetos",
  atual: "/u/projetos",
  acima: "/u",
  pastas: [],
  atalhos: [],
};

describe("EscolhaDePasta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function abrir({ lista = recentes, pasta = "", nomeEditado = false } = {}) {
    const aoEscolher = vi.fn();
    const aoUsarNomeDaPasta = vi.fn();
    const resultado = render(
      <EscolhaDePasta
        pasta={pasta}
        recentes={lista}
        aoEscolher={aoEscolher}
        conectado
        nome="API"
        aoMudarNome={vi.fn()}
        nomeEditado={nomeEditado}
        aoUsarNomeDaPasta={aoUsarNomeDaPasta}
      />,
    );
    return { aoEscolher, aoUsarNomeDaPasta, ...resultado };
  }

  const botaoDaJanela = () => screen.getByRole("button", { name: "Escolher pasta…" });

  it("sem pasta, mostra o cartão vazio e o botão da janela do sistema", () => {
    abrir();

    expect(screen.getByText("Nenhuma pasta escolhida")).toBeInTheDocument();
    expect(screen.getByText("Escolha uma recente ou abra a janela do sistema")).toBeInTheDocument();
    expect(botaoDaJanela()).toBeEnabled();
  });

  it("a janela do sistema devolve a pasta escolhida, abrindo na recente mais nova", async () => {
    const escolher = vi.spyOn(api, "escolherPastaNoSistema").mockResolvedValue({ caminho: "/u/outro" });
    const { aoEscolher } = abrir();

    fireEvent.click(botaoDaJanela());

    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith("/u/outro"));
    expect(escolher).toHaveBeenCalledWith("/u/projetos/meu-app", expect.any(AbortSignal));
  });

  it("com pasta, \"Trocar…\" abre a janela do sistema na pasta atual", async () => {
    const escolher = vi.spyOn(api, "escolherPastaNoSistema").mockResolvedValue({ caminho: null });
    abrir({ pasta: "/d/site" });

    fireEvent.click(screen.getByRole("button", { name: "Trocar…" }));

    await waitFor(() => expect(escolher).toHaveBeenCalledWith("/d/site", expect.any(AbortSignal)));
  });

  it("enquanto a janela está aberta, explica onde ela está e deixa cancelar", async () => {
    let sinal: AbortSignal | undefined;
    vi.spyOn(api, "escolherPastaNoSistema").mockImplementation((_inicial, recebido) => {
      sinal = recebido;
      return new Promise(() => undefined);
    });
    const { aoEscolher } = abrir();

    fireEvent.click(botaoDaJanela());

    expect(await screen.findByText("Abrimos a janela de escolher pasta")).toBeInTheDocument();
    expect(screen.getByText(/barra de tarefas ou o Dock/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /meu-app/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "cancelar" }));
    expect(sinal?.aborted).toBe(true);
    expect(botaoDaJanela()).toBeInTheDocument();
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("cancelar na própria janela volta ao início sem erro", async () => {
    vi.spyOn(api, "escolherPastaNoSistema").mockResolvedValue({ caminho: null });
    const { aoEscolher } = abrir();

    fireEvent.click(botaoDaJanela());

    await waitFor(() => expect(botaoDaJanela()).toBeInTheDocument());
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(screen.queryByText(/✗/)).not.toBeInTheDocument();
  });

  it("sem janela no sistema (503), abre o navegador daqui com o aviso", async () => {
    vi.spyOn(api, "escolherPastaNoSistema").mockRejectedValue(
      new ErroDaApi("Não deu para abrir a janela do sistema. Escolha a pasta aqui mesmo.", 503),
    );
    vi.spyOn(api, "listarPastas").mockResolvedValue(projetos);
    const { aoEscolher } = abrir();

    fireEvent.click(botaoDaJanela());

    expect(await screen.findByText(/Escolha a pasta aqui mesmo/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Usar “projetos”" }));
    expect(aoEscolher).toHaveBeenCalledWith("/u/projetos");
  });

  it("outra falha da janela mostra o erro e continua no início", async () => {
    vi.spyOn(api, "escolherPastaNoSistema").mockRejectedValue(new ErroDaApi("Falhou feio.", 500));
    abrir();

    fireEvent.click(botaoDaJanela());

    expect(await screen.findByText("✗ Falhou feio.")).toBeInTheDocument();
    expect(botaoDaJanela()).toBeInTheDocument();
  });

  it("uma recente escolhe com um clique, e a escolhida fica marcada", () => {
    const { aoEscolher, unmount } = abrir();
    fireEvent.click(screen.getByRole("button", { name: /site/ }));
    expect(aoEscolher).toHaveBeenCalledWith("/d/site");
    unmount();

    abrir({ pasta: "/d/site" });
    expect(screen.getByRole("button", { name: /site/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /meu-app/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("sem recentes, não mostra a lista", () => {
    abrir({ lista: [] });

    expect(screen.queryByRole("list", { name: "Pastas recentes" })).not.toBeInTheDocument();
  });

  it("'procurar aqui dentro' abre o navegador, e 'voltar' retorna", async () => {
    vi.spyOn(api, "listarPastas").mockResolvedValue(projetos);
    abrir();

    fireEvent.click(screen.getByRole("button", { name: "ou procurar aqui dentro" }));
    expect(await screen.findByRole("button", { name: "Usar “projetos”" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "‹ voltar" }));

    expect(botaoDaJanela()).toBeInTheDocument();
  });

  it("com pasta, o cartão mostra o nome editável, o caminho e o atalho para o nome da pasta", () => {
    const { aoUsarNomeDaPasta } = abrir({ pasta: "/d/site", nomeEditado: true });

    expect(screen.getByRole("textbox", { name: "Nome do orquestrador" })).toHaveValue("API");
    expect(screen.getByText("/d/site")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "usar nome da pasta" }));
    expect(aoUsarNomeDaPasta).toHaveBeenCalled();
  });

  it("descartar o rascunho com a janela aberta fecha a janela", async () => {
    let sinal: AbortSignal | undefined;
    vi.spyOn(api, "escolherPastaNoSistema").mockImplementation((_inicial, recebido) => {
      sinal = recebido;
      return new Promise(() => undefined);
    });
    const { unmount } = abrir();
    fireEvent.click(botaoDaJanela());
    await screen.findByText("Abrimos a janela de escolher pasta");

    unmount();

    expect(sinal?.aborted).toBe(true);
  });
});
