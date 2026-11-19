import { useEffect, useState } from "react";

import { api } from "../api/cliente";
import type { DadosDaPredefinicao, DadosDasPreferencias, EsforcosHerdados, EstadoDoMotor, Motor } from "../api/tipos";
import { descreverAlteracoesDaConfiguracao } from "../formatacao";
import { textosAtuais } from "../idioma/idioma";
import { textosDeApoioDosNos } from "../idioma/textos/nos";
import { rotuloDoMotor } from "../modelos";

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

/** Os motores como a tela os conhece: a lista do servidor, ou nada quando não foi possível verificar. */
export interface SituacaoDosMotores {
  /** Nulo enquanto carrega ou se a verificação falhou. */
  motores: readonly EstadoDoMotor[] | null;
  /** A rota não existe (servidor antigo) ou deu erro: nenhum motor é desabilitado, e a tela avisa. */
  naoVerificou: boolean;
}

/**
 * Se os CLIs dos motores estão instalados (`GET /api/motores`), lido uma vez ao abrir. Com a rota ausente ou
 * falhando, a tela segue: nenhum motor é desabilitado e aparece "não foi possível verificar os motores".
 */
export function useMotores(): SituacaoDosMotores {
  const [situacao, setSituacao] = useState<SituacaoDosMotores>({ motores: null, naoVerificou: false });
  useEffect(() => {
    let ativo = true;
    api
      .listarMotores()
      .then((motores) => {
        if (ativo) {
          setSituacao({ motores: Array.isArray(motores) ? motores : null, naoVerificou: !Array.isArray(motores) });
        }
      })
      .catch(() => {
        if (ativo) {
          setSituacao({ motores: null, naoVerificou: true });
        }
      });
    return () => {
      ativo = false;
    };
  }, []);
  return situacao;
}

/** O estado de um motor na lista; nulo sem a lista (ainda não carregou ou não foi possível verificar). */
export function estadoDoMotor(situacao: SituacaoDosMotores, motor: Motor): EstadoDoMotor | null {
  return situacao.motores?.find((candidato) => candidato.motor === motor) ?? null;
}

/**
 * Por que o motor não pode ser escolhido, para a dica: só um motor que o servidor diz não estar instalado é
 * recusado. Sem a lista, nada é recusado.
 */
export function motivoDoMotorIndisponivel(situacao: SituacaoDosMotores, motor: Motor): string | null {
  const estado = estadoDoMotor(situacao, motor);
  if (estado === null || estado.instalado) {
    return null;
  }
  return estado.mensagem ?? textosAtuais(textosDeApoioDosNos).configuracao.naoInstalado(estado.rotulo || rotuloDoMotor(motor));
}

/**
 * Um aviso sobre um motor que está instalado mas pode falhar (sem login); nulo quando está tudo certo ou não se sabe.
 */
export function avisoDoMotor(situacao: SituacaoDosMotores, motor: Motor): string | null {
  const estado = estadoDoMotor(situacao, motor);
  if (estado === null || !estado.instalado) {
    return null;
  }
  if (estado.logado === false) {
    return estado.mensagem ?? textosAtuais(textosDeApoioDosNos).configuracao.faltaLogin(estado.rotulo || rotuloDoMotor(motor));
  }
  return null;
}

/**
 * As preferências globais, lidas uma vez ao abrir: os subagentes prontos (para
 * escolher os de um orquestrador) e os perfis de instruções (para aplicar).
 * Nulo enquanto carrega ou se a leitura falhar: a escolha segue sem as caixas
 * e o "Aplicar perfil…" não aparece.
 */
export function usePreferencias(): DadosDasPreferencias | null {
  const [preferencias, setPreferencias] = useState<DadosDasPreferencias | null>(null);
  useEffect(() => {
    let ativo = true;
    api
      .lerPreferencias()
      .then((lidas) => {
        if (ativo) {
          setPreferencias(lidas);
        }
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);
  return preferencias;
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
