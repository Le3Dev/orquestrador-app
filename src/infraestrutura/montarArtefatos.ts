import { randomUUID } from "node:crypto";
import path from "node:path";

import { Router } from "express";

import { ServicoDeArtefatos } from "../artefatos/ServicoDeArtefatos";
import { CanalDosArtefatos, criarArtefatosRoutes } from "../controllers/artefatosRoutes";
import { ColetorDeArtefatosEmPasta, PastaDeEntradaDosArtefatos } from "./arquivos/ColetorDeArtefatosEmPasta";
import {
  PASTA_DE_ENTRADA,
  PASTA_DOS_ARTEFATOS,
  RepositorioDeArtefatosEmArquivo,
} from "./arquivos/RepositorioDeArtefatosEmArquivo";

export interface MontagemDosArtefatos {
  /** Montar em `/api`: `aplicacao.use("/api", montagem.rotas)`. */
  rotas: Router;
  /** Cria a pasta de entrada, começa a observá-la e coleta o que chegou com o servidor desligado. */
  iniciar(): Promise<void>;
  /** Para de observar e espera as coletas e gravações em andamento. */
  encerrar(): Promise<void>;
}

/** `<pastaDeDados>/artefatos/entrada`: onde os agentes gravam (`chat/` e `orquestradores/<id>/`). */
export function pastaDeEntradaDosArtefatos(pastaDeDados: string): string {
  return path.join(pastaDeDados, PASTA_DOS_ARTEFATOS, PASTA_DE_ENTRADA);
}

/**
 * Composição do contexto de artefatos: repositório em arquivos, serviço,
 * canal SSE, coletor da pasta de entrada e rotas.
 */
export async function montarArtefatos(opcoes: { pastaDeDados: string }): Promise<MontagemDosArtefatos> {
  const repositorio = await RepositorioDeArtefatosEmArquivo.abrir(opcoes.pastaDeDados);
  const entrada = new PastaDeEntradaDosArtefatos(pastaDeEntradaDosArtefatos(opcoes.pastaDeDados));
  const canal = new CanalDosArtefatos();
  const servico = new ServicoDeArtefatos({
    repositorio,
    entrada,
    publicador: canal,
    gerarId: randomUUID,
    agora: () => new Date(),
  });
  const coletor = new ColetorDeArtefatosEmPasta({ entrada, servico });

  return {
    rotas: criarArtefatosRoutes({ servico, canal }),
    iniciar: () => coletor.iniciar(),
    encerrar: async () => {
      await coletor.encerrar();
      await repositorio.aguardarGravacoes();
    },
  };
}
