"use strict";

// Configuração local do app desktop, gravada em <userData>/config.json:
//   { pastaRaizDosProjetos, caminhoDoClaudeCode, historicoImportadoDe, porta }
//
// O processo principal repassa estes valores ao servidor (PASTA_RAIZ_PROJETOS,
// CLAUDE_CODE_BIN e PORTA). As funções recebem o `fs`, o ambiente e o teste de
// existência por parâmetro, para serem testadas sem tocar no disco real.

const fs = require("node:fs");
const path = require("node:path");

const NOME_DO_ARQUIVO = "config.json";

function caminhoDaConfiguracao(pastaDoUsuario) {
  return path.join(pastaDoUsuario, NOME_DO_ARQUIVO);
}

function textoOuVazio(valor) {
  return typeof valor === "string" ? valor : "";
}

function portaValida(valor) {
  return Number.isInteger(valor) && valor > 0 && valor <= 65_535;
}

// Garante o formato esperado, mesmo com um arquivo editado à mão.
function normalizar(dados) {
  const origem = dados && typeof dados === "object" ? dados : {};
  return {
    pastaRaizDosProjetos: textoOuVazio(origem.pastaRaizDosProjetos).trim(),
    caminhoDoClaudeCode: textoOuVazio(origem.caminhoDoClaudeCode).trim(),
    historicoImportadoDe:
      typeof origem.historicoImportadoDe === "string" && origem.historicoImportadoDe !== ""
        ? origem.historicoImportadoDe
        : null,
    porta: portaValida(origem.porta) ? origem.porta : null,
  };
}

// Devolve a configuração ou null quando ainda não existe (primeira abertura).
// Um arquivo ilegível gera um erro com o caminho, para o main decidir o que
// fazer (hoje: reabre a tela de primeira abertura).
function lerConfiguracaoLocal(pastaDoUsuario, sistemaDeArquivos = fs) {
  const arquivo = caminhoDaConfiguracao(pastaDoUsuario);
  let conteudo;
  try {
    conteudo = sistemaDeArquivos.readFileSync(arquivo, "utf8");
  } catch (erro) {
    if (erro && erro.code === "ENOENT") return null;
    throw new Error(`Não foi possível ler a configuração em "${arquivo}": ${erro.message || erro}`);
  }
  try {
    return normalizar(JSON.parse(conteudo));
  } catch (erro) {
    throw new Error(`A configuração em "${arquivo}" está corrompida: ${erro.message || erro}`);
  }
}

// Gravação atômica: escreve num arquivo temporário e renomeia por cima, para
// uma queda no meio não deixar um config.json pela metade.
function gravarConfiguracaoLocal(pastaDoUsuario, dados, sistemaDeArquivos = fs) {
  const arquivo = caminhoDaConfiguracao(pastaDoUsuario);
  const temporario = `${arquivo}.${process.pid}.tmp`;
  const normalizada = normalizar(dados);
  try {
    sistemaDeArquivos.mkdirSync(pastaDoUsuario, { recursive: true });
    sistemaDeArquivos.writeFileSync(temporario, JSON.stringify(normalizada, null, 2), "utf8");
    sistemaDeArquivos.renameSync(temporario, arquivo);
  } catch (erro) {
    try {
      sistemaDeArquivos.rmSync(temporario, { force: true });
    } catch {
      /* nada a limpar */
    }
    throw new Error(`Não foi possível gravar a configuração em "${arquivo}": ${erro.message || erro}`);
  }
  return normalizada;
}

function pastaDoUsuarioDoSistema(ambiente) {
  return ambiente.USERPROFILE || ambiente.HOME || null;
}

