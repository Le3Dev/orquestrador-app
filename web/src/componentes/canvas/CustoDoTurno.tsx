import { useId, useState } from "react";

import type { DadosDoConsumoDoTurno, DadosDoUso } from "../../shared/api/tipos";
import { formatarTokens } from "../../shared/formatacao";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDePaineisDoCanvas } from "../../shared/idioma/textos/canvasPaineis";

/** Pesos do índice de custo, em tokens de entrada equivalentes (os mesmos do servidor). */
const PESO_DA_CRIACAO_DE_CACHE = 1.25;
const PESO_DA_LEITURA_DE_CACHE = 0.1;
const PESO_DA_SAIDA = 5;

function indiceDe(uso: DadosDoUso): number {
  return (
    uso.entrada +
    PESO_DA_CRIACAO_DE_CACHE * uso.criacaoDeCache +
    PESO_DA_LEITURA_DE_CACHE * uso.leituraDeCache +
    PESO_DA_SAIDA * uso.saida
  );
}

function somar(a: DadosDoUso, b: DadosDoUso): DadosDoUso {
  return {
    entrada: a.entrada + b.entrada,
    criacaoDeCache: a.criacaoDeCache + b.criacaoDeCache,
    leituraDeCache: a.leituraDeCache + b.leituraDeCache,
    saida: a.saida + b.saida,
  };
}

function LinhaDoUso({ rotulo, uso, indice }: { rotulo: string; uso: DadosDoUso; indice: number }) {
  return (
    <tr>
      <th scope="row">{rotulo}</th>
      <td>{formatarTokens(uso.entrada)}</td>
      <td>{formatarTokens(uso.criacaoDeCache)}</td>
      <td>{formatarTokens(uso.leituraDeCache)}</td>
      <td>{formatarTokens(uso.saida)}</td>
      <td>{formatarTokens(indice)}</td>
    </tr>
  );
}

/**
 * Linha discreta no fim do pedido com o custo estimado (índice relativo) e,
 * ao abrir, a tabela por trecho: Orquestrador (principal), Subagentes e total.
 */
export function CustoDoTurno({ consumo }: { consumo: DadosDoConsumoDoTurno }) {
  const t = useTextos(textosDePaineisDoCanvas);
  const [aberto, setAberto] = useState(false);
  const idDaTabela = useId();
  const total = somar(consumo.principal, consumo.subagentes);

  return (
    <div className="custo-do-turno">
      <button
        type="button"
        className="custo-do-turno-resumo mono"
        aria-expanded={aberto}
        aria-controls={idDaTabela}
        title={consumo.parcial ? `${t.explicacaoDoIndice}\n${t.explicacaoDoParcial}` : t.explicacaoDoIndice}
        onClick={() => setAberto((atual) => !atual)}
      >
        {t.custoResumo(formatarTokens(consumo.indiceDeCusto), consumo.parcial)}
      </button>
      {aberto && (
        <table id={idDaTabela} className="custo-do-turno-tabela mono">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{t.trecho}</span>
              </th>
              <th scope="col">{t.entrada}</th>
              <th scope="col">{t.criacaoDeCache}</th>
              <th scope="col">{t.leituraDeCache}</th>
              <th scope="col">{t.saida}</th>
              <th scope="col">{t.indice}</th>
            </tr>
          </thead>
          <tbody>
            <LinhaDoUso rotulo={t.principal} uso={consumo.principal} indice={indiceDe(consumo.principal)} />
            <LinhaDoUso
              rotulo={t.subagentes(consumo.subagentesMedidos)}
              uso={consumo.subagentes}
              indice={indiceDe(consumo.subagentes)}
            />
          </tbody>
          <tfoot>
            <LinhaDoUso rotulo={t.total} uso={total} indice={consumo.indiceDeCusto} />
          </tfoot>
        </table>
      )}
    </div>
  );
}
