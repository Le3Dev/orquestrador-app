"use strict";

// Importação do histórico da versão antiga (servidor rodando pela pasta do app,
// com os dados em <pasta do app>/dados) para a pasta de dados do app desktop
// (<userData>/dados).
//
// Regras:
//   - só COPIA: a origem nunca é apagada nem alterada;
//   - copia orquestradores/, notas/ e anexos/ como estão; nunca worktrees/ nem
//     o registro de processos (processos-em-execucao.json). Os worktrees
//     antigos continuam válidos onde estão: o caminho deles fica absoluto no
//     orquestrador.json;
//   - o chat rápido NÃO vira a conversa atual: o Claude Code guarda a sessão
//     pela pasta de trabalho, que muda de <antigo>/chat/sessao para
//     <userData>/dados/chat/sessao, então ela não poderia ser retomada. O
//     conteúdo antigo de chat/ vai para chat/historico/conversa-importada/ (só
//     consulta, como uma conversa arquivada pelo /clear), sem chat/sessao;
//   - não sobrescreve nada que já exista no destino;
//   - ignora links simbólicos/junções (não segue para fora da origem).

const fs = require("node:fs");
const path = require("node:path");

const PASTAS_IMPORTADAS = ["orquestradores", "notas", "chat", "anexos"];
// Destino do chat antigo, relativo à pasta de dados (só consulta).
const DESTINO_DO_CHAT_IMPORTADO = path.join("chat", "historico", "conversa-importada");
// Pasta de trabalho do Claude Code do chat: não serve fora da pasta original.
const PASTA_DA_SESSAO_DO_CHAT = "sessao";
// Basta uma destas para a pasta contar como histórico de verdade.
const PASTAS_QUE_IDENTIFICAM_HISTORICO = ["orquestradores", "notas"];

function ehPasta(caminho) {
  try {
    return fs.statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

function mesmoCaminho(a, b) {
  const normalizar = (c) => path.resolve(c).replace(/[\\/]+$/, "").toLowerCase();
  return normalizar(a) === normalizar(b);
}

function temHistorico(pasta) {
  return PASTAS_QUE_IDENTIFICAM_HISTORICO.some((nome) => ehPasta(path.join(pasta, nome)));
}

// Candidatos, em ordem:
//   1. <pasta do app>/dados — só fora do app empacotado (no instalado, a pasta
//      do app é a de instalação/asar e não tem histórico);
//   2. %USERPROFILE%\projetos\orquestrador-app\dados — onde o app costumava
//      ficar.
// Devolve o primeiro que tem orquestradores/ ou notas/, ignorando o próprio
// destino. Sem nenhum, devolve null.
function localizarHistoricoAntigo({ empacotado, pastaDoApp, ambiente, destinoDados }) {
  const candidatos = [];
  if (!empacotado && pastaDoApp) candidatos.push(path.join(pastaDoApp, "dados"));
  const pastaPessoal = ambiente && (ambiente.USERPROFILE || ambiente.HOME);
  if (pastaPessoal) candidatos.push(path.join(pastaPessoal, "projetos", "orquestrador-app", "dados"));

  for (const candidato of candidatos) {
    if (destinoDados && mesmoCaminho(candidato, destinoDados)) continue;
    if (temHistorico(candidato)) return candidato;
  }
  return null;
}

// Copia recursivamente sem sobrescrever. Acumula os resultados em `resumo`.
// `pular`: nomes de entradas do primeiro nível que não são copiados.
function copiarSemSobrescrever(origem, destino, resumo, pular = []) {
  fs.mkdirSync(destino, { recursive: true });
  for (const entrada of fs.readdirSync(origem, { withFileTypes: true })) {
    if (pular.includes(entrada.name)) continue;
    const de = path.join(origem, entrada.name);
    const para = path.join(destino, entrada.name);
    if (entrada.isSymbolicLink()) {
      resumo.ignorados.push(de);
      continue;
    }
    if (entrada.isDirectory()) {
      copiarSemSobrescrever(de, para, resumo);
      continue;
    }
    if (!entrada.isFile()) continue;
    if (fs.existsSync(para)) {
      resumo.ignorados.push(de);
      continue;
    }
    // COPYFILE_EXCL: mesmo numa corrida, nunca sobrescreve.
    fs.copyFileSync(de, para, fs.constants.COPYFILE_EXCL);
    resumo.arquivosCopiados += 1;
  }
}

// Devolve { origem, pastas: [nomes copiados], arquivosCopiados, ignorados: [caminhos na origem] }.
function importarHistorico(origem, destinoDados) {
  if (!ehPasta(origem)) {
    throw new Error(`A pasta do histórico antigo não existe: ${origem}`);
  }
  if (mesmoCaminho(origem, destinoDados)) {
    throw new Error("A pasta do histórico antigo é a mesma pasta de dados do app; nada a importar.");
  }
  const resumo = { origem, pastas: [], arquivosCopiados: 0, ignorados: [] };
  for (const nome of PASTAS_IMPORTADAS) {
    const de = path.join(origem, nome);
    if (!ehPasta(de)) continue;
    try {
      if (nome === "chat") {
        copiarSemSobrescrever(de, path.join(destinoDados, DESTINO_DO_CHAT_IMPORTADO), resumo, [
          PASTA_DA_SESSAO_DO_CHAT,
        ]);
      } else {
        copiarSemSobrescrever(de, path.join(destinoDados, nome), resumo);
      }
    } catch (erro) {
      throw new Error(`Falha ao importar "${nome}" de ${origem}: ${erro.message || erro}`);
    }
    resumo.pastas.push(nome);
  }
  return resumo;
}

module.exports = {
  DESTINO_DO_CHAT_IMPORTADO,
  PASTAS_IMPORTADAS,
  localizarHistoricoAntigo,
  importarHistorico,
};
