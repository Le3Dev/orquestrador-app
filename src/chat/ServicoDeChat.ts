import { Anexo, categoriaDoTipo, ehTipoDeImagem, idDoArquivo } from "../orquestracao/Anexo";
import type { ArmazemDeAnexos } from "../orquestracao/ArmazemDeAnexos";
import type { ControleDeExecucoes } from "../orquestracao/ControleDeExecucoes";
import type { DocumentoDoPedido } from "../orquestracao/DocumentosAnexados";
import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import type { JanelaDaCota } from "../orquestracao/EventoDeOrquestracao";
import { separarPerguntasDoApp } from "../perguntas/PerguntaDoApp";
import { ConversaDoChat, SituacaoDaConversa } from "./ConversaDoChat";
import { ErroDoChat } from "./ErroDoChat";
import type { EventoDoChat, EventoDoChatRegistrado, PublicadorDoChat } from "./EventoDoChat";
import { instrucoesDoChat, mensagemParaOChat, separarAcoesDoApp } from "./InstrucoesDoChat";
import type { DadosDaMensagemDoChat, ImagemDaMensagem } from "./MensagemDoChat";
import type { EventoDoMotorDeChat, MotorDeChat, ResultadoDaResposta } from "./MotorDeChat";
import type { OrigemDaPergunta } from "./OrigemDaPergunta";
import { AlteracoesDasPreferenciasDoChat, DadosDasPreferenciasDoChat, PreferenciasDoChat } from "./PreferenciasDoChat";
import type { OrquestradorExistente, ProjetoDoChat, ProjetosDoChat } from "./ProjetosDoChat";
import type { RepositorioDoChat } from "./RepositorioDoChat";
import type { SubagenteDoChat, SubagentesDoChat } from "./SubagentesDoChat";

/** Chave do chat no controle de execuções e no armazém de anexos. */
export const ID_DO_CHAT = "chat";

export interface DependenciasDoServicoDeChat {
  repositorio: RepositorioDoChat;
  motor: MotorDeChat;
  projetos: ProjetosDoChat;
  subagentes: SubagentesDoChat;
  anexos: ArmazemDeAnexos;
  publicador: PublicadorDoChat;
  execucoes: ControleDeExecucoes;
  /** Pasta onde o processo do Claude Code roda (`<PASTA_DADOS>/chat/sessao`). */
  pastaDaSessao: string;
  /** Raiz dos projetos: leitura sempre; edição e comandos só com a autorização do usuário. */
  pastaDosProjetos: string;
  /**
   * Pasta de entrada dos artefatos do chat, absoluta
   * (`<PASTA_DADOS>/artefatos/entrada/chat`): gravar nela não depende da
   * autorização do usuário.
   */
  pastaDeArtefatos: string;
  gerarId: () => string;
  agora: () => Date;
}

/** Imagem como chega do usuário, antes de ser guardada. */
export interface ImagemRecebidaNoChat {
  nome: string;
  tipoDeMidia: string;
  conteudo: Uint8Array;
}

export interface PerguntaDoUsuario {
  texto: string;
  imagens?: readonly ImagemRecebidaNoChat[];
  /** De onde veio a pergunta, quando não foi digitada (ex.: "escuta"); vai junto na mensagem. */
  origem?: OrigemDaPergunta;
}

export interface PerguntaEnviada {
  /** A mensagem de resposta do Claude: é a que recebe os trechos ao vivo. */
  mensagemId: string;
  /** Resolve quando a resposta termina (concluída, cancelada ou com falha). Nunca rejeita. */
  conclusao: Promise<void>;
}

export interface EstadoDoChat {
  sessaoId: string;
  situacao: SituacaoDaConversa;
  /** Se o chat pode editar arquivos e rodar comandos (vale a partir da próxima pergunta). */
  alteracoesAutorizadas: boolean;
  preferencias: DadosDasPreferenciasDoChat;
  mensagens: DadosDaMensagemDoChat[];
  ultimaSequencia: number;
  cota: JanelaDaCota[] | null;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Casos de uso do chat rápido: perguntar, cancelar, limpar a conversa,
 * trocar modelo e esforço e autorizar (ou não) alterações.
 *
 * Não guarda estado: a conversa vem do repositório e a resposta em execução
 * fica no `ControleDeExecucoes`.
 */
export class ServicoDeChat {
  constructor(private readonly dependencias: DependenciasDoServicoDeChat) {}

