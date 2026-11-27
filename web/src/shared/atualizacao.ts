import type { EstadoDaAtualizacao } from "./ponteDoDesktop";

/**
 * Textos da atualização automática do app desktop: o detalhe da ação
 * "Procurar atualizações" da paleta e o aviso da barra de título. Tudo puro.
 */

/** O progresso do download como percentual inteiro (0–100), ou null sem progresso. */
export function percentualDoDownload(progresso: number | null): number | null {
  if (progresso === null || !Number.isFinite(progresso)) {
    return null;
  }
  return Math.round(Math.min(100, Math.max(0, progresso)));
}

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function primeiraMinuscula(texto: string): string {
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

/** Até onde vai o resumo de uma mensagem de erro (o resto fica em "Ver detalhes"). */
const TAMANHO_DO_RESUMO = 140;

export interface MensagemResumida {
  /** A primeira linha com texto, cortada com reticências se for longa. */
  resumo: string;
  /** A mensagem inteira quando o resumo não a mostra toda; null quando cabe nele. */
  detalhes: string | null;
}

/**
 * Resume uma mensagem de erro que pode ser longa (no Mac, o fim do log): a
 * primeira linha com texto, cortada; o texto inteiro fica para os detalhes.
 */
export function resumirMensagem(mensagem: string): MensagemResumida {
  const texto = mensagem.trim();
  const primeira = texto.split(/\r?\n/).find((linha) => linha.trim() !== "")?.trim() ?? "";
  const resumo =
    primeira.length > TAMANHO_DO_RESUMO ? `${primeira.slice(0, TAMANHO_DO_RESUMO - 1).trimEnd()}…` : primeira;
  return { resumo, detalhes: resumo === texto ? null : texto };
}

/** A etapa do Mac com reticências ("Gerando o app…"), ou null sem etapa. */
export function textoDaEtapa(etapa: string | null): string | null {
  const texto = etapa?.trim().replace(/[.…]+$/, "") ?? "";
  return texto === "" ? null : `${texto}…`;
}

function orquestradores(quantidade: number): string {
  return quantidade === 1 ? "1 orquestrador" : `${quantidade} orquestradores`;
}

/** "2 orquestradores trabalhando. Reiniciar agora interrompe o trabalho deles." (no singular, "dele"). */
export function avisoDosOrquestradoresTrabalhando(quantidade: number): string {
  return `${orquestradores(quantidade)} trabalhando. Reiniciar agora interrompe o trabalho ${quantidade === 1 ? "dele" : "deles"}.`;
}

/** "Reinicia quando 2 orquestradores terminarem" (sem a quantidade, "quando os orquestradores terminarem"). */
export function textoDaEspera(quantidade: number | null): string {
  if (quantidade === null || quantidade <= 0) {
    return "Reinicia quando os orquestradores terminarem";
  }
  return quantidade === 1
    ? "Reinicia quando 1 orquestrador terminar"
    : `Reinicia quando ${orquestradores(quantidade)} terminarem`;
}

/** O resultado da última verificação, em minúsculas (vai depois da versão). */
function resultado(estado: EstadoDaAtualizacao): string {
  const versaoNova = estado.versaoNova ?? "a nova versão";
  const etapa = textoDaEtapa(estado.etapa);
  switch (estado.situacao) {
    case "indisponivel":
      return "atualizações só no app instalado";
    case "verificando":
      return etapa === null ? "procurando atualizações…" : primeiraMinuscula(etapa);
    case "em-dia":
      return "você está na versão mais recente";
    case "baixando": {
      const percentual = percentualDoDownload(estado.progresso);
      const texto = etapa === null ? `baixando ${versaoNova}…` : primeiraMinuscula(etapa);
      return `${texto}${percentual === null ? "" : ` ${percentual}%`}`;
    }
    case "pronta":
      return `${versaoNova} pronta: será instalada ao fechar o app`;
    case "aguardando":
      return `${versaoNova} pronta: ${primeiraMinuscula(textoDaEspera(estado.orquestradoresTrabalhando))}`;
    case "erro": {
      const resumo = estado.mensagemDeErro === null ? "" : resumirMensagem(estado.mensagemDeErro).resumo;
      return resumo === "" ? "não foi possível verificar" : `não foi possível verificar: ${resumo}`;
    }
  }
}

/**
 * O detalhe de "Procurar atualizações": a versão atual e o resultado. Ex.:
 * "Versão 0.2.0 — você está na versão mais recente". Fora do app instalado,
 * só "Atualizações só no app instalado".
 */
export function descreverAtualizacao(estado: EstadoDaAtualizacao): string {
  if (estado.situacao === "indisponivel" || estado.versaoAtual.trim() === "") {
    return primeiraMaiuscula(resultado(estado));
  }
  return `Versão ${estado.versaoAtual.trim()} — ${resultado(estado)}`;
}

/** "Há 1 pedido em andamento; reiniciar agora vai cancelá-lo." (ou "N pedidos … cancelá-los"). */
export function avisoDosPedidosEmAndamento(quantidade: number): string {
  return quantidade === 1
    ? "Há 1 pedido em andamento; reiniciar agora vai cancelá-lo."
    : `Há ${quantidade} pedidos em andamento; reiniciar agora vai cancelá-los.`;
}
