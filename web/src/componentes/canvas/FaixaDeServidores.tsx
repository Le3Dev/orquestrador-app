import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../shared/api/cliente";
import { lerServidoresTirados, salvarServidoresTirados, type ServidoresTirados } from "../../shared/canvas/layout";
import { enderecoCurto } from "../../shared/enderecosLocais";
import {
  CHIPS_A_VISTA,
  INTERVALO_DA_CONSULTA_MS,
  servidoresDaFaixa,
  TEMPO_PARADO_ATE_SAIR_MS,
  tirarServidores,
} from "../../shared/servidoresDaFaixa";

interface Props {
  /** Quem é o dono da faixa: os servidores tirados da lista são lembrados por Orquestrador. */
  orquestradorId: string;
  /** Os servidores que os agentes subiram na conversa (`EstadoDaConversa.enderecosLocais`). */
  enderecos: readonly string[];
  /** A sequência do último anúncio de cada endereço (`EstadoDaConversa.sequenciasDosEnderecos`). */
  sequencias: Readonly<Record<string, number>>;
  aoAbrir: (url: string) => void;
}

/** "desconhecida": ainda não houve consulta (ou ela falhou desde sempre). */
type Situacao = "no-ar" | "parado" | "desconhecida";

interface PropsDoChip {
  url: string;
  situacao: Situacao;
  aoAbrir: (url: string) => void;
  aoTirar: (url: string) => void;
}

function Chip({ url, situacao, aoAbrir, aoTirar }: PropsDoChip) {
  const parado = situacao === "parado";
  return (
    <span className="faixa-chip" data-situacao={situacao}>
      <button
        type="button"
        className="faixa-chip-abrir"
        title={`Abre ${url} numa prévia ao vivo no canvas`}
        aria-label={parado ? `Abrir prévia de ${url} (servidor parado)` : `Abrir prévia de ${url}`}
        onClick={() => aoAbrir(url)}
      >
        <span className="faixa-chip-ponto" aria-hidden="true" />
        <span className="faixa-chip-endereco" title={url}>
          {enderecoCurto(url)}
        </span>
        <span className="faixa-chip-acao">{parado ? "parado" : "abrir"}</span>
      </button>
      <button
        type="button"
        className="faixa-chip-tirar"
        title="Tirar da lista"
        aria-label={`Tirar ${url} da lista`}
        onClick={() => aoTirar(url)}
      >
        <span aria-hidden="true">×</span>
      </button>
    </span>
  );
}

/**
 * Faixa fina logo acima do prompt com os servidores de desenvolvimento que os
 * agentes subiram: um chip por servidor (ponto de status, endereço, "abrir" e
 * o × que tira da lista), os três primeiros à vista e o resto no "+N".
 *
 * Enquanto está montada e a página visível, confere a cada 15 s se cada
 * servidor ainda responde (erro de rede mantém o último estado). Um servidor
 * parado por mais de 5 minutos seguidos sai da faixa sozinho, como se tirado.
 * O que o usuário tira é lembrado por Orquestrador; um anúncio novo do mesmo
 * endereço o traz de volta.
 */
export const FaixaDeServidores = memo(function FaixaDeServidores({ orquestradorId, enderecos, sequencias, aoAbrir }: Props) {
  const [tirados, setTirados] = useState<ServidoresTirados>(() => lerServidoresTirados(orquestradorId));
  const [noAr, setNoAr] = useState<Readonly<Record<string, boolean>>>({});
  const [aberta, setAberta] = useState(false);

  // O que os efeitos e as ações leem sem se refazer a cada mudança.
  const tiradosAtuais = useRef(tirados);
  const sequenciasAtuais = useRef(sequencias);
  sequenciasAtuais.current = sequencias;
  /** Desde quando (ms) cada servidor está parado, nas consultas seguidas. */
  const paradoDesde = useRef(new Map<string, number>());

  const visiveis = useMemo(
    () => servidoresDaFaixa(enderecos, sequencias, tirados, window.location.origin),
    [enderecos, sequencias, tirados],
  );

  const tirar = useCallback(
    (urls: readonly string[]) => {
      const novos = tirarServidores(tiradosAtuais.current, urls, sequenciasAtuais.current);
      tiradosAtuais.current = novos;
      setTirados(novos);
      salvarServidoresTirados(orquestradorId, novos);
      for (const url of urls) {
        paradoDesde.current.delete(url);
      }
    },
    [orquestradorId],
  );

  const chave = visiveis.join("\n");
  useEffect(() => {
    if (chave === "") {
      return;
    }
    const urls = chave.split("\n");
    let ativo = true;

    const consultar = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      let situacoes;
      try {
        ({ situacoes } = await api.lerSituacaoDosServidores(urls));
      } catch {
        return; // Sem resposta: vale o último estado.
      }
      if (!ativo) {
        return;
      }
      const agora = Date.now();
      const resultado: Record<string, boolean> = {};
      const aSumir: string[] = [];
      for (const { url, noAr: respondendo } of situacoes) {
        if (!urls.includes(url)) {
          continue;
        }
        resultado[url] = respondendo;
        if (respondendo) {
          paradoDesde.current.delete(url);
          continue;
        }
        const desde = paradoDesde.current.get(url) ?? agora;
        paradoDesde.current.set(url, desde);
        if (agora - desde > TEMPO_PARADO_ATE_SAIR_MS) {
          aSumir.push(url);
        }
      }
      setNoAr((anterior) => ({ ...anterior, ...resultado }));
      if (aSumir.length > 0) {
        tirar(aSumir);
      }
    };

    void consultar();
    const intervalo = setInterval(() => void consultar(), INTERVALO_DA_CONSULTA_MS);
    const aoMudarAVisibilidade = () => void consultar();
    document.addEventListener("visibilitychange", aoMudarAVisibilidade);
    return () => {
      ativo = false;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoMudarAVisibilidade);
    };
  }, [chave, tirar]);

  if (visiveis.length === 0) {
    return null;
  }

  const aVista = visiveis.slice(0, CHIPS_A_VISTA);
  const restantes = visiveis.slice(CHIPS_A_VISTA);
  const mostrarRestantes = aberta && restantes.length > 0;
  const situacaoDe = (url: string): Situacao => {
    const respondendo = noAr[url];
    return respondendo === undefined ? "desconhecida" : respondendo ? "no-ar" : "parado";
  };
  const chip = (url: string) => (
    <Chip key={url} url={url} situacao={situacaoDe(url)} aoAbrir={aoAbrir} aoTirar={(alvo) => tirar([alvo])} />
  );

  return (
    <div
      className={mostrarRestantes ? "faixa-de-servidores faixa-de-servidores-aberta nodrag" : "faixa-de-servidores nodrag"}
      role="group"
      aria-label="Servidores locais"
    >
      <span className="faixa-de-servidores-rotulo">Servidores</span>
      {aVista.map(chip)}
      {mostrarRestantes && restantes.map(chip)}
      {restantes.length > 0 && (
        <button
          type="button"
          className="faixa-de-servidores-mais"
          aria-expanded={mostrarRestantes}
          aria-label={mostrarRestantes ? "Mostrar menos servidores" : `Mostrar mais ${restantes.length} servidores`}
          onClick={() => setAberta((atual) => !atual)}
        >
          {mostrarRestantes ? "menos" : `+${restantes.length}`}
        </button>
      )}
      <button
        type="button"
        className="faixa-de-servidores-limpar"
        title="Tirar todos da lista"
        aria-label="Tirar todos os servidores da lista"
        onClick={() => tirar(visiveis)}
      >
        Limpar
      </button>
    </div>
  );
});
