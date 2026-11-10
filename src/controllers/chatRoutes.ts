import { Response, Router } from "express";
import { z } from "zod";

import { TAMANHO_MAXIMO_DA_PERGUNTA } from "../chat/ConversaDoChat";
import { ErroDoChat, MotivoDoErroDoChat } from "../chat/ErroDoChat";
import { EventoDoChatRegistrado, PublicadorDoChat, SinalDoChat } from "../chat/EventoDoChat";
import { ORIGENS_DA_PERGUNTA } from "../chat/OrigemDaPergunta";
import { ID_DO_CHAT, ServicoDeChat } from "../chat/ServicoDeChat";
import { ArmazemDeAnexosEmArquivo, ehNomeDeAnexoValido } from "../infraestrutura/arquivos/ArmazemDeAnexosEmArquivo";
import { MAXIMO_DE_IMAGENS_POR_MENSAGEM, TAMANHO_MAXIMO_DA_IMAGEM, TIPOS_DE_IMAGEM } from "../orquestracao/Anexo";
import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import { ESFORCOS_DE_RACIOCINIO } from "../orquestracao/EsforcoDeRaciocinio";
import { MODELOS_CLAUDE } from "../orquestracao/ModeloClaude";
import { criarRota, responderErroGenerico } from "./respostasHttp";

export interface AssinanteDoChat {
  aoEvento: (evento: EventoDoChatRegistrado) => void;
  aoSinal: (sinal: SinalDoChat) => void;
}

/** Distribui os eventos (e os trechos passageiros) do chat para as telas conectadas. */
export class CanalDoChat implements PublicadorDoChat {
  private readonly assinantes = new Set<AssinanteDoChat>();

  /** Devolve a função que cancela a assinatura. */
  assinar(assinante: AssinanteDoChat): () => void {
    this.assinantes.add(assinante);
    return () => {
      this.assinantes.delete(assinante);
    };
  }

  publicar(evento: EventoDoChatRegistrado): void {
    this.entregar((assinante) => assinante.aoEvento(evento));
  }

  sinalizar(sinal: SinalDoChat): void {
    this.entregar((assinante) => assinante.aoSinal(sinal));
  }

  private entregar(entrega: (assinante: AssinanteDoChat) => void): void {
    for (const assinante of this.assinantes) {
      try {
        entrega(assinante);
      } catch (erro) {
        // Uma conexão com problema não pode impedir as outras de receberem.
        console.warn("[sse] Falha ao entregar evento do chat:", erro);
      }
    }
  }
}

interface Dependencias {
  servico: ServicoDeChat;
  canal: CanalDoChat;
  anexos: ArmazemDeAnexosEmArquivo;
}

const esquemaDaPergunta = z.object({
  texto: z
    .string({ error: "Escreva uma mensagem." })
    .trim()
    .max(TAMANHO_MAXIMO_DA_PERGUNTA, {
      error: `A mensagem deve ter até ${TAMANHO_MAXIMO_DA_PERGUNTA} caracteres.`,
    })
    .default(""),
  imagens: z
    .array(
      z.object({
        nome: z.string().max(200),
        tipoDeMidia: z.enum(TIPOS_DE_IMAGEM, { error: "Só dá para anexar imagens PNG, JPEG, GIF ou WebP." }),
        // Base64 ocupa 4/3 do tamanho original.
        base64: z.string().max(Math.ceil((TAMANHO_MAXIMO_DA_IMAGEM * 4) / 3) + 16, {
          error: `Cada imagem pode ter até ${TAMANHO_MAXIMO_DA_IMAGEM / 1024 / 1024} MB.`,
        }),
      }),
    )
    .max(MAXIMO_DE_IMAGENS_POR_MENSAGEM, { error: `Anexe até ${MAXIMO_DE_IMAGENS_POR_MENSAGEM} imagens por mensagem.` })
    .default([]),
  /** Só nas perguntas que não foram digitadas: "escuta" vem do modo invisível. */
  origem: z.enum(ORIGENS_DA_PERGUNTA, { error: "Origem da mensagem inválida." }).optional(),
});

const esquemaDasPreferencias = z.object({
  modelo: z.enum(MODELOS_CLAUDE, { error: "Modelo inválido." }).optional(),
  esforco: z.enum(ESFORCOS_DE_RACIOCINIO, { error: "Esforço inválido." }).optional(),
  permitirArtefatosOnline: z
    .boolean({ error: 'A opção "Publicar artefatos no claude.ai" deve ser verdadeira ou falsa.' })
    .optional(),
});

const MENSAGEM_DA_AUTORIZACAO_INVALIDA = "A autorização deve ser verdadeira ou falsa.";

const esquemaDaAutorizacao = z.object(
  { autorizado: z.boolean({ error: MENSAGEM_DA_AUTORIZACAO_INVALIDA }) },
  { error: MENSAGEM_DA_AUTORIZACAO_INVALIDA },
);

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErroDoChat, number>> = {
  dados_invalidos: 400,
  em_andamento: 409,
  sem_resposta_em_andamento: 409,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDoChat) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ErroDeOrquestracao && erro.motivo === "dados_invalidos") {
    resposta.status(400).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado no chat:");
}

