import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";

import { api } from "../../shared/api/cliente";
import type { DadosDoPedidoNaFila, ModoDoTurno } from "../../shared/api/tipos";
import type { AnexoPendente } from "../../shared/anexos";
import { type ControleDoPrompt, PromptDoTerminal } from "./PromptDoTerminal";

interface Opcoes {
  modo?: ModoDoTurno;
  trabalhando?: boolean;
  desconectado?: boolean;
  anexos?: readonly AnexoPendente[];
  limpezaAceita?: boolean;
  fila?: readonly DadosDoPedidoNaFila[];
  proximoDaFilaACaminho?: boolean;
  enfileiramentoAceito?: boolean;
}

const FILA: readonly DadosDoPedidoNaFila[] = [
  { id: "p1", texto: "rode os testes\ne corrija o que quebrar", modo: "execucao", enfileiradoEm: "2026-10-28T12:00:01.000Z" },
  { id: "p2", texto: "planeje a migração", modo: "planejamento", enfileiradoEm: "2026-10-28T12:00:02.000Z" },
];

const IMAGEM: AnexoPendente = {
  id: "i1",
  nome: "tela.png",
  categoria: "imagem",
  tipoDeMidia: "image/png",
  tamanhoEmBytes: 10,
  arquivo: new Blob([new Uint8Array(10)], { type: "image/png" }),
  previa: "blob:teste/i1",
  rotulo: "Imagem",
  legado: false,
};

const DOCUMENTO: AnexoPendente = {
  id: "d1",
  nome: "relatório de vendas do terceiro trimestre.pdf",
  categoria: "documento",
  tipoDeMidia: "application/pdf",
  tamanhoEmBytes: 3 * 1024 * 1024,
  arquivo: new Blob([new Uint8Array(10)], { type: "application/pdf" }),
  previa: null,
  rotulo: "PDF",
  legado: false,
};

const DOCUMENTO_ANTIGO: AnexoPendente = {
  ...DOCUMENTO,
  id: "d2",
  nome: "base.xls",
  tipoDeMidia: "application/vnd.ms-excel",
  tamanhoEmBytes: 200 * 1024,
  rotulo: "Excel (formato antigo)",
  legado: true,
};

function renderizar({
  modo = "execucao",
  trabalhando = false,
  desconectado = false,
  anexos = [],
  limpezaAceita = true,
  fila = [],
  proximoDaFilaACaminho = false,
  enfileiramentoAceito = true,
}: Opcoes = {}) {
  const aoAlternarModo = vi.fn();
  const aoRemoverAnexo = vi.fn();
  const aoAnexar = vi.fn();
  const aoEnviar = vi.fn(async () => true);
  const aoEnfileirar = vi.fn(async () => enfileiramentoAceito);
  const aoRemoverDaFila = vi.fn();
  const aoEnviarDaFila = vi.fn();
  const aoLimparConversa = vi.fn(async () => limpezaAceita);
  const controle = createRef<ControleDoPrompt>();
  const campo = createRef<HTMLTextAreaElement>();
  render(
    <PromptDoTerminal
      pasta="painel-app"
      desconectado={desconectado}
      trabalhando={trabalhando}
      cancelando={false}
      modo={modo}
      aoAlternarModo={aoAlternarModo}
      campo={campo}
      controle={controle}
      anexos={anexos}
      aoAnexar={aoAnexar}
      aoRemoverAnexo={aoRemoverAnexo}
      aoEnviar={aoEnviar}
      aoEnfileirar={aoEnfileirar}
      fila={fila}
      proximoDaFilaACaminho={proximoDaFilaACaminho}
      aoRemoverDaFila={aoRemoverDaFila}
      aoEnviarDaFila={aoEnviarDaFila}
      aoLimparConversa={aoLimparConversa}
      aoCancelar={vi.fn()}
    />,
  );
  return {
    aoAlternarModo,
    aoAnexar,
    aoRemoverAnexo,
    aoEnviar,
    aoEnfileirar,
    aoRemoverDaFila,
    aoEnviarDaFila,
    aoLimparConversa,
    controle,
    campo: screen.getByRole("textbox", { name: "Mensagem para o orquestrador" }),
  };
}

