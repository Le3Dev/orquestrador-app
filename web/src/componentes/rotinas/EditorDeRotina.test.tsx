import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { type RotinaEmEdicao, rotinaVazia } from "./edicao";
import { EditorDeRotina, type OrquestradorEscolhivel } from "./EditorDeRotina";

const ORQUESTRADORES: OrquestradorEscolhivel[] = [
  { id: "o1", nome: "Backend" },
  { id: "o2", nome: "Documentação" },
];

function montar(alteracoes: { inicial?: RotinaEmEdicao; aoSalvar?: (rotina: RotinaEmEdicao) => Promise<void> } = {}) {
  const aoSalvar = alteracoes.aoSalvar ?? vi.fn(() => Promise.resolve());
  const aoCancelar = vi.fn();
  render(
    <EditorDeRotina
      titulo="Nova rotina"
      inicial={alteracoes.inicial ?? rotinaVazia()}
      orquestradores={ORQUESTRADORES}
      aoSalvar={aoSalvar}
      aoCancelar={aoCancelar}
    />,
  );
  return { aoSalvar, aoCancelar };
}

const salvar = () => screen.getByRole("button", { name: "Salvar" });
const digitar = (rotulo: string, valor: string) => fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });

/** Deixa a rotina em branco pronta para salvar: nome, orquestrador e pedido. */
function preencher() {
  digitar("Nome", "Relatório da manhã");
  digitar("Orquestrador da etapa 1", "o1");
  digitar("Pedido da etapa 1", "Rode os testes e me conte o que falhou.");
}

