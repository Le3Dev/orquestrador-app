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

/** O resultado da última verificação, em minúsculas (vai depois da versão). */
function resultado(estado: EstadoDaAtualizacao): string {
  const versaoNova = estado.versaoNova ?? "a nova versão";
  switch (estado.situacao) {
    case "indisponivel":
      return "atualizações só no app instalado";
    case "verificando":
      return "procurando atualizações…";
    case "em-dia":
      return "você está na versão mais recente";
    case "baixando": {
      const percentual = percentualDoDownload(estado.progresso);
      return `baixando ${versaoNova}…${percentual === null ? "" : ` ${percentual}%`}`;
    }
    case "pronta":
      return `${versaoNova} pronta: será instalada ao fechar o app`;
    case "erro":
      return estado.mensagemDeErro === null || estado.mensagemDeErro.trim() === ""
        ? "não foi possível verificar"
        : `não foi possível verificar: ${estado.mensagemDeErro.trim()}`;
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
