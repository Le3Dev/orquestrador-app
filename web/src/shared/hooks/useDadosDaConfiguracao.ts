import { useEffect, useState } from "react";

import { api } from "../api/cliente";
import type { DadosDaPredefinicao, EsforcosHerdados } from "../api/tipos";
import { descreverAlteracoesDaConfiguracao } from "../formatacao";

// Usados pela ⚙ do terminal (CamposDaConfiguracao) e pela criação (NoRascunho).

/** O texto de ajuda do botão de uma predefinição: a descrição e o que ela muda, um item por linha. */
export function ajudaDaPredefinicao(predefinicao: DadosDaPredefinicao): string {
  const itens = descreverAlteracoesDaConfiguracao(predefinicao.configuracao).map((item) => `• ${item}`);
  return [predefinicao.descricao, ...(itens.length > 0 ? ["", ...itens] : [])].join("\n");
}

/** As predefinições do servidor; sem elas (servidor antigo ou fora do ar), o botão simplesmente não aparece. */
export function usePredefinicoes(): DadosDaPredefinicao[] {
  const [predefinicoes, setPredefinicoes] = useState<DadosDaPredefinicao[]>([]);
  useEffect(() => {
    let ativo = true;
    api
      .listarPredefinicoes()
      .then((lista) => {
        if (ativo) {
          setPredefinicoes(lista);
        }
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);
  return predefinicoes;
}

/**
 * O esforço herdado do Claude Code, buscado de novo sempre que `buscar` muda
 * (o formulário passa uma função nova quando os modelos ou a pasta mudam).
 * Falha na busca → nulo: o formulário segue sem aviso.
 */
export function useEsforcosHerdados(buscar: (() => Promise<EsforcosHerdados>) | undefined): EsforcosHerdados | null {
  const [herdados, setHerdados] = useState<EsforcosHerdados | null>(null);
  useEffect(() => {
    if (buscar === undefined) {
      setHerdados(null);
      return;
    }
    let ativo = true;
    buscar()
      .then((resposta) => {
        if (ativo) {
          setHerdados(resposta);
        }
      })
      .catch(() => {
        if (ativo) {
          setHerdados(null);
        }
      });
    return () => {
      ativo = false;
    };
  }, [buscar]);
  return herdados;
}
