import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import express from "express";

import { criarNotasRoutes } from "./controllers/notasRoutes";
import { criarOrquestradoresRoutes } from "./controllers/orquestradoresRoutes";
import { ArmazemDeAnexosEmArquivo } from "./infraestrutura/arquivos/ArmazemDeAnexosEmArquivo";
import { ExploradorDePastas } from "./infraestrutura/arquivos/ExploradorDePastas";
import { RepositorioDeNotasEmArquivo } from "./infraestrutura/arquivos/RepositorioDeNotasEmArquivo";
import { RepositorioDeOrquestradoresEmArquivo } from "./infraestrutura/arquivos/RepositorioDeOrquestradoresEmArquivo";
import { FachadaClaudeCodeCli } from "./infraestrutura/claudecode/FachadaClaudeCodeCli";
import { MotorClaudeCodeCli } from "./infraestrutura/claudecode/MotorClaudeCodeCli";
import { lerConfiguracao } from "./infraestrutura/Configuracao";
import { ControleDeExecucoesEmMemoria } from "./infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { GerenciadorDeWorktreesGit } from "./infraestrutura/sistema/GerenciadorDeWorktreesGit";
import { MonitorDeMemoria } from "./infraestrutura/sistema/MonitorDeMemoria";
import { encerrarAgentesOrfaos, RegistroDeProcessos } from "./infraestrutura/sistema/RegistroDeProcessos";
import { CanalDeEventos } from "./infraestrutura/sse/CanalDeEventos";
import { ServicoDeNotas } from "./notas/ServicoDeNotas";
import { ServicoDeOrquestracao } from "./orquestracao/ServicoDeOrquestracao";

async function iniciar(): Promise<void> {
  const configuracao = lerConfiguracao();

  if (path.isAbsolute(configuracao.caminhoDoClaudeCode) && !existsSync(configuracao.caminhoDoClaudeCode)) {
    console.warn(
      `[configuracao] Claude Code não encontrado em "${configuracao.caminhoDoClaudeCode}". Ajuste CLAUDE_CODE_BIN no .env.`,
    );
  }

  const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(configuracao.pastaDeDados);
  const notas = await RepositorioDeNotasEmArquivo.abrir(configuracao.pastaDeDados);

  // Antes de registrar processos novos: se o servidor anterior caiu, os
  // agentes dele podem ter ficado rodando sozinhos.
  const arquivoDeProcessos = path.join(configuracao.pastaDeDados, "processos-em-execucao.json");
  const orfaos = await encerrarAgentesOrfaos(arquivoDeProcessos);
  if (orfaos > 0) {
    console.warn(`[processos] ${orfaos} agente(s) deixado(s) rodando pelo servidor anterior foram encerrados.`);
  }
  const registro = new RegistroDeProcessos(arquivoDeProcessos);
  const monitor = new MonitorDeMemoria(registro);
  monitor.iniciar();

  const canal = new CanalDeEventos();
  const execucoes = new ControleDeExecucoesEmMemoria();
  const anexos = new ArmazemDeAnexosEmArquivo(path.join(configuracao.pastaDeDados, "anexos"));
  const worktrees = new GerenciadorDeWorktreesGit(configuracao.pastaDeDados);

  // Worktrees deixados para trás pela queda do servidor anterior: remove os
  // que estiverem sem alterações, análogo aos agentes órfãos acima.
  const worktreesOrfaos = await worktrees.limparOrfaos(
    repositorio.listar().map((orquestrador) => orquestrador.pastaDeTrabalho.caminho),
  );
  if (worktreesOrfaos > 0) {
    console.warn(`[worktrees] ${worktreesOrfaos} worktree(s) órfão(s) do servidor anterior foram removidos.`);
  }

  const servico = new ServicoDeOrquestracao({
    repositorio,
    motor: new MotorClaudeCodeCli(new FachadaClaudeCodeCli(configuracao.caminhoDoClaudeCode, registro)),
    execucoes,
    publicador: canal,
    anexos,
    worktrees,
    gerarId: randomUUID,
    agora: () => new Date(),
  });

  const interrompidos = await servico.interromperTurnosPendentes();
  if (interrompidos > 0) {
    console.warn(`[orquestracao] ${interrompidos} turno(s) marcado(s) como interrompido(s) pelo reinício.`);
  }

  const aplicacao = express();
  aplicacao.disable("x-powered-by");
  // Mensagens podem levar até 5 imagens de 5 MB, em base64.
  aplicacao.use(express.json({ limit: "40mb" }));

  // A tela consulta isto a cada poucos segundos para saber se o servidor está
  // no ar. O instante de início denuncia um reinício: os pedidos que rodavam
  // antes dele foram interrompidos.
  const iniciadoEm = new Date().toISOString();
  aplicacao.get("/api/saude", (_requisicao, resposta) => {
    resposta.json({ ok: true, iniciadoEm, memoria: monitor.ultimaLeitura });
  });

  aplicacao.use(
    "/api",
    criarOrquestradoresRoutes({
      servico,
      repositorio,
      canal,
      explorador: new ExploradorDePastas(configuracao.pastaRaizDosProjetos),
      anexos,
      pastaRaiz: configuracao.pastaRaizDosProjetos,
    }),
  );
  aplicacao.use(
    "/api",
    criarNotasRoutes({
      servico: new ServicoDeNotas({ repositorio: notas, gerarId: randomUUID, agora: () => new Date() }),
    }),
  );

  // Depois do build, a própria API serve a tela (web/dist). Em desenvolvimento
  // quem serve é o Vite, que repassa /api para cá.
  const pastaDaTela = path.resolve(__dirname, "..", "web", "dist");
  if (existsSync(pastaDaTela)) {
    aplicacao.use(express.static(pastaDaTela));
    aplicacao.use((requisicao, resposta, proximo) => {
      if (requisicao.method !== "GET" || requisicao.path.startsWith("/api")) {
        proximo();
        return;
      }
      resposta.sendFile(path.join(pastaDaTela, "index.html"));
    });
  }

  // Só em 127.0.0.1: os agentes editam arquivos e rodam comandos com o login
  // do usuário — ninguém mais na rede pode mandar mensagens para eles.
  const servidor = aplicacao.listen(configuracao.porta, "127.0.0.1", () => {
    console.log(`Orquestrador de agentes em http://localhost:${configuracao.porta}`);
    console.log(`Projetos em: ${configuracao.pastaRaizDosProjetos}`);
  });

  const desligar = (sinal: string): void => {
    const cancelados = execucoes.cancelarTodas();
    console.log(`[${sinal}] Encerrando${cancelados > 0 ? ` e cancelando ${cancelados} turno(s)` : ""}.`);
    servidor.close();
    // Tempo para o taskkill derrubar os processos e o histórico ser gravado.
    setTimeout(() => process.exit(0), cancelados > 0 ? 2_000 : 200);
  };
  process.once("SIGINT", () => desligar("SIGINT"));
  process.once("SIGTERM", () => desligar("SIGTERM"));

  // Um erro que escapou de todo tratamento: derruba os agentes (no Windows
  // eles sobreviveriam ao servidor) e sai com código de erro, para o vigia
  // (scripts/manter-no-ar.cjs) religar o servidor.
  const cair = (erro: unknown): void => {
    console.error("[servidor] Erro inesperado; encerrando para religar:", erro);
    execucoes.cancelarTodas();
    setTimeout(() => process.exit(1), 1_500);
  };
  process.once("uncaughtException", cair);
  process.once("unhandledRejection", cair);
}

iniciar().catch((erro: unknown) => {
  console.error("Falha ao iniciar o servidor:", erro);
  process.exit(1);
});
