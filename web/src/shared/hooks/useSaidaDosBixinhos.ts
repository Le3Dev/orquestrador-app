import { useEffect, useRef, useState } from "react";

import { ENTREGA_AO_VIVO_MS, prefereMovimentoReduzido } from "../canvas/entrega";
import type { BixinhosLimpos } from "../canvas/layout";
import { idDoBixinho, subagentesVisiveis } from "../canvas/nos";
import type { EstadoDaConversa } from "../estado/aplicarEvento";

/** Quanto o bixinho de quem terminou fica no canvas, com a expressão final, antes de sair. */
export const ESPERA_ANTES_DE_SAIR_MS = 5000;
/** Quanto dura a saída (encolhe e some; a linha se recolhe): a mesma do CSS `.no-bixinho-saindo`. */
export const DURACAO_DA_SAIDA_MS = 400;

const NENHUM: ReadonlySet<string> = new Set();

/**
 * Quanto falta para o bixinho de quem encerrou em `encerradoEm` sair, contado
 * do fim do Subagente. Nulo quando o fim é antigo (mais de `ENTREGA_AO_VIVO_MS`,
 * como na entrega do relatório): o histórico reenviado ao abrir o terminal ou
 * recarregar a página, que a pessoa não viu terminar. Sem a hora, conta de agora.
 */
export function esperaParaSair(encerradoEm: string | null, agora: number): number | null {
  const fim = encerradoEm === null ? Number.NaN : Date.parse(encerradoEm);
  if (Number.isNaN(fim)) {
    return ESPERA_ANTES_DE_SAIR_MS;
  }
  const decorrido = agora - fim;
  if (decorrido >= ENTREGA_AO_VIVO_MS) {
    return null;
  }
  return Math.min(ESPERA_ANTES_DE_SAIR_MS, Math.max(0, ESPERA_ANTES_DE_SAIR_MS - decorrido));
}

interface Agendado {
  orquestradorId: string;
  subagenteId: string;
  /** O timer da vez: o da espera e, depois, o do fim da animação. */
  timer: ReturnType<typeof setTimeout>;
}

interface Opcoes {
  conversas: ReadonlyMap<string, EstadoDaConversa>;
  bixinhosLimpos: ReadonlyMap<string, BixinhosLimpos>;
  /** A preferência "Manter bixinhos até limpar à mão": ligada, ninguém sai sozinho. */
  manter: boolean;
  /** Tira os bixinhos do canvas pelo mesmo caminho do "limpar" (os limpos não voltam ao recarregar). */
  limpar: (orquestradorId: string, subagenteIds: readonly string[]) => void;
}

/**
 * Os bixinhos saem sozinhos do canvas quando o Subagente conclui ou é
 * cancelado: ficam `ESPERA_ANTES_DE_SAIR_MS` com a expressão final, entram em
 * `saindo` (encolhem e somem, e a linha se recolhe) e, depois da animação, são
 * limpos. Com reduzir movimento, saem direto, sem animar. Quem falhou fica até
 * a pessoa limpar.
 *
 * Os que já tinham terminado havia mais tempo (abrir o terminal, recarregar a
 * página, desligar a preferência depois) saem na hora, sem esperar nem animar:
 * ninguém viu esses terminarem, e muitos animando juntos só fariam barulho.
 *
 * Devolve os ids dos nós dos bixinhos saindo agora. Os timers são desfeitos ao
 * desmontar, ao ligar a preferência e quando o bixinho some por outro caminho
 * (limpar à mão, pedido novo, terminal fechado).
 */
export function useSaidaDosBixinhos({ conversas, bixinhosLimpos, manter, limpar }: Opcoes): ReadonlySet<string> {
  const [saindo, setSaindo] = useState<ReadonlySet<string>>(NENHUM);
  const agendados = useRef(new Map<string, Agendado>());
  const limparAtual = useRef(limpar);

  useEffect(() => {
    limparAtual.current = limpar;
  }, [limpar]);

  useEffect(() => {
    const mapa = agendados.current;
    const candidatos = new Map<string, { orquestradorId: string; subagenteId: string; encerradoEm: string | null }>();
    if (!manter) {
      for (const [orquestradorId, conversa] of conversas) {
        for (const subagente of subagentesVisiveis(conversa, bixinhosLimpos.get(orquestradorId))) {
          if (subagente.situacao === "concluido" || subagente.situacao === "cancelado") {
            candidatos.set(idDoBixinho(orquestradorId, subagente.id), {
              orquestradorId,
              subagenteId: subagente.id,
              encerradoEm: subagente.encerradoEm,
            });
          }
        }
      }
    }

    // Quem saiu da lista (limpo à mão, outro pedido, preferência ligada) não sai mais por aqui.
    for (const [id, agendado] of mapa) {
      if (!candidatos.has(id)) {
        clearTimeout(agendado.timer);
        mapa.delete(id);
      }
    }
    setSaindo((atuais) => {
      const restantes = [...atuais].filter((id) => mapa.has(id));
      return restantes.length === atuais.size ? atuais : restantes.length === 0 ? NENHUM : new Set(restantes);
    });

    const terminar = (id: string, orquestradorId: string, subagenteId: string) => {
      mapa.delete(id);
      limparAtual.current(orquestradorId, [subagenteId]);
    };

    const agora = Date.now();
    const naHora = new Map<string, string[]>();
    for (const [id, { orquestradorId, subagenteId, encerradoEm }] of candidatos) {
      if (mapa.has(id)) {
        continue;
      }
      const espera = esperaParaSair(encerradoEm, agora);
      if (espera === null) {
        naHora.set(orquestradorId, [...(naHora.get(orquestradorId) ?? []), subagenteId]);
        continue;
      }
      const agendado: Agendado = {
        orquestradorId,
        subagenteId,
        timer: setTimeout(() => {
          if (prefereMovimentoReduzido()) {
            terminar(id, orquestradorId, subagenteId);
            return;
          }
          setSaindo((atuais) => new Set(atuais).add(id));
          agendado.timer = setTimeout(() => terminar(id, orquestradorId, subagenteId), DURACAO_DA_SAIDA_MS);
        }, espera),
      };
      mapa.set(id, agendado);
    }
    for (const [orquestradorId, subagenteIds] of naHora) {
      limparAtual.current(orquestradorId, subagenteIds);
    }
  }, [conversas, bixinhosLimpos, manter]);

  // Ao desmontar, nenhum timer fica para trás.
  useEffect(() => {
    const mapa = agendados.current;
    return () => {
      for (const agendado of mapa.values()) {
        clearTimeout(agendado.timer);
      }
      mapa.clear();
    };
  }, []);

  return saindo;
}
