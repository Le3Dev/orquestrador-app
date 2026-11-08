import type { DadosDaConfiguracao, EsforcoDeRaciocinio, ModeloClaude, PreferenciasDoChat } from "./api/tipos";

/** Um modelo do Claude como aparece no seletor do chat. */
export interface ModeloNoSeletor {
  modelo: ModeloClaude;
  nome: string;
  /** Versão de referência; a da última resposta prevalece quando é da mesma família. */
  versao: string;
  descricao: string;
}

export const MODELOS_DO_CHAT: readonly ModeloNoSeletor[] = [
  { modelo: "fable", nome: "Fable", versao: "5.1", descricao: "Para seus desafios mais difíceis" },
  { modelo: "opus", nome: "Opus", versao: "5.5", descricao: "Para trabalhos complexos e tarefas do dia a dia" },
  { modelo: "sonnet", nome: "Sonnet", versao: "5.5", descricao: "Mais eficiente para tarefas mais simples" },
  { modelo: "haiku", nome: "Haiku", versao: "5.5", descricao: "Mais rápido para respostas rápidas" },
];

export const ESFORCOS_DO_CHAT: readonly { esforco: EsforcoDeRaciocinio; rotulo: string }[] = [
  { esforco: "padrao", rotulo: "Padrão" },
  { esforco: "baixo", rotulo: "Baixo" },
  { esforco: "medio", rotulo: "Médio" },
  { esforco: "alto", rotulo: "Alto" },
  { esforco: "extra_alto", rotulo: "Extra alto" },
  { esforco: "maximo", rotulo: "Máximo" },
  { esforco: "ultracode", rotulo: "Ultracode" },
];

export const PREFERENCIAS_PADRAO_DO_CHAT: PreferenciasDoChat = { modelo: "opus", esforco: "alto" };

/**
 * A configuração com que um Orquestrador nasce — a mesma do formulário de
 * criação (`NoRascunho`) e a usada quando o chat abre um Orquestrador novo.
 */
export const CONFIGURACAO_PADRAO_DO_ORQUESTRADOR: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "opus",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  instrucoesPersonalizadas: "",
};

export function modeloNoSeletor(modelo: ModeloClaude): ModeloNoSeletor {
  return MODELOS_DO_CHAT.find((item) => item.modelo === modelo) ?? MODELOS_DO_CHAT[1]!;
}

export function rotuloDoEsforco(esforco: EsforcoDeRaciocinio): string {
  return ESFORCOS_DO_CHAT.find((item) => item.esforco === esforco)?.rotulo ?? esforco;
}

/**
 * A versão no identificador do modelo, se for da família pedida:
 * "claude-opus-5-5" → "5.5"; "claude-haiku-4-5-20251001" → "4.5";
 * "claude-opus-4-20250514" → "4". Outra família ou formato desconhecido: nulo.
 */
export function versaoDoModeloUsado(modeloUsado: string | null, modelo: ModeloClaude): string | null {
  if (modeloUsado === null) {
    return null;
  }
  const encontrado = new RegExp(`(?:^|-)${modelo}-(\\d+)(?:-(\\d{1,2}))?(?=-|$)`).exec(modeloUsado.toLowerCase());
  if (encontrado === null) {
    return null;
  }
  const [, principal, secundaria] = encontrado;
  return secundaria === undefined ? (principal ?? null) : `${principal}.${secundaria}`;
}

/** Ex.: "Opus 5.5" — com a versão da última resposta, quando é da mesma família. */
export function nomeComVersao(modelo: ModeloClaude, modeloUsado: string | null): string {
  const item = modeloNoSeletor(modelo);
  return `${item.nome} ${versaoDoModeloUsado(modeloUsado, modelo) ?? item.versao}`;
}
