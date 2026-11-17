export type MotivoDoErroDoNavegador =
  | "comando_invalido"
  | "indisponivel"
  | "pausado"
  | "recusado"
  | "tempo_esgotado"
  | "cancelado"
  | "falhou";

/**
 * Falha de um comando do navegador do agente. O `motivo` separa o erro do
 * pedido (`comando_invalido`, `recusado`) do estado do navegador (`pausado`,
 * `indisponivel`) e da execução (`tempo_esgotado`, `cancelado`, `falhou`); a
 * mensagem já vem pronta para o agente ler.
 */
export class ErroDoNavegador extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDoNavegador,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoNavegador";
  }
}

export const MENSAGEM_DO_NAVEGADOR_SO_NO_DESKTOP = "O navegador do agente só funciona no aplicativo desktop.";
export const MENSAGEM_DO_NAVEGADOR_PAUSADO = "O usuário assumiu o navegador; tente depois.";
export const MENSAGEM_DE_COMANDO_CANCELADO = "O comando do navegador foi cancelado.";

const MOTIVOS: ReadonlySet<string> = new Set<MotivoDoErroDoNavegador>([
  "comando_invalido",
  "indisponivel",
  "pausado",
  "recusado",
  "tempo_esgotado",
  "cancelado",
  "falhou",
]);

export function ehMotivoDoErroDoNavegador(valor: unknown): valor is MotivoDoErroDoNavegador {
  return typeof valor === "string" && MOTIVOS.has(valor);
}
