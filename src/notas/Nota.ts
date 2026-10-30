import { ErroDeNota } from "./ErroDeNota";

export const TITULO_PADRAO = "Nova nota";
export const TAMANHO_MAXIMO_DO_TITULO = 120;
export const TAMANHO_MAXIMO_DO_TEXTO = 100_000;

/** 100000 -> "100.000", sem depender do ICU do Node. */
function formatarMilhares(numero: number): string {
  return String(numero).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export const MENSAGEM_DE_TITULO_INVALIDO = `O título da nota deve ter entre 1 e ${TAMANHO_MAXIMO_DO_TITULO} caracteres.`;
export const MENSAGEM_DE_TEXTO_LONGO_DEMAIS = `A nota pode ter até ${formatarMilhares(TAMANHO_MAXIMO_DO_TEXTO)} caracteres.`;

export interface DadosDaNota {
  id: string;
  titulo: string;
  texto: string;
  /** ISO 8601 */
  criadaEm: string;
  /** ISO 8601 */
  atualizadaEm: string;
}

export interface NovaNota {
  id: string;
  titulo?: string | undefined;
  texto?: string | undefined;
  agora: Date;
}

function tituloValido(titulo: string): string {
  const aparado = titulo.trim();
  if (aparado === "" || aparado.length > TAMANHO_MAXIMO_DO_TITULO) {
    throw new ErroDeNota("dados_invalidos", MENSAGEM_DE_TITULO_INVALIDO);
  }
  return aparado;
}

/** O texto é guardado como veio: espaços e quebras de linha fazem parte da anotação. */
function textoValido(texto: string): string {
  if (texto.length > TAMANHO_MAXIMO_DO_TEXTO) {
    throw new ErroDeNota("dados_invalidos", MENSAGEM_DE_TEXTO_LONGO_DEMAIS);
  }
  return texto;
}

/**
 * Bloco de notas do usuário no canvas: observações e coisas para fazer depois.
 *
 * Só o conteúdo (título e texto) pertence à Nota. Onde ela aparece no canvas,
 * o tamanho e se está minimizada são preferências da tela, guardadas no
 * navegador — como acontece com os terminais.
 */
export class Nota {
  private constructor(
    public readonly id: string,
    private tituloAtual: string,
    private textoAtual: string,
    private readonly criadaEmMs: number,
    private atualizadaEmMs: number,
  ) {}

  static criar({ id, titulo = TITULO_PADRAO, texto = "", agora }: NovaNota): Nota {
    return new Nota(id, tituloValido(titulo), textoValido(texto), agora.getTime(), agora.getTime());
  }

  static reconstituir(dados: DadosDaNota): Nota {
    return new Nota(
      dados.id,
      dados.titulo,
      dados.texto,
      Date.parse(dados.criadaEm),
      Date.parse(dados.atualizadaEm),
    );
  }

  get titulo(): string {
    return this.tituloAtual;
  }

  get texto(): string {
    return this.textoAtual;
  }

  get criadaEm(): Date {
    return new Date(this.criadaEmMs);
  }

  get atualizadaEm(): Date {
    return new Date(this.atualizadaEmMs);
  }

  /** Trocar pelo mesmo título não conta como alteração. */
  renomear(titulo: string, agora: Date): void {
    const novo = tituloValido(titulo);
    if (novo === this.tituloAtual) {
      return;
    }
    this.tituloAtual = novo;
    this.atualizadaEmMs = agora.getTime();
  }

  /** Substitui o texto inteiro; reescrever com o mesmo texto não conta como alteração. */
  reescrever(texto: string, agora: Date): void {
    const novo = textoValido(texto);
    if (novo === this.textoAtual) {
      return;
    }
    this.textoAtual = novo;
    this.atualizadaEmMs = agora.getTime();
  }

  paraDados(): DadosDaNota {
    return {
      id: this.id,
      titulo: this.tituloAtual,
      texto: this.textoAtual,
      criadaEm: new Date(this.criadaEmMs).toISOString(),
      atualizadaEm: new Date(this.atualizadaEmMs).toISOString(),
    };
  }
}
