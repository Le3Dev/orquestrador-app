import type {
  DadosDaConfiguracao,
  DadosDaNota,
  ModoDoTurno,
  PastaDeProjeto,
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
    throw new Error(
      "Não foi possível falar com o servidor. Confira se ele está rodando (iniciar-orquestrador.cmd ou npm start).",
    );
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

  listarOrquestradores: () => requisitar<ResumoDoOrquestrador[]>("/orquestradores"),

  criarOrquestrador: (dados: NovoOrquestrador) =>
    requisitar<ResumoDoOrquestrador>("/orquestradores", { method: "POST", body: JSON.stringify(dados) }),

  alterarConfiguracao: (id: string, configuracao: Partial<DadosDaConfiguracao>) =>
    requisitar<ResumoDoOrquestrador>(`/orquestradores/${encodeURIComponent(id)}/configuracao`, {
      method: "PATCH",
      body: JSON.stringify(configuracao),
    }),

  enviarMensagem: (
    id: string,
    texto: string,
    imagens: readonly ImagemParaEnvio[] = [],
    modo: ModoDoTurno = "execucao",
  ) =>
    requisitar<{ turnoId: string }>(`/orquestradores/${encodeURIComponent(id)}/mensagens`, {
      method: "POST",
      body: JSON.stringify({ texto, imagens, modo }),
    }),

  /** Aprova o plano pendente do último pedido; o servidor já inicia a execução na mesma sessão. */
  aprovarPlano: (id: string, observacoes = "") =>
    requisitar<{ turnoId: string }>(`/orquestradores/${encodeURIComponent(id)}/plano/aprovar`, {
      method: "POST",
      body: JSON.stringify(observacoes.trim() === "" ? {} : { observacoes }),
    }),

  descartarPlano: (id: string) =>
    requisitar<null>(`/orquestradores/${encodeURIComponent(id)}/plano/descartar`, { method: "POST" }),

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

  saude: () => requisitar<SaudeDoServidor>("/saude"),

  enderecoDoAnexo: (id: string, arquivo: string) =>
    `/api/orquestradores/${encodeURIComponent(id)}/anexos/${encodeURIComponent(arquivo)}`,

  /** `desde`: última sequência já recebida, para o servidor reenviar só o que faltou. */
  enderecoDosEventos: (id: string, desde = 0) =>
    `/api/orquestradores/${encodeURIComponent(id)}/eventos${desde > 0 ? `?desde=${desde}` : ""}`,
};
