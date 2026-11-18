import path from "node:path";

import { EventoDoMotor, UsoDoTurno } from "../../orquestracao/EventoDeOrquestracao";
import { Plataforma } from "../../orquestracao/InstrucoesDoOrquestrador";
import { rotuloDoMotor } from "../../orquestracao/Motor";
import { ABORTO_POR_SILENCIO, MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { ambienteSemSessaoPai } from "../claudecode/ArgumentosDoClaudeCode";
import { INTERVALO_DOS_AVISOS_DE_LINHA_MS, limitarAvisos, MOTIVO_DO_SILENCIO, prepararPastaDeArtefatos } from "../claudecode/MotorClaudeCodeCli";
import { SondaDeEndereco, sondarEnderecoLocal } from "../claudecode/SondaDeEnderecoLocal";
import { RegistroDoTurnoMcp } from "../mcp/ServidorMcpDoApp";
import {
  abrirTurnoNoServidorMcp,
  FERRAMENTAS_DO_APP_POR_PADRAO,
  FerramentasDoAppNoTurno,
  mensagemDoErro,
  PonteParaOServidorMcp,
  somarConsumoDosSubagentes,
} from "../motores/ApoioDosMotores";
import { falhaDoMotor } from "../motores/ClassificadorDeFalhasDosMotores";
import { ConferenciaDeEnderecos, DetectorDeEnderecosLocais } from "../motores/DetectorDeEnderecosLocais";
import { Objeto, objeto, texto, textos } from "../motores/LeituraDeJson";
import {
  AcaoDoAgente,
  ContextoDePermissao,
  contextoDePermissaoDoPedido,
  decidirPermissao,
  permiteEditarOProjeto,
} from "../motores/PoliticaDePermissao";
import { ErroJsonRpc, ERRO_METODO_INEXISTENTE, ProcessoEncerradoError } from "../motores/ProcessoJsonRpc";
import { mensagemDoTurno, regrasDoOrquestrador, regrasDoSubagente, textoDaSubtarefa } from "../motores/PromptDoTurno";
import { RegistroDeTurnosDoApp } from "../motores/RegistroDeTurnosDoApp";
import {
  ConversorParaSubagente,
  ExecucaoDeSubtarefa,
  ExecutorDeSubtarefa,
  ResultadoDaSubtarefa,
} from "../motores/SubtarefaDoApp";
import { AcompanhamentoDeProcessos } from "../sistema/RastreadorDeProcessosDeixados";
import { RegistroDeProcessos } from "../sistema/RegistroDeProcessos";
import { AdaptadorDeEventosDoCodex, causaDoErroDoCodex, erroDeFaltaDeLoginDoCodex } from "./AdaptadorDeEventosDoCodex";
import {
  configuracaoDaThread,
  modoDoSandbox,
  politicaDeSandboxDoTurno,
  POLITICA_DE_APROVACAO_DO_CODEX,
  VARIAVEL_DO_TOKEN_MCP,
} from "./ArgumentosDoCodex";
import { FachadaCodex, ParametrosDaThread, ThreadDoCodex } from "./FachadaCodex";

/** Quanto esperar o Codex reagir ao `turn/interrupt` antes de derrubar o processo. */
export const ESPERA_DA_INTERRUPCAO_MS = 3_000;

export interface DependenciasDoMotorCodex {
  /**
   * O executável do Codex, ou quem o acha (resolvido a cada turno: quem instala o
   * CLI com o app aberto não precisa reiniciá-lo). Os argumentos que vêm antes do
   * subcomando vão em `argumentosIniciais`; `app-server` já é acrescentado.
   */
  executavel: string | (() => string);
  argumentosIniciais?: readonly string[];
  servidorMcp?: PonteParaOServidorMcp | null;
  ferramentasDoTurno?: FerramentasDoAppNoTurno;
  turnos?: RegistroDeTurnosDoApp;
  registro?: RegistroDeProcessos | null;
  acompanhamento?: AcompanhamentoDeProcessos | null;
  sondar?: SondaDeEndereco;
  plataforma?: Plataforma;
  versaoDoApp?: string;
}

/** O que uma sessão do Codex precisa: tanto o turno do Orquestrador quanto uma subtarefa. */
interface ParametrosDaSessao {
  papel: "orquestrador" | "subagente";
  pedido: PedidoDeTurno;
  contexto: ContextoDePermissao;
  modelo: string;
  /** As regras fixas do papel, como instruções de desenvolvedor da thread. */
  regras: string;
  texto: string;
  caminhosDeImagens: readonly string[];
  /** A thread a retomar; nulo abre uma nova. */
  threadParaRetomar: string | null;
  servidorMcp: RegistroDoTurnoMcp | null;
  dono: { orquestradorId: string; sessaoId: string };
  aoObservar: (evento: EventoDoMotor) => void;
  sinal: AbortSignal;
  aoReceberLinha?: () => void;
}

const COMO_ENTRAR = "codex login";

function resolver<T>(): { promessa: Promise<T>; resolver: (valor: T) => void } {
  let resolverDaPromessa: (valor: T) => void = () => undefined;
  const promessa = new Promise<T>((aoResolver) => {
    resolverDaPromessa = aoResolver;
  });
  return { promessa, resolver: resolverDaPromessa };
}

/**
 * `MotorDeAgentes` sobre o Codex pelo protocolo dele, o `codex app-server`: um
 * processo por turno, com o login do usuário (ChatGPT ou chave de API que ele
 * já configurou no Codex).
 *
 * Sessão: o primeiro turno abre uma thread (`thread/start`) e devolve o id em
 * `sessaoDoMotor`; os seguintes a retomam (`thread/resume`; o Codex guarda a
 * conversa em `~/.codex/sessions`). Se a thread não existe mais, abre uma nova,
 * avisa o agente no prompt e devolve o id novo.
 *
 * Prompt: as regras do Orquestrador vão em `developerInstructions` da thread
 * (a cada abertura ou retomada); a mensagem do turno, com o bloco
 * `<configuracao-do-pedido>` e o contexto da troca de motor, é o `turn/start`.
 *
 * Permissões: o app abre a thread com `approvalPolicy: "untrusted"`, então o
 * Codex pede aprovação para tudo o que não é leitura conhecida, e cada pedido
 * passa pela política do app (`decidirPermissao`), a mesma do Claude Code. O
 * sandbox do Codex (`read-only` ou `workspace-write`) é a segunda barreira.
 *
 * Cancelamento: `turn/interrupt` e, se o Codex não terminar em
 * `ESPERA_DA_INTERRUPCAO_MS`, derruba a árvore de processos.
 */
export class MotorCodex implements MotorDeAgentes, ExecutorDeSubtarefa {
  private readonly sondar: SondaDeEndereco;
  private readonly plataforma: Plataforma;

  constructor(private readonly dependencias: DependenciasDoMotorCodex) {
    this.sondar = dependencias.sondar ?? sondarEnderecoLocal;
    this.plataforma = dependencias.plataforma ?? "unix";
  }

  async executarTurno(
    pedidoRecebido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
    aoReceberLinha?: () => void,
  ): Promise<ResultadoDoTurno> {
    if (pedidoRecebido.motor !== "codex") {
      return {
        sucesso: false,
        motivo: `Este motor executa só o Codex; o pedido era para o ${rotuloDoMotor(pedidoRecebido.motor)}.`,
        uso: null,
      };
    }
    let pedido: PedidoDeTurno;
    try {
      pedido = { ...pedidoRecebido, pastaDeArtefatos: await prepararPastaDeArtefatos(pedidoRecebido.pastaDeArtefatos) };
    } catch (erro) {
      return { sucesso: false, motivo: `Não foi possível preparar a pasta de artefatos: ${mensagemDoErro(erro)}`, uso: null };
    }

    let registroMcp: RegistroDoTurnoMcp | null = null;
    try {
      registroMcp = abrirTurnoNoServidorMcp(
        this.dependencias.servidorMcp,
        (this.dependencias.ferramentasDoTurno ?? FERRAMENTAS_DO_APP_POR_PADRAO)(pedido),
        pedido.orquestradorId,
      );
      const resultado = await this.executarSessao({
        papel: "orquestrador",
        pedido,
        contexto: contextoDePermissaoDoPedido(pedido),
        modelo: pedido.configuracao.modeloDoOrquestrador,
        regras: regrasDoOrquestrador(pedido),
        texto: mensagemDoTurno(pedido, this.plataforma),
        caminhosDeImagens: pedido.anexos.filter((anexo) => anexo.categoria === "imagem").map((anexo) => anexo.caminho),
        threadParaRetomar: pedido.sessaoIniciada && pedido.sessaoId !== "" ? pedido.sessaoId : null,
        servidorMcp: registroMcp,
        dono: { orquestradorId: pedido.orquestradorId, sessaoId: pedido.sessaoId },
        aoObservar,
        sinal,
        ...(aoReceberLinha === undefined ? {} : { aoReceberLinha: limitarAvisos(aoReceberLinha, INTERVALO_DOS_AVISOS_DE_LINHA_MS) }),
      });
      return somarConsumoDosSubagentes(this.dependencias.turnos, pedido, resultado);
    } catch (erro) {
      return { sucesso: false, motivo: `Falha ao executar o turno no Codex: ${mensagemDoErro(erro)}`, uso: null };
    } finally {
      registroMcp?.encerrar();
    }
  }

  /** Roda uma subtarefa delegada: uma thread efêmera nova, com as regras do Subagente, sem ferramentas do app. */
  async executarSubtarefa(execucao: ExecucaoDeSubtarefa): Promise<ResultadoDaSubtarefa> {
    const inicio = Date.now();
    let pedido: PedidoDeTurno;
    try {
      pedido = { ...execucao.pedido, pastaDeArtefatos: await prepararPastaDeArtefatos(execucao.pedido.pastaDeArtefatos) };
    } catch (erro) {
      return {
        situacao: "falhou",
        relatorio: `Não foi possível preparar a pasta de artefatos: ${mensagemDoErro(erro)}`,
        tokensDeEntrada: 0,
        tokensDeSaida: 0,
        duracaoMs: Date.now() - inicio,
      };
    }
    const conversor = new ConversorParaSubagente(execucao.subagenteId, inicio);
    const resultado = await this.executarSessao({
      papel: "subagente",
      pedido,
      contexto: contextoDePermissaoDoPedido(pedido),
      modelo: pedido.configuracao.modeloDosSubagentes,
      regras: regrasDoSubagente(pedido, execucao.especialidade, this.plataforma),
      texto: textoDaSubtarefa(execucao.subtarefa),
      caminhosDeImagens: [],
      threadParaRetomar: null,
      servidorMcp: null,
      dono: { orquestradorId: pedido.orquestradorId, sessaoId: execucao.subagenteId },
      aoObservar: (evento) => {
        for (const convertido of conversor.converter(evento)) {
          execucao.aoProgredir(convertido);
        }
      },
      sinal: execucao.sinal,
    });
    const tokens = { tokensDeEntrada: resultado.uso?.tokensDeEntrada ?? 0, tokensDeSaida: resultado.uso?.tokensDeSaida ?? 0 };
    const duracaoMs = Date.now() - inicio;
    if (resultado.sucesso) {
      return { situacao: "concluido", relatorio: resultado.resposta, duracaoMs, ...tokens };
    }
    return { situacao: execucao.sinal.aborted ? "cancelado" : "falhou", relatorio: resultado.motivo, duracaoMs, ...tokens };
  }

  // ── A thread ────────────────────────────────────────────────────────────

  private async executarSessao(parametros: ParametrosDaSessao): Promise<ResultadoDoTurno> {
    const { sinal, contexto, pedido } = parametros;
    const inicio = Date.now();
    const uso = (tokensDeEntrada = 0, tokensDeSaida = 0): UsoDoTurno => ({
      duracaoMs: Date.now() - inicio,
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
    const adaptador = new AdaptadorDeEventosDoCodex({
      detector,
      nomeDoTerminal: this.plataforma === "windows" ? "PowerShell" : "Bash",
    });
    const emitir = (eventos: readonly EventoDoMotor[]): void => {
      for (const evento of eventos) {
        parametros.aoObservar(evento);
      }
      conferencia.conferirCitados();
    };

    let threadId: string | null = null;
    let turnoId: string | null = null;
    const fim = resolver<void>();

    const ambiente = ambienteSemSessaoPai(process.env);
    if (parametros.servidorMcp !== null) {
      ambiente[VARIAVEL_DO_TOKEN_MCP] = parametros.servidorMcp.token;
    }
    const fachada = new FachadaCodex(
      {
        executavel: typeof this.dependencias.executavel === "function" ? this.dependencias.executavel() : this.dependencias.executavel,
        argumentos: [...(this.dependencias.argumentosIniciais ?? []), "app-server"],
        pasta: pedido.pastaDeTrabalho.caminho,
        ambiente,
        dono: parametros.dono,
        informacoesDoCliente: {
          nome: "orquestrador-de-agentes",
          titulo: "Orquestrador de Agentes",
          versao: this.dependencias.versaoDoApp ?? "1.0.0",
        },
      },
      {
        aoNotificar: (metodo, parametrosDaNotificacao) => {
          // Outra thread (um subagente do próprio Codex) não é o nosso turno.
          const daThread = texto(parametrosDaNotificacao, "threadId");
          if (threadId !== null && daThread !== "" && daThread !== threadId) {
            return;
          }
          emitir(adaptador.traduzir(metodo, parametrosDaNotificacao));
          if (metodo === "turn/completed") {
            fim.resolver();
          }
          if (adaptador.faltaDeLogin && !interrompidoPorFaltaDeLogin && threadId !== null && turnoId !== null) {
            interrompidoPorFaltaDeLogin = true;
            interromperOTurno();
          }
        },
        aoPedir: (metodo, parametrosDoPedido) => this.responderAoServidor(metodo, parametrosDoPedido, parametros, adaptador),
        ...(parametros.aoReceberLinha === undefined ? {} : { aoReceberLinha: parametros.aoReceberLinha }),
      },
      this.dependencias.registro ?? null,
      this.dependencias.acompanhamento ?? null,
    );
    void fachada.saida.then(() => fim.resolver());

    let temporizadorDaInterrupcao: NodeJS.Timeout | undefined;
    let interrompidoPorFaltaDeLogin = false;
    /** `turn/interrupt` e, se o Codex não terminar a tempo, derruba o processo. */
    const interromperOTurno = (): void => {
      if (threadId === null || turnoId === null) {
        fachada.derrubar();
        return;
      }
      fachada.interromper(threadId, turnoId).catch(() => fachada.derrubar());
      temporizadorDaInterrupcao = setTimeout(() => fachada.derrubar(), ESPERA_DA_INTERRUPCAO_MS);
      temporizadorDaInterrupcao.unref();
    };
    const aoAbortar = (): void => {
      if (sinal.reason === ABORTO_POR_SILENCIO) {
        fachada.derrubar();
        return;
      }
      interromperOTurno();
    };
    sinal.addEventListener("abort", aoAbortar, { once: true });

    let sessaoDoMotor: string | undefined;
    const comSessao = (): { sessaoDoMotor?: string } => (sessaoDoMotor === undefined ? {} : { sessaoDoMotor });
    try {
      await fachada.inicializar();
      const modelo = parametros.modelo === "padrao" ? {} : { model: parametros.modelo };
      const aThread: ParametrosDaThread = {
        cwd: pedido.pastaDeTrabalho.caminho,
        approvalPolicy: POLITICA_DE_APROVACAO_DO_CODEX,
        sandbox: modoDoSandbox(contexto),
        developerInstructions: parametros.regras,
        config: configuracaoDaThread(parametros.servidorMcp),
        ...modelo,
        ...(parametros.papel === "subagente" ? { ephemeral: true } : {}),
      };
      let thread: ThreadDoCodex | null = null;
      let aviso = "";
      if (parametros.threadParaRetomar !== null) {
        try {
          thread = await fachada.retomarThread(parametros.threadParaRetomar, aThread);
        } catch (erro) {
          if (!(erro instanceof ErroJsonRpc)) {
            throw erro;
          }
          aviso = `A conversa anterior deste motor não pôde ser retomada (${erro.message}); a conversa continua sem a memória dela.`;
        }
      }
      thread ??= await fachada.iniciarThread(aThread);
      threadId = thread.threadId;
      sessaoDoMotor = thread.threadId;
      parametros.aoObservar({ tipo: "sessao_iniciada", sessaoDoMotor: thread.threadId });

      turnoId = await fachada.iniciarTurno(thread.threadId, {
        texto: aviso === "" ? parametros.texto : `(${aviso})\n\n${parametros.texto}`,
        caminhosDeImagens: parametros.caminhosDeImagens,
        cwd: pedido.pastaDeTrabalho.caminho,
        approvalPolicy: POLITICA_DE_APROVACAO_DO_CODEX,
        sandboxPolicy: politicaDeSandboxDoTurno(contexto),
        ...modelo,
      });
      if (sinal.aborted) {
        aoAbortar();
      }
      await fim.promessa;
      fachada.resultadoChegou();

      const respostaFinal = adaptador.respostaFinal;
      detector.citar(respostaFinal, "resposta");
      conferencia.conferirCitados();
      await conferencia.aguardar();
      const consumo = adaptador.uso;
      const usoDoTurno = uso(consumo.tokensDeEntrada, consumo.tokensDeSaida);
      const desfecho = adaptador.fimDoTurno;

      if (sinal.aborted && sinal.reason === ABORTO_POR_SILENCIO) {
        return { sucesso: false, causa: "silencio", motivo: MOTIVO_DO_SILENCIO, uso: usoDoTurno, ...comSessao() };
      }
      if (sinal.aborted) {
        return { sucesso: false, motivo: "Turno cancelado.", uso: usoDoTurno, ...comSessao() };
      }
      if (adaptador.faltaDeLogin) {
        return this.falhaDoTurno(adaptador.ultimoErro, adaptador, fachada.erroPadrao, usoDoTurno, sessaoDoMotor);
      }
      if (desfecho === null) {
        // O processo saiu sem concluir o turno.
        return this.falhaDoProcesso(fachada.erroPadrao, usoDoTurno, sessaoDoMotor);
      }
      if (desfecho.status === "completed") {
        return { sucesso: true, resposta: respostaFinal, uso: usoDoTurno, ...comSessao() };
      }
      if (desfecho.status === "interrupted") {
        return { sucesso: false, motivo: "Turno cancelado.", uso: usoDoTurno, ...comSessao() };
      }
      return this.falhaDoTurno(desfecho.erro ?? adaptador.ultimoErro, adaptador, fachada.erroPadrao, usoDoTurno, sessaoDoMotor);
    } catch (erro) {
      if (sinal.aborted) {
        return sinal.reason === ABORTO_POR_SILENCIO
          ? { sucesso: false, causa: "silencio", motivo: MOTIVO_DO_SILENCIO, uso: uso(), ...comSessao() }
          : { sucesso: false, motivo: "Turno cancelado.", uso: uso(), ...comSessao() };
      }
      const mensagem = mensagemDoErro(erro);
      if (/ENOENT/.test(mensagem) && erro instanceof ProcessoEncerradoError) {
        return {
          sucesso: false,
          motivo: `O Codex não foi encontrado nesta máquina. Instale-o (npm install -g @openai/codex), rode "${COMO_ENTRAR}" e tente de novo.`,
          uso: uso(),
          causa: "outro",
        };
      }
      return falhaDoMotor("codex", `O Codex falhou: ${mensagem}`, [mensagem, fachada.erroPadrao], uso(), null, sessaoDoMotor);
    } finally {
      sinal.removeEventListener("abort", aoAbortar);
      if (temporizadorDaInterrupcao !== undefined) {
        clearTimeout(temporizadorDaInterrupcao);
      }
      await fachada.encerrarComCalma();
    }
  }

  private falhaDoProcesso(
    erroPadrao: string,
    uso: UsoDoTurno,
    sessaoDoMotor: string | undefined,
  ): Extract<ResultadoDoTurno, { sucesso: false }> {
    const motivo = `O Codex encerrou antes de concluir o turno.${erroPadrao === "" ? "" : ` ${erroPadrao.slice(0, 600)}`}`;
    return falhaDoMotor("codex", motivo, [erroPadrao], uso, null, sessaoDoMotor);
  }

  private falhaDoTurno(
    erro: Objeto | null,
    adaptador: AdaptadorDeEventosDoCodex,
    erroPadrao: string,
    uso: UsoDoTurno,
    sessaoDoMotor: string | undefined,
  ): Extract<ResultadoDoTurno, { sucesso: false }> {
    if (erroDeFaltaDeLoginDoCodex(erro)) {
      return {
        sucesso: false,
        motivo: `O Codex não está logado. Rode "${COMO_ENTRAR}" no terminal e tente de novo.`,
        uso,
        causa: "outro",
        ...(sessaoDoMotor === undefined ? {} : { sessaoDoMotor }),
      };
    }
    const mensagem = texto(erro, "message");
    const detalhes = texto(erro, "additionalDetails");
    const motivoBase = mensagem === "" ? "O Codex terminou o turno com erro." : `O Codex terminou o turno com erro: ${mensagem}`;
    return falhaDoMotor(
      "codex",
      motivoBase,
      [mensagem, detalhes, erroPadrao],
      uso,
      causaDoErroDoCodex(erro, adaptador.pistaDeLimite),
      sessaoDoMotor,
    );
  }

  // ── Pedidos do servidor ─────────────────────────────────────────────────

  private async responderAoServidor(
    metodo: string,
    pedido: unknown,
    parametros: ParametrosDaSessao,
    adaptador: AdaptadorDeEventosDoCodex,
  ): Promise<unknown> {
    const pasta = parametros.pedido.pastaDeTrabalho.caminho;
    const { contexto } = parametros;
    const julgar = (acao: AcaoDoAgente, ferramenta: string, detalhe: string): { permitido: boolean; motivo: string } => {
      const decisao = decidirPermissao(acao, contexto);
      if (decisao.permitido) {
        return { permitido: true, motivo: "" };
      }
      parametros.aoObservar({ tipo: "permissao_negada", ferramenta, detalhe: detalhe.slice(0, 160) });
      return { permitido: false, motivo: decisao.motivo };
    };
    const terminal = this.plataforma === "windows" ? "PowerShell" : "Bash";
    /** Alteração sem caminho conhecido: vale a pasta de trabalho, onde o sandbox já a limita; sem edição, nada. */
    const caminhosDaAlteracao = (informados: readonly string[]): string[] => {
      const absolutos = informados.filter((caminho) => caminho !== "").map((caminho) => path.resolve(pasta, caminho));
      return absolutos.length > 0 ? absolutos : permiteEditarOProjeto(contexto) ? [pasta] : [];
    };

    switch (metodo) {
      case "item/commandExecution/requestApproval": {
        const comando = texto(pedido, "command");
        const decisao = julgar({ tipo: "comando", comando }, terminal, comando);
        return { decision: decisao.permitido ? "accept" : "decline" };
      }
      case "execCommandApproval": {
        const comando = textos(pedido, "command").join(" ");
        const decisao = julgar({ tipo: "comando", comando }, terminal, comando);
        return { decision: decisao.permitido ? "approved" : { denied: { rejection: decisao.motivo } } };
      }
      case "item/fileChange/requestApproval": {
        const conhecidos = adaptador.caminhosDoItem(texto(pedido, "itemId"));
        const raiz = texto(pedido, "grantRoot");
        const caminhos = caminhosDaAlteracao([...conhecidos, ...(raiz === "" ? [] : [raiz])]);
        const decisao = julgar({ tipo: "escrita", caminhos }, "Edit", caminhos[0] ?? "");
        return { decision: decisao.permitido ? "accept" : "decline" };
      }
      case "applyPatchApproval": {
        const raiz = texto(pedido, "grantRoot");
        const caminhos = caminhosDaAlteracao([...Object.keys(objeto(pedido, "fileChanges")), ...(raiz === "" ? [] : [raiz])]);
        const decisao = julgar({ tipo: "escrita", caminhos }, "Edit", caminhos[0] ?? "");
        return { decision: decisao.permitido ? "approved" : { denied: { rejection: decisao.motivo } } };
      }
      case "item/permissions/requestApproval":
        // O agente pede mais permissões que as do sandbox do turno: o app não amplia nada.
        parametros.aoObservar({ tipo: "permissao_negada", ferramenta: "Permissões", detalhe: texto(pedido, "reason").slice(0, 160) });
        return { permissions: {}, scope: "turn" };
      case "mcpServer/elicitation/request":
        return { action: "decline" };
      case "item/tool/requestUserInput":
        // As perguntas ao usuário vão pelos blocos do app, na resposta final.
        return { answers: {} };
      case "item/tool/call":
        return { contentItems: [], success: false };
      default:
        throw new ErroJsonRpc(`Método não suportado pelo app: ${metodo}`, ERRO_METODO_INEXISTENTE, undefined);
    }
  }
}
