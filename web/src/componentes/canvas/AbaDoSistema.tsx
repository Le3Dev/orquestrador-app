import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { LeituraDeMemoria } from "../../shared/api/tipos";
import { LIMITE_DE_ORQUESTRADORES_ABERTOS } from "../../shared/canvas/limiteDeTerminais";
import type { AjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { definirAutorrecuperacao, useValorDaAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeConfiguracoes } from "../../shared/idioma/textos/configuracoes";
import { nivelDaMemoria } from "../../shared/memoria";
import { InterruptorDaConfiguracao, LinhaDaConfiguracao } from "./ControlesDasConfiguracoes";
import { type OrquestradorDaTabela, formatarGb, formatarMb, ordenarOrquestradores } from "./usoDoSistema";

const RAIO = 40;
const TRACO = 7;
const TAMANHO = 92;
const CIRCUNFERENCIA = 2 * Math.PI * RAIO;

function limitar(fracao: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(fracao) ? fracao : 0));
}

/** O cartão do topo: anel de uso, nível, GB livres e a barra empilhada. */
function CartaoDaMemoria({ memoria }: { memoria: LeituraDeMemoria }) {
  const t = useTextos(textosDeConfiguracoes).sistema;
  const nivel = nivelDaMemoria(memoria);
  const usadaBytes = Math.max(0, memoria.totalBytes - memoria.livreBytes);
  const usada = limitar(memoria.totalBytes > 0 ? usadaBytes / memoria.totalBytes : 0);
  const percentual = Math.round(usada * 100);
  const agentes = Math.max(0, memoria.agentesBytes);
  const app = Math.max(0, memoria.servidorBytes);
  const outros = Math.max(0, usadaBytes - agentes - app);
  const parte = (bytes: number) => `${limitar(memoria.totalBytes > 0 ? bytes / memoria.totalBytes : 0) * 100}%`;
  const livreTexto = formatarGb(memoria.livreBytes);
  const rotuloDoAnel = t.anelAria(percentual, t.memoria[nivel]);
  const rotuloDaBarra = t.barraAria(formatarGb(agentes), formatarGb(app), formatarGb(outros), livreTexto);

  return (
    <div className={`cfgapp-cartao cfgapp-memoria-cartao ${nivel === "critica" ? "cfgapp-critico" : ""}`} data-testid="cartao-de-memoria">
      <div className="cfgapp-memoria">
        <div className={`cfgapp-anel cfgapp-anel-${nivel}`} role="img" aria-label={rotuloDoAnel}>
          <svg width={TAMANHO} height={TAMANHO} viewBox={`0 0 ${TAMANHO} ${TAMANHO}`} aria-hidden="true">
            <circle className="cfgapp-anel-trilha" cx={TAMANHO / 2} cy={TAMANHO / 2} r={RAIO} fill="none" strokeWidth={TRACO} />
            <circle
              className="cfgapp-anel-arco"
              cx={TAMANHO / 2}
              cy={TAMANHO / 2}
              r={RAIO}
              fill="none"
              strokeWidth={TRACO}
              strokeLinecap="round"
              strokeDasharray={`${CIRCUNFERENCIA * usada} ${CIRCUNFERENCIA}`}
              transform={`rotate(-90 ${TAMANHO / 2} ${TAMANHO / 2})`}
            />
          </svg>
          <b aria-hidden="true">
            {percentual}%<small>{t.emUso}</small>
          </b>
        </div>
        <div className="cfgapp-memoria-texto">
          <h4 className={nivel === "critica" ? "cfgapp-critico-titulo" : undefined}>{t.memoria[nivel]}</h4>
          <p>
            {t.livreDe(livreTexto, formatarGb(memoria.totalBytes), livreTexto === "1 GB", t.fraseDoNivel[nivel])}
          </p>
          <div className="cfgapp-empilhada" role="img" aria-label={rotuloDaBarra}>
            <i className="cfgapp-agentes" style={{ width: parte(agentes) }} />
            <i className="cfgapp-app" style={{ width: parte(app) }} />
            <i className="cfgapp-outros" style={{ width: parte(outros) }} />
          </div>
          <div className="cfgapp-legenda">
            <span>
              <i className="cfgapp-agentes" aria-hidden="true" />
              {t.legendaAgentes(formatarGb(agentes))}
            </span>
            <span>
              <i className="cfgapp-app" aria-hidden="true" />
              {t.legendaApp(formatarGb(app))}
            </span>
            <span>
              <i className="cfgapp-outros" aria-hidden="true" />
              {t.legendaOutros(formatarGb(outros))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabelaDeUso({
  orquestradores,
  porOrquestrador,
}: {
  orquestradores: readonly OrquestradorDaTabela[];
  porOrquestrador: Record<string, number>;
}) {
  const t = useTextos(textosDeConfiguracoes).sistema;
  const linhas = ordenarOrquestradores(orquestradores, porOrquestrador);
  return (
    <div className="cfgapp-cartao">
      {linhas.length === 0 ? (
        <p className="cfgapp-vazio">{t.nenhumOrquestrador}</p>
      ) : (
        <table className="cfgapp-tabela">
          <caption className="sr-only">{t.legendaDaTabela}</caption>
          <thead>
            <tr>
              <th scope="col">{t.colunaOrquestrador}</th>
              <th scope="col">{t.colunaSituacao}</th>
              <th scope="col" className="cfgapp-numero">
                {t.colunaMemoria}
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.id}>
                <td className="cfgapp-tabela-nome">{linha.nome}</td>
                <td>{linha.situacao === "trabalhando" ? t.trabalhando : t.parado}</td>
                <td className="cfgapp-numero">{formatarMb(linha.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface Props {
  /** Os Ajustes do app desktop (pastas e Claude Code). */
  ajustes: AjustesDoAplicativo;
  /** A leitura de memória do servidor; sem ela, vale `sistema`. */
  memoria?: LeituraDeMemoria | null;
  /** O orquestradores, para a tabela de uso. */
  orquestradores?: readonly OrquestradorDaTabela[];
  /** Fallback: o status antigo, mostrado no topo quando não há leitura de memória. */
  sistema?: ReactNode;
}

/**
 * A aba Sistema: cartão de memória (anel, nível e barra empilhada), uso por
 * orquestrador e os processos (Autorrecuperação, limite de abertos e os Ajustes
 * do desktop).
 */
export function AbaDoSistema({ ajustes, memoria = null, orquestradores, sistema }: Props) {
  // A autorrecuperação vale para todos os orquestradores: fica no servidor, não no navegador.
  const t = useTextos(textosDeConfiguracoes).sistema;
  const autorrecuperacao = useValorDaAutorrecuperacao();
  const [lendo, setLendo] = useState(true);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Uma gravação começada depois da leitura vence a resposta dela.
  const gravacoes = useRef(0);
  const idDosProcessos = useId();

  // Relê a cada vez que a aba abre: outra janela pode ter mudado.
  useEffect(() => {
    let vivo = true;
    const gravacoesAntes = gravacoes.current;
    api
      .lerPreferencias()
      .then((lidas) => {
        if (vivo && gravacoes.current === gravacoesAntes) {
          definirAutorrecuperacao(lidas.autorrecuperacao);
        }
      })
      .catch((falha: unknown) => {
        if (vivo) {
          setErro(mensagemDeErro(falha));
        }
      })
      .finally(() => {
        if (vivo) {
          setLendo(false);
        }
      });
    return () => {
      vivo = false;
    };
  }, []);

  const alternarAutorrecuperacao = () => {
    if (autorrecuperacao === null || gravando) {
      return;
    }
    const nova = !autorrecuperacao;
    gravacoes.current += 1;
    setErro(null);
    setGravando(true);
    definirAutorrecuperacao(nova);
    api
      .alterarPreferencias({ autorrecuperacao: nova })
      .then((gravadas) => definirAutorrecuperacao(gravadas.autorrecuperacao ?? nova))
      .catch((falha: unknown) => {
        definirAutorrecuperacao(!nova);
        setErro(mensagemDeErro(falha));
      })
      .finally(() => setGravando(false));
  };

  const situacao =
    erro ?? (autorrecuperacao === null ? (lendo ? t.carregando : t.naoDeuParaLer) : t.autorrecuperacaoDica);

  return (
    <>
      {memoria !== null ? <CartaoDaMemoria memoria={memoria} /> : sistema}
      {orquestradores !== undefined && (
        <>
          <h3 className="cfgapp-titulo">{t.usoPorOrquestrador}</h3>
          <TabelaDeUso orquestradores={orquestradores} porOrquestrador={memoria?.porOrquestrador ?? {}} />
        </>
      )}
      <h3 className="cfgapp-titulo" id={idDosProcessos}>
        {t.processos}
      </h3>
      <div className="cfgapp-cartao" role="group" aria-labelledby={idDosProcessos}>
        <InterruptorDaConfiguracao
          titulo={t.autorrecuperacao}
          descricao={situacao}
          comErro={erro !== null}
          ligado={autorrecuperacao ?? false}
          indisponivel={autorrecuperacao === null || gravando}
          ocupado={lendo || gravando}
          aoAlternar={alternarAutorrecuperacao}
        />
        <LinhaDaConfiguracao
          titulo={t.abertosTitulo}
          descricao={t.abertosDescricao}
        >
          <span className="cfgapp-valor">{t.ate(LIMITE_DE_ORQUESTRADORES_ABERTOS)}</span>
        </LinhaDaConfiguracao>
        {ajustes.disponivel && (
          <LinhaDaConfiguracao titulo={t.pastasTitulo} descricao={t.pastasDescricao}>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => void ajustes.abrir()}>
              {t.pastasBotao}
            </button>
          </LinhaDaConfiguracao>
        )}
      </div>
    </>
  );
}
