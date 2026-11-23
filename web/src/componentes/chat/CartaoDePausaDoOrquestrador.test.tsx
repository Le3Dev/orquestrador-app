import { act, fireEvent, render, screen } from "@testing-library/react";

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
  // Pelo id, a pasta com a barra final e o nome em outra caixa ainda acham o mesmo orquestrador.
  return { tipo, orquestrador: { id: "o1", nome: "painel", pasta: `${PASTA}/` } };
}

/** Homônimos na mesma pasta: dois de nome idêntico e um que só muda nas maiúsculas. */
const HOMONIMOS = [
  orquestrador({ id: "e2a98ec1", nome: "QA pausa A" }),
  orquestrador({ id: "1b0facc5", nome: "QA pausa A" }),
  orquestrador({ id: "7c3d0f22", nome: "qa pausa a" }),
];

function pausarHomonimo(orquestradorDaAcao: AcaoDePausaDoOrquestrador["orquestrador"]): AcaoDePausaDoOrquestrador {
  return { tipo: "pausar_orquestrador", orquestrador: orquestradorDaAcao };
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

  it("dois cliques no mesmo ciclo chamam a pausa uma vez só", async () => {
    const listar = vi.spyOn(api, "listarOrquestradores").mockResolvedValue([orquestrador()]);
    const pausar = vi.spyOn(api, "pausar").mockResolvedValue({ pausa: { desde: "2026-11-04T12:10:00Z", modo: "congelado" } });
    render(<CartaoDePausaDoOrquestrador acao={acao("pausar_orquestrador")} orquestradores={[orquestrador()]} />);
    const botao = screen.getByRole("button", { name: "⏸ Pausar painel" });

    // No mesmo act, o segundo clique ainda vê a renderização de antes do primeiro.
    act(() => {
      botao.click();
      botao.click();
    });

    expect(await screen.findByRole("button", { name: "pausado ✓" })).toBeDisabled();
    expect(listar).toHaveBeenCalledTimes(1);
    expect(pausar).toHaveBeenCalledTimes(1);
  });

  describe("homônimos na mesma pasta", () => {
    it.each([
      ["o segundo de nome idêntico", "1b0facc5", "QA pausa A"],
      ["o que só muda nas maiúsculas", "7c3d0f22", "qa pausa a"],
    ])("pelo id, pausa %s e não o primeiro da lista", async (_caso, id, nome) => {
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue(HOMONIMOS);
      const pausar = vi.spyOn(api, "pausar").mockResolvedValue({ pausa: { desde: "2026-11-04T12:10:00Z", modo: "congelado" } });
      render(<CartaoDePausaDoOrquestrador acao={pausarHomonimo({ id, nome, pasta: PASTA })} orquestradores={HOMONIMOS} />);

      fireEvent.click(screen.getByRole("button", { name: `⏸ Pausar ${nome}` }));

      expect(await screen.findByRole("button", { name: "pausado ✓" })).toBeDisabled();
      expect(pausar).toHaveBeenCalledWith(id);
    });

    it("ação antiga sem id e nome exato único: pausa esse, sem cair no que só muda nas maiúsculas", async () => {
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue(HOMONIMOS);
      const pausar = vi.spyOn(api, "pausar").mockResolvedValue({ pausa: { desde: "2026-11-04T12:10:00Z", modo: "congelado" } });
      render(
        <CartaoDePausaDoOrquestrador
          acao={pausarHomonimo({ nome: "qa pausa a", pasta: PASTA })}
          orquestradores={HOMONIMOS}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "⏸ Pausar qa pausa a" }));

      expect(await screen.findByRole("button", { name: "pausado ✓" })).toBeDisabled();
      expect(pausar).toHaveBeenCalledWith("7c3d0f22");
    });

    it("ação antiga sem id e nome ambíguo: avisa sem pausar nenhum", async () => {
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue(HOMONIMOS);
      const pausar = vi.spyOn(api, "pausar");
      render(
        <CartaoDePausaDoOrquestrador
          acao={pausarHomonimo({ nome: "QA pausa A", pasta: PASTA })}
          orquestradores={HOMONIMOS}
        />,
      );

      expect(screen.queryByTestId("estado-da-pausa")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "⏸ Pausar QA pausa A" }));

      expect(await screen.findByRole("alert")).toHaveTextContent('Há mais de um orquestrador chamado "QA pausa A" nesta pasta.');
      expect(pausar).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "⏸ Pausar QA pausa A" })).toBeDisabled();
    });

    it("id que não existe: avisa sem pausar o homônimo", async () => {
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue(HOMONIMOS);
      const pausar = vi.spyOn(api, "pausar");
      render(
        <CartaoDePausaDoOrquestrador
          acao={pausarHomonimo({ id: "inventado", nome: "QA pausa A", pasta: PASTA })}
          orquestradores={HOMONIMOS}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "⏸ Pausar QA pausa A" }));

      expect(await screen.findByRole("alert")).toHaveTextContent('"QA pausa A" não existe mais nesta pasta.');
      expect(pausar).not.toHaveBeenCalled();
    });
  });
});
