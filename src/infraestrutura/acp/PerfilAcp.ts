import { Motor } from "../../orquestracao/Motor";
import { ContextoDePermissao } from "../motores/PoliticaDePermissao";
import { ChamadaDeFerramentaAcp } from "./AdaptadorDeEventosAcp";

/** O que muda de um CLI que fala ACP para outro: como iniciar, que argumentos de política e como reconhecer o que é do app. */
export interface PerfilAcp {
  motor: Motor;
  /** O nome do CLI nas mensagens para o usuário. */
  nomeDoCli: string;
  /** O comando que inicia o servidor ACP e os argumentos fixos dele (`copilot` + `--acp --stdio`). */
  comando(): { executavel: string; argumentosIniciais: readonly string[] };
  /**
   * Argumentos que dependem do turno: pastas liberadas, modelo e as negações
   * que o CLI aplica por conta própria (a segunda barreira, depois da política do app).
   */
  argumentosDoTurno(turno: {
    contexto: ContextoDePermissao;
    /** O modelo do papel: `padrao` ou o id de um modelo. */
    modelo: string;
  }): string[];
  /** O ambiente do processo: sem o que liberaria tudo por fora do app. */
  ambiente(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  /** Se a chamada de ferramenta é de uma ferramenta do servidor MCP do app. */
  ehFerramentaDoApp(chamada: ChamadaDeFerramentaAcp): boolean;
  /**
   * Opcional: passar o servidor MCP do app por arquivo de configuração do CLI, em
   * vez de pelo `session/new`. O ACP não tem como dar ao servidor MCP um tempo
   * máximo por chamada, e a delegação espera subagentes por minutos; o arquivo
   * do CLI tem. `conteudo` é o JSON do arquivo e `argumentos`, o que o CLI recebe
   * para lê-lo. O arquivo leva o token do turno: é criado só para o dono e apagado no fim.
   */
  mcpPorArquivo?: {
    conteudo(servidor: { nome: string; url: string; token: string }): unknown;
    argumentos(caminhoDoArquivo: string): string[];
  };
  /** Se a falha do JSON-RPC é "não logado" (o CLI recusa abrir a sessão por falta de login). */
  ehFaltaDeLogin(mensagem: string, codigo: number): boolean;
  /** O que o usuário faz para entrar no CLI. */
  comoEntrar: string;
  /** O comando que instala o CLI, para a mensagem de "não encontrado". */
  comoInstalar: string;
}
