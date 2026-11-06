import { avisoDosPedidosEmAndamento, descreverAtualizacao, percentualDoDownload } from "./atualizacao";
import type { EstadoDaAtualizacao } from "./ponteDoDesktop";

function estado(alteracoes: Partial<EstadoDaAtualizacao> = {}): EstadoDaAtualizacao {
  return {
    situacao: "em-dia",
    versaoAtual: "0.2.0",
    versaoNova: null,
    progresso: null,
    mensagemDeErro: null,
    ...alteracoes,
  };
}

describe("descreverAtualizacao", () => {
  it("mostra a versão atual e o resultado da verificação", () => {
    expect(descreverAtualizacao(estado())).toBe("Versão 0.2.0 — você está na versão mais recente");
    expect(descreverAtualizacao(estado({ situacao: "verificando" }))).toBe("Versão 0.2.0 — procurando atualizações…");
    expect(descreverAtualizacao(estado({ situacao: "baixando", versaoNova: "0.2.1", progresso: 45 }))).toBe(
      "Versão 0.2.0 — baixando 0.2.1… 45%",
    );
    expect(descreverAtualizacao(estado({ situacao: "baixando", versaoNova: "0.2.1" }))).toBe(
      "Versão 0.2.0 — baixando 0.2.1…",
    );
    expect(descreverAtualizacao(estado({ situacao: "pronta", versaoNova: "0.2.1" }))).toBe(
      "Versão 0.2.0 — 0.2.1 pronta: será instalada ao fechar o app",
    );
    expect(descreverAtualizacao(estado({ situacao: "erro", mensagemDeErro: " sem internet " }))).toBe(
      "Versão 0.2.0 — não foi possível verificar: sem internet",
    );
    expect(descreverAtualizacao(estado({ situacao: "erro" }))).toBe("Versão 0.2.0 — não foi possível verificar");
  });

  it("fora do app instalado, só avisa; sem a versão (o app não respondeu), mostra só o resultado", () => {
    expect(descreverAtualizacao(estado({ situacao: "indisponivel" }))).toBe("Atualizações só no app instalado");
    expect(descreverAtualizacao(estado({ situacao: "erro", versaoAtual: "", mensagemDeErro: "sem IPC" }))).toBe(
      "Não foi possível verificar: sem IPC",
    );
  });
});

describe("percentualDoDownload", () => {
  it("arredonda e limita entre 0 e 100; sem progresso, nulo", () => {
    expect(percentualDoDownload(45.6)).toBe(46);
    expect(percentualDoDownload(130)).toBe(100);
    expect(percentualDoDownload(-3)).toBe(0);
    expect(percentualDoDownload(null)).toBeNull();
    expect(percentualDoDownload(Number.NaN)).toBeNull();
  });
});

describe("avisoDosPedidosEmAndamento", () => {
  it("concorda com a quantidade", () => {
    expect(avisoDosPedidosEmAndamento(1)).toBe("Há 1 pedido em andamento; reiniciar agora vai cancelá-lo.");
    expect(avisoDosPedidosEmAndamento(3)).toBe("Há 3 pedidos em andamento; reiniciar agora vai cancelá-los.");
  });
});
