"use strict";

// Atualização automática do app instalado (Releases públicas do GitHub, via
// electron-updater).
//
// Este módulo NÃO carrega o Electron: o atualizador (o `autoUpdater` do
// electron-updater) chega por injeção, o que deixa o serviço testável com um
// atualizador falso. O main.js cria o serviço e liga os eventos à tela.
//
// Fluxo:
//   1. ~10 s depois que a janela principal aparece, a primeira verificação;
//      depois, a cada 4 h.
//   2. Versão nova encontrada → baixa sozinha em segundo plano ("baixando",
//      com progresso de 0 a 100).
//   3. Baixada → "pronta". A tela pergunta se quer reiniciar agora
//      (instalarAgora); se não, ela é instalada quando o app for fechado.
//   4. Erro numa verificação automática: só vai para o log e a situação volta
//      a ser a de antes (sem incomodar). Erro numa verificação pedida pelo
//      usuário (ou na instalação): situação "erro" com a mensagem.
//
// Estado público (contrato com a tela, enviado pelo canal "atualizacao:estado"):
//   {
//     situacao: "indisponivel" | "verificando" | "em-dia" | "baixando" | "pronta" | "erro",
//     versaoAtual: string,          // app.getVersion()
//     versaoNova: string | null,    // em "baixando" e "pronta"
//     progresso: number | null,     // 0–100 inteiro, só em "baixando"
//     mensagemDeErro: string | null // só em "erro"
//   }
// Fora do app instalado o serviço fica inativo: "indisponivel" para sempre.
// Ativo e ainda sem nenhuma verificação concluída, a situação é "em-dia".

const ATRASO_DA_PRIMEIRA_VERIFICACAO_MS = 10_000;
const INTERVALO_ENTRE_VERIFICACOES_MS = 4 * 60 * 60_000;

// ──────────────────────────────────────────────────────────────────────────
// Estado e transições (funções puras).
// ──────────────────────────────────────────────────────────────────────────
function estadoInicial(versaoAtual, ativo) {
  return {
    situacao: ativo ? "em-dia" : "indisponivel",
    versaoAtual: String(versaoAtual || ""),
    versaoNova: null,
    progresso: null,
    mensagemDeErro: null,
  };
}

function percentualInteiro(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.min(100, Math.max(0, Math.floor(numero)));
}

function versaoOu(versao, alternativa) {
  return typeof versao === "string" && versao.trim() ? versao.trim() : alternativa || null;
}

// Próximo estado a partir do atual e de um evento. Eventos:
//   { tipo: "verificando" }
//   { tipo: "disponivel", versao }          versão nova encontrada (o download começa)
//   { tipo: "sem-atualizacao" }
//   { tipo: "progresso", percentual }       0–100, pode vir fracionado
//   { tipo: "baixada", versao }
//   { tipo: "erro", manual, mensagem, anterior }
//       manual: true → situação "erro" com a mensagem;
//       manual: false → volta ao `anterior` (o estado de antes da verificação).
function proximoEstado(estado, evento) {
  if (!estado || estado.situacao === "indisponivel" || !evento) return estado;
  const limpo = { versaoAtual: estado.versaoAtual, versaoNova: null, progresso: null, mensagemDeErro: null };

  switch (evento.tipo) {
    case "verificando":
      // Uma versão baixando ou já baixada não volta para trás por causa de uma
      // nova consulta.
      if (estado.situacao === "baixando" || estado.situacao === "pronta") return estado;
      return { ...limpo, situacao: "verificando" };

    case "disponivel":
      return { ...limpo, situacao: "baixando", versaoNova: versaoOu(evento.versao, estado.versaoNova), progresso: 0 };

    case "sem-atualizacao":
      if (estado.situacao === "pronta") return estado;
      return { ...limpo, situacao: "em-dia" };

    case "progresso":
      if (estado.situacao === "pronta") return estado;
      return {
        ...limpo,
        situacao: "baixando",
        versaoNova: estado.versaoNova,
        progresso: percentualInteiro(evento.percentual),
      };

    case "baixada":
      return { ...limpo, situacao: "pronta", versaoNova: versaoOu(evento.versao, estado.versaoNova) };

    case "erro":
      if (evento.manual) {
        return {
          ...limpo,
          situacao: "erro",
          mensagemDeErro: evento.mensagem || "Não foi possível verificar a atualização.",
        };
      }
      if (evento.anterior && evento.anterior.situacao && evento.anterior.situacao !== "indisponivel") {
        return { ...evento.anterior, versaoAtual: estado.versaoAtual };
      }
      return { ...limpo, situacao: "em-dia" };

    default:
      return estado;
  }
}

