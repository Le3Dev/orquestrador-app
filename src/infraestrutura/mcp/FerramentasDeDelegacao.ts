import { randomUUID } from "node:crypto";

import { z } from "zod";

import { EventoDoMotor, SituacaoFinalDoSubagente } from "../../orquestracao/EventoDeOrquestracao";
import { FERRAMENTA_DE_DELEGACAO, NOME_DO_SUBAGENTE } from "../../orquestracao/InstrucoesDoOrquestrador";
import { LIMITE_DE_SUBAGENTES } from "../../orquestracao/QuantidadeDeSubagentes";
import { DadosDoSubagentePronto } from "../../orquestracao/SubagentesProntos";
import { RegistroDeTurnosDoApp, TurnoEmAndamento } from "../motores/RegistroDeTurnosDoApp";
import { ExecutorDeSubtarefa, ResultadoDaSubtarefa, SubtarefaPedida } from "../motores/SubtarefaDoApp";
import { FerramentaMcp, GrupoDeFerramentasMcp, ResultadoDaFerramenta } from "./GrupoDeFerramentasMcp";

/** O nome do grupo em `registrarGrupoDeFerramentas` e em `registrarTurno({ ferramentas: { delegar_subtarefas } })`. */
export const NOME_DO_GRUPO_DE_DELEGACAO = FERRAMENTA_DE_DELEGACAO;

const TAMANHO_DO_RESUMO = 300;

const ENTRADA = {
  subtarefas: z
    .array(
      z.object({
        descricao: z.string().trim().min(1).max(200).describe("Título curto da subtarefa: aparece na tela do usuário."),
        prompt: z
          .string()
          .trim()
          .min(1)
          .max(50_000)
          .describe(
            "Instruções completas e autocontidas para o subagente: objetivo, arquivos e pastas (caminhos absolutos), o que pode ou não alterar e o formato da resposta esperada.",
          ),
        subagente: z
          .string()
          .trim()
          .max(60)
          .optional()
          .describe(`Nome de um subagente pronto; sem ele, a subtarefa vai para o "${NOME_DO_SUBAGENTE}".`),
      }),
    )
    .min(1)
    .max(LIMITE_DE_SUBAGENTES)
    .describe("As subtarefas independentes desta leva: todas rodam em paralelo."),
};

const SaidaDaEntrada = z.object(ENTRADA);

export interface DependenciasDaDelegacao {
  turnos: RegistroDeTurnosDoApp;
  executor: ExecutorDeSubtarefa;
  gerarId?: () => string;
  agora?: () => number;
}

function resumir(relatorio: string): string {
  const limpo = relatorio.replace(/\s+/g, " ").trim();
  return limpo.length <= TAMANHO_DO_RESUMO ? limpo : `${limpo.slice(0, TAMANHO_DO_RESUMO - 1)}…`;
}

function erro(mensagem: string): ResultadoDaFerramenta {
  return { erro: true, conteudo: [{ tipo: "texto", texto: mensagem }] };
}

const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoFinalDoSubagente, string>> = {
  concluido: "concluída",
  falhou: "falhou",
  cancelado: "cancelada",
};

/**
 * A ferramenta `delegar_subtarefas`: dá subagentes em paralelo a quem não os
 * tem — o Orquestrador no Codex ou no Copilot, e o no Claude Code quando os
 * subagentes são de outro motor (ver `precisaDeDelegacaoPeloApp`).
 *
 * Cada subtarefa roda no motor dos subagentes do pedido (`ExecutorDeSubtarefa`),
 * na mesma pasta de trabalho e com as mesmas permissões do turno, todas ao mesmo
 * tempo; o retorno é o relatório final de cada uma. A tela recebe pelo
 * `aoObservar` do turno os mesmos eventos de subagente que o Claude Code gera
 * (início, progresso, texto, fim e relatório), então os bixinhos aparecem sem
 * mudança na tela. Cancelar o turno cancela as subtarefas.
 *
 * Limite: no máximo `quantidadeDeSubagentes.limite` subtarefas em andamento por
 * turno (o teto vale também entre chamadas). A quantidade "fixa" é só uma
 * orientação ao Orquestrador, como no Claude Code.
 */
