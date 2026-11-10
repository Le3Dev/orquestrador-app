import type { DadosDaConfiguracao, EsforcoDeRaciocinio, ModeloClaude, NivelDePermissao } from "./api/tipos";

export const ROTULOS_DOS_MODELOS: Readonly<Record<ModeloClaude, { nome: string; descricao: string }>> = {
  fable: { nome: "Fable", descricao: "Desafios mais difíceis" },
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
  ultracode: "Ultracode",
};

/** Mostrado perto do esforço quando "ultracode" está escolhido (orquestrador e chat). */
export const AVISO_DO_ULTRACODE =
  "Ultracode dispara workflows com vários agentes em paralelo: custa bem mais e pesa na memória. Num teste, uma tarefa pequena custou US$ 3,24 em 4,5 min.";

/** Nome e ajuda do interruptor que liga a publicação de artefatos online (orquestrador e chat). */
export const ROTULO_DOS_ARTEFATOS_ONLINE = "Publicar artefatos no claude.ai";
export const AJUDA_DOS_ARTEFATOS_ONLINE =
  "O orquestrador e os subagentes dele podem publicar páginas online na sua conta do claude.ai e devolver o link. O que for publicado sai do computador; deixe desligado em projetos com dados sensíveis.";
export const AJUDA_DOS_ARTEFATOS_ONLINE_DO_CHAT =
  "O chat pode publicar páginas online na sua conta do claude.ai e devolver o link. O que for publicado sai do computador; deixe desligado em projetos com dados sensíveis.";

/** Na criação, "padrao" se chama Automático: o app não força nada e vale o padrão do Claude Code. */
export function rotuloDoEsforcoNaCriacao(esforco: EsforcoDeRaciocinio): string {
  return esforco === "padrao" ? "Automático" : ROTULOS_DOS_ESFORCOS[esforco];
}

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
    descricao: "Também executa comandos no terminal (testes, builds). Commit e push por feature só com a opção abaixo ligada.",
  },
};

/** Ex.: "Opus" ou, com um esforço escolhido, "Opus (esforço alto)". */
function descreverModelo(modelo: ModeloClaude, esforco: EsforcoDeRaciocinio): string {
  const nome = ROTULOS_DOS_MODELOS[modelo].nome;
  return esforco === "padrao" ? nome : `${nome} (esforço ${ROTULOS_DOS_ESFORCOS[esforco].toLowerCase()})`;
}

/**
 * Ex.: "Opus → Sonnet · até 3 subagentes · Somente leitura" (+ " · commit/push por feature", se liberado).
 * Com esforço escolhido (diferente de "padrao"): "Opus (esforço alto) → Sonnet (esforço médio) · …".
 * Com instruções personalizadas próprias, termina com " · instruções próprias".
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
    ...(configuracao.permitirCommitEPush ? ["commit/push por feature"] : []),
    ...(configuracao.permitirArtefatosOnline ? ["artefatos online"] : []),
    ...(configuracao.instrucoesPersonalizadas.trim() === "" ? [] : ["instruções próprias"]),
  ].join(" · ");
}

function ligado(valor: boolean): string {
  return valor ? "ligado" : "desligado";
}

/**
 * O que uma configuração parcial (ex.: a de uma predefinição) muda, um item
 * por campo presente — ex.: ["Modelo do orquestrador: Opus", "Esforço do orquestrador: Médio"].
 */
export function descreverAlteracoesDaConfiguracao(alteracoes: Partial<DadosDaConfiguracao>): string[] {
  const itens: string[] = [];
  if (alteracoes.modeloDoOrquestrador !== undefined) {
    itens.push(`Modelo do orquestrador: ${ROTULOS_DOS_MODELOS[alteracoes.modeloDoOrquestrador].nome}`);
  }
  if (alteracoes.esforcoDoOrquestrador !== undefined) {
    itens.push(`Esforço do orquestrador: ${ROTULOS_DOS_ESFORCOS[alteracoes.esforcoDoOrquestrador]}`);
  }
  if (alteracoes.modeloDosSubagentes !== undefined) {
    itens.push(`Modelo dos subagentes: ${ROTULOS_DOS_MODELOS[alteracoes.modeloDosSubagentes].nome}`);
  }
  if (alteracoes.esforcoDosSubagentes !== undefined) {
    itens.push(`Esforço dos subagentes: ${ROTULOS_DOS_ESFORCOS[alteracoes.esforcoDosSubagentes]}`);
  }
  if (alteracoes.quantidadeDeSubagentes !== undefined) {
    const { modo, limite } = alteracoes.quantidadeDeSubagentes;
    itens.push(`Quantidade de subagentes: ${modo === "fixa" ? "fixa" : "automática"}, ${descreverQuantidade({ modo, limite })}`);
  }
  if (alteracoes.nivelDePermissao !== undefined) {
    itens.push(`Permissões: ${ROTULOS_DAS_PERMISSOES[alteracoes.nivelDePermissao].nome}`);
  }
  if (alteracoes.permitirCommitEPush !== undefined) {
    itens.push(`Commit e push por feature: ${ligado(alteracoes.permitirCommitEPush)}`);
  }
  if (alteracoes.permitirArtefatosOnline !== undefined) {
    itens.push(`Artefatos online no claude.ai: ${ligado(alteracoes.permitirArtefatosOnline)}`);
  }
  return itens;
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

/** "5 horas" → "5h", "7 dias" → "7d": o nome curto de uma janela da cota. */
export function rotuloCurtoDaCota(nome: string): string {
  const [, numero, letra] = /^(\d+)\s*(\p{L})/u.exec(nome.trim()) ?? [];
  return numero === undefined || letra === undefined ? nome : `${numero}${letra.toLowerCase()}`;
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

/**
 * Quando uma janela da cota renova: "renova em 3 h 20 min", "renova em 45 min"
 * ou, a partir de um dia, "renova em 12/11, 14:00".
 */
export function descreverRenovacao(iso: string, agora: Date): string {
  const faltaMs = new Date(iso).getTime() - agora.getTime();
  if (faltaMs <= 0) {
    return "já renovou: o uso atualiza no próximo pedido";
  }
  const minutos = Math.ceil(faltaMs / 60_000);
  if (minutos < 60) {
    return `renova em ${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    const resto = minutos % 60;
    return `renova em ${horas} h${resto > 0 ? ` ${resto} min` : ""}`;
  }
  return `renova em ${formatarMomento(iso, agora)}`;
}
