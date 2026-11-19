import {
  AO_PERDER_PADRAO,
  type AlteracoesDaRotina,
  type AoPerder,
  type DadosDaEtapa,
  type DadosDaRotina,
  type DadosDoGatilho,
  LIMITES_DAS_ROTINAS,
  type ModoDoPedido,
  type NovaRotina,
  type TipoDeGatilho,
} from "../../shared/api/rotinas";
import { idiomaAtual, localeDoIdioma, textosAtuais } from "../../shared/idioma/idioma";
import { textosDeRotinas } from "../../shared/idioma/textos/rotinas";
import { mesmoConteudo } from "../../shared/hooks/useReaproveitado";

/**
 * A rotina como o editor a guarda enquanto o usuário digita: números e datas
 * ficam em texto (um campo vazio não é zero) e cada etapa leva uma chave
 * estável para a lista reordenar sem trocar o que foi digitado.
 */

export interface GatilhoEmEdicao {
  tipo: TipoDeGatilho;
  /** "HH:MM", dos gatilhos diário e semanal. */
  hora: string;
  /** De 0 (domingo) a 6 (sábado), do gatilho semanal. */
  dias: number[];
  /** Do gatilho de intervalo. */
  minutos: string;
  /** "AAAA-MM-DDTHH:MM" (hora local, como o `datetime-local`), do gatilho de uma vez. */
  em: string;
}

export type EtapaEmEdicao =
  | { chave: string; tipo: "pedido"; orquestradorId: string; texto: string; modo: ModoDoPedido }
  | { chave: string; tipo: "aprovacao"; mensagem: string }
  | { chave: string; tipo: "espera"; minutos: string };

export interface RotinaEmEdicao {
  nome: string;
  gatilho: GatilhoEmEdicao;
  etapas: EtapaEmEdicao[];
  aoPerder: AoPerder;
}

let contadorDeChaves = 0;

/** Uma chave que nunca se repete, para as etapas. */
export function novaChaveDeEtapa(): string {
  contadorDeChaves += 1;
  return `etapa-${contadorDeChaves}`;
}

export function etapaVazia(tipo: EtapaEmEdicao["tipo"], orquestradorId = ""): EtapaEmEdicao {
  const chave = novaChaveDeEtapa();
  switch (tipo) {
    case "pedido":
      return { chave, tipo, orquestradorId, texto: "", modo: "execucao" };
    case "aprovacao":
      return { chave, tipo, mensagem: "" };
    case "espera":
      return { chave, tipo, minutos: "15" };
  }
}

export function gatilhoPadrao(): GatilhoEmEdicao {
  return { tipo: "diario", hora: "09:00", dias: [1], minutos: "60", em: "" };
}

/** A rotina em branco do "Nova rotina": um pedido vazio, todo dia às 09:00, perdida a hora, pula. */
export function rotinaVazia(orquestradorId = ""): RotinaEmEdicao {
  return { nome: "", gatilho: gatilhoPadrao(), etapas: [etapaVazia("pedido", orquestradorId)], aoPerder: AO_PERDER_PADRAO };
}

function doisDigitos(numero: number): string {
  return String(numero).padStart(2, "0");
}

/** ISO → "AAAA-MM-DDTHH:MM" na hora local, o que o `datetime-local` entende. */
export function isoParaCampoLocal(iso: string): string {
  const momento = new Date(iso);
  if (Number.isNaN(momento.getTime())) {
    return "";
  }
  return `${momento.getFullYear()}-${doisDigitos(momento.getMonth() + 1)}-${doisDigitos(momento.getDate())}T${doisDigitos(momento.getHours())}:${doisDigitos(momento.getMinutes())}`;
}

function gatilhoEmEdicao(gatilho: DadosDoGatilho): GatilhoEmEdicao {
  const base = gatilhoPadrao();
  switch (gatilho.tipo) {
    case "diario":
      return { ...base, tipo: "diario", hora: gatilho.hora };
    case "semanal":
      return { ...base, tipo: "semanal", hora: gatilho.hora, dias: [...gatilho.dias] };
    case "intervalo":
      return { ...base, tipo: "intervalo", minutos: String(gatilho.minutos) };
    case "uma_vez":
      return { ...base, tipo: "uma_vez", em: isoParaCampoLocal(gatilho.em) };
  }
}

function etapaEmEdicao(etapa: DadosDaEtapa): EtapaEmEdicao {
  const chave = novaChaveDeEtapa();
  switch (etapa.tipo) {
    case "pedido":
      return { chave, tipo: "pedido", orquestradorId: etapa.orquestradorId, texto: etapa.texto, modo: etapa.modo };
    case "aprovacao":
      return { chave, tipo: "aprovacao", mensagem: etapa.mensagem };
    case "espera":
      return { chave, tipo: "espera", minutos: String(etapa.minutos) };
  }
}

