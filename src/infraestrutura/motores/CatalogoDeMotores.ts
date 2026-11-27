import { MOTORES, Motor, rotuloDoMotor } from "../../orquestracao/Motor";
import { ExecutorDeComandoCurto, executarComandoCurto } from "./ExecucaoCurtaDeCli";
import { procurarExecutavel } from "./ExecutavelDoCli";

/** O estado de um motor nesta máquina, como a tela o mostra (`GET /motores`). */
export interface SituacaoDoMotor {
  motor: Motor;
  rotulo: string;
  instalado: boolean;
  versao: string | null;
  caminho: string | null;
  /** Nulo quando não deu para saber sem gastar cota (ou o CLI nem está instalado). */
  logado: boolean | null;
  /** O que o usuário precisa fazer ou o que deu errado, em português; nulo quando está tudo certo. */
  mensagem: string | null;
}

/** Se o usuário está logado no Copilot: o CLI não tem comando de status, então o app abre uma sessão ACP sem enviar prompt. */
export type VerificadorDeLogin = (executavel: string) => Promise<boolean | null>;

export interface DependenciasDoCatalogo {
  /** O nome (procurado no `PATH`) ou o caminho de cada CLI. */
  caminhos: Readonly<Record<Motor, string>>;
  ambiente?: NodeJS.ProcessEnv;
  executar?: ExecutorDeComandoCurto;
  procurar?: (nomeOuCaminho: string) => string | null;
  /** Só o do Copilot e o do Gemini: o Claude Code e o Codex têm comando de status. */
  verificarLoginDoCopilot?: VerificadorDeLogin;
  verificarLoginDoGemini?: VerificadorDeLogin;
  /** Por quanto tempo uma consulta vale; as seguintes devolvem a mesma resposta. */
  validadeMs?: number;
  agora?: () => number;
}

const LIMITE_DO_COMANDO_MS = 15_000;
export const VALIDADE_DO_CATALOGO_MS = 60_000;

const COMO_INSTALAR: Readonly<Record<Motor, string>> = {
  "claude-code": "Instale o Claude Code (npm install -g @anthropic-ai/claude-code) e rode `claude` uma vez para entrar.",
  codex: "Instale o Codex (npm install -g @openai/codex) e rode `codex login` para entrar.",
  copilot: "Instale o GitHub Copilot CLI (npm install -g @github/copilot) e rode `copilot login` para entrar.",
  gemini: "Instale o Gemini CLI (npm install -g @google/gemini-cli) e rode `gemini` uma vez para entrar (login com o Google) ou defina GEMINI_API_KEY.",
};

const COMO_ENTRAR: Readonly<Record<Motor, string>> = {
  "claude-code": "Entre no Claude Code: rode `claude` no terminal e use /login.",
  codex: "Entre no Codex: rode `codex login` no terminal.",
  copilot: "Entre no GitHub Copilot CLI: rode `copilot login` no terminal.",
  gemini: "Entre no Gemini CLI: rode `gemini` no terminal e escolha o login com o Google, ou defina GEMINI_API_KEY.",
};

/** O número de versão no que o `--version` escreve ("codex-cli 0.169.0", "GitHub Copilot CLI 1.0.83."). */
export function versaoNaSaida(saida: string): string | null {
  return /\d+\.\d+\.\d+(?:-[\w.]+)?/.exec(saida)?.[0] ?? null;
}

/**
 * Quais CLIs dos motores estão instalados (caminho e versão) e se estão logados.
 *
 * Só consulta, sem gastar cota: `--version` em todos; para o login, `claude auth
 * status`, `codex login status` e, no Copilot (que não tem comando de status),
 * uma sessão ACP aberta e fechada sem prompt. O app nunca lê nem guarda o
 * login: quem o guarda é cada CLI. A resposta vale `validadeMs`; chamadas
 * simultâneas dividem a mesma consulta.
 */
export class CatalogoDeMotores {
  private readonly executar: ExecutorDeComandoCurto;
  private readonly procurar: (nomeOuCaminho: string) => string | null;
  private readonly validadeMs: number;
  private readonly agora: () => number;
  private emCache: { em: number; situacoes: SituacaoDoMotor[] } | null = null;
  private consultando: Promise<SituacaoDoMotor[]> | null = null;

  constructor(private readonly dependencias: DependenciasDoCatalogo) {
    this.executar = dependencias.executar ?? executarComandoCurto;
    this.procurar = dependencias.procurar ?? ((nome) => procurarExecutavel(nome, { ambiente: dependencias.ambiente ?? process.env }));
    this.validadeMs = dependencias.validadeMs ?? VALIDADE_DO_CATALOGO_MS;
    this.agora = dependencias.agora ?? Date.now;
  }