// Onde o Claude Code costuma estar no Windows, em ordem de preferência.
// O `claude.cmd` do npm não serve: o servidor inicia o processo sem shell.
function candidatosDoClaudeCode(ambiente) {
  const candidatos = [];
  if (ambiente.CLAUDE_CODE_BIN) candidatos.push(ambiente.CLAUDE_CODE_BIN);
  if (ambiente.APPDATA) {
    candidatos.push(
      path.join(ambiente.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    );
  }
  const pastaPessoal = pastaDoUsuarioDoSistema(ambiente);
  if (pastaPessoal) candidatos.push(path.join(pastaPessoal, ".local", "bin", "claude.exe"));
  if (ambiente.LOCALAPPDATA) {
    candidatos.push(path.join(ambiente.LOCALAPPDATA, "Programs", "claude", "claude.exe"));
  }
  return candidatos;
}

// Devolve o primeiro caminho que existe, ou null.
function detectarClaudeCode(ambiente, existe) {
  for (const candidato of candidatosDoClaudeCode(ambiente)) {
    if (existe(candidato)) return candidato;
  }
  return null;
}

// %USERPROFILE%\projetos quando existe; senão, a própria pasta do usuário.
function sugerirPastaDosProjetos(ambiente, existe) {
  const pastaPessoal = pastaDoUsuarioDoSistema(ambiente);
  if (!pastaPessoal) return null;
  const projetos = path.join(pastaPessoal, "projetos");
  return existe(projetos) ? projetos : pastaPessoal;
}

// Lista de mensagens de erro (vazia quando está tudo certo).
function validarConfiguracao(dados, { ehPasta, ehArquivo }) {
  const erros = [];
  const { pastaRaizDosProjetos, caminhoDoClaudeCode } = normalizar(dados);
  if (!pastaRaizDosProjetos) {
    erros.push("Informe a pasta raiz dos projetos.");
  } else if (!path.isAbsolute(pastaRaizDosProjetos) || !ehPasta(pastaRaizDosProjetos)) {
    erros.push(`A pasta dos projetos não existe: ${pastaRaizDosProjetos}`);
  }
  if (!caminhoDoClaudeCode) {
    erros.push("Informe onde está o Claude Code (claude.exe).");
  } else if (!path.isAbsolute(caminhoDoClaudeCode) || !ehArquivo(caminhoDoClaudeCode)) {
    erros.push(`O Claude Code não foi encontrado em: ${caminhoDoClaudeCode}`);
  }
  return erros;
}

// Porta do servidor, fixa por instalação: a tela guarda layout e zoom no
// localStorage, que é separado por origem (inclui a porta) — uma porta nova a
// cada abertura perderia tudo. Ordem:
//   1. PORTA no ambiente (validada), sem gravar;
//   2. a porta do config.json, se estiver livre;
//   3. uma porta livre sorteada ("nova" sem porta gravada; "trocada" quando a
//      gravada estava ocupada) — o main grava essa no config.json.
// `estaLivre(porta)` e `sortearPortaLivre()` são injetados (testes sem rede).
async function escolherPortaDaInstalacao({ portaDoAmbiente, portaGravada, estaLivre, sortearPortaLivre }) {
  if (portaDoAmbiente !== undefined && portaDoAmbiente !== null && portaDoAmbiente !== "") {
    const porta = Number(portaDoAmbiente);
    if (!portaValida(porta)) {
      throw new Error(`PORTA inválida no ambiente: "${portaDoAmbiente}".`);
    }
    return { porta, origem: "ambiente" };
  }
  if (portaValida(portaGravada)) {
    if (await estaLivre(portaGravada)) return { porta: portaGravada, origem: "gravada" };
    return { porta: await sortearPortaLivre(), origem: "trocada", anterior: portaGravada };
  }
  return { porta: await sortearPortaLivre(), origem: "nova" };
}

// Na primeira abertura com a pasta de dados nova, traz da pasta antiga o
// config.json e a pasta dados/ (orquestradores, conversas, notas). Só copia:
// a pasta antiga nunca é apagada nem alterada, e nada além desses dois itens
// (caches do Chromium, logs, localStorage) vem junto. O config.json é copiado
// por último: se a cópia falhar no meio, a próxima abertura tenta de novo, e
// o que já foi copiado de dados/ é mantido (não sobrescreve).
// Devolve null quando não há o que copiar, ou o resumo da cópia.
function copiarDaPastaAntiga({ pastaNova, pastaAntiga, sistemaDeArquivos = fs }) {
  if (path.resolve(pastaNova).toLowerCase() === path.resolve(pastaAntiga).toLowerCase()) return null;
  if (sistemaDeArquivos.existsSync(caminhoDaConfiguracao(pastaNova))) return null;
  const configuracaoAntiga = caminhoDaConfiguracao(pastaAntiga);
  if (!sistemaDeArquivos.existsSync(configuracaoAntiga)) return null;

  sistemaDeArquivos.mkdirSync(pastaNova, { recursive: true });
  const dadosAntigos = path.join(pastaAntiga, "dados");
  const copiouDados = sistemaDeArquivos.existsSync(dadosAntigos);
  if (copiouDados) {
    sistemaDeArquivos.cpSync(dadosAntigos, path.join(pastaNova, "dados"), {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }
  sistemaDeArquivos.copyFileSync(configuracaoAntiga, caminhoDaConfiguracao(pastaNova));
  return { de: pastaAntiga, para: pastaNova, copiouDados };
}

module.exports = {
  caminhoDaConfiguracao,
  copiarDaPastaAntiga,
  escolherPortaDaInstalacao,
  portaValida,
  lerConfiguracaoLocal,
  gravarConfiguracaoLocal,
  detectarClaudeCode,
  sugerirPastaDosProjetos,
  validarConfiguracao,
};
