import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { ModoDoTurno } from "./ModoDoTurno";
import { DESCRICAO_DO_NIVEL, NivelDePermissao, TRABALHO_DIRETO_NO_NIVEL } from "./NivelDePermissao";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

/** Nome do papel de quem executa as subtarefas. */
export const NOME_DO_SUBAGENTE = "executor";

/**
 * Linha com que o Orquestrador encerra a resposta quando, num turno de
 * execução, propõe um Plano em vez de executar um pedido grande.
 */
export const MARCADOR_DE_PLANO = "<plano-para-aprovacao/>";

const MARCA_DA_CONFIGURACAO = "configuracao-do-pedido";

/** Como começa a mensagem que aprova um Plano (`mensagemDeAprovacaoDoPlano`). */
const INICIO_DA_APROVACAO = "Plano aprovado.";

/** Regra de commit e push no bloco do pedido, com a opção desligada ou no planejamento. */
const COMMIT_E_PUSH_PROIBIDOS = "Commits e push são sempre proibidos.";

/** Regra de commit e push no bloco do pedido, com a opção ligada num turno de execução. */
const COMMIT_E_PUSH_QUANDO_PEDIDOS =
  "Commits e push: permitidos somente quando o usuário pedir explicitamente nesta mensagem. Nunca commitar direto na main; usar branch conforme a política (feature/, fix/, hotfix/, refactor/). Nunca adicionar a linha Co-authored-by.";

/**
 * O marcador como o Orquestrador pode escrevê-lo: com espaços em volta, um
 * espaço antes da barra ou entre crases.
 */
const MARCADOR_ESCRITO = String.raw`(?:\x60[ \t]*)?<plano-para-aprovacao[ \t]*\/>(?:[ \t]*\x60)?`;
/** Linha que só tem o marcador: sai inteira, com a quebra. */
const LINHA_DO_MARCADOR = new RegExp(String.raw`^[ \t]*${MARCADOR_ESCRITO}[ \t]*(?:\r?\n|$)`, "gm");
/** Marcador no meio de uma linha: sai com os espaços que o antecedem. */
const MARCADOR_NA_LINHA = new RegExp(String.raw`[ \t]*${MARCADOR_ESCRITO}`, "g");

function regraDaQuantidade(quantidade: QuantidadeDeSubagentes): string {
  if (quantidade.modo === "fixa") {
    const plural = quantidade.limite === 1 ? "subagente" : "subagentes";
    return `quando delegar, use exatamente ${quantidade.limite} ${plural} "${NOME_DO_SUBAGENTE}" — nem mais, nem menos.`;
  }
  return `quando delegar, decida quantos subagentes "${NOME_DO_SUBAGENTE}" usar conforme o tamanho do pedido, no máximo ${quantidade.limite}. Prefira poucos subagentes com subtarefas bem definidas a muitos com subtarefas pequenas; se um basta, use um.`;
}

/**
 * Quem faz o quê no pedido: o Orquestrador sempre faz o trivial dentro do
 * nível e delega o resto (ADR-28). Ele nunca edita arquivos do projeto.
 */
function regrasDeDelegacao(nivel: NivelDePermissao): string[] {
  return [
    `- Faça você mesmo o trivial: ${TRABALHO_DIRETO_NO_NIVEL[nivel]}. Cada subagente custa dezenas de milhares de tokens só para começar.`,
    `- Delegue a subagentes "${NOME_DO_SUBAGENTE}" quando houver alteração de arquivos, quando o trabalho exigir ler muitos arquivos ou rodar comandos demorados (build, testes), ou quando der para dividir em partes paralelas. Não use subagente para conferir o próprio trabalho.`,
    `- Você não edita arquivos: toda alteração no projeto vai para um subagente "${NOME_DO_SUBAGENTE}". A única exceção são os artefatos (abaixo), que não são arquivos do projeto.`,
  ];
}

/** Limite de tamanho de um artefato, como é dito aos agentes. */
const TAMANHO_MAXIMO_DO_ARTEFATO = "5 MB";

/** Formato de um artefato: o mesmo para o Orquestrador e para os Subagentes. */
const FORMATO_DO_ARTEFATO = `.html com CSS e JS inline, sem CDN nem recursos externos (a rede é bloqueada) e imagens como data URI; ou .md. Até ${TAMANHO_MAXIMO_DO_ARTEFATO}`;

/**
 * Quando e como entregar um artefato (página ou relatório gravado para o
 * usuário ver na tela). Gravar na pasta de artefatos não é editar arquivos do
 * projeto: vale em qualquer nível e no planejamento — as ferramentas já vêm
 * liberadas só para essa pasta.
 */
