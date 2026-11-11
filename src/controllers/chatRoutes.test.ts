import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  EventoDoMotorDeChat,
  MotorDeChat,
  PerguntaAoMotorDeChat,
  ResultadoDaResposta,
} from "../chat/MotorDeChat";
import { ServicoDeChat } from "../chat/ServicoDeChat";
import { ArmazemDeAnexosEmArquivo } from "../infraestrutura/arquivos/ArmazemDeAnexosEmArquivo";
import { RepositorioDoChatEmArquivo } from "../infraestrutura/arquivos/RepositorioDoChatEmArquivo";
import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { CanalDoChat, criarChatRoutes } from "./chatRoutes";

const uso = { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, modeloUsado: null };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

function sucesso(resposta: string): ResultadoDaResposta {
  return { sucesso: true, resposta, uso, autorizacaoPendente: null, avisos: [] };
}

/** Motor que espera o teste mandar terminar. */
class MotorDoTeste implements MotorDeChat {
  readonly perguntas: PerguntaAoMotorDeChat[] = [];
  observar: (evento: EventoDoMotorDeChat) => void = () => undefined;
  terminar: (resultado: ResultadoDaResposta) => void = () => undefined;

  responder(
    pergunta: PerguntaAoMotorDeChat,
    aoObservar: (evento: EventoDoMotorDeChat) => void,
    sinal: AbortSignal,
  ): Promise<ResultadoDaResposta> {
    this.perguntas.push(pergunta);
    this.observar = aoObservar;
    return new Promise((resolver) => {
      this.terminar = resolver;
      sinal.addEventListener("abort", () => resolver({ sucesso: false, motivo: "cancelado", uso: null }));
    });
  }
}

