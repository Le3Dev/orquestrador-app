import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import express, { Express } from "express";

import { ProjetosDoChat } from "./chat/ProjetosDoChat";
import { ServicoDeChat } from "./chat/ServicoDeChat";
import { acessoSoPeloApp } from "./controllers/acessoSoPeloApp";
import { criarAlteracoesRoutes } from "./controllers/alteracoesRoutes";
import { CanalDoChat, criarChatRoutes } from "./controllers/chatRoutes";
import { criarNotasRoutes } from "./controllers/notasRoutes";
import { criarOrquestradoresRoutes } from "./controllers/orquestradoresRoutes";
import { ArmazemDeAnexosEmArquivo } from "./infraestrutura/arquivos/ArmazemDeAnexosEmArquivo";
import { ExploradorDePastas } from "./infraestrutura/arquivos/ExploradorDePastas";
import { RepositorioDeNotasEmArquivo } from "./infraestrutura/arquivos/RepositorioDeNotasEmArquivo";
import { RepositorioDeOrquestradoresEmArquivo } from "./infraestrutura/arquivos/RepositorioDeOrquestradoresEmArquivo";
import { RepositorioDoChatEmArquivo } from "./infraestrutura/arquivos/RepositorioDoChatEmArquivo";
import { ConfiguracoesDeEsforcoDoClaudeCode } from "./infraestrutura/claudecode/ConfiguracoesDeEsforcoDoClaudeCode";
import { FachadaClaudeCodeCli } from "./infraestrutura/claudecode/FachadaClaudeCodeCli";
import { MedidorDeConsumoPorTranscricoes } from "./infraestrutura/claudecode/MedidorDeConsumoPorTranscricoes";
import { MotorClaudeCodeCli } from "./infraestrutura/claudecode/MotorClaudeCodeCli";
import { MotorDeChatClaudeCodeCli } from "./infraestrutura/claudecode/MotorDeChatClaudeCodeCli";
import {
  Configuracao,
  lerConfiguracao,
  MENSAGEM_SO_NO_APLICATIVO,
  modoDeAcesso,
} from "./infraestrutura/Configuracao";
import { ControleDeExecucoesEmMemoria } from "./infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { GerenciadorDeWorktreesGit } from "./infraestrutura/sistema/GerenciadorDeWorktreesGit";
import { LeitorDeAlteracoesGit } from "./infraestrutura/sistema/LeitorDeAlteracoesGit";
import { MonitorDeMemoria } from "./infraestrutura/sistema/MonitorDeMemoria";
import { encerrarAgentesOrfaos, RegistroDeProcessos } from "./infraestrutura/sistema/RegistroDeProcessos";
import { CanalDeEventos } from "./infraestrutura/sse/CanalDeEventos";
import { ServicoDeNotas } from "./notas/ServicoDeNotas";
import { ServicoDeAlteracoes } from "./orquestracao/ServicoDeAlteracoes";
import { ServicoDeOrquestracao } from "./orquestracao/ServicoDeOrquestracao";

type ConfiguracaoDaMontagem = Pick<
  Configuracao,
  "chaveDeAcesso" | "permitirNavegador" | "urlDeDownload" | "pastaDaTela"
>;

/**
 * Monta o Express na ordem que importa: a trava do aplicativo primeiro (antes
 * do corpo JSON, das rotas, do SSE e da tela), depois as rotas e, por último,
 * a tela estática.
 */
export function montarAplicacao(
  configuracao: ConfiguracaoDaMontagem,
  registrarRotas: (aplicacao: Express) => void,
): Express {
  const modo = modoDeAcesso(configuracao);
  if (modo === "recusado") {
    throw new Error(MENSAGEM_SO_NO_APLICATIVO);
  }

  const aplicacao = express();
  aplicacao.disable("x-powered-by");
  if (modo === "aplicativo" && configuracao.chaveDeAcesso !== null) {
    aplicacao.use(
      acessoSoPeloApp({ chave: configuracao.chaveDeAcesso, urlDeDownload: configuracao.urlDeDownload }),
    );
  }
  // Mensagens podem levar até 5 imagens de 5 MB, em base64.
  aplicacao.use(express.json({ limit: "40mb" }));

  registrarRotas(aplicacao);

  // Depois do build, a própria API serve a tela. Em desenvolvimento quem
  // serve é o Vite, que repassa /api para cá.
  const pastaDaTela = configuracao.pastaDaTela;
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
  return aplicacao;
}

