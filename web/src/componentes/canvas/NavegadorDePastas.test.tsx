import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { ConteudoDaPasta } from "../../shared/api/tipos";
import { NavegadorDePastas } from "./NavegadorDePastas";

const projetos: ConteudoDaPasta = {
  raiz: "/u/projetos",
  atual: "/u/projetos",
  acima: "/u",
  pastas: [
    { nome: "api", caminho: "/u/projetos/api" },
    { nome: "painel", caminho: "/u/projetos/painel" },
  ],
  atalhos: [
    { nome: "Projetos", caminho: "/u/projetos" },
    { nome: "Pasta pessoal", caminho: "/u" },
  ],
};

function pasta(atual: string, acima: string | null, nomes: string[] = []): ConteudoDaPasta {
  return { ...projetos, atual, acima, pastas: nomes.map((nome) => ({ nome, caminho: `${atual}/${nome}` })) };
}

describe("NavegadorDePastas", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function abrir(conectado = true, valor = "") {
    const aoEscolher = vi.fn();
    const resultado = render(
      <NavegadorDePastas id="pasta" valor={valor} aoEscolher={aoEscolher} conectado={conectado} />,
    );
    return { aoEscolher, ...resultado };
  }

  it("abre a pasta dos projetos sem escolher nenhuma", async () => {
    const listar = vi.spyOn(api, "listarPastas").mockResolvedValue(projetos);
    const { aoEscolher } = abrir();

    const lista = await screen.findByRole("list", { name: "Subpastas" });
    expect(listar).toHaveBeenCalledWith(undefined);
    expect(within(lista).getByRole("button", { name: /painel/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("/u/projetos");
    expect(screen.getByRole("button", { name: "Usar esta pasta" })).toBeInTheDocument();
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("entrar numa subpasta abre e escolhe a pasta", async () => {
    const listar = vi
      .spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockResolvedValueOnce(pasta("/u/projetos/painel", "/u/projetos", ["src"]));
    const { aoEscolher } = abrir();

    fireEvent.click(await screen.findByRole("button", { name: /painel/ }));

    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith("/u/projetos/painel"));
    expect(listar).toHaveBeenLastCalledWith("/u/projetos/painel");
    expect(await screen.findByRole("button", { name: /src/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("/u/projetos/painel");
  });

  it("sobe para a pasta acima e usa os atalhos, fora da pasta dos projetos", async () => {
    const listar = vi
      .spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockResolvedValueOnce(pasta("/u", "/", ["Documentos"]))
      .mockResolvedValueOnce(pasta("/u", "/", ["Documentos"]));
    const { aoEscolher } = abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Pasta acima" }));
    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith("/u"));
    fireEvent.click(await screen.findByRole("button", { name: "Pasta pessoal" }));

    await waitFor(() => expect(listar).toHaveBeenCalledTimes(3));
    expect(listar).toHaveBeenNthCalledWith(2, "/u");
    expect(listar).toHaveBeenNthCalledWith(3, "/u");
  });

  it("na raiz do disco, o botão de subir fica desabilitado", async () => {
    vi.spyOn(api, "listarPastas").mockResolvedValue(pasta("/", null, ["Users"]));
    abrir();

    expect(await screen.findByRole("button", { name: "Pasta acima" })).toBeDisabled();
  });

  it("um caminho digitado abre com Enter, sem enviar o formulário", async () => {
    const listar = vi
      .spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockResolvedValueOnce(pasta("/opt/outro", "/opt"));
    const enviar = vi.fn((evento: Event) => evento.preventDefault());
    const aoEscolher = vi.fn();
    render(
      <form onSubmit={(evento) => enviar(evento.nativeEvent)}>
        <NavegadorDePastas id="pasta" valor="" aoEscolher={aoEscolher} conectado />
      </form>,
    );
    const campo = await screen.findByDisplayValue("/u/projetos");

    fireEvent.change(campo, { target: { value: "  /opt/outro " } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith("/opt/outro"));
    expect(listar).toHaveBeenLastCalledWith("/opt/outro");
    expect(enviar).not.toHaveBeenCalled();
    expect(await screen.findByText("nenhuma subpasta")).toBeInTheDocument();
  });

  it("caminho inválido mostra o erro e mantém a pasta aberta", async () => {
    vi.spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockRejectedValueOnce(new Error('A pasta "/nada" não existe.'));
    const { aoEscolher } = abrir();
    const campo = await screen.findByDisplayValue("/u/projetos");

    fireEvent.change(campo, { target: { value: "/nada" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByText(/A pasta "\/nada" não existe\./)).toBeInTheDocument();
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /painel/ })).toBeInTheDocument();
  });

  it("'Usar esta pasta' escolhe a pasta aberta; escolhida, mostra a confirmação", async () => {
    vi.spyOn(api, "listarPastas").mockResolvedValue(projetos);
    const { aoEscolher, rerender } = abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Usar esta pasta" }));
    expect(aoEscolher).toHaveBeenCalledWith("/u/projetos");

    rerender(<NavegadorDePastas id="pasta" valor="/u/projetos" aoEscolher={aoEscolher} conectado />);
    expect(screen.queryByRole("button", { name: "Usar esta pasta" })).not.toBeInTheDocument();
    expect(screen.getByText(/Escolhida:/)).toHaveTextContent("✓ Escolhida: projetos");
  });

  it("com o servidor fora, espera ele voltar para carregar", async () => {
    const listar = vi.spyOn(api, "listarPastas").mockResolvedValue(projetos);
    const { rerender } = abrir(false);

    expect(listar).not.toHaveBeenCalled();
    rerender(<NavegadorDePastas id="pasta" valor="" aoEscolher={vi.fn()} conectado />);
    expect(await screen.findByRole("list", { name: "Subpastas" })).toBeInTheDocument();
    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("a resposta de um Enter antigo não sobrescreve a pasta do Enter mais recente", async () => {
    let responderLenta: (conteudo: ConteudoDaPasta) => void = () => undefined;
    vi.spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockReturnValueOnce(new Promise((resolver) => (responderLenta = resolver)))
      .mockResolvedValueOnce(pasta("/u/projetos/painel", "/u/projetos"));
    const { aoEscolher } = abrir();
    const campo = await screen.findByDisplayValue("/u/projetos");

    fireEvent.change(campo, { target: { value: "/lenta" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    fireEvent.change(campo, { target: { value: "/u/projetos/painel" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith("/u/projetos/painel"));
    responderLenta(pasta("/lenta", "/"));

    await new Promise((resolver) => setTimeout(resolver, 0));
    expect(aoEscolher).not.toHaveBeenCalledWith("/lenta");
    expect(screen.getByRole("textbox")).toHaveValue("/u/projetos/painel");
  });

  it("a carga inicial não apaga um caminho que o usuário já começou a digitar", async () => {
    let responder: (conteudo: ConteudoDaPasta) => void = () => undefined;
    vi.spyOn(api, "listarPastas").mockReturnValueOnce(new Promise((resolver) => (responder = resolver)));
    abrir();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/opt/meu" } });
    responder(projetos);

    expect(await screen.findByRole("list", { name: "Subpastas" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("/opt/meu");
  });

  it("se a carga inicial falha, mostra o erro e deixa tentar de novo", async () => {
    const listar = vi
      .spyOn(api, "listarPastas")
      .mockRejectedValueOnce(new Error('Sem permissão para abrir a pasta "/u/projetos".'))
      .mockResolvedValueOnce(projetos);
    abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByRole("list", { name: "Subpastas" })).toBeInTheDocument();
    expect(listar).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
  });

  it("avisa a pendência enquanto o caminho digitado não foi aberto", async () => {
    vi.spyOn(api, "listarPastas").mockResolvedValueOnce(projetos).mockResolvedValueOnce(pasta("/opt", "/"));
    const aoMudarPendencia = vi.fn();
    render(
      <NavegadorDePastas id="pasta" valor="" aoEscolher={vi.fn()} aoMudarPendencia={aoMudarPendencia} conectado />,
    );
    const campo = await screen.findByDisplayValue("/u/projetos");
    await waitFor(() => expect(aoMudarPendencia).toHaveBeenLastCalledWith(false));

    fireEvent.change(campo, { target: { value: "/opt" } });
    expect(aoMudarPendencia).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Tecle Enter/)).toBeInTheDocument();
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(aoMudarPendencia).toHaveBeenLastCalledWith(false));
    expect(screen.queryByText(/Tecle Enter/)).not.toBeInTheDocument();
  });

  it("escolhe com o callback mais recente, mesmo que ele mude enquanto a pasta abre", async () => {
    let responder: (conteudo: ConteudoDaPasta) => void = () => undefined;
    vi.spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockReturnValueOnce(new Promise((resolver) => (responder = resolver)));
    const antigo = vi.fn();
    const novo = vi.fn();
    const { rerender } = render(<NavegadorDePastas id="pasta" valor="" aoEscolher={antigo} conectado />);

    fireEvent.click(await screen.findByRole("button", { name: /painel/ }));
    rerender(<NavegadorDePastas id="pasta" valor="" aoEscolher={novo} conectado />);
    responder(pasta("/u/projetos/painel", "/u/projetos"));

    await waitFor(() => expect(novo).toHaveBeenCalledWith("/u/projetos/painel"));
    expect(antigo).not.toHaveBeenCalled();
  });
});
