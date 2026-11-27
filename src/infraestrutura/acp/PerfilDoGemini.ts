import { FERRAMENTA_DE_DELEGACAO } from "../../orquestracao/InstrucoesDoOrquestrador";
import { ContextoDePermissao, permiteComandos } from "../motores/PoliticaDePermissao";
import { ehFerramentaComONome } from "./AdaptadorDeEventosAcp";
import { CODIGO_DE_AUTENTICACAO_ACP } from "./FachadaAcp";
import { PerfilAcp } from "./PerfilAcp";

/**
 * Variáveis que liberariam tudo por fora do app (aprovação automática): nunca
 * herdadas. O Gemini documenta o YOLO só por `--yolo`/`--approval-mode=yolo`;
 * os nomes abaixo são cautela (a doc não os lista).
 */
const VARIAVEIS_QUE_LIBERAM_TUDO = ["GEMINI_YOLO", "GEMINI_CLI_YOLO", "GEMINI_APPROVAL_MODE"];

/** A variável que aponta o arquivo de configurações do sistema (a de maior precedência do Gemini CLI). */
export const VARIAVEL_DAS_CONFIGURACOES_DO_GEMINI = "GEMINI_CLI_SYSTEM_SETTINGS_PATH";

/**
 * Quanto uma chamada de ferramenta do app pode levar (ms): `delegar_subtarefas`
 * espera subagentes por minutos e o padrão do Gemini CLI para o MCP é de 10 minutos.
 */
export const TEMPO_MAXIMO_DA_FERRAMENTA_DO_APP_NO_GEMINI_MS = 3_600_000;

/** Padrões de `tools.exclude` do Gemini para o que a política recusa: a segunda barreira, na entrada do CLI. */
export function ferramentasExcluidasDoGemini(contexto: Pick<ContextoDePermissao, "nivel" | "modo" | "permiteCommitEPush">): string[] {
  if (!permiteComandos(contexto)) {
    return ["run_shell_command"];
  }
  return contexto.permiteCommitEPush ? [] : ["run_shell_command(git commit)", "run_shell_command(git push)"];
}

/** O título do pedido de permissão da ferramenta do app: o nome dela, com ou sem o prefixo/sufixo do servidor MCP. */
function tituloTrazAFerramenta(titulo: string, nomes: readonly string[]): boolean {
  return nomes.some((nome) => new RegExp(`(?:^|[\\s./:_-])${nome}(?:$|[\\s(])`).test(titulo));
}

export interface OpcoesDoPerfilDoGemini {
  /** Os nomes das ferramentas do servidor MCP do app, para reconhecer as chamadas dele. Padrão: a delegação. */
  ferramentasDoApp?: readonly string[];
}

/**
 * O Gemini CLI (Google) como agente ACP: `gemini --acp`
 * (https://geminicli.com/docs/cli/acp-mode/).
 *
 * - `--approval-mode default`: o CLI pergunta ao app (`session/request_permission`)
 *   e a política do app decide; o modo automático (YOLO) nunca é ligado.
 * - A pasta de artefatos e a dos anexos entram em `--include-directories`.
 * - `--model` só quando o modelo não é `padrao`.
 * - O servidor MCP do app e a segunda barreira vão num arquivo de configurações
 *   do sistema (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`): `mcpServers` com `httpUrl`,
 *   `headers` e `timeout` longo; `tools.exclude` com o shell (sem comandos no
 *   nível) e `git commit`/`git push` (sem commit liberado); `security.disableYoloMode`
 *   e o modo de aprovação padrão, para uma configuração do usuário não liberar tudo.
 *   O `session/new` não leva o servidor MCP: ele sobrescreveria o do arquivo, sem o tempo limite.
 *
 * O Gemini CLI não acrescenta `Co-authored-by` aos commits por conta própria (não há
 * configuração para isso na doc); a política do app ainda recusa um commit que o leve.
 */
export function criarPerfilDoGemini(executavel: string | (() => string), opcoes: OpcoesDoPerfilDoGemini = {}): PerfilAcp {
  const ferramentasDoApp = opcoes.ferramentasDoApp ?? [FERRAMENTA_DE_DELEGACAO];
  return {
    motor: "gemini",
    nomeDoCli: "Gemini CLI",
    comoEntrar: "gemini (escolha o login com o Google) ou defina GEMINI_API_KEY",
    comoInstalar: "npm install -g @google/gemini-cli",
    comando: () => ({
      // Resolvido a cada turno: quem instala o CLI com o app aberto não precisa reiniciá-lo.
      executavel: typeof executavel === "function" ? executavel() : executavel,
      argumentosIniciais: ["--acp", "--approval-mode", "default"],
    }),
    argumentosDoTurno: ({ contexto, modelo }) => [
      "--include-directories",
      contexto.pastaDeArtefatos,
      ...(contexto.pastaDosAnexos === null ? [] : ["--include-directories", contexto.pastaDosAnexos]),
      ...(modelo === "padrao" ? [] : ["--model", modelo]),
    ],
    ambiente: (base) => {
      const ambiente: NodeJS.ProcessEnv = { ...base, NO_COLOR: "1" };
      for (const variavel of VARIAVEIS_QUE_LIBERAM_TUDO) {
        delete ambiente[variavel];
      }
      return ambiente;
    },
    ehFerramentaDoApp: (chamada) =>
      chamada.tipo === "other" && (ehFerramentaComONome(chamada, ferramentasDoApp) || tituloTrazAFerramenta(chamada.titulo, ferramentasDoApp)),
    configuracaoPorArquivo: {
      conteudo: ({ contexto, servidor }) => ({
        general: { enableAutoUpdate: false, enableAutoUpdateNotification: false, defaultApprovalMode: "default" },
        security: { disableYoloMode: true },
        tools: { exclude: ferramentasExcluidasDoGemini(contexto) },
        ...(servidor === null
          ? {}
          : {
              mcpServers: {
                [servidor.nome]: {
                  httpUrl: servidor.url,
                  headers: { Authorization: `Bearer ${servidor.token}` },
                  timeout: TEMPO_MAXIMO_DA_FERRAMENTA_DO_APP_NO_GEMINI_MS,
                },
              },
            }),
      }),
      ambiente: (caminho) => ({ [VARIAVEL_DAS_CONFIGURACOES_DO_GEMINI]: caminho }),
    },
    ehFaltaDeLogin: (mensagem, codigo) =>
      codigo === CODIGO_DE_AUTENTICACAO_ACP &&
      /authentication required|api key is missing|not (?:logged|signed)|log ?in|sign ?in/i.test(mensagem),
  };
}
