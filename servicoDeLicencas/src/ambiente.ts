/** Bindings, secrets e variaveis do Worker. */
export interface Ambiente {
  BANCO: D1Database;
  // secrets
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  CHAVE_PRIVADA_DA_LICENCA: string;
  RESEND_API_KEY?: string;
  // variaveis
  EMAIL_REMETENTE: string;
  URL_DA_LANDING: string;
  URL_DE_DOWNLOAD: string;
  URL_DO_PORTAL_DO_CLIENTE: string;
  PRECO_MENSAL_ID: string;
  PRECO_ANUAL_ID: string;
  MAXIMO_DE_MAQUINAS?: string;
}