describe("EditorDeRotina", () => {
  it("começa com 'pular' ao perder a hora, um pedido vazio e o Salvar desligado, dizendo o que falta", () => {
    montar();

    expect(screen.getByLabelText("Se perder a hora")).toHaveValue("pular");
    expect(screen.getByRole("list", { name: "Etapas da rotina" }).children).toHaveLength(1);
    expect(salvar()).toBeDisabled();
    expect(screen.getByText("Para salvar, dê um nome à rotina.")).toBeInTheDocument();
  });

  it("avisa cada coisa que falta, na ordem dos campos, e liga o Salvar quando tudo está certo", () => {
    montar();

    digitar("Nome", "Relatório");
    expect(screen.getByText(/Para salvar, etapa 1: escolha o orquestrador/)).toBeInTheDocument();
    digitar("Orquestrador da etapa 1", "o1");
    expect(screen.getByText(/Para salvar, etapa 1: escreva o pedido/)).toBeInTheDocument();
    expect(salvar()).toBeDisabled();
    digitar("Pedido da etapa 1", "Rode os testes");

    expect(screen.queryByText(/Para salvar/)).not.toBeInTheDocument();
    expect(salvar()).toBeEnabled();
  });

  it("salva com o que foi digitado", async () => {
    const { aoSalvar } = montar();
    preencher();

    fireEvent.click(salvar());

    await waitFor(() => expect(aoSalvar).toHaveBeenCalledTimes(1));
    expect(aoSalvar).toHaveBeenCalledWith(
      expect.objectContaining({
        nome: "Relatório da manhã",
        aoPerder: "pular",
        gatilho: expect.objectContaining({ tipo: "diario", hora: "09:00" }),
        etapas: [expect.objectContaining({ tipo: "pedido", orquestradorId: "o1", texto: "Rode os testes e me conte o que falhou.", modo: "execucao" })],
      }),
    );
  });

  it("mostra o erro do servidor e deixa a edição como está", async () => {
    montar({ aoSalvar: () => Promise.reject(new Error("O horário desta rotina já passou.")) });
    preencher();

    fireEvent.click(salvar());

    expect(await screen.findByRole("alert")).toHaveTextContent("O horário desta rotina já passou.");
    expect(screen.getByLabelText("Nome")).toHaveValue("Relatório da manhã");
    expect(salvar()).toBeEnabled();
  });

  it("adiciona etapas de pedido, aprovação e espera, até 10", () => {
    montar();

    fireEvent.click(screen.getByRole("button", { name: "+ Aprovação" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Espera" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Pedido" }));

    const lista = screen.getByRole("list", { name: "Etapas da rotina" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByLabelText("Mensagem da etapa 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Minutos da espera da etapa 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Pedido da etapa 4")).toBeInTheDocument();

    for (let n = 0; n < 6; n += 1) {
      fireEvent.click(screen.getByRole("button", { name: "+ Espera" }));
    }
    expect(within(lista).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByRole("button", { name: "+ Pedido" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Aprovação" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Espera" })).toBeDisabled();
    expect(screen.getByText("10 / 10")).toBeInTheDocument();
  });

  it("um pedido novo já sai com o orquestrador do pedido anterior", () => {
    montar();
    digitar("Orquestrador da etapa 1", "o2");

    fireEvent.click(screen.getByRole("button", { name: "+ Pedido" }));

    expect(screen.getByLabelText("Orquestrador da etapa 2")).toHaveValue("o2");
  });

  it("remove uma etapa e renumera as outras", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "+ Aprovação" }));
    digitar("Mensagem da etapa 2", "Posso seguir?");

    fireEvent.click(screen.getByRole("button", { name: "Remover etapa 1" }));

    const lista = screen.getByRole("list", { name: "Etapas da rotina" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByLabelText("Mensagem da etapa 1")).toHaveValue("Posso seguir?");
    expect(screen.queryByLabelText("Pedido da etapa 1")).not.toBeInTheDocument();
  });

  it("reordena com subir e descer, levando o que foi digitado junto", () => {
    montar();
    digitar("Pedido da etapa 1", "Primeiro pedido");
    fireEvent.click(screen.getByRole("button", { name: "+ Aprovação" }));
    digitar("Mensagem da etapa 2", "Posso seguir?");

    expect(screen.getByRole("button", { name: "Subir etapa 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Descer etapa 2" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Subir etapa 2" }));
    expect(screen.getByLabelText("Mensagem da etapa 1")).toHaveValue("Posso seguir?");
    expect(screen.getByLabelText("Pedido da etapa 2")).toHaveValue("Primeiro pedido");

    fireEvent.click(screen.getByRole("button", { name: "Descer etapa 1" }));
    expect(screen.getByLabelText("Pedido da etapa 1")).toHaveValue("Primeiro pedido");
    expect(screen.getByLabelText("Mensagem da etapa 2")).toHaveValue("Posso seguir?");
  });

  it("troca o gatilho e mostra os campos de cada um, com o texto humano embaixo", () => {
    montar();
    digitar("Nome", "Relatório");
    expect(screen.getByText("Todo dia às 09:00")).toBeInTheDocument();

    digitar("Quando a rotina roda", "semanal");
    expect(screen.getByText("Toda segunda às 09:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "quarta" }));
    fireEvent.click(screen.getByRole("button", { name: "sexta" }));
    expect(screen.getByText("Segunda, quarta e sexta às 09:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "segunda" }));
    fireEvent.click(screen.getByRole("button", { name: "quarta" }));
    fireEvent.click(screen.getByRole("button", { name: "sexta" }));
    expect(screen.getByText(/Para salvar, .*ao menos um dia da semana/)).toBeInTheDocument();

    digitar("Quando a rotina roda", "intervalo");
    digitar("Intervalo em minutos", "10");
    expect(screen.getByText(/Para salvar, o intervalo deve ser de 15 a 525\.600 minutos/)).toBeInTheDocument();
    digitar("Intervalo em minutos", "120");
    expect(screen.getByText("A cada 2 horas")).toBeInTheDocument();

    digitar("Quando a rotina roda", "uma_vez");
    expect(screen.getByLabelText("Data e hora da execução")).toBeInTheDocument();
    expect(screen.getByText(/Para salvar, .*escolha a data e a hora/)).toBeInTheDocument();
  });

  it("deixa escolher 'executar ao abrir' quando perder a hora", async () => {
    const { aoSalvar } = montar();
    preencher();
    digitar("Se perder a hora", "executar_ao_abrir");

    fireEvent.click(salvar());

    await waitFor(() => expect(aoSalvar).toHaveBeenCalledWith(expect.objectContaining({ aoPerder: "executar_ao_abrir" })));
  });

  it("o pedido pode ser só de planejamento", async () => {
    const { aoSalvar } = montar();
    preencher();
    digitar("Modo da etapa 1", "planejamento");

    fireEvent.click(salvar());

    await waitFor(() =>
      expect(aoSalvar).toHaveBeenCalledWith(expect.objectContaining({ etapas: [expect.objectContaining({ modo: "planejamento" })] })),
    );
  });

  it("cancelar volta sem salvar", () => {
    const { aoCancelar, aoSalvar } = montar();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(aoCancelar).toHaveBeenCalledTimes(1);
    expect(aoSalvar).not.toHaveBeenCalled();
  });
});
