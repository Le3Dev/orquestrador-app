import { textosAtuais } from "./idioma/idioma";
import { textosDeConfiguracoes } from "./idioma/textos/configuracoes";
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
  const d = textosAtuais(textosDeConfiguracoes).atualizacaoCurta;
  const versaoNova = estado.versaoNova ?? d.versaoNovaPadrao;
  switch (estado.situacao) {
    case "indisponivel":
      return d.indisponivel;
    case "verificando":
      return d.verificando;
    case "em-dia":
      return d.emDia;
    case "baixando":
      return d.baixando(versaoNova, percentualDoDownload(estado.progresso));
    case "pronta":
      return d.pronta(versaoNova);
    case "erro":
      return d.erro(estado.mensagemDeErro?.trim() ?? "");
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
  return textosAtuais(textosDeConfiguracoes).atualizacaoCurta.versaoEResultado(estado.versaoAtual.trim(), resultado(estado));
}

/** "Há 1 pedido em andamento; reiniciar agora vai cancelá-lo." (ou "N pedidos … cancelá-los"). */
export function avisoDosPedidosEmAndamento(quantidade: number): string {
  return textosAtuais(textosDeConfiguracoes).atualizacaoCurta.avisoDosPedidos(quantidade);
}
