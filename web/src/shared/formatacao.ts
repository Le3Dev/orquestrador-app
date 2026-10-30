import type { DadosDaConfiguracao, EsforcoDeRaciocinio, ModeloClaude, NivelDePermissao } from "./api/tipos";

export const ROTULOS_DOS_MODELOS: Readonly<Record<ModeloClaude, { nome: string; descricao: string }>> = {
  opus: { nome: "Opus", descricao: "Mais capaz" },
  sonnet: { nome: "Sonnet", descricao: "Equilibrado" },
  haiku: { nome: "Haiku", descricao: "Rápido, menos cota" },
};

export const ROTULOS_DOS_ESFORCOS: Readonly<Record<EsforcoDeRaciocinio, string>> = {
  // "padrao" não força nada: vale o settings.json do Claude Code da máquina ou, sem ele, o padrão do modelo.
  padrao: "Padrão (Claude Code)",
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
  extra_alto: "Extra alto",
  maximo: "Máximo",
};

/** Identificador curto de um Subagente, para caber em chips e no terminal. */
export function idCurto(id: string): string {
  return id.slice(-4);
}

/** Tempo decorrido entre dois instantes ISO (ou até `agora`, se ainda não terminou). */
export function formatarDecorrido(inicio: string, fim: string | null, agora: Date): string {
  const ate = fim === null ? agora.getTime() : Date.parse(fim);
  return formatarDuracao(Math.max(0, ate - Date.parse(inicio)));
}

/** Ex.: "≤3 agentes" (automática) ou "2 agentes" (fixa). */
export function descreverQuantidade({ modo, limite }: DadosDaConfiguracao["quantidadeDeSubagentes"]): string {
  const plural = limite === 1 ? "agente" : "agentes";
  return modo === "fixa" ? `${limite} ${plural}` : `≤${limite} ${plural}`;
}

export const ROTULOS_DAS_PERMISSOES: Readonly<Record<NivelDePermissao, { nome: string; descricao: string }>> = {
  leitura: {
    nome: "Somente leitura",
    descricao: "Lê arquivos e pesquisa na web. Não altera nada.",
  },
  edicao: {
    nome: "Ler e editar arquivos",
    descricao: "Cria e altera arquivos na pasta. Não executa comandos.",
  },
  edicao_e_comandos: {
    nome: "Editar e rodar comandos",
    descricao: "Também executa comandos no terminal (testes, builds). Commit e push só com a opção abaixo ligada.",
  },
};

/** Ex.: "Opus" ou, com um esforço escolhido, "Opus (esforço alto)". */
function descreverModelo(modelo: ModeloClaude, esforco: EsforcoDeRaciocinio): string {
  const nome = ROTULOS_DOS_MODELOS[modelo].nome;
  return esforco === "padrao" ? nome : `${nome} (esforço ${ROTULOS_DOS_ESFORCOS[esforco].toLowerCase()})`;
}

/**
 * Ex.: "Opus → Sonnet · até 3 subagentes · Somente leitura" (+ " · commit/push quando pedir", se liberado).
 * Com esforço escolhido (diferente de "padrao"): "Opus (esforço alto) → Sonnet (esforço médio) · …".
 */
export function descreverConfiguracao(configuracao: DadosDaConfiguracao): string {
  const { modo, limite } = configuracao.quantidadeDeSubagentes;
  const plural = limite === 1 ? "subagente" : "subagentes";
  const quantidade = modo === "fixa" ? `${limite} ${plural}` : `até ${limite} ${plural}`;
  const orquestrador = descreverModelo(configuracao.modeloDoOrquestrador, configuracao.esforcoDoOrquestrador);
  const subagentes = descreverModelo(configuracao.modeloDosSubagentes, configuracao.esforcoDosSubagentes);
  return [
    `${orquestrador} → ${subagentes}`,
    quantidade,
    ROTULOS_DAS_PERMISSOES[configuracao.nivelDePermissao].nome,
    ...(configuracao.permitirCommitEPush ? ["commit/push quando pedir"] : []),
  ].join(" · ");
}

export function formatarDuracao(milissegundos: number): string {
  const segundos = Math.round(milissegundos / 1000);
  if (segundos < 60) {
    return `${segundos}s`;
  }
  const minutos = Math.floor(segundos / 60);
  return `${minutos}min ${String(segundos % 60).padStart(2, "0")}s`;
}

const numeroCompacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export function formatarTokens(tokens: number): string {
  return numeroCompacto.format(tokens);
}

/** Ex.: "480 MB", "1,9 GB". */
export function formatarBytes(bytes: number): string {
  const mega = bytes / 1024 ** 2;
  if (mega < 1024) {
    return `${Math.round(mega)} MB`;
  }
  return `${(mega / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
}

export function formatarPercentual(fracao: number): string {
  return `${Math.round(fracao * 100)}%`;
}

const horario = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const horarioComSegundos = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Ex.: "16:31:27" — para o terminal de eventos. */
export function formatarHora(iso: string): string {
  return horarioComSegundos.format(new Date(iso));
}
const dataEHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Só o horário para hoje; data e horário para dias anteriores. */
export function formatarMomento(iso: string, agora: Date = new Date()): string {
  const momento = new Date(iso);
  return momento.toDateString() === agora.toDateString() ? horario.format(momento) : dataEHora.format(momento);
}
