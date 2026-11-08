import { PreferenciasGlobais } from "./PreferenciasGlobais";

/**
 * Onde ficam as Preferências globais. `atuais` lê da memória (é consultado a
 * cada pedido e a cada listagem); `salvar` grava e passa a valer na hora.
 */
export interface RepositorioDePreferencias {
  atuais(): PreferenciasGlobais;
  salvar(preferencias: PreferenciasGlobais): Promise<void>;
}
