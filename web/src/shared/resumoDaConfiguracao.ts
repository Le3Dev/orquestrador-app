import type { DadosDaConfiguracao, EsforcoDeRaciocinio, ModeloClaude } from "./api/tipos";
import { ROTULOS_DAS_PERMISSOES, ROTULOS_DOS_MODELOS, rotuloDoEsforcoNaCriacao } from "./formatacao";

/** Ex.: "Opus (esforço automático)". */
export function modeloComEsforco(modelo: ModeloClaude, esforco: EsforcoDeRaciocinio): string {
  return `${ROTULOS_DOS_MODELOS[modelo].nome} (esforço ${rotuloDoEsforcoNaCriacao(esforco).toLowerCase()})`;
}

/**
 * A configuração numa frase, para o rodapé da criação e da ⚙ do terminal.
 * Ex.: "Somente leitura, Opus (esforço automático) com até 3 subagentes Opus."
 * Com a publicação de artefatos online ligada, termina com " Artefatos online ligados."
 */
export function resumoDaConfiguracao(configuracao: DadosDaConfiguracao): string {
  const { quantidadeDeSubagentes: quantidade } = configuracao;
  const contagem = quantidade.modo === "automatica" ? `até ${quantidade.limite}` : `sempre ${quantidade.limite}`;
  const subagentes = quantidade.limite === 1 ? "subagente" : "subagentes";
  const modeloDosSubagentes =
    configuracao.esforcoDosSubagentes === "padrao"
      ? ROTULOS_DOS_MODELOS[configuracao.modeloDosSubagentes].nome
      : modeloComEsforco(configuracao.modeloDosSubagentes, configuracao.esforcoDosSubagentes);
  return (
    `${ROTULOS_DAS_PERMISSOES[configuracao.nivelDePermissao].nome}, ` +
    `${modeloComEsforco(configuracao.modeloDoOrquestrador, configuracao.esforcoDoOrquestrador)} ` +
    `com ${contagem} ${subagentes} ${modeloDosSubagentes}.` +
    (configuracao.permitirArtefatosOnline ? " Artefatos online ligados." : "")
  );
}
