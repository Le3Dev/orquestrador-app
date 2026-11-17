import { randomUUID } from "node:crypto";

import { Router } from "express";

import { CanalDasRotinas, criarRotinasRoutes } from "../controllers/rotinasRoutes";
import { ControleDeExecucoesDeRotinas } from "../rotinas/ControleDeExecucoesDeRotinas";
import { ExecutorDePedidos } from "../rotinas/ExecutorDePedidos";
import { ServicoDeRotinas } from "../rotinas/ServicoDeRotinas";
import { TEMPORIZADOR_DO_SISTEMA, Temporizador } from "../rotinas/Temporizador";
import { Agendador } from "./agenda/Agendador";
import { RepositorioDeRotinasEmArquivo } from "./arquivos/RepositorioDeRotinasEmArquivo";

export interface OpcoesDasRotinas {
  pastaDeDados: string;
  /** A porta para os Orquestradores: é a única ligação das Rotinas com a orquestração. */
  executorDePedidos: ExecutorDePedidos;
  /** Padrão: o relógio do sistema. */
  agora?: (() => Date) | undefined;
  /** Padrão: `setTimeout` de verdade. Serve ao agendador (a cada ~30 s) e às etapas de espera. */
  temporizador?: Temporizador | undefined;
}

export interface MontagemDasRotinas {
  /** Montar em `/api`: `aplicacao.use("/api", montagem.rotas)`. */
  rotas: Router;
  /**
   * Recupera o que o fechamento anterior deixou (o que rodava vira
   * `interrompida`; as horas perdidas seguem o `aoPerder`) e começa a
   * verificar as rotinas a cada ~30 s.
   */
  iniciar(): Promise<void>;
  /** Para o agendador, aborta as execuções em andamento (ficam `interrompida`) e espera as gravações. */
  encerrar(): Promise<void>;
}

/**
 * Composição do contexto de rotinas: repositório em arquivos, serviço, canal
 * SSE, agendador e rotas.
 */
export async function montarRotinas(opcoes: OpcoesDasRotinas): Promise<MontagemDasRotinas> {
  const repositorio = await RepositorioDeRotinasEmArquivo.abrir(opcoes.pastaDeDados);
  const canal = new CanalDasRotinas();
  const temporizador = opcoes.temporizador ?? TEMPORIZADOR_DO_SISTEMA;
  const servico = new ServicoDeRotinas({
    repositorioDeRotinas: repositorio,
    repositorioDeExecucoes: repositorio,
    executor: opcoes.executorDePedidos,
    publicador: canal,
    controle: new ControleDeExecucoesDeRotinas(),
    temporizador,
    gerarId: randomUUID,
    agora: opcoes.agora ?? (() => new Date()),
  });
  const agendador = new Agendador({ servico, temporizador });

  return {
    rotas: criarRotinasRoutes({ servico, canal }),
    iniciar: () => agendador.iniciar(),
    encerrar: async () => {
      await agendador.encerrar();
      await repositorio.aguardarGravacoes();
    },
  };
}