  estado(): EstadoDoChat {
    const { repositorio } = this.dependencias;
    const conversa = repositorio.conversa();
    return {
      sessaoId: conversa.sessaoId,
      situacao: conversa.situacao,
      alteracoesAutorizadas: conversa.alteracoesAutorizadas,
      preferencias: repositorio.preferencias().paraDados(),
      mensagens: conversa.mensagens,
      ultimaSequencia: repositorio.ultimaSequencia(),
      cota: repositorio.ultimaCota(),
    };
  }

  eventosDepoisDe(sequencia: number): readonly EventoDoChatRegistrado[] {
    return this.dependencias.repositorio.lerEventos(sequencia);
  }

  /**
   * Registra a pergunta e devolve assim que ela é aceita; a resposta segue em
   * segundo plano e é acompanhada pelos eventos.
   */
  async perguntar(pergunta: PerguntaDoUsuario): Promise<PerguntaEnviada> {
    const { repositorio, execucoes, anexos, gerarId, agora } = this.dependencias;
    const conversa = repositorio.conversa();
    const imagensRecebidas = pergunta.imagens ?? [];

    const anexosDaPergunta = imagensRecebidas.map((imagem) => this.validarImagem(imagem, gerarId()));
    const imagens: ImagemDaMensagem[] = anexosDaPergunta.map((anexo) => ({
      arquivo: anexo.arquivo,
      nome: anexo.nome,
      tipoDeMidia: anexo.tipoDeMidia,
      categoria: anexo.categoria,
    }));
    const mensagemId = gerarId();
    const inicio = conversa.perguntar({
      mensagemDoUsuarioId: gerarId(),
      mensagemDoClaudeId: mensagemId,
      texto: pergunta.texto,
      imagens,
      agora: agora(),
      ...(pergunta.origem === undefined ? {} : { origem: pergunta.origem }),
    });
    // Valem do começo ao fim desta resposta, mesmo que o usuário as troque no meio.
    const preferencias = repositorio.preferencias();
    const alteracoesAutorizadas = conversa.alteracoesAutorizadas;
    // O sinal nasce antes de qualquer espera: um cancelamento que chegue
    // enquanto a pergunta é gravada já encontra a execução registrada.
    const sinal = execucoes.iniciar(ID_DO_CHAT);
    this.publicar(inicio);

    try {
      for (const [indice, anexo] of anexosDaPergunta.entries()) {
        await anexos.guardar(ID_DO_CHAT, anexo, imagensRecebidas[indice]?.conteudo ?? new Uint8Array());
      }
      await repositorio.salvar(conversa);
    } catch (erro) {
      execucoes.encerrar(ID_DO_CHAT);
      this.publicar(conversa.falhar(`Não foi possível gravar a pergunta: ${descreverErro(erro)}`, null));
      await repositorio.salvar(conversa).catch(() => undefined);
      throw erro;
    }

    const conclusao = this.responder(conversa, mensagemId, imagens, preferencias, alteracoesAutorizadas, sinal).finally(
      () => execucoes.encerrar(ID_DO_CHAT),
    );
    return { mensagemId, conclusao };
  }

  async cancelar(): Promise<void> {
    const { repositorio, execucoes } = this.dependencias;
    const conversa = repositorio.conversa();
    if (conversa.respostaEmAndamento === null) {
      throw new ErroDoChat("sem_resposta_em_andamento", "Não há resposta em andamento.");
    }
    if (execucoes.cancelar(ID_DO_CHAT)) {
      // A resposta é encerrada por `responder`, quando o motor terminar de parar.
      return;
    }
    // Resposta marcada como em andamento sem processo por trás: só falta registrar.
    this.publicar(conversa.cancelar());
    await repositorio.salvar(conversa);
  }

  /**
   * Começa uma conversa nova ("/clear"): arquiva o histórico atual e faz a
   * próxima pergunta abrir outra sessão do Claude Code. As preferências ficam.
   */
  async limpar(): Promise<{ totalDeMensagens: number }> {
    const { repositorio, publicador, gerarId } = this.dependencias;
    const conversa = repositorio.conversa();
    if (conversa.respostaEmAndamento === null && conversa.totalDeMensagens === 0 && !conversa.sessaoIniciada) {
      return { totalDeMensagens: 0 };
    }

    // Sem espera entre limpar e arquivar: nenhum evento pode cair no meio.
    const evento = conversa.limpar(gerarId());
    const { registrado, gravacao } = repositorio.arquivarConversa(conversa, evento);
    publicador.publicar(registrado);
    await gravacao;
    return { totalDeMensagens: conversa.totalDeMensagens };
  }

