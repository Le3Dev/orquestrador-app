import { Request, Response, Router } from "express";
import { z, ZodError } from "zod";

import { ArmazemDeAnexosEmArquivo, ehNomeDeAnexoValido } from "../infraestrutura/arquivos/ArmazemDeAnexosEmArquivo";
import { ExploradorDePastas } from "../infraestrutura/arquivos/ExploradorDePastas";
import { CanalDeEventos } from "../infraestrutura/sse/CanalDeEventos";
import { MAXIMO_DE_IMAGENS_POR_MENSAGEM, TAMANHO_MAXIMO_DA_IMAGEM, TIPOS_DE_IMAGEM } from "../orquestracao/Anexo";
import { ErroDeOrquestracao, MotivoDoErro } from "../orquestracao/ErroDeOrquestracao";
import { ESFORCOS_DE_RACIOCINIO } from "../orquestracao/EsforcoDeRaciocinio";
import { EventoRegistrado } from "../orquestracao/EventoDeOrquestracao";
import { MODELOS_CLAUDE } from "../orquestracao/ModeloClaude";
import { MODOS_DO_TURNO } from "../orquestracao/ModoDoTurno";
import { NIVEIS_DE_PERMISSAO } from "../orquestracao/NivelDePermissao";
import {
  Orquestrador,
  TAMANHO_MAXIMO_DA_MENSAGEM,
  TAMANHO_MAXIMO_DO_NOME,
} from "../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../orquestracao/PastaDeTrabalho";
import { LIMITE_DE_SUBAGENTES } from "../orquestracao/QuantidadeDeSubagentes";
import { RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { ServicoDeOrquestracao } from "../orquestracao/ServicoDeOrquestracao";

interface Dependencias {
  servico: ServicoDeOrquestracao;
  repositorio: RepositorioDeOrquestradores;
  canal: CanalDeEventos;
  explorador: ExploradorDePastas;
  anexos: ArmazemDeAnexosEmArquivo;
  pastaRaiz: string;
}

const esquemaDaConfiguracao = z.object({
  modeloDoOrquestrador: z.enum(MODELOS_CLAUDE, { error: "Modelo do orquestrador inválido." }),
  modeloDosSubagentes: z.enum(MODELOS_CLAUDE, { error: "Modelo dos subagentes inválido." }),
  quantidadeDeSubagentes: z.object({
    modo: z.enum(["fixa", "automatica"], { error: "Modo da quantidade inválido." }),
    limite: z
      .number({ error: "Informe a quantidade de subagentes." })
      .int({ error: "A quantidade de subagentes deve ser um número inteiro." })
      .min(1, { error: "Use pelo menos 1 subagente." })
      .max(LIMITE_DE_SUBAGENTES, { error: `Use no máximo ${LIMITE_DE_SUBAGENTES} subagentes.` }),
  }),
  nivelDePermissao: z.enum(NIVEIS_DE_PERMISSAO, { error: "Nível de permissão inválido." }),
  // Opcional também na criação: ausente vale `false` (desligada).
  permitirCommitEPush: z
    .boolean({ error: 'A opção "Permitir commit e push" deve ser verdadeira ou falsa.' })
    .optional(),
  // Opcionais também na criação: ausentes valem "padrao".
  esforcoDoOrquestrador: z
    .enum(ESFORCOS_DE_RACIOCINIO, { error: "Esforço do orquestrador inválido." })
    .optional(),
  esforcoDosSubagentes: z
    .enum(ESFORCOS_DE_RACIOCINIO, { error: "Esforço dos subagentes inválido." })
    .optional(),
});

const esquemaDeCriacao = esquemaDaConfiguracao.extend({
  nome: z
    .string({ error: "Dê um nome ao orquestrador." })
    .trim()
    .min(1, { error: "Dê um nome ao orquestrador." })
    .max(TAMANHO_MAXIMO_DO_NOME, { error: `O nome deve ter até ${TAMANHO_MAXIMO_DO_NOME} caracteres.` }),
  pastaDeTrabalho: z.string({ error: "Escolha a pasta de trabalho." }).min(1, {
    error: "Escolha a pasta de trabalho.",
  }),
});

const esquemaDeMensagem = z.object({
  texto: z
    .string({ error: "Escreva uma mensagem." })
    .trim()
    .min(1, { error: "Escreva uma mensagem." })
    .max(TAMANHO_MAXIMO_DA_MENSAGEM, {
      error: `A mensagem deve ter até ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`,
    }),
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
  modo: z.enum(MODOS_DO_TURNO, { error: "Modo do pedido inválido." }).default("execucao"),
});

const esquemaDeAprovacaoDoPlano = z.object({
  observacoes: z
    .string({ error: "As observações devem ser um texto." })
    .trim()
    .max(TAMANHO_MAXIMO_DA_MENSAGEM, {
      error: `As observações devem ter até ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`,
    })
    .default(""),
});

const STATUS_POR_MOTIVO: Readonly<Record<MotivoDoErro, number>> = {
  dados_invalidos: 400,
  nao_encontrado: 404,
  turno_em_andamento: 409,
  sem_turno_em_andamento: 409,
  sem_plano_pendente: 409,
};

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeOrquestracao) {
    resposta.status(STATUS_POR_MOTIVO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ZodError) {
    resposta.status(400).json({ erro: erro.issues[0]?.message ?? "Dados inválidos." });
    return;
  }
  console.error("[http] Erro inesperado:", erro);
  const detalhe = erro instanceof Error ? erro.message : String(erro);
  resposta.status(500).json({ erro: `Erro inesperado no servidor: ${detalhe}` });
}

