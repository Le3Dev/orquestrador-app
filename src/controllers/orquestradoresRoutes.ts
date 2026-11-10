import path from "node:path";

import { Response, Router } from "express";
import { z } from "zod";

import { ArmazemDeAnexosEmArquivo, ehNomeDeAnexoValido } from "../infraestrutura/arquivos/ArmazemDeAnexosEmArquivo";
import { ErroDeCaminho, ExploradorDePastas } from "../infraestrutura/arquivos/ExploradorDePastas";
import { CanalDeEventos } from "../infraestrutura/sse/CanalDeEventos";
import { MAXIMO_DE_ANEXOS_POR_MENSAGEM } from "../orquestracao/Anexo";
import { ConfiguracaoDoOrquestrador } from "../orquestracao/ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import {
  ESFORCOS_DE_RACIOCINIO,
  serveParaSubagentes,
  ULTRACODE_NOS_SUBAGENTES,
} from "../orquestracao/EsforcoDeRaciocinio";
import { EventoRegistrado } from "../orquestracao/EventoDeOrquestracao";
import {
  instrucoesDoOrquestrador,
  MAXIMO_DE_ITENS_LIGADOS,
  mensagemParaOOrquestrador,
  Plataforma,
  TAMANHO_MAXIMO_DO_CONTEUDO_LIGADO,
  TAMANHO_MAXIMO_DO_ENDERECO_LIGADO,
  TAMANHO_MAXIMO_DO_TITULO_LIGADO,
  TIPOS_DE_ITEM_LIGADO,
} from "../orquestracao/InstrucoesDoOrquestrador";
import {
  aplicarVariaveis,
  InstrucoesAplicadas,
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
} from "../orquestracao/InstrucoesPersonalizadas";
import { MODELOS_CLAUDE } from "../orquestracao/ModeloClaude";
import { MODOS_DO_TURNO } from "../orquestracao/ModoDoTurno";
import { NIVEIS_DE_PERMISSAO } from "../orquestracao/NivelDePermissao";
import {
  ErroDeFilaCheia,
  Orquestrador,
  TAMANHO_MAXIMO_DA_MENSAGEM,
  TAMANHO_MAXIMO_DO_NOME,
} from "../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../orquestracao/PastaDeTrabalho";
import { PREDEFINICOES } from "../orquestracao/PredefinicaoDeConfiguracao";
import { LIMITE_DE_SUBAGENTES } from "../orquestracao/QuantidadeDeSubagentes";
import { RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { RepositorioDePreferencias } from "../orquestracao/RepositorioDePreferencias";
import { EsforcoHerdadoDosPapeis, ServicoDeOrquestracao } from "../orquestracao/ServicoDeOrquestracao";
import { UsoDeTokens } from "../orquestracao/UsoDeTokens";
import { enviarAnexo, esquemaDoAnexoRecebido } from "./anexosHttp";
import { criarRota, responderErroGenerico, STATUS_DA_ORQUESTRACAO } from "./respostasHttp";

interface Dependencias {
  servico: ServicoDeOrquestracao;
  repositorio: RepositorioDeOrquestradores;
  canal: CanalDeEventos;
  explorador: ExploradorDePastas;
  anexos: ArmazemDeAnexosEmArquivo;
  preferencias: RepositorioDePreferencias;
  pastaRaiz: string;
  /** Plataforma do computador, para a prévia do prompt mostrar a regra dos servidores que vale nele. */
  plataforma?: Plataforma;
}

/**
 * Texto livre do usuário: aqui só se confere que é texto e o tamanho bruto
 * (folgado, para o espaço sobrando que a normalização tira). O limite de fato,
 * já normalizado, é conferido pelo domínio (`instrucoesValidas`).
 */
function esquemaDeInstrucoes(rotulo: string) {
  return z
    .string({ error: `${rotulo} devem ser um texto.` })
    .max(TAMANHO_MAXIMO_DAS_INSTRUCOES * 2, {
      error: `${rotulo} devem ter até ${TAMANHO_MAXIMO_DAS_INSTRUCOES} caracteres.`,
    });
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
  // Opcional também na criação: ausente vale `false` (desligada).
  permitirArtefatosOnline: z
    .boolean({ error: 'A opção "Publicar artefatos no claude.ai" deve ser verdadeira ou falsa.' })
    .optional(),
  // Opcionais também na criação: ausentes valem "padrao".
  esforcoDoOrquestrador: z
    .enum(ESFORCOS_DE_RACIOCINIO, { error: "Esforço do orquestrador inválido." })
    .optional(),
  // O `ultracode` vale só para o orquestrador (e o chat).
  esforcoDosSubagentes: z
    .enum(ESFORCOS_DE_RACIOCINIO, { error: "Esforço dos subagentes inválido." })
    .refine(serveParaSubagentes, { error: ULTRACODE_NOS_SUBAGENTES })
    .optional(),
  // Chaves desconhecidas são descartadas pelo `z.object`: clientes antigos que
  // ainda mandam as opções de trivial e de plano (fixas desde o ADR-28) não
  // recebem erro, e os campos são ignorados.
  // Opcional também na criação: ausente vale "" (sem instruções próprias).
  instrucoesPersonalizadas: esquemaDeInstrucoes("As instruções personalizadas").optional(),
  // Opcional também na criação: ausente vale "todos". Os nomes da lista são
  // conferidos pelo domínio (`selecaoDeSubagentesProntosValida`); os que não
  // existem mais nas preferências são ignorados no pedido.
  subagentesProntos: z
    .union([z.enum(["todos", "nenhum"]), z.array(z.string())], {
      error: 'Os subagentes prontos do orquestrador devem ser "todos", "nenhum" ou uma lista de nomes.',
    })
    .optional(),
});