  /** Vale a partir da próxima pergunta e vira o padrão das seguintes. */
  async alterarPreferencias(alteracoes: AlteracoesDasPreferenciasDoChat): Promise<DadosDasPreferenciasDoChat> {
    const { repositorio } = this.dependencias;
    const preferencias = repositorio.preferencias().com(alteracoes);
    await repositorio.salvarPreferencias(preferencias);
    this.publicar({ tipo: "preferencias_alteradas", preferencias: preferencias.paraDados() });
    return preferencias.paraDados();
  }

  /**
   * Autoriza (ou tira a autorização) o chat a editar arquivos e rodar
   * comandos. Vale a qualquer momento, inclusive durante uma resposta, e passa
   * a valer na próxima pergunta. Repetir o estado atual não gera evento.
   */
  async alterarAutorizacao(autorizado: boolean): Promise<{ autorizado: boolean }> {
    const { repositorio } = this.dependencias;
    const conversa = repositorio.conversa();
    const evento = autorizado ? conversa.autorizarAlteracoes() : conversa.revogarAlteracoes();
    if (evento !== null) {
      this.publicar(evento);
      await repositorio.salvar(conversa);
    }
    return { autorizado: conversa.alteracoesAutorizadas };
  }

  /**
   * Ao subir o servidor, nenhuma resposta pode estar de fato rodando: o
   * processo morreu junto com o servidor anterior. Devolve se havia uma.
   */
  async interromperRespostaPendente(): Promise<boolean> {
    const { repositorio } = this.dependencias;
    const conversa = repositorio.conversa();
    const evento = conversa.interromperRespostaEmAndamento();
    if (evento === null) {
      return false;
    }
    this.publicar(evento);
    await repositorio.salvar(conversa);
    return true;
  }

  private async responder(
    conversa: ConversaDoChat,
    mensagemId: string,
    imagens: readonly ImagemDaMensagem[],
    preferencias: PreferenciasDoChat,
    alteracoesAutorizadas: boolean,
    sinal: AbortSignal,
  ): Promise<void> {
    const { motor, repositorio, anexos, agora, pastaDaSessao, pastaDosProjetos, pastaDeArtefatos } = this.dependencias;
    const textoDaPergunta = conversa.perguntaEmAndamento?.texto ?? "";

    let projetos: ProjetoDoChat[] = [];
    let orquestradores: OrquestradorExistente[] = [];
    let resultado: ResultadoDaResposta | null = null;
    let erro: unknown = null;

    try {
      const contexto = await this.lerContexto();
      const imagensDaPergunta = imagens.flatMap((imagem) =>
        ehTipoDeImagem(imagem.tipoDeMidia)
          ? [{ caminho: anexos.caminhoDe(ID_DO_CHAT, imagem.arquivo), tipoDeMidia: imagem.tipoDeMidia }]
          : [],
      );
      const documentos: DocumentoDoPedido[] = await Promise.all(
        imagens
          .filter((anexo) => (anexo.categoria ?? categoriaDoTipo(anexo.tipoDeMidia)) === "documento")
          .map(async (anexo) => ({
            nome: anexo.nome,
            caminho: anexos.caminhoDe(ID_DO_CHAT, anexo.arquivo),
            caminhoDoTexto: await anexos.caminhoDoTexto(ID_DO_CHAT, idDoArquivo(anexo.arquivo)),
          })),
      );
      projetos = contexto.projetos;
      orquestradores = contexto.orquestradores;
      resultado = await motor.responder(
        {
          sessaoId: conversa.sessaoId,
          sessaoIniciada: conversa.sessaoIniciada,
          mensagem: mensagemParaOChat(
            textoDaPergunta,
            {
              agora: agora(),
              pastaDosProjetos,
              projetos: contexto.projetos,
              orquestradores: contexto.orquestradores,
              subagentesProntos: contexto.subagentesProntos,
              alteracoesAutorizadas,
              pastaDeArtefatos,
              permitirArtefatosOnline: preferencias.permitirArtefatosOnline,
            },
            documentos,
          ),
          instrucoes: instrucoesDoChat(),
          imagens: imagensDaPergunta,
          pastaDasImagens: imagens.length > 0 ? anexos.pastaDe(ID_DO_CHAT) : null,
          pastaDaSessao,
          pastaDosProjetos,
          pastaDeArtefatos,
          modelo: preferencias.modelo,
          esforco: preferencias.esforco,
          permitirArtefatosOnline: preferencias.permitirArtefatosOnline,
          alteracoesAutorizadas,
        },
        (evento) => this.observar(conversa, mensagemId, evento),
        sinal,
      );
    } catch (falha) {
      erro = falha;
    }

    try {
      if (sinal.aborted) {
        this.publicar(conversa.cancelar());
      } else if (resultado !== null && resultado.sucesso) {
        const semAcoes = separarAcoesDoApp(resultado.resposta, projetos, orquestradores);
        const { texto, perguntas, avisos } = separarPerguntasDoApp(semAcoes.texto);
        this.publicar(
          conversa.concluir(
            texto,
            semAcoes.acoes,
            [...resultado.avisos, ...semAcoes.avisos, ...avisos],
            resultado.uso,
            resultado.autorizacaoPendente,
            perguntas,
          ),
        );
      } else {
        const motivo = resultado !== null && !resultado.sucesso ? resultado.motivo : descreverErro(erro);
        this.publicar(conversa.falhar(motivo, resultado !== null && !resultado.sucesso ? resultado.uso : null));
      }
      await repositorio.salvar(conversa);
    } catch (falha) {
      console.error(`[chat] Não foi possível encerrar a resposta ${mensagemId}:`, falha);
    }
  }

