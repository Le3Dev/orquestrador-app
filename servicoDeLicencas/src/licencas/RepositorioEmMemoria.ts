import type { ChaveDeLicenca } from './ChaveDeLicenca';
import type { Licenca } from './Licenca';
import type { RepositorioDeEventosProcessados, RepositorioDeLicencas } from './RepositorioDeLicencas';

/** Adaptador em memoria (testes e desenvolvimento). */
export class RepositorioDeLicencasEmMemoria implements RepositorioDeLicencas {
  private readonly porId = new Map<string, Licenca>();

  async buscarPorChave(chave: ChaveDeLicenca): Promise<Licenca | null> {
    return [...this.porId.values()].find((l) => l.chave.valor === chave.valor) ?? null;
  }

  async buscarPorIdDaAssinatura(idDaAssinatura: string): Promise<Licenca | null> {
    return [...this.porId.values()].find((l) => l.idDaAssinatura === idDaAssinatura) ?? null;
  }

  async salvar(licenca: Licenca): Promise<void> {
    this.porId.set(licenca.id, licenca);
  }

  todas(): Licenca[] {
    return [...this.porId.values()];
  }
}

export class RepositorioDeEventosEmMemoria implements RepositorioDeEventosProcessados {
  private readonly ids = new Set<string>();

  async jaProcessado(idDoEvento: string): Promise<boolean> {
    return this.ids.has(idDoEvento);
  }

  async registrar(idDoEvento: string): Promise<void> {
    this.ids.add(idDoEvento);
  }
}