import { FERRAMENTA_DE_DELEGACAO } from "../../orquestracao/InstrucoesDoOrquestrador";
import { padroesDeNegacaoDeComandos, permiteComandos } from "../motores/PoliticaDePermissao";
import { ehFerramentaComONome } from "./AdaptadorDeEventosAcp";
import { CODIGO_DE_AUTENTICACAO_ACP } from "./FachadaAcp";
import { PerfilAcp } from "./PerfilAcp";

/**
 * Variáveis do Copilot que liberam todas as permissões por fora do app
 * (`COPILOT_ALLOW_ALL` é o `--allow-all-tools`): nunca herdadas.
 */
const VARIAVEIS_QUE_LIBERAM_TUDO = ["COPILOT_ALLOW_ALL", "COPILOT_ALLOW_ALL_TOOLS", "COPILOT_YOLO"];

/**
 * Quanto uma chamada de ferramenta do app pode levar (ms). Sem isto o Copilot
 * desiste da chamada com "Request timed out" em cerca de 3 minutos (verificado
 * no 1.0.83), e `delegar_subtarefas` espera subagentes que levam mais que isso.
 */
export const TEMPO_MAXIMO_DA_FERRAMENTA_DO_APP_MS = 3_600_000;

export interface OpcoesDoPerfilDoCopilot {
  /**
   * Os nomes das ferramentas do servidor MCP do app. O Copilot põe só o nome
   * da ferramenta no título do pedido de permissão (sem o do servidor): é por
   * ele que o app reconhece as próprias ferramentas. Padrão: a delegação.
   */
  ferramentasDoApp?: readonly string[];
}

/**
 * O GitHub Copilot CLI como agente ACP: `copilot --acp --stdio`
 * (https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server).
 *
 * Argumentos fixos: sem atualização automática no meio do turno, sem
 * `ask_user` (as perguntas ao usuário vão pelos blocos do app, na resposta
 * final) e sem cores. A pasta de artefatos (e a dos anexos) entra em
 * `--add-dir`: fora da pasta de trabalho o Copilot não abriria os arquivos.
 *
 * Segunda barreira, na entrada do CLI (verificado no Copilot 1.0.83: o CLI
 * nega sozinho, sem nem perguntar ao app): sem terminal no nível (ou no
 * planejamento), `--deny-tool=shell`; sem commit e push liberados,
 * `--deny-tool=shell(git commit)` e `shell(git push)`. A política do app
 * (`session/request_permission`) decide de qualquer forma.
 *
 * O sandbox do Copilot (`--sandbox`) é experimental e falha em máquinas sem os
 * pré-requisitos do sistema, derrubando todo comando: o app não o liga.
 */
export function criarPerfilDoCopilot(executavel: string | (() => string), opcoes: OpcoesDoPerfilDoCopilot = {}): PerfilAcp {
  const ferramentasDoApp = opcoes.ferramentasDoApp ?? [FERRAMENTA_DE_DELEGACAO];
  return {
    motor: "copilot",
    nomeDoCli: "GitHub Copilot CLI",
    comoEntrar: "copilot login",
    comoInstalar: "npm install -g @github/copilot",
    comando: () => ({
      // Resolvido a cada turno: quem instala o CLI com o app aberto não precisa reiniciá-lo.
      executavel: typeof executavel === "function" ? executavel() : executavel,
      argumentosIniciais: ["--acp", "--stdio", "--no-auto-update", "--no-ask-user", "--no-color"],
    }),
    argumentosDoTurno: ({ contexto, modelo }) => [
      "--add-dir",
      contexto.pastaDeArtefatos,
      ...(contexto.pastaDosAnexos === null ? [] : ["--add-dir", contexto.pastaDosAnexos]),
      ...(modelo === "padrao" ? [] : ["--model", modelo]),
      ...(permiteComandos(contexto) ? [] : ["--deny-tool=shell"]),
      ...padroesDeNegacaoDeComandos(contexto).map((padrao) => `--deny-tool=${padrao}`),
    ],
    ambiente: (base) => {
      const ambiente: NodeJS.ProcessEnv = { ...base, NO_COLOR: "1" };
      for (const variavel of VARIAVEIS_QUE_LIBERAM_TUDO) {
        delete ambiente[variavel];
      }
      return ambiente;
    },
    ehFerramentaDoApp: (chamada) => chamada.tipo === "other" && ehFerramentaComONome(chamada, ferramentasDoApp),
    mcpPorArquivo: {
      conteudo: (servidor) => ({
        mcpServers: {
          [servidor.nome]: {
            type: "http",
            url: servidor.url,
            headers: { Authorization: `Bearer ${servidor.token}` },
            tools: ["*"],
            timeout: TEMPO_MAXIMO_DA_FERRAMENTA_DO_APP_MS,
          },
        },
      }),
      argumentos: (caminho) => ["--additional-mcp-config", `@${caminho}`],
    },
    ehFaltaDeLogin: (mensagem, codigo) =>
      codigo === CODIGO_DE_AUTENTICACAO_ACP && /authentication required|not (?:logged|signed)|log ?in/i.test(mensagem),
  };
}