function digitarEEnviar(campo: HTMLElement, texto: string): void {
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.keyDown(campo, { key: "Enter" });
}

describe("PromptDoTerminal", () => {
  it("Shift+Tab alterna o modo sem enviar nem tirar o foco do campo", () => {
    const { aoAlternarModo, aoEnviar, campo } = renderizar();
    fireEvent.change(campo, { target: { value: "planeje a migração" } });

    const seguiuPadrao = fireEvent.keyDown(campo, { key: "Tab", shiftKey: true });

    expect(seguiuPadrao).toBe(false);
    expect(aoAlternarModo).toHaveBeenCalledTimes(1);
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it("o selo mostra o modo e também alterna ao clicar", () => {
    const { aoAlternarModo } = renderizar({ modo: "planejamento" });
    const selo = screen.getByRole("button", { name: /plan mode ligado/ });

    expect(selo).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "descreva o que planejar — nada é alterado até você aprovar",
    );

    fireEvent.click(selo);
    expect(aoAlternarModo).toHaveBeenCalledTimes(1);
  });

  it("em execução, o selo fica desligado", () => {
    renderizar();

    expect(screen.getByRole("button", { name: /› execução/ })).toHaveAttribute("aria-pressed", "false");
  });

  describe("/clear", () => {
    it("Enter limpa a conversa em vez de enviar o pedido e esvazia o campo", async () => {
      const { aoEnviar, aoLimparConversa, campo } = renderizar();

      digitarEEnviar(campo, " /Clear ");

      await waitFor(() => expect(campo).toHaveValue(""));
      expect(aoLimparConversa).toHaveBeenCalledTimes(1);
      expect(aoEnviar).not.toHaveBeenCalled();
    });

    it("se o servidor recusar, o comando fica no campo", async () => {
      const { aoLimparConversa, campo } = renderizar({ limpezaAceita: false });

      digitarEEnviar(campo, "/clear");

      await waitFor(() => expect(aoLimparConversa).toHaveBeenCalledTimes(1));
      expect(campo).toHaveValue("/clear");
    });

    it("durante um pedido, não faz nada e a dica avisa que está indisponível", () => {
      const { aoEnviar, aoLimparConversa, campo } = renderizar({ trabalhando: true });

      digitarEEnviar(campo, "/clear");

      expect(aoLimparConversa).not.toHaveBeenCalled();
      expect(aoEnviar).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("/clear — indisponível durante um pedido · esc cancela");
      expect(campo).toHaveValue("/clear");
    });

    it("desconectado, fica bloqueado como o envio", () => {
      const { aoLimparConversa, campo } = renderizar({ desconectado: true });

      digitarEEnviar(campo, "/clear");

      expect(aoLimparConversa).not.toHaveBeenCalled();
    });

    it("com imagens anexadas, limpa a conversa sem enviar as imagens", async () => {
      const { aoEnviar, aoLimparConversa, campo } = renderizar({ anexos: [IMAGEM] });

      digitarEEnviar(campo, "/clear");

      await waitFor(() => expect(aoLimparConversa).toHaveBeenCalledTimes(1));
      expect(aoEnviar).not.toHaveBeenCalled();
      expect(screen.getByRole("img", { name: "tela.png" })).toBeInTheDocument();
    });

    it("/clear com mais texto vai como pedido comum", async () => {
      const { aoEnviar, aoLimparConversa, campo } = renderizar();

      digitarEEnviar(campo, "/clear algo");

      await waitFor(() => expect(aoEnviar).toHaveBeenCalledWith("/clear algo"));
      expect(aoLimparConversa).not.toHaveBeenCalled();
    });

    it("mostra a dica enquanto o texto é o começo do comando e o Tab completa", () => {
      const { campo } = renderizar();

      fireEvent.change(campo, { target: { value: "/cl" } });
      expect(screen.getByRole("status")).toHaveTextContent("/clear — começar uma conversa nova · tab completa");

      const seguiuPadrao = fireEvent.keyDown(campo, { key: "Tab" });
      expect(seguiuPadrao).toBe(false);
      expect(campo).toHaveValue("/clear");
      expect(screen.getByRole("status")).toHaveTextContent("/clear — começar uma conversa nova · enter");

      fireEvent.change(campo, { target: { value: "/x" } });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("pedido grande", () => {
    const grande = "Refatore o módulo de pedidos:\n- separar o domínio\n- criar o repositório\n- migrar as rotas";

    it("em execução, sugere planejar antes sem bloquear o envio", async () => {
      const { aoEnviar, campo } = renderizar();

      fireEvent.change(campo, { target: { value: grande } });
      expect(screen.getByRole("status")).toHaveTextContent("pedido grande? shift+tab para planejar antes");

      fireEvent.keyDown(campo, { key: "Enter" });
      await waitFor(() => expect(aoEnviar).toHaveBeenCalledWith(grande));
    });

    it("no plan mode e em pedidos curtos, não sugere nada", () => {
      const { campo } = renderizar({ modo: "planejamento" });

      fireEvent.change(campo, { target: { value: grande } });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      fireEvent.change(campo, { target: { value: "corrija o bug" } });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("fila de pedidos", () => {
    it("com um pedido rodando, Enter põe o texto na fila em vez de enviar e esvazia o campo", async () => {
      const { aoEnviar, aoEnfileirar, campo } = renderizar({ trabalhando: true });

      expect(campo).toHaveAttribute("placeholder", "trabalhando… escreva o próximo e enter põe na fila · esc cancela");
      digitarEEnviar(campo, "agora rode os testes");

      await waitFor(() => expect(campo).toHaveValue(""));
      expect(aoEnfileirar).toHaveBeenCalledWith("agora rode os testes");
      expect(aoEnviar).not.toHaveBeenCalled();
    });

    it("se o servidor recusar (ex.: fila cheia), o texto fica no campo", async () => {
      const { aoEnfileirar, campo } = renderizar({ trabalhando: true, enfileiramentoAceito: false });

      digitarEEnviar(campo, "mais um");

      await waitFor(() => expect(aoEnfileirar).toHaveBeenCalledTimes(1));
      expect(campo).toHaveValue("mais um");
    });

    it("com imagens anexadas, avisa que elas não entram na fila e não envia nada", () => {
      const { aoEnviar, aoEnfileirar, campo } = renderizar({ trabalhando: true, anexos: [IMAGEM] });

      digitarEEnviar(campo, "veja a tela");

      expect(screen.getByRole("alert")).toHaveTextContent("anexos não entram na fila");
      expect(aoEnfileirar).not.toHaveBeenCalled();
      expect(aoEnviar).not.toHaveBeenCalled();
      expect(campo).toHaveValue("veja a tela");
    });

    it("com um documento anexado, o aviso é o mesmo: não entra na fila e nada é enviado", () => {
      const { aoEnviar, aoEnfileirar, campo } = renderizar({ trabalhando: true, anexos: [DOCUMENTO] });

      digitarEEnviar(campo, "resuma o relatório");

      expect(screen.getByRole("alert")).toHaveTextContent(
        "anexos não entram na fila — envie quando o orquestrador estiver livre, ou remova os anexos para pôr só o texto na fila",
      );
      expect(aoEnfileirar).not.toHaveBeenCalled();
      expect(aoEnviar).not.toHaveBeenCalled();
      expect(campo).toHaveValue("resuma o relatório");
    });

    it("sem pedido rodando, Enter envia normalmente", async () => {
      const { aoEnviar, aoEnfileirar, campo } = renderizar({ fila: FILA });

      digitarEEnviar(campo, "outro assunto");

      await waitFor(() => expect(aoEnviar).toHaveBeenCalledWith("outro assunto"));
      expect(aoEnfileirar).not.toHaveBeenCalled();
    });

    it("mostra os pedidos com o número, a primeira linha e o selo do plan mode; ✕ tira da fila", () => {
      const { aoRemoverDaFila } = renderizar({ trabalhando: true, fila: FILA });
      const lista = screen.getByRole("region", { name: "Fila de pedidos" });
      const itens = within(lista).getAllByRole("listitem");

      expect(lista).toHaveTextContent("na fila· 2/10");
      expect(itens).toHaveLength(2);
      expect(itens[0]).toHaveTextContent("1rode os testes …");
      expect(within(itens[0] as HTMLElement).getByText("rode os testes …")).toHaveAttribute(
        "title",
        "rode os testes\ne corrija o que quebrar",
      );
      expect(itens[0]).not.toHaveTextContent("plan mode");
      expect(itens[1]).toHaveTextContent("2plan modeplaneje a migração");

      fireEvent.click(screen.getByRole("button", { name: "Remover da fila o pedido 2" }));
      expect(aoRemoverDaFila).toHaveBeenCalledWith("p2");
    });

    it("com um pedido rodando, a fila anda sozinha: não há 'enviar agora'", () => {
      renderizar({ trabalhando: true, fila: FILA });

      expect(screen.queryByText("fila pausada")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "enviar agora" })).not.toBeInTheDocument();
    });

    it("pausada (sem pedido rodando e com itens), mostra 'fila pausada' e o 'enviar agora' só no primeiro", () => {
      const { aoEnviarDaFila } = renderizar({ fila: FILA });
      const itens = screen.getAllByRole("listitem");

      expect(screen.getByText("fila pausada")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "enviar agora" })).toHaveLength(1);
      expect(within(itens[1] as HTMLElement).queryByRole("button", { name: "enviar agora" })).not.toBeInTheDocument();

      fireEvent.click(within(itens[0] as HTMLElement).getByRole("button", { name: "enviar agora" }));
      expect(aoEnviarDaFila).toHaveBeenCalledWith("p1");
    });

    it("com o próximo a caminho (o anterior acabou de terminar bem), mostra 'enviando o próximo…' sem 'enviar agora'", () => {
      renderizar({ fila: FILA, proximoDaFilaACaminho: true });

      expect(screen.getByText("enviando o próximo…")).toBeInTheDocument();
      expect(screen.queryByText("fila pausada")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "enviar agora" })).not.toBeInTheDocument();
    });

    it("sem pedidos à espera, a lista não aparece", () => {
      renderizar({ trabalhando: true });

      expect(screen.queryByRole("region", { name: "Fila de pedidos" })).not.toBeInTheDocument();
    });

    it("/clear durante um pedido continua indisponível e não vai para a fila", () => {
      const { aoEnfileirar, aoLimparConversa, campo } = renderizar({ trabalhando: true, fila: FILA });

      digitarEEnviar(campo, "/clear");

      expect(aoEnfileirar).not.toHaveBeenCalled();
      expect(aoLimparConversa).not.toHaveBeenCalled();
      expect(campo).toHaveValue("/clear");
    });
  });

  describe("anexos (imagens e documentos)", () => {
    it("a imagem vira miniatura e o documento vira etiqueta, cada um com o seu ✕", () => {
      const { aoRemoverAnexo } = renderizar({ anexos: [IMAGEM, DOCUMENTO, DOCUMENTO_ANTIGO] });

      expect(screen.getByRole("img", { name: "tela.png" })).toHaveAttribute("src", "blob:teste/i1");
      const etiqueta = screen.getByRole("button", { name: `Remover ${DOCUMENTO.nome}` }).closest(".chip-de-anexo") as HTMLElement;
      // Nome inteiro no title, rótulo do formato e tamanho legível; sem <img> para o documento.
      expect(etiqueta).toHaveAttribute("title", expect.stringContaining(DOCUMENTO.nome));
      expect(within(etiqueta).getByText(DOCUMENTO.nome)).toHaveClass("chip-de-anexo-nome");
      expect(etiqueta).toHaveTextContent("PDF · 3 MB");
      expect(within(etiqueta).queryByRole("img")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: `Remover ${DOCUMENTO.nome}` }));
      expect(aoRemoverAnexo).toHaveBeenLastCalledWith("d1");
      fireEvent.click(screen.getByRole("button", { name: "Remover tela.png" }));
      expect(aoRemoverAnexo).toHaveBeenLastCalledWith("i1");
    });

    it("o formato antigo (.xls) leva o selo e o aviso para salvar como .xlsx; os atuais não", () => {
      renderizar({ anexos: [DOCUMENTO, DOCUMENTO_ANTIGO] });

      const antigo = screen.getByRole("button", { name: "Remover base.xls" }).closest(".chip-de-anexo") as HTMLElement;
      const selo = within(antigo).getByText("Excel (formato antigo)");
      expect(selo).toHaveClass("chip-de-anexo-selo");
      expect(selo).toHaveAttribute("title", expect.stringContaining("Salve como .docx ou .xlsx"));
      expect(antigo).toHaveTextContent("200 KB");
      expect(document.querySelectorAll(".chip-de-anexo-selo")).toHaveLength(1);
    });

    it("só com anexos, o botão de enviar vale mesmo sem texto", async () => {
      const { aoEnviar } = renderizar({ anexos: [DOCUMENTO] });

      fireEvent.click(screen.getByRole("button", { name: "enviar ⏎" }));

      await waitFor(() => expect(aoEnviar).toHaveBeenCalledWith(""));
    });

    it("o botão + abre o seletor com as imagens e as extensões dos documentos", () => {
      renderizar();

      const botao = screen.getByRole("button", { name: "Anexar arquivos" });
      expect(botao).toHaveAttribute(
        "title",
        "Anexar arquivos (também dá para colar com Ctrl+V ou arrastar para o terminal)",
      );
      const seletor = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(seletor).toHaveAttribute("multiple");
      expect(seletor?.accept.split(",")).toEqual(
        expect.arrayContaining(["image/png", "image/webp", ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".pptx", ".htm", ".md", ".log"]),
      );
    });

    it("o placeholder convida a colar ou arrastar imagens e arquivos", () => {
      const { campo } = renderizar();

      expect(campo).toHaveAttribute("placeholder", "peça algo e pressione enter · cole ou arraste imagens e arquivos");
    });

    it("colar um documento (ou imagem) anexa; colar um arquivo de formato não aceito só segue o padrão", () => {
      const { aoAnexar, campo } = renderizar();
      const planilha = new File(["a"], "vendas.xlsx", { type: "" });
      const foto = new File(["b"], "image.png", { type: "image/png" });

      const seguiuPadrao = fireEvent.paste(campo, { clipboardData: { files: [planilha, foto], getData: () => "" } });
      expect(seguiuPadrao).toBe(false);
      expect(aoAnexar).toHaveBeenCalledWith([planilha, foto]);

      // Com texto junto, um arquivo recusado não rouba a colagem.
      aoAnexar.mockClear();
      const zip = new File(["c"], "dados.zip", { type: "application/zip" });
      const colou = fireEvent.paste(campo, { clipboardData: { files: [zip], getData: () => "texto colado" } });
      expect(colou).toBe(true);
      expect(aoAnexar).not.toHaveBeenCalled();
    });

    it("colar só um arquivo recusado, sem texto, o entrega para a tela explicar o porquê", () => {
      const { aoAnexar, campo } = renderizar();
      const zip = new File(["c"], "dados.zip", { type: "application/zip" });

      fireEvent.paste(campo, { clipboardData: { files: [zip], getData: () => "" } });

      expect(aoAnexar).toHaveBeenCalledWith([zip]);
    });
  });

  describe("texto vindo de fora (nota arrastada)", () => {
    it("entra no prompt vazio e foca o campo, sem enviar", () => {
      const { aoEnviar, aoEnfileirar, controle, campo } = renderizar();

      act(() => controle.current?.acrescentarTexto("revisar o domínio"));

      expect(campo).toHaveValue("revisar o domínio");
      expect(campo).toHaveFocus();
      expect(aoEnviar).not.toHaveBeenCalled();
      expect(aoEnfileirar).not.toHaveBeenCalled();
    });

    it("com texto no campo, é acrescentado numa linha nova", () => {
      const { controle, campo } = renderizar();
      fireEvent.change(campo, { target: { value: "corrija o bug" } });

      act(() => controle.current?.acrescentarTexto("e rode os testes"));
      expect(campo).toHaveValue("corrija o bug\ne rode os testes");

      fireEvent.change(campo, { target: { value: "lista:\n" } });
      act(() => controle.current?.acrescentarTexto("item"));
      expect(campo).toHaveValue("lista:\nitem");
    });
  });

  describe("melhorar o pedido (✨)", () => {
    afterEach(() => vi.restoreAllMocks());

    const MELHORADO = {
      texto: "Rode os testes do pacote web e corrija os que falharem.",
      uso: { entrada: 900, criacaoDeCache: 0, leituraDeCache: 0, saida: 60 },
      indiceDeCusto: 19_800,
      duracaoMs: 1800,
    };

    it("desabilitado com o campo vazio, com o servidor fora e com um pedido rodando", () => {
      const { campo } = renderizar();
      const botao = screen.getByRole("button", { name: "Melhorar o pedido" });
      expect(botao).toHaveAttribute("title", "Melhorar o pedido");
      expect(botao).toBeDisabled();
      fireEvent.change(campo, { target: { value: "testes" } });
      expect(botao).toBeEnabled();
    });

    it.each([
      ["trabalhando", { trabalhando: true }],
      ["desconectado", { desconectado: true }],
    ] as const)("%s: o botão fica desabilitado mesmo com texto", (_nome, opcoes) => {
      const { campo } = renderizar(opcoes);
      fireEvent.change(campo, { target: { value: "testes" } });
      expect(screen.getByRole("button", { name: "Melhorar o pedido" })).toBeDisabled();
    });

    it("manda onde \"orquestrador\" e a pasta, troca o texto sem enviar e o desfazer volta o original", async () => {
      const melhorar = vi.spyOn(api, "melhorarPrompt").mockResolvedValue(MELHORADO);
      const { aoEnviar, aoEnfileirar, campo } = renderizar({ anexos: [IMAGEM] });
      fireEvent.change(campo, { target: { value: "roda os testes" } });

      fireEvent.click(screen.getByRole("button", { name: "Melhorar o pedido" }));

      expect(melhorar).toHaveBeenCalledWith(
        { texto: "roda os testes", onde: "orquestrador", pasta: "painel-app" },
        expect.any(AbortSignal),
      );
      await waitFor(() => expect(campo).toHaveValue(MELHORADO.texto));
      expect(screen.getByRole("status")).toHaveTextContent("melhorado · ≈ índice 19,8 mil · desfazer");
      expect(aoEnviar).not.toHaveBeenCalled();
      expect(aoEnfileirar).not.toHaveBeenCalled();
      // A imagem anexada continua no campo.
      expect(screen.getByRole("img", { name: "tela.png" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "desfazer" }));
      expect(campo).toHaveValue("roda os testes");
      expect(screen.queryByRole("button", { name: "desfazer" })).not.toBeInTheDocument();
    });

    it("melhorando: o campo trava, o botão vira cancelar e cancelar aborta", () => {
      let sinal: AbortSignal | undefined;
      vi.spyOn(api, "melhorarPrompt").mockImplementation((_dados, recebido) => {
        sinal = recebido;
        return new Promise(() => undefined);
      });
      const { aoEnviar, campo } = renderizar();
      fireEvent.change(campo, { target: { value: "roda os testes" } });

      fireEvent.click(screen.getByRole("button", { name: "Melhorar o pedido" }));

      expect(campo).toHaveAttribute("readonly");
      expect(screen.getByRole("button", { name: "enviar ⏎" })).toBeDisabled();
      fireEvent.keyDown(campo, { key: "Enter" });
      expect(aoEnviar).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Cancelar a melhoria do pedido" }));
      expect(sinal?.aborted).toBe(true);
      expect(campo).not.toHaveAttribute("readonly");
      expect(campo).toHaveValue("roda os testes");
    });

    it("erro: mensagem curta perto do campo e o texto fica intacto", async () => {
      vi.spyOn(api, "melhorarPrompt").mockRejectedValue(new Error("O servidor respondeu com erro 500."));
      const { campo } = renderizar();
      fireEvent.change(campo, { target: { value: "roda os testes" } });

      fireEvent.click(screen.getByRole("button", { name: "Melhorar o pedido" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Não foi possível melhorar o pedido: O servidor respondeu com erro 500.",
      );
      expect(campo).toHaveValue("roda os testes");
    });
  });
});
