import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DadosDoUso } from "../../orquestracao/UsoDeTokens";
import { descreverFalha, SINAIS_DE_LIMITE_DE_USO } from "./AdaptadorDeEventosDoClaudeCode";
import { ambienteSemSessaoPai, linhaDeEntrada, VARIAVEL_DE_ESFORCO } from "./ArgumentosDoClaudeCode";
import { FachadaClaudeCodeCli, SaidaDoClaudeCode } from "./FachadaClaudeCodeCli";
import { ehObjeto, numero, objeto, type Objeto, texto } from "./MedicaoDasTranscricoes";

/** Motivo de uma chamada curta cancelada (pelo cliente ou pelo desligamento). */
export const MOTIVO_DO_CANCELAMENTO = "Cancelada.";

/** O que muda de um uso da chamada curta para outro (melhoria de prompt, escuta…). */
export interface ConfiguracaoDaChamadaCurta {
  /** Apelido do modelo (ex.: "haiku"), resolvido pelo próprio Claude Code. */
  modelo: string;
  /** Dono dos processos no registro de processos (não é um Orquestrador). */
  dono: string;
  /** Pasta onde cada chamada cria (e apaga) a sua pasta temporária. */
  pastaBase: string;
  /** Textos das mensagens de falha, na linguagem de quem usa a chamada. */
  mensagens: {
    /** O que o Claude Code deveria devolver, ex.: "o pedido melhorado". */
    resultadoEsperado: string;
    /** O que o Claude Code deveria fazer, ex.: "melhorar o pedido". */
    tarefa: string;
  };
}

/** Uma chamada: a mensagem (pelo stdin) e a instrução fixa (prompt de sistema). */
export interface PedidoDaChamadaCurta {
  texto: string;
  instrucoes: string;
}

export type ResultadoDaChamadaCurta =
  | { sucesso: true; texto: string; uso: DadosDoUso }
  /** `motivo` já vem pronto para o usuário ler. */
  | { sucesso: false; motivo: string };

/**
 * Linha de comando do `claude -p` de uma chamada curta.
 *
 * Chamada curta e barata: esforço baixo, `--tools ""` (nenhuma ferramenta),
 * nenhum servidor MCP (`--strict-mcp-config` sem `--mcp-config`), sem skills e
 * sem gravar a sessão em disco. A instrução substitui o prompt de sistema
 * padrão do Claude Code (`--system-prompt-file`), que descreveria um agente
 * com ferramentas. A mensagem vai pelo stdin em `stream-json`, como nos
 * turnos: nenhum texto livre passa por argumento. A saída `stream-json` (com
 * `--verbose`) traz o `result` com o consumo.
 */
export function montarArgumentosDaChamadaCurta(modelo: string, arquivoDeInstrucoes: string): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    modelo,
    "--effort",
    "low",
    "--system-prompt-file",
    arquivoDeInstrucoes,
    "--tools",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
  ];
}

/**
 * Ambiente do processo: sem as variáveis de uma sessão pai do Claude Code e
 * sem `CLAUDE_CODE_EFFORT_LEVEL`, que venceria o `--effort low`.
 *
 * Sem nenhum CLAUDE.md nem memória automática
 * (https://code.claude.com/docs/en/env-vars): as regras pessoais do usuário
 * (pilha, banco, política de git) viravam requisitos inventados na resposta,
 * e custavam uns 2 mil tokens a mais por chamada. As configurações do usuário
 * continuam valendo (proxy, URL da API, login).
 */
export function montarAmbienteDaChamadaCurta(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const ambiente = ambienteSemSessaoPai(base);
  delete ambiente[VARIAVEL_DE_ESFORCO];
  ambiente.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  ambiente.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  return ambiente;
}

/**
 * Consumo do `result`: a soma do `modelUsage` (todos os modelos que a chamada
 * usou) ou, sem ele, o `usage` do modelo principal. Sem `--resume`, os dois
 * valem só para esta chamada.
 */
export function usoDoResultado(resultado: Objeto): DadosDoUso {
  const porModelo = Object.values(objeto(resultado, "modelUsage")).filter(ehObjeto);
  if (porModelo.length > 0) {
    return porModelo.reduce<DadosDoUso>(
      (soma, uso) => ({
        entrada: soma.entrada + numero(uso, "inputTokens"),
        criacaoDeCache: soma.criacaoDeCache + numero(uso, "cacheCreationInputTokens"),
        leituraDeCache: soma.leituraDeCache + numero(uso, "cacheReadInputTokens"),
        saida: soma.saida + numero(uso, "outputTokens"),
      }),
      { entrada: 0, criacaoDeCache: 0, leituraDeCache: 0, saida: 0 },
    );
  }
  const uso = objeto(resultado, "usage");
  return {
    entrada: numero(uso, "input_tokens"),
    criacaoDeCache: numero(uso, "cache_creation_input_tokens"),
    leituraDeCache: numero(uso, "cache_read_input_tokens"),
    saida: numero(uso, "output_tokens"),
  };
}