const esquemaDoNome = z
  .string({ error: "Dê um nome ao orquestrador." })
  .trim()
  .min(1, { error: "Dê um nome ao orquestrador." })
  .max(TAMANHO_MAXIMO_DO_NOME, { error: `O nome deve ter até ${TAMANHO_MAXIMO_DO_NOME} caracteres.` });

const esquemaDeCriacao = esquemaDaConfiguracao.extend({
  nome: esquemaDoNome,
  pastaDeTrabalho: z.string({ error: "Escolha a pasta de trabalho." }).min(1, {
    error: "Escolha a pasta de trabalho.",
  }),
});

/**
 * Forma de cada subagente pronto. Nome, tamanhos, nomes repetidos e modelo
 * são conferidos pelo domínio (`subagentesProntosValidos`), com as mensagens
 * para o usuário.
 */
const esquemaDoSubagentePronto = z.object({
  nome: z.string({ error: "O nome do subagente pronto deve ser um texto." }),
  descricao: z.string({ error: "A descrição do subagente pronto deve ser um texto." }),
  prompt: z.string({ error: "O prompt do subagente pronto deve ser um texto." }),
  modelo: z.string({ error: "Modelo do subagente pronto inválido." }).optional(),
});

/**
 * Forma de cada perfil de instruções. Nome vazio ou repetido e tamanhos são
 * conferidos pelo domínio (`perfisDeInstrucoesValidos`).
 */
const esquemaDoPerfilDeInstrucoes = z.object({
  nome: z.string({ error: "O nome do perfil de instruções deve ser um texto." }),
  // Bruto folgado, como em `esquemaDeInstrucoes`: o limite de fato vem depois de normalizar.
  texto: z
    .string({ error: "O texto do perfil de instruções deve ser um texto." })
    .max(TAMANHO_MAXIMO_DAS_INSTRUCOES * 2, {
      error: `O texto do perfil de instruções deve ter até ${TAMANHO_MAXIMO_DAS_INSTRUCOES} caracteres.`,
    }),
});

const esquemaDasPreferencias = z.object({
  instrucoesPadrao: esquemaDeInstrucoes("As instruções gerais").optional(),
  subagentesProntos: z
    .array(esquemaDoSubagentePronto, { error: "Os subagentes prontos devem ser uma lista." })
    .optional(),
  perfisDeInstrucoes: z
    .array(esquemaDoPerfilDeInstrucoes, { error: "Os perfis de instruções devem ser uma lista." })
    .optional(),
  autorrecuperacao: z
    .boolean({ error: 'A opção "Autorrecuperação" deve ser verdadeira ou falsa.' })
    .optional(),
});