export function criarGrupoDeFerramentasDeDelegacao(dependencias: DependenciasDaDelegacao): GrupoDeFerramentasMcp {
  const gerarId = dependencias.gerarId ?? randomUUID;
  const agora = dependencias.agora ?? Date.now;
  const emAndamento = new WeakMap<TurnoEmAndamento, number>();

  async function executarUma(
    turno: TurnoEmAndamento,
    subtarefa: SubtarefaPedida,
    especialidade: DadosDoSubagentePronto | null,
    sinal: AbortSignal,
  ): Promise<ResultadoDaSubtarefa> {
    const subagenteId = gerarId();
    const emitir = (evento: EventoDoMotor): void => {
      try {
        turno.aoObservar(evento);
      } catch (falha) {
        console.error("[delegacao] Falha ao publicar o evento do subagente:", falha);
      }
    };
    const inicio = agora();
    turno.subagentesLancados += 1;
    emitir({
      tipo: "subagente_iniciado",
      subagenteId,
      descricao: subtarefa.descricao,
      tarefa: subtarefa.prompt,
      papel: subtarefa.subagente ?? NOME_DO_SUBAGENTE,
    });

    let resultado: ResultadoDaSubtarefa;
    try {
      resultado = await dependencias.executor.executarSubtarefa({
        pedido: turno.pedido,
        subtarefa,
        especialidade,
        subagenteId,
        aoProgredir: emitir,
        sinal,
      });
    } catch (falha) {
      console.error("[delegacao] O executor de subtarefas falhou:", falha);
      resultado = {
        situacao: sinal.aborted ? "cancelado" : "falhou",
        relatorio: `Falha inesperada ao executar a subtarefa: ${falha instanceof Error ? falha.message : String(falha)}`,
        tokensDeEntrada: 0,
        tokensDeSaida: 0,
        duracaoMs: agora() - inicio,
      };
    }

    turno.tokensDeEntradaDosSubagentes += resultado.tokensDeEntrada;
    turno.tokensDeSaidaDosSubagentes += resultado.tokensDeSaida;
    emitir({
      tipo: "subagente_concluido",
      subagenteId,
      situacao: resultado.situacao,
      resumo: resumir(resultado.relatorio),
      tokens: resultado.tokensDeEntrada + resultado.tokensDeSaida,
      duracaoMs: resultado.duracaoMs,
    });
    if (resultado.relatorio.trim() !== "") {
      emitir({ tipo: "resultado_do_subagente", subagenteId, resultado: resultado.relatorio });
    }
    return resultado;
  }

  const ferramenta: FerramentaMcp = {
    nome: FERRAMENTA_DE_DELEGACAO,
    descricao:
      "Delega subtarefas a subagentes que rodam em paralelo e devolve o relatório final de cada uma. " +
      "Chame UMA vez por leva, com todas as subtarefas independentes de uma só vez; espere o retorno antes de responder ao usuário. " +
      "Cada subtarefa deve ser autocontida (o subagente não vê esta conversa) e nunca dois subagentes devem alterar o mesmo arquivo.",
    entrada: ENTRADA,
    async executar(argumentos, contexto): Promise<ResultadoDaFerramenta> {
      const turno = dependencias.turnos.obter(contexto.orquestradorId);
      if (turno === undefined) {
        return erro("Não há um pedido em andamento para este orquestrador: não é possível delegar agora.");
      }
      const lidos = SaidaDaEntrada.safeParse(argumentos);
      if (!lidos.success) {
        return erro(`Entrada inválida: ${lidos.error.issues[0]?.message ?? "confira os campos"}.`);
      }
      const limite = turno.pedido.configuracao.quantidadeDeSubagentes.limite;
      const jaRodando = emAndamento.get(turno) ?? 0;
      if (jaRodando + lidos.data.subtarefas.length > limite) {
        return erro(
          `O limite deste pedido é de ${limite} subagente${limite === 1 ? "" : "s"} ao mesmo tempo` +
            `${jaRodando > 0 ? ` (já há ${jaRodando} em andamento)` : ""}: você pediu ${lidos.data.subtarefas.length}. ` +
            "Junte subtarefas ou delegue em levas.",
        );
      }

      const prontos = turno.pedido.subagentesProntos;
      const subtarefas: Array<{ subtarefa: SubtarefaPedida; especialidade: DadosDoSubagentePronto | null }> = [];
      for (const item of lidos.data.subtarefas) {
        const nome = item.subagente === undefined || item.subagente === "" || item.subagente === NOME_DO_SUBAGENTE ? null : item.subagente;
        const especialidade = nome === null ? null : (prontos.find((pronto) => pronto.nome === nome) ?? null);
        if (nome !== null && especialidade === null) {
          const validos = [NOME_DO_SUBAGENTE, ...prontos.map((pronto) => pronto.nome)].join(", ");
          return erro(`O subagente "${nome}" não existe. Use um destes: ${validos}.`);
        }
        subtarefas.push({ subtarefa: { descricao: item.descricao, prompt: item.prompt, subagente: nome }, especialidade });
      }

      // O cancelamento do turno (ou da chamada) cancela todas as subtarefas.
      const sinal = AbortSignal.any([contexto.sinal, turno.sinal]);
      emAndamento.set(turno, jaRodando + subtarefas.length);
      let resultados: ResultadoDaSubtarefa[];
      try {
        resultados = await Promise.all(subtarefas.map((item) => executarUma(turno, item.subtarefa, item.especialidade, sinal)));
      } finally {
        emAndamento.set(turno, Math.max(0, (emAndamento.get(turno) ?? 0) - subtarefas.length));
      }

      const linhas = [`Resultado das ${resultados.length} subtarefa${resultados.length === 1 ? "" : "s"} (na ordem do pedido):`];
      resultados.forEach((resultado, indice) => {
        const pedida = subtarefas[indice]?.subtarefa;
        linhas.push(
          "",
          `### ${indice + 1}. ${pedida?.descricao ?? "subtarefa"} — ${ROTULO_DA_SITUACAO[resultado.situacao]}`,
          resultado.relatorio.trim() === "" ? "(sem relatório)" : resultado.relatorio.trim(),
        );
      });
      return {
        conteudo: [{ tipo: "texto", texto: linhas.join("\n") }],
        ...(resultados.every((resultado) => resultado.situacao !== "concluido") ? { erro: true } : {}),
      };
    },
  };
  return { ferramentas: [ferramenta] };
}