function regrasDeArtefatos(pastaDeArtefatos: string): string[] {
  return [
    `- Artefatos: quando o usuário pedir uma visualização, relatório, diagrama, protótipo, dashboard ou página, ou quando o resultado ficar melhor como página do que como texto, entregue um artefato: UM arquivo autocontido gravado na pasta ${pastaDeArtefatos}`,
    `  Artefato não é arquivo do projeto: você mesmo pode gravá-lo (é a exceção à regra de não editar arquivos) ou delegá-lo a um subagente "${NOME_DO_SUBAGENTE}", passando a ele esse caminho absoluto. Vale em qualquer permissão, inclusive no planejamento; fora dessa pasta, as regras acima continuam valendo.`,
    `  Formato: ${FORMATO_DO_ARTEFATO}. Nome do arquivo curto e descritivo, porque vira o título (ex.: relatorio-de-testes.html).`,
    "  Para atualizar um artefato, regrave o MESMO arquivo: ele vira uma nova versão.",
    "  Na resposta, cite pelo nome o artefato criado ou atualizado.",
  ];
}

/**
 * Em todo turno de execução, o Orquestrador mede o pedido antes de mexer em
 * algo: se for grande, só investiga e devolve um Plano marcado com
 * `MARCADOR_DE_PLANO`, para o usuário aprovar (ADR-15, ADR-28).
 */
function regrasDePedidosGrandes(): string[] {
  return [
    `- Pedidos grandes: antes de alterar qualquer coisa, avalie o tamanho. Se envolver alterar mais de cerca de 3 arquivos, mudar contratos, dados ou arquitetura, ou tiver ambiguidade relevante, NÃO execute: investigue só lendo (você ou subagentes com subtarefas só de leitura) e responda com um PLANO (objetivo; subtarefas por subagente com os arquivos de cada uma, sem dois no mesmo arquivo; ordem; riscos; perguntas em aberto) e termine a resposta com a linha ${MARCADOR_DE_PLANO}. O usuário vai aprovar, ajustar ou descartar.`,
    `- Pedido pequeno, ou plano já aprovado (mensagem que começa com "${INICIO_DA_APROVACAO}"): execute direto, sem o marcador.`,
  ];
}

/**
 * As regras fixas do Orquestrador: ele coordena, faz o trivial quando o pedido
 * permite e entrega toda alteração aos Subagentes.
 *
 * Não leva a configuração: o Claude Code grava este texto junto da sessão e,
 * ao retomá-la, ignora um texto novo. Delegação, quantidade e permissões mudam
 * entre pedidos e vão em cada mensagem (`mensagemParaOOrquestrador`).
 */
