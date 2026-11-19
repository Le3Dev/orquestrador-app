import type { DadosDaConfiguracao, EsforcoDeRaciocinio, ModeloClaude, ModeloDoMotor, Motor, NivelDePermissao } from "./api/tipos";
import {
  ehModeloClaude,
  MODELO_PADRAO_DO_CLI,
  motorDoOrquestradorDe,
  motorDosSubagentesDe,
  ordemDeReservaDe,
  rotuloDoMotor,
} from "./modelos";
import { idiomaAtual, localeDoIdioma, textosAtuais } from "./idioma/idioma";
import { textosDeConfiguracoes } from "./idioma/textos/configuracoes";

const textos = () => textosAtuais(textosDeConfiguracoes);

/** Um Record cujos valores acompanham o idioma atual (lidos a cada acesso), sem mudar a API de constante. */
function rotulosDinamicos<C extends string, V>(chaves: readonly C[], ler: (chave: C) => V): Readonly<Record<C, V>> {
  const objeto = {} as Record<C, V>;
  for (const chave of chaves) {
    Object.defineProperty(objeto, chave, { enumerable: true, get: () => ler(chave) });
  }
  return objeto;
}

export const ROTULOS_DOS_MODELOS: Readonly<Record<ModeloClaude, { nome: string; descricao: string }>> =
  rotulosDinamicos(["fable", "opus", "sonnet", "haiku"], (modelo) => textos().modelos[modelo]);

// "padrao" não força nada: vale o settings.json do Claude Code da máquina ou, sem ele, o padrão do modelo.
export const ROTULOS_DOS_ESFORCOS: Readonly<Record<EsforcoDeRaciocinio, string>> = rotulosDinamicos(
  ["padrao", "baixo", "medio", "alto", "extra_alto", "maximo", "ultracode"],
  (esforco) => textos().esforcos[esforco],
);

/** Na criação, "padrao" se chama Automático: o app não força nada e vale o padrão do Claude Code. */
export function rotuloDoEsforcoNaCriacao(esforco: EsforcoDeRaciocinio): string {
  return esforco === "padrao" ? textos().esforcos.automaticoNaCriacao : ROTULOS_DOS_ESFORCOS[esforco];
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
  return textos().descricoes.agentes(limite, modo === "fixa");
}

export const ROTULOS_DAS_PERMISSOES: Readonly<Record<NivelDePermissao, { nome: string; descricao: string }>> =
  rotulosDinamicos(["leitura", "edicao", "edicao_e_comandos"], (nivel) => textos().permissoes[nivel]);

/** O nome do modelo sem versão: "Opus" no Claude Code; nos outros motores, o próprio id. */
function nomeDoModelo(modelo: ModeloDoMotor): string {
  return ehModeloClaude(modelo) ? ROTULOS_DOS_MODELOS[modelo].nome : modelo;
}

/**
 * Ex.: "Opus" ou, com um esforço escolhido, "Opus (esforço alto)". Nos outros motores, o motor e o modelo
 * ("Codex" com o modelo do CLI; "Codex gpt-5" com um escolhido), sem esforço: só o Claude Code o aplica.
 */
function descreverModelo(motor: Motor, modelo: ModeloDoMotor, esforco: EsforcoDeRaciocinio): string {
  if (motor !== "claude-code") {
    return modelo === MODELO_PADRAO_DO_CLI ? rotuloDoMotor(motor) : `${rotuloDoMotor(motor)} ${modelo}`;
  }
  const nome = nomeDoModelo(modelo);
  return esforco === "padrao" ? nome : textos().descricoes.esforcoDoModelo(nome, ROTULOS_DOS_ESFORCOS[esforco].toLowerCase());
}

/**
 * Ex.: "Opus → Sonnet · até 3 subagentes · Somente leitura" (+ " · commit/push por feature", se liberado).
 * Com esforço escolhido (diferente de "padrao"): "Opus (esforço alto) → Sonnet (esforço médio) · …".
 * Com instruções personalizadas próprias, termina com " · instruções próprias".
 */
export function descreverConfiguracao(configuracao: DadosDaConfiguracao): string {
  const { modo, limite } = configuracao.quantidadeDeSubagentes;
  const d = textos().descricoes;
  const quantidade = d.quantidade(limite, modo === "fixa");
  const orquestrador = descreverModelo(
    motorDoOrquestradorDe(configuracao),
    configuracao.modeloDoOrquestrador,
    configuracao.esforcoDoOrquestrador,
  );
  const subagentes = descreverModelo(
    motorDosSubagentesDe(configuracao),
    configuracao.modeloDosSubagentes,
    configuracao.esforcoDosSubagentes,
  );
  const reserva = ordemDeReservaDe(configuracao);
  return [
    `${orquestrador} → ${subagentes}`,
    quantidade,
    ROTULOS_DAS_PERMISSOES[configuracao.nivelDePermissao].nome,
    ...(reserva.length > 0 ? [d.reserva(reserva.map(rotuloDoMotor).join(", "))] : []),
    ...(configuracao.permitirCommitEPush ? [d.commitEPush] : []),
    ...(configuracao.permitirArtefatosOnline ? [d.artefatosOnline] : []),
    ...(configuracao.navegadorDoAgente === true ? [d.navegadorDoAgente] : []),
    ...(configuracao.instrucoesPersonalizadas.trim() === "" ? [] : [d.instrucoesProprias]),
  ].join(" · ");
}

