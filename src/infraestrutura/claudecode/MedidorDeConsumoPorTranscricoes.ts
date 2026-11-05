import { ConsumoDoTurno } from "../../orquestracao/ConsumoDoTurno";
import type { MedidorDeConsumo, PeriodoDoTurno } from "../../orquestracao/MedidorDeConsumo";
import { UsoDeTokens } from "../../orquestracao/UsoDeTokens";
import type { DadosDoUso } from "../../orquestracao/UsoDeTokens";
import { janelaDoTurno, medirTranscricoes } from "./MedicaoDasTranscricoes";
import { lerTranscricoes, localizarTranscricoes, pastaDoClaude } from "./TranscricoesDoClaudeCode";

/** Os contadores das transcrições são inteiros; arredonda por segurança antes de virar objeto de valor. */
function paraUso(dados: DadosDoUso): UsoDeTokens {
  return UsoDeTokens.criar({
    entrada: Math.max(0, Math.round(dados.entrada)),
    criacaoDeCache: Math.max(0, Math.round(dados.criacaoDeCache)),
    leituraDeCache: Math.max(0, Math.round(dados.leituraDeCache)),
    saida: Math.max(0, Math.round(dados.saida)),
  });
}

/**
 * `MedidorDeConsumo` que lê as transcrições que o Claude Code grava em
 * `<pasta do Claude>/projects/<slug da pasta de trabalho>/<sessao>.jsonl`
 * (e as dos subagentes em `<sessao>/subagents/`).
 *
 * Com `--resume` a transcrição acumula a conversa toda, então só contam as
 * linhas com `timestamp` entre `inicio - 2 s` e `fim + 5 s` do turno,
 * deduplicadas por `message.id`; o mesmo recorte vale para os subagentes.
 */
export class MedidorDeConsumoPorTranscricoes implements MedidorDeConsumo {
  constructor(private readonly pastaDeConfiguracao: string = pastaDoClaude()) {}

  async medirTurno(periodo: PeriodoDoTurno): Promise<ConsumoDoTurno | null> {
    const arquivos = await localizarTranscricoes(periodo.pastaDeTrabalho, [periodo.sessaoId], this.pastaDeConfiguracao);
    if (!arquivos.some((arquivo) => arquivo.papel === "principal")) {
      return null;
    }
    const transcricoes = await lerTranscricoes(arquivos, janelaDoTurno(periodo.inicio, periodo.fim));
    const medicao = medirTranscricoes(transcricoes);
    if (medicao.mensagens === 0) {
      return null;
    }
    return ConsumoDoTurno.criar({
      principal: paraUso(medicao.principal),
      subagentes: paraUso(medicao.subagentes),
      subagentesMedidos: medicao.subagentesLancados,
      parcial: false,
      modeloDoPrincipal: medicao.modeloDoPrincipal,
    });
  }
}
