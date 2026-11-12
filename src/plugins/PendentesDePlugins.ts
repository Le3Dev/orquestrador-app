import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Plugins que o app instalou e que aguardam a confirmação da pessoa antes de
 * ligar (hooks, `bin/` ou inventário não provado). Persistido para que, se o
 * app fechar entre a instalação e o desligamento, o início seguinte desligue o
 * que ficou ligado.
 */
export interface PendentesDePlugins {
  ler(): string[];
  adicionar(id: string): void;
  remover(id: string): void;
}

const LIMITE_DE_IDS = 500;

export class PendentesEmMemoria implements PendentesDePlugins {
  private readonly ids = new Set<string>();

  ler(): string[] {
    return [...this.ids];
  }

  adicionar(id: string): void {
    this.ids.add(id);
  }

  remover(id: string): void {
    this.ids.delete(id);
  }
}

/** Um arquivo JSON pequeno na pasta de dados do app (nunca em `~/.claude`). */
export class PendentesEmArquivo implements PendentesDePlugins {
  constructor(private readonly arquivo: string) {}

  ler(): string[] {
    try {
      const lido: unknown = JSON.parse(readFileSync(this.arquivo, "utf8"));
      const ids = typeof lido === "object" && lido !== null ? (lido as { ids?: unknown }).ids : undefined;
      return Array.isArray(ids)
        ? (ids as unknown[]).filter((id): id is string => typeof id === "string").slice(0, LIMITE_DE_IDS)
        : [];
    } catch {
      return [];
    }
  }

  adicionar(id: string): void {
    const atuais = this.ler();
    if (!atuais.includes(id)) {
      this.gravar([...atuais, id]);
    }
  }

  remover(id: string): void {
    const atuais = this.ler();
    if (atuais.includes(id)) {
      this.gravar(atuais.filter((outro) => outro !== id));
    }
  }

  private gravar(ids: string[]): void {
    mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const temporario = `${this.arquivo}.tmp`;
    writeFileSync(temporario, JSON.stringify({ ids: ids.slice(-LIMITE_DE_IDS) }, null, 2), "utf8");
    renameSync(temporario, this.arquivo);
  }
}