function mesmoEstado(a, b) {
  return (
    a.situacao === b.situacao &&
    a.versaoAtual === b.versaoAtual &&
    a.versaoNova === b.versaoNova &&
    a.progresso === b.progresso &&
    a.mensagemDeErro === b.mensagemDeErro
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Mensagens de erro para o usuário (o detalhe técnico vai para o log).
// ──────────────────────────────────────────────────────────────────────────
const SEM_CONEXAO =
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_|TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_)/;

function detalheDoErro(erro) {
  if (erro == null) return "erro desconhecido";
  if (typeof erro === "string") return erro;
  return String(erro.message || erro);
}

function mensagemDoErro(erro) {
  const codigo = erro && typeof erro === "object" ? String(erro.code || "") : "";
  const status = erro && typeof erro === "object" ? Number(erro.statusCode) : NaN;
  const detalhe = detalheDoErro(erro);

  if (SEM_CONEXAO.test(codigo) || SEM_CONEXAO.test(detalhe)) {
    return "Sem conexão com o GitHub para procurar atualizações. Verifique a internet e tente de novo.";
  }
  if (
    codigo === "ERR_UPDATER_NO_PUBLISHED_VERSIONS" ||
    codigo === "ERR_UPDATER_LATEST_VERSION_NOT_FOUND" ||
    codigo === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" ||
    status === 404
  ) {
    return "Nenhuma versão publicada foi encontrada nas Releases do GitHub. Tente de novo mais tarde.";
  }
  if (status === 403 || status === 429) {
    return "O GitHub recusou a consulta agora (limite de acessos). Tente de novo daqui a alguns minutos.";
  }
  if (codigo === "ERR_UPDATER_INVALID_SIGNATURE") {
    return "A versão baixada não passou na verificação de assinatura e foi descartada.";
  }
  if (codigo === "ERR_CHECKSUM_MISMATCH") {
    return "O arquivo da atualização chegou corrompido e foi descartado. Tente de novo.";
  }
  return `Não foi possível verificar a atualização: ${detalhe}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Serviço.
// ──────────────────────────────────────────────────────────────────────────
function agendarComTimeout(funcao, atrasoMs) {
  const timer = setTimeout(funcao, atrasoMs);
  return () => clearTimeout(timer);
}

// atualizador: o autoUpdater do electron-updater (ou um falso nos testes), já
//   configurado. Ignorado quando `ativo` é false.
// ativo: true só no app instalado normal.
// registrar(texto): grava no log.
// aoMudar(estado): chamado a cada mudança do estado público.
// agendar(funcao, atrasoMs): agenda e devolve a função que cancela.
function criarServicoDeAtualizacao({
  atualizador = null,
  versaoAtual,
  ativo = false,
  registrar = () => {},
  aoMudar = () => {},
  agendar = agendarComTimeout,
} = {}) {
  const ligado = Boolean(ativo && atualizador);
  let estado = estadoInicial(versaoAtual, ligado);
  // Verificação em andamento (do "verificando" até "pronta"/"em-dia"/erro):
  // quem pediu e o estado de antes, para voltar a ele num erro automático.
  let ciclo = null;
  let instalando = false;
  let iniciado = false;
  let cancelarAgendamento = null;

  const obter = () => ({ ...estado });

  function registrarSeguro(texto) {
    try {
      registrar(texto);
    } catch {
      /* sem log o serviço segue */
    }
  }

  function aplicar(evento) {
    const novo = proximoEstado(estado, evento);
    if (mesmoEstado(novo, estado)) return;
    estado = novo;
    try {
      aoMudar(obter());
    } catch (erro) {
      registrarSeguro(`Falha ao avisar a tela sobre a atualização: ${detalheDoErro(erro)}`);
    }
  }

  function aoFalhar(erro) {
    const manual = instalando || Boolean(ciclo && ciclo.manual);
    const anterior = ciclo ? ciclo.anterior : obter();
    const mensagem = instalando
      ? `Não foi possível iniciar a instalação da versão ${estado.versaoNova || "nova"} (${detalheDoErro(erro)}). ` +
        "Procure a atualização de novo para tentar outra vez."
      : mensagemDoErro(erro);
    registrarSeguro(
      manual
        ? `Falha na atualização: ${detalheDoErro(erro)}`
        : `Falha na verificação automática (a tela não foi avisada): ${detalheDoErro(erro)}`,
    );
    ciclo = null;
    aplicar({ tipo: "erro", manual, mensagem, anterior });
  }

  if (ligado) {
    atualizador.on("checking-for-update", () => aplicar({ tipo: "verificando" }));
    atualizador.on("update-available", (info) => {
      const versao = info && info.version;
      registrarSeguro(`Versão nova encontrada: ${versao || "?"}. Baixando em segundo plano.`);
      aplicar({ tipo: "disponivel", versao });
    });
    atualizador.on("update-not-available", () => {
      ciclo = null;
      aplicar({ tipo: "sem-atualizacao" });
    });
    atualizador.on("download-progress", (progresso) => {
      aplicar({ tipo: "progresso", percentual: progresso && progresso.percent });
    });
    atualizador.on("update-downloaded", (info) => {
      const versao = info && info.version;
      registrarSeguro(`Versão ${versao || "nova"} baixada: instala ao reiniciar ou ao fechar o app.`);
      ciclo = null;
      aplicar({ tipo: "baixada", versao });
    });
    atualizador.on("error", (erro) => aoFalhar(erro));
  }

  // Dispara uma verificação e devolve o estado logo em seguida (não espera o
  // download). manual: pedida pelo usuário (um erro aparece na tela).
  function verificar({ manual = false } = {}) {
    if (!ligado) return obter();
    // Já baixada: nada a procurar até instalar.
    if (estado.situacao === "pronta" || instalando) return obter();
    // Já em andamento: o usuário passa a acompanhar (um erro aparece na tela).
    if (ciclo) {
      if (manual) ciclo.manual = true;
      return obter();
    }

    const meuCiclo = { manual, anterior: obter() };
    ciclo = meuCiclo;
    aplicar({ tipo: "verificando" });

    let promessa;
    try {
      promessa = atualizador.checkForUpdates();
    } catch (erro) {
      aoFalhar(erro);
      return obter();
    }

    Promise.resolve(promessa).then(
      (resultado) => {
        // O download segue em segundo plano; uma falha nele chega pelo evento
        // "error". Aqui só evita a rejeição sem tratamento.
        if (resultado && resultado.downloadPromise && typeof resultado.downloadPromise.catch === "function") {
          resultado.downloadPromise.catch(() => {});
        }
        // Sem resultado e sem evento (atualizador desligado por dentro).
        if (resultado == null && ciclo === meuCiclo) {
          aoFalhar(new Error("o atualizador não está ativo nesta instalação"));
        }
      },
      (erro) => {
        // Normalmente o evento "error" já tratou (e encerrou o ciclo).
        if (ciclo === meuCiclo) aoFalhar(erro);
      },
    );
    return obter();
  }

  function verificacaoAutomatica() {
    // Agenda a próxima antes: uma falha não interrompe a sequência.
    cancelarAgendamento = agendar(verificacaoAutomatica, INTERVALO_ENTRE_VERIFICACOES_MS);
    try {
      verificar({ manual: false });
    } catch (erro) {
      registrarSeguro(`Falha na verificação automática: ${detalheDoErro(erro)}`);
    }
  }

  // Liga as verificações automáticas (uma vez só).
  function iniciar() {
    if (!ligado || iniciado) return;
    iniciado = true;
    cancelarAgendamento = agendar(verificacaoAutomatica, ATRASO_DA_PRIMEIRA_VERIFICACAO_MS);
  }

  function parar() {
    if (cancelarAgendamento) cancelarAgendamento();
    cancelarAgendamento = null;
    iniciado = false;
  }

  // Instala a versão baixada agora: fecha o app, instala em silêncio e reabre.
  // Só tem efeito em "pronta". `antesDeInstalar` roda antes (o main encerra o
  // servidor). Devolve true se a instalação foi disparada.
  function instalarAgora({ antesDeInstalar } = {}) {
    if (!ligado || estado.situacao !== "pronta" || instalando) return false;
    instalando = true;
    registrarSeguro(`Instalando a versão ${estado.versaoNova || "nova"} agora; o app reabre sozinho.`);
    try {
      if (typeof antesDeInstalar === "function") antesDeInstalar();
      // Silencioso e reabrindo o app depois. Uma falha chega pelo evento
      // "error" (na hora) e tira a situação de "pronta".
      atualizador.quitAndInstall(true, true);
    } catch (erro) {
      aoFalhar(erro);
    }
    const disparou = estado.situacao === "pronta";
    instalando = disparou;
    return disparou;
  }

  return { obter, verificar, iniciar, parar, instalarAgora };
}

module.exports = {
  ATRASO_DA_PRIMEIRA_VERIFICACAO_MS,
  INTERVALO_ENTRE_VERIFICACOES_MS,
  criarServicoDeAtualizacao,
  estadoInicial,
  mensagemDoErro,
  proximoEstado,
};
