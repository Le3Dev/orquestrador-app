import { useId, useMemo, useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import {
  type DadosDoGatilho,
  LIMITES_DAS_ROTINAS,
  type AoPerder,
  type ModoDoPedido,
  type TipoDeGatilho,
} from "../../shared/api/rotinas";
import { idiomaAtual, localeDoIdioma, useTextos } from "../../shared/idioma/idioma";
import { textosDeRotinas } from "../../shared/idioma/textos/rotinas";
import { Dica } from "../Dica";
import {
  type EtapaEmEdicao,
  etapaVazia,
  gatilhoParaOServidor,
  type GatilhoEmEdicao,
  problemaDaRotina,
  type RotinaEmEdicao,
} from "./edicao";
import { descreverGatilho, rotuloDoTipoDeEtapa } from "./textos";

/** Um orquestrador que um pedido pode receber (a tela tem a lista toda; aqui só o id e o nome importam). */
export interface OrquestradorEscolhivel {
  id: string;
  nome: string;
}

const TIPOS_DE_GATILHO: readonly TipoDeGatilho[] = ["diario", "semanal", "intervalo", "uma_vez"];

/** Na ordem em que a semana aparece (começa na segunda); o número é o do servidor (0 = domingo). */
const DIAS_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0] as const;
const VALORES_DE_AO_PERDER: readonly AoPerder[] = ["pular", "executar_ao_abrir"];
const VALORES_DE_MODO: readonly ModoDoPedido[] = ["execucao", "planejamento"];

const formatoDeInteiro = { format: (numero: number): string => new Intl.NumberFormat(localeDoIdioma(idiomaAtual())).format(numero) };

interface PropsDoGatilho {
  gatilho: GatilhoEmEdicao;
  aoMudar: (alteracao: Partial<GatilhoEmEdicao>) => void;
}

/** Os campos do "Quando": o tipo e, conforme ele, a hora, os dias, o intervalo ou a data. */
function CamposDoGatilho({ gatilho, aoMudar }: PropsDoGatilho) {
  const id = useId();
  const textos = useTextos(textosDeRotinas);
  const t = textos.editor;
  const alternarDia = (dia: number) =>
    aoMudar({ dias: gatilho.dias.includes(dia) ? gatilho.dias.filter((outro) => outro !== dia) : [...gatilho.dias, dia] });
  const convertido: DadosDoGatilho | null = gatilhoParaOServidor(gatilho);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={`${id}-tipo`}
          className="select campo-escuro select-do-subagente"
          aria-label={t.quandoARotinaRoda}
          value={gatilho.tipo}
          onChange={(evento) => aoMudar({ tipo: evento.target.value as TipoDeGatilho })}
        >
          {TIPOS_DE_GATILHO.map((tipo) => (
            <option key={tipo} value={tipo}>
              {t.opcoesDeGatilho[tipo]}
            </option>
          ))}
        </select>
        {(gatilho.tipo === "diario" || gatilho.tipo === "semanal") && (
          <label className="flex items-center gap-2 text-[12px] text-secondary">
            {t.as}
            <input
              type="time"
              className="input campo-escuro mono w-auto!"
              aria-label={t.horaDaRotina}
              value={gatilho.hora}
              onChange={(evento) => aoMudar({ hora: evento.target.value })}
            />
          </label>
        )}
        {gatilho.tipo === "intervalo" && (
          <label className="flex items-center gap-2 text-[12px] text-secondary">
            {t.aCada}
            <input
              type="number"
              className="input campo-escuro mono w-24!"
              aria-label={t.intervaloEmMinutos}
              min={LIMITES_DAS_ROTINAS.minimoDeMinutosDoIntervalo}
              max={LIMITES_DAS_ROTINAS.maximoDeMinutosDoIntervalo}
              step={1}
              value={gatilho.minutos}
              onChange={(evento) => aoMudar({ minutos: evento.target.value })}
            />
            {t.minutosRotulo}
          </label>
        )}
        {gatilho.tipo === "uma_vez" && (
          <input
            type="datetime-local"
            className="input campo-escuro mono w-auto!"
            aria-label={t.dataEHora}
            value={gatilho.em}
            onChange={(evento) => aoMudar({ em: evento.target.value })}
          />
        )}
      </div>
      {gatilho.tipo === "semanal" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.diasDaSemana}>
          {DIAS_DA_SEMANA.map((dia) => {
            const marcado = gatilho.dias.includes(dia);
            return (
              <button
                key={dia}
                type="button"
                className={`btn btn-sm ${marcado ? "btn-cta" : "btn-outline"}`}
                aria-pressed={marcado}
                aria-label={textos.nomesDosDias[dia]}
                onClick={() => alternarDia(dia)}
              >
                {t.diasCurtos[dia]}
              </button>
            );
          })}
        </div>
      )}
      {convertido !== null ? (
        <span className="hint">{descreverGatilho(convertido)}</span>
      ) : gatilho.tipo === "intervalo" ? (
        <span className="hint">
          {t.deAte(LIMITES_DAS_ROTINAS.minimoDeMinutosDoIntervalo, formatoDeInteiro.format(LIMITES_DAS_ROTINAS.maximoDeMinutosDoIntervalo))}
        </span>
      ) : null}
    </div>
  );
}

