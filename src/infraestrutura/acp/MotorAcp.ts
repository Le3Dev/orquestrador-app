import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { EventoDoMotor, UsoDoTurno } from "../../orquestracao/EventoDeOrquestracao";
import { FERRAMENTA_DE_DELEGACAO, Plataforma } from "../../orquestracao/InstrucoesDoOrquestrador";
import { rotuloDoMotor } from "../../orquestracao/Motor";
import { ABORTO_POR_SILENCIO, MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { ambienteSemSessaoPai } from "../claudecode/ArgumentosDoClaudeCode";
import { INTERVALO_DOS_AVISOS_DE_LINHA_MS, limitarAvisos, MOTIVO_DO_SILENCIO, prepararPastaDeArtefatos } from "../claudecode/MotorClaudeCodeCli";
import { SondaDeEndereco, sondarEnderecoLocal } from "../claudecode/SondaDeEnderecoLocal";
import { NOME_DO_SERVIDOR_MCP, RegistroDoTurnoMcp } from "../mcp/ServidorMcpDoApp";
import {
  abrirTurnoNoServidorMcp,
  FERRAMENTAS_DO_APP_POR_PADRAO,
  FerramentasDoAppNoTurno,
  lerImagensDoPedido,
  mensagemDoErro as mensagemDe,
  PonteParaOServidorMcp,
  somarConsumoDosSubagentes,
} from "../motores/ApoioDosMotores";
import { ConferenciaDeEnderecos, DetectorDeEnderecosLocais } from "../motores/DetectorDeEnderecosLocais";
import { falhaDoMotor } from "../motores/ClassificadorDeFalhasDosMotores";
import { ErroJsonRpc, ProcessoEncerradoError } from "../motores/ProcessoJsonRpc";
import { ContextoDePermissao, contextoDePermissaoDoPedido, decidirPermissao } from "../motores/PoliticaDePermissao";
import { promptComRegras, promptDaSubtarefa } from "../motores/PromptDoTurno";
import { RegistroDeTurnosDoApp } from "../motores/RegistroDeTurnosDoApp";
import {
  ConversorParaSubagente,
  ExecucaoDeSubtarefa,
  ExecutorDeSubtarefa,
  ResultadoDaSubtarefa,
} from "../motores/SubtarefaDoApp";
import { AcompanhamentoDeProcessos } from "../sistema/RastreadorDeProcessosDeixados";
import { RegistroDeProcessos } from "../sistema/RegistroDeProcessos";
import {
  acaoDaChamada,
  AdaptadorDeEventosAcp,
  ChamadaDeFerramentaAcp,
  ehFerramentaComONome,
  lerChamadaDeFerramenta,
} from "./AdaptadorDeEventosAcp";
import {
  FachadaAcp,
  ImagemParaAcp,
  PedidoDePermissaoAcp,
  RespostaDePermissaoAcp,
  ServidorMcpParaAcp,
} from "./FachadaAcp";
import { PerfilAcp } from "./PerfilAcp";

/** Quanto esperar o agente reagir ao `session/cancel` antes de derrubar o processo. */
export const ESPERA_DO_CANCELAMENTO_MS = 3_000;

export interface DependenciasDoMotorAcp {
  perfil: PerfilAcp;
  /** Sem o servidor, o motor não oferece ferramentas do app (a delegação). */
  servidorMcp?: PonteParaOServidorMcp | null;
  /** Quais grupos de ferramentas do app o turno liga; padrão: a delegação quando o motor precisa dela. */
  ferramentasDoTurno?: FerramentasDoAppNoTurno;
  turnos?: RegistroDeTurnosDoApp;
  registro?: RegistroDeProcessos | null;
  acompanhamento?: AcompanhamentoDeProcessos | null;
  sondar?: SondaDeEndereco;
  plataforma?: Plataforma;
  versaoDoApp?: string;
}

/** O que uma sessão de agente precisa: tanto o turno do Orquestrador quanto uma subtarefa. */
interface ParametrosDaSessao {
  papel: "orquestrador" | "subagente";
  pedido: PedidoDeTurno;
  contexto: ContextoDePermissao;
  modelo: string;
  texto: string;
  imagens: readonly ImagemParaAcp[];
  /** A sessão a retomar; nulo abre uma nova. */
  sessaoParaRetomar: string | null;
  servidoresMcp: readonly ServidorMcpParaAcp[];
  /** Argumentos a mais para o CLI (o arquivo de configuração do MCP do app). */
  argumentosExtras?: readonly string[];
  dono: { orquestradorId: string; sessaoId: string };
  aoObservar: (evento: EventoDoMotor) => void;
  sinal: AbortSignal;
  aoReceberLinha?: () => void;
}

function ehFaltaDeLoginNoTexto(texto: string): boolean {
  return /authentication required|not (?:logged|signed) in|please (?:log|sign) ?in|unauthorized/i.test(texto);
}

/**
 * `MotorDeAgentes` sobre um CLI que fala o Agent Client Protocol (hoje o GitHub
 * Copilot CLI): um processo `copilot --acp` por turno, com o login do usuário.
 *
 * O ACP não tem prompt de sistema: as regras do Orquestrador e o bloco
 * `<configuracao-do-pedido>` vão no texto do `session/prompt` (`promptComRegras`),
 * junto com o contexto da troca de motor, quando houver.
 *
 * Sessão: o primeiro turno abre uma sessão (`session/new`) e devolve o id em
 * `sessaoDoMotor`; os seguintes a retomam com `session/load`. O agente repete o
 * histórico em `session/update` antes de responder o `load`: o motor o ignora.
 * Se o agente não sabe retomar (sem `loadSession`) ou a sessão não existe mais
 * (o usuário apagou o histórico do CLI), o motor abre uma sessão nova, avisa o
 * agente no prompt de que a conversa anterior não está disponível e devolve o id
 * novo: a conversa do app continua, sem a memória do agente.
 *
 * Permissões: cada `session/request_permission` passa pela política do app
 * (`decidirPermissao`), a mesma que vale para o Claude Code. Nunca escolhe "permitir
 * sempre": isso gravaria a liberação na configuração do CLI do usuário.
 *
 * Cancelamento: `session/cancel` e, se o agente não responder em
 * `ESPERA_DO_CANCELAMENTO_MS`, derruba a árvore de processos.
 */
export class MotorAcp implements MotorDeAgentes, ExecutorDeSubtarefa {
  private readonly perfil: PerfilAcp;
  private readonly sondar: SondaDeEndereco;
  private readonly plataforma: Plataforma;

  constructor(private readonly dependencias: DependenciasDoMotorAcp) {
    this.perfil = dependencias.perfil;
    this.sondar = dependencias.sondar ?? sondarEnderecoLocal;
    this.plataforma = dependencias.plataforma ?? "unix";
  }

  async executarTurno(
    pedidoRecebido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
    aoReceberLinha?: () => void,
  ): Promise<ResultadoDoTurno> {
    if (pedidoRecebido.motor !== this.perfil.motor) {
      return {
        sucesso: false,
        motivo: `Este motor executa só o ${this.perfil.nomeDoCli}; o pedido era para o ${rotuloDoMotor(pedidoRecebido.motor)}.`,
        uso: null,
      };
    }
    let pedido: PedidoDeTurno;
    try {
      pedido = { ...pedidoRecebido, pastaDeArtefatos: await prepararPastaDeArtefatos(pedidoRecebido.pastaDeArtefatos) };
    } catch (erro) {
      return { sucesso: false, motivo: `Não foi possível preparar a pasta de artefatos: ${mensagemDe(erro)}`, uso: null };
    }

    let registroMcp: RegistroDoTurnoMcp | null = null;
    let pastaDoMcp: string | null = null;
    try {
      registroMcp = abrirTurnoNoServidorMcp(
        this.dependencias.servidorMcp,
        (this.dependencias.ferramentasDoTurno ?? FERRAMENTAS_DO_APP_POR_PADRAO)(pedido),
        pedido.orquestradorId,
      );
      let servidoresMcp: ServidorMcpParaAcp[] = [];
      let argumentosDoMcp: string[] = [];
      if (registroMcp !== null) {
        const porArquivo = this.perfil.mcpPorArquivo;
        if (porArquivo === undefined) {
          servidoresMcp = [paraServidorMcp(registroMcp)];
        } else {
          // O token vai num arquivo só do dono, apagado no fim do turno.
          pastaDoMcp = path.join(tmpdir(), "orquestrador-agentes", randomUUID());
          await mkdir(pastaDoMcp, { recursive: true, mode: 0o700 });
          const arquivo = path.join(pastaDoMcp, "mcp.json");
          await writeFile(
            arquivo,
            JSON.stringify(porArquivo.conteudo({ nome: NOME_DO_SERVIDOR_MCP, url: registroMcp.url, token: registroMcp.token })),
            { encoding: "utf8", mode: 0o600 },
          );
          argumentosDoMcp = porArquivo.argumentos(arquivo);
        }
      }
      const imagens = await lerImagensDoPedido(pedido);
      const resultado = await this.executarSessao({
        papel: "orquestrador",
        pedido,
        contexto: contextoDePermissaoDoPedido(pedido),
        modelo: pedido.configuracao.modeloDoOrquestrador,
        texto: promptComRegras(pedido, this.plataforma),
        imagens,
        sessaoParaRetomar: pedido.sessaoIniciada && pedido.sessaoId !== "" ? pedido.sessaoId : null,
        servidoresMcp,
        argumentosExtras: argumentosDoMcp,
        dono: { orquestradorId: pedido.orquestradorId, sessaoId: pedido.sessaoId },
        aoObservar,
        sinal,
        ...(aoReceberLinha === undefined ? {} : { aoReceberLinha: limitarAvisos(aoReceberLinha, INTERVALO_DOS_AVISOS_DE_LINHA_MS) }),
      });
      return somarConsumoDosSubagentes(this.dependencias.turnos, pedido, resultado);
    } catch (erro) {
      return { sucesso: false, motivo: `Falha ao executar o turno no ${this.perfil.nomeDoCli}: ${mensagemDe(erro)}`, uso: null };
    } finally {
      registroMcp?.encerrar();
      if (pastaDoMcp !== null) {
        await rm(pastaDoMcp, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  /** Roda uma subtarefa delegada: uma sessão nova, com as regras do Subagente, sem ferramentas do app. */
  async executarSubtarefa(execucao: ExecucaoDeSubtarefa): Promise<ResultadoDaSubtarefa> {
    const inicio = Date.now();
    let pedido: PedidoDeTurno;
    try {
      pedido = { ...execucao.pedido, pastaDeArtefatos: await prepararPastaDeArtefatos(execucao.pedido.pastaDeArtefatos) };
    } catch (erro) {
      return resultadoFalho(`Não foi possível preparar a pasta de artefatos: ${mensagemDe(erro)}`, inicio);
    }
    const conversor = new ConversorParaSubagente(execucao.subagenteId, inicio);
    const resultado = await this.executarSessao({
      papel: "subagente",
      pedido,
      contexto: contextoDePermissaoDoPedido(pedido),
      modelo: pedido.configuracao.modeloDosSubagentes,
      texto: promptDaSubtarefa(pedido, execucao.subtarefa, execucao.especialidade, this.plataforma),
      imagens: [],
      sessaoParaRetomar: null,
      servidoresMcp: [],
      dono: { orquestradorId: pedido.orquestradorId, sessaoId: execucao.subagenteId },
      aoObservar: (evento) => {
        for (const convertido of conversor.converter(evento)) {
          execucao.aoProgredir(convertido);
        }
      },
      sinal: execucao.sinal,
    });
    const uso = resultado.uso;
    const tokens = { tokensDeEntrada: uso?.tokensDeEntrada ?? 0, tokensDeSaida: uso?.tokensDeSaida ?? 0 };
    const duracaoMs = Date.now() - inicio;
    if (resultado.sucesso) {
      return { situacao: "concluido", relatorio: resultado.resposta, duracaoMs, ...tokens };
    }
    return {
      situacao: execucao.sinal.aborted ? "cancelado" : "falhou",
      relatorio: resultado.motivo,
      duracaoMs,
      ...tokens,
    };
  }

  // ── A sessão ────────────────────────────────────────────────────────────

  private async executarSessao(parametros: ParametrosDaSessao): Promise<ResultadoDoTurno> {
    const { perfil } = this;
    const { sinal } = parametros;
    const inicio = Date.now();
    const duracao = (): number => Date.now() - inicio;
    const uso = (tokensDeEntrada = 0, tokensDeSaida = 0): UsoDoTurno => ({
      duracaoMs: duracao(),
      tokensDeEntrada,
      tokensDeSaida,
      subagentesLancados: 0,
    });
    if (sinal.aborted) {
      return sinal.reason === ABORTO_POR_SILENCIO
        ? { sucesso: false, causa: "silencio", motivo: MOTIVO_DO_SILENCIO, uso: null }
        : { sucesso: false, motivo: "Turno cancelado.", uso: null };
    }

    const detector = new DetectorDeEnderecosLocais();
    const conferencia = new ConferenciaDeEnderecos(detector, this.sondar, parametros.aoObservar, sinal);
    const adaptador = new AdaptadorDeEventosAcp({
      detector,
      nomeDoTerminal: this.plataforma === "windows" ? "PowerShell" : "Bash",
      ehFerramentaDeDelegacao: (chamada) => ehChamadaDeDelegacao(chamada),
    });
    const emitir = (eventos: readonly EventoDoMotor[]): void => {
      for (const evento of eventos) {
        parametros.aoObservar(evento);
      }
      conferencia.conferirCitados();
    };

    let carregando = false;
    let sessaoAtual: string | null = null;
    let promptEmAndamento = false;
    const comando = perfil.comando();
    const fachada = new FachadaAcp(
      {
        executavel: comando.executavel,
        argumentos: [
          ...comando.argumentosIniciais,
          ...perfil.argumentosDoTurno({ contexto: parametros.contexto, modelo: parametros.modelo }),
          ...(parametros.argumentosExtras ?? []),
        ],
        pasta: parametros.pedido.pastaDeTrabalho.caminho,
        ambiente: perfil.ambiente(ambienteSemSessaoPai(process.env)),
        dono: parametros.dono,
        nomeDoCli: perfil.nomeDoCli,
        informacoesDoCliente: { nome: "orquestrador-de-agentes", versao: this.dependencias.versaoDoApp ?? "1.0.0" },
      },
      {
        // O histórico repetido por `session/load` não é deste turno.
        aoAtualizar: (_sessaoId, atualizacao) => {
          if (!carregando) {
            emitir(adaptador.traduzir(atualizacao));
          }
        },
        aoPedirPermissao: (pedido) => this.decidirPermissao(pedido, parametros),
        ...(parametros.aoReceberLinha === undefined ? {} : { aoReceberLinha: parametros.aoReceberLinha }),
      },
      this.dependencias.registro ?? null,
      this.dependencias.acompanhamento ?? null,
    );

    let temporizadorDoCancelamento: NodeJS.Timeout | undefined;
    const aoAbortar = (): void => {
      if (sinal.reason === ABORTO_POR_SILENCIO || sessaoAtual === null || !promptEmAndamento) {
        fachada.derrubar();
        return;
      }
      fachada.cancelar(sessaoAtual);
      temporizadorDoCancelamento = setTimeout(() => fachada.derrubar(), ESPERA_DO_CANCELAMENTO_MS);
      temporizadorDoCancelamento.unref();
    };
    sinal.addEventListener("abort", aoAbortar, { once: true });

    let sessaoDoMotor: string | undefined;
    try {
      const capacidades = await fachada.inicializar();
      let sessao;
      let avisoDeSessaoPerdida = "";
      if (parametros.sessaoParaRetomar !== null && capacidades.carregaSessao) {
        carregando = true;
        try {
          sessao = await fachada.carregarSessao(parametros.sessaoParaRetomar, parametros.pedido.pastaDeTrabalho.caminho, parametros.servidoresMcp);
        } catch (erro) {
          if (!(erro instanceof ErroJsonRpc) || perfil.ehFaltaDeLogin(erro.message, erro.codigo)) {
            throw erro;
          }
          avisoDeSessaoPerdida = `A sessão anterior deste motor não pôde ser retomada (${erro.message}); a conversa continua sem a memória dela.`;
        } finally {
          carregando = false;
        }
      } else if (parametros.sessaoParaRetomar !== null) {
        avisoDeSessaoPerdida = `O ${perfil.nomeDoCli} não retoma sessões; a conversa continua sem a memória do turno anterior.`;
      }
      sessao ??= await fachada.novaSessao(parametros.pedido.pastaDeTrabalho.caminho, parametros.servidoresMcp);
      sessaoAtual = sessao.sessaoId;
      sessaoDoMotor = sessao.sessaoId;
      parametros.aoObservar({ tipo: "sessao_iniciada", sessaoDoMotor: sessao.sessaoId });

      const texto = avisoDeSessaoPerdida === "" ? parametros.texto : `(${avisoDeSessaoPerdida})\n\n${parametros.texto}`;
      promptEmAndamento = true;
      const resposta = await fachada.enviarPrompt(sessao.sessaoId, texto, capacidades.aceitaImagens ? parametros.imagens : []);
      promptEmAndamento = false;
      fachada.resultadoChegou();

      emitir(adaptador.finalizar());
      const respostaFinal = adaptador.respostaFinal;
      detector.citar(respostaFinal, "resposta");
      conferencia.conferirCitados();
      await conferencia.aguardar();
      const usoDoTurno = uso(resposta.uso?.tokensDeEntrada ?? 0, resposta.uso?.tokensDeSaida ?? 0);

      if (sinal.aborted && sinal.reason === ABORTO_POR_SILENCIO) {
        return { sucesso: false, causa: "silencio", motivo: MOTIVO_DO_SILENCIO, uso: usoDoTurno, sessaoDoMotor };
      }
      // O Copilot responde `end_turn` (e não `cancelled`) ao `session/cancel` de um turno que estava numa ferramenta.
      if (sinal.aborted) {
        return { sucesso: false, motivo: "Turno cancelado.", uso: usoDoTurno, sessaoDoMotor };
      }
      switch (resposta.motivoDeParada) {
        case "end_turn":
          return { sucesso: true, resposta: respostaFinal, uso: usoDoTurno, sessaoDoMotor };
        case "cancelled":
          return { sucesso: false, motivo: "Turno cancelado.", uso: usoDoTurno, sessaoDoMotor };
        case "max_tokens":
          return { sucesso: false, motivo: `O ${perfil.nomeDoCli} parou por limite de tokens da resposta.`, uso: usoDoTurno, sessaoDoMotor };
        case "max_turn_requests":
          return { sucesso: false, motivo: `O ${perfil.nomeDoCli} atingiu o limite de passos sem terminar.`, uso: usoDoTurno, sessaoDoMotor };
        case "refusal":
          return { sucesso: false, motivo: `O ${perfil.nomeDoCli} recusou o pedido.`, uso: usoDoTurno, sessaoDoMotor };
        default:
          return { sucesso: false, motivo: `O ${perfil.nomeDoCli} terminou de forma inesperada (${resposta.motivoDeParada}).`, uso: usoDoTurno, sessaoDoMotor };
      }
    } catch (erro) {
      emitir(adaptador.finalizar());
      if (sinal.aborted) {
        return sinal.reason === ABORTO_POR_SILENCIO
          ? { sucesso: false, causa: "silencio", motivo: MOTIVO_DO_SILENCIO, uso: uso(), ...(sessaoDoMotor === undefined ? {} : { sessaoDoMotor }) }
          : { sucesso: false, motivo: "Turno cancelado.", uso: uso(), ...(sessaoDoMotor === undefined ? {} : { sessaoDoMotor }) };
      }
      return this.falhaDoErro(erro, fachada.erroPadrao, uso(), sessaoDoMotor);
    } finally {
      sinal.removeEventListener("abort", aoAbortar);
      if (temporizadorDoCancelamento !== undefined) {
        clearTimeout(temporizadorDoCancelamento);
      }
      if (sessaoAtual !== null && !sinal.aborted && !fachada.terminou) {
        // Sem este fechamento, uma sessão que o app não vai retomar ficaria na lista do CLI.
        if (parametros.papel === "subagente") {
          await fachada.fecharSessao(sessaoAtual);
        }
      }
      await fachada.encerrarComCalma();
    }
  }

  private falhaDoErro(
    erro: unknown,
    erroPadrao: string,
    uso: UsoDoTurno,
    sessaoDoMotor: string | undefined,
  ): Extract<ResultadoDoTurno, { sucesso: false }> {
    const { perfil } = this;
    if (erro instanceof ErroJsonRpc && perfil.ehFaltaDeLogin(erro.message, erro.codigo)) {
      return {
        sucesso: false,
        motivo: `O ${perfil.nomeDoCli} não está logado. Rode "${perfil.comoEntrar}" no terminal e tente de novo.`,
        uso,
        causa: "outro",
        ...(sessaoDoMotor === undefined ? {} : { sessaoDoMotor }),
      };
    }
    const mensagem = mensagemDe(erro);
    if (/ENOENT/.test(mensagem) && erro instanceof ProcessoEncerradoError) {
      return {
        sucesso: false,
        motivo: `O ${perfil.nomeDoCli} não foi encontrado nesta máquina. Instale-o (${perfil.comoInstalar}), rode "${perfil.comoEntrar}" e tente de novo.`,
        uso,
        causa: "outro",
      };
    }
    if (ehFaltaDeLoginNoTexto(`${mensagem}\n${erroPadrao}`) && !(erro instanceof ErroJsonRpc)) {
      return {
        sucesso: false,
        motivo: `O ${perfil.nomeDoCli} não está logado. Rode "${perfil.comoEntrar}" no terminal e tente de novo.`,
        uso,
        causa: "outro",
        ...(sessaoDoMotor === undefined ? {} : { sessaoDoMotor }),
      };
    }
    const dados = erro instanceof ErroJsonRpc && erro.dados !== undefined ? JSON.stringify(erro.dados) : "";
    const motivoBase =
      erro instanceof ProcessoEncerradoError
        ? `${mensagem}${erroPadrao === "" ? "" : ` ${erroPadrao.slice(0, 600)}`}`
        : `O ${perfil.nomeDoCli} devolveu um erro: ${mensagem}`;
    return falhaDoMotor(perfil.motor, motivoBase, [mensagem, dados, erroPadrao], uso, null, sessaoDoMotor);
  }

  // ── Permissões ──────────────────────────────────────────────────────────

  private async decidirPermissao(pedido: PedidoDePermissaoAcp, parametros: ParametrosDaSessao): Promise<RespostaDePermissaoAcp> {
    const chamada = lerChamadaDeFerramenta(pedido.chamada);
    const acao = acaoDaChamada(chamada, (alvo) => this.perfil.ehFerramentaDoApp(alvo));
    const decisao = decidirPermissao(acao, parametros.contexto);
    if (decisao.permitido) {
      // Nunca "permitir sempre": gravaria a liberação na configuração do CLI do usuário.
      const opcao = pedido.opcoes.find((item) => item.tipo === "allow_once");
      return opcao === undefined ? null : { opcaoId: opcao.id };
    }
    parametros.aoObservar({
      tipo: "permissao_negada",
      ferramenta: chamada.tipo === "execute" ? (this.plataforma === "windows" ? "PowerShell" : "Bash") : chamada.titulo || chamada.tipo,
      detalhe: (acao.tipo === "comando" ? acao.comando : chamada.caminhos[0] ?? chamada.titulo).slice(0, 160),
    });
    const recusa = pedido.opcoes.find((item) => item.tipo === "reject_once") ?? pedido.opcoes.find((item) => item.tipo === "reject_always");
    return recusa === undefined ? null : { opcaoId: recusa.id };
  }
}

/**
 * A chamada da ferramenta de delegação do app. O Copilot põe só o nome da
 * ferramenta MCP no título (sem o do servidor), com o tipo `other`.
 */
function ehChamadaDeDelegacao(chamada: ChamadaDeFerramentaAcp): boolean {
  return chamada.tipo === "other" && ehFerramentaComONome(chamada, [FERRAMENTA_DE_DELEGACAO]);
}

function paraServidorMcp(registro: RegistroDoTurnoMcp): ServidorMcpParaAcp {
  return { nome: NOME_DO_SERVIDOR_MCP, url: registro.url, cabecalhos: [{ nome: "Authorization", valor: `Bearer ${registro.token}` }] };
}

function resultadoFalho(relatorio: string, inicio: number): ResultadoDaSubtarefa {
  return { situacao: "falhou", relatorio, tokensDeEntrada: 0, tokensDeSaida: 0, duracaoMs: Date.now() - inicio };
}
