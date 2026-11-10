import { lerAvisoDeNavegacao, SCRIPT_DE_NAVEGACAO } from "./navegacaoDoArtefato";

describe("lerAvisoDeNavegacao", () => {
  const aviso = { origem: "orquestrador-artefato", suportado: true, podeVoltar: true, podeAvancar: false };

  it("aceita o aviso da página e devolve só os três campos", () => {
    expect(lerAvisoDeNavegacao({ ...aviso, extra: "ignorado" })).toEqual({
      suportado: true,
      podeVoltar: true,
      podeAvancar: false,
    });
  });

  it.each([
    ["sem objeto", null],
    ["texto", "voltar"],
    ["número", 1],
    ["origem de outro", { ...aviso, origem: "outra" }],
    ["sem origem", { suportado: true, podeVoltar: true, podeAvancar: true }],
    ["campo que não é booleano", { ...aviso, podeAvancar: "sim" }],
    ["campo faltando", { origem: aviso.origem, suportado: true, podeVoltar: true }],
  ])("recusa %s", (_nome, dados) => {
    expect(lerAvisoDeNavegacao(dados)).toBeNull();
  });
});

/**
 * O script roda dentro do iframe: aqui ele roda numa janela de mentira, para
 * conferir a contagem do histórico e que só o app (a janela pai) o comanda.
 */
describe("SCRIPT_DE_NAVEGACAO", () => {
  type Ouvinte = (evento: unknown) => void;

  function rodar() {
    const pai = { postMessage: vi.fn() };
    const ouvintes: Record<string, Ouvinte[]> = {};
    const local = { href: "about:srcdoc" };
    // O script troca `history.go` por uma versão que conta; este é o `go` de verdade, que ele chama.
    const go = vi.fn();
    const historico = {
      pushState: vi.fn((_estado: unknown, _titulo: string, endereco: string) => {
        local.href = `about:srcdoc${endereco}`;
      }),
      replaceState: vi.fn((_estado: unknown, _titulo: string, endereco: string) => {
        local.href = `about:srcdoc${endereco}`;
      }),
      go,
      back: vi.fn(),
      forward: vi.fn(),
    };
    const janela = {
      parent: pai,
      history: historico,
      addEventListener: (nome: string, ouvinte: Ouvinte) => {
        (ouvintes[nome] ??= []).push(ouvinte);
      },
    };
    new Function("window", "location", "setTimeout", "clearTimeout", `with (window) { ${SCRIPT_DE_NAVEGACAO} }`)(
      janela,
      local,
      setTimeout,
      clearTimeout,
    );
    const emitir = (nome: string, evento: unknown = {}) => (ouvintes[nome] ?? []).forEach((ouvinte) => ouvinte(evento));
    const ultimo = () => pai.postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    const comando = (acao: string, origem = pai as unknown, marca = "orquestrador-app") =>
      emitir("message", { source: origem, data: { origem: marca, acao } });
    /** Um clique em link de âncora: o endereço muda e o evento chega. */
    const irPara = (hash: string) => {
      local.href = `about:srcdoc${hash}`;
      emitir("hashchange");
    };
    return { pai, janela, historico, go, local, emitir, ultimo, comando, irPara };
  }

  it("avisa o estado ao carregar: sem histórico", () => {
    const { pai, ultimo } = rodar();
    expect(pai.postMessage).toHaveBeenCalledTimes(1);
    expect(pai.postMessage.mock.calls[0]?.[1]).toBe("*");
    expect(ultimo()).toEqual({ origem: "orquestrador-artefato", suportado: true, podeVoltar: false, podeAvancar: false });
  });

  it("conta cada navegação por âncora e avisa; repetir o mesmo evento não conta de novo", () => {
    const { ultimo, irPara, emitir } = rodar();
    irPara("#um");
    expect(ultimo()).toMatchObject({ podeVoltar: true, podeAvancar: false });
    // O mesmo endereço de novo (popstate depois do hashchange): não é uma entrada nova.
    emitir("popstate");
    irPara("#dois");
    expect(ultimo()).toMatchObject({ podeVoltar: true, podeAvancar: false });
  });

  it("voltar e avançar andam um passo no histórico, só até onde a pilha tem entradas", () => {
    const { go, ultimo, irPara, comando, local, emitir } = rodar();
    irPara("#um");
    irPara("#dois");

    comando("avancar");
    expect(go).not.toHaveBeenCalled();

    comando("voltar");
    expect(go).toHaveBeenLastCalledWith(-1);
    // Enquanto a volta não chegou, outro comando não anda.
    comando("voltar");
    expect(go).toHaveBeenCalledTimes(1);
    local.href = "about:srcdoc#um";
    emitir("hashchange");
    expect(ultimo()).toMatchObject({ podeVoltar: true, podeAvancar: true });

    comando("voltar");
    local.href = "about:srcdoc";
    emitir("popstate");
    expect(ultimo()).toMatchObject({ podeVoltar: false, podeAvancar: true });
    comando("voltar");
    expect(go).toHaveBeenCalledTimes(2);

    comando("avancar");
    expect(go).toHaveBeenLastCalledWith(1);
  });

  it("uma navegação nova depois de voltar joga fora o que estava à frente", () => {
    const { ultimo, irPara, comando, local, emitir } = rodar();
    irPara("#um");
    irPara("#dois");
    comando("voltar");
    local.href = "about:srcdoc#um";
    emitir("hashchange");
    irPara("#tres");
    expect(ultimo()).toMatchObject({ podeVoltar: true, podeAvancar: false });
  });

  it("history.pushState da página entra no histórico; replaceState não", () => {
    const { janela, ultimo } = rodar();
    janela.history.pushState({}, "", "#rota");
    expect(ultimo()).toMatchObject({ podeVoltar: true, podeAvancar: false });
    const avisos = (janela.parent.postMessage as ReturnType<typeof vi.fn>).mock.calls.length;
    janela.history.replaceState({}, "", "#outra");
    expect((janela.parent.postMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(avisos);
  });

  it("o pedido de estado responde na hora", () => {
    const { pai, comando } = rodar();
    comando("estado");
    expect(pai.postMessage).toHaveBeenCalledTimes(2);
  });

  it("só obedece à janela pai e à marca do app: outro remetente ou outra marca é ignorado", () => {
    const { go, irPara, comando, pai } = rodar();
    irPara("#um");
    const avisos = pai.postMessage.mock.calls.length;

    comando("voltar", { outra: true });
    comando("voltar", pai, "outra");
    comando("estado", { outra: true });
    expect(go).not.toHaveBeenCalled();
    expect(pai.postMessage.mock.calls.length).toBe(avisos);
  });

  it("fora de um iframe (sem janela pai distinta) não faz nada", () => {
    const janela: Record<string, unknown> = { addEventListener: vi.fn(), history: {} };
    janela.parent = janela;
    new Function("window", "location", "setTimeout", "clearTimeout", `with (window) { ${SCRIPT_DE_NAVEGACAO} }`)(
      janela,
      { href: "x" },
      setTimeout,
      clearTimeout,
    );
    expect(janela.addEventListener).not.toHaveBeenCalled();
  });
});
