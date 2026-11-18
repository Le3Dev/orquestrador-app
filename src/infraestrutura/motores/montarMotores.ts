import { Router } from "express";

import { criarMotoresRoutes } from "../../controllers/motoresRoutes";
import { FERRAMENTA_DE_DELEGACAO, Plataforma } from "../../orquestracao/InstrucoesDoOrquestrador";
import { Motor } from "../../orquestracao/Motor";
import { MotorDeAgentes } from "../../orquestracao/MotorDeAgentes";
import { MotorAcp } from "../acp/MotorAcp";
import { criarPerfilDoCopilot } from "../acp/PerfilDoCopilot";
import { verificarLoginDoCopilot as verificadorPadraoDoCopilot } from "../acp/VerificadorDeLoginDoCopilot";
import { FachadaClaudeCodeCli } from "../claudecode/FachadaClaudeCodeCli";
import { SondaDeEndereco, sondarEnderecoLocal } from "../claudecode/SondaDeEnderecoLocal";
import { MotorCodex } from "../codex/MotorCodex";
import { criarGrupoDeFerramentasDeDelegacao, NOME_DO_GRUPO_DE_DELEGACAO } from "../mcp/FerramentasDeDelegacao";
import { ServidorMcpDoApp } from "../mcp/ServidorMcpDoApp";
import { AcompanhamentoDeProcessos } from "../sistema/RastreadorDeProcessosDeixados";
import { RegistroDeProcessos } from "../sistema/RegistroDeProcessos";
import { FerramentasDoAppNoTurno } from "./ApoioDosMotores";
import { CatalogoDeMotores, VerificadorDeLogin } from "./CatalogoDeMotores";
import { ExecutorDeComandoCurto } from "./ExecucaoCurtaDeCli";
import { procurarExecutavel } from "./ExecutavelDoCli";
import { ExecutorDeSubtarefas } from "./ExecutorDeSubtarefas";
import { RegistroDeTurnosDoApp } from "./RegistroDeTurnosDoApp";
import { RoteadorDeMotores } from "./RoteadorDeMotores";
import { SubtarefaNoClaudeCode } from "./SubtarefaNoClaudeCode";
import { ExecutorDeSubtarefa } from "./SubtarefaDoApp";

/**
 * Onde cada CLI está: o nome (procurado no `PATH`) ou o caminho. O do Codex e o
 * do Copilot podem ser trocados por `CODEX_BIN` e `COPILOT_BIN`; o do Claude
 * Code vem da configuração do app (`CLAUDE_CODE_BIN`), por `caminhoDoClaudeCode`.
 */
export function caminhosDosMotoresDoAmbiente(
  ambiente: NodeJS.ProcessEnv = process.env,
  caminhoDoClaudeCode = "claude",
): Record<Motor, string> {
  return {
    "claude-code": caminhoDoClaudeCode,
    codex: ambiente["CODEX_BIN"] || "codex",
    copilot: ambiente["COPILOT_BIN"] || "copilot",
  };
}

export interface OpcoesDeMontarMotores {
  /** O motor do Claude Code, já montado (`MotorClaudeCodeCli`): o roteador o usa para `claude-code`. */
  motorClaudeCode: MotorDeAgentes;
  /** O servidor MCP do app. O `montarMotores` registra nele o grupo `delegar_subtarefas`; quem o inicia é `iniciar()`. */
  servidorMcp: ServidorMcpDoApp;
  /**
   * A fachada do Claude Code, para a delegação rodar `claude -p` como agente
   * único quando os subagentes são do Claude Code e o Orquestrador não. Sem ela,
   * essa combinação devolve a falha "motor indisponível" à subtarefa.
   */
  fachadaClaudeCode?: FachadaClaudeCodeCli | undefined;
  /** Onde estão os CLIs; padrão `caminhosDosMotoresDoAmbiente(ambiente)`. */
  caminhos?: Readonly<Record<Motor, string>> | undefined;
  ambiente?: NodeJS.ProcessEnv | undefined;
  registro?: RegistroDeProcessos | null | undefined;
  acompanhamento?: AcompanhamentoDeProcessos | null | undefined;
  sondar?: SondaDeEndereco | undefined;
  plataforma?: Plataforma | undefined;
  versaoDoApp?: string | undefined;
  /**
   * Os nomes das ferramentas do servidor MCP do app, para o Copilot reconhecer
   * as chamadas do app entre as dele (ele só informa o nome da ferramenta). Padrão:
   * só `delegar_subtarefas`; quem registra outros grupos (o navegador) os acrescenta.
   */
  ferramentasDoApp?: readonly string[] | undefined;
  /** Quais grupos do servidor MCP o turno liga; padrão: a delegação quando o motor precisa dela. */
  ferramentasDoTurno?: FerramentasDoAppNoTurno | undefined;
  gerarId?: (() => string) | undefined;
  /** Para testes: como o catálogo consulta os CLIs. */
  executarComando?: ExecutorDeComandoCurto | undefined;
  verificarLoginDoCopilot?: VerificadorDeLogin | undefined;
}

