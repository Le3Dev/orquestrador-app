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

  function abrir(conectado = true) {
    const aoEscolher = vi.fn();
    const resultado = render(<NavegadorDePastas aoEscolher={aoEscolher} conectado={conectado} />);
    return { aoEscolher, ...resultado };
  }

  const campo = () => screen.getByRole("textbox", { name: "Caminho da pasta aberta" });

  it("abre na pasta dos projetos, com o botão de usar a pasta aberta", async () => {
    const listar = vi.spyOn(api, "listarPastas").mockResolvedValue(projetos);
    const { aoEscolher } = abrir();

    const lista = await screen.findByRole("list", { name: "Subpastas" });
    expect(listar).toHaveBeenCalledWith(undefined);
    expect(within(lista).getByRole("button", { name: /painel/ })).toBeInTheDocument();
    expect(campo()).toHaveValue("/u/projetos");
    expect(screen.getByRole("button", { name: "Usar “projetos”" })).toBeInTheDocument();
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("clicar numa subpasta só entra nela; quem escolhe é o botão Usar", async () => {
    const listar = vi
      .spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockResolvedValueOnce(pasta("/u/projetos/painel", "/u/projetos", ["src"]));
    const { aoEscolher } = abrir();

    fireEvent.click(await screen.findByRole("button", { name: /painel/ }));

    expect(await screen.findByRole("button", { name: /src/ })).toBeInTheDocument();
    expect(listar).toHaveBeenLastCalledWith("/u/projetos/painel");
    expect(aoEscolher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Usar “painel”" }));
    expect(aoEscolher).toHaveBeenCalledWith("/u/projetos/painel");
  });

  it("sobe para a pasta acima e usa os atalhos, sem escolher", async () => {
    const listar = vi
      .spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockResolvedValueOnce(pasta("/u", "/", ["Documentos"]))
      .mockResolvedValueOnce(projetos);
    const { aoEscolher } = abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Pasta acima" }));
    expect(await screen.findByRole("button", { name: /Documentos/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Projetos" }));

    await waitFor(() => expect(listar).toHaveBeenCalledTimes(3));
    expect(listar).toHaveBeenNthCalledWith(2, "/u");
    expect(listar).toHaveBeenNthCalledWith(3, "/u/projetos");
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("na raiz do disco, o botão de subir fica desabilitado", async () => {
    vi.spyOn(api, "listarPastas").mockResolvedValue(pasta("/", null, ["Users"]));
    abrir();

    await screen.findByRole("list", { name: "Subpastas" });
    expect(screen.getByRole("button", { name: "Pasta acima" })).toBeDisabled();
  });

  it("um caminho colado abre com Enter, sem enviar o formulário", async () => {
    vi.spyOn(api, "listarPastas").mockResolvedValueOnce(projetos).mockResolvedValueOnce(pasta("/opt/outro", "/opt"));
    const enviar = vi.fn();
    render(
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          enviar();
        }}
      >
        <NavegadorDePastas aoEscolher={vi.fn()} conectado />
      </form>,
    );
    await screen.findByDisplayValue("/u/projetos");

    fireEvent.change(campo(), { target: { value: "  /opt/outro " } });
    fireEvent.keyDown(campo(), { key: "Enter" });

    expect(await screen.findByRole("button", { name: "Usar “outro”" })).toBeInTheDocument();
    expect(enviar).not.toHaveBeenCalled();
    expect(screen.getByText("nenhuma subpasta")).toBeInTheDocument();
  });

  it("caminho inválido mostra o erro e mantém a pasta aberta", async () => {
    vi.spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockRejectedValueOnce(new Error('A pasta "/nada" não existe.'));
    abrir();
    await screen.findByDisplayValue("/u/projetos");

    fireEvent.change(campo(), { target: { value: "/nada" } });
    fireEvent.keyDown(campo(), { key: "Enter" });

    expect(await screen.findByText(/A pasta "\/nada" não existe\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar “projetos”" })).toBeInTheDocument();
  });

  it("apagar o caminho e sair do campo volta a mostrar a pasta aberta", async () => {
    vi.spyOn(api, "listarPastas").mockResolvedValue(projetos);
    abrir();
    await screen.findByDisplayValue("/u/projetos");

    fireEvent.change(campo(), { target: { value: "" } });
    fireEvent.blur(campo());

    expect(campo()).toHaveValue("/u/projetos");
  });

  it("a carga inicial não apaga um caminho que a pessoa já começou a digitar", async () => {
    let responder: (conteudo: ConteudoDaPasta) => void = () => undefined;
    vi.spyOn(api, "listarPastas").mockReturnValueOnce(new Promise((resolver) => (responder = resolver)));
    abrir();

    fireEvent.change(campo(), { target: { value: "/opt/x" } });
    responder(projetos);

    expect(await screen.findByRole("list", { name: "Subpastas" })).toBeInTheDocument();
    expect(campo()).toHaveValue("/opt/x");
  });

  it("com o servidor fora, espera ele voltar para carregar", async () => {
    const listar = vi.spyOn(api, "listarPastas").mockResolvedValue(projetos);
    const { rerender } = abrir(false);

    expect(listar).not.toHaveBeenCalled();
    rerender(<NavegadorDePastas aoEscolher={vi.fn()} conectado />);
    expect(await screen.findByRole("list", { name: "Subpastas" })).toBeInTheDocument();
    expect(listar).toHaveBeenCalledTimes(1);
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
  });

  it("a resposta atrasada de um pedido antigo não sobrescreve a pasta mais recente", async () => {
    let responderLenta: (conteudo: ConteudoDaPasta) => void = () => undefined;
    vi.spyOn(api, "listarPastas")
      .mockResolvedValueOnce(projetos)
      .mockReturnValueOnce(new Promise((resolver) => (responderLenta = resolver)))
      .mockResolvedValueOnce(pasta("/u/projetos/painel", "/u/projetos"));
    abrir();
    await screen.findByDisplayValue("/u/projetos");

    fireEvent.change(campo(), { target: { value: "/lenta" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    fireEvent.change(campo(), { target: { value: "/u/projetos/painel" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(await screen.findByRole("button", { name: "Usar “painel”" })).toBeInTheDocument();
    responderLenta(pasta("/lenta", "/"));

    await new Promise((resolver) => setTimeout(resolver, 0));
    expect(screen.getByRole("button", { name: "Usar “painel”" })).toBeInTheDocument();
    expect(campo()).toHaveValue("/u/projetos/painel");
  });
});