interface PropsDaEtapa {
  etapa: EtapaEmEdicao;
  numero: number;
  total: number;
  orquestradores: readonly OrquestradorEscolhivel[] | null;
  aoMudar: (alteracao: Partial<EtapaEmEdicao>) => void;
  aoMover: (deslocamento: -1 | 1) => void;
  aoRemover: () => void;
}

/** Uma etapa: o cabeçalho com subir, descer e remover, e os campos do tipo dela. */
function CamposDaEtapa({ etapa, numero, total, orquestradores, aoMudar, aoMover, aoRemover }: PropsDaEtapa) {
  const id = useId();
  const t = useTextos(textosDeRotinas).editor;
  const mudar = (alteracao: Record<string, unknown>) => aoMudar(alteracao as Partial<EtapaEmEdicao>);
  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface-2 p-3" aria-label={t.etapaN(numero)}>
      <div className="flex items-center gap-2">
        <span className="font-titulo text-[12.5px] font-medium text-primary">
          {t.etapaTipo(numero, rotuloDoTipoDeEtapa(etapa.tipo))}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-label={t.subirEtapa(numero)}
            title={t.subir}
            disabled={numero === 1}
            onClick={() => aoMover(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-label={t.descerEtapa(numero)}
            title={t.descer}
            disabled={numero === total}
            onClick={() => aoMover(1)}
          >
            ↓
          </button>
          <button type="button" className="btn btn-sm btn-danger" aria-label={t.removerEtapa(numero)} onClick={aoRemover}>
            {t.remover}
          </button>
        </span>
      </div>

      {etapa.tipo === "pedido" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="select campo-escuro select-do-subagente"
              aria-label={t.orquestradorDaEtapa(numero)}
              value={etapa.orquestradorId}
              disabled={orquestradores === null}
              onChange={(evento) => mudar({ orquestradorId: evento.target.value })}
            >
              <option value="">{orquestradores === null ? t.carregando : t.escolhaOOrquestrador}</option>
              {(orquestradores ?? []).map((orquestrador) => (
                <option key={orquestrador.id} value={orquestrador.id}>
                  {orquestrador.nome}
                </option>
              ))}
              {orquestradores !== null &&
                etapa.orquestradorId !== "" &&
                !orquestradores.some((orquestrador) => orquestrador.id === etapa.orquestradorId) && (
                  <option value={etapa.orquestradorId}>{t.orquestradorRemovido}</option>
                )}
            </select>
            <select
              className="select campo-escuro select-do-subagente"
              aria-label={t.modoDaEtapa(numero)}
              value={etapa.modo}
              onChange={(evento) => mudar({ modo: evento.target.value as ModoDoPedido })}
            >
              {VALORES_DE_MODO.map((modo) => (
                <option key={modo} value={modo}>
                  {t.opcoesDeModo[modo]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <textarea
              id={`${id}-texto`}
              className="textarea campo-escuro textarea-instrucoes custom-scrollbar"
              rows={4}
              aria-label={t.pedidoDaEtapa(numero)}
              placeholder={t.pedidoExemplo}
              aria-invalid={etapa.texto.length > LIMITES_DAS_ROTINAS.tamanhoDoTextoDoPedido}
              value={etapa.texto}
              onChange={(evento) => mudar({ texto: evento.target.value })}
            />
            <span
              className={`font-mono self-end text-[10.5px] ${etapa.texto.length > LIMITES_DAS_ROTINAS.tamanhoDoTextoDoPedido ? "text-error" : "text-muted"}`}
              aria-live="polite"
            >
              {formatoDeInteiro.format(etapa.texto.length)} / {formatoDeInteiro.format(LIMITES_DAS_ROTINAS.tamanhoDoTextoDoPedido)}
            </span>
          </div>
        </>
      )}

      {etapa.tipo === "aprovacao" && (
        <div className="flex flex-col gap-1">
          <textarea
            className="textarea campo-escuro custom-scrollbar"
            rows={2}
            maxLength={LIMITES_DAS_ROTINAS.tamanhoDaMensagemDeAprovacao}
            aria-label={t.mensagemDaEtapa(numero)}
            placeholder={t.mensagemExemplo}
            value={etapa.mensagem}
            onChange={(evento) => mudar({ mensagem: evento.target.value })}
          />
          <span className="hint">{t.aprovacaoAjuda}</span>
        </div>
      )}

      {etapa.tipo === "espera" && (
        <label className="flex items-center gap-2 text-[12px] text-secondary">
          {t.esperar}
          <input
            type="number"
            className="input campo-escuro mono w-24!"
            aria-label={t.minutosDaEspera(numero)}
            min={1}
            max={LIMITES_DAS_ROTINAS.maximoDeMinutosDaEspera}
            step={1}
            value={etapa.minutos}
            onChange={(evento) => mudar({ minutos: evento.target.value })}
          />
          {t.minutosAntesDeSeguir}
        </label>
      )}
    </li>
  );
}

interface Props {
  titulo: string;
  inicial: RotinaEmEdicao;
  /** O gatilho salvo, na edição (ver `problemaDaRotina`). */
  gatilhoSalvo?: DadosDoGatilho;
  /** A lista de orquestradores que existem; nula enquanto não chegou. */
  orquestradores: readonly OrquestradorEscolhivel[] | null;
  /** Rejeitar mostra a mensagem no editor e deixa tudo como está. */
  aoSalvar: (rotina: RotinaEmEdicao) => Promise<void>;
  aoCancelar: () => void;
}

/**
 * O editor de uma rotina: nome, quando roda, as etapas (adicionar, remover e
 * reordenar) e o que fazer se perder a hora. O Salvar só liga com tudo certo;
 * o que falta aparece ao lado, como "Para salvar, …".
 */
export function EditorDeRotina({ titulo, inicial, gatilhoSalvo, orquestradores, aoSalvar, aoCancelar }: Props) {
  const id = useId();
  const t = useTextos(textosDeRotinas).editor;
  const [rotina, setRotina] = useState<RotinaEmEdicao>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const existentes = useMemo(
    () => (orquestradores === null ? null : new Set(orquestradores.map((orquestrador) => orquestrador.id))),
    [orquestradores],
  );
  const problema = problemaDaRotina(rotina, { orquestradoresExistentes: existentes, ...(gatilhoSalvo ? { gatilhoSalvo } : {}) });
  const cheia = rotina.etapas.length >= LIMITES_DAS_ROTINAS.maximoDeEtapas;

  function mudarGatilho(alteracao: Partial<GatilhoEmEdicao>): void {
    setRotina((atual) => ({ ...atual, gatilho: { ...atual.gatilho, ...alteracao } }));
  }

  function mudarEtapa(chave: string, alteracao: Partial<EtapaEmEdicao>): void {
    setRotina((atual) => ({
      ...atual,
      etapas: atual.etapas.map((etapa) => (etapa.chave === chave ? ({ ...etapa, ...alteracao } as EtapaEmEdicao) : etapa)),
    }));
  }

  function moverEtapa(indice: number, deslocamento: -1 | 1): void {
    setRotina((atual) => {
      const destino = indice + deslocamento;
      if (destino < 0 || destino >= atual.etapas.length) {
        return atual;
      }
      const etapas = [...atual.etapas];
      const [movida] = etapas.splice(indice, 1);
      if (movida !== undefined) {
        etapas.splice(destino, 0, movida);
      }
      return { ...atual, etapas };
    });
  }

  function adicionarEtapa(tipo: EtapaEmEdicao["tipo"]): void {
    // Um pedido novo já sai com o orquestrador do pedido anterior: o comum é a rotina falar com um só.
    const anterior = [...rotina.etapas].reverse().find((etapa) => etapa.tipo === "pedido");
    const orquestradorId = anterior?.tipo === "pedido" ? anterior.orquestradorId : "";
    setRotina((atual) => ({ ...atual, etapas: [...atual.etapas, etapaVazia(tipo, orquestradorId)] }));
  }

  async function salvar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      await aoSalvar(rotina);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={titulo}
      onSubmit={(evento) => {
        evento.preventDefault();
        if (problema === null && !salvando) {
          void salvar();
        }
      }}
    >
      <div className="subagentes-editor custom-scrollbar">
        <div className="linha-de-campo">
          <span className="rotulo-de-campo">
            <label htmlFor={`${id}-nome`}>{t.nome}</label>
          </span>
          <input
            id={`${id}-nome`}
            className="input campo-escuro"
            value={rotina.nome}
            maxLength={LIMITES_DAS_ROTINAS.tamanhoDoNome}
            placeholder={t.nomeExemplo}
            onChange={(evento) => setRotina((atual) => ({ ...atual, nome: evento.target.value }))}
          />
        </div>

        <div className="linha-de-campo">
          <span className="rotulo-de-campo">
            {t.quando}
            <Dica sobre={t.quando} titulo={t.quandoTitulo}>
              {t.quandoAjuda}
            </Dica>
          </span>
          <CamposDoGatilho gatilho={rotina.gatilho} aoMudar={mudarGatilho} />
        </div>

        <div className="linha-de-campo">
          <span className="rotulo-de-campo">
            {t.etapas}
            <Dica sobre={t.etapas} titulo={t.etapasTitulo}>
              {t.etapasAjuda(LIMITES_DAS_ROTINAS.maximoDeEtapas)}
            </Dica>
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t.etapasDaRotina}>
              {rotina.etapas.map((etapa, indice) => (
                <CamposDaEtapa
                  key={etapa.chave}
                  etapa={etapa}
                  numero={indice + 1}
                  total={rotina.etapas.length}
                  orquestradores={orquestradores}
                  aoMudar={(alteracao) => mudarEtapa(etapa.chave, alteracao)}
                  aoMover={(deslocamento) => moverEtapa(indice, deslocamento)}
                  aoRemover={() =>
                    setRotina((atual) => ({ ...atual, etapas: atual.etapas.filter((outra) => outra.chave !== etapa.chave) }))
                  }
                />
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-sm btn-outline" disabled={cheia} onClick={() => adicionarEtapa("pedido")}>
                {t.maisPedido}
              </button>
              <button type="button" className="btn btn-sm btn-outline" disabled={cheia} onClick={() => adicionarEtapa("aprovacao")}>
                {t.maisAprovacao}
              </button>
              <button type="button" className="btn btn-sm btn-outline" disabled={cheia} onClick={() => adicionarEtapa("espera")}>
                {t.maisEspera}
              </button>
              <span className={`mono ml-auto ${cheia ? "text-warning" : "text-muted"}`}>
                {rotina.etapas.length} / {LIMITES_DAS_ROTINAS.maximoDeEtapas}
              </span>
            </div>
          </div>
        </div>

        <div className="linha-de-campo">
          <span className="rotulo-de-campo">
            <label htmlFor={`${id}-ao-perder`}>{t.sePerderAHora}</label>
            <Dica sobre={t.sePerderAHora} titulo={t.sePerderTitulo}>
              {t.sePerderAjuda}
            </Dica>
          </span>
          <select
            id={`${id}-ao-perder`}
            className="select campo-escuro select-do-subagente"
            value={rotina.aoPerder}
            onChange={(evento) => setRotina((atual) => ({ ...atual, aoPerder: evento.target.value as AoPerder }))}
          >
            {VALORES_DE_AO_PERDER.map((valor) => (
              <option key={valor} value={valor}>
                {t.opcoesDeAoPerder[valor]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {erro !== null && (
        <div className="alert alert-error mx-4 mb-1" role="alert">
          {erro}
        </div>
      )}
      <div className="painel-da-barra-rodape">
        {problema !== null && <span className="mr-auto text-[11px] text-warning">{t.paraSalvar(problema)}</span>}
        <button type="button" className="btn btn-sm btn-ghost" onClick={aoCancelar}>
          {t.cancelar}
        </button>
        <button type="submit" className="btn btn-sm btn-cta" disabled={salvando || problema !== null}>
          {salvando ? t.salvando : t.salvar}
        </button>
      </div>
    </form>
  );
}