export function instrucoesDoOrquestrador(pasta: PastaDeTrabalho): string {
  return [
    "Você é o ORQUESTRADOR desta conversa. Seu papel é coordenar: entender o pedido, dividir o trabalho, delegar o que valer a pena e entregar a síntese.",
    "",
    "Regras:",
    `1. Coordene. Faça você mesmo o trivial quando o bloco <${MARCA_DA_CONFIGURACAO}> permitir; delegue a subagentes "${NOME_DO_SUBAGENTE}" quando valer a pena, em subtarefas independentes. Nunca edite arquivos você mesmo: toda alteração no projeto vai para um subagente. A exceção são os artefatos (páginas e relatórios para o usuário, gravados na pasta de artefatos que o bloco indica), que não são arquivos do projeto.`,
    `2. Cada mensagem do usuário começa com um bloco <${MARCA_DA_CONFIGURACAO}> com as regras de delegação, a quantidade de subagentes e as permissões daquele pedido. Siga sempre o bloco mais recente — ele prevalece sobre estas regras — e não o comente na resposta.`,
    "3. Lance os subagentes em paralelo: todas as chamadas de subagente na mesma mensagem, em primeiro plano (não use execução em segundo plano), e aguarde todos terminarem antes de responder.",
    `4. Cada subtarefa deve ser autocontida: diga ao subagente o objetivo, os arquivos e pastas relevantes (caminhos absolutos dentro de ${pasta.caminho}), o que ele pode ou não alterar e o formato da resposta esperada.`,
    "5. Nunca deixe dois subagentes alterarem o mesmo arquivo.",
    "6. Ao terminar, responda ao usuário com uma síntese: o que foi feito, o resultado de cada subagente (se houver) e o que ficou pendente.",
    `7. Perguntas simples sobre o que já foi feito nesta conversa podem ser respondidas diretamente, sem subagentes; o que mais você pode fazer sem delegar é o que o bloco <${MARCA_DA_CONFIGURACAO}> permitir.`,
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
 *
 * Com `pastaDeArtefatos`, o bloco diz quando e como gravar artefatos nela.
 */
export function mensagemParaOOrquestrador(
  texto: string,
  configuracao: ConfiguracaoDoOrquestrador,
  caminhosDasImagens: readonly string[] = [],
  modo: ModoDoTurno = "execucao",
  pastaDeArtefatos: string | null = null,
): string {
  const planejamento = modo === "planejamento";
  // No planejamento os agentes só leem (as ferramentas já vêm travadas
  // assim); o nível configurado é o que valerá quando o Plano for executado.
  const nivelDoPedido = planejamento ? "leitura" : configuracao.nivelDePermissao;
  const regraDeCommitEPush = configuracao.permiteCommitEPush(modo)
    ? COMMIT_E_PUSH_QUANDO_PEDIDOS
    : COMMIT_E_PUSH_PROIBIDOS;
  const regrasDoPlanejamento = planejamento
    ? [
        "- Modo: PLANEJAMENTO. Neste pedido nada no projeto pode ser alterado: os subagentes só leem e pesquisam, seja qual for a permissão de execução.",
        "  Investigue (você mesmo, se for rápido, ou delegando) e responda com um PLANO, sem executá-lo: objetivo; subtarefas (uma por subagente, com os arquivos que cada uma vai alterar, sem dois subagentes no mesmo arquivo); ordem; riscos; perguntas em aberto.",
        `  Na execução valerá: ${DESCRICAO_DO_NIVEL[configuracao.nivelDePermissao]}. Planeje dentro disso.`,
        "  O usuário vai aprovar, ajustar ou descartar o plano antes de qualquer execução.",
      ]
    : [];
  const regrasDoTamanho = configuracao.propoePlanoEmPedidosGrandes(modo) ? regrasDePedidosGrandes() : [];
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
    "Configuração vigente para este pedido, definida pelo usuário na tela. Ela substitui qualquer regra de delegação, quantidade de subagentes ou permissão mencionada antes nesta conversa, inclusive nas suas instruções iniciais.",
    ...regrasDeDelegacao(nivelDoPedido),
    `- Subagentes: ${regraDaQuantidade(configuracao.quantidadeDeSubagentes)}`,
    `- Permissões: ${DESCRICAO_DO_NIVEL[nivelDoPedido]}. ${regraDeCommitEPush}`,
    ...regrasDoPlanejamento,
    ...regrasDoTamanho,
    ...(pastaDeArtefatos === null ? [] : regrasDeArtefatos(pastaDeArtefatos)),
    ...imagens,
    `</${MARCA_DA_CONFIGURACAO}>`,
    "",
    texto,
  ].join("\n");
}

/**
 * Separa da resposta do Orquestrador o `MARCADOR_DE_PLANO`, com que ele avisa
 * que propôs um Plano em vez de executar. Remove todas as ocorrências —
 * tolerando espaços e crases em volta — e apara o fim.
 */
export function separarPropostaDePlano(resposta: string): { resposta: string; planoProposto: boolean } {
  const semLinhas = resposta.replace(LINHA_DO_MARCADOR, "");
  const semMarcador = semLinhas.replace(MARCADOR_NA_LINHA, "");
  if (semMarcador === resposta) {
    return { resposta, planoProposto: false };
  }
  return { resposta: semMarcador.trimEnd(), planoProposto: true };
}

/**
 * O pedido que abre o turno de execução de um Plano aprovado — tanto o do modo
 * planejamento quanto o proposto num pedido grande. Vai como mensagem, e não
 * nas instruções: ao retomar a sessão (`--resume`), o Claude Code ignora
 * instruções novas.
 */
export function mensagemDeAprovacaoDoPlano(observacoes: string): string {
  const aprovacao = `${INICIO_DA_APROVACAO} Execute agora o plano da sua resposta anterior, delegando as subtarefas como planejado.`;
  const extras = observacoes.trim();
  return extras === "" ? aprovacao : `${aprovacao}\n\nObservações do usuário: ${extras}`;
}

/**
 * As regras de cada Subagente: fazer só a subtarefa recebida e prestar contas.
 *
 * Vai na definição dos agentes, refeita a cada turno: por isso pode levar a
 * regra de commit e push do pedido (`ConfiguracaoDoOrquestrador.permiteCommitEPush`)
 * e a pasta de artefatos do Orquestrador.
 */
export function instrucoesDoSubagente(
  pasta: PastaDeTrabalho,
  permiteCommitEPush = false,
  pastaDeArtefatos: string | null = null,
): string {
  const regraDeCommitEPush = permiteCommitEPush
    ? "Commit e push: faça somente se a subtarefa recebida pedir explicitamente — o orquestrador só pede quando o usuário pediu. Nunca na main; use branch conforme a política (feature/, fix/, hotfix/, refactor/). Nunca adicione a linha Co-authored-by."
    : "Nunca faça commit nem push.";
  const regraDeArtefatos =
    pastaDeArtefatos === null
      ? []
      : [
          `Se a subtarefa pedir um artefato (página ou relatório para o usuário), grave UM arquivo autocontido na pasta ${pastaDeArtefatos}: ${FORMATO_DO_ARTEFATO}. Artefato não é arquivo do projeto: gravar nessa pasta é permitido em qualquer permissão. Para atualizar, regrave o mesmo arquivo.`,
        ];
  return [
    "Você é um subagente executor, coordenado por um orquestrador.",
    `Faça somente a subtarefa recebida, dentro da pasta ${pasta.caminho}. Seja objetivo.`,
    ...regraDeArtefatos,
    "Ao terminar, devolva: o que fez, os arquivos que alterou (se houver) e o resultado.",
    `${regraDeCommitEPush} Responda em português.`,
  ].join("\n");
}
