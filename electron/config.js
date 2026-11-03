"use strict";

// Configuração do app desktop (Electron) e da ativação por licença.
//
// ──────────────────────────────────────────────────────────────────────────
// LEMON SQUEEZY — onde o DONO do produto preenche os valores
// ──────────────────────────────────────────────────────────────────────────
// A ativação usa a API PÚBLICA de licenças do Lemon Squeezy. Ela NÃO exige um
// backend próprio nem uma API key secreta: os três endpoints de licença
// (activate/validate/deactivate) se autenticam apenas com a própria
// `license_key` que o cliente digita. Portanto NADA secreto fica neste arquivo.
//
// Passos no painel do Lemon Squeezy (https://app.lemonsqueezy.com):
//   1. Crie uma Store e um Product (ex.: "Orquestrador de Agentes").
//   2. No Product, habilite "License keys" (licenciamento).
//   3. Em "License key options", defina o nº máximo de ativações por chave.
//      Para 1 máquina por licença: maxActivations = 1. (Isso é configurado LÁ,
//      no painel — não aqui. O endpoint de activate retorna erro quando o
//      limite é atingido; o app apenas mostra a mensagem.)
//   4. (Opcional) Anote o Store ID e o Product/Variant ID só para conferência;
//      eles NÃO são necessários para os endpoints de licença, mas deixamos
//      campos abaixo caso você queira validar/filtrar no futuro.
//
// Os endpoints abaixo são fixos da Lemon Squeezy e normalmente não mudam.

module.exports = {
  // Endpoints públicos da API de licenças do Lemon Squeezy.
  endpoints: {
    activate: "https://api.lemonsqueezy.com/v1/licenses/activate",
    validate: "https://api.lemonsqueezy.com/v1/licenses/validate",
    deactivate: "https://api.lemonsqueezy.com/v1/licenses/deactivate",
  },

  // ⇩ PREENCHA (opcional) — apenas conferência. Deixe null se não for usar.
  // Se você preencher expectedStoreId / expectedProductId, a ativação passa a
  // EXIGIR que a licença pertença a essa loja/produto (defesa extra contra uso
  // de chaves de outro produto). Com null, qualquer chave válida é aceita.
  expectedStoreId: null, // ex.: 123456
  expectedProductId: null, // ex.: 654321

  // Dias que o app continua abrindo OFFLINE após a última validação bem
  // sucedida. Passado esse prazo sem conseguir validar online, bloqueia.
  gracePeriodDays: 14,

  // Tempo máximo (ms) de espera nas chamadas HTTP à Lemon Squeezy.
  requestTimeoutMs: 15000,

  // Identidade do app desktop (também usada pelo electron-builder).
  appId: "com.orquestradoragentes.app",
  productName: "Orquestrador de Agentes",

  // Porta do servidor Express local (deve bater com a do servidor; o main.js
  // ainda respeita a env PORTA se ela existir).
  porta: 3200,
};
