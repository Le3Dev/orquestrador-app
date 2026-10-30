import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { ModoDoTurno } from "./ModoDoTurno";
import { DESCRICAO_DO_NIVEL } from "./NivelDePermissao";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

/** Nome do papel de quem executa as subtarefas. */
export const NOME_DO_SUBAGENTE = "executor";

const MARCA_DA_CONFIGURACAO = "configuracao-do-pedido";

/** Regra de commit e push no bloco do pedido, com a opção desligada ou no planejamento. */
const COMMIT_E_PUSH_PROIBIDOS = "Commits e push são sempre proibidos.";

/** Regra de commit e push no bloco do pedido, com a opção ligada num turno de execução. */
const COMMIT_E_PUSH_QUANDO_PEDIDOS =
  "Commits e push: permitidos somente quando o usuário pedir explicitamente nesta mensagem. Nunca commitar direto na main; usar branch conforme a política (feature/, fix/, hotfix/, refactor/). Nunca adicionar a linha Co-authored-by.";

function regraDaQuantidade(quantidade: QuantidadeDeSubagentes): string {
  if (quantidade.modo === "fixa") {
    const plural = quantidade.limite === 1 ? "subagente" : "subagentes";
    return `use exatamente ${quantidade.limite} ${plural} "${NOME_DO_SUBAGENTE}" — nem mais, nem menos. Se o pedido for pequeno, divida-o em partes ou em ângulos diferentes de análise para respeitar esse número.`;
  }
  return `decida quantos subagentes "${NOME_DO_SUBAGENTE}" usar conforme o tamanho do pedido, no máximo ${quantidade.limite}. Prefira poucos subagentes com subtarefas bem definidas a muitos com subtarefas pequenas.`;
}

/**
 * As regras fixas do Orquestrador: ele coordena, os Subagentes executam.
 *
 * Não leva a configuração: o Claude Code grava este texto junto da sessão e,
 * ao retomá-la, ignora um texto novo. Quantidade e permissões mudam entre
 * pedidos e vão em cada mensagem (`mensagemParaOOrquestrador`).
 */
export function instrucoesDoOrquestrador(pasta: PastaDeTrabalho): string {
  return [
    "Você é o ORQUESTRADOR desta conversa. Seu papel é coordenar, não executar.",
    "",
    "Regras:",
    `1. Não faça o trabalho você mesmo: não leia, edite nem execute nada diretamente. Divida o pedido em subtarefas independentes e delegue cada uma a um subagente "${NOME_DO_SUBAGENTE}".`,
    `2. Cada mensagem do usuário começa com um bloco <${MARCA_DA_CONFIGURACAO}> com a quantidade de subagentes e as permissões daquele pedido. Siga sempre o bloco mais recente e não o comente na resposta.`,
    "3. Lance os subagentes em paralelo: todas as chamadas de subagente na mesma mensagem, em primeiro plano (não use execução em segundo plano), e aguarde todos terminarem antes de responder.",
    `4. Cada subtarefa deve ser autocontida: diga ao subagente o objetivo, os arquivos e pastas relevantes (caminhos absolutos dentro de ${pasta.caminho}), o que ele pode ou não alterar e o formato da resposta esperada.`,
    "5. Nunca deixe dois subagentes alterarem o mesmo arquivo.",
    "6. Quando todos terminarem, responda ao usuário com uma síntese: o que foi feito, o resultado de cada subagente e o que ficou pendente.",
    "7. Perguntas simples sobre o que já foi feito nesta conversa podem ser respondidas diretamente, sem subagentes.",
    "",
    `Pasta de trabalho: ${pasta.caminho}`,
    `Commits e push seguem a permissão do bloco <${MARCA_DA_CONFIGURACAO}> mais recente; sem o bloco, são proibidos. Responda sempre em português.`,
  ].join("\n");
}

/**
 * A mensagem que o Orquestrador recebe num turno: a configuração vigente e o
 * pedido do usuário.
 *
 * A configuração vai aqui, e não nas instruções, para valer no pedido em que
 * foi escolhida — inclusive em conversas já começadas, cujas instruções
 * iniciais ainda falam da configuração antiga; por isso o bloco declara que
 * as substitui.
 */
