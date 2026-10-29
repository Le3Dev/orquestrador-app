import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";

const raiz = path.resolve("/projetos");
const agora = new Date("2026-10-28T12:00:00Z");
const uso = { duracaoMs: 1000, tokensDeEntrada: 10, tokensDeSaida: 5, subagentesLancados: 2 };

function novoOrquestrador(): Orquestrador {
  return Orquestrador.criar({
    id: "o1",
    nome: "  Painel  ",
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(raiz, "painel"),
    sessaoId: "s1",
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "sonnet",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
    }),
    agora,
  });
}

function capturarErro(acao: () => unknown): ErroDeOrquestracao {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeOrquestracao) {
      return erro;
    }
  }
  throw new Error("Era esperado um ErroDeOrquestracao.");
}

describe("Orquestrador", () => {
  it("nasce ocioso, com o nome aparado e sem sessão iniciada", () => {
    const orquestrador = novoOrquestrador();

    expect(orquestrador.nome).toBe("Painel");
    expect(orquestrador.situacao).toBe("ocioso");
    expect(orquestrador.sessaoIniciada).toBe(false);
  });

  it("recusa nome vazio", () => {
    const erro = capturarErro(() =>
      Orquestrador.criar({
        id: "o1",
        nome: "   ",
        pastaDeTrabalho: PastaDeTrabalho.dentroDe(raiz, "painel"),
        sessaoId: "s1",
        configuracao: novoOrquestrador().configuracao,
        agora,
      }),
    );
    expect(erro.motivo).toBe("dados_invalidos");
  });

  it("recusa um segundo turno enquanto o primeiro está em andamento", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise o projeto", agora);

    const erro = capturarErro(() => orquestrador.iniciarTurno("t2", "outra coisa", agora));

    expect(erro.motivo).toBe("turno_em_andamento");
    expect(orquestrador.situacao).toBe("trabalhando");
  });

  it("aceita um novo turno depois que o anterior termina", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise o projeto", agora);
    orquestrador.concluirTurno("t1", "pronto", uso, agora);

    const evento = orquestrador.iniciarTurno("t2", "e agora?", agora);

    expect(evento).toMatchObject({ tipo: "turno_iniciado", turnoId: "t2", texto: "e agora?" });
    expect(orquestrador.totalDeTurnos).toBe(2);
  });

  it("marca a sessão como iniciada quando o motor avisa", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "oi", agora);

    orquestrador.registrarDoMotor("t1", { tipo: "sessao_iniciada" });

    expect(orquestrador.sessaoIniciada).toBe(true);
  });

  it("ao cancelar, encerra o turno e os subagentes que ainda rodavam", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);
    orquestrador.registrarDoMotor("t1", { tipo: "subagente_iniciado", subagenteId: "a", descricao: "A", tarefa: "" });
    orquestrador.registrarDoMotor("t1", { tipo: "subagente_iniciado", subagenteId: "b", descricao: "B", tarefa: "" });
    orquestrador.registrarDoMotor("t1", {
      tipo: "subagente_concluido",
      subagenteId: "a",
      situacao: "concluido",
      resumo: "feito",
      tokens: 100,
      duracaoMs: 2000,
    });

    const evento = orquestrador.cancelarTurno("t1", agora);

    const turno = orquestrador.paraDados().turnos[0];
    expect(evento).toEqual({ tipo: "turno_cancelado", turnoId: "t1" });
    expect(turno?.situacao).toBe("cancelado");
    expect(turno?.subagentes.map((subagente) => subagente.situacao)).toEqual(["concluido", "cancelado"]);
    expect(orquestrador.situacao).toBe("ocioso");
  });

  it("não aceita eventos de um turno que já terminou", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);
    orquestrador.falharTurno("t1", "sem cota", agora);

    const erro = capturarErro(() => orquestrador.registrarDoMotor("t1", { tipo: "texto_do_orquestrador", texto: "x" }));

    expect(erro.motivo).toBe("sem_turno_em_andamento");
  });

  it("alterar a configuração vale para o próximo turno e mantém o que não mudou", () => {
    const orquestrador = novoOrquestrador();

    orquestrador.alterarConfiguracao({ quantidadeDeSubagentes: { modo: "fixa", limite: 2 } });
    const evento = orquestrador.iniciarTurno("t1", "analise", agora);

    expect(evento).toMatchObject({
      configuracao: {
        modeloDoOrquestrador: "opus",
        quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
      },
    });
  });

  it("interrompe o turno pendente ao reabrir o histórico", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);

    const reaberto = Orquestrador.reconstituir(orquestrador.paraDados());
    const evento = reaberto.interromperTurnoEmAndamento(agora);

    expect(evento).toEqual({ tipo: "turno_interrompido", turnoId: "t1" });
    expect(reaberto.situacao).toBe("ocioso");
    expect(reaberto.interromperTurnoEmAndamento(agora)).toBeNull();
  });
});
