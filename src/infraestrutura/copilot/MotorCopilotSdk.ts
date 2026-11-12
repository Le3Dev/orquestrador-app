import { mkdir, readFile, realpath } from "node:fs/promises";

import { EsforcoDeRaciocinio } from "../../orquestracao/EsforcoDeRaciocinio";
import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { ModeloClaude } from "../../orquestracao/ModeloClaude";
import { ABORTO_POR_SILENCIO, MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { AdaptadorDeEventosDoCopilot, falhaDoCopilot } from "./AdaptadorDeEventosDoCopilot";
import type {
  AnexoDaMensagemCopilot,
  ConfiguracaoDaSessaoCopilot,
  FachadaCopilotSdk,
  ModeloDoCopilot,
  SessaoDoCopilot,
} from "./FachadaCopilotSdk";
import { decidirPermissaoDoCopilot, ferramentasDoCopilotParaONivel } from "./PoliticaDePermissoesDoCopilot";

/**
 * Motor mínimo sobre o GitHub Copilot SDK: valida o desenho da porta
 * `MotorDeAgentes` com um motor de sessão viva (ADR-43). Ainda sem subagentes,
 * sem o plano com marcador e sem as instruções completas do Orquestrador —
 * isso é das Fases 1 e 2 — e sem ligação à tela nem ao `root.ts`.
 */

export const MOTIVO_DO_SILENCIO = "Encerrado pela autorrecuperação: sem notícias do GitHub Copilot.";

/** Intervalo mínimo entre dois avisos de `aoReceberLinha` (o mesmo do motor do Claude Code). */
const INTERVALO_DOS_AVISOS_DE_LINHA_MS = 1_000;

/** Quanto esperar o `session.idle` depois do `abort()` antes de derrubar o runtime à força. */
export const ESPERA_DO_ABORT_MS = 10_000;

/**
 * TABELA PROVISÓRIA: o domínio ainda guarda apelidos do Claude (`ModeloClaude`)
 * e o Copilot publica ids próprios (`claude-sonnet-5.5`). Na Fase 1 o modelo
 * vira um id validado pelo catálogo do motor (`listModels`) e esta tabela some.
 * `fable` não existe no Copilot: cai no Opus.
 */
export const MODELOS_PROVISORIOS_DO_COPILOT: Readonly<Record<ModeloClaude, string>> = {
  fable: "claude-opus-5.5",
  opus: "claude-opus-5.5",
  sonnet: "claude-sonnet-5.5",
  haiku: "claude-haiku-5.5",
};

/** Os níveis de esforço do Copilot, do mais leve ao mais profundo. */
const ORDEM_DOS_ESFORCOS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

const ESFORCO_DO_DOMINIO_NO_COPILOT: Readonly<Record<Exclude<EsforcoDeRaciocinio, "padrao">, string>> = {
  baixo: "low",
  medio: "medium",
  alto: "high",
  extra_alto: "xhigh",
  maximo: "max",
  // O workflow dinâmico do `ultracode` é do Claude Code: no Copilot vale só o extra alto.
  ultracode: "xhigh",
};

/**
 * O esforço do domínio no do Copilot. `padrao` não envia nada (vale o do
 * modelo). Se o modelo não aceita o nível pedido, roda o mais alto que ele
 * aceita abaixo dele (e, sem nenhum abaixo, o mais baixo que aceita); se o
 * modelo não tem esforço configurável (`suportados` vazio), nada vai — enviar
 * um esforço a esses modelos é erro. `suportados` nulo = catálogo desconhecido:
 * manda o nível como está.
 */
export function esforcoDoCopilot(esforco: EsforcoDeRaciocinio, suportados: readonly string[] | null): string | undefined {
  if (esforco === "padrao") {
    return undefined;
  }
  const pedido = ESFORCO_DO_DOMINIO_NO_COPILOT[esforco];
  if (suportados === null || suportados.includes(pedido)) {
    return pedido;
  }
  const posicao = ORDEM_DOS_ESFORCOS.indexOf(pedido as (typeof ORDEM_DOS_ESFORCOS)[number]);
  const aceitos = ORDEM_DOS_ESFORCOS.filter((nivel) => nivel !== "none" && suportados.includes(nivel));
  const abaixo = aceitos.filter((nivel) => ORDEM_DOS_ESFORCOS.indexOf(nivel) <= posicao);
  return abaixo[abaixo.length - 1] ?? aceitos[0];
}

/** O que o motor usa da fachada (um recorte, para os testes trocarem por uma falsa). */
export type FachadaDoMotorCopilot = Pick<
  FachadaCopilotSdk,
  "criarSessao" | "retomarSessao" | "sessaoViva" | "esquecerSessao" | "derrubar" | "listarModelos"
>;

export interface OpcoesDoMotorCopilot {
  /** Usa sempre este modelo (id do Copilot), sem passar pela tabela provisória. */
  modeloFixo?: string;
  esperaDoAbortMs?: number;
}

/** Cria a pasta (o runtime só libera pastas que existem) e devolve o caminho real: o do nome curto 8.3 do Windows nunca casa com o que o runtime compara. */
async function pastaReal(pasta: string, criar: boolean): Promise<string> {
  if (criar) {
    await mkdir(pasta, { recursive: true });
  }
  try {
    return await realpath(pasta);
  } catch {
    return pasta;
  }
}

/** Chama `aviso` na primeira vez e depois no máximo uma vez a cada `intervaloMs`. */
function limitarAvisos(aviso: () => void, intervaloMs: number): () => void {
  let ultimo: number | null = null;
  return () => {
    const agora = Date.now();
    if (ultimo !== null && agora - ultimo < intervaloMs) {
      return;
    }
    ultimo = agora;
    aviso();
  };
}

function instrucoesDoTurno(pedido: PedidoDeTurno, pastaDeArtefatos: string): string {
  const partes = [
    "Responda sempre em português do Brasil.",
    `Se precisar entregar um arquivo ao usuário (relatório, página), grave-o na pasta de artefatos: ${pastaDeArtefatos}`,
    pedido.modo === "planejamento"
      ? "Este turno é de PLANEJAMENTO: só investigue e proponha um plano; não altere nada além da pasta de artefatos."
      : "",
    pedido.instrucoes?.texto ?? "",
  ];
  return partes.filter((parte) => parte !== "").join("\n\n");
}

async function anexosDoPedido(pedido: PedidoDeTurno): Promise<AnexoDaMensagemCopilot[]> {
  return Promise.all(
    pedido.anexos.map(async (anexo): Promise<AnexoDaMensagemCopilot> =>
      anexo.categoria === "imagem"
        ? {
            tipo: "imagem",
            base64: (await readFile(anexo.caminho)).toString("base64"),
            tipoDeMidia: anexo.tipoDeMidia,
            nome: anexo.nome,
          }
        : { tipo: "arquivo", caminho: anexo.caminhoDoTexto ?? anexo.caminho, nome: anexo.nome },
    ),
  );
}

/**
 * `MotorDeAgentes` sobre o Copilot SDK: uma sessão do runtime por sessão do
 * app (o `sessaoId` do app é o `sessionId` do SDK).
 *
 * - 1º turno (`sessaoIniciada` falso): cria a sessão. Nos seguintes, usa a
 *   sessão que já está viva no runtime ou, se o runtime foi reiniciado (ou o
 *   app), a retoma do disco com a configuração COMPLETA — o SDK não guarda as
 *   ferramentas, as pastas nem o handler de permissão.
 * - Mudou o modelo, o esforço, as ferramentas, as pastas ou as instruções
 *   entre turnos? A sessão viva é solta e retomada de novo: só a retomada FRIA
 *   aplica a configuração nova (a "morna", com a sessão já viva, mantém a lista
 *   de ferramentas da anterior). A política de permissão, não: troca na hora.
 * - Cancelar é `session.abort()`; se o runtime não responder em
 *   `esperaDoAbortMs`, a fachada derruba a árvore de processos à força.
 */
export class MotorCopilotSdk implements MotorDeAgentes {
  /** A configuração com que cada sessão viva foi aberta, para saber quando precisa ser retomada. */
  private readonly assinaturas = new Map<string, string>();

  constructor(
    private readonly fachada: FachadaDoMotorCopilot,
    private readonly opcoes: OpcoesDoMotorCopilot = {},
  ) {}

  async executarTurno(
    pedido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
    aoReceberLinha?: () => void,
  ): Promise<ResultadoDoTurno> {
    if (sinal.aborted) {
      return sinal.reason === ABORTO_POR_SILENCIO
        ? { sucesso: false, causa: "silencio", motivo: MOTIVO_DO_SILENCIO, uso: null }
        : { sucesso: false, motivo: "O turno foi cancelado antes de começar.", uso: null };
    }
    const inicio = Date.now();
    const adaptador = new AdaptadorDeEventosDoCopilot();
    let sessao: SessaoDoCopilot | null = null;
    let cancelarEscuta: () => void = () => undefined;
    let relogioDoAbort: NodeJS.Timeout | null = null;
    let terminou: () => void = () => undefined;
    const fim = new Promise<void>((resolver) => {
      terminou = resolver;
    });

    const aoAbortar = (): void => {
      void sessao?.abortar().catch(() => undefined);
      relogioDoAbort = setTimeout(() => {
        // O runtime não respondeu ao abort(): derruba a árvore e libera o turno.
        void this.fachada.derrubar().finally(() => {
          this.assinaturas.delete(pedido.sessaoId);
          terminou();
        });
      }, this.opcoes.esperaDoAbortMs ?? ESPERA_DO_ABORT_MS);
    };

    try {
      const preparado = await this.prepararSessao(pedido, aoObservar);
      sessao = preparado.sessao;
      const avisar = aoReceberLinha === undefined ? undefined : limitarAvisos(aoReceberLinha, INTERVALO_DOS_AVISOS_DE_LINHA_MS);
      cancelarEscuta = sessao.aoEvento((evento) => {
        // Qualquer evento do runtime é sinal de vida, mesmo os que não viram evento do domínio.
        avisar?.();
        for (const traduzido of adaptador.traduzir(evento)) {
          aoObservar(traduzido);
        }
        if (adaptador.terminou) {
          terminou();
        }
      });
      sinal.addEventListener("abort", aoAbortar, { once: true });
      if (sinal.aborted) {
        aoAbortar();
      }
      await sessao.enviar(pedido.texto, preparado.anexos);
      // O abort pode ter chegado enquanto o runtime ainda admitia o pedido: um segundo abort não faz mal.
      if (sinal.aborted) {
        await sessao.abortar().catch(() => undefined);
      }
      await fim;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      if (sinal.aborted && sinal.reason === ABORTO_POR_SILENCIO) {
        return { sucesso: false, causa: "silencio", motivo: MOTIVO_DO_SILENCIO, uso: adaptador.uso };
      }
      return falhaDoCopilot({ errorType: "query", message: mensagem }, adaptador.uso);
    } finally {
      cancelarEscuta();
      sinal.removeEventListener("abort", aoAbortar);
      if (relogioDoAbort !== null) {
        clearTimeout(relogioDoAbort);
      }
    }

    // A autorrecuperação derrubou o turno: o que o modelo disse por último não importa.
    if (sinal.aborted && sinal.reason === ABORTO_POR_SILENCIO) {
      return { sucesso: false, causa: "silencio", motivo: MOTIVO_DO_SILENCIO, uso: adaptador.uso };
    }
    const resultado: ResultadoDoTurno = adaptador.resultado ?? {
      sucesso: false,
      motivo: "O runtime do GitHub Copilot encerrou sem concluir o turno.",
      uso: adaptador.uso,
    };
    // Vale o tempo de relógio, do envio ao fim — o dos eventos não conta a subida da sessão.
    const duracaoMs = Date.now() - inicio;
    return resultado.sucesso
      ? { ...resultado, uso: { ...resultado.uso, duracaoMs } }
      : { ...resultado, uso: resultado.uso === null ? null : { ...resultado.uso, duracaoMs } };
  }

  private async prepararSessao(
    pedido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
  ): Promise<{ sessao: SessaoDoCopilot; anexos: AnexoDaMensagemCopilot[] }> {
    const configuracao = await this.configuracaoDoTurno(pedido);
    const assinatura = JSON.stringify({ ...configuracao, decisor: undefined });
    const anexos = await anexosDoPedido(pedido);
    const id = pedido.sessaoId;

    let sessao: SessaoDoCopilot | null = null;
    const viva = pedido.sessaoIniciada ? this.fachada.sessaoViva(id) : null;
    if (viva !== null) {
      if (this.assinaturas.get(id) === assinatura) {
        viva.trocarDecisor(configuracao.decisor);
        sessao = viva;
      } else {
        // Só a retomada fria aplica as ferramentas, as pastas e as instruções novas.
        await viva.desconectar().catch(() => undefined);
        this.fachada.esquecerSessao(id);
      }
    }
    if (sessao === null) {
      sessao = pedido.sessaoIniciada
        ? await this.fachada.retomarSessao(id, configuracao)
        : await this.fachada.criarSessao(id, configuracao);
      this.assinaturas.set(id, assinatura);
    }
    aoObservar({ tipo: "sessao_iniciada" });
    return { sessao, anexos };
  }

  private async configuracaoDoTurno(pedido: PedidoDeTurno): Promise<ConfiguracaoDaSessaoCopilot> {
    const pastaDeArtefatos = await pastaReal(pedido.pastaDeArtefatos, true);
    const pastaDeTrabalho = await pastaReal(pedido.pastaDeTrabalho.caminho, false);
    const pastaDosAnexos = pedido.pastaDosAnexos === null ? null : await pastaReal(pedido.pastaDosAnexos, false);
    const { configuracao, modo } = pedido;
    const modelo = this.opcoes.modeloFixo ?? MODELOS_PROVISORIOS_DO_COPILOT[configuracao.modeloDoOrquestrador];
    const contexto = {
      nivel: configuracao.nivelDePermissao,
      modo,
      pastaDeTrabalho,
      pastaDeArtefatos,
      pastasSoDeLeitura: pastaDosAnexos === null ? [] : [pastaDosAnexos],
      permiteCommitEPush: configuracao.permiteCommitEPush(modo),
    };
    return {
      modelo,
      esforco: esforcoDoCopilot(configuracao.esforcoDoOrquestrador, await this.esforcosDoModelo(modelo)),
      pastaDeTrabalho,
      pastasAdicionais: [pastaDeArtefatos, ...(pastaDosAnexos === null ? [] : [pastaDosAnexos])],
      instrucoes: instrucoesDoTurno(pedido, pastaDeArtefatos),
      ferramentasLiberadas: ferramentasDoCopilotParaONivel(contexto.nivel, modo),
      decisor: (pedidoDePermissao) => decidirPermissaoDoCopilot(contexto, pedidoDePermissao),
    };
  }

  /** Os esforços que o modelo aceita, segundo o catálogo; nulo se o catálogo não responder. */
  private async esforcosDoModelo(modelo: string): Promise<readonly string[] | null> {
    try {
      const catalogo: readonly ModeloDoCopilot[] = await this.fachada.listarModelos();
      return catalogo.find((item) => item.id === modelo)?.esforcos ?? null;
    } catch {
      return null;
    }
  }

  /** Solta a sessão do runtime (quando a conversa é limpa ou o Orquestrador removido). */
  async encerrarSessao(sessaoId: string): Promise<void> {
    const viva = this.fachada.sessaoViva(sessaoId);
    this.assinaturas.delete(sessaoId);
    this.fachada.esquecerSessao(sessaoId);
    await viva?.desconectar().catch(() => undefined);
  }
}