type Tratador<Parametros> = (requisicao: Request<Parametros>, resposta: Response) => Promise<void> | void;

/** Envolve cada rota num try/catch que devolve a mensagem de erro pronta para a tela. */
function rota<Parametros = { id: string }>(tratador: Tratador<Parametros>): Tratador<Parametros> {
  return async (requisicao, resposta) => {
    try {
      await tratador(requisicao, resposta);
    } catch (erro) {
      responderErro(resposta, erro);
    }
  };
}

/**
 * Traduz o domínio para o JSON da tela. A sessão do Claude Code (`sessaoId`)
 * não sai daqui: é detalhe do motor, não interessa a quem usa a tela.
 */
function apresentarResumo(orquestrador: Orquestrador) {
  const ultimo = orquestrador.ultimoTurno;
  return {
    id: orquestrador.id,
    nome: orquestrador.nome,
    pastaDeTrabalho: orquestrador.pastaDeTrabalho.caminho,
    nomeDaPasta: orquestrador.pastaDeTrabalho.nome,
    situacao: orquestrador.situacao,
    configuracao: orquestrador.configuracao.paraDados(),
    worktree: orquestrador.worktree,
    criadoEm: orquestrador.criadoEm.toISOString(),
    totalDeTurnos: orquestrador.totalDeTurnos,
    ultimoTurno:
      ultimo === null
        ? null
        : {
            texto: ultimo.texto.slice(0, 140),
            situacao: ultimo.situacao,
            iniciadoEm: ultimo.iniciadoEm.toISOString(),
          },
  };
}

function apresentarDetalhe(orquestrador: Orquestrador) {
  return { ...apresentarResumo(orquestrador), turnos: orquestrador.paraDados().turnos };
}