function inteiros(uso: DadosDoUso): DadosDoUso {
  return {
    entrada: Math.round(uso.entrada),
    criacaoDeCache: Math.round(uso.criacaoDeCache),
    leituraDeCache: Math.round(uso.leituraDeCache),
    saida: Math.round(uso.saida),
  };
}

/**
 * Núcleo das chamadas curtas ao Claude Code: um processo `claude -p` por
 * chamada, com o login da assinatura do usuário, sem ferramentas. A pasta de
 * trabalho é uma pasta temporária própria (fora de qualquer projeto, para não
 * carregar o CLAUDE.md de um projeto), que guarda também o arquivo da
 * instrução e é apagada ao final. O processo entra no registro de processos
 * como os turnos. Com o sinal abortado, encerra a chamada e resolve sem
 * sucesso (nunca rejeita).
 */
export class ChamadaCurtaDoClaudeCode {
  constructor(
    private readonly fachada: FachadaClaudeCodeCli,
    private readonly configuracao: ConfiguracaoDaChamadaCurta,
    private readonly ambienteBase: NodeJS.ProcessEnv = process.env,
  ) {}

  async executar(pedido: PedidoDaChamadaCurta, sinal: AbortSignal): Promise<ResultadoDaChamadaCurta> {
    if (sinal.aborted) {
      return { sucesso: false, motivo: MOTIVO_DO_CANCELAMENTO };
    }
    const { modelo, dono, pastaBase } = this.configuracao;
    const id = randomUUID();
    const pasta = path.join(pastaBase, id);
    const arquivoDeInstrucoes = path.join(pasta, "instrucoes.txt");

    try {
      await mkdir(pasta, { recursive: true });
      await writeFile(arquivoDeInstrucoes, pedido.instrucoes, "utf8");

      // Num objeto: o callback preenche, e o TypeScript não estreita para `null`.
      const recebido: { resultado: Objeto | null } = { resultado: null };
      const saida = await this.fachada.executar(
        {
          argumentos: montarArgumentosDaChamadaCurta(modelo, arquivoDeInstrucoes),
          pasta,
          ambiente: montarAmbienteDaChamadaCurta(this.ambienteBase),
          entrada: linhaDeEntrada(pedido.texto, []),
          dono: { orquestradorId: dono, sessaoId: id },
        },
        (mensagem) => {
          if (ehObjeto(mensagem) && texto(mensagem, "type") === "result") {
            recebido.resultado = mensagem;
          }
        },
        sinal,
      );

      if (sinal.aborted) {
        return { sucesso: false, motivo: MOTIVO_DO_CANCELAMENTO };
      }
      const final = recebido.resultado;
      if (final === null) {
        return { sucesso: false, motivo: this.descreverSaidaSemResultado(saida) };
      }
      const resposta = texto(final, "result");
      if (texto(final, "subtype") !== "success" || final["is_error"] === true) {
        return { sucesso: false, motivo: this.motivoDaFalha(final, resposta) };
      }
      return { sucesso: true, texto: resposta, uso: inteiros(usoDoResultado(final)) };
    } catch (erro) {
      if (sinal.aborted) {
        return { sucesso: false, motivo: MOTIVO_DO_CANCELAMENTO };
      }
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      return { sucesso: false, motivo: `Não foi possível consultar o Claude Code: ${detalhe}` };
    } finally {
      await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private descreverSaidaSemResultado(saida: SaidaDoClaudeCode): string {
    const { resultadoEsperado } = this.configuracao.mensagens;
    const detalhe = saida.erroPadrao.slice(0, 600);
    const codigo = saida.codigoDeSaida === null ? "" : ` (código ${saida.codigoDeSaida})`;
    return detalhe === ""
      ? `O Claude Code encerrou sem devolver ${resultadoEsperado}${codigo}.`
      : `O Claude Code encerrou sem devolver ${resultadoEsperado}${codigo}: ${detalhe}`;
  }

  private motivoDaFalha(resultado: Objeto, resposta: string): string {
    if (SINAIS_DE_LIMITE_DE_USO.test(resposta)) {
      return `Limite de uso da assinatura do Claude atingido; tente de novo quando a cota renovar (${resposta.trim()}).`;
    }
    return `O Claude Code não conseguiu ${this.configuracao.mensagens.tarefa}: ${descreverFalha(resultado, resposta)}`;
  }
}