  /** A situação dos motores, na ordem de `MOTORES`. `renovar` ignora a resposta guardada. */
  async listar(renovar = false): Promise<SituacaoDoMotor[]> {
    if (!renovar && this.emCache !== null && this.agora() - this.emCache.em < this.validadeMs) {
      return this.emCache.situacoes;
    }
    this.consultando ??= Promise.all(MOTORES.map((motor) => this.consultar(motor)))
      .then((situacoes) => {
        this.emCache = { em: this.agora(), situacoes };
        return situacoes;
      })
      .finally(() => {
        this.consultando = null;
      });
    return this.consultando;
  }

  async situacaoDe(motor: Motor): Promise<SituacaoDoMotor> {
    const situacoes = await this.listar();
    return situacoes.find((situacao) => situacao.motor === motor) ?? (await this.consultar(motor));
  }

  /** Descarta a resposta guardada (depois de o usuário instalar ou entrar). */
  invalidar(): void {
    this.emCache = null;
  }

  private async consultar(motor: Motor): Promise<SituacaoDoMotor> {
    const rotulo = rotuloDoMotor(motor);
    const caminho = this.procurar(this.dependencias.caminhos[motor]);
    if (caminho === null) {
      return { motor, rotulo, instalado: false, versao: null, caminho: null, logado: null, mensagem: COMO_INSTALAR[motor] };
    }
    const ambiente = this.dependencias.ambiente ?? process.env;
    const opcoes = { ambiente, limiteMs: LIMITE_DO_COMANDO_MS };
    try {
      const versao = await this.executar(caminho, ["--version"], opcoes);
      if (versao.falhaAoIniciar !== null || (versao.codigoDeSaida !== 0 && versao.saida === "")) {
        return {
          motor,
          rotulo,
          instalado: false,
          versao: null,
          caminho,
          logado: null,
          mensagem: `Não foi possível executar o ${rotulo} em "${caminho}"${versao.falhaAoIniciar === null ? "" : ` (${versao.falhaAoIniciar})`}. Reinstale-o ou confira o caminho.`,
        };
      }
      const logado = await this.consultarLogin(motor, caminho, opcoes);
      return {
        motor,
        rotulo,
        instalado: true,
        versao: versaoNaSaida(versao.saida),
        caminho,
        logado,
        mensagem: logado === false ? COMO_ENTRAR[motor] : null,
      };
    } catch (erro) {
      return {
        motor,
        rotulo,
        instalado: true,
        versao: null,
        caminho,
        logado: null,
        mensagem: `Não foi possível consultar o ${rotulo}: ${erro instanceof Error ? erro.message : String(erro)}`,
      };
    }
  }

  /** Verdadeiro/falso quando o CLI diz; nulo quando não dá para saber. */
  private async consultarLogin(
    motor: Motor,
    caminho: string,
    opcoes: { ambiente: NodeJS.ProcessEnv; limiteMs: number },
  ): Promise<boolean | null> {
    switch (motor) {
      case "claude-code": {
        const saida = await this.executar(caminho, ["auth", "status"], opcoes);
        if (saida.falhaAoIniciar !== null || saida.tempoEsgotado) {
          return null;
        }
        try {
          const lido: unknown = JSON.parse(saida.saida);
          if (typeof lido === "object" && lido !== null && typeof (lido as { loggedIn?: unknown }).loggedIn === "boolean") {
            return (lido as { loggedIn: boolean }).loggedIn;
          }
        } catch {
          // Versão sem JSON: vale o código de saída.
        }
        return saida.codigoDeSaida === 0 ? true : null;
      }
      case "codex": {
        const saida = await this.executar(caminho, ["login", "status"], opcoes);
        if (saida.falhaAoIniciar !== null || saida.tempoEsgotado) {
          return null;
        }
        if (saida.codigoDeSaida === 0) {
          return true;
        }
        return /not logged in/i.test(`${saida.saida}\n${saida.erro}`) ? false : null;
      }
      case "copilot":
        return this.dependencias.verificarLoginDoCopilot === undefined ? null : this.dependencias.verificarLoginDoCopilot(caminho);
      case "gemini":
        return this.dependencias.verificarLoginDoGemini === undefined ? null : this.dependencias.verificarLoginDoGemini(caminho);
    }
  }
}
