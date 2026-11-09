import type {
  ArquivoDoModeloDeCanvas,
  ClassificacaoDaEscuta,
  ConsumoDoOrquestrador,
  ConteudoDoArquivo,
  ConteudoDoModeloDeCanvas,
  DadosDaConfiguracao,
  DadosDaNota,
  DadosDaPredefinicao,
  DadosDasPreferencias,
  DadosDoModeloDeCanvas,
  DadosDoShell,
  EsforcosHerdados,
  EstadoDoChat,
  ListagemDaPasta,
  ModeloClaude,
  ModoDoTurno,
  NavegacaoDePastas,
  NomeDaPredefinicao,
  NovoShell,
  OrigemDaPergunta,
  PastaDeProjeto,
  PedidoDeClassificacaoDaEscuta,
  PedidoDeMelhoria,
  PreferenciasDoChat,
  PreviaDoPrompt,
  PromptMelhorado,
  ResumoDoOrquestrador,
  SaudeDoServidor,
  TipoDeImagem,
} from "./tipos";

function extrairMensagem(corpo: unknown): string | null {
  if (typeof corpo === "object" && corpo !== null && "erro" in corpo && typeof corpo.erro === "string") {
    return corpo.erro;
  }
  return null;
}

/** O servidor respondeu com erro: a mensagem preparada para o usuário e o status HTTP. */
export class ErroDaApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
    this.name = "ErroDaApi";
  }
}

/**
 * Chama a API e devolve o corpo já decodificado. Em caso de erro, lança um
 * `ErroDaApi` com a mensagem que o servidor preparou para o usuário.
 */
async function requisitar<Resposta>(caminho: string, opcoes: RequestInit = {}): Promise<Resposta> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, {
      ...opcoes,
      headers: { "Content-Type": "application/json", ...opcoes.headers },
    });
  } catch {
    throw new Error("Não foi possível falar com o servidor. Feche e abra o Orquestrador de novo.");
  }

  const corpo: unknown = resposta.status === 204 ? null : await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new ErroDaApi(extrairMensagem(corpo) ?? `O servidor respondeu com erro ${resposta.status}.`, resposta.status);
  }
  return corpo as Resposta;
}

export function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Imagem pronta para envio: o conteúdo vai em base64 dentro do JSON da mensagem. */
export interface ImagemParaEnvio {
  nome: string;
  tipoDeMidia: TipoDeImagem;
  base64: string;
}

/**
 * Uma nota, prévia ou artefato que o usuário ligou ao terminal no canvas: vai
 * no próximo pedido como contexto. Nota leva o texto (cortado); prévia, o
 * endereço; artefato, o arquivo na pasta de entrada (`chat/<arquivo>` ou
 * `orquestradores/<id>/<arquivo>`), que o servidor troca pelo caminho no disco.
 */
export interface ItemLigadoParaEnvio {
  tipo: "nota" | "previa" | "artefato";
  titulo: string;
  conteudo?: string;
  url?: string;
  caminho?: string;
}

/** O corpo só leva `itensLigados` quando há algum: sem itens, o pedido é igual ao de antes. */
function comItensLigados(itensLigados: readonly ItemLigadoParaEnvio[] | undefined): { itensLigados?: readonly ItemLigadoParaEnvio[] } {
  return itensLigados !== undefined && itensLigados.length > 0 ? { itensLigados } : {};
}

export interface NovoOrquestrador extends DadosDaConfiguracao {
  nome: string;
  pastaDeTrabalho: string;
}

/** O que se cria ou altera numa nota; o que fica de fora não muda (na criação: "Nova nota" e ""). */
export interface AlteracaoDaNota {
  titulo?: string;
  texto?: string;
}

