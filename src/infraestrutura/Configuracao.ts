import path from "node:path";

export interface Configuracao {
  porta: number;
  pastaRaizDosProjetos: string;
  caminhoDoClaudeCode: string;
  pastaDeDados: string;
}

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
  };
}
