import type { ChaveDeLicenca } from './ChaveDeLicenca';
import type { Licenca } from './Licenca';

/** Porta de persistencia do agregado Licenca. */
export interface RepositorioDeLicencas {
  buscarPorChave(chave: ChaveDeLicenca): Promise<Licenca | null>;
  buscarPorIdDaAssinatura(idDaAssinatura: string): Promise<Licenca | null>;
  /** Insere ou atualiza a licenca e todas as suas maquinas, em conjunto. */
  salvar(licenca: Licenca): Promise<void>;
}

/** Porta da idempotencia dos webhooks. */
export interface RepositorioDeEventosProcessados {
  jaProcessado(idDoEvento: string): Promise<boolean>;
  registrar(idDoEvento: string, quando: number): Promise<void>;
}