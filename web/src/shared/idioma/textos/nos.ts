import { definirTextos } from "../idioma";

/** Textos dos módulos compartilhados dos nós: anexos, alterações, artefatos, modelos, resumo e hooks. */
export const textosDeApoioDosNos = definirTextos({
  "pt-BR": {
    anexos: {
      imagemColada: "imagem colada",
      imagem: "Imagem",
      documento: "Documento",
      texto: "Texto",
      formatoAntigoDoc: "Word (formato antigo)",
      formatoAntigoXls: "Excel (formato antigo)",
      avisoDoFormatoAntigo:
        "Formato antigo: o Claude não lê .doc e .xls direto. Salve como .docx ou .xlsx e anexe de novo para ele ler o conteúdo.",
      formatosAceitos:
        "Dá para anexar imagens (PNG, JPEG, GIF ou WebP) e documentos (PDF, Word, Excel, CSV, PowerPoint, HTML, TXT, MD, JSON, XML, YAML ou LOG).",
      arquivo: "O arquivo",
      formatoNaoAnexavel: (nome: string, formatos: string) => `"${nome}" tem um formato que não dá para anexar. ${formatos}`,
      vazio: (nome: string) => `"${nome}" está vazio.`,
      imagemGrande: (nome: string, mb: string) => `"${nome}" passa de ${mb} MB, o limite do Claude por imagem.`,
      documentoGrande: (nome: string, mb: string) => `"${nome}" passa de ${mb} MB, o limite por documento.`,
      maximoDeAnexos: (maximo: number) => `Dá para anexar até ${maximo} arquivos por mensagem.`,
      maximoDeImagens: (maximo: number) => `Dá para anexar até ${maximo} imagens por mensagem.`,
      somaMaxima: (mb: string) => `Os anexos de uma mensagem somam no máximo ${mb} MB.`,
      formatoNaoAceito: (nome: string) => `"${nome}" não é um formato aceito.`,
      naoFoiPossivelLer: (nome: string) => `Não foi possível ler "${nome}".`,
    },
    alteracoes: {
      semConexao: "Não foi possível falar com o servidor. Feche e abra o Orquestrador de novo.",
      erroDoServidor: (status: number) => `O servidor respondeu com erro ${status}.`,
      semGit: "Esta pasta não é um repositório git: os agentes alteram a pasta direto.",
      semAlteracoes: "Nenhuma alteração pendente no worktree.",
      emUso: "Um pedido está rodando: a lista pode mudar.",
      diffTruncado: "O diff é grande e foi cortado aqui: o resto está no arquivo, dentro do worktree.",
      arquivoBinario: "Arquivo binário: não há diff de texto para mostrar.",
      diffVazio: "Sem diferenças de texto neste arquivo.",
      commitsNaBranch: (quantidade: number, branch: string) =>
        quantidade === 1
          ? `1 commit na branch ${branch} não aparece aqui.`
          : `${quantidade} commits na branch ${branch} não aparecem aqui.`,
    },
    modelos: {
      descricoes: {
        fable: "Para seus desafios mais difíceis",
        opus: "Para trabalhos complexos e tarefas do dia a dia",
        sonnet: "Mais eficiente para tarefas mais simples",
        haiku: "Mais rápido para respostas rápidas",
      },
      esforcos: {
        padrao: "Padrão",
        baixo: "Baixo",
        medio: "Médio",
        alto: "Alto",
        extra_alto: "Extra alto",
        maximo: "Máximo",
        ultracode: "Ultracode",
      },
      padraoDoCli: "Padrão do CLI",
      informeOModelo: (papel: string) => `Informe o modelo ${papel} (ou escolha o padrão do CLI).`,
      modeloInvalido: (papel: string) =>
        `O modelo ${papel} só aceita letras, números, ponto, hífen, sublinhado e dois-pontos (até 64 caracteres).`,
      doOrquestrador: "do orquestrador",
      dosSubagentes: "dos subagentes",
    },
    resumo: {
      modeloComEsforco: (modelo: string, esforco: string) => `${modelo} (esforço ${esforco})`,
      ate: (limite: number) => `até ${limite}`,
      sempre: (limite: number) => `sempre ${limite}`,
      subagente: "subagente",
      subagentes: "subagentes",
      frase: (permissao: string, orquestrador: string, contagem: string, subagentes: string, dosSubagentes: string) =>
        `${permissao}, ${orquestrador} com ${contagem} ${subagentes} ${dosSubagentes}.`,
      reserva: (motores: string) => ` Reserva: ${motores}.`,
      artefatosOnline: " Artefatos online ligados.",
      navegador: " Navegador do agente ligado.",
    },
    configuracao: {
      naoInstalado: (motor: string) => `${motor} não está instalado neste computador.`,
      faltaLogin: (motor: string) => `Faça login no ${motor} antes de usar.`,
    },
    instrucoes: {
      dicaDasVariaveis: "Use {{pasta}} e {{nome}} para a pasta e o nome do orquestrador.",
    },
    notas: {
      naoCriou: (detalhe: string) => `Não foi possível criar a nota: ${detalhe}`,
    },
    melhoria: {
      vazia: "A melhoria voltou vazia; o texto ficou como estava.",
      naoMelhorou: (detalhe: string) => `Não foi possível melhorar o pedido: ${detalhe}`,
    },
  },
  en: {
    anexos: {
      imagemColada: "pasted image",
      imagem: "Image",
      documento: "Document",
      texto: "Text",
      formatoAntigoDoc: "Word (legacy format)",
      formatoAntigoXls: "Excel (legacy format)",
      avisoDoFormatoAntigo:
        "Legacy format: Claude cannot read .doc and .xls files directly. Save as .docx or .xlsx and attach again so it can read the content.",
      formatosAceitos:
        "You can attach images (PNG, JPEG, GIF or WebP) and documents (PDF, Word, Excel, CSV, PowerPoint, HTML, TXT, MD, JSON, XML, YAML or LOG).",
      arquivo: "The file",
      formatoNaoAnexavel: (nome: string, formatos: string) => `"${nome}" has a format that cannot be attached. ${formatos}`,
      vazio: (nome: string) => `"${nome}" is empty.`,
      imagemGrande: (nome: string, mb: string) => `"${nome}" is over ${mb} MB, Claude's limit per image.`,
      documentoGrande: (nome: string, mb: string) => `"${nome}" is over ${mb} MB, the limit per document.`,
      maximoDeAnexos: (maximo: number) => `You can attach up to ${maximo} files per message.`,
      maximoDeImagens: (maximo: number) => `You can attach up to ${maximo} images per message.`,
      somaMaxima: (mb: string) => `The attachments in a message add up to at most ${mb} MB.`,
      formatoNaoAceito: (nome: string) => `"${nome}" is not a supported format.`,
      naoFoiPossivelLer: (nome: string) => `Could not read "${nome}".`,
    },
    alteracoes: {
      semConexao: "Could not reach the server. Close and reopen the Orchestrator.",
      erroDoServidor: (status: number) => `The server responded with error ${status}.`,
      semGit: "This folder is not a git repository: the agents change the folder directly.",
      semAlteracoes: "No pending changes in the worktree.",
      emUso: "A request is running: the list may change.",
      diffTruncado: "The diff is large and was cut off here: the rest is in the file, inside the worktree.",
      arquivoBinario: "Binary file: there is no text diff to show.",
      diffVazio: "No text differences in this file.",
      commitsNaBranch: (quantidade: number, branch: string) =>
        quantidade === 1
          ? `1 commit on branch ${branch} is not shown here.`
          : `${quantidade} commits on branch ${branch} are not shown here.`,
    },
    modelos: {
      descricoes: {
        fable: "For your hardest challenges",
        opus: "For complex work and everyday tasks",
        sonnet: "Most efficient for simpler tasks",
        haiku: "Fastest for quick answers",
      },
      esforcos: {
        padrao: "Default",
        baixo: "Low",
        medio: "Medium",
        alto: "High",
        extra_alto: "Extra high",
        maximo: "Max",
        ultracode: "Ultracode",
      },
      padraoDoCli: "CLI default",
      informeOModelo: (papel: string) => `Enter the ${papel} model (or pick the CLI default).`,
      modeloInvalido: (papel: string) =>
        `The ${papel} model only accepts letters, numbers, period, hyphen, underscore and colon (up to 64 characters).`,
      doOrquestrador: "orchestrator",
      dosSubagentes: "subagent",
    },
    resumo: {
      modeloComEsforco: (modelo: string, esforco: string) => `${modelo} (${esforco} effort)`,
      ate: (limite: number) => `up to ${limite}`,
      sempre: (limite: number) => `always ${limite}`,
      subagente: "subagent",
      subagentes: "subagents",
      frase: (permissao: string, orquestrador: string, contagem: string, subagentes: string, dosSubagentes: string) =>
        `${permissao}, ${orquestrador} with ${contagem} ${dosSubagentes} ${subagentes}.`,
      reserva: (motores: string) => ` Fallback: ${motores}.`,
      artefatosOnline: " Online artifacts on.",
      navegador: " Agent browser on.",
    },
    configuracao: {
      naoInstalado: (motor: string) => `${motor} is not installed on this computer.`,
      faltaLogin: (motor: string) => `Log in to ${motor} before using it.`,
    },
    instrucoes: {
      dicaDasVariaveis: "Use {{pasta}} and {{nome}} for the orchestrator's folder and name.",
    },
    notas: {
      naoCriou: (detalhe: string) => `Could not create the note: ${detalhe}`,
    },
    melhoria: {
      vazia: "The improvement came back empty; the text was left as it was.",
      naoMelhorou: (detalhe: string) => `Could not improve the request: ${detalhe}`,
    },
  },
});
