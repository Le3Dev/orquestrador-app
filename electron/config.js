"use strict";

// Configuração do app desktop (Electron) e da licença por assinatura.
//
// A licença é emitida por um SERVIÇO DE LICENÇAS próprio (repositório privado
// `Le3Dev/orquestrador-licencas`), que assina um token com Ed25519. O acesso é
// por e-mail + código de 6 dígitos (teste grátis de 7 dias no primeiro login).
// O app só guarda a chave PÚBLICA: nada secreto fica neste arquivo (o
// repositório é público); a privada fica só no serviço.

module.exports = {
  // Exigir licença no app instalado. false durante a fase de testes com os
  // devs: o app instalado abre sem pedir login (a tela de entrada e o módulo
  // de licença continuam no app, só não são usados). Para religar: mudar para
  // true e publicar uma versão nova — a atualização automática a leva a todos
  // os apps instalados, que passam a pedir o e-mail na abertura seguinte.
  exigirLicenca: false,

  // ⇩ PREENCHA antes de ligar `exigirLicenca`. Com qualquer um destes dois
  // vazio (null) e a licença exigida, o app BLOQUEIA ("app sem configuração
  // de licença").

  // Endereço do serviço de licenças, sem barra no final. É a URL que o deploy
  // do serviço devolve (ex.: https://licencas.SEU-DOMINIO.workers.dev).
  urlDoServicoDeLicencas: null,

  // Chave PÚBLICA Ed25519 (formato SPKI PEM, "-----BEGIN PUBLIC KEY-----...").
  // Gerada junto com a privada pelo script de chaves do repositório privado
  // `Le3Dev/orquestrador-licencas`; cole aqui só a pública. A privada vai
  // apenas como segredo do serviço.
  chavePublicaDaLicenca: null,

  // Página de planos da landing, aberta pelo link "Assinar" da tela de entrada.
  urlParaAssinar: null,

  // Portal do cliente do Stripe (trocar cartão, cancelar, ver faturas), aberto
  // por "Gerenciar assinatura". Link do portal em Stripe > Configurações >
  // Billing > Portal do cliente.
  urlDoPortalDoCliente: null,

  // Tempo máximo (ms) de espera nas chamadas ao serviço de licenças.
  tempoLimiteDaChamadaMs: 15000,

  // De quanto em quanto tempo (ms) a licença é revalidada com o app aberto.
  intervaloDeRevalidacaoMs: 24 * 60 * 60 * 1000,

  // Identidade do app desktop (também usada pelo electron-builder).
  appId: "com.orquestradoragentes.app",
  productName: "Orquestrador de Agentes",

  // A porta do servidor local não é mais fixa: o main.js escolhe uma porta
  // livre em 127.0.0.1 a cada abertura (ou usa a env PORTA, se existir).

  // Página de download do app (a última Release pública no GitHub), repassada
  // ao servidor como ORQUESTRADOR_URL_DE_DOWNLOAD. null = não repassa.
  urlDeDownload: "https://github.com/Le3Dev/orquestrador-app/releases/latest",
};
