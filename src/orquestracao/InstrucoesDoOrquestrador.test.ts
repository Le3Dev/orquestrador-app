import path from "node:path";

import { describe, expect, it } from "vitest";

import { linhasDaRegraDasPerguntas } from "../perguntas/PerguntaDoApp";
import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { instrucoesDoOrquestrador, instrucoesDoSubagente, mensagemParaOOrquestrador } from "./InstrucoesDoOrquestrador";
import { ModoDoTurno } from "./ModoDoTurno";
import { NivelDePermissao } from "./NivelDePermissao";
import { PastaDeTrabalho } from "./PastaDeTrabalho";

const pasta = PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel");
const PASTA_DE_ARTEFATOS = path.resolve("/dados/artefatos/entrada/orquestradores/o1");

function bloco(
  nivelDePermissao: NivelDePermissao = "leitura",
  modo: ModoDoTurno = "execucao",
  pastaDeArtefatos: string | null = PASTA_DE_ARTEFATOS,
): string {
  const configuracao = ConfiguracaoDoOrquestrador.de({
    modeloDoOrquestrador: "opus",
    modeloDosSubagentes: "haiku",
    quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
    nivelDePermissao,
  });
  const texto = mensagemParaOOrquestrador("monte um dashboard", configuracao, [], modo, pastaDeArtefatos);
  return texto.slice(0, texto.indexOf("</configuracao-do-pedido>"));
}

describe("artefatos no bloco <configuracao-do-pedido>", () => {
  it.each<[NivelDePermissao, ModoDoTurno]>([
    ["leitura", "execucao"],
    ["edicao", "execucao"],
    ["edicao_e_comandos", "execucao"],
    ["edicao_e_comandos", "planejamento"],
  ])("no nível %s, em %s, diz quando, onde e como gravar o artefato", (nivel, modo) => {
    const texto = bloco(nivel, modo);

    expect(texto).toContain(
      `- Artefatos: quando o usuário pedir uma visualização, relatório, diagrama, protótipo, dashboard ou página, ou quando o resultado ficar melhor como página do que como texto, entregue um artefato: UM arquivo autocontido gravado na pasta ${PASTA_DE_ARTEFATOS}`,
    );
    expect(texto).toContain(".html com CSS e JS inline, sem CDN nem recursos externos (a rede é bloqueada) e imagens como data URI; ou .md");
    expect(texto).toContain("Até 5 MB");
    expect(texto).toContain("Nome do arquivo curto e descritivo, porque vira o título");
    expect(texto).toContain("regrave o MESMO arquivo: ele vira uma nova versão");
    expect(texto).toContain("Na resposta, cite pelo nome o artefato criado ou atualizado.");
    expect(texto).toContain("Vale em qualquer permissão, inclusive no planejamento");
  });

  it("artefato não é arquivo do projeto: o Orquestrador pode gravá-lo ou delegar passando o caminho", () => {
    const texto = bloco();

    expect(texto).toContain("Artefato não é arquivo do projeto: você mesmo pode gravá-lo (é a exceção à regra de não editar arquivos)");
    expect(texto).toContain('ou delegá-lo a um subagente "executor", passando a ele esse caminho absoluto');
    expect(texto).toContain("fora dessa pasta, as regras acima continuam valendo");
  });

  it("mantém o \"Você não edita arquivos\" (ADR-14) com a exceção explícita dos artefatos", () => {
    const texto = bloco("edicao_e_comandos");

    expect(texto).toContain(
      '- Você não edita arquivos: toda alteração no projeto vai para um subagente "executor". A única exceção são os artefatos (abaixo), que não são arquivos do projeto.',
    );
  });

  it.each<ModoDoTurno>(["execucao", "planejamento"])(
    "em %s, o \"Você não edita arquivos\" vale sempre, junto da exceção dos artefatos",
    (modo) => {
      const texto = bloco("leitura", modo);

      expect(texto).toContain("- Faça você mesmo o trivial:");
      expect(texto).toContain("- Você não edita arquivos:");
      expect(texto).toContain(`gravado na pasta ${PASTA_DE_ARTEFATOS}`);
      expect(texto).not.toContain("Não faça o trabalho você mesmo");
    },
  );

  it("sem pasta de artefatos, não fala de artefatos", () => {
    expect(bloco("leitura", "execucao", null)).not.toContain("- Artefatos:");
  });
});

describe("perguntas com opções no bloco <configuracao-do-pedido>", () => {
  it.each<[NivelDePermissao, ModoDoTurno, string | null]>([
    ["leitura", "execucao", PASTA_DE_ARTEFATOS],
    ["edicao_e_comandos", "execucao", null],
    ["edicao_e_comandos", "planejamento", PASTA_DE_ARTEFATOS],
  ])("no nível %s, em %s, traz a regra com o exemplo do bloco", (nivel, modo, pastaDeArtefatos) => {
    const texto = bloco(nivel, modo, pastaDeArtefatos);
    const [primeira = "", ...resto] = linhasDaRegraDasPerguntas();

    expect(texto).toContain(`- ${primeira}`);
    for (const linha of resto) {
      expect(texto).toContain(`  ${linha}`);
    }
    expect(texto).toContain("  ```pergunta-do-app\n");
    expect(texto).toContain('no formato "pergunta → escolha"');
  });

  it("só a resposta final do orquestrador é lida: subagentes não perguntam", () => {
    expect(bloco()).toContain(
      "  Só a sua resposta final é lida: subagentes não perguntam ao usuário. Se um deles precisar de uma decisão, pergunte você, sem delegar a pergunta.",
    );
  });

  it("não vai nas instruções dos subagentes", () => {
    expect(instrucoesDoSubagente(pasta, false, PASTA_DE_ARTEFATOS)).not.toContain("pergunta-do-app");
  });
});

describe("artefatos nas instruções fixas", () => {
  it("o Orquestrador nunca edita arquivos do projeto, com a exceção dos artefatos", () => {
    const texto = instrucoesDoOrquestrador(pasta);

    expect(texto).toContain("Nunca edite arquivos você mesmo: toda alteração no projeto vai para um subagente.");
    expect(texto).toContain("A exceção são os artefatos (páginas e relatórios para o usuário, gravados na pasta de artefatos que o bloco indica)");
  });

  it("o Subagente recebe a pasta exata e o formato; sem a pasta, nada muda", () => {
    const comPasta = instrucoesDoSubagente(pasta, false, PASTA_DE_ARTEFATOS);
    const semPasta = instrucoesDoSubagente(pasta, false);

    expect(comPasta).toContain(`grave UM arquivo autocontido na pasta ${PASTA_DE_ARTEFATOS}`);
    expect(comPasta).toContain(".html com CSS e JS inline, sem CDN nem recursos externos");
    expect(comPasta).toContain("gravar nessa pasta é permitido em qualquer permissão");
    expect(comPasta).toContain("Nunca faça commit nem push.");
    expect(semPasta).not.toContain("artefato");
  });
});
