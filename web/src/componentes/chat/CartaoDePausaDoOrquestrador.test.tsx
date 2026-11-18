import { fireEvent, render, screen } from "@testing-library/react";

import type { AcaoDePausaDoOrquestrador } from "../../shared/api/acaoDePausa";
import { ehAcaoDePausaDoOrquestrador } from "../../shared/api/acaoDePausa";
import { api, ErroDaApi } from "../../shared/api/cliente";
import type { ResumoDoOrquestrador } from "../../shared/api/tipos";
import { CONFIGURACAO_PADRAO_DO_ORQUESTRADOR } from "../../shared/modelos";
import { CartaoDePausaDoOrquestrador } from "./CartaoDePausaDoOrquestrador";

const PASTA = "/projetos/painel-app";

function orquestrador(campos: Partial<ResumoDoOrquestrador> = {}): ResumoDoOrquestrador {
  return {
    id: "o1",
    nome: "Painel",
    pastaDeTrabalho: PASTA,
    nomeDaPasta: "painel-app",
    situacao: "trabalhando",
    configuracao: CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
    criadoEm: "2026-11-04T12:00:00Z",
    totalDeTurnos: 1,
    ultimoTurno: { texto: "rodar os testes", situacao: "em_andamento", iniciadoEm: "2026-11-04T12:05:00Z" },
    worktree: null,
    instrucoesAtivas: null,
    pausa: null,
    ...campos,
  };
}

const PAUSADO = orquestrador({ situacao: "pausado", pausa: { desde: "2026-11-04T12:10:00Z", modo: "congelado" } });

function acao(tipo: AcaoDePausaDoOrquestrador["tipo"]): AcaoDePausaDoOrquestrador {
  // A pasta com a barra final e o nome em minúsculas ainda acham o mesmo orquestrador.
  return { tipo, orquestrador: { nome: "painel", pasta: `${PASTA}/` } };
}

describe("CartaoDePausaDoOrquestrador", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reconhece as duas ações de pausa e mais nenhuma", () => {
    expect(ehAcaoDePausaDoOrquestrador({ tipo: "pausar_orquestrador" })).toBe(true);
    expect(ehAcaoDePausaDoOrquestrador({ tipo: "continuar_orquestrador" })).toBe(true);
    expect(ehAcaoDePausaDoOrquestrador({ tipo: "abrir_orquestrador" })).toBe(false);
  });

  it("pausar: mostra o estado e não chama nada antes do clique; no clique relê a lista e pausa", async () => {
    const listar = vi.spyOn(api, "listarOrquestradores").mockResolvedValue([orquestrador()]);
    const pausar = vi.spyOn(api, "pausar").mockResolvedValue({ pausa: { desde: "2026-11-04T12:10:00Z", modo: "congelado" } });
    const atualizar = vi.fn().mockResolvedValue(undefined);
    render(
      <CartaoDePausaDoOrquestrador
        acao={acao("pausar_orquestrador")}
        orquestradores={[orquestrador()]}
        aoAtualizarOrquestradores={atualizar}
      />,
    );

    expect(screen.getByText("Pausar orquestrador")).toBeInTheDocument();
    expect(screen.getByTestId("estado-da-pausa")).toHaveTextContent("painel: trabalhando");
    expect(listar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "⏸ Pausar painel" }));

    expect(await screen.findByRole("button", { name: "pausado ✓" })).toBeDisabled();
    expect(pausar).toHaveBeenCalledWith("o1");
    expect(screen.getByTestId("estado-da-pausa")).toHaveTextContent("painel: pausado (congelado, continua de onde parou)");
    expect(atualizar).toHaveBeenCalledTimes(1);
  });

  it("continuar: mostra o modo da pausa e chama continuar no clique", async () => {
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([PAUSADO]);
    const continuar = vi.spyOn(api, "continuar").mockResolvedValue({ modo: "congelado" });
    render(<CartaoDePausaDoOrquestrador acao={acao("continuar_orquestrador")} orquestradores={[PAUSADO]} />);

    expect(screen.getByTestId("estado-da-pausa")).toHaveTextContent("painel: pausado (congelado, continua de onde parou)");

    fireEvent.click(screen.getByRole("button", { name: "▶ Continuar painel" }));

    expect(await screen.findByRole("button", { name: "continuando ✓" })).toBeDisabled();
    expect(continuar).toHaveBeenCalledWith("o1");
  });

  it("estado já mudou na releitura: avisa numa linha sem chamar a pausa", async () => {
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([PAUSADO]);
    const pausar = vi.spyOn(api, "pausar");
    render(<CartaoDePausaDoOrquestrador acao={acao("pausar_orquestrador")} orquestradores={[orquestrador()]} />);

    fireEvent.click(screen.getByRole("button", { name: "⏸ Pausar painel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('"Painel" já está pausado.');
    expect(pausar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "⏸ Pausar painel" })).toBeDisabled();
  });

  it("409 do servidor: mostra a mensagem dele e não oferece repetir", async () => {
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([PAUSADO]);
    vi.spyOn(api, "continuar").mockRejectedValue(new ErroDaApi('"Painel" não está pausado.', 409));
    render(<CartaoDePausaDoOrquestrador acao={acao("continuar_orquestrador")} orquestradores={[PAUSADO]} />);

    fireEvent.click(screen.getByRole("button", { name: "▶ Continuar painel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('"Painel" não está pausado.');
    expect(screen.getByRole("button", { name: "▶ Continuar painel" })).toBeDisabled();
  });

  it("orquestrador sumiu da pasta: avisa sem chamar a pausa", async () => {
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([orquestrador({ pastaDeTrabalho: "/projetos/outro" })]);
    const pausar = vi.spyOn(api, "pausar");
    render(<CartaoDePausaDoOrquestrador acao={acao("pausar_orquestrador")} orquestradores={[]} />);

    expect(screen.queryByTestId("estado-da-pausa")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "⏸ Pausar painel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('"painel" não existe mais nesta pasta.');
    expect(pausar).not.toHaveBeenCalled();
  });

  it("falha passageira: mostra o erro e deixa tentar de novo", async () => {
    vi.spyOn(api, "listarOrquestradores").mockRejectedValue(new Error("Sem conexão com o servidor."));
    render(<CartaoDePausaDoOrquestrador acao={acao("pausar_orquestrador")} orquestradores={[orquestrador()]} />);

    fireEvent.click(screen.getByRole("button", { name: "⏸ Pausar painel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com o servidor.");
    expect(screen.getByRole("button", { name: "tentar de novo" })).toBeEnabled();
  });
});
