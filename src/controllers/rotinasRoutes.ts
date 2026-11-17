import { Response, Router } from "express";
import { z } from "zod";

import { DadosDaEtapa, MENSAGEM_DE_ETAPA_INVALIDA } from "../rotinas/EtapaDaRotina";
import { ErroDeRotina, MotivoDoErroDeRotina } from "../rotinas/ErroDeRotina";
import { EventoDeRotina, PublicadorDeRotinas } from "../rotinas/EventoDeRotina";
import { DadosDaExecucao, TAMANHO_MAXIMO_DO_MOTIVO } from "../rotinas/ExecucaoDaRotina";
import { DadosDoGatilho, MENSAGEM_DE_GATILHO_INVALIDO } from "../rotinas/Gatilho";
import {
  AO_PERDER,
  DadosDaRotina,
  MENSAGEM_DE_AO_PERDER_INVALIDO,
  MENSAGEM_DE_ETAPAS_INVALIDAS,
  MENSAGEM_DE_NOME_INVALIDO,
  Rotina,
} from "../rotinas/Rotina";
import { ServicoDeRotinas } from "../rotinas/ServicoDeRotinas";
import { criarRota, responderErroGenerico } from "./respostasHttp";

/**
 * O que a tela recebe de cada Rotina (a lista, o detalhe e as respostas de
 * criar e alterar): os dados dela e a execução que roda ou espera aprovação.
 * Os eventos `rotina_*` do SSE trazem só os dados da Rotina.
 */
export interface ResumoDaRotina extends DadosDaRotina {
  /** A execução em andamento ou aguardando aprovação; `null` se não há. */
  execucaoAtiva: DadosDaExecucao | null;
}

/** Distribui os eventos das Rotinas para as telas conectadas. Só ao vivo: não guarda histórico. */
export class CanalDasRotinas implements PublicadorDeRotinas {
  private readonly assinantes = new Set<(evento: EventoDeRotina) => void>();

  /** Devolve a função que cancela a assinatura. */
  assinar(aoEvento: (evento: EventoDeRotina) => void): () => void {
    this.assinantes.add(aoEvento);
    return () => {
      this.assinantes.delete(aoEvento);
    };
  }

  publicar(evento: EventoDeRotina): void {
    for (const aoEvento of this.assinantes) {
      try {
        aoEvento(evento);
      } catch (erro) {
        // Uma conexão com problema não pode impedir as outras de receberem.
        console.warn("[sse] Falha ao entregar evento de rotina:", erro);
      }
    }
  }
}

interface Dependencias {
  servico: ServicoDeRotinas;
  canal: CanalDasRotinas;
}

/**
 * Aqui só se confere a forma do corpo; as regras (horas, intervalo, limites de
 * texto, número de etapas) são do domínio, que devolve a mensagem certa.
 */
function objeto<T>(mensagem: string): z.ZodType<T> {
  return z.custom<T>((valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor), {
    error: mensagem,
  });
}

const MENSAGEM_DE_ROTINA_SEM_DADOS = "Envie os dados da rotina.";

const campos = {
  nome: z.string({ error: MENSAGEM_DE_NOME_INVALIDO }),
  gatilho: objeto<DadosDoGatilho>(MENSAGEM_DE_GATILHO_INVALIDO),
  etapas: z.array(objeto<DadosDaEtapa>(MENSAGEM_DE_ETAPA_INVALIDA), { error: MENSAGEM_DE_ETAPAS_INVALIDAS }),
  aoPerder: z.enum(AO_PERDER, { error: MENSAGEM_DE_AO_PERDER_INVALIDO }),
  ativa: z.boolean({ error: "Informe se a rotina está ativa (verdadeiro ou falso)." }),
};

const esquemaDaNovaRotina = z.object(
  {
    nome: campos.nome,
    gatilho: campos.gatilho,
    etapas: campos.etapas,
    aoPerder: campos.aoPerder.optional(),
    ativa: campos.ativa.optional(),
  },
  { error: MENSAGEM_DE_ROTINA_SEM_DADOS },
);

const esquemaDasAlteracoes = z.object(
  {
    nome: campos.nome.optional(),
    gatilho: campos.gatilho.optional(),
    etapas: campos.etapas.optional(),
    aoPerder: campos.aoPerder.optional(),
    ativa: campos.ativa.optional(),
  },
  { error: MENSAGEM_DE_ROTINA_SEM_DADOS },
);

const esquemaDaRecusa = z.object(
  {
    motivo: z
      .string({ error: "O motivo da recusa deve ser um texto." })
      .max(TAMANHO_MAXIMO_DO_MOTIVO, `O motivo da recusa pode ter até ${TAMANHO_MAXIMO_DO_MOTIVO} caracteres.`)
      .optional(),
  },
  { error: "Envie os dados da recusa." },
);

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErroDeRotina, number>> = {
  dados_invalidos: 400,
  nao_encontrado: 404,
  conflito: 409,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeRotina) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado nas rotinas:");
}

