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
  permitirTrabalhoDireto: true,
  proporPlanoEmPedidosGrandes: true,
  instrucoesPersonalizadas: "",
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

  describe("trabalho direto e plano automático", () => {
    function opcoes() {
      return {
        trabalhoDireto: screen.getByRole("checkbox", { name: "Deixar o orquestrador fazer o trivial sozinho" }),
        plano: screen.getByRole("checkbox", { name: "Propor plano antes de mudanças grandes" }),
      };
    }

    it("começam ligadas, com a ajuda de cada uma", () => {
      renderizar();
      const { trabalhoDireto, plano } = opcoes();

      expect(trabalhoDireto).toBeChecked();
      expect(trabalhoDireto).toHaveAccessibleDescription(
        "Leituras rápidas, uma checagem ou um comando curto, sem subagente. Alterações continuam delegadas.",
      );
      expect(plano).toBeChecked();
      expect(plano).toHaveAccessibleDescription(
        "Em pedidos grandes, o orquestrador responde com um plano para você aprovar antes de alterar.",
      );
    });

    it("refletem as opções desligadas", () => {
      renderizar({ permitirTrabalhoDireto: false, proporPlanoEmPedidosGrandes: false });
      const { trabalhoDireto, plano } = opcoes();

      expect(trabalhoDireto).not.toBeChecked();
      expect(plano).not.toBeChecked();
    });

    it("ao desligar, mudam só a opção correspondente", () => {
      const { aoMudar } = renderizar();
      const { trabalhoDireto, plano } = opcoes();

      fireEvent.click(trabalhoDireto);
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, permitirTrabalhoDireto: false });

      fireEvent.click(plano);
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, proporPlanoEmPedidosGrandes: false });
    });
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

  describe("instruções personalizadas", () => {
    function campo() {
      return screen.getByRole("textbox", { name: "Instruções personalizadas (opcional)" });
    }

    it("começa vazio, com ajuda e contador, e muda só esse campo ao digitar", () => {
      const { aoMudar } = renderizar();

      expect(campo()).toHaveValue("");
      expect(campo()).toHaveAccessibleDescription(/Vazio: valem as instruções padrão/);
      expect(screen.getByText("0 / 4.000")).toBeInTheDocument();

      fireEvent.change(campo(), { target: { value: "Comece com PIRULITO.\nDepois o resto." } });
      expect(aoMudar).toHaveBeenLastCalledWith({
        ...configuracao,
        instrucoesPersonalizadas: "Comece com PIRULITO.\nDepois o resto.",
      });
    });

    it("o contador ignora espaço sobrando, como o servidor", () => {
      renderizar({ instrucoesPersonalizadas: "  abc  \n\n\n\n" });

      expect(screen.getByText("3 / 4.000")).toBeInTheDocument();
    });

    it("acima do limite, avisa sem cortar o texto", () => {
      const longo = "x".repeat(4_001);
      renderizar({ instrucoesPersonalizadas: longo });

      expect(campo()).toHaveValue(longo);
      expect(campo()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(/Passou do limite de 4.000 caracteres/);
    });

    it("tem o botão de pré-visualizar o prompt final", () => {
      renderizar();

      expect(screen.getByRole("button", { name: "Pré-visualizar prompt final" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  });
});
