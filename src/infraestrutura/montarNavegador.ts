import { ServicoDoNavegador } from "../navegador/ServicoDoNavegador";
import {
  NOME_DO_GRUPO_DO_NAVEGADOR,
  criarGrupoDeFerramentasDoNavegador,
} from "./mcp/FerramentasDoNavegador";
import { ServidorMcpDoApp } from "./mcp/ServidorMcpDoApp";
import {
  ControleDoNavegadorPeloElectron,
  PortaParaOProcessoPai,
} from "./navegador/ControleDoNavegadorPeloElectron";

export interface MontagemDoNavegador {
  /** Servidor MCP do aplicativo: `registrarTurno`, `registrarGrupoDeFerramentas`. O grupo `navegador` já vem registrado. */
  servidorMcp: ServidorMcpDoApp;
  /** Começa a escutar o MCP em 127.0.0.1 (porta livre). */
  iniciar(): Promise<void>;
  /** Cancela os comandos em andamento, revoga os tokens e para o servidor MCP. */
  encerrar(): Promise<void>;
}

export interface OpcoesDaMontagemDoNavegador {
  /** `process.parentPort` do utilityProcess; nula fora do aplicativo (aí o navegador responde que só existe no desktop). */
  portaDoProcessoPai: PortaParaOProcessoPai | null;
  versao?: string;
}

/**
 * Composição do contexto do navegador do agente: controle pelo Electron,
 * serviço, servidor MCP e o grupo de ferramentas `navegador_*`.
 *
 * O motor liga o navegador num turno com
 * `servidorMcp.registrarTurno({ orquestradorId, ferramentas: { navegador: true } })`.
 */
export function montarNavegador(opcoes: OpcoesDaMontagemDoNavegador): MontagemDoNavegador {
  const controle = new ControleDoNavegadorPeloElectron({ porta: opcoes.portaDoProcessoPai });
  const servico = new ServicoDoNavegador(controle);
  const servidorMcp = new ServidorMcpDoApp(opcoes.versao === undefined ? {} : { versao: opcoes.versao });
  servidorMcp.registrarGrupoDeFerramentas(NOME_DO_GRUPO_DO_NAVEGADOR, criarGrupoDeFerramentasDoNavegador(servico));

  return {
    servidorMcp,
    iniciar: () => servidorMcp.iniciar(),
    encerrar: async () => {
      controle.encerrar();
      await servidorMcp.encerrar();
    },
  };
}