/**
 * Pré-visualização do que o Orquestrador recebe num pedido com esta
 * configuração (ainda não salva). Sem pasta ou sem nome, o texto mostra um
 * marcador no lugar de cada um (também em `{{pasta}}` e `{{nome}}`).
 */
const esquemaDaPrevia = z.object({
  configuracao: esquemaDaConfiguracao,
  pastaDeTrabalho: z.string().optional(),
  nome: z.string({ error: "O nome deve ser um texto." }).optional(),
  modo: z.enum(MODOS_DO_TURNO, { error: "Modo do pedido inválido." }).default("execucao"),
});

/** O que a pré-visualização põe no lugar do pedido do usuário. */
export const PEDIDO_DE_EXEMPLO = "(aqui entra a sua mensagem)";

/**
 * Um item que o usuário ligou ao Orquestrador no canvas: a nota com o texto
 * (a tela o corta antes do limite), a prévia com o endereço e o artefato com o
 * caminho do arquivo, relativo à pasta de entrada dos artefatos.
 */
const esquemaDoItemLigado = z.object({
  tipo: z.enum(TIPOS_DE_ITEM_LIGADO, { error: "Tipo de item ligado inválido." }),
  titulo: z
    .string({ error: "O título do item ligado deve ser um texto." })
    .max(TAMANHO_MAXIMO_DO_TITULO_LIGADO, {
      error: `O título de cada item ligado deve ter até ${TAMANHO_MAXIMO_DO_TITULO_LIGADO} caracteres.`,
    }),
  conteudo: z
    .string({ error: "O texto do item ligado deve ser um texto." })
    .max(TAMANHO_MAXIMO_DO_CONTEUDO_LIGADO, {
      error: `O texto de cada item ligado deve ter até ${TAMANHO_MAXIMO_DO_CONTEUDO_LIGADO} caracteres.`,
    })
    .optional(),
  url: z
    .string({ error: "O endereço do item ligado deve ser um texto." })
    .max(TAMANHO_MAXIMO_DO_ENDERECO_LIGADO, { error: "O endereço do item ligado é longo demais." })
    .regex(/^https?:\/\//i, { error: "O endereço do item ligado deve começar com http:// ou https://." })
    .optional(),
  caminho: z
    .string({ error: "O caminho do item ligado deve ser um texto." })
    .max(TAMANHO_MAXIMO_DO_ENDERECO_LIGADO, { error: "O caminho do item ligado é longo demais." })
    .optional(),
});

/** Opcional: ausente (clientes antigos) vale nenhum item ligado. */
const esquemaDosItensLigados = z
  .array(esquemaDoItemLigado, { error: "Os itens ligados devem ser uma lista." })
  .max(MAXIMO_DE_ITENS_LIGADOS, { error: `Ligue até ${MAXIMO_DE_ITENS_LIGADOS} itens por pedido.` })
  .default([]);

const esquemaDeMensagem = z.object({
  texto: z
    .string({ error: "Escreva uma mensagem." })
    .trim()
    .min(1, { error: "Escreva uma mensagem." })
    .max(TAMANHO_MAXIMO_DA_MENSAGEM, {
      error: `A mensagem deve ter até ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`,
    }),
  /** Imagens e documentos (o nome do campo vem da época em que só havia imagens). */
  imagens: z
    .array(esquemaDoAnexoRecebido)
    .max(MAXIMO_DE_ANEXOS_POR_MENSAGEM, { error: "Anexe menos arquivos por mensagem." })
    .default([]),
  modo: z.enum(MODOS_DO_TURNO, { error: "Modo do pedido inválido." }).default("execucao"),
  itensLigados: esquemaDosItensLigados,
});

/** Pedido para a fila: só texto, modo e os itens ligados (imagens não entram na fila). */
const esquemaDoPedidoNaFila = z.object({
  texto: z
    .string({ error: "Escreva o pedido." })
    .trim()
    .min(1, { error: "Escreva o pedido." })
    .max(TAMANHO_MAXIMO_DA_MENSAGEM, {
      error: `O pedido deve ter até ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`,
    }),
  modo: z.enum(MODOS_DO_TURNO, { error: "Modo do pedido inválido." }).default("execucao"),
  // Recusadas em vez de descartadas em silêncio.
  imagens: z
    .array(z.unknown())
    .max(0, { error: "A fila aceita só texto: envie as imagens quando o orquestrador estiver livre." })
    .optional(),
  // Congelados no pedido: ele sai mais tarde com o contexto ligado na hora de enfileirar.
  itensLigados: esquemaDosItensLigados,
});

const esquemaDeAprovacaoDoPlano = z.object({
  observacoes: z
    .string({ error: "As observações devem ser um texto." })
    .trim()
    .max(TAMANHO_MAXIMO_DA_MENSAGEM, {
      error: `As observações devem ter até ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`,
    })
    .default(""),
  // Opcional: ausente vale `false`. O serviço o ignora se a configuração não libera commit.
  commitarAoFinal: z
    .boolean({ error: 'A opção "Commitar ao final" deve ser verdadeira ou falsa.' })
    .default(false),
});

/** Renomear: só o nome, com a regra da criação. */
const esquemaDeRenomeacao = z.object({ nome: esquemaDoNome });

const esquemaDaPredefinicao = z.object({
  predefinicao: z.string({ error: "Predefinição desconhecida." }),
});

const esquemaDaConsultaDeEsforco = z.object({
  modeloDoOrquestrador: z.enum(MODELOS_CLAUDE, { error: "Modelo do orquestrador inválido." }),
  modeloDosSubagentes: z.enum(MODELOS_CLAUDE, { error: "Modelo dos subagentes inválido." }),
  pasta: z.string({ error: "Escolha a pasta de trabalho." }).min(1, { error: "Escolha a pasta de trabalho." }),
});

function responderErro(resposta: Response, erro: unknown): void {
  if (erro instanceof ErroDeOrquestracao) {
    resposta.status(STATUS_DA_ORQUESTRACAO[erro.motivo]).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ErroDeFilaCheia) {
    resposta.status(409).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ErroDeCaminho) {
    resposta.status(400).json({ erro: erro.message });
    return;
  }
  responderErroGenerico(resposta, erro, "[http] Erro inesperado:");
}

const rota = criarRota(responderErro);

/** Quantos Orquestradores uma conexão de eventos acompanha, no máximo. */
export const MAXIMO_DE_ORQUESTRADORES_POR_CONEXAO = 200;

/**
 * `id:desde,id:desde` → id e a última sequência que a tela já tem (0 quando
 * falta ou não é um inteiro positivo). Um id repetido vale a última vez.
 */
function lerAssinaturasDeEventos(valor: unknown): Map<string, number> {
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new ErroDeOrquestracao("dados_invalidos", "Informe de quais orquestradores quer os eventos.");
  }
  const itens = valor.split(",");
  if (itens.length > MAXIMO_DE_ORQUESTRADORES_POR_CONEXAO) {
    throw new ErroDeOrquestracao(
      "dados_invalidos",
      `Acompanhe no máximo ${MAXIMO_DE_ORQUESTRADORES_POR_CONEXAO} orquestradores por conexão.`,
    );
  }
  const assinaturas = new Map<string, number>();
  for (const item of itens) {
    const separador = item.lastIndexOf(":");
    const id = (separador < 0 ? item : item.slice(0, separador)).trim();
    const desde = separador < 0 ? 0 : Number(item.slice(separador + 1));
    if (id !== "") {
      assinaturas.set(id, Number.isInteger(desde) && desde > 0 ? desde : 0);
    }
  }
  return assinaturas;
}

