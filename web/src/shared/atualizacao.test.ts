import {
  avisoDosOrquestradoresTrabalhando,
  avisoDosPedidosEmAndamento,
  descreverAtualizacao,
  percentualDoDownload,
  resumirMensagem,
  textoDaEspera,
  textoDaEtapa,
} from "./atualizacao";
import type { EstadoDaAtualizacao } from "./ponteDoDesktop";

function estado(alteracoes: Partial<EstadoDaAtualizacao> = {}): EstadoDaAtualizacao {
  return {
    situacao: "em-dia",
    versaoAtual: "0.2.0",
    versaoNova: null,
    progresso: null,
    mensagemDeErro: null,
    etapa: null,
    orquestradoresTrabalhando: null,
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

describe("descreverAtualizacao no Mac", () => {
  it("mostra a etapa, a espera pelos orquestradores e só a primeira linha do erro", () => {
    expect(descreverAtualizacao(estado({ situacao: "verificando", etapa: "Baixando o código" }))).toBe(
      "Versão 0.2.0 — baixando o código…",
    );
    expect(descreverAtualizacao(estado({ situacao: "baixando", versaoNova: "0.2.1", etapa: "Gerando o app" }))).toBe(
      "Versão 0.2.0 — gerando o app…",
    );
    expect(
      descreverAtualizacao(estado({ situacao: "baixando", versaoNova: "0.2.1", etapa: "Instalando dependências", progresso: 30 })),
    ).toBe("Versão 0.2.0 — instalando dependências… 30%");
    expect(descreverAtualizacao(estado({ situacao: "aguardando", versaoNova: "0.2.1", orquestradoresTrabalhando: 2 }))).toBe(
      "Versão 0.2.0 — 0.2.1 pronta: reinicia quando 2 orquestradores terminarem",
    );
    expect(
      descreverAtualizacao(estado({ situacao: "erro", mensagemDeErro: "npm ci falhou (código 1)\nnpm ERR! linha 2\nnpm ERR! linha 3" })),
    ).toBe("Versão 0.2.0 — não foi possível verificar: npm ci falhou (código 1)");
  });
});

describe("resumirMensagem", () => {
  it("curta e de uma linha, fica inteira e sem detalhes", () => {
    expect(resumirMensagem("  sem internet ")).toEqual({ resumo: "sem internet", detalhes: null });
  });

  it("com várias linhas, resume na primeira com texto e guarda o resto nos detalhes", () => {
    expect(resumirMensagem("\n  npm ci falhou\n  npm ERR! code 1\n")).toEqual({
      resumo: "npm ci falhou",
      detalhes: "npm ci falhou\n  npm ERR! code 1",
    });
  });

  it("uma linha longa é cortada com reticências", () => {
    const longa = "x".repeat(300);
    const { resumo, detalhes } = resumirMensagem(longa);
    expect(resumo).toHaveLength(140);
    expect(resumo.endsWith("…")).toBe(true);
    expect(detalhes).toBe(longa);
  });
});

describe("textos da espera e da etapa", () => {
  it("concordam com a quantidade e põem reticências na etapa", () => {
    expect(avisoDosOrquestradoresTrabalhando(1)).toBe(
      "1 orquestrador trabalhando. Reiniciar agora interrompe o trabalho dele.",
    );
    expect(avisoDosOrquestradoresTrabalhando(3)).toBe(
      "3 orquestradores trabalhando. Reiniciar agora interrompe o trabalho deles.",
    );
    expect(textoDaEspera(1)).toBe("Reinicia quando 1 orquestrador terminar");
    expect(textoDaEspera(2)).toBe("Reinicia quando 2 orquestradores terminarem");
    expect(textoDaEspera(null)).toBe("Reinicia quando os orquestradores terminarem");
    expect(textoDaEtapa("Gerando o app")).toBe("Gerando o app…");
    expect(textoDaEtapa("Gerando o app...")).toBe("Gerando o app…");
    expect(textoDaEtapa(null)).toBeNull();
    expect(textoDaEtapa("  ")).toBeNull();
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
