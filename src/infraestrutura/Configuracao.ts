import path from "node:path";

export interface Configuracao {
  porta: number;
  pastaRaizDosProjetos: string;
  caminhoDoClaudeCode: string;
  pastaDeDados: string;
  /** Pasta com o build da tela (index.html e assets). */
  pastaDaTela: string;
  /** Chave que o aplicativo gera a cada abertura; null quando não veio. */
  chaveDeAcesso: string | null;
  /** Só em desenvolvimento: libera o acesso pelo navegador, sem a trava. */
  permitirNavegador: boolean;
  /** Para onde a página de recusa manda baixar o aplicativo. */
  urlDeDownload: string | null;
}

/**
 * Como o servidor atende:
 * - "aplicativo": com a trava, só quem traz a chave do aplicativo entra;
 * - "navegador": sem trava (desenvolvimento);
 * - "recusado": nem chave nem liberação — o servidor não deve subir.
 */
export type ModoDeAcesso = "aplicativo" | "navegador" | "recusado";

export const MENSAGEM_SO_NO_APLICATIVO =
  "O Orquestrador roda só dentro do aplicativo. Abra pelo aplicativo (npm run desktop) ou, para desenvolver no navegador, defina ORQUESTRADOR_PERMITIR_NAVEGADOR=1 no .env.";

const FORMATO_DA_CHAVE = /^[0-9a-fA-F]{32,}$/;

/**
 * Onde o instalador do npm coloca o executável nativo do Claude Code no
 * Windows. O `claude.cmd` da pasta do npm não serve: um `.cmd` só roda via
 * shell, e o motor inicia o processo sem shell.
 */
function caminhoPadraoDoClaudeCode(ambiente: NodeJS.ProcessEnv): string {
  if (process.platform === "win32" && ambiente.APPDATA !== undefined) {
    return path.join(
      ambiente.APPDATA,
      "npm",
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
  }
  return "claude";
}

function lerChaveDeAcesso(valor: string | undefined): string | null {
  if (valor === undefined || valor === "") {
    return null;
  }
  if (!FORMATO_DA_CHAVE.test(valor)) {
    // Sem mostrar o valor: é um segredo.
    throw new Error(
      "ORQUESTRADOR_CHAVE_DE_ACESSO inválida: deve ter pelo menos 32 caracteres hexadecimais (o aplicativo gera 64).",
    );
  }
  return valor;
}

function lerUrlDeDownload(valor: string | undefined): string | null {
  if (valor === undefined || valor === "") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`ORQUESTRADOR_URL_DE_DOWNLOAD inválida: "${valor}" não é um endereço.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`ORQUESTRADOR_URL_DE_DOWNLOAD inválida: "${valor}" deve começar com http:// ou https://.`);
  }
  return url.toString();
}

export function lerConfiguracao(ambiente: NodeJS.ProcessEnv = process.env): Configuracao {
  const porta = Number(ambiente.PORTA ?? 3200);
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65_535) {
    throw new Error(`PORTA inválida: "${ambiente.PORTA}".`);
  }

  // Pasta do app, a partir deste arquivo (src/ ou dist/infraestrutura), e não
  // da pasta de onde o comando foi rodado: subindo de outro lugar, o servidor
  // não acharia o histórico e o canvas perderia os terminais.
  const pastaDoApp = path.resolve(__dirname, "..", "..");

  return {
    porta,
    // O app mora ao lado dos outros projetos; a pasta acima dele é a raiz.
    pastaRaizDosProjetos: path.resolve(pastaDoApp, ambiente.PASTA_RAIZ_PROJETOS || ".."),
    caminhoDoClaudeCode: ambiente.CLAUDE_CODE_BIN || caminhoPadraoDoClaudeCode(ambiente),
    pastaDeDados: path.resolve(pastaDoApp, ambiente.PASTA_DADOS || "dados"),
    pastaDaTela: path.resolve(pastaDoApp, ambiente.PASTA_DA_TELA || path.join("web", "dist")),
    chaveDeAcesso: lerChaveDeAcesso(ambiente.ORQUESTRADOR_CHAVE_DE_ACESSO),
    permitirNavegador: ambiente.ORQUESTRADOR_PERMITIR_NAVEGADOR === "1",
    urlDeDownload: lerUrlDeDownload(ambiente.ORQUESTRADOR_URL_DE_DOWNLOAD),
  };
}

/** A liberação do navegador vence a chave: em desenvolvimento, sem trava. */
export function modoDeAcesso(configuracao: Pick<Configuracao, "chaveDeAcesso" | "permitirNavegador">): ModoDeAcesso {
  if (configuracao.permitirNavegador) {
    return "navegador";
  }
  return configuracao.chaveDeAcesso === null ? "recusado" : "aplicativo";
}