const rota = criarRota<Record<string, string>>(responderErro);

export function criarChatRoutes({ servico, canal, anexos }: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/chat",
    rota((_requisicao, resposta) => {
      resposta.json(servico.estado());
    }),
  );

  rotas.post(
    "/chat/mensagens",
    rota(async (requisicao, resposta) => {
      const { texto, imagens, origem } = esquemaDaPergunta.parse(requisicao.body ?? {});
      if (texto === "" && imagens.length === 0) {
        throw new ErroDoChat("dados_invalidos", "Escreva uma mensagem ou anexe uma imagem.");
      }
      const { mensagemId } = await servico.perguntar({
        texto,
        imagens: imagens.map((imagem) => ({
          nome: imagem.nome,
          tipoDeMidia: imagem.tipoDeMidia,
          conteudo: Buffer.from(imagem.base64, "base64"),
        })),
        ...(origem === undefined ? {} : { origem }),
      });
      resposta.status(202).json({ mensagemId });
    }),
  );

  rotas.patch(
    "/chat/preferencias",
    rota(async (requisicao, resposta) => {
      const { modelo, esforco, permitirArtefatosOnline } = esquemaDasPreferencias.parse(requisicao.body ?? {});
      const preferencias = await servico.alterarPreferencias({
        ...(modelo === undefined ? {} : { modelo }),
        ...(esforco === undefined ? {} : { esforco }),
        ...(permitirArtefatosOnline === undefined ? {} : { permitirArtefatosOnline }),
      });
      resposta.json(preferencias);
    }),
  );

  /**
   * Autorização única para o chat editar arquivos e rodar comandos; vale até
   * o próximo /clear. Pode chegar durante uma resposta: vale na próxima pergunta.
   */
  rotas.patch(
    "/chat/autorizacao",
    rota(async (requisicao, resposta) => {
      const { autorizado } = esquemaDaAutorizacao.parse(requisicao.body ?? {});
      resposta.json(await servico.alterarAutorizacao(autorizado));
    }),
  );

  rotas.post(
    "/chat/cancelar",
    rota(async (_requisicao, resposta) => {
      await servico.cancelar();
      resposta.status(202).json({ cancelando: true });
    }),
  );

  /** Conversa nova ("/clear"): arquiva o histórico; a próxima pergunta abre outra sessão. */
  rotas.post(
    "/chat/limpar",
    rota(async (_requisicao, resposta) => {
      resposta.json(await servico.limpar());
    }),
  );

  /** A imagem anexada a uma pergunta, para as miniaturas do chat. */
  rotas.get(
    "/chat/anexos/:arquivo",
    rota<{ arquivo: string }>((requisicao, resposta) => {
      const { arquivo } = requisicao.params;
      // Só nomes gerados por nós: nada de "..\" escapando da pasta de anexos.
      if (!ehNomeDeAnexoValido(arquivo)) {
        resposta.status(404).json({ erro: "Anexo não encontrado." });
        return;
      }
      resposta.sendFile(anexos.caminhoDe(ID_DO_CHAT, arquivo), { maxAge: "1d" }, (erro) => {
        if (erro !== undefined && !resposta.headersSent) {
          resposta.status(404).json({ erro: "Anexo não encontrado." });
        }
      });
    }),
  );

  /**
   * Eventos ao vivo (Server-Sent Events). Ao conectar, reenvia o histórico da
   * conversa atual a partir de `Last-Event-ID` ou de `?desde=`; sem nenhum dos
   * dois, envia tudo. Trechos e atividades vão como eventos nomeados e sem
   * id: não entram na sequência nem no Last-Event-ID da reconexão.
   */
  rotas.get(
    "/chat/eventos",
    rota((requisicao, resposta) => {
      const informado = Number(requisicao.get("Last-Event-ID") ?? requisicao.query.desde ?? 0);
      let ultimaSequencia = Number.isInteger(informado) && informado > 0 ? informado : 0;

      resposta.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      resposta.write("retry: 3000\n\n");

      const enviar = (evento: EventoDoChatRegistrado): void => {
        if (evento.sequencia <= ultimaSequencia) {
          return;
        }
        ultimaSequencia = evento.sequencia;
        resposta.write(`id: ${evento.sequencia}\ndata: ${JSON.stringify(evento)}\n\n`);
      };

      // Leitura do histórico e assinatura acontecem no mesmo tick: nenhum
      // evento novo consegue cair entre as duas.
      for (const evento of servico.eventosDepoisDe(ultimaSequencia)) {
        enviar(evento);
      }
      const cancelarAssinatura = canal.assinar({
        aoEvento: enviar,
        aoSinal: (sinal) => {
          const { tipo, ...dados } = sinal;
          resposta.write(`event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`);
        },
      });

      // Comentário periódico: mantém a conexão viva através de proxies e antivírus.
      const batimento = setInterval(() => resposta.write(": ping\n\n"), 25_000);
      requisicao.on("close", () => {
        clearInterval(batimento);
        cancelarAssinatura();
      });
    }),
  );

  return rotas;
}
