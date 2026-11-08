import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { NavegacaoDePastas } from "../../shared/api/tipos";
import { NavegadorDePastas } from "./NavegadorDePastas";

const PASTAS: Record<string, NavegacaoDePastas> = {
  "/projetos": {
    caminho: "/projetos",
    pai: "/",
    pastas: [
      { nome: "app", caminho: "/projetos/app" },
      { nome: "site", caminho: "/projetos/site" },
    ],
  },
  "/projetos/app": { caminho: "/projetos/app", pai: "/projetos", pastas: [{ nome: "web", caminho: "/projetos/app/web" }] },
  "/outra": { caminho: "/outra", pai: "/", pastas: [{ nome: "docs", caminho: "/outra/docs" }] },
};

function simularServidor() {
  return vi.spyOn(api, "navegarPastas").mockImplementation(async (caminho) => {
    // O servidor normaliza: barra no fim e `..` somem.
    const normalizado = (caminho ?? "/projetos").replace(/\/+$/, "") || "/";
    const navegacao = PASTAS[normalizado];
    if (navegacao === undefined) {
      throw new ErroDaApi(`A pasta "${normalizado}" não existe.`, 400);
    }
    return navegacao;
  });
}

function abrir() {
  const aoEscolher = vi.fn();
  const aoFechar = vi.fn();
  render(<NavegadorDePastas aoEscolher={aoEscolher} aoFechar={aoFechar} />);
  return { aoEscolher, aoFechar, campo: screen.getByRole("textbox", { name: "Caminho da pasta" }) };
}

describe("NavegadorDePastas: caminho digitável", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mostra o caminho atual no campo e a navegação pela lista atualiza o campo", async () => {
    simularServidor();
    const { campo } = abrir();

    await waitFor(() => expect(campo).toHaveValue("/projetos"));
    fireEvent.click(await screen.findByRole("button", { name: /app/ }));

    await waitFor(() => expect(campo).toHaveValue("/projetos/app"));
    expect(await screen.findByRole("button", { name: /web/ })).toBeInTheDocument();
  });

  it("digitar um caminho e teclar Enter navega para a pasta normalizada", async () => {
    const navegar = simularServidor();
    const { campo } = abrir();
    await waitFor(() => expect(campo).toHaveValue("/projetos"));

    fireEvent.change(campo, { target: { value: "/outra/" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(campo).toHaveValue("/outra"));
    expect(navegar).toHaveBeenLastCalledWith("/outra/", { estrito: true });
    expect(await screen.findByRole("button", { name: /docs/ })).toBeInTheDocument();
  });

  it("caminho inválido mostra o erro do servidor, mantém a lista e o texto digitado", async () => {
    simularServidor();
    const { campo, aoFechar } = abrir();
    await screen.findByRole("button", { name: /site/ });

    campo.focus();
    fireEvent.change(campo, { target: { value: "/nao/existe" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent('A pasta "/nao/existe" não existe.');
    expect(campo).toHaveValue("/nao/existe");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveFocus();
    expect(screen.getByRole("button", { name: /site/ })).toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("Esc com texto alterado volta ao caminho atual sem fechar; sem alteração fecha", async () => {
    simularServidor();
    const { campo, aoFechar } = abrir();
    await waitFor(() => expect(campo).toHaveValue("/projetos"));

    fireEvent.change(campo, { target: { value: "/qualquer" } });
    fireEvent.keyDown(campo, { key: "Escape" });

    expect(campo).toHaveValue("/projetos");
    expect(aoFechar).not.toHaveBeenCalled();

    fireEvent.keyDown(campo, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('"usar esta pasta" com texto não confirmado navega e escolhe o caminho digitado', async () => {
    simularServidor();
    const { campo, aoEscolher } = abrir();
    await waitFor(() => expect(campo).toHaveValue("/projetos"));

    fireEvent.change(campo, { target: { value: "/outra/" } });
    fireEvent.click(screen.getByRole("button", { name: /usar esta pasta/ }));

    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith("/outra"));
    expect(campo).toHaveValue("/outra");
  });

  it('"usar esta pasta" com caminho inválido mostra o erro e não escolhe', async () => {
    simularServidor();
    const { campo, aoEscolher } = abrir();
    await waitFor(() => expect(campo).toHaveValue("/projetos"));

    fireEvent.change(campo, { target: { value: "/sumiu" } });
    fireEvent.click(screen.getByRole("button", { name: /usar esta pasta/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent('A pasta "/sumiu" não existe.');
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(campo).toHaveFocus();
  });

  it('"usar esta pasta" sem alteração escolhe a pasta aberta', async () => {
    simularServidor();
    const { campo, aoEscolher } = abrir();
    await waitFor(() => expect(campo).toHaveValue("/projetos"));

    fireEvent.click(screen.getByRole("button", { name: /usar esta pasta/ }));

    expect(aoEscolher).toHaveBeenCalledWith("/projetos");
  });
});