  /** Sem a lista, o chat ainda responde — só não consegue validar ações. */
  private async lerContexto(): Promise<{
    projetos: ProjetoDoChat[];
    orquestradores: OrquestradorExistente[];
    subagentesProntos: SubagenteDoChat[];
  }> {
    const { projetos, subagentes } = this.dependencias;
    const [listaDeProjetos, orquestradores, subagentesProntos] = await Promise.all([
      projetos.listarProjetos().catch((erro: unknown) => {
        console.warn("[chat] Não foi possível listar os projetos:", descreverErro(erro));
        return [];
      }),
      projetos.listarOrquestradores().catch((erro: unknown) => {
        console.warn("[chat] Não foi possível listar os orquestradores:", descreverErro(erro));
        return [];
      }),
      subagentes.listarSubagentesProntos().catch((erro: unknown) => {
        console.warn("[chat] Não foi possível listar os subagentes prontos:", descreverErro(erro));
        return [];
      }),
    ]);
    return { projetos: listaDeProjetos, orquestradores, subagentesProntos };
  }

  private observar(conversa: ConversaDoChat, mensagemId: string, evento: EventoDoMotorDeChat): void {
    const { publicador, repositorio } = this.dependencias;
    try {
      if (conversa.registrarSessaoIniciada()) {
        // Gravado já: se o servidor cair no meio, a próxima pergunta precisa
        // retomar a sessão, não criar outra com o mesmo id.
        repositorio
          .salvar(conversa)
          .catch((erro: unknown) => console.error("[chat] Falha ao gravar a sessão:", erro));
      }

      switch (evento.tipo) {
        case "sessao_aberta":
          return; // só marca a sessão como iniciada (acima)
        case "trecho_da_resposta":
          if (conversa.acrescentarTrecho(evento.texto)) {
            publicador.sinalizar({ tipo: "trecho", mensagemId, texto: evento.texto });
          }
          return;
        case "ferramenta_do_chat":
          publicador.sinalizar({
            tipo: "atividade",
            mensagemId,
            ferramenta: evento.ferramenta,
            detalhe: evento.detalhe,
          });
          return;
        case "uso_da_cota":
          this.publicar({ tipo: "uso_da_cota", janelas: evento.janelas });
          return;
        default:
          return;
      }
    } catch (erro) {
      console.warn(`[chat] Evento do motor ignorado:`, descreverErro(erro));
    }
  }

  private validarImagem(imagem: ImagemRecebidaNoChat, id: string): Anexo {
    try {
      return Anexo.de({
        id,
        nome: imagem.nome,
        tipoDeMidia: imagem.tipoDeMidia,
        tamanhoEmBytes: imagem.conteudo.byteLength,
      });
    } catch (erro) {
      if (erro instanceof ErroDeOrquestracao) {
        throw new ErroDoChat("dados_invalidos", erro.message);
      }
      throw erro;
    }
  }

  private publicar(evento: EventoDoChat): void {
    const registrado = this.dependencias.repositorio.anexarEvento(evento);
    this.dependencias.publicador.publicar(registrado);
  }
}
