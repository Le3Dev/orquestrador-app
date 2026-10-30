import { fireEvent, render, screen, within } from "@testing-library/react";

import type { DadosDaConfiguracao } from "../shared/api/tipos";
import { CamposDaConfiguracao } from "./CamposDaConfiguracao";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "edicao_e_comandos",
  permitirCommitEPush: false,
};

function renderizar(alteracoes: Partial<DadosDaConfiguracao> = {}) {
  const aoMudar = vi.fn();
  render(<CamposDaConfiguracao valor={{ ...configuracao, ...alteracoes }} aoMudar={aoMudar} />);
  return { aoMudar, opcao: screen.getByRole("checkbox", { name: "Permitir commit e push quando eu pedir" }) };
}

describe("CamposDaConfiguracao", () => {
  it("commit e push começam desligados e, ao ligar, mudam só essa opção", () => {
    const { aoMudar, opcao } = renderizar();

    expect(opcao).not.toBeChecked();
    expect(opcao).toHaveAccessibleDescription(/só quando você pedir explicitamente/);

    fireEvent.click(opcao);
    expect(aoMudar).toHaveBeenCalledWith({ ...configuracao, permitirCommitEPush: true });
  });

  it("reflete a opção já ligada", () => {
    expect(renderizar({ permitirCommitEPush: true }).opcao).toBeChecked();
  });

  it("ligada sem permissão de rodar comandos, avisa sem bloquear a opção", () => {
    const { opcao } = renderizar({ permitirCommitEPush: true, nivelDePermissao: "edicao" });

    expect(screen.getByText(/exigem a permissão de rodar comandos/)).toBeInTheDocument();
    expect(opcao).toBeEnabled();
  });

  it("com permissão de rodar comandos, não avisa", () => {
    renderizar({ permitirCommitEPush: true });

    expect(screen.queryByText(/exigem a permissão de rodar comandos/)).not.toBeInTheDocument();
  });

  describe("esforço", () => {
    function seletores() {
      return {
        doOrquestrador: screen.getByRole("combobox", { name: "Esforço do orquestrador" }),
        dosSubagentes: screen.getByRole("combobox", { name: "Esforço dos subagentes" }),
      };
    }

    it("começa no padrão do Claude Code, com todas as opções e a ajuda", () => {
      renderizar();
      const { doOrquestrador, dosSubagentes } = seletores();

      expect(doOrquestrador).toHaveValue("padrao");
      expect(dosSubagentes).toHaveValue("padrao");
      expect(screen.getAllByRole("option", { name: "Padrão (Claude Code)", selected: true })).toHaveLength(2);
      expect(within(doOrquestrador).getAllByRole("option").map((opcao) => opcao.textContent)).toEqual([
        "Padrão (Claude Code)",
        "Baixo",
        "Médio",
        "Alto",
        "Extra alto",
        "Máximo",
      ]);
      for (const seletor of [doOrquestrador, dosSubagentes]) {
        expect(seletor).toHaveAccessibleDescription(
          /Padrão: o app não força nada — vale o settings\.json do Claude Code desta máquina ou, sem ele, o padrão do modelo\./,
        );
        expect(seletor).toHaveAccessibleDescription(/Mais esforço = respostas mais cuidadosas/);
      }
    });

    it("mostra o esforço já escolhido", () => {
      renderizar({ esforcoDoOrquestrador: "extra_alto", esforcoDosSubagentes: "baixo" });
      const { doOrquestrador, dosSubagentes } = seletores();

      expect(doOrquestrador).toHaveValue("extra_alto");
      expect(dosSubagentes).toHaveValue("baixo");
    });

    it("ao escolher, muda só o esforço correspondente", () => {
      const { aoMudar } = renderizar();
      const { doOrquestrador, dosSubagentes } = seletores();

      fireEvent.change(doOrquestrador, { target: { value: "maximo" } });
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, esforcoDoOrquestrador: "maximo" });

      fireEvent.change(dosSubagentes, { target: { value: "medio" } });
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, esforcoDosSubagentes: "medio" });
    });
  });
});
