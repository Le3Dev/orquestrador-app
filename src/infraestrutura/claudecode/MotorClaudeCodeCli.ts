import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { instrucoesDoOrquestrador, mensagemParaOOrquestrador } from "../../orquestracao/InstrucoesDoOrquestrador";
import { MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { AdaptadorDeEventosDoClaudeCode } from "./AdaptadorDeEventosDoClaudeCode";
import {
  configuracoesDaSessao,
  definicaoDosAgentes,
  linhaDeEntrada,
  montarAmbiente,
  montarArgumentos,
} from "./ArgumentosDoClaudeCode";
import { FachadaClaudeCodeCli, SaidaDoClaudeCode } from "./FachadaClaudeCodeCli";

/**
 * Cria a pasta de artefatos (vai em `--add-dir`, precisa existir antes de o
 * processo iniciar) e devolve o caminho real dela. O Claude Code compara as
 * regras de permissão com o caminho real do arquivo: uma pasta com nome curto
 * do Windows (`C:\Users\LEANDR~1.CAN\…`) geraria uma regra que nunca casa, e a
 * gravação do artefato seria negada.
 */
export async function prepararPastaDeArtefatos(pasta: string): Promise<string> {
  await mkdir(pasta, { recursive: true });
  return realpath(pasta);
}

function descreverSaidaSemResultado(saida: SaidaDoClaudeCode): string {
  const detalhe = saida.erroPadrao.slice(0, 600);
  const codigo = saida.codigoDeSaida === null ? "" : ` (código ${saida.codigoDeSaida})`;
  return detalhe === ""
    ? `O Claude Code encerrou sem devolver resposta${codigo}.`
    : `O Claude Code encerrou sem devolver resposta${codigo}: ${detalhe}`;
}

/**
 * `MotorDeAgentes` sobre o Claude Code em modo headless: um processo
 * `claude -p` por turno, com o login da assinatura do usuário.
 *
 * Cada turno grava as instruções e a definição dos Subagentes em uma pasta
 * temporária própria, apagada ao final — dois Orquestradores rodando ao mesmo
 * tempo nunca compartilham arquivos. A pasta de artefatos do Orquestrador, ao
 * contrário, é permanente: o motor só a cria, se faltar.
 */
export class MotorClaudeCodeCli implements MotorDeAgentes {
  constructor(private readonly fachada: FachadaClaudeCodeCli) {}

  async executarTurno(
    pedidoRecebido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
  ): Promise<ResultadoDoTurno> {
    const pastaTemporaria = path.join(tmpdir(), "orquestrador-agentes", randomUUID());
    const arquivos = {
      agentes: path.join(pastaTemporaria, "agentes.json"),
      instrucoes: path.join(pastaTemporaria, "instrucoes.txt"),
      configuracoes: path.join(pastaTemporaria, "configuracoes.json"),
    };

    try {
      await mkdir(pastaTemporaria, { recursive: true });
      const pedido = { ...pedidoRecebido, pastaDeArtefatos: await prepararPastaDeArtefatos(pedidoRecebido.pastaDeArtefatos) };
      await writeFile(arquivos.agentes, JSON.stringify(definicaoDosAgentes(pedido)), "utf8");
      await writeFile(arquivos.instrucoes, instrucoesDoOrquestrador(pedido.pastaDeTrabalho), "utf8");
      const configuracoes = configuracoesDaSessao(pedido);
      if (configuracoes !== null) {
        await writeFile(arquivos.configuracoes, JSON.stringify(configuracoes), "utf8");
      }

      const imagens = await Promise.all(
        pedido.imagens.map(async (imagem) => ({
          tipoDeMidia: imagem.tipoDeMidia,
          base64: (await readFile(imagem.caminho)).toString("base64"),
        })),
      );
      const texto = mensagemParaOOrquestrador(
        pedido.texto,
        pedido.configuracao,
        pedido.imagens.map((imagem) => imagem.caminho),
        pedido.modo,
        pedido.pastaDeArtefatos,
      );

      const adaptador = new AdaptadorDeEventosDoClaudeCode();
      const inicio = Date.now();
      const saida = await this.fachada.executar(
        {
          argumentos: montarArgumentos(pedido, arquivos),
          pasta: pedido.pastaDeTrabalho.caminho,
          ambiente: montarAmbiente(process.env, pedido),
          entrada: linhaDeEntrada(texto, imagens),
          dono: { orquestradorId: pedido.orquestradorId, sessaoId: pedido.sessaoId },
        },
        (mensagem) => {
          for (const evento of adaptador.traduzir(mensagem)) {
            aoObservar(evento);
          }
        },
        sinal,
      );

      const resultado = adaptador.resultado;
      if (resultado === null) {
        return { sucesso: false, motivo: descreverSaidaSemResultado(saida), uso: null };
      }
      // O `duration_ms` do Claude Code não conta a espera por Subagentes em
      // segundo plano; o tempo que interessa é o de relógio, do início ao fim.
      return resultado.uso === null
        ? resultado
        : { ...resultado, uso: { ...resultado.uso, duracaoMs: Date.now() - inicio } };
    } finally {
      await rm(pastaTemporaria, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
