import express, { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";

import { DadosDoArtefato, FormatoDoArtefato } from "../artefatos/Artefato";
import { esquemaDoArquivoDoDesenho, MENSAGEM_DE_DESENHO_INVALIDO } from "../artefatos/DesenhoDoArtefato";
import {
  ErroDeArtefato,
  MENSAGEM_DE_TITULO_INVALIDO,
  MENSAGEM_DE_VERSAO_NAO_ENCONTRADA,
  MotivoDoErroDeArtefato,
} from "../artefatos/ErroDeArtefato";
import { EventoDeArtefato, PublicadorDeArtefatos } from "../artefatos/EventoDeArtefato";
import { TipoDaOrigem } from "../artefatos/OrigemDoArtefato";
import { ServicoDeArtefatos } from "../artefatos/ServicoDeArtefatos";
import { criarRota, responderErroGenerico } from "./respostasHttp";

export interface ResumoDaVersao {
  numero: number;
  /** ISO 8601 */
  criadaEm: string;
  /** Em bytes. */
  tamanho: number;
}

/** O que a tela recebe de cada Artefato (a lista, o detalhe e os eventos). */
export interface ResumoDoArtefato {
  id: string;
  titulo: string;
  formato: FormatoDoArtefato;
  origem: { tipo: TipoDaOrigem; id: string | null };
  arquivo: string;
  /** ISO 8601 */
  criadoEm: string;
  /** ISO 8601 */
  atualizadoEm: string;
  versaoAtual: number;
  versoes: ResumoDaVersao[];
}

export function resumirArtefato(dados: DadosDoArtefato): ResumoDoArtefato {
  return {
    id: dados.id,
    titulo: dados.titulo,
    formato: dados.formato,
    origem: { tipo: dados.origem.tipo, id: dados.origem.id },
    arquivo: dados.arquivo,
    criadoEm: dados.criadoEm,
    atualizadoEm: dados.atualizadoEm,
    versaoAtual: dados.versoes[dados.versoes.length - 1]?.numero ?? 0,
    versoes: dados.versoes.map(({ numero, criadaEm, tamanho }) => ({ numero, criadaEm, tamanho })),
  };
}

/** Distribui os eventos dos Artefatos para as telas conectadas. Só ao vivo: não guarda histórico. */
export class CanalDosArtefatos implements PublicadorDeArtefatos {
  private readonly assinantes = new Set<(evento: EventoDeArtefato) => void>();

  /** Devolve a função que cancela a assinatura. */
  assinar(aoEvento: (evento: EventoDeArtefato) => void): () => void {
    this.assinantes.add(aoEvento);
    return () => {
      this.assinantes.delete(aoEvento);
    };
  }

  publicar(evento: EventoDeArtefato): void {
    for (const aoEvento of this.assinantes) {
      try {
        aoEvento(evento);
      } catch (erro) {
        // Uma conexão com problema não pode impedir as outras de receberem.
        console.warn("[sse] Falha ao entregar evento de artefato:", erro);
      }
    }
  }
}

interface Dependencias {
  servico: ServicoDeArtefatos;
  canal: CanalDosArtefatos;
}

/**
 * O conteúdo de um artefato é HTML escrito por um agente: a tela o mostra num
 * iframe isolado, e o servidor ainda o entrega numa sandbox sem rede (só
 * scripts e estilos embutidos, imagens e fontes em data:/blob:).
 */
export const POLITICA_DE_SEGURANCA_DO_CONTEUDO =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

const TIPO_DO_CONTEUDO: Readonly<Record<FormatoDoArtefato, string>> = {
  html: "text/html; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
};

/** Número de versão na URL: inteiro positivo, sem sinal nem zeros à esquerda. */
const NUMERO_DE_VERSAO = /^[1-9]\d{0,8}$/;

const MENSAGEM_DE_NUMERO_DE_VERSAO_INVALIDO = "Número de versão inválido.";
const MENSAGEM_DE_DESENHO_GRANDE_DEMAIS = "O desenho passa de 1 MB.";

/** O corpo do PUT do desenho: bem abaixo dos 150 MB do leitor geral, que vale para as mensagens com anexos. */
export const LIMITE_DO_CORPO_DO_DESENHO = "1mb";
const CAMINHO_DO_DESENHO = /^\/api\/artefatos\/[^/]+\/versoes\/[^/]+\/desenho\/?$/i;

/**
 * Caminhos cujo corpo JSON a própria rota lê, com limite próprio: o leitor
 * geral do app (`montarAplicacao`) os pula. Se ele lesse antes, o da rota
 * não leria de novo e o limite não valeria.
 */
export function temCorpoComLimiteProprio(caminho: string): boolean {
  return CAMINHO_DO_DESENHO.test(caminho);
}

const leitorDoCorpoDoDesenho = express.json({ limit: LIMITE_DO_CORPO_DO_DESENHO });

/** Erro ao ler o corpo vira JSON: o tratador padrão do Express responderia em HTML, com a pilha. */
function lerCorpoDoDesenho(requisicao: Request, resposta: Response, proximo: NextFunction): void {
  leitorDoCorpoDoDesenho(requisicao, resposta, (erro?: unknown) => {
    if (erro === undefined || erro === null) {
      proximo();
      return;
    }
    if ((erro as { status?: unknown }).status === 413) {
      resposta.status(413).json({ erro: MENSAGEM_DE_DESENHO_GRANDE_DEMAIS });
      return;
    }
    resposta.status(400).json({ erro: MENSAGEM_DE_DESENHO_INVALIDO });
  });
}

/** Aqui só se confere o formato do corpo; o tamanho do título é regra do próprio Artefato. */
const esquemaDoTitulo = z.object(
  { titulo: z.string({ error: MENSAGEM_DE_TITULO_INVALIDO }) },
  { error: MENSAGEM_DE_TITULO_INVALIDO },
);

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErroDeArtefato, number>> = {
  dados_invalidos: 400,
  nao_encontrado: 404,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeArtefato) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado nos artefatos:");
}