const rota = criarRota(responderErro);

/** `event:` nomeado e `data:` JSON com o resto do evento, sem id: os eventos das rotinas não têm histórico. */
function formatarEvento(evento: EventoDeRotina): string {
  const { tipo, ...dados } = evento;
  return `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
}

/**
 * Rotinas: fluxos agendados de pedidos a Orquestradores, aprovações e
 * esperas, e as execuções delas. Montadas em `/api`.
 */
export function criarRotinasRoutes({ servico, canal }: Dependencias): Router {
  const rotas = Router();

  function resumir(rotina: Rotina): ResumoDaRotina {
    return { ...rotina.paraDados(), execucaoAtiva: servico.execucaoAtivaDaRotina(rotina.id)?.paraDados() ?? null };
  }

  rotas.get(
    "/rotinas",
    rota((_requisicao, resposta) => {
      resposta.json(servico.listar().map(resumir));
    }),
  );

  rotas.post(
    "/rotinas",
    rota(async (requisicao, resposta) => {
      const pedido = esquemaDaNovaRotina.parse(requisicao.body ?? {});
      const rotina = await servico.criar(pedido);
      resposta.status(201).json(resumir(rotina));
    }),
  );

  /**
   * Eventos ao vivo (Server-Sent Events), sem histórico: ao (re)conectar, a
   * tela recarrega a lista. Registrada antes de `/rotinas/:id`.
   */
  rotas.get(
    "/rotinas/eventos",
    rota((requisicao, resposta) => {
      resposta.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      resposta.write("retry: 3000\n\n");

      const cancelarAssinatura = canal.assinar((evento) => {
        resposta.write(formatarEvento(evento));
      });

      // Comentário periódico: mantém a conexão viva através de proxies e antivírus.
      const batimento = setInterval(() => resposta.write(": ping\n\n"), 25_000);
      requisicao.on("close", () => {
        clearInterval(batimento);
        cancelarAssinatura();
      });
    }),
  );

  rotas.get(
    "/rotinas/:id",
    rota((requisicao, resposta) => {
      resposta.json(resumir(servico.buscar(requisicao.params.id)));
    }),
  );

  /** Só o que vier no corpo muda. `ativa` liga e desliga a rotina. */
  rotas.patch(
    "/rotinas/:id",
    rota(async (requisicao, resposta) => {
      const alteracoes = esquemaDasAlteracoes.parse(requisicao.body ?? {});
      const rotina = await servico.alterar(requisicao.params.id, alteracoes);
      resposta.json(resumir(rotina));
    }),
  );

  /** Remove a rotina e as execuções dela; as que estão em curso são canceladas. */
  rotas.delete(
    "/rotinas/:id",
    rota(async (requisicao, resposta) => {
      await servico.remover(requisicao.params.id);
      resposta.status(204).end();
    }),
  );

  /** Começa uma execução agora e responde `202` sem esperar o fim: o andamento vem pelos eventos. */
  rotas.post(
    "/rotinas/:id/executar",
    rota(async (requisicao, resposta) => {
      const execucao = await servico.executarAgora(requisicao.params.id);
      resposta.status(202).json(execucao.paraDados());
    }),
  );

  /** Da mais recente para a mais antiga (as últimas 50). */
  rotas.get(
    "/rotinas/:id/execucoes",
    rota((requisicao, resposta) => {
      resposta.json(servico.listarExecucoes(requisicao.params.id).map((execucao) => execucao.paraDados()));
    }),
  );

  rotas.post(
    "/rotinas/execucoes/:execucaoId/aprovar",
    rota<{ execucaoId: string }>(async (requisicao, resposta) => {
      const execucao = await servico.aprovar(requisicao.params.execucaoId);
      resposta.json(execucao.paraDados());
    }),
  );

  rotas.post(
    "/rotinas/execucoes/:execucaoId/recusar",
    rota<{ execucaoId: string }>(async (requisicao, resposta) => {
      const { motivo } = esquemaDaRecusa.parse(requisicao.body ?? {});
      const execucao = await servico.recusar(requisicao.params.execucaoId, motivo);
      resposta.json(execucao.paraDados());
    }),
  );

  rotas.post(
    "/rotinas/execucoes/:execucaoId/cancelar",
    rota<{ execucaoId: string }>(async (requisicao, resposta) => {
      const execucao = await servico.cancelar(requisicao.params.execucaoId);
      resposta.json(execucao.paraDados());
    }),
  );

  return rotas;
}
