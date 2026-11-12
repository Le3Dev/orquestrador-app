import type { EstadoDaEscuta } from "./sessaoDaEscuta";

/** Só entram no pedido as falas dos últimos 2 min. */
export const JANELA_DO_PEDIDO_MS = 120_000;

/** No máximo tantos enunciados (os mais recentes) entram no pedido, contando o que está em andamento. */
export const MAXIMO_DE_ENUNCIADOS_NO_PEDIDO = 12;

const CABECALHO_DO_PEDIDO =
  "O que eu devo responder agora? Use a transcrição recente da conversa abaixo (áudio do computador) e, se houver, a imagem da tela.";

type Legenda = EstadoDaEscuta["legenda"];

const doisDigitos = (numero: number): string => String(numero).padStart(2, "0");

/** "14:02:10", na hora local. */
export function horaComSegundos(momentoMs: number): string {
  const data = new Date(momentoMs);
  return `${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}:${doisDigitos(data.getSeconds())}`;
}

const juntarTexto = (confirmado: string, parcial: string): string => [confirmado.trim(), parcial.trim()].filter((parte) => parte !== "").join(" ");

/**
 * O texto da mensagem "Responder agora": o pedido mais as falas dos últimos
 * `JANELA_DO_PEDIDO_MS` (no máximo `MAXIMO_DE_ENUNCIADOS_NO_PEDIDO`), uma por
 * linha com a hora, e por fim o enunciado em andamento (confirmado + parcial).
 * Devolve null quando não há nenhum texto. Pura: o relógio vem em `agoraMs`.
 */
export function montarPedidoDeResposta(
  frases: Legenda["frases"],
  emAndamento: Legenda["emAndamento"],
  agoraMs: number,
): string | null {
  const linhas: { readonly momentoMs: number; readonly texto: string }[] = [];
  for (const frase of frases) {
    const texto = frase.texto.trim();
    if (texto === "" || agoraMs - frase.fimMs > JANELA_DO_PEDIDO_MS) continue;
    linhas.push({ momentoMs: frase.inicioMs, texto });
  }
  if (emAndamento !== null) {
    const texto = juntarTexto(emAndamento.confirmado, emAndamento.parcial);
    if (texto !== "") linhas.push({ momentoMs: emAndamento.inicioMs, texto });
  }
  if (linhas.length === 0) return null;
  const recentes = linhas.slice(-MAXIMO_DE_ENUNCIADOS_NO_PEDIDO);
  const transcricao = recentes.map(({ momentoMs, texto }) => `[${horaComSegundos(momentoMs)}] ${texto}`).join("\n");
  return `${CABECALHO_DO_PEDIDO}\n\nTranscrição recente:\n${transcricao}`;
}
