import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import {
  instrucoesDoOrquestrador,
  mensagemParaOOrquestrador,
  Plataforma,
} from "../../orquestracao/InstrucoesDoOrquestrador";
import { ABORTO_POR_SILENCIO, MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { AdaptadorDeEventosDoClaudeCode, falhaComCausa } from "./AdaptadorDeEventosDoClaudeCode";
import {
  configuracoesDaSessao,
  definicaoDosAgentes,
  linhaDeEntrada,
  montarAmbiente,
  montarArgumentos,
} from "./ArgumentosDoClaudeCode";
import { FachadaClaudeCodeCli, SaidaDoClaudeCode } from "./FachadaClaudeCodeCli";
import { SondaDeEndereco, sondarEnderecoLocal } from "./SondaDeEnderecoLocal";

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

/** Intervalo mínimo entre dois avisos de `aoReceberLinha`. */
export const INTERVALO_DOS_AVISOS_DE_LINHA_MS = 1_000;

export const MOTIVO_DO_SILENCIO = "Encerrado pela autorrecuperação: sem notícias do Claude.";

/** Chama `aviso` na primeira vez e depois no máximo uma vez a cada `intervaloMs`. */
export function limitarAvisos(aviso: () => void, intervaloMs: number, agora: () => number = Date.now): () => void {
  let ultimo: number | null = null;
  return () => {
    const instante = agora();
    if (ultimo !== null && instante - ultimo < intervaloMs) {
      return;
    }
    ultimo = instante;
    aviso();
  };
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
 *
 * A `plataforma` do computador decide a sintaxe dos comandos ensinados aos
 * agentes (regra dos servidores).
 */
export class MotorClaudeCodeCli implements MotorDeAgentes {
  constructor(
    private readonly fachada: FachadaClaudeCodeCli,
    private readonly sondar: SondaDeEndereco = sondarEnderecoLocal,
    private readonly plataforma: Plataforma = "unix",
  ) {}

  async executarTurno(
    pedidoRecebido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
    aoReceberLinha?: () => void,
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
      await writeFile(arquivos.agentes, JSON.stringify(definicaoDosAgentes(pedido, this.plataforma)), "utf8");
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
        pedido.instrucoes,
        pedido.revogarInstrucoesAnteriores,
        pedido.subagentesProntos,
        this.plataforma,
        pedido.itensLigados ?? [],
      );

      const adaptador = new AdaptadorDeEventosDoClaudeCode();
      // Endereços citados num comando ou na fala de um agente: só viram prévia
      // se responderem. O turno espera estas conferências (no máximo poucos
      // segundos) para o anúncio não chegar depois do fim do turno.
      // Um endereço citado de novo enquanto ainda é conferido não é sondado duas vezes.
      const conferencias: Promise<void>[] = [];
      const emConferencia = new Set<string>();
      const conferirCitados = (): void => {
        for (const url of adaptador.retirarCandidatos()) {
          if (emConferencia.has(url)) {
            continue;
          }
          emConferencia.add(url);
          conferencias.push(
            this.sondar(url)
              .then(
                (noAr) => {
                  if (noAr && !sinal.aborted) {
                    for (const evento of adaptador.confirmarEndereco(url)) {
                      aoObservar(evento);
                    }
                  }
                },
                () => undefined,
              )
              .finally(() => emConferencia.delete(url)),
          );
        }
      };
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
          conferirCitados();
        },
        sinal,
        aoReceberLinha === undefined ? undefined : limitarAvisos(aoReceberLinha, INTERVALO_DOS_AVISOS_DE_LINHA_MS),
      );
      await Promise.all(conferencias);

      const resultado = adaptador.resultado;
      // A autorrecuperação derrubou o processo: o que ele disse por último não importa.
      if (sinal.aborted && sinal.reason === ABORTO_POR_SILENCIO) {
        return { sucesso: false, causa: "silencio", motivo: MOTIVO_DO_SILENCIO, uso: resultado?.uso ?? null };
      }
      if (resultado === null) {
        return falhaComCausa(descreverSaidaSemResultado(saida), [saida.erroPadrao], adaptador.pistasDaFalha, null);
      }
      // O `result` não disse a causa: o stderr às vezes diz (um ECONNRESET, um 529).
      if (!resultado.sucesso && (resultado.causa ?? "outro") === "outro" && saida.erroPadrao !== "") {
        const pelaSaida = falhaComCausa(
          resultado.motivo,
          [resultado.motivo, saida.erroPadrao],
          adaptador.pistasDaFalha,
          resultado.uso,
        );
        if (pelaSaida.causa !== "outro") {
          return pelaSaida;
        }
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