export function emEdicao(rotina: Pick<DadosDaRotina, "nome" | "gatilho" | "etapas" | "aoPerder">): RotinaEmEdicao {
  return {
    nome: rotina.nome,
    gatilho: gatilhoEmEdicao(rotina.gatilho),
    etapas: rotina.etapas.map(etapaEmEdicao),
    aoPerder: rotina.aoPerder,
  };
}

const FORMATO_DA_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Só números inteiros em texto ("15", não "1.5" nem "1e3"); vazio ou outra coisa, NaN. */
function inteiroDoCampo(texto: string): number {
  return /^\d+$/.test(texto.trim()) ? Number(texto.trim()) : Number.NaN;
}

/** O gatilho já no formato do servidor; nulo se o campo está incompleto ou inválido. */
export function gatilhoParaOServidor(gatilho: GatilhoEmEdicao): DadosDoGatilho | null {
  switch (gatilho.tipo) {
    case "diario":
      return FORMATO_DA_HORA.test(gatilho.hora) ? { tipo: "diario", hora: gatilho.hora } : null;
    case "semanal": {
      const dias = [...new Set(gatilho.dias)].sort((a, b) => a - b);
      return FORMATO_DA_HORA.test(gatilho.hora) && dias.length > 0 ? { tipo: "semanal", dias, hora: gatilho.hora } : null;
    }
    case "intervalo": {
      const minutos = inteiroDoCampo(gatilho.minutos);
      return minutos >= LIMITES_DAS_ROTINAS.minimoDeMinutosDoIntervalo && minutos <= LIMITES_DAS_ROTINAS.maximoDeMinutosDoIntervalo
        ? { tipo: "intervalo", minutos }
        : null;
    }
    case "uma_vez": {
      const momento = new Date(gatilho.em);
      return gatilho.em === "" || Number.isNaN(momento.getTime()) ? null : { tipo: "uma_vez", em: momento.toISOString() };
    }
  }
}

function etapaParaOServidor(etapa: EtapaEmEdicao): DadosDaEtapa {
  switch (etapa.tipo) {
    case "pedido":
      return { tipo: "pedido", orquestradorId: etapa.orquestradorId, texto: etapa.texto, modo: etapa.modo };
    case "aprovacao":
      return { tipo: "aprovacao", mensagem: etapa.mensagem.trim() };
    case "espera":
      return { tipo: "espera", minutos: inteiroDoCampo(etapa.minutos) };
  }
}

const formatoDeInteiro = { format: (numero: number): string => new Intl.NumberFormat(localeDoIdioma(idiomaAtual())).format(numero) };
const problemas = () => textosAtuais(textosDeRotinas).problemas;

interface OpcoesDaConferencia {
  /** Os ids dos orquestradores que existem; nulo enquanto a lista não chegou (não dá para conferir). */
  orquestradoresExistentes: ReadonlySet<string> | null;
  /** O gatilho salvo, na edição: se não mudou, a hora passada de uma execução única não impede salvar. */
  gatilhoSalvo?: DadosDoGatilho;
  agora?: Date;
}

function problemaDoGatilho(gatilho: GatilhoEmEdicao, { gatilhoSalvo, agora = new Date() }: OpcoesDaConferencia): string | null {
  if ((gatilho.tipo === "diario" || gatilho.tipo === "semanal") && !FORMATO_DA_HORA.test(gatilho.hora)) {
    return problemas().escolhaAHora;
  }
  if (gatilho.tipo === "semanal" && gatilho.dias.length === 0) {
    return problemas().escolhaUmDia;
  }
  if (gatilho.tipo === "intervalo" && gatilhoParaOServidor(gatilho) === null) {
    return problemas().intervalo(
      LIMITES_DAS_ROTINAS.minimoDeMinutosDoIntervalo,
      formatoDeInteiro.format(LIMITES_DAS_ROTINAS.maximoDeMinutosDoIntervalo),
    );
  }
  if (gatilho.tipo === "uma_vez") {
    const convertido = gatilhoParaOServidor(gatilho);
    if (convertido === null || convertido.tipo !== "uma_vez") {
      return problemas().escolhaDataEHora;
    }
    const igualAoSalvo = gatilhoSalvo?.tipo === "uma_vez" && Date.parse(gatilhoSalvo.em) === Date.parse(convertido.em);
    if (!igualAoSalvo && Date.parse(convertido.em) <= agora.getTime()) {
      return problemas().escolhaFuturo;
    }
  }
  return null;
}

