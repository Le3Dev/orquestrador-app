import { useId, useState } from "react";

import type { DadosDoConsumoDoTurno, DadosDoUso } from "../../shared/api/tipos";
import { formatarTokens } from "../../shared/formatacao";

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

const EXPLICACAO_DO_INDICE =
  "Índice de custo = entrada + 1,25 × criação de cache + 0,1 × leitura de cache + 5 × saída, em tokens de entrada " +
  "equivalentes. Serve para comparar pedidos; não é preço.";

const EXPLICACAO_DO_PARCIAL = "Parcial: o pedido foi cancelado ou falhou; o custo é o que houve até parar.";

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
        title={consumo.parcial ? `${EXPLICACAO_DO_INDICE}\n${EXPLICACAO_DO_PARCIAL}` : EXPLICACAO_DO_INDICE}
        onClick={() => setAberto((atual) => !atual)}
      >
        {`≈ custo do turno · índice ${formatarTokens(consumo.indiceDeCusto)}${consumo.parcial ? " · parcial" : ""}`}
      </button>
      {aberto && (
        <table id={idDaTabela} className="custo-do-turno-tabela mono">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Trecho</span>
              </th>
              <th scope="col">Entrada</th>
              <th scope="col">Criação de cache</th>
              <th scope="col">Leitura de cache</th>
              <th scope="col">Saída</th>
              <th scope="col">Índice</th>
            </tr>
          </thead>
          <tbody>
            <LinhaDoUso rotulo="Principal" uso={consumo.principal} indice={indiceDe(consumo.principal)} />
            <LinhaDoUso
              rotulo={`Subagentes (${consumo.subagentesMedidos})`}
              uso={consumo.subagentes}
              indice={indiceDe(consumo.subagentes)}
            />
          </tbody>
          <tfoot>
            <LinhaDoUso rotulo="Total" uso={total} indice={consumo.indiceDeCusto} />
          </tfoot>
        </table>
      )}
    </div>
  );
}