/**
 * Traduz o domínio para o JSON da tela. A sessão do Claude Code (`sessaoId`)
 * não sai daqui: é detalhe do motor, não interessa a quem usa a tela.
 *
 * `instrucoesAtivas` diz de onde viriam as instruções personalizadas no
 * próximo pedido (próprias, padrão global ou nenhuma), sem repetir o texto.
 * `planoPendente` diz se o último pedido terminou com um Plano à espera da
 * decisão do usuário (o cartão do chat conta isso como ocupado).
 */
function apresentarResumo(orquestrador: Orquestrador, instrucoes: InstrucoesAplicadas | null) {
  const ultimo = orquestrador.ultimoTurno;
  return {
    id: orquestrador.id,
    nome: orquestrador.nome,
    pastaDeTrabalho: orquestrador.pastaDeTrabalho.caminho,
    nomeDaPasta: orquestrador.pastaDeTrabalho.nome,
    situacao: orquestrador.situacao,
    configuracao: orquestrador.configuracao.paraDados(),
    predefinicaoCorrespondente: orquestrador.predefinicaoCorrespondente,
    instrucoesAtivas: instrucoes?.origem ?? null,
    worktree: orquestrador.worktree,
    fila: orquestrador.fila.map((pedido) => pedido.paraDados()),
    planoPendente: orquestrador.turnoComPlanoPendente !== null,
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

function apresentarDetalhe(orquestrador: Orquestrador, instrucoes: InstrucoesAplicadas | null) {
  return { ...apresentarResumo(orquestrador, instrucoes), turnos: orquestrador.paraDados().turnos };
}

/**
 * Quanto o Orquestrador gastou na conversa atual: a soma dos consumos medidos
 * (`consumo_do_turno_medido`) do histórico em memória. Conversas limpas ficam
 * de fora (o histórico delas está arquivado no disco). `parcial`: algum dos
 * turnos somados foi cancelado ou falhou.
 */
function apresentarConsumo(orquestrador: Orquestrador, eventos: readonly EventoRegistrado[]) {
  let uso = UsoDeTokens.vazio;
  let turnosMedidos = 0;
  let parcial = false;
  for (const evento of eventos) {
    if (evento.tipo !== "consumo_do_turno_medido") {
      continue;
    }
    uso = uso.somar(UsoDeTokens.criar(evento.consumo.principal)).somar(UsoDeTokens.criar(evento.consumo.subagentes));
    turnosMedidos += 1;
    parcial ||= evento.consumo.parcial;
  }
  return {
    id: orquestrador.id,
    nome: orquestrador.nome,
    turnosMedidos,
    parcial,
    uso: uso.paraDados(),
    indiceDeCusto: uso.indiceDeCusto(),
  };
}

function apresentarEsforcoHerdado({ orquestrador, subagentes }: EsforcoHerdadoDosPapeis) {
  return {
    orquestrador: orquestrador === null ? null : orquestrador.paraDados(),
    subagentes: subagentes === null ? null : subagentes.paraDados(),
  };
}

export function criarOrquestradoresRoutes({
  servico,
  repositorio,
  canal,
  explorador,
  anexos,
  preferencias,
  pastaRaiz,
  plataforma = "unix",
}: Dependencias): Router {
  const rotas = Router();
  const resumo = (orquestrador: Orquestrador) =>
    apresentarResumo(orquestrador, servico.instrucoesPara(orquestrador.configuracao));
  const detalhe = (orquestrador: Orquestrador) =>
    apresentarDetalhe(orquestrador, servico.instrucoesPara(orquestrador.configuracao));

  rotas.get(
    "/pastas",
    rota(async (_requisicao, resposta) => {
      resposta.json({ raiz: pastaRaiz, pastas: await explorador.listarProjetos() });
    }),
  );

  // Navega pelo computador para escolher uma pasta fora da raiz dos projetos.
  rotas.get(
    "/pastas/navegar",
    rota(async (requisicao, resposta) => {
      const caminho = typeof requisicao.query.caminho === "string" ? requisicao.query.caminho : undefined;
      // `estrito=1`: caminho digitado à mão; se não servir, responde 400 em vez de voltar à raiz.
      const estrito = requisicao.query.estrito === "1";
      resposta.json(await explorador.navegar(caminho, { estrito }));
    }),
  );

  rotas.get(
    "/orquestradores",
    rota((_requisicao, resposta) => {
      resposta.json(repositorio.listar().map(resumo));
    }),
  );

  /**
   * O consumo medido de cada Orquestrador na conversa atual, do maior índice
   * de custo para o menor. Só entra quem tem algum turno medido.
   */
  rotas.get(
    "/consumo-dos-orquestradores",
    rota((_requisicao, resposta) => {
      const consumos = repositorio
        .listar()
        .map((orquestrador) => apresentarConsumo(orquestrador, repositorio.lerEventos(orquestrador.id, 0)))
        .filter((consumo) => consumo.turnosMedidos > 0)
        .sort((a, b) => b.indiceDeCusto - a.indiceDeCusto);
      resposta.json(consumos);
    }),
  );

  rotas.post(
    "/orquestradores",
    rota(async (requisicao, resposta) => {
      const { nome, pastaDeTrabalho, ...configuracao } = esquemaDeCriacao.parse(requisicao.body);

      // Caminho absoluto = pasta escolhida à mão pelo navegador de pastas, que
      // pode ficar fora da raiz. Relativo = veio do seletor de projetos, preso
      // à raiz por segurança.
      const pasta = path.isAbsolute(pastaDeTrabalho.trim())
        ? PastaDeTrabalho.qualquer(pastaDeTrabalho)
        : PastaDeTrabalho.dentroDe(pastaRaiz, pastaDeTrabalho);
      if (!(await explorador.existe(pasta.caminho))) {
        throw new ErroDeOrquestracao("dados_invalidos", `A pasta "${pasta.caminho}" não existe.`);
      }

      const orquestrador = await servico.criarOrquestrador({ nome, pastaDeTrabalho: pasta, configuracao });
      resposta.status(201).json(detalhe(orquestrador));
    }),
  );

  rotas.get(
    "/orquestradores/:id",
    rota((requisicao, resposta) => {
      const orquestrador = repositorio.buscarPorId(requisicao.params.id);
      if (orquestrador === null) {
        throw new ErroDeOrquestracao("nao_encontrado", "Orquestrador não encontrado.");
      }
      resposta.json(detalhe(orquestrador));
    }),
  );

  /** Troca o nome; vale também durante um pedido. Responde o detalhe, como o GET. */
  rotas.patch(
    "/orquestradores/:id",
    rota(async (requisicao, resposta) => {
      const { nome } = esquemaDeRenomeacao.parse(requisicao.body ?? {});
      const orquestrador = await servico.renomear(requisicao.params.id, nome);
      resposta.json(detalhe(orquestrador));
    }),
  );

  rotas.patch(
    "/orquestradores/:id/configuracao",
    rota(async (requisicao, resposta) => {
      const alteracoes = esquemaDaConfiguracao.partial().parse(requisicao.body);
      const orquestrador = await servico.alterarConfiguracao(requisicao.params.id, alteracoes);
      resposta.json(resumo(orquestrador));
    }),
  );

  /**
   * Preferências que valem para todos os Orquestradores (instruções gerais,
   * subagentes prontos, perfis de instruções e autorrecuperação dos turnos).
   */
  rotas.get(
    "/preferencias",
    rota((_requisicao, resposta) => {
      resposta.json(preferencias.atuais().paraDados());
    }),
  );

  /** Só os campos enviados mudam. Vale a partir do próximo pedido de cada Orquestrador. */
  rotas.patch(
    "/preferencias",
    rota(async (requisicao, resposta) => {
      const alteracoes = esquemaDasPreferencias.parse(requisicao.body ?? {});
      const novas = preferencias.atuais().com(alteracoes);
      await preferencias.salvar(novas);
      resposta.json(novas.paraDados());
    }),
  );

  /**
   * O texto que o Orquestrador receberia: as instruções iniciais (system
   * prompt da conversa) e a mensagem de um pedido, com o bloco da
   * configuração e as instruções personalizadas que valeriam. Não salva nada.
   * A pasta segue a regra da criação: absoluta vale qualquer uma; relativa
   * fica presa à raiz dos projetos.
   */
  rotas.post(
    "/previa-do-prompt",
    rota((requisicao, resposta) => {
      const { configuracao: dados, pastaDeTrabalho, nome, modo } = esquemaDaPrevia.parse(requisicao.body ?? {});
      const configuracao = ConfiguracaoDoOrquestrador.de(dados);
      const informada = pastaDeTrabalho?.trim() ?? "";
      const pasta =
        informada === ""
          ? PastaDeTrabalho.reconstituir("<pasta de trabalho>")
          : path.isAbsolute(informada)
            ? PastaDeTrabalho.qualquer(informada)
            : PastaDeTrabalho.dentroDe(pastaRaiz, informada);
      const nomeInformado = nome?.trim() ?? "";
      // No turno, `{{pasta}}` vira o worktree, se houver; a prévia mostra a pasta de trabalho.
      const instrucoes = aplicarVariaveis(servico.instrucoesPara(configuracao), {
        pasta: pasta.caminho,
        nome: nomeInformado === "" ? "<nome do orquestrador>" : nomeInformado,
      });
      resposta.json({
        instrucoesIniciais: instrucoesDoOrquestrador(pasta),
        mensagem: mensagemParaOOrquestrador(
          PEDIDO_DE_EXEMPLO,
          configuracao,
          [],
          modo,
          // Cada Orquestrador tem a sua pasta de artefatos: a prévia mostra um marcador.
          "<pasta de artefatos>",
          instrucoes,
          false,
          servico.subagentesProntosPara(configuracao),
          plataforma,
        ),
        origemDasInstrucoes: instrucoes?.origem ?? null,
      });
    }),
  );

  /** As predefinições de configuração disponíveis (ex.: "Modo econômico"). */
  rotas.get(
    "/predefinicoes",
    rota((_requisicao, resposta) => {
      resposta.json(PREDEFINICOES.map((predefinicao) => predefinicao.paraDados()));
    }),
  );

  /** Aplica uma predefinição; responde como o PATCH da configuração. */
  rotas.post(
    "/orquestradores/:id/configuracao/predefinicao",
    rota(async (requisicao, resposta) => {
      const { predefinicao } = esquemaDaPredefinicao.parse(requisicao.body ?? {});
      const orquestrador = await servico.aplicarPredefinicao(requisicao.params.id, predefinicao);
      resposta.json(resumo(orquestrador));
    }),
  );

  /** O esforço que cada papel herda do Claude Code da máquina quando está em "Padrão". */
  rotas.get(
    "/orquestradores/:id/esforco-herdado",
    rota(async (requisicao, resposta) => {
      resposta.json(apresentarEsforcoHerdado(await servico.esforcoHerdadoDe(requisicao.params.id)));
    }),
  );

  /** O mesmo, para o formulário de criação: modelos e pasta ainda não salvos. */
  rotas.get(
    "/esforco-herdado",
    rota(async (requisicao, resposta) => {
      const consulta = esquemaDaConsultaDeEsforco.parse(requisicao.query);
      const pasta = PastaDeTrabalho.dentroDe(pastaRaiz, consulta.pasta);
      if (!(await explorador.existe(pasta.caminho))) {
        throw new ErroDeOrquestracao("dados_invalidos", `A pasta "${pasta.caminho}" não existe.`);
      }
      const herdado = await servico.esforcoHerdadoPara({
        modeloDoOrquestrador: consulta.modeloDoOrquestrador,
        modeloDosSubagentes: consulta.modeloDosSubagentes,
        pastaDoProjeto: pasta.caminho,
      });
      resposta.json(apresentarEsforcoHerdado(herdado));
    }),
  );

  rotas.post(
    "/orquestradores/:id/mensagens",
    rota(async (requisicao, resposta) => {
      const { texto, imagens, modo, itensLigados } = esquemaDeMensagem.parse(requisicao.body);
      const { turnoId } = await servico.enviarMensagem(
        requisicao.params.id,
        texto,
        imagens.map((imagem) => ({
          nome: imagem.nome,
          tipoDeMidia: imagem.tipoDeMidia,
          conteudo: Buffer.from(imagem.base64, "base64"),
        })),
        modo,
        itensLigados,
      );
      resposta.status(202).json({ turnoId });
    }),
  );

  /**
   * Guarda um pedido na fila: ele sai sozinho quando o turno atual terminar
   * bem, ou com "enviar agora". Aceito com ou sem turno em andamento.
   */
  rotas.post(
    "/orquestradores/:id/fila",
    rota(async (requisicao, resposta) => {
      const { texto, modo, itensLigados } = esquemaDoPedidoNaFila.parse(requisicao.body ?? {});
      const { pedidoId } = await servico.enfileirarPedido(requisicao.params.id, texto, modo, itensLigados);
      resposta.status(201).json({ pedidoId });
    }),
  );

  rotas.delete(
    "/orquestradores/:id/fila/:pedidoId",
    rota<{ id: string; pedidoId: string }>(async (requisicao, resposta) => {
      await servico.removerDaFila(requisicao.params.id, requisicao.params.pedidoId);
      resposta.status(204).end();
    }),
  );

  /** "Enviar agora": o pedido sai da fila e vira um turno, como uma mensagem. */
  rotas.post(
    "/orquestradores/:id/fila/:pedidoId/enviar",
    rota<{ id: string; pedidoId: string }>(async (requisicao, resposta) => {
      const { turnoId } = await servico.enviarDaFila(requisicao.params.id, requisicao.params.pedidoId);
      resposta.status(202).json({ turnoId });
    }),
  );

  /** Aprova o Plano pendente e já inicia o turno que o executa. */
  rotas.post(
    "/orquestradores/:id/plano/aprovar",
    rota(async (requisicao, resposta) => {
      const { observacoes, commitarAoFinal } = esquemaDeAprovacaoDoPlano.parse(requisicao.body ?? {});
      const { turnoId } = await servico.aprovarPlano(requisicao.params.id, observacoes, commitarAoFinal);
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

  /**
   * Conversa nova no mesmo orquestrador ("/clear"): arquiva o histórico e o
   * próximo pedido abre outra sessão do Claude Code. Sem corpo.
   */
  rotas.post(
    "/orquestradores/:id/conversa/limpar",
    rota(async (requisicao, resposta) => {
      const orquestrador = await servico.limparConversa(requisicao.params.id);
      resposta.json(resumo(orquestrador));
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
      enviarAnexo(resposta, arquivo, anexos.caminhoDe(id, arquivo));
    }),
  );

  /**
   * Eventos ao vivo (Server-Sent Events) de vários Orquestradores numa conexão
   * só: `?orquestradores=<id>:<desde>,<id>:<desde>`. Para cada um, reenvia o
   * histórico depois de `desde` (0 ou ausente: tudo, que é como a tela
   * reconstrói uma conversa antiga) e segue com os eventos novos. Cada
   * mensagem leva o id do seu Orquestrador.
   *
   * Uma conexão para todos os terminais, e não uma por terminal: o navegador
   * abre no máximo 6 conexões HTTP/1.1 com o mesmo servidor, e cada SSE ocupa
   * uma para sempre. Com uma por terminal, 4 terminais mais o chat e os
   * artefatos esgotavam o limite e todo pedido da tela ficava parado na fila.
   *
   * Sem `id:` nas mensagens (um único Last-Event-ID não serve para vários
   * históricos): quando a conexão cai, a tela a recria com as sequências que
   * já tem. Ids que não existem são ignorados.
   */
  rotas.get(
    "/eventos-dos-orquestradores",
    rota((requisicao, resposta) => {
      const assinaturas = lerAssinaturasDeEventos(requisicao.query.orquestradores);

      resposta.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      resposta.write("retry: 3000\n\n");

      const cancelamentos: (() => void)[] = [];
      for (const [orquestradorId, desde] of assinaturas) {
        if (repositorio.buscarPorId(orquestradorId) === null) {
          continue;
        }
        let ultimaSequencia = desde;
        const enviar = (evento: EventoRegistrado): void => {
          if (evento.sequencia <= ultimaSequencia) {
            return;
          }
          ultimaSequencia = evento.sequencia;
          resposta.write(`data: ${JSON.stringify({ orquestradorId, evento })}\n\n`);
        };

        // Leitura do histórico e assinatura acontecem no mesmo tick: nenhum
        // evento novo consegue cair entre as duas.
        for (const evento of repositorio.lerEventos(orquestradorId, ultimaSequencia)) {
          enviar(evento);
        }
        // Sinais de vida vão como outro tipo de evento SSE: não entram na
        // sequência do histórico.
        cancelamentos.push(
          canal.assinar(orquestradorId, {
            aoEvento: enviar,
            aoSinal: (sinal) => resposta.write(`event: sinal\ndata: ${JSON.stringify({ orquestradorId, sinal })}\n\n`),
          }),
        );
      }

      // Comentário periódico: mantém a conexão viva através de proxies e antivírus.
      const batimento = setInterval(() => resposta.write(": ping\n\n"), 25_000);
      requisicao.on("close", () => {
        clearInterval(batimento);
        for (const cancelar of cancelamentos) {
          cancelar();
        }
      });
    }),
  );

  return rotas;
}