function problemaDaEtapa(etapa: EtapaEmEdicao, numero: number, { orquestradoresExistentes }: OpcoesDaConferencia): string | null {
  const p = problemas();
  const comEtapa = (problema: string) => p.etapa(numero, problema);
  switch (etapa.tipo) {
    case "pedido":
      if (etapa.orquestradorId === "") {
        return comEtapa(p.escolhaOrquestrador);
      }
      if (orquestradoresExistentes !== null && !orquestradoresExistentes.has(etapa.orquestradorId)) {
        return comEtapa(p.orquestradorNaoExiste);
      }
      if (etapa.texto.trim() === "") {
        return comEtapa(p.escrevaOPedido);
      }
      if (etapa.texto.length > LIMITES_DAS_ROTINAS.tamanhoDoTextoDoPedido) {
        return comEtapa(p.encurtePedido(formatoDeInteiro.format(LIMITES_DAS_ROTINAS.tamanhoDoTextoDoPedido)));
      }
      return null;
    case "aprovacao":
      if (etapa.mensagem.trim() === "") {
        return comEtapa(p.escrevaAMensagem);
      }
      if (etapa.mensagem.trim().length > LIMITES_DAS_ROTINAS.tamanhoDaMensagemDeAprovacao) {
        return comEtapa(p.encurteMensagem(formatoDeInteiro.format(LIMITES_DAS_ROTINAS.tamanhoDaMensagemDeAprovacao)));
      }
      return null;
    case "espera": {
      const minutos = inteiroDoCampo(etapa.minutos);
      return minutos >= 1 && minutos <= LIMITES_DAS_ROTINAS.maximoDeMinutosDaEspera
        ? null
        : comEtapa(p.espera(formatoDeInteiro.format(LIMITES_DAS_ROTINAS.maximoDeMinutosDaEspera)));
    }
  }
}

/**
 * O que impede salvar a rotina (em minúscula, para seguir "Para salvar,"), na
 * ordem em que a tela mostra os campos; nulo se está tudo certo. O servidor
 * confere de novo e responde com a mensagem exata se algo escapar.
 */
export function problemaDaRotina(rotina: RotinaEmEdicao, opcoes: OpcoesDaConferencia): string | null {
  const nome = rotina.nome.trim();
  if (nome === "") {
    return problemas().deUmNome;
  }
  if (nome.length > LIMITES_DAS_ROTINAS.tamanhoDoNome) {
    return problemas().encurteNome(LIMITES_DAS_ROTINAS.tamanhoDoNome);
  }
  const doGatilho = problemaDoGatilho(rotina.gatilho, opcoes);
  if (doGatilho !== null) {
    return doGatilho;
  }
  if (rotina.etapas.length < LIMITES_DAS_ROTINAS.minimoDeEtapas) {
    return problemas().umaEtapa;
  }
  if (rotina.etapas.length > LIMITES_DAS_ROTINAS.maximoDeEtapas) {
    return problemas().maxEtapas(LIMITES_DAS_ROTINAS.maximoDeEtapas);
  }
  for (const [indice, etapa] of rotina.etapas.entries()) {
    const problema = problemaDaEtapa(etapa, indice + 1, opcoes);
    if (problema !== null) {
      return problema;
    }
  }
  return null;
}

/** O corpo do POST. Só vale com `problemaDaRotina` nulo. */
export function paraNovaRotina(rotina: RotinaEmEdicao): NovaRotina {
  const gatilho = gatilhoParaOServidor(rotina.gatilho);
  if (gatilho === null) {
    throw new Error(problemas().gatilhoIncompleto);
  }
  return {
    nome: rotina.nome.trim(),
    gatilho,
    etapas: rotina.etapas.map(etapaParaOServidor),
    aoPerder: rotina.aoPerder,
  };
}

/** O corpo do PATCH: só o que mudou em relação ao que está salvo. Vazio, nada a salvar. */
export function paraAlteracoes(
  rotina: RotinaEmEdicao,
  salva: Pick<DadosDaRotina, "nome" | "gatilho" | "etapas" | "aoPerder">,
): AlteracoesDaRotina {
  const nova = paraNovaRotina(rotina);
  const alteracoes: AlteracoesDaRotina = {};
  if (nova.nome !== salva.nome) {
    alteracoes.nome = nova.nome;
  }
  if (!mesmoConteudo(nova.gatilho, gatilhoNormalizado(salva.gatilho))) {
    alteracoes.gatilho = nova.gatilho;
  }
  if (!mesmoConteudo(nova.etapas, salva.etapas)) {
    alteracoes.etapas = nova.etapas;
  }
  if (nova.aoPerder !== salva.aoPerder) {
    alteracoes.aoPerder = nova.aoPerder;
  }
  return alteracoes;
}

/** Os dias do gatilho semanal e o instante do de uma vez do jeito que `gatilhoParaOServidor` os escreve, para comparar. */
function gatilhoNormalizado(gatilho: DadosDoGatilho): DadosDoGatilho {
  switch (gatilho.tipo) {
    case "semanal":
      return { tipo: "semanal", dias: [...new Set(gatilho.dias)].sort((a, b) => a - b), hora: gatilho.hora };
    case "uma_vez": {
      const momento = new Date(gatilho.em);
      return Number.isNaN(momento.getTime()) ? gatilho : { tipo: "uma_vez", em: momento.toISOString() };
    }
    default:
      return gatilho;
  }
}