const rota = criarRota(responderErro);

/** `event:` nomeado e `data:` JSON, sem id: os eventos dos artefatos não têm histórico. */
function formatarEvento(evento: EventoDeArtefato): string {
  const dados = evento.tipo === "artefato_removido" ? { id: evento.id } : { artefato: resumirArtefato(evento.artefato) };
  return `event: ${evento.tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
}

/**
 * Artefatos (páginas HTML e documentos Markdown) entregues pelos agentes.
 * Eles nascem pela pasta de entrada (o coletor), nunca por aqui.
 */
export function criarArtefatosRoutes({ servico, canal }: Dependencias): Router {
  const rotas = Router();

  /** O número da versão na URL (400 se não for número), depois de garantir que o artefato existe (404). */
  function numeroDaVersao(id: string, numero: string): number {
    servico.buscar(id);
    if (!NUMERO_DE_VERSAO.test(numero)) {
      throw new ErroDeArtefato("dados_invalidos", MENSAGEM_DE_NUMERO_DE_VERSAO_INVALIDO);
    }
    return Number(numero);
  }

  rotas.get(
    "/artefatos",
    rota((_requisicao, resposta) => {
      resposta.json(servico.listar().map((artefato) => resumirArtefato(artefato.paraDados())));
    }),
  );

  /**
   * Eventos ao vivo (Server-Sent Events), sem histórico: ao (re)conectar, a
   * tela recarrega a lista. Registrada antes de `/artefatos/:id`.
   */
  rotas.get(
    "/artefatos/eventos",
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
    "/artefatos/:id",
    rota((requisicao, resposta) => {
      resposta.json(resumirArtefato(servico.buscar(requisicao.params.id).paraDados()));
    }),
  );

  /** O conteúdo bruto de uma versão, para o iframe (HTML) ou o leitor de Markdown. */
  rotas.get(
    "/artefatos/:id/versoes/:numero",
    rota<{ id: string; numero: string }>(async (requisicao, resposta) => {
      const { id, numero } = requisicao.params;
      if (!NUMERO_DE_VERSAO.test(numero)) {
        // Garante que o artefato existe (404 do artefato antes do da versão).
        servico.buscar(id);
        throw new ErroDeArtefato("nao_encontrado", MENSAGEM_DE_VERSAO_NAO_ENCONTRADA);
      }
      const { formato, conteudo } = await servico.lerVersao(id, Number(numero));
      resposta.status(200).set({
        "Content-Type": TIPO_DO_CONTEUDO[formato],
        "Content-Security-Policy": POLITICA_DE_SEGURANCA_DO_CONTEUDO,
        "X-Content-Type-Options": "nosniff",
      });
      resposta.send(conteudo);
    }),
  );

  /** O desenho feito sobre uma versão; `{ tracos: [], largura: null }` quando ela não tem desenho. */
  rotas.get(
    "/artefatos/:id/versoes/:numero/desenho",
    rota<{ id: string; numero: string }>(async (requisicao, resposta) => {
      const { id, numero } = requisicao.params;
      const { tracos, largura } = await servico.lerDesenho(id, numeroDaVersao(id, numero));
      resposta.set("Cache-Control", "no-store").json({ tracos, largura });
    }),
  );

  /**
   * Troca o desenho inteiro da versão; `tracos: []` apaga. `largura` ausente
   * vale `null`. Corpo de até 1 MB.
   */
  rotas.put(
    "/artefatos/:id/versoes/:numero/desenho",
    lerCorpoDoDesenho,
    rota<{ id: string; numero: string }>(async (requisicao, resposta) => {
      const { id, numero } = requisicao.params;
      const numeroValido = numeroDaVersao(id, numero);
      const desenho = esquemaDoArquivoDoDesenho.parse(requisicao.body);
      await servico.salvarDesenho(id, numeroValido, desenho);
      resposta.status(204).end();
    }),
  );

  rotas.patch(
    "/artefatos/:id",
    rota(async (requisicao, resposta) => {
      const { titulo } = esquemaDoTitulo.parse(requisicao.body ?? {});
      const artefato = await servico.renomear(requisicao.params.id, titulo);
      resposta.json(resumirArtefato(artefato.paraDados()));
    }),
  );

  /** Apaga o artefato, todas as versões e o arquivo dele na pasta de entrada. */
  rotas.delete(
    "/artefatos/:id",
    rota(async (requisicao, resposta) => {
      await servico.remover(requisicao.params.id);
      resposta.status(204).end();
    }),
  );

  return rotas;
}