export interface MotoresMontados {
  /** O ponto de entrada de todos os motores: vai no `ServicoDeOrquestracao` no lugar do `MotorClaudeCodeCli`. */
  motor: MotorDeAgentes;
  /** `GET /motores`: monte em `/api`. */
  rotas: Router;
  catalogo: CatalogoDeMotores;
  turnos: RegistroDeTurnosDoApp;
  /** Inicia o servidor MCP do app (se ainda não estiver). É o que um turno precisa de pé; o resto fica para `aquecer`. */
  iniciar(): Promise<void>;
  /**
   * Em segundo plano, sem esperar: carrega o SDK do MCP e consulta os CLIs dos motores (a primeira
   * consulta leva alguns segundos, e iniciar os CLIs trava o processo por um tempo no Windows).
   * Chame depois de o servidor HTTP já estar escutando: nada disso é pré-requisito do `listen`.
   */
  aquecer(): void;
  /** Solta o que o catálogo guardou. O servidor MCP, que o chamador possui, não é encerrado aqui. */
  encerrar(): Promise<void>;
}

/**
 * Monta todos os motores: o do Claude Code (recebido), o Codex (protocolo
 * `app-server`) e o GitHub Copilot CLI (ACP), o roteador que escolhe entre eles
 * pelo `pedido.motor`, a delegação de subtarefas (ferramenta MCP
 * `delegar_subtarefas`, registrada no servidor MCP recebido) e a rota `GET /motores`.
 */
export function montarMotores(opcoes: OpcoesDeMontarMotores): MotoresMontados {
  const ambiente = opcoes.ambiente ?? process.env;
  const caminhos = opcoes.caminhos ?? caminhosDosMotoresDoAmbiente(ambiente);
  const plataforma = opcoes.plataforma ?? "unix";
  const sondar = opcoes.sondar ?? sondarEnderecoLocal;
  const turnos = new RegistroDeTurnosDoApp();
  /** O CLI é procurado a cada turno: quem o instala com o app aberto não precisa reiniciá-lo. */
  const acharCli = (motor: Motor) => () => procurarExecutavel(caminhos[motor], { ambiente }) ?? caminhos[motor];

  const comuns = {
    servidorMcp: opcoes.servidorMcp,
    turnos,
    registro: opcoes.registro ?? null,
    acompanhamento: opcoes.acompanhamento ?? null,
    sondar,
    plataforma,
    ...(opcoes.versaoDoApp === undefined ? {} : { versaoDoApp: opcoes.versaoDoApp }),
    ...(opcoes.ferramentasDoTurno === undefined ? {} : { ferramentasDoTurno: opcoes.ferramentasDoTurno }),
  };
  const motorCodex = new MotorCodex({ executavel: acharCli("codex"), ...comuns });
  const motorCopilot = new MotorAcp({
    perfil: criarPerfilDoCopilot(acharCli("copilot"), {
      ferramentasDoApp: opcoes.ferramentasDoApp ?? [FERRAMENTA_DE_DELEGACAO],
    }),
    ...comuns,
  });

  const executores: Partial<Record<Motor, ExecutorDeSubtarefa>> = {
    codex: motorCodex,
    copilot: motorCopilot,
    ...(opcoes.fachadaClaudeCode === undefined
      ? {}
      : { "claude-code": new SubtarefaNoClaudeCode(opcoes.fachadaClaudeCode, plataforma) }),
  };
  opcoes.servidorMcp.registrarGrupoDeFerramentas(
    NOME_DO_GRUPO_DE_DELEGACAO,
    criarGrupoDeFerramentasDeDelegacao({
      turnos,
      executor: new ExecutorDeSubtarefas(executores),
      ...(opcoes.gerarId === undefined ? {} : { gerarId: opcoes.gerarId }),
    }),
  );

  const catalogo = new CatalogoDeMotores({
    caminhos,
    ambiente,
    verificarLoginDoCopilot: opcoes.verificarLoginDoCopilot ?? verificadorPadraoDoCopilot,
    ...(opcoes.executarComando === undefined ? {} : { executar: opcoes.executarComando }),
  });

  return {
    motor: new RoteadorDeMotores({
      motores: { "claude-code": opcoes.motorClaudeCode, codex: motorCodex, copilot: motorCopilot },
      turnos,
    }),
    rotas: criarMotoresRoutes({ catalogo }),
    catalogo,
    turnos,
    async iniciar() {
      await opcoes.servidorMcp.iniciar();
    },
    aquecer() {
      void opcoes.servidorMcp
        .aquecer()
        .catch((erro: unknown) => console.warn("[mcp] Não foi possível carregar o SDK do MCP:", erro));
      // Aquece o catálogo: a primeira consulta leva alguns segundos (cada CLI responde no seu tempo).
      void catalogo.listar().catch((erro: unknown) => console.warn("[motores] Não foi possível consultar os CLIs:", erro));
    },
    async encerrar() {
      catalogo.invalidar();
    },
  };
}
