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

  function abrir(lista = recentes) {
    const aoEscolher = vi.fn();
    const resultado = render(<EscolhaDePasta recentes={lista} aoEscolher={aoEscolher} conectado />);
    return { aoEscolher, ...resultado };
  }

  const botaoDaJanela = () => screen.getByRole("button", { name: /Escolher pasta do projeto/ });

  it("a janela do sistema devolve a pasta escolhida, abrindo na recente mais nova", async () => {
    const escolher = vi.spyOn(api, "escolherPastaNoSistema").mockResolvedValue({ caminho: "/u/outro" });
    const { aoEscolher } = abrir();

    fireEvent.click(botaoDaJanela());

    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith("/u/outro"));
    expect(escolher).toHaveBeenCalledWith("/u/projetos/meu-app", expect.any(AbortSignal));
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
    abrir();

    fireEvent.click(botaoDaJanela());

    expect(await screen.findByText(/Escolha a pasta aqui mesmo/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Usar “projetos”" })).toBeInTheDocument();
  });

  it("uma recente escolhe com um clique", () => {
    const { aoEscolher } = abrir();

    fireEvent.click(screen.getByRole("button", { name: /site/ }));

    expect(aoEscolher).toHaveBeenCalledWith("/d/site");
  });

  it("sem recentes, não mostra a seção", () => {
    abrir([]);

    expect(screen.queryByRole("list", { name: "Pastas recentes" })).not.toBeInTheDocument();
  });

  it("'procurar aqui dentro' abre o navegador, e 'voltar' retorna", async () => {
    vi.spyOn(api, "listarPastas").mockResolvedValue(projetos);
    abrir();

    fireEvent.click(screen.getByRole("button", { name: "ou procurar a pasta aqui dentro" }));
    expect(await screen.findByRole("button", { name: "Usar “projetos”" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "‹ voltar" }));

    expect(botaoDaJanela()).toBeInTheDocument();
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