export function criarOrquestradoresRoutes({
  servico,
  repositorio,
  canal,
  explorador,
  anexos,
  pastaRaiz,
}: Dependencias): Router {
  const rotas = Router();

  rotas.get(
    "/pastas",
    rota(async (_requisicao, resposta) => {
      resposta.json({ raiz: pastaRaiz, pastas: await explorador.listarProjetos() });
    }),
  );

  rotas.get(
    "/orquestradores",
    rota((_requisicao, resposta) => {
      resposta.json(repositorio.listar().map(apresentarResumo));
    }),
  );

  rotas.post(
    "/orquestradores",
    rota(async (requisicao, resposta) => {
      const { nome, pastaDeTrabalho, ...configuracao } = esquemaDeCriacao.parse(requisicao.body);

      const pasta = PastaDeTrabalho.dentroDe(pastaRaiz, pastaDeTrabalho);
      if (!(await explorador.existe(pasta.caminho))) {
        throw new ErroDeOrquestracao("dados_invalidos", `A pasta "${pasta.caminho}" não existe.`);
      }

      const orquestrador = await servico.criarOrquestrador({ nome, pastaDeTrabalho: pasta, configuracao });
      resposta.status(201).json(apresentarDetalhe(orquestrador));
    }),
  );

  rotas.get(
    "/orquestradores/:id",
    rota((requisicao, resposta) => {
      const orquestrador = repositorio.buscarPorId(requisicao.params.id);
      if (orquestrador === null) {
        throw new ErroDeOrquestracao("nao_encontrado", "Orquestrador não encontrado.");
      }
      resposta.json(apresentarDetalhe(orquestrador));
    }),
  );

  rotas.patch(
    "/orquestradores/:id/configuracao",
    rota(async (requisicao, resposta) => {
      const alteracoes = esquemaDaConfiguracao.partial().parse(requisicao.body);
      const orquestrador = await servico.alterarConfiguracao(requisicao.params.id, alteracoes);
      resposta.json(apresentarResumo(orquestrador));
    }),
  );

  rotas.post(
    "/orquestradores/:id/mensagens",
    rota(async (requisicao, resposta) => {
      const { texto, imagens, modo } = esquemaDeMensagem.parse(requisicao.body);
      const { turnoId } = await servico.enviarMensagem(
        requisicao.params.id,
        texto,
        imagens.map((imagem) => ({
          nome: imagem.nome,
          tipoDeMidia: imagem.tipoDeMidia,
          conteudo: Buffer.from(imagem.base64, "base64"),
        })),
        modo,
      );
      resposta.status(202).json({ turnoId });
    }),
  );

  /** Aprova o Plano pendente e já inicia o turno que o executa. */
  rotas.post(
    "/orquestradores/:id/plano/aprovar",
    rota(async (requisicao, resposta) => {
      const { observacoes } = esquemaDeAprovacaoDoPlano.parse(requisicao.body ?? {});
      const { turnoId } = await servico.aprovarPlano(requisicao.params.id, observacoes);
      resposta.status(202).json({ turnoId });
    }),
  );

  rotas.post(
    "/orquestradores/:id/plano/descartar",
    rota(async (requisicao, resposta) => {
      await servico.descartarPlano(requisicao.params.id);
      resposta.status(204).end();
    }),
  );

  rotas.post(
    "/orquestradores/:id/cancelar",
    rota(async (requisicao, resposta) => {
      await servico.cancelar(requisicao.params.id);
      resposta.status(202).json({ cancelando: true });
    }),
  );

  rotas.delete(
    "/orquestradores/:id",
    rota(async (requisicao, resposta) => {
      await servico.remover(requisicao.params.id);
      resposta.status(204).end();
    }),
  );

  /** A imagem anexada a uma mensagem, para as miniaturas do terminal. */
  rotas.get(
    "/orquestradores/:id/anexos/:arquivo",
    rota<{ id: string; arquivo: string }>((requisicao, resposta) => {
      const { id, arquivo } = requisicao.params;
      // Só nomes gerados por nós: nada de "..\" escapando da pasta de anexos.
      if (repositorio.buscarPorId(id) === null || !ehNomeDeAnexoValido(arquivo)) {
        throw new ErroDeOrquestracao("nao_encontrado", "Anexo não encontrado.");
      }
      resposta.sendFile(anexos.caminhoDe(id, arquivo), { maxAge: "1d" }, (erro) => {
        if (erro !== undefined && !resposta.headersSent) {
          resposta.status(404).json({ erro: "Anexo não encontrado." });
        }
      });
    }),
  );

  /**
   * Eventos ao vivo (Server-Sent Events). Ao conectar, reenvia o histórico a
   * partir de `Last-Event-ID` — que o navegador manda sozinho ao reconectar —
   * ou de `?desde=`, usado quando a tela recria a conexão por conta própria
   * (depois de o servidor ter ficado fora). Sem nenhum dos dois, envia tudo: é
   * assim que a tela reconstrói uma conversa antiga.
   */
  rotas.get(
    "/orquestradores/:id/eventos",
    rota((requisicao, resposta) => {
      const id = requisicao.params.id;
      if (repositorio.buscarPorId(id) === null) {
        throw new ErroDeOrquestracao("nao_encontrado", "Orquestrador não encontrado.");
      }

      const informado = Number(requisicao.get("Last-Event-ID") ?? requisicao.query.desde ?? 0);
      let ultimaSequencia = Number.isInteger(informado) && informado > 0 ? informado : 0;

      resposta.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      resposta.write("retry: 3000\n\n");

      const enviar = (evento: EventoRegistrado): void => {
        if (evento.sequencia <= ultimaSequencia) {
          return;
        }
        ultimaSequencia = evento.sequencia;
        resposta.write(`id: ${evento.sequencia}\ndata: ${JSON.stringify(evento)}\n\n`);
      };

      // Leitura do histórico e assinatura acontecem no mesmo tick: nenhum
      // evento novo consegue cair entre as duas.
      for (const evento of repositorio.lerEventos(id, ultimaSequencia)) {
        enviar(evento);
      }
      // Sinais de vida vão como outro tipo de evento SSE e sem id: não entram
      // na sequência do histórico nem no Last-Event-ID da reconexão.
      const cancelarAssinatura = canal.assinar(id, {
        aoEvento: enviar,
        aoSinal: (sinal) => resposta.write(`event: sinal\ndata: ${JSON.stringify(sinal)}\n\n`),
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