describe("rotas do chat", () => {
  let pasta: string;
  let servidor: Server;
  let base: string;
  let motor: MotorDoTeste;
  let repositorio: RepositorioDoChatEmArquivo;
  let ids: number;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "rotas-chat-teste-"));
    ids = 0;
    motor = new MotorDoTeste();
    repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, () => "sessao-1");
    const anexos = new ArmazemDeAnexosEmArquivo(path.join(pasta, "anexos"));
    const canal = new CanalDoChat();
    const servico = new ServicoDeChat({
      repositorio,
      motor,
      projetos: { listarProjetos: async () => [], listarOrquestradores: async () => [] },
      subagentes: { listarSubagentesProntos: async () => [] },
      anexos,
      publicador: canal,
      execucoes: new ControleDeExecucoesEmMemoria(),
      pastaDaSessao: repositorio.pastaDaSessao,
      pastaDosProjetos: pasta,
      pastaDeArtefatos: path.join(pasta, "artefatos", "entrada", "chat"),
      gerarId: () => `id${++ids}`,
      agora: () => new Date("2026-11-04T12:00:00Z"),
    });

    const aplicacao = express();
    aplicacao.use(express.json({ limit: "40mb" }));
    aplicacao.use("/api", criarChatRoutes({ servico, canal, anexos }));
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
    await repositorio.aguardarGravacoes();
    await rm(pasta, { recursive: true, force: true });
  });

  function enviar(caminho: string, metodo: string, corpo?: unknown): Promise<Response> {
    return fetch(`${base}${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  }

  async function aguardarOcioso(): Promise<void> {
    await expect.poll(async () => ((await (await fetch(`${base}/chat`)).json()) as { situacao: string }).situacao).toBe("ocioso");
  }

  /** Lê o SSE até o texto recebido satisfazer `pronto`. */
  async function lerSse(url: string, pronto: (texto: string) => boolean, cabecalhos: Record<string, string> = {}, aoConectar?: () => void): Promise<string> {
    const controle = new AbortController();
    const resposta = await fetch(url, { headers: cabecalhos, signal: controle.signal });
    expect(resposta.headers.get("content-type")).toMatch(/text\/event-stream/);
    const leitor = resposta.body!.getReader();
    const decodificador = new TextDecoder();
    let texto = "";
    aoConectar?.();
    while (!pronto(texto)) {
      const { value, done } = await leitor.read();
      if (done) break;
      texto += decodificador.decode(value);
    }
    controle.abort();
    return texto;
  }

  it("GET /chat devolve o estado inicial", async () => {
    const resposta = await fetch(`${base}/chat`);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      sessaoId: "sessao-1",
      situacao: "ocioso",
      alteracoesAutorizadas: false,
      preferencias: { modelo: "opus", esforco: "alto", permitirArtefatosOnline: false },
      mensagens: [],
      ultimaSequencia: 0,
      cota: null,
    });
  });

  it("POST /chat/mensagens responde 202, mostra o texto parcial e recusa outra pergunta com 409", async () => {
    const resposta = await enviar("/chat/mensagens", "POST", { texto: "oi" });
    expect(resposta.status).toBe(202);
    const { mensagemId } = (await resposta.json()) as { mensagemId: string };
    await expect.poll(() => motor.perguntas.length).toBe(1);

    motor.observar({ tipo: "trecho_da_resposta", texto: "Olá, " });
    const estado = (await (await fetch(`${base}/chat`)).json()) as { situacao: string; mensagens: { id: string; texto: string }[] };
    expect(estado.situacao).toBe("respondendo");
    expect(estado.mensagens[1]).toMatchObject({ id: mensagemId, texto: "Olá, " });

    const outra = await enviar("/chat/mensagens", "POST", { texto: "de novo" });
    expect(outra.status).toBe(409);
    expect(await outra.json()).toEqual({ erro: "Já há uma resposta em andamento." });

    motor.terminar(sucesso("Olá, tudo bem?"));
    await aguardarOcioso();
  });

  it("POST /chat/mensagens recusa texto vazio sem anexos e anexo de formato inválido com 400", async () => {
    const vazio = await enviar("/chat/mensagens", "POST", { texto: "   " });
    expect(vazio.status).toBe(400);
    expect(await vazio.json()).toEqual({ erro: "Escreva uma mensagem ou anexe um arquivo." });

    const imagemInvalida = await enviar("/chat/mensagens", "POST", {
      texto: "oi",
      anexos: [{ nome: "a.bmp", tipoDeMidia: "image/bmp", base64: PNG }],
    });
    expect(imagemInvalida.status).toBe(400);
    expect(((await imagemInvalida.json()) as { erro: string }).erro).toContain("PNG, JPEG, GIF ou WebP");

    const formato = await enviar("/chat/mensagens", "POST", {
      texto: "oi",
      anexos: [{ nome: "programa.exe", tipoDeMidia: "", base64: PNG }],
    });
    expect(formato.status).toBe(400);
    expect(((await formato.json()) as { erro: string }).erro).toContain("não dá para anexar");
    expect(motor.perguntas).toHaveLength(0);
  });

  it("POST /chat/mensagens recusa mais de 10 anexos e a 6ª imagem com a mensagem do domínio", async () => {
    const documento = { nome: "a.pdf", tipoDeMidia: "application/pdf", base64: PNG };
    const muitos = await enviar("/chat/mensagens", "POST", { texto: "oi", anexos: Array.from({ length: 11 }, () => documento) });
    expect(muitos.status).toBe(400);
    expect(await muitos.json()).toEqual({ erro: "Anexe até 10 arquivos por mensagem." });

    const imagem = { nome: "a.png", tipoDeMidia: "image/png", base64: PNG };
    const seis = await enviar("/chat/mensagens", "POST", { texto: "oi", anexos: Array.from({ length: 6 }, () => imagem) });
    expect(seis.status).toBe(400);
    expect(await seis.json()).toEqual({ erro: "Anexe até 5 imagens por mensagem." });
    expect(motor.perguntas).toHaveLength(0);
  });

  it("POST /chat/mensagens ignora o campo antigo `imagens`: só `anexos` vale", async () => {
    const resposta = await enviar("/chat/mensagens", "POST", {
      texto: "",
      imagens: [{ nome: "print.png", tipoDeMidia: "image/png", base64: PNG }],
    });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: "Escreva uma mensagem ou anexe um arquivo." });
  });

  it("POST /chat/mensagens aceita origem 'escuta', grava na mensagem e manda no SSE", async () => {
    const resposta = await enviar("/chat/mensagens", "POST", { texto: "Qual o prazo?", origem: "escuta" });
    expect(resposta.status).toBe(202);
    await expect.poll(() => motor.perguntas.length).toBe(1);

    const estado = (await (await fetch(`${base}/chat`)).json()) as { mensagens: Record<string, unknown>[] };
    expect(estado.mensagens[0]).toMatchObject({ papel: "usuario", texto: "Qual o prazo?", origem: "escuta" });
    expect(estado.mensagens[1]).not.toHaveProperty("origem");

    const recebido = await lerSse(`${base}/chat/eventos`, (texto) => texto.includes("pergunta_enviada"));
    expect(recebido).toContain('"origem":"escuta"');

    motor.terminar(sucesso("Sexta."));
    await aguardarOcioso();
    await repositorio.aguardarGravacoes();
    // Gravada em conversa.json e em eventos.jsonl: sobrevive a reabrir o chat.
    const reaberto = await RepositorioDoChatEmArquivo.abrir(pasta, () => "outra");
    expect(reaberto.conversa().mensagens[0]?.origem).toBe("escuta");
    expect(reaberto.lerEventos(0)[0]).toMatchObject({ tipo: "pergunta_enviada", mensagemDoUsuario: { origem: "escuta" } });
  });

  it("POST /chat/mensagens sem origem não grava o campo", async () => {
    await enviar("/chat/mensagens", "POST", { texto: "oi" });
    await expect.poll(() => motor.perguntas.length).toBe(1);

    const estado = (await (await fetch(`${base}/chat`)).json()) as { mensagens: Record<string, unknown>[] };
    expect(estado.mensagens[0]).not.toHaveProperty("origem");

    motor.terminar(sucesso("ok"));
    await aguardarOcioso();
  });

  it("POST /chat/mensagens recusa outra origem com 400", async () => {
    for (const origem of ["teclado", "", 1, null]) {
      const resposta = await enviar("/chat/mensagens", "POST", { texto: "oi", origem });
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "Origem da mensagem inválida." });
    }
    expect(motor.perguntas).toHaveLength(0);
  });

  it("POST /chat/mensagens leva as prévias abertas ao Claude e recusa as inválidas com 400", async () => {
    const aberta = ["http://localhost:5173"];
    const resposta = await enviar("/chat/mensagens", "POST", { texto: "oi", previasAbertas: aberta });
    expect(resposta.status).toBe(202);
    await expect.poll(() => motor.perguntas.length).toBe(1);
    expect(motor.perguntas[0]?.mensagem).toContain("Prévias abertas no canvas agora: http://localhost:5173.");
    motor.terminar(sucesso("ok"));
    await aguardarOcioso();

    for (const previasAbertas of [["file:///etc/passwd"], Array.from({ length: 11 }, () => "http://localhost:5173"), "http://x"]) {
      const invalida = await enviar("/chat/mensagens", "POST", { texto: "oi", previasAbertas });
      expect(invalida.status).toBe(400);
    }
    expect(motor.perguntas).toHaveLength(1);
  });

  it("aceita só imagem e serve o anexo inline em GET /chat/anexos/:arquivo, protegendo o caminho", async () => {
    const resposta = await enviar("/chat/mensagens", "POST", {
      texto: "",
      anexos: [{ nome: "print.png", tipoDeMidia: "image/png", base64: PNG }],
    });
    expect(resposta.status).toBe(202);
    await expect.poll(() => motor.perguntas.length).toBe(1);
    const estado = (await (await fetch(`${base}/chat`)).json()) as { mensagens: { anexos: { arquivo: string }[] }[] };
    const arquivo = estado.mensagens[0]?.anexos[0]?.arquivo ?? "";

    const imagem = await fetch(`${base}/chat/anexos/${arquivo}`);
    expect(imagem.status).toBe(200);
    expect(imagem.headers.get("content-type")).toBe("image/png");
    expect(imagem.headers.get("content-disposition")).toBeNull();
    expect(Buffer.from(await imagem.arrayBuffer()).toString("base64")).toBe(PNG);

    expect((await fetch(`${base}/chat/anexos/..%5C..%5Cconversa.json`)).status).toBe(404);
    expect((await fetch(`${base}/chat/anexos/nao-existe.png`)).status).toBe(404);
    expect((await fetch(`${base}/chat/anexos/nao-existe.pdf`)).status).toBe(404);

    motor.terminar(sucesso("ok"));
    await aguardarOcioso();
  });

  it("aceita só documentos (com o tipo vazio) e entrega cada um como download, nunca inline", async () => {
    const html = Buffer.from("<script>alert(1)</script>").toString("base64");
    const resposta = await enviar("/chat/mensagens", "POST", {
      texto: "",
      anexos: [
        { nome: "pagina.html", tipoDeMidia: "text/html", base64: html },
        { nome: "notas.md", base64: Buffer.from("# oi").toString("base64") },
      ],
    });
    expect(resposta.status).toBe(202);
    await expect.poll(() => motor.perguntas.length).toBe(1);
    const estado = (await (await fetch(`${base}/chat`)).json()) as {
      mensagens: { anexos: { arquivo: string; nome: string; tipoDeMidia: string; categoria: string; tamanhoEmBytes: number }[] }[];
    };
    const [pagina, notas] = estado.mensagens[0]?.anexos ?? [];
    expect(pagina).toMatchObject({ nome: "pagina.html", tipoDeMidia: "text/html", categoria: "documento", tamanhoEmBytes: 25 });
    expect(notas).toMatchObject({ nome: "notas.md", tipoDeMidia: "text/markdown", categoria: "documento", tamanhoEmBytes: 4 });
    expect(estado.mensagens[0]).not.toHaveProperty("imagens");

    const baixado = await fetch(`${base}/chat/anexos/${pagina?.arquivo}`);
    expect(baixado.status).toBe(200);
    expect(baixado.headers.get("content-disposition")).toBe("attachment");
    expect(baixado.headers.get("content-type")).toBe("application/octet-stream");
    expect(baixado.headers.get("x-content-type-options")).toBe("nosniff");
    expect(baixado.headers.get("content-security-policy")).toBe("sandbox");
    expect(await baixado.text()).toBe("<script>alert(1)</script>");

    // O Claude recebe os caminhos; o motor vê os dois documentos e a pasta liberada.
    expect(motor.perguntas[0]?.anexos.map((anexo) => anexo.categoria)).toEqual(["documento", "documento"]);
    expect(motor.perguntas[0]?.pastaDosAnexos).toBe(path.join(pasta, "anexos", "chat"));

    motor.terminar(sucesso("ok"));
    await aguardarOcioso();
  });

  it("um .docx corrompido segue como anexo, só sem o texto extraído (a extração nunca derruba o envio)", async () => {
    const resposta = await enviar("/chat/mensagens", "POST", {
      texto: "resuma",
      anexos: [{ nome: "contrato.docx", tipoDeMidia: "", base64: Buffer.from("isto nao e um zip").toString("base64") }],
    });
    expect(resposta.status).toBe(202);
    await expect.poll(() => motor.perguntas.length).toBe(1);

    expect(motor.perguntas[0]?.anexos[0]).toMatchObject({ nome: "contrato.docx", rotulo: "Word", caminhoDoTexto: null });
    expect(motor.perguntas[0]?.mensagem).not.toContain("texto extraído");

    motor.terminar(sucesso("ok"));
    await aguardarOcioso();
  });

  it("PATCH /chat/preferencias altera e valida", async () => {
    const ok = await enviar("/chat/preferencias", "PATCH", { modelo: "fable" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ modelo: "fable", esforco: "alto", permitirArtefatosOnline: false });

    const modelo = await enviar("/chat/preferencias", "PATCH", { modelo: "gpt" });
    expect(modelo.status).toBe(400);
    expect(await modelo.json()).toEqual({ erro: "Modelo inválido." });

    const esforco = await enviar("/chat/preferencias", "PATCH", { esforco: "enorme" });
    expect(esforco.status).toBe(400);
    expect(await esforco.json()).toEqual({ erro: "Esforço inválido." });
  });

  it("PATCH /chat/preferencias liga e desliga os artefatos online, mantém o resto e recusa o que não é booleano", async () => {
    const ligar = await enviar("/chat/preferencias", "PATCH", { permitirArtefatosOnline: true });
    expect(ligar.status).toBe(200);
    expect(await ligar.json()).toEqual({ modelo: "opus", esforco: "alto", permitirArtefatosOnline: true });

    const outroCampo = await enviar("/chat/preferencias", "PATCH", { modelo: "fable" });
    expect(await outroCampo.json()).toEqual({ modelo: "fable", esforco: "alto", permitirArtefatosOnline: true });

    const desligar = await enviar("/chat/preferencias", "PATCH", { permitirArtefatosOnline: false });
    expect(await desligar.json()).toEqual({ modelo: "fable", esforco: "alto", permitirArtefatosOnline: false });

    for (const valor of ["sim", 1, null]) {
      const invalido = await enviar("/chat/preferencias", "PATCH", { permitirArtefatosOnline: valor });
      expect(invalido.status).toBe(400);
      expect(await invalido.json()).toEqual({
        erro: 'A opção "Publicar artefatos no claude.ai" deve ser verdadeira ou falsa.',
      });
    }
  });

  it("PATCH /chat/autorizacao autoriza e revoga, e o GET /chat mostra o campo", async () => {
    const autorizar = await enviar("/chat/autorizacao", "PATCH", { autorizado: true });
    expect(autorizar.status).toBe(200);
    expect(await autorizar.json()).toEqual({ autorizado: true });
    expect(((await (await fetch(`${base}/chat`)).json()) as { alteracoesAutorizadas: boolean }).alteracoesAutorizadas).toBe(true);

    const revogar = await enviar("/chat/autorizacao", "PATCH", { autorizado: false });
    expect(revogar.status).toBe(200);
    expect(await revogar.json()).toEqual({ autorizado: false });
    expect(((await (await fetch(`${base}/chat`)).json()) as { alteracoesAutorizadas: boolean }).alteracoesAutorizadas).toBe(false);
  });

  it("PATCH /chat/autorizacao recusa corpo inválido com 400", async () => {
    for (const corpo of [{}, { autorizado: "sim" }, { autorizado: 1 }, { autorizado: null }, [true]]) {
      const resposta = await enviar("/chat/autorizacao", "PATCH", corpo);
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "A autorização deve ser verdadeira ou falsa." });
    }
    const semCorpo = await enviar("/chat/autorizacao", "PATCH");
    expect(semCorpo.status).toBe(400);
    expect(await semCorpo.json()).toEqual({ erro: "A autorização deve ser verdadeira ou falsa." });
  });

  it("a autorização dada pelo PATCH vale na próxima pergunta e é gravada no histórico", async () => {
    await enviar("/chat/autorizacao", "PATCH", { autorizado: true });
    await enviar("/chat/mensagens", "POST", { texto: "rode os testes" });
    await expect.poll(() => motor.perguntas.length).toBe(1);
    expect(motor.perguntas[0]?.alteracoesAutorizadas).toBe(true);
    motor.terminar(sucesso("ok"));
    await aguardarOcioso();

    const recebido = await lerSse(`${base}/chat/eventos`, (texto) => texto.includes("resposta_concluida"));
    expect(recebido).toMatch(/id: 1\ndata: \{"tipo":"alteracoes_autorizadas"/);
    expect(recebido).toContain('"autorizacaoPendente":null');
  });

  it("POST /chat/cancelar: 409 sem resposta, 202 com resposta em andamento", async () => {
    expect((await enviar("/chat/cancelar", "POST")).status).toBe(409);

    await enviar("/chat/mensagens", "POST", { texto: "oi" });
    await expect.poll(() => motor.perguntas.length).toBe(1);
    expect((await enviar("/chat/cancelar", "POST")).status).toBe(202);
    await aguardarOcioso();

    const estado = (await (await fetch(`${base}/chat`)).json()) as { mensagens: { situacao: string }[] };
    expect(estado.mensagens[1]?.situacao).toBe("cancelada");
  });

  it("POST /chat/limpar: 409 durante a resposta, 200 com zero mensagens depois", async () => {
    await enviar("/chat/mensagens", "POST", { texto: "oi" });
    await expect.poll(() => motor.perguntas.length).toBe(1);
    const durante = await enviar("/chat/limpar", "POST");
    expect(durante.status).toBe(409);

    motor.terminar(sucesso("ok"));
    await aguardarOcioso();

    const depois = await enviar("/chat/limpar", "POST");
    expect(depois.status).toBe(200);
    expect(await depois.json()).toEqual({ totalDeMensagens: 0 });
    const estado = (await (await fetch(`${base}/chat`)).json()) as { mensagens: unknown[]; sessaoId: string };
    expect(estado.mensagens).toEqual([]);
    expect(estado.sessaoId).not.toBe("sessao-1");
  });

  it("GET /chat/eventos envia o histórico com id, trechos e atividades sem id, e respeita Last-Event-ID", async () => {
    await enviar("/chat/mensagens", "POST", { texto: "oi" });
    await expect.poll(() => motor.perguntas.length).toBe(1);

    const recebido = await lerSse(
      `${base}/chat/eventos`,
      (texto) => texto.includes("event: atividade"),
      {},
      () => {
        setTimeout(() => {
          motor.observar({ tipo: "trecho_da_resposta", texto: "Olá" });
          motor.observar({ tipo: "ferramenta_do_chat", ferramenta: "WebSearch", detalhe: "node lts" });
        }, 50);
      },
    );

    expect(recebido).toContain("retry: 3000");
    expect(recebido).toMatch(/id: 1\ndata: \{"tipo":"pergunta_enviada"/);
    expect(recebido).toContain('event: trecho\ndata: {"mensagemId":"id1","texto":"Olá"}\n\n');
    expect(recebido).toContain('event: atividade\ndata: {"mensagemId":"id1","ferramenta":"WebSearch","detalhe":"node lts"}\n\n');
    expect(recebido).not.toMatch(/id: \d+\nevent:/);

    motor.terminar(sucesso("Olá"));
    await aguardarOcioso();

    const retomado = await lerSse(`${base}/chat/eventos`, (texto) => texto.includes("resposta_concluida"), {
      "Last-Event-ID": "1",
    });
    expect(retomado).not.toContain("pergunta_enviada");
    expect(retomado).toMatch(/id: 2\ndata: \{"tipo":"resposta_concluida"/);

    const porQuery = await lerSse(`${base}/chat/eventos?desde=1`, (texto) => texto.includes("resposta_concluida"));
    expect(porQuery).not.toContain("pergunta_enviada");
  });
});
