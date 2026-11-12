"use strict";

// Configuração do app desktop (Electron) e da ativação por licença.
//
// ──────────────────────────────────────────────────────────────────────────
// MODELO ATUAL — checkout via Stripe + backend próprio de licenças
// ──────────────────────────────────────────────────────────────────────────
// A venda (landing + checkout Stripe) e o backend de licenciamento (emissão,
// ativação, validação e desativação de license keys) vivem num projeto
// SEPARADO deste repositório. O Stripe não tem conceito nativo de "license
// key com ativações" como o Lemon Squeezy tinha, então esse outro projeto
// expõe os próprios endpoints HTTP (contrato documentado em
// `electron/licenca.js`) e este app só precisa saber onde eles estão.
//
// Aqui configuramos apenas a `baseUrl` desse backend. Os endpoints de
// ativar/validar/desativar são montados a partir dela.
//
// TODO: preencher `baseUrl` com a URL real quando o outro projeto (landing +
// backend de licenças) for publicado. Até lá, o valor abaixo é só um
// placeholder de desenvolvimento local.
const baseUrl = process.env.ORQUESTRADOR_LICENCA_API_URL || "http://localhost:0000"; // placeholder — TODO preencher com a URL publicada

module.exports = {
  // Endpoints do backend próprio de licenças, montados a partir da baseUrl.
  endpoints: {
    activate: `${baseUrl}/ativar`,
    validate: `${baseUrl}/validar`,
    deactivate: `${baseUrl}/desativar`,
  },

  // Dias que o app continua abrindo OFFLINE após a última validação bem
  // sucedida. Passado esse prazo sem conseguir validar online, bloqueia.
  gracePeriodDays: 14,

  // Tempo máximo (ms) de espera nas chamadas HTTP ao backend de licenças.
  requestTimeoutMs: 15000,

  // Identidade do app desktop (também usada pelo electron-builder).
  appId: "com.orquestradoragentes.app",
  productName: "Orquestrador de Agentes",

  // A porta do servidor local não é mais fixa: o main.js escolhe uma porta
  // livre em 127.0.0.1 a cada abertura (ou usa a env PORTA, se existir).

  // Página de download do app, repassada ao servidor como
  // ORQUESTRADOR_URL_DE_DOWNLOAD. null = não repassa.
  urlDeDownload: null,
};
