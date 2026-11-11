import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import express, { Express } from "express";

import { ProjetosDoChat } from "./chat/ProjetosDoChat";
import { ServicoDeChat } from "./chat/ServicoDeChat";
import { SubagentesDoChat } from "./chat/SubagentesDoChat";
import { acessoSoPeloApp } from "./controllers/acessoSoPeloApp";
import { criarAlteracoesRoutes } from "./controllers/alteracoesRoutes";
import { criarArquivosRoutes } from "./controllers/arquivosRoutes";
import { CanalDoChat, criarChatRoutes } from "./controllers/chatRoutes";
import { criarEscutaRoutes } from "./controllers/escutaRoutes";
import { criarNotasRoutes } from "./controllers/notasRoutes";
import { criarOrquestradoresRoutes } from "./controllers/orquestradoresRoutes";
import { criarPluginsRoutes } from "./controllers/pluginsRoutes";
import { criarPromptsRoutes } from "./controllers/promptsRoutes";
import { criarServidoresLocaisRoutes } from "./controllers/servidoresLocaisRoutes";
import { criarSkillsRoutes } from "./controllers/skillsRoutes";
import {
  acessoDoUpgrade,
  criarConexaoDosTerminais,
  criarTerminaisRoutes,
  origensPermitidas,
} from "./controllers/terminaisRoutes";
import { ServicoDeEscuta } from "./escuta/ServicoDeEscuta";
import { ArmazemDeAnexosEmArquivo } from "./infraestrutura/arquivos/ArmazemDeAnexosEmArquivo";
import { PastaDeEntradaDosArtefatos } from "./infraestrutura/arquivos/ColetorDeArtefatosEmPasta";
import { ExploradorDePastas } from "./infraestrutura/arquivos/ExploradorDePastas";
import { RepositorioDeNotasEmArquivo } from "./infraestrutura/arquivos/RepositorioDeNotasEmArquivo";
import { RepositorioDeOrquestradoresEmArquivo } from "./infraestrutura/arquivos/RepositorioDeOrquestradoresEmArquivo";
import { RepositorioDePreferenciasEmArquivo } from "./infraestrutura/arquivos/RepositorioDePreferenciasEmArquivo";
import { RepositorioDoChatEmArquivo } from "./infraestrutura/arquivos/RepositorioDoChatEmArquivo";
import { SistemaDeArquivosEmDisco } from "./infraestrutura/arquivos/SistemaDeArquivosEmDisco";
import { ClassificadorDePerguntaClaudeCodeCli } from "./infraestrutura/claudecode/ClassificadorDePerguntaClaudeCodeCli";
import { ConfiguracoesDeEsforcoDoClaudeCode } from "./infraestrutura/claudecode/ConfiguracoesDeEsforcoDoClaudeCode";
import { FachadaClaudeCodeCli } from "./infraestrutura/claudecode/FachadaClaudeCodeCli";
import { MedidorDeConsumoPorTranscricoes } from "./infraestrutura/claudecode/MedidorDeConsumoPorTranscricoes";
import { MotorClaudeCodeCli } from "./infraestrutura/claudecode/MotorClaudeCodeCli";
import { MotorDeChatClaudeCodeCli } from "./infraestrutura/claudecode/MotorDeChatClaudeCodeCli";
import { MotorDeMelhoriaDePromptClaudeCodeCli } from "./infraestrutura/claudecode/MotorDeMelhoriaDePromptClaudeCodeCli";
import { sondarEnderecoLocal } from "./infraestrutura/claudecode/SondaDeEnderecoLocal";
import { pastaDoClaude } from "./infraestrutura/claudecode/TranscricoesDoClaudeCode";
import {
  Configuracao,
  lerConfiguracao,
  MENSAGEM_SO_NO_APLICATIVO,
  modoDeAcesso,
} from "./infraestrutura/Configuracao";
import { ControleDeExecucoesEmMemoria } from "./infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { montarArtefatos, pastaDeEntradaDosArtefatos } from "./infraestrutura/montarArtefatos";
import { DiagnosticadorDoClaudeNoSistema } from "./infraestrutura/sistema/DiagnosticadorDoClaudeNoSistema";
import { GerenciadorDeWorktreesGit } from "./infraestrutura/sistema/GerenciadorDeWorktreesGit";
import { LeitorDeAlteracoesGit } from "./infraestrutura/sistema/LeitorDeAlteracoesGit";
import { MonitorDeMemoria } from "./infraestrutura/sistema/MonitorDeMemoria";
import { PtyDoSistema } from "./infraestrutura/sistema/PtyDoSistema";
import { RastreadorDeProcessosDeixados } from "./infraestrutura/sistema/RastreadorDeProcessosDeixados";
import { encerrarAgentesOrfaos, RegistroDeProcessos } from "./infraestrutura/sistema/RegistroDeProcessos";
import { RegistroDeProcessosDeixados } from "./infraestrutura/sistema/RegistroDeProcessosDeixados";
import { CanalDeEventos } from "./infraestrutura/sse/CanalDeEventos";
import { ServicoDeNotas } from "./notas/ServicoDeNotas";
import { Plataforma } from "./orquestracao/InstrucoesDoOrquestrador";
import { ServicoDeAlteracoes } from "./orquestracao/ServicoDeAlteracoes";
import { ServicoDeArquivos } from "./orquestracao/ServicoDeArquivos";
import { ServicoDeOrquestracao } from "./orquestracao/ServicoDeOrquestracao";
import { agendadorDoRelogio } from "./orquestracao/VigiaDoTurno";
import { CatalogoDePlugins, criarExecutorDoClaude } from "./plugins/CatalogoDePlugins";
import { PendentesEmArquivo } from "./plugins/PendentesDePlugins";
import { ServicoDeMelhoriaDePrompt } from "./prompts/ServicoDeMelhoriaDePrompt";
import { LeitorDeSkills } from "./skills/LeitorDeSkills";
import { ServicoDeTerminais } from "./terminais/ServicoDeTerminais";

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
  // Mensagens podem levar até 10 anexos e 100 MB no total, em base64 (4/3 do tamanho).
  aplicacao.use(express.json({ limit: "150mb" }));

  registrarRotas(aplicacao);

  // Depois do build, a própria API serve a tela. Em desenvolvimento quem
  // serve é o Vite, que repassa /api para cá.
  const pastaDaTela = configuracao.pastaDaTela;
  if (existsSync(pastaDaTela)) {
    aplicacao.use(isolarOrigem);
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

/**
 * Isolamento de origem (COOP + COEP): sem ele o navegador não libera threads
 * no WebAssembly, e o ditado por voz (Whisper, rodando na tela) usa um núcleo
 * só, umas 3 vezes mais lento. "credentialless" deixa a tela continuar
 * carregando recursos de fora (o modelo do Hugging Face, imagens de links).
 */
function isolarOrigem(_requisicao: express.Request, resposta: express.Response, proximo: express.NextFunction): void {
  resposta.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  resposta.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  proximo();
}

/** A porta de mensagens do Electron (`utilityProcess`); nula fora do app (`npm run dev`). */
interface PortaDoProcessoPai {
  on(evento: "message", ouvinte: (mensagem: { data: unknown }) => void): void;
}

function portaDoProcessoPai(): PortaDoProcessoPai | null {
  return (process as NodeJS.Process & { parentPort?: PortaDoProcessoPai }).parentPort ?? null;
}

/** `{ tipo: "desligar" }`, mandado por `electron/main.js` ao fechar o app. */
export function ehPedidoDeDesligar(mensagem: unknown): boolean {
  return typeof mensagem === "object" && mensagem !== null && (mensagem as { tipo?: unknown }).tipo === "desligar";
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

  const { pastaDeDados } = configuracao;
  // Pasta de entrada dos artefatos: os agentes gravam aqui (`chat/` e
  // `orquestradores/<id>/`), e o contexto de artefatos coleta. O mesmo objeto
  // do coletor, para o layout ter uma fonte só.
  const entradaDosArtefatos = new PastaDeEntradaDosArtefatos(pastaDeEntradaDosArtefatos(pastaDeDados));

  const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(configuracao.pastaDeDados);
  const notas = await RepositorioDeNotasEmArquivo.abrir(configuracao.pastaDeDados);
  const preferencias = await RepositorioDePreferenciasEmArquivo.abrir(configuracao.pastaDeDados);
  const repositorioDoChat = await RepositorioDoChatEmArquivo.abrir(configuracao.pastaDeDados, randomUUID);

  // Antes de registrar processos novos: se o servidor anterior caiu, os
  // agentes dele podem ter ficado rodando sozinhos.
  const arquivoDeProcessos = path.join(configuracao.pastaDeDados, "processos-em-execucao.json");
  const orfaos = await encerrarAgentesOrfaos(arquivoDeProcessos);
  if (orfaos > 0) {
    console.warn(`[processos] ${orfaos} agente(s) deixado(s) rodando pelo servidor anterior foram encerrados.`);
  }
  const registro = new RegistroDeProcessos(arquivoDeProcessos);
  // Processos que os agentes deixam rodando depois do turno (ADR-38): o
  // registro carrega o que o servidor anterior deixou, e o que ainda for o
  // mesmo processo é encerrado agora (reserva para quando o servidor caiu).
  const rastreador = new RastreadorDeProcessosDeixados({
    deixados: new RegistroDeProcessosDeixados(path.join(configuracao.pastaDeDados, "processos-deixados-pelos-agentes.json")),
    agentes: registro,
    // Nunca: o próprio servidor e o Electron que o iniciou.
    protegidos: [process.pid, process.ppid],
    pidDoServidor: process.pid,
  });
  const deixadosAntes = await rastreador.encerrarTodos();
  if (deixadosAntes > 0) {
    console.warn(`[processos] ${deixadosAntes} processo(s) deixado(s) pelos agentes antes do reinício foram encerrados.`);
  }
  const monitor = new MonitorDeMemoria(registro, undefined, rastreador);
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

  // Terminais interativos do canvas: shells do usuário num pseudoterminal.
  const terminais = new ServicoDeTerminais({ pty: new PtyDoSistema(), gerarId: randomUUID, agora: () => new Date() });

  // A plataforma decide a sintaxe dos comandos ensinados aos agentes (no
  // Windows, PowerShell): lida uma vez aqui, o domínio só a recebe.
  const plataforma: Plataforma = process.platform === "win32" ? "windows" : "unix";

  const servico = new ServicoDeOrquestracao({
    repositorio,
    motor: new MotorClaudeCodeCli(
      new FachadaClaudeCodeCli(configuracao.caminhoDoClaudeCode, registro, undefined, rastreador),
      sondarEnderecoLocal,
      plataforma,
    ),
    execucoes,
    publicador: canal,
    anexos,
    worktrees,
    pastaDeArtefatos: (orquestradorId) => entradaDosArtefatos.pastaDoOrquestrador(orquestradorId),
    preferencias,
    gerarId: randomUUID,
    agora: () => new Date(),
    // Economia de tokens (ADR-21): custo de cada turno lido das transcrições e
    // esforço que o Claude Code da máquina usa quando o app deixa "Padrão".
    medidor: new MedidorDeConsumoPorTranscricoes(),
    esforcoDaMaquina: new ConfiguracoesDeEsforcoDoClaudeCode(),
    // Autorrecuperação (ADR-36): a vigia examina o Claude em silêncio pelo
    // mesmo registro de processos, e as esperas usam o relógio de verdade.
    diagnosticador: new DiagnosticadorDoClaudeNoSistema(registro),
    agendador: agendadorDoRelogio,
    // Removido o Orquestrador, vão junto os terminais do canvas ligados a ele
    // e os processos que os agentes dele deixaram rodando.
    aoRemover: async (orquestradorId) => {
      const fechados = terminais.encerrarDoOrquestrador(orquestradorId);
      const encerrados = await rastreador.encerrarDoOrquestrador(orquestradorId);
      if (fechados + encerrados > 0) {
        console.log(`[orquestracao] Removido ${orquestradorId}: ${fechados} terminal(is) e ${encerrados} processo(s) encerrados.`);
      }
    },
  });

  const interrompidos = await servico.interromperTurnosPendentes();
  if (interrompidos > 0) {
    console.warn(`[orquestracao] ${interrompidos} turno(s) marcado(s) como interrompido(s) pelo reinício.`);
  }
  // Depois das interrupções: as retomadas gravadas antes do reinício voltam ao relógio (ADR-36).
  const reagendadas = await servico.reagendarRetomadasPendentes();
  if (reagendadas > 0) {
    console.warn(`[orquestracao] ${reagendadas} retomada(s) automática(s) reagendada(s) após o reinício.`);
  }

  // Adaptador: o chat enxerga projetos pelo nome e pasta, e Orquestradores
  // também pelo estado (ocupado ou não, fila, worktree), sem o agregado.
  const explorador = new ExploradorDePastas(configuracao.pastaRaizDosProjetos);
  const projetosDoChat: ProjetosDoChat = {
    listarProjetos: () => explorador.listarProjetos(),
    listarOrquestradores: async () =>
      repositorio.listar().map((orquestrador) => {
        const turno = orquestrador.turnoEmAndamento;
        const worktree = orquestrador.worktree;
        return {
          nome: orquestrador.nome,
          pasta: orquestrador.pastaDeTrabalho.caminho,
          situacao: orquestrador.situacao,
          pedidoAtual: turno?.texto ?? null,
          turnoIniciadoEm: turno?.iniciadoEm ?? null,
          tamanhoDaFila: orquestrador.fila.length,
          planoPendente: orquestrador.turnoComPlanoPendente !== null,
          branch: worktree?.branch ?? null,
          // Sem rodar git: o fim do turno remove o worktree limpo, então um
          // que ficou com o orquestrador parado tem alterações. No turno, desconhecido.
          alteracoesSemCommit: turno === null ? worktree !== null : null,
        };
      }),
  };
  // Adaptador: o chat vê os subagentes prontos sem o prompt, lidos a cada pergunta.
  const subagentesDoChat: SubagentesDoChat = {
    listarSubagentesProntos: async () =>
      preferencias.atuais().subagentesProntos.map(({ nome, descricao, modelo }) => ({ nome, descricao, modelo })),
  };
  const canalDoChat = new CanalDoChat();
  const servicoDeChat = new ServicoDeChat({
    repositorio: repositorioDoChat,
    // O chat roda comandos como os Orquestradores: o que ele deixar rodando também é acompanhado.
    motor: new MotorDeChatClaudeCodeCli(
      new FachadaClaudeCodeCli(configuracao.caminhoDoClaudeCode, registro, undefined, rastreador),
    ),
    projetos: projetosDoChat,
    subagentes: subagentesDoChat,
    // dados/anexos/chat/: o mesmo armazém dos Orquestradores, com a chave "chat".
    anexos,
    publicador: canalDoChat,
    // O mesmo controle dos turnos: ao desligar, a resposta do chat também é cancelada.
    execucoes,
    pastaDaSessao: repositorioDoChat.pastaDaSessao,
    pastaDosProjetos: configuracao.pastaRaizDosProjetos,
    pastaDeArtefatos: entradaDosArtefatos.pastaDoChat,
    gerarId: randomUUID,
    agora: () => new Date(),
  });
  if (await servicoDeChat.interromperRespostaPendente()) {
    console.warn("[chat] A resposta em andamento foi marcada como interrompida pelo reinício.");
  }

  // Melhorar prompt: chamada curta ao Claude Code (Haiku, sem ferramentas). O
  // mesmo controle dos turnos: ao desligar, a melhoria em andamento é cancelada.
  // Sem ferramentas não deixa nada rodando: fica fora do rastreador.
  const servicoDeMelhoria = new ServicoDeMelhoriaDePrompt({
    motor: new MotorDeMelhoriaDePromptClaudeCodeCli(new FachadaClaudeCodeCli(configuracao.caminhoDoClaudeCode, registro)),
    execucoes,
    gerarId: randomUUID,
    agora: () => new Date(),
  });

  // Escuta no modo invisível: confirma com uma chamada curta ao Claude Code
  // (Haiku, sem ferramentas) se um trecho do áudio transcrito é uma pergunta.
  // O mesmo controle dos turnos: ao desligar, a classificação é cancelada.
  const servicoDeEscuta = new ServicoDeEscuta({
    classificador: new ClassificadorDePerguntaClaudeCodeCli(
      new FachadaClaudeCodeCli(configuracao.caminhoDoClaudeCode, registro),
    ),
    execucoes,
    gerarId: randomUUID,
  });

  // Artefatos: coleta o que os agentes gravam na pasta de entrada e serve na tela.
  const artefatos = await montarArtefatos({ pastaDeDados });

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
        preferencias,
        pastaRaiz: configuracao.pastaRaizDosProjetos,
        plataforma,
      }),
    );
    // Painel de alterações do worktree: só leitura, sobre o mesmo repositório dos Orquestradores.
    rotas.use(
      "/api",
      criarAlteracoesRoutes({
        servico: new ServicoDeAlteracoes({ repositorio, leitor: new LeitorDeAlteracoesGit() }),
      }),
    );
    // Visualizador de código: lista e lê arquivos da pasta (ou worktree) de um Orquestrador. Só leitura.
    rotas.use(
      "/api",
      criarArquivosRoutes({
        servico: new ServicoDeArquivos({ repositorio, sistema: new SistemaDeArquivosEmDisco() }),
      }),
    );
    rotas.use("/api", criarChatRoutes({ servico: servicoDeChat, canal: canalDoChat, anexos }));
    rotas.use(
      "/api",
      criarNotasRoutes({
        servico: new ServicoDeNotas({ repositorio: notas, gerarId: randomUUID, agora: () => new Date() }),
      }),
    );
    rotas.use("/api", criarPromptsRoutes({ servico: servicoDeMelhoria }));
    rotas.use("/api", criarEscutaRoutes({ servico: servicoDeEscuta }));
    // Faixa de servidores: confere se os endereços locais citados pelos agentes ainda respondem.
    rotas.use("/api", criarServidoresLocaisRoutes({ sondar: sondarEnderecoLocal }));
    // Skills do Claude Code (usuário, projeto e plugins): só leitura de nome e descrição.
    rotas.use(
      "/api",
      criarSkillsRoutes({ leitor: new LeitorDeSkills({ pastaDoClaude: pastaDoClaude() }), repositorio }),
    );
    // Plugins do marketplace do Claude Code: catálogo, instalar, ligar, desligar e remover (escopo do usuário).
    const catalogoDePlugins = new CatalogoDePlugins({
      executar: criarExecutorDoClaude(configuracao.caminhoDoClaudeCode),
      pastaDoClaude: pastaDoClaude(),
      pendentes: new PendentesEmArquivo(path.join(configuracao.pastaDeDados, "plugins-pendentes-de-confirmacao.json")),
    });
    // No início, desliga o que o app instalou e ficou ligado sem confirmação (o app pode ter fechado no meio).
    void catalogoDePlugins.reconciliar();
    rotas.use("/api", criarPluginsRoutes({ catalogo: catalogoDePlugins }));
    rotas.use("/api", artefatos.rotas);
    rotas.use(
      "/api",
      criarTerminaisRoutes({
        servico: terminais,
        repositorio,
        pastaExiste: (caminho) => explorador.existe(caminho),
        pastaRaiz: configuracao.pastaRaizDosProjetos,
      }),
    );
  });
  // Depois das rotas: inclui o que chegou na pasta de entrada com o servidor desligado.
  await artefatos.iniciar();

  // Só em 127.0.0.1: os agentes editam arquivos e rodam comandos com o login
  // do usuário — ninguém mais na rede pode mandar mensagens para eles.
  const servidor = aplicacao.listen(configuracao.porta, "127.0.0.1", () => {
    console.log(`Orquestrador de agentes em http://localhost:${configuracao.porta}`);
    console.log(`Projetos em: ${configuracao.pastaRaizDosProjetos}`);
  });

  // WebSocket dos terminais: o upgrade não passa pelo Express, então a trava
  // do aplicativo e a origem são conferidas no próprio upgrade. A tela do Vite
  // no `desktop:dev` (ORQUESTRADOR_URL_DA_TELA) também é uma origem aceita.
  const urlDaTelaDeDesenvolvimento = process.env.ORQUESTRADOR_URL_DA_TELA;
  const conexaoDosTerminais = criarConexaoDosTerminais({
    servico: terminais,
    temAcesso: acessoDoUpgrade(modo === "aplicativo" ? configuracao.chaveDeAcesso : null),
    origemPermitida: origensPermitidas({
      porta: configuracao.porta,
      extras: urlDaTelaDeDesenvolvimento ? [urlDaTelaDeDesenvolvimento] : [],
      qualquerPortaLocal: modo === "navegador",
    }),
  });
  servidor.on("upgrade", conexaoDosTerminais.aoPedirUpgrade);

  let desligando = false;
  const desligar = (sinal: string): void => {
    if (desligando) {
      return;
    }
    desligando = true;
    const cancelados = execucoes.cancelarTodas();
    console.log(`[${sinal}] Encerrando${cancelados > 0 ? ` e cancelando ${cancelados} turno(s)` : ""}.`);
    terminais.encerrarTodos();
    conexaoDosTerminais.encerrar();
    servidor.close();
    monitor.parar();
    rastreador.parar();
    artefatos
      .encerrar()
      .catch((erro: unknown) => console.warn("[artefatos] Falha ao encerrar a coleta:", erro));
    // Fechar o app derruba o que os agentes deixaram rodando (ADR-38), com um
    // limite: a listagem no Windows leva 1–2 s.
    const limite = new Promise<number>((resolver) => setTimeout(() => resolver(0), 5_000));
    void Promise.race([rastreador.encerrarTodos(), limite])
      .then((encerrados) => {
        if (encerrados > 0) {
          console.log(`[processos] ${encerrados} processo(s) deixado(s) pelos agentes foram encerrados.`);
        }
      })
      .catch((erro: unknown) => console.warn("[processos] Falha ao encerrar os processos deixados:", erro))
      // Tempo para o taskkill derrubar os processos e o histórico ser gravado.
      .finally(() => setTimeout(() => process.exit(0), cancelados > 0 ? 2_000 : 200));
  };
  process.once("SIGINT", () => desligar("SIGINT"));
  process.once("SIGTERM", () => desligar("SIGTERM"));
  // No app, o Electron pede o desligamento por mensagem: no Windows ele não
  // tem como mandar SIGTERM, e o `taskkill /F` não daria tempo ao `desligar`.
  portaDoProcessoPai()?.on("message", (evento) => {
    if (ehPedidoDeDesligar(evento.data)) {
      desligar("app");
    }
  });

  // Um erro que escapou de todo tratamento: derruba os agentes (no Windows
  // eles sobreviveriam ao servidor) e sai com código de erro, para o app
  // desktop (electron/main.js) religar o servidor.
  const cair = (erro: unknown): void => {
    console.error("[servidor] Erro inesperado; encerrando para religar:", erro);
    execucoes.cancelarTodas();
    terminais.encerrarTodos();
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