/**
 * O que uma configuração parcial (ex.: a de uma predefinição) muda, um item
 * por campo presente — ex.: ["Modelo do orquestrador: Opus", "Esforço do orquestrador: Médio"].
 */
export function descreverAlteracoesDaConfiguracao(alteracoes: Partial<DadosDaConfiguracao>): string[] {
  const itens: string[] = [];
  const d = textos().descricoes;
  if (alteracoes.motorDoOrquestrador !== undefined) {
    itens.push(d.motorDoOrquestrador(rotuloDoMotor(alteracoes.motorDoOrquestrador)));
  }
  if (alteracoes.modeloDoOrquestrador !== undefined) {
    itens.push(d.modeloDoOrquestrador(nomeDoModelo(alteracoes.modeloDoOrquestrador)));
  }
  if (alteracoes.esforcoDoOrquestrador !== undefined) {
    itens.push(d.esforcoDoOrquestrador(ROTULOS_DOS_ESFORCOS[alteracoes.esforcoDoOrquestrador]));
  }
  if (alteracoes.motorDosSubagentes !== undefined) {
    itens.push(d.motorDosSubagentes(rotuloDoMotor(alteracoes.motorDosSubagentes)));
  }
  if (alteracoes.modeloDosSubagentes !== undefined) {
    itens.push(d.modeloDosSubagentes(nomeDoModelo(alteracoes.modeloDosSubagentes)));
  }
  if (alteracoes.esforcoDosSubagentes !== undefined) {
    itens.push(d.esforcoDosSubagentes(ROTULOS_DOS_ESFORCOS[alteracoes.esforcoDosSubagentes]));
  }
  if (alteracoes.quantidadeDeSubagentes !== undefined) {
    const { modo, limite } = alteracoes.quantidadeDeSubagentes;
    itens.push(d.quantidadeDeSubagentes(modo === "fixa", descreverQuantidade({ modo, limite })));
  }
  if (alteracoes.nivelDePermissao !== undefined) {
    itens.push(d.permissoes(ROTULOS_DAS_PERMISSOES[alteracoes.nivelDePermissao].nome));
  }
  if (alteracoes.permitirCommitEPush !== undefined) {
    itens.push(d.commitEPushPorFeature(alteracoes.permitirCommitEPush));
  }
  if (alteracoes.permitirArtefatosOnline !== undefined) {
    itens.push(d.artefatosOnlineNoClaude(alteracoes.permitirArtefatosOnline));
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

/** Um formatador por idioma, criado na primeira vez (o idioma muda em tempo de execução). */
function porIdioma<F>(criar: (locale: string) => F): () => F {
  const cache = new Map<string, F>();
  return () => {
    const locale = localeDoIdioma(idiomaAtual());
    let formatador = cache.get(locale);
    if (formatador === undefined) {
      formatador = criar(locale);
      cache.set(locale, formatador);
    }
    return formatador;
  };
}

const numeroCompacto = porIdioma((locale) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }));

export function formatarTokens(tokens: number): string {
  return numeroCompacto().format(tokens);
}

/** Ex.: "480 MB", "1,9 GB". */
export function formatarBytes(bytes: number): string {
  const mega = bytes / 1024 ** 2;
  if (mega < 1024) {
    return `${Math.round(mega)} MB`;
  }
  return `${(mega / 1024).toLocaleString(localeDoIdioma(idiomaAtual()), { maximumFractionDigits: 1 })} GB`;
}

export function formatarPercentual(fracao: number): string {
  return `${Math.round(fracao * 100)}%`;
}

/** "5 horas" → "5h", "7 dias" → "7d": o nome curto de uma janela da cota. */
export function rotuloCurtoDaCota(nome: string): string {
  const [, numero, letra] = /^(\d+)\s*(\p{L})/u.exec(nome.trim()) ?? [];
  return numero === undefined || letra === undefined ? nome : `${numero}${letra.toLowerCase()}`;
}

const horario = porIdioma((locale) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }));
const horarioComSegundos = porIdioma(
  (locale) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
);

/** Ex.: "16:31:27" — para o terminal de eventos. */
export function formatarHora(iso: string): string {
  return horarioComSegundos().format(new Date(iso));
}
const dataEHora = porIdioma(
  (locale) => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
);

/** Só o horário para hoje; data e horário para dias anteriores. */
export function formatarMomento(iso: string, agora: Date = new Date()): string {
  const momento = new Date(iso);
  return momento.toDateString() === agora.toDateString() ? horario().format(momento) : dataEHora().format(momento);
}

/**
 * Quando uma janela da cota renova: "renova em 3 h 20 min", "renova em 45 min"
 * ou, a partir de um dia, "renova em 12/11, 14:00".
 */
export function descreverRenovacao(iso: string, agora: Date): string {
  const faltaMs = new Date(iso).getTime() - agora.getTime();
  if (faltaMs <= 0) {
    return textos().renovacao.jaRenovou;
  }
  const minutos = Math.ceil(faltaMs / 60_000);
  if (minutos < 60) {
    return textos().renovacao.emMinutos(minutos);
  }
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    const resto = minutos % 60;
    return textos().renovacao.emHoras(horas, resto);
  }
  return textos().renovacao.emMomento(formatarMomento(iso, agora));
}
