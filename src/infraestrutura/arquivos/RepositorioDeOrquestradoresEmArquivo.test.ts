import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { EventoRegistrado } from "../../orquestracao/EventoDeOrquestracao";
import { DadosDoOrquestrador, Orquestrador } from "../../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import { RepositorioDeOrquestradoresEmArquivo } from "./RepositorioDeOrquestradoresEmArquivo";

const agora = new Date("2026-10-28T12:00:00Z");

function novoOrquestrador(id: string): Orquestrador {
  return Orquestrador.criar({
    id,
    nome: `Orquestrador ${id}`,
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), id),
    sessaoId: `sessao-${id}`,
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "sonnet",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
      nivelDePermissao: "edicao",
    }),
    agora,
  });
}

describe("RepositorioDeOrquestradoresEmArquivo", () => {
  let pasta: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "repositorio-teste-"));
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it("reabre as instruções personalizadas de cada orquestrador, sem misturar", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    const comInstrucoes = novoOrquestrador("a");
    comInstrucoes.alterarConfiguracao({ instrucoesPersonalizadas: "Comece com PIRULITO.\nDepois: {{x}} $&" });
    comInstrucoes.registrarInstrucoesDoPedido(true);
    await repositorio.salvar(comInstrucoes);
    await repositorio.salvar(novoOrquestrador("b"));
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

    expect(reaberto.buscarPorId("a")?.configuracao.instrucoesPersonalizadas).toBe(
      "Comece com PIRULITO.\nDepois: {{x}} $&",
    );
    expect(reaberto.buscarPorId("b")?.configuracao.instrucoesPersonalizadas).toBe("");
    // Lembra que a conversa de "a" já recebeu instruções: apagá-las depois revoga as antigas.
    expect(reaberto.buscarPorId("a")?.registrarInstrucoesDoPedido(false)).toEqual({ revogarAnteriores: true });
    expect(reaberto.buscarPorId("b")?.registrarInstrucoesDoPedido(false)).toEqual({ revogarAnteriores: false });
  });

  it("reabre a escolha dos subagentes prontos de cada orquestrador", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    const comLista = novoOrquestrador("a");
    comLista.alterarConfiguracao({ subagentesProntos: ["revisor", "testador"] });
    const semNenhum = novoOrquestrador("b");
    semNenhum.alterarConfiguracao({ subagentesProntos: "nenhum" });
    await repositorio.salvar(comLista);
    await repositorio.salvar(semNenhum);
    await repositorio.salvar(novoOrquestrador("c"));
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

    expect(reaberto.buscarPorId("a")?.configuracao.subagentesProntos).toEqual(["revisor", "testador"]);
    expect(reaberto.buscarPorId("b")?.configuracao.subagentesProntos).toBe("nenhum");
    expect(reaberto.buscarPorId("c")?.configuracao.subagentesProntos).toBe("todos");
  });

  it("reabre os orquestradores e os eventos exatamente como ficaram", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    const orquestrador = novoOrquestrador("a");
    await repositorio.salvar(orquestrador);
    repositorio.anexarEvento("a", orquestrador.iniciarTurno("t1", "analise", agora));
    repositorio.anexarEvento("a", orquestrador.registrarDoMotor("t1", { tipo: "texto_do_orquestrador", texto: "ok" }));
    repositorio.anexarEvento("a", orquestrador.falharTurno("t1", "falha de rede", agora));
    orquestrador.agendarRetomada({ deTurnoId: "t1", causa: "rede", tentativa: 1, retomarEm: "2026-10-28T12:01:00.000Z" });
    await repositorio.salvar(orquestrador);
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

    expect(reaberto.buscarPorId("a")?.paraDados()).toEqual(orquestrador.paraDados());
    expect(reaberto.buscarPorId("a")?.retomadaPendente).toMatchObject({ deTurnoId: "t1", causa: "rede" });
    expect(reaberto.lerEventos("a", 0).map((evento) => [evento.sequencia, evento.tipo])).toEqual([
      [1, "turno_iniciado"],
      [2, "texto_do_orquestrador"],
      [3, "turno_falhou"],
    ]);
    expect(reaberto.lerEventos("a", 1)).toHaveLength(2);
  });

  it("numera os eventos por orquestrador, de forma independente", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    await repositorio.salvar(novoOrquestrador("a"));
    await repositorio.salvar(novoOrquestrador("b"));

    const doA = repositorio.anexarEvento("a", { tipo: "turno_cancelado", turnoId: "x" });
    const doB = repositorio.anexarEvento("b", { tipo: "turno_cancelado", turnoId: "y" });
    const outroDoA = repositorio.anexarEvento("a", { tipo: "turno_cancelado", turnoId: "z" });
    await repositorio.aguardarGravacoes();

    expect([doA.sequencia, doB.sequencia, outroDoA.sequencia]).toEqual([1, 1, 2]);
  });

  it("remove o orquestrador e o histórico do disco", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    await repositorio.salvar(novoOrquestrador("a"));
    await repositorio.remover("a");

    const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

    expect(reaberto.listar()).toEqual([]);
  });

  describe("ao ler o orquestrador.json", () => {
    const pastaDo = (id: string): string => path.join(pasta, "orquestradores", id);

    async function gravarArquivo(id: string, conteudo: string): Promise<void> {
      await mkdir(pastaDo(id), { recursive: true });
      await writeFile(path.join(pastaDo(id), "orquestrador.json"), conteudo, "utf8");
    }

    /** Um orquestrador.json como as primeiras versões gravavam, com as opções que a ADR-28 removeu. */
    function arquivoAntigo(): Record<string, unknown> {
      return {
        id: "antigo",
        nome: "Antigo",
        pastaDeTrabalho: path.resolve("/projetos/antigo"),
        sessaoId: "sessao-antiga",
        sessaoIniciada: true,
        criadoEm: "2026-10-01T10:00:00.000Z",
        configuracao: {
          modeloDoOrquestrador: "opus",
          modeloDosSubagentes: "sonnet",
          quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
          nivelDePermissao: "leitura",
          permitirTrabalhoDireto: true,
          proporPlanoEmPedidosGrandes: false,
        },
        turnos: [
          {
            id: "t0",
            texto: "antigo",
            iniciadoEm: "2026-10-01T10:00:00.000Z",
            encerradoEm: "2026-10-01T10:01:00.000Z",
            situacao: "concluido",
            resposta: "ok",
            motivoDaFalha: null,
            uso: { duracaoMs: 1, tokensDeEntrada: 2, tokensDeSaida: 3, subagentesLancados: 0 },
            subagentes: [
              { id: "s1", descricao: "ler", situacao: "concluido", tokens: 5, duracaoMs: 6, resumo: "lido" },
            ],
          },
        ],
        campoQueNaoExisteMais: "x",
      };
    }

    it("abre um arquivo antigo válido com os padrões do agregado e descarta chaves desconhecidas", async () => {
      await gravarArquivo("antigo", JSON.stringify(arquivoAntigo()));

      const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
      const dados = repositorio.buscarPorId("antigo")?.paraDados();

      expect(dados).toMatchObject({
        id: "antigo",
        nome: "Antigo",
        sessaoIniciada: true,
        worktree: null,
        fila: [],
        instrucoesNaConversa: false,
        retomadaPendente: null,
        configuracao: {
          permitirCommitEPush: false,
          // Gravado antes da opção de artefatos online: desligada.
          permitirArtefatosOnline: false,
          esforcoDoOrquestrador: "padrao",
          esforcoDosSubagentes: "padrao",
          instrucoesPersonalizadas: "",
          // Gravado antes da escolha dos subagentes prontos: recebe todos, como antes.
          subagentesProntos: "todos",
        },
      });
      expect(dados?.turnos[0]).toMatchObject({
        anexos: [],
        modo: "execucao",
        decisaoDoPlano: null,
        perguntas: [],
        subagentes: [{ id: "s1", resumo: "lido" }],
      });
      expect(dados).not.toHaveProperty("campoQueNaoExisteMais");
      expect(dados?.configuracao).not.toHaveProperty("proporPlanoEmPedidosGrandes");
      expect(existsSync(path.join(pastaDo("antigo"), "orquestrador.ilegivel.json"))).toBe(false);
    });

    it("reabre turnos com anexos: a imagem gravada sem categoria vale imagem; o documento mantém a dele", async () => {
      const antigo = arquivoAntigo();
      const [turno] = antigo.turnos as Record<string, unknown>[];
      await gravarArquivo(
        "antigo",
        JSON.stringify({
          ...antigo,
          turnos: [
            {
              ...turno,
              anexos: [
                { id: "a1", nome: "tela.png", tipoDeMidia: "image/png", tamanhoEmBytes: 10, arquivo: "a1.png" },
                {
                  id: "d1",
                  nome: "relatorio.pdf",
                  tipoDeMidia: "application/pdf",
                  tamanhoEmBytes: 20,
                  arquivo: "d1.pdf",
                  categoria: "documento",
                },
              ],
            },
          ],
        }),
      );

      const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

      expect(repositorio.buscarPorId("antigo")?.paraDados().turnos[0]?.anexos).toEqual([
        { id: "a1", nome: "tela.png", tipoDeMidia: "image/png", tamanhoEmBytes: 10, arquivo: "a1.png", categoria: "imagem" },
        { id: "d1", nome: "relatorio.pdf", tipoDeMidia: "application/pdf", tamanhoEmBytes: 20, arquivo: "d1.pdf", categoria: "documento" },
      ]);
    });

    it("preserva a opção de artefatos online ligada ao reabrir", async () => {
      const antigo = arquivoAntigo();
      await gravarArquivo(
        "antigo",
        JSON.stringify({
          ...antigo,
          configuracao: { ...(antigo.configuracao as object), permitirArtefatosOnline: true },
        }),
      );

      const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

      expect(repositorio.buscarPorId("antigo")?.paraDados().configuracao.permitirArtefatosOnline).toBe(true);
    });

    it("reabre a retomada automática pendente gravada antes do reinício", async () => {
      const retomadaPendente = {
        deTurnoId: "t0",
        causa: "limite_de_uso",
        tentativa: 2,
        retomarEm: "2026-10-01T13:01:00.000Z",
      };
      await gravarArquivo("antigo", JSON.stringify({ ...arquivoAntigo(), retomadaPendente }));

      const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

      expect(repositorio.buscarPorId("antigo")?.retomadaPendente).toEqual(retomadaPendente);
    });

    it("guarda ao lado uma retomada pendente fora do esquema", async () => {
      const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await gravarArquivo(
        "causa-errada",
        JSON.stringify({
          ...arquivoAntigo(),
          retomadaPendente: { deTurnoId: "t0", causa: "outro", tentativa: 1, retomarEm: "2026-10-01T13:01:00.000Z" },
        }),
      );

      const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

      expect(repositorio.listar()).toEqual([]);
      expect(existsSync(path.join(pastaDo("causa-errada"), "orquestrador.ilegivel.json"))).toBe(true);
      avisos.mockRestore();
    });

    it("guarda ao lado um JSON quebrado, avisa no log e abre os outros", async () => {
      const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
      await repositorio.salvar(novoOrquestrador("bom"));
      await repositorio.aguardarGravacoes();
      await gravarArquivo("quebrado", '{"id": "quebrado", "nome": ');

      const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

      expect(reaberto.listar().map((item) => item.id)).toEqual(["bom"]);
      expect(existsSync(path.join(pastaDo("quebrado"), "orquestrador.json"))).toBe(false);
      expect(await readFile(path.join(pastaDo("quebrado"), "orquestrador.ilegivel.json"), "utf8")).toBe(
        '{"id": "quebrado", "nome": ',
      );
      expect(avisos).toHaveBeenCalledTimes(1);
      expect(String(avisos.mock.calls[0]?.[0])).toContain("orquestrador.ilegivel.json");
      avisos.mockRestore();
    });

    it("guarda ao lado um arquivo fora do esquema ou com valor que o agregado recusa", async () => {
      const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const semTurnos = arquivoAntigo();
      delete semTurnos.turnos;
      await gravarArquivo("sem-turnos", JSON.stringify(semTurnos));
      await gravarArquivo("tipo-errado", JSON.stringify({ ...arquivoAntigo(), sessaoIniciada: "sim" }));
      await gravarArquivo(
        "prontos-errados",
        JSON.stringify({
          ...arquivoAntigo(),
          configuracao: { ...(arquivoAntigo().configuracao as object), subagentesProntos: "alguns" },
        }),
      );
      await gravarArquivo(
        "limite-errado",
        JSON.stringify({
          ...arquivoAntigo(),
          configuracao: {
            modeloDoOrquestrador: "opus",
            modeloDosSubagentes: "sonnet",
            quantidadeDeSubagentes: { modo: "fixa", limite: 99 },
            nivelDePermissao: "leitura",
          },
        }),
      );

      const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

      expect(repositorio.listar()).toEqual([]);
      for (const id of ["sem-turnos", "tipo-errado", "prontos-errados", "limite-errado"]) {
        expect(existsSync(path.join(pastaDo(id), "orquestrador.json"))).toBe(false);
        expect(existsSync(path.join(pastaDo(id), "orquestrador.ilegivel.json"))).toBe(true);
      }
      expect(avisos).toHaveBeenCalledTimes(4);
      avisos.mockRestore();

      // O arquivo renomeado não é lido de novo: reabrir não repete o aviso.
      const outroAviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
      expect(outroAviso).not.toHaveBeenCalled();
      outroAviso.mockRestore();
    });
  });

  describe("ao arquivar a conversa", () => {
    const uso = { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 };
    const pastaDoA = (): string => path.join(pasta, "orquestradores", "a");

    async function lerLinhas(caminho: string): Promise<EventoRegistrado[]> {
      const conteudo = await readFile(caminho, "utf8");
      return conteudo
        .split("\n")
        .filter((linha) => linha.trim() !== "")
        .map((linha) => JSON.parse(linha) as EventoRegistrado);
    }

    async function lerEstado(caminho: string): Promise<DadosDoOrquestrador> {
      return JSON.parse(await readFile(caminho, "utf8")) as DadosDoOrquestrador;
    }

    /** Uma conversa de um turno (3 eventos) e a limpeza dela, que vira o evento 4. */
    async function conversarELimpar(): Promise<{
      repositorio: RepositorioDeOrquestradoresEmArquivo;
      orquestrador: Orquestrador;
      registrado: EventoRegistrado;
      gravacao: Promise<void>;
    }> {
      const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
      const orquestrador = novoOrquestrador("a");
      await repositorio.salvar(orquestrador);
      repositorio.anexarEvento("a", orquestrador.iniciarTurno("t1", "analise", agora));
      repositorio.anexarEvento("a", orquestrador.registrarDoMotor("t1", { tipo: "sessao_iniciada" }));
      repositorio.anexarEvento("a", orquestrador.concluirTurno("t1", "pronto", uso, agora));
      await repositorio.salvar(orquestrador);

      const { registrado, gravacao } = repositorio.arquivarConversa(
        orquestrador,
        orquestrador.limparConversa("sessao-nova"),
      );
      return { repositorio, orquestrador, registrado, gravacao };
    }

    it("copia a conversa anterior para historico/conversa-<N+1> e recomeça os arquivos", async () => {
      const { registrado, gravacao } = await conversarELimpar();
      await gravacao;

      expect(registrado).toMatchObject({ sequencia: 4, tipo: "conversa_limpa", turnosAnteriores: 1 });

      const arquivada = path.join(pastaDoA(), "historico", "conversa-4");
      expect((await lerLinhas(path.join(arquivada, "eventos.jsonl"))).map((evento) => evento.sequencia)).toEqual([
        1, 2, 3,
      ]);
      expect(await lerEstado(path.join(arquivada, "orquestrador.json"))).toMatchObject({
        sessaoId: "sessao-a",
        sessaoIniciada: true,
        turnos: [{ id: "t1" }],
      });

      expect(await lerLinhas(path.join(pastaDoA(), "eventos.jsonl"))).toEqual([registrado]);
      expect(await lerEstado(path.join(pastaDoA(), "orquestrador.json"))).toMatchObject({
        sessaoId: "sessao-nova",
        sessaoIniciada: false,
        turnos: [],
      });
    });

    it("o histórico em memória passa a começar no evento de limpeza", async () => {
      const { repositorio, registrado, gravacao } = await conversarELimpar();

      expect(repositorio.lerEventos("a", 0)).toEqual([registrado]);
      expect(repositorio.lerEventos("a", 2)).toEqual([registrado]);
      expect(repositorio.lerEventos("a", 4)).toEqual([]);
      await gravacao;
    });

    it("um evento anexado logo depois vai para o arquivo novo, depois da limpeza", async () => {
      const { repositorio, orquestrador } = await conversarELimpar();

      const seguinte = repositorio.anexarEvento("a", orquestrador.iniciarTurno("t2", "do zero", agora));
      await repositorio.aguardarGravacoes();

      expect(seguinte.sequencia).toBe(5);
      expect((await lerLinhas(path.join(pastaDoA(), "eventos.jsonl"))).map((evento) => evento.tipo)).toEqual([
        "conversa_limpa",
        "turno_iniciado",
      ]);
    });

    it("ao reabrir, ignora o historico e continua a numeração em N+2", async () => {
      const { orquestrador, gravacao } = await conversarELimpar();
      await gravacao;

      const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

      expect(reaberto.listar().map((item) => item.id)).toEqual(["a"]);
      expect(reaberto.buscarPorId("a")?.paraDados()).toEqual(orquestrador.paraDados());
      expect(reaberto.lerEventos("a", 0).map((evento) => [evento.sequencia, evento.tipo])).toEqual([
        [4, "conversa_limpa"],
      ]);
      expect(reaberto.lerEventos("a", 1).map((evento) => evento.sequencia)).toEqual([4]);
      expect(reaberto.anexarEvento("a", { tipo: "turno_cancelado", turnoId: "x" }).sequencia).toBe(5);
      await reaberto.aguardarGravacoes();
    });

    it("limpar de novo arquiva a segunda conversa em outra pasta, sem reiniciar a numeração", async () => {
      const { repositorio, orquestrador, gravacao } = await conversarELimpar();
      await gravacao;
      repositorio.anexarEvento("a", orquestrador.iniciarTurno("t2", "de novo", agora));
      repositorio.anexarEvento("a", orquestrador.cancelarTurno("t2", agora));

      const segunda = repositorio.arquivarConversa(orquestrador, orquestrador.limparConversa("sessao-3"));
      await segunda.gravacao;

      expect(segunda.registrado.sequencia).toBe(7);
      const arquivada = path.join(pastaDoA(), "historico", "conversa-7");
      expect((await lerLinhas(path.join(arquivada, "eventos.jsonl"))).map((evento) => evento.sequencia)).toEqual([
        4, 5, 6,
      ]);
      expect(existsSync(path.join(pastaDoA(), "historico", "conversa-4", "eventos.jsonl"))).toBe(true);
    });

    it("excluir o orquestrador apaga também o historico", async () => {
      const { repositorio, gravacao } = await conversarELimpar();
      await gravacao;
      expect(existsSync(path.join(pastaDoA(), "historico"))).toBe(true);

      await repositorio.remover("a");

      expect(existsSync(pastaDoA())).toBe(false);
    });
  });
});
