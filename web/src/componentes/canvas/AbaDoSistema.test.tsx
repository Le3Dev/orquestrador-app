import { act, render, screen, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { LeituraDeMemoria } from "../../shared/api/tipos";
import type { AjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { esquecerAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import { AbaDoSistema } from "./AbaDoSistema";
import { formatarGb, formatarMb, ordenarOrquestradores } from "./usoDoSistema";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const ajustes: AjustesDoAplicativo = { disponivel: false, abrir: vi.fn(), erro: null, descartarErro: vi.fn() };

function leitura(livreGb: number, extras: Partial<LeituraDeMemoria> = {}): LeituraDeMemoria {
  return {
    totalBytes: 16 * GB,
    livreBytes: livreGb * GB,
    servidorBytes: 0.2 * GB,
    agentesBytes: 3.1 * GB,
    porOrquestrador: {},
    lidaEm: "2026-11-10T12:00:00Z",
    ...extras,
  };
}

const esperar = () => act(async () => undefined);

describe("AbaDoSistema", () => {
  beforeEach(() => {
    esquecerAutorrecuperacao();
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({
      instrucoesPadrao: "",
      subagentesProntos: [],
      autorrecuperacao: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formata GB e MB em pt-BR", () => {
    expect(formatarGb(1.9 * GB)).toBe("1,9 GB");
    expect(formatarGb(16 * GB)).toBe("16 GB");
    expect(formatarMb(820 * MB)).toBe("820 MB");
    expect(formatarMb(0)).toBe("0 MB");
    expect(formatarMb(1230 * MB)).toBe("1.230 MB");
  });

  describe.each([
    { nome: "tranquila", livre: 6.1, titulo: "Memória tranquila", frase: "Dá para abrir mais orquestradores.", pct: 62 },
    { nome: "baixa", livre: 1.4, titulo: "Memória baixa", frase: "Pedidos novos podem deixar o computador lento.", pct: 91 },
    { nome: "crítica", livre: 0.6, titulo: "Memória crítica", frase: "Espere os pedidos terminarem", pct: 96 },
  ])("nível $nome", ({ livre, titulo, frase, pct }) => {
    it("mostra o anel, o título, os GB livres e a frase do nível", async () => {
      render(<AbaDoSistema ajustes={ajustes} memoria={leitura(livre)} orquestradores={[]} />);
      await esperar();

      expect(screen.getByRole("heading", { name: titulo })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: `${pct}% da memória em uso. ${titulo}.` })).toBeInTheDocument();
      const cartao = screen.getByTestId("cartao-de-memoria");
      expect(cartao).toHaveTextContent(`${pct}%em uso`);
      expect(cartao).toHaveTextContent(`${formatarGb(livre * GB)} livres de 16 GB.`);
      expect(cartao).toHaveTextContent(frase);
    });
  });

  it("só a crítica pinta a borda do cartão e o título de vermelho", async () => {
    const { rerender } = render(<AbaDoSistema ajustes={ajustes} memoria={leitura(1.4)} orquestradores={[]} />);
    await esperar();
    expect(screen.getByTestId("cartao-de-memoria")).not.toHaveClass("cfgapp-critico");
    rerender(<AbaDoSistema ajustes={ajustes} memoria={leitura(0.6)} orquestradores={[]} />);
    expect(screen.getByTestId("cartao-de-memoria")).toHaveClass("cfgapp-critico");
    expect(screen.getByRole("heading", { name: "Memória crítica" })).toHaveClass("cfgapp-critico-titulo");
  });

  it("a barra empilhada e a legenda separam agentes, app e o resto usado", async () => {
    render(<AbaDoSistema ajustes={ajustes} memoria={leitura(1.9)} orquestradores={[]} />);
    await esperar();

    const cartao = screen.getByTestId("cartao-de-memoria");
    // usado = 14,1; agentes 3,1; app 0,2; outros = 10,8
    expect(cartao).toHaveTextContent("Agentes 3,1 GB");
    expect(cartao).toHaveTextContent("App 0,2 GB");
    expect(cartao).toHaveTextContent("Outros 10,8 GB");
    expect(
      screen.getByRole("img", { name: "Agentes 3,1 GB, app 0,2 GB, outros programas 10,8 GB, livre 1,9 GB" }),
    ).toBeInTheDocument();
  });

  it("sem leitura de memória, vale o status antigo (sistema)", async () => {
    render(<AbaDoSistema ajustes={ajustes} sistema={<div data-testid="status-antigo">RAM 4,5 GB livres</div>} />);
    await esperar();
    expect(screen.getByTestId("status-antigo")).toBeInTheDocument();
    expect(screen.queryByTestId("cartao-de-memoria")).not.toBeInTheDocument();
    expect(screen.queryByText("Uso por orquestrador")).not.toBeInTheDocument();
  });

  it("ordena a tabela: trabalhando primeiro, depois mais memória, depois o nome", () => {
    const lista = ordenarOrquestradores(
      [
        { id: "a", nome: "Zeta", situacao: "ocioso" },
        { id: "b", nome: "Beta", situacao: "ocioso" },
        { id: "c", nome: "Cronograma", situacao: "trabalhando" },
        { id: "d", nome: "Alfa", situacao: "ocioso" },
      ],
      { a: 900 * MB, c: 100 * MB, b: 0 },
    );
    expect(lista.map((linha) => linha.nome)).toEqual(["Cronograma", "Zeta", "Alfa", "Beta"]);
  });

  it("a tabela tem cabeçalhos, situação e memória em MB (0 MB quando ausente)", async () => {
    render(
      <AbaDoSistema
        ajustes={ajustes}
        memoria={leitura(1.9, { porOrquestrador: { c: 820 * MB } })}
        orquestradores={[
          { id: "p", nome: "Site da padaria", situacao: "ocioso" },
          { id: "c", nome: "Cronograma Q1", situacao: "trabalhando" },
        ]}
      />,
    );
    await esperar();

    const tabela = screen.getByRole("table", { name: "Memória usada por orquestrador" });
    expect(within(tabela).getAllByRole("columnheader").map((celula) => celula.textContent)).toEqual([
      "Orquestrador",
      "Situação",
      "Memória",
    ]);
    const linhas = within(tabela).getAllByRole("row").slice(1);
    expect(linhas.map((linha) => within(linha).getAllByRole("cell").map((celula) => celula.textContent))).toEqual([
      ["Cronograma Q1", "trabalhando", "820 MB"],
      ["Site da padaria", "parado", "0 MB"],
    ]);
  });

  it("sem orquestradores, a tabela diz que não há nenhum", async () => {
    render(<AbaDoSistema ajustes={ajustes} memoria={leitura(6.1)} orquestradores={[]} />);
    await esperar();
    expect(screen.getByText("Nenhum orquestrador ainda.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("Processos: autorrecuperação, o limite de abertos e os Ajustes só no desktop", async () => {
    const { rerender } = render(<AbaDoSistema ajustes={ajustes} memoria={leitura(6.1)} orquestradores={[]} />);
    await esperar();
    const grupo = screen.getByRole("group", { name: "Processos" });
    expect(within(grupo).getByRole("switch", { name: "Autorrecuperação" })).toBeInTheDocument();
    expect(within(grupo).getByText("Abertos ao mesmo tempo")).toBeInTheDocument();
    expect(within(grupo).getByText("Até 20")).toBeInTheDocument();
    expect(within(grupo).queryByRole("button", { name: "Pastas e Claude Code…" })).not.toBeInTheDocument();

    rerender(<AbaDoSistema ajustes={{ ...ajustes, disponivel: true }} memoria={leitura(6.1)} orquestradores={[]} />);
    expect(within(grupo).getByRole("button", { name: "Pastas e Claude Code…" })).toBeInTheDocument();
  });
});