async function iniciar(): Promise<void> {
  const configuracao = lerConfiguracao();

  // Antes de abrir porta ou mexer em dados e processos: fora do aplicativo
  // (e sem a liberação de desenvolvimento) o servidor nem sobe.
  const modo = modoDeAcesso(configuracao);
  if (modo === "recusado") {
    process.stderr.write(`${MENSAGEM_SO_NO_APLICATIVO}\n`);
    process.exitCode = 1;
    return;
  }
  if (modo === "navegador") {
    console.warn(
      "[acesso] ORQUESTRADOR_PERMITIR_NAVEGADOR=1: acesso pelo navegador liberado, sem a trava do aplicativo. Use só em desenvolvimento.",
    );
  }

  if (path.isAbsolute(configuracao.caminhoDoClaudeCode) && !existsSync(configuracao.caminhoDoClaudeCode)) {
    console.warn(
      `[configuracao] Claude Code não encontrado em "${configuracao.caminhoDoClaudeCode}". Ajuste CLAUDE_CODE_BIN no .env.`,
    );
  }

  const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(configuracao.pastaDeDados);
  const notas = await RepositorioDeNotasEmArquivo.abrir(configuracao.pastaDeDados);
  const repositorioDoChat = await RepositorioDoChatEmArquivo.abrir(configuracao.pastaDeDados, randomUUID);

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
    // Economia de tokens (ADR-21): custo de cada turno lido das transcrições e
    // esforço que o Claude Code da máquina usa quando o app deixa "Padrão".
    medidor: new MedidorDeConsumoPorTranscricoes(),
    esforcoDaMaquina: new ConfiguracoesDeEsforcoDoClaudeCode(),
  });

  const interrompidos = await servico.interromperTurnosPendentes();
  if (interrompidos > 0) {
    console.warn(`[orquestracao] ${interrompidos} turno(s) marcado(s) como interrompido(s) pelo reinício.`);
  }

  // Adaptador: o chat enxerga projetos e Orquestradores só como nome e pasta.
  const explorador = new ExploradorDePastas(configuracao.pastaRaizDosProjetos);
  const projetosDoChat: ProjetosDoChat = {
    listarProjetos: () => explorador.listarProjetos(),
    listarOrquestradores: async () =>
      repositorio.listar().map((orquestrador) => ({
        nome: orquestrador.nome,
        pasta: orquestrador.pastaDeTrabalho.caminho,
      })),
  };
  const canalDoChat = new CanalDoChat();
  const servicoDeChat = new ServicoDeChat({
    repositorio: repositorioDoChat,
    motor: new MotorDeChatClaudeCodeCli(new FachadaClaudeCodeCli(configuracao.caminhoDoClaudeCode, registro)),
    projetos: projetosDoChat,
    // dados/anexos/chat/: o mesmo armazém dos Orquestradores, com a chave "chat".
    anexos,
    publicador: canalDoChat,
    // O mesmo controle dos turnos: ao desligar, a resposta do chat também é cancelada.
    execucoes,
    pastaDaSessao: repositorioDoChat.pastaDaSessao,
    pastaDosProjetos: configuracao.pastaRaizDosProjetos,
    gerarId: randomUUID,
    agora: () => new Date(),
  });
  if (await servicoDeChat.interromperRespostaPendente()) {
    console.warn("[chat] A resposta em andamento foi marcada como interrompida pelo reinício.");
  }

  // A tela consulta /api/saude a cada poucos segundos para saber se o servidor
  // está no ar. O instante de início denuncia um reinício: os pedidos que
  // rodavam antes dele foram interrompidos.
  const iniciadoEm = new Date().toISOString();
  const aplicacao = montarAplicacao(configuracao, (rotas) => {
    rotas.get("/api/saude", (_requisicao, resposta) => {
      resposta.json({ ok: true, iniciadoEm, memoria: monitor.ultimaLeitura });
    });
    rotas.use(
      "/api",
      criarOrquestradoresRoutes({
        servico,
        repositorio,
        canal,
        explorador,
        anexos,
        pastaRaiz: configuracao.pastaRaizDosProjetos,
      }),
    );
    // Painel de alterações do worktree: só leitura, sobre o mesmo repositório dos Orquestradores.
    rotas.use(
      "/api",
      criarAlteracoesRoutes({
        servico: new ServicoDeAlteracoes({ repositorio, leitor: new LeitorDeAlteracoesGit() }),
      }),
    );
    rotas.use("/api", criarChatRoutes({ servico: servicoDeChat, canal: canalDoChat, anexos }));
    rotas.use(
      "/api",
      criarNotasRoutes({
        servico: new ServicoDeNotas({ repositorio: notas, gerarId: randomUUID, agora: () => new Date() }),
      }),
    );
  });

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
  // eles sobreviveriam ao servidor) e sai com código de erro, para o app
  // desktop (electron/main.js) religar o servidor.
  const cair = (erro: unknown): void => {
    console.error("[servidor] Erro inesperado; encerrando para religar:", erro);
    execucoes.cancelarTodas();
    setTimeout(() => process.exit(1), 1_500);
  };
  process.once("uncaughtException", cair);
  process.once("unhandledRejection", cair);
}

// Nos testes (vitest), só montarAplicacao é usada: importar não sobe o servidor.
if (process.env.VITEST === undefined) {
  iniciar().catch((erro: unknown) => {
    console.error("Falha ao iniciar o servidor:", erro);
    process.exit(1);
  });
}