export function mensagemParaOOrquestrador(
  texto: string,
  configuracao: ConfiguracaoDoOrquestrador,
  caminhosDasImagens: readonly string[] = [],
  modo: ModoDoTurno = "execucao",
): string {
  const planejamento = modo === "planejamento";
  // No planejamento os subagentes só leem (as ferramentas já vêm travadas
  // assim); o nível configurado é o que valerá quando o Plano for executado.
  const nivelDoPedido = planejamento ? "leitura" : configuracao.nivelDePermissao;
  const regraDeCommitEPush = configuracao.permiteCommitEPush(modo)
    ? COMMIT_E_PUSH_QUANDO_PEDIDOS
    : COMMIT_E_PUSH_PROIBIDOS;
  const regrasDoPlanejamento = planejamento
    ? [
        "- Modo: PLANEJAMENTO. Neste pedido nada pode ser alterado: os subagentes só leem e pesquisam, seja qual for a permissão de execução.",
        "  Delegue a investigação e responda com um PLANO, sem executá-lo: objetivo; subtarefas (uma por subagente, com os arquivos que cada uma vai alterar, sem dois subagentes no mesmo arquivo); ordem; riscos; perguntas em aberto.",
        `  Na execução valerá: ${DESCRICAO_DO_NIVEL[configuracao.nivelDePermissao]}. Planeje dentro disso.`,
        "  O usuário vai aprovar, ajustar ou descartar o plano antes de qualquer execução.",
      ]
    : [];
  // As imagens chegam junto com a mensagem para o Orquestrador; os
  // Subagentes não as recebem, então precisam dos caminhos para abri-las.
  const imagens =
    caminhosDasImagens.length === 0
      ? []
      : [
          "",
          "Imagens anexadas a este pedido (você já as vê; ao delegar, passe aos subagentes os caminhos para eles abrirem com a ferramenta de leitura):",
          ...caminhosDasImagens.map((caminho) => `- ${caminho}`),
        ];
  return [
    `<${MARCA_DA_CONFIGURACAO}>`,
    "Configuração vigente para este pedido, definida pelo usuário na tela. Ela substitui qualquer quantidade de subagentes ou permissão mencionada antes nesta conversa, inclusive nas suas instruções iniciais.",
    `- Subagentes: ${regraDaQuantidade(configuracao.quantidadeDeSubagentes)}`,
    `- Permissões: ${DESCRICAO_DO_NIVEL[nivelDoPedido]}. ${regraDeCommitEPush}`,
    ...regrasDoPlanejamento,
    ...imagens,
    `</${MARCA_DA_CONFIGURACAO}>`,
    "",
    texto,
  ].join("\n");
}

/**
 * O pedido que abre o turno de execução de um Plano aprovado. Vai como
 * mensagem, e não nas instruções: ao retomar a sessão (`--resume`), o Claude
 * Code ignora instruções novas.
 */
export function mensagemDeAprovacaoDoPlano(observacoes: string): string {
  const aprovacao =
    "Plano aprovado. Execute agora o plano da sua resposta anterior, delegando as subtarefas como planejado.";
  const extras = observacoes.trim();
  return extras === "" ? aprovacao : `${aprovacao}\n\nObservações do usuário: ${extras}`;
}

/**
 * As regras de cada Subagente: fazer só a subtarefa recebida e prestar contas.
 *
 * Vai na definição dos agentes, refeita a cada turno: por isso pode levar a
 * regra de commit e push do pedido (`ConfiguracaoDoOrquestrador.permiteCommitEPush`).
 */
export function instrucoesDoSubagente(pasta: PastaDeTrabalho, permiteCommitEPush = false): string {
  const regraDeCommitEPush = permiteCommitEPush
    ? "Commit e push: faça somente se a subtarefa recebida pedir explicitamente — o orquestrador só pede quando o usuário pediu. Nunca na main; use branch conforme a política (feature/, fix/, hotfix/, refactor/). Nunca adicione a linha Co-authored-by."
    : "Nunca faça commit nem push.";
  return [
    "Você é um subagente executor, coordenado por um orquestrador.",
    `Faça somente a subtarefa recebida, dentro da pasta ${pasta.caminho}. Seja objetivo.`,
    "Ao terminar, devolva: o que fez, os arquivos que alterou (se houver) e o resultado.",
    `${regraDeCommitEPush} Responda em português.`,
  ].join("\n");
}