export const api = {
  listarPastas: () => requisitar<{ raiz: string; pastas: PastaDeProjeto[] }>("/pastas"),

  /**
   * Navega pelo computador para escolher uma pasta qualquer; sem `caminho`, parte da raiz dos projetos.
   * `estrito`: caminho digitado à mão; se não existir ou não for pasta, falha com a mensagem do servidor
   * (sem ele, o servidor volta em silêncio para a raiz).
   */
  navegarPastas: (caminho?: string, opcoes: { estrito?: boolean } = {}) => {
    const parametros = new URLSearchParams();
    if (caminho !== undefined) {
      parametros.set("caminho", caminho);
    }
    if (opcoes.estrito === true) {
      parametros.set("estrito", "1");
    }
    const busca = parametros.toString();
    return requisitar<NavegacaoDePastas>(`/pastas/navegar${busca !== "" ? `?${busca}` : ""}`);
  },

  listarOrquestradores: () => requisitar<ResumoDoOrquestrador[]>("/orquestradores"),

  /** O consumo medido de cada orquestrador na conversa atual, do maior índice de custo para o menor. */
  lerConsumoDosOrquestradores: () => requisitar<ConsumoDoOrquestrador[]>("/consumo-dos-orquestradores"),

  criarOrquestrador: (dados: NovoOrquestrador) =>
    requisitar<ResumoDoOrquestrador>("/orquestradores", { method: "POST", body: JSON.stringify(dados) }),

  /** Troca o nome (1 a 60 caracteres, aparado); devolve o orquestrador atualizado. */
  renomearOrquestrador: (id: string, nome: string) =>
    requisitar<ResumoDoOrquestrador>(`/orquestradores/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ nome }),
    }),

  alterarConfiguracao: (id: string, configuracao: Partial<DadosDaConfiguracao>) =>
    requisitar<ResumoDoOrquestrador>(`/orquestradores/${encodeURIComponent(id)}/configuracao`, {
      method: "PATCH",
      body: JSON.stringify(configuracao),
    }),

  listarPredefinicoes: () => requisitar<DadosDaPredefinicao[]>("/predefinicoes"),

  /** Aplica uma predefinição (ex.: modo econômico) à configuração; devolve o resumo atualizado. */
  aplicarPredefinicao: (id: string, predefinicao: NomeDaPredefinicao) =>
    requisitar<ResumoDoOrquestrador>(`/orquestradores/${encodeURIComponent(id)}/configuracao/predefinicao`, {
      method: "POST",
      body: JSON.stringify({ predefinicao }),
    }),

  /** O esforço que o Claude Code usaria em "padrao" para os modelos salvos deste Orquestrador. */
  lerEsforcoHerdadoDoOrquestrador: (id: string) =>
    requisitar<EsforcosHerdados>(`/orquestradores/${encodeURIComponent(id)}/esforco-herdado`),

  /** O esforço que o Claude Code usaria em "padrao" para estes modelos, nesta pasta (formulário de criação). */
  lerEsforcoHerdado: (modeloDoOrquestrador: ModeloClaude, modeloDosSubagentes: ModeloClaude, pasta: string) => {
    const parametros = new URLSearchParams({ modeloDoOrquestrador, modeloDosSubagentes });
    if (pasta !== "") {
      parametros.set("pasta", pasta);
    }
    return requisitar<EsforcosHerdados>(`/esforco-herdado?${parametros.toString()}`);
  },

  enviarMensagem: (
    id: string,
    texto: string,
    imagens: readonly ImagemParaEnvio[] = [],
    modo: ModoDoTurno = "execucao",
    itensLigados?: readonly ItemLigadoParaEnvio[],
  ) =>
    requisitar<{ turnoId: string }>(`/orquestradores/${encodeURIComponent(id)}/mensagens`, {
      method: "POST",
      body: JSON.stringify({ texto, imagens, modo, ...comItensLigados(itensLigados) }),
    }),

  /**
   * Guarda um pedido na fila do Orquestrador (texto, modo e os itens ligados
   * agora: imagens não entram). Ele sai sozinho quando o turno atual terminar
   * concluído, ou com `enviarDaFila`. Recusado (409) com a fila cheia.
   */
  enfileirarPedido: (
    id: string,
    texto: string,
    modo: ModoDoTurno = "execucao",
    itensLigados?: readonly ItemLigadoParaEnvio[],
  ) =>
    requisitar<{ pedidoId: string }>(`/orquestradores/${encodeURIComponent(id)}/fila`, {
      method: "POST",
      body: JSON.stringify({ texto, modo, ...comItensLigados(itensLigados) }),
    }),

  removerDaFila: (id: string, pedidoId: string) =>
    requisitar<null>(`/orquestradores/${encodeURIComponent(id)}/fila/${encodeURIComponent(pedidoId)}`, {
      method: "DELETE",
    }),

  /** "Enviar agora": o pedido sai da fila e vira um turno. Recusado (409) com um turno em andamento. */
  enviarDaFila: (id: string, pedidoId: string) =>
    requisitar<{ turnoId: string }>(
      `/orquestradores/${encodeURIComponent(id)}/fila/${encodeURIComponent(pedidoId)}/enviar`,
      { method: "POST" },
    ),

  /**
   * Aprova o plano pendente do último pedido; o servidor já inicia a execução na mesma sessão.
   * `commitarAoFinal` pede o commit ao fim, pela regra por feature (o servidor o ignora se a configuração não libera commit).
   */
  aprovarPlano: (id: string, observacoes = "", commitarAoFinal = false) =>
    requisitar<{ turnoId: string }>(`/orquestradores/${encodeURIComponent(id)}/plano/aprovar`, {
      method: "POST",
      body: JSON.stringify({
        ...(observacoes.trim() === "" ? {} : { observacoes }),
        ...(commitarAoFinal ? { commitarAoFinal: true } : {}),
      }),
    }),

  descartarPlano: (id: string) =>
    requisitar<null>(`/orquestradores/${encodeURIComponent(id)}/plano/descartar`, { method: "POST" }),

  /** Começa uma conversa nova (/clear): a atual fica arquivada. Recusado (409) durante um pedido. */
  limparConversa: (id: string) =>
    requisitar<ResumoDoOrquestrador>(`/orquestradores/${encodeURIComponent(id)}/conversa/limpar`, { method: "POST" }),

  cancelar: (id: string) =>
    requisitar<{ cancelando: boolean }>(`/orquestradores/${encodeURIComponent(id)}/cancelar`, { method: "POST" }),

  removerOrquestrador: (id: string) =>
    requisitar<null>(`/orquestradores/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listarNotas: () => requisitar<DadosDaNota[]>("/notas"),

  criarNota: (dados: AlteracaoDaNota = {}) =>
    requisitar<DadosDaNota>("/notas", { method: "POST", body: JSON.stringify(dados) }),

  alterarNota: (id: string, alteracao: AlteracaoDaNota) =>
    requisitar<DadosDaNota>(`/notas/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(alteracao) }),

  removerNota: (id: string) => requisitar<null>(`/notas/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ---------------- Modelos de canvas ----------------

  listarModelosDeCanvas: () => requisitar<DadosDoModeloDeCanvas[]>("/modelos-de-canvas"),

  /** Salva um arranjo como modelo. Recusado com 400 (dados inválidos) ou 409 (já há 50 modelos). */
  criarModeloDeCanvas: (conteudo: ConteudoDoModeloDeCanvas) =>
    requisitar<DadosDoModeloDeCanvas>("/modelos-de-canvas", { method: "POST", body: JSON.stringify(conteudo) }),

  /** Renomeia (ou troca o ícone ou a cor); os itens não mudam por aqui. */
  alterarModeloDeCanvas: (id: string, alteracao: Partial<Pick<ConteudoDoModeloDeCanvas, "nome" | "icone" | "cor">>) =>
    requisitar<DadosDoModeloDeCanvas>(`/modelos-de-canvas/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(alteracao),
    }),

  removerModeloDeCanvas: (id: string) =>
    requisitar<null>(`/modelos-de-canvas/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** O arquivo para baixar; `semCaminhos` tira pastas, comandos e o que parece segredo. */
  exportarModeloDeCanvas: (id: string, semCaminhos: boolean) =>
    requisitar<ArquivoDoModeloDeCanvas>(
      `/modelos-de-canvas/${encodeURIComponent(id)}/exportar?semCaminhos=${semCaminhos ? "1" : "0"}`,
    ),

  /** Confere um arquivo exportado e devolve o modelo como seria salvo. Não grava nada. */
  conferirImportacaoDeModelo: (arquivo: unknown) =>
    requisitar<ConteudoDoModeloDeCanvas>("/modelos-de-canvas/importacao/conferir", {
      method: "POST",
      body: JSON.stringify(arquivo),
    }),

  saude: () => requisitar<SaudeDoServidor>("/saude"),

  lerPreferencias: () => requisitar<DadosDasPreferencias>("/preferencias"),

  /** Só os campos enviados mudam; vale a partir do próximo pedido de cada orquestrador. */
  alterarPreferencias: (alteracao: Partial<DadosDasPreferencias>) =>
    requisitar<DadosDasPreferencias>("/preferencias", { method: "PATCH", body: JSON.stringify(alteracao) }),

  /**
   * O que o orquestrador receberia com esta configuração (ainda não salva). Não grava nada.
   * A pasta e o nome também preenchem `{{pasta}}` e `{{nome}}` das instruções.
   */
  previaDoPrompt: (
    configuracao: DadosDaConfiguracao,
    pastaDeTrabalho?: string,
    modo: ModoDoTurno = "execucao",
    nome?: string,
  ) =>
    requisitar<PreviaDoPrompt>("/previa-do-prompt", {
      method: "POST",
      body: JSON.stringify({
        configuracao,
        modo,
        ...(pastaDeTrabalho ? { pastaDeTrabalho } : {}),
        ...(nome ? { nome } : {}),
      }),
    }),

  /**
   * Reescreve o pedido do campo para ficar mais claro (o ✨). Não envia nada:
   * só devolve o texto novo. Abortar o `sinal` cancela.
   */
  melhorarPrompt: (dados: PedidoDeMelhoria, sinal?: AbortSignal) =>
    requisitar<PromptMelhorado>("/prompts/melhorar", {
      method: "POST",
      body: JSON.stringify(dados),
      ...(sinal ? { signal: sinal } : {}),
    }),

  enderecoDoAnexo: (id: string, arquivo: string) =>
    `/api/orquestradores/${encodeURIComponent(id)}/anexos/${encodeURIComponent(arquivo)}`,

  /**
   * Uma conexão para os eventos de vários Orquestradores. Para cada id, a
   * última sequência já recebida, para o servidor reenviar só o que faltou.
   */
  enderecoDosEventos: (desdePorId: ReadonlyMap<string, number>) =>
    `/api/eventos-dos-orquestradores?orquestradores=${[...desdePorId]
      .map(([id, desde]) => `${encodeURIComponent(id)}:${desde > 0 ? desde : 0}`)
      .join(",")}`,

  // ---------------- Chat rápido ----------------

  /** O chat inteiro; a resposta em andamento já vem com o texto acumulado. */
  lerChat: () => requisitar<EstadoDoChat>("/chat"),

  /**
   * Pergunta nova; a resposta chega pelos eventos. Recusada (409) durante outra resposta.
   * `origem`: só nas perguntas que não foram digitadas (ex.: "escuta"); a mensagem a guarda.
   */
  perguntarNoChat: (
    texto: string,
    imagens: readonly ImagemParaEnvio[] = [],
    opcoes: { origem?: OrigemDaPergunta } = {},
  ) =>
    requisitar<{ mensagemId: string }>("/chat/mensagens", {
      method: "POST",
      body: JSON.stringify({
        texto,
        ...(imagens.length > 0 ? { imagens } : {}),
        ...(opcoes.origem !== undefined ? { origem: opcoes.origem } : {}),
      }),
    }),

  /**
   * Diz se o trecho transcrito pela escuta é uma pergunta e, sendo, devolve a
   * pergunta pronta para o chat. Não envia nada ao chat. Recusado com 400
   * (trecho inválido); 502 e 503 quando o Claude Code falha ou não está
   * disponível. Abortar o `sinal` cancela.
   */
  classificarNaEscuta: (pedido: PedidoDeClassificacaoDaEscuta, sinal?: AbortSignal) =>
    requisitar<ClassificacaoDaEscuta>("/escuta/classificar", {
      method: "POST",
      body: JSON.stringify({
        trecho: pedido.trecho,
        ...(pedido.contexto !== undefined ? { contexto: pedido.contexto } : {}),
      }),
      ...(sinal ? { signal: sinal } : {}),
    }),

  /** Modelo e/ou esforço do chat; a escolha vira o padrão das próximas perguntas. */
  alterarPreferenciasDoChat: (alteracao: Partial<PreferenciasDoChat>) =>
    requisitar<PreferenciasDoChat>("/chat/preferencias", { method: "PATCH", body: JSON.stringify(alteracao) }),

  /**
   * Autoriza (`true`) o chat a editar arquivos e rodar comandos até o próximo
   * `/clear`, ou revoga (`false`). O servidor confirma com o evento
   * `alteracoes_autorizadas` ou `autorizacao_revogada`.
   */
  autorizarAlteracoesDoChat: (autorizado: boolean) =>
    requisitar<{ autorizado: boolean }>("/chat/autorizacao", { method: "PATCH", body: JSON.stringify({ autorizado }) }),

  cancelarRespostaDoChat: () => requisitar<{ cancelando: boolean }>("/chat/cancelar", { method: "POST" }),

  /** Conversa nova ("/clear"): o servidor confirma com o evento `conversa_limpa`. Recusado (409) durante a resposta. */
  limparChat: () => requisitar<unknown>("/chat/limpar", { method: "POST" }),

  enderecoDoAnexoDoChat: (arquivo: string) => `/api/chat/anexos/${encodeURIComponent(arquivo)}`,

  enderecoDosEventosDoChat: (desde = 0) => `/api/chat/eventos${desde > 0 ? `?desde=${desde}` : ""}`,

  // ---------------- Terminais (shell interativo no canvas) ----------------

  /** Os terminais vivos no servidor. */
  listarShells: () => requisitar<DadosDoShell[]>("/terminais"),

  /**
   * Abre um shell na pasta (ou na pasta/worktree do Orquestrador). Recusado
   * com 400 (pasta inválida), 404 (Orquestrador ou pasta inexistente) ou 409
   * (limite de terminais abertos).
   */
  criarShell: (dados: NovoShell) =>
    requisitar<DadosDoShell>("/terminais", { method: "POST", body: JSON.stringify(dados) }),

  /** Encerra o shell no servidor. */
  encerrarShell: (id: string) => requisitar<null>(`/terminais/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** O caminho do WebSocket do terminal (mesma origem): a saída chega e a entrada vai por ele. */
  enderecoDaConexaoDoShell: (id: string) => `/api/terminais/${encodeURIComponent(id)}/conexao`,

  // ---------------- Visualizador de código (só leitura) ----------------

  /**
   * Um nível de uma pasta do Orquestrador (o worktree, se houver); `caminho`
   * relativo a ela, vazio na raiz. Sem `.git`, `node_modules` e `.env*`.
   */
  listarArquivos: (id: string, caminho = "") =>
    requisitar<ListagemDaPasta>(
      `/orquestradores/${encodeURIComponent(id)}/arquivos${caminho !== "" ? `?caminho=${encodeURIComponent(caminho)}` : ""}`,
    ),

  /** Um arquivo de texto da pasta. Recusado com 403 (bloqueado), 413 (acima de 500 KB) ou 415 (binário). */
  lerArquivo: (id: string, caminho: string) =>
    requisitar<ConteudoDoArquivo>(
      `/orquestradores/${encodeURIComponent(id)}/arquivos/conteudo?caminho=${encodeURIComponent(caminho)}`,
    ),
};
