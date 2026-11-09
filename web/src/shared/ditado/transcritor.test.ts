import { describe, expect, it } from "vitest";

import type { PedidoDeTranscricao, RespostaDoTranscritor } from "./mensagens";
import {
  criarTranscritor,
  MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO,
  type TrabalhadorDoTranscritor,
  TranscricaoDescartada,
} from "./transcritor";

/** Worker falso: guarda os pedidos e responde quando o teste mandar. */
class TrabalhadorFalso implements TrabalhadorDoTranscritor {
  onmessage: ((evento: MessageEvent<RespostaDoTranscritor>) => void) | null = null;
  onerror: ((evento: ErrorEvent) => void) | null = null;
  readonly pedidos: PedidoDeTranscricao[] = [];
  encerrado = false;

  postMessage(pedido: PedidoDeTranscricao): void {
    this.pedidos.push(pedido);
  }

  terminate(): void {
    this.encerrado = true;
  }

  responder(resposta: RespostaDoTranscritor): void {
    this.onmessage?.({ data: resposta } as MessageEvent<RespostaDoTranscritor>);
  }

  /** Responde o último pedido recebido com um texto. */
  concluirUltimo(texto: string): void {
    const ultimo = this.pedidos.at(-1);
    if (ultimo === undefined) throw new Error("nenhum pedido para concluir");
    this.responder({ tipo: "texto", id: ultimo.id, texto });
  }
}

function montar() {
  const trabalhador = new TrabalhadorFalso();
  let criados = 0;
  const transcrever = criarTranscritor(() => {
    criados++;
    return trabalhador;
  });
  return { trabalhador, transcrever, criados: () => criados };
}

const audio = (valor = 0) => new Float32Array([valor, valor, valor]);

/** Deixa as promessas resolvidas rodarem os seus `then`. */
const esvaziar = () => new Promise<void>((resolver) => setTimeout(resolver, 0));

describe("transcritor", () => {
  it("só cria o worker no primeiro pedido e manda um pedido por vez, na ordem", async () => {
    const { trabalhador, transcrever, criados } = montar();
    expect(criados()).toBe(0);

    const primeiro = transcrever(audio(1));
    const segundo = transcrever(audio(2));
    expect(criados()).toBe(1);
    expect(trabalhador.pedidos).toHaveLength(1);
    expect(trabalhador.pedidos[0]?.audio[0]).toBe(1);

    trabalhador.concluirUltimo("um");
    await expect(primeiro).resolves.toBe("um");
    expect(trabalhador.pedidos).toHaveLength(2);
    expect(trabalhador.pedidos[1]?.audio[0]).toBe(2);

    trabalhador.concluirUltimo("dois");
    await expect(segundo).resolves.toBe("dois");
  });

  it("por padrão pede português; com idioma automático, manda idioma nulo", () => {
    const { trabalhador, transcrever } = montar();
    void transcrever(audio());
    expect(trabalhador.pedidos[0]?.idioma).toBe("portuguese");

    trabalhador.concluirUltimo("ok");
    void transcrever(audio(), undefined, { idioma: "automatico", origem: "escuta" });
    return esvaziar().then(() => {
      expect(trabalhador.pedidos[1]?.idioma).toBeNull();
    });
  });

  it("o ditado passa na frente dos pedidos da escuta que ainda não começaram", async () => {
    const { trabalhador, transcrever } = montar();
    const escuta1 = transcrever(audio(1), undefined, { idioma: "automatico", origem: "escuta" });
    const escuta2 = transcrever(audio(2), undefined, { idioma: "automatico", origem: "escuta" });
    const ditado = transcrever(audio(3));

    // O primeiro da escuta já estava no worker: não é interrompido.
    trabalhador.concluirUltimo("e1");
    await expect(escuta1).resolves.toBe("e1");
    expect(trabalhador.pedidos[1]?.audio[0]).toBe(3);

    trabalhador.concluirUltimo("d");
    await expect(ditado).resolves.toBe("d");
    expect(trabalhador.pedidos[2]?.audio[0]).toBe(2);

    trabalhador.concluirUltimo("e2");
    await expect(escuta2).resolves.toBe("e2");
  });

  it("dois ditados esperando ficam na ordem em que chegaram, ambos antes da escuta", async () => {
    const { trabalhador, transcrever } = montar();
    void transcrever(audio(1), undefined, { origem: "escuta" });
    void transcrever(audio(2), undefined, { origem: "escuta" });
    void transcrever(audio(3));
    void transcrever(audio(4));

    const ordem: number[] = [];
    for (let i = 0; i < 4; i++) {
      ordem.push(trabalhador.pedidos[i]?.audio[0] ?? -1);
      trabalhador.concluirUltimo("x");
      await esvaziar();
    }
    expect(ordem).toEqual([1, 3, 4, 2]);
  });

  it(`a escuta deixa no máximo ${MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO} esperando: o mais antigo é descartado`, async () => {
    const { trabalhador, transcrever } = montar();
    const emAndamento = transcrever(audio(1), undefined, { origem: "escuta" });
    const esperando1 = transcrever(audio(2), undefined, { origem: "escuta" });
    const esperando2 = transcrever(audio(3), undefined, { origem: "escuta" });
    const esperando3 = transcrever(audio(4), undefined, { origem: "escuta" });

    await expect(esperando1).rejects.toBeInstanceOf(TranscricaoDescartada);

    trabalhador.concluirUltimo("1");
    await expect(emAndamento).resolves.toBe("1");
    trabalhador.concluirUltimo("3");
    await expect(esperando2).resolves.toBe("3");
    trabalhador.concluirUltimo("4");
    await expect(esperando3).resolves.toBe("4");
    expect(trabalhador.pedidos.map((pedido) => pedido.audio[0])).toEqual([1, 3, 4]);
  });

  it("um ditado esperando não conta no limite da escuta", async () => {
    const { trabalhador, transcrever } = montar();
    void transcrever(audio(1));
    const e1 = transcrever(audio(2), undefined, { origem: "escuta" });
    const e2 = transcrever(audio(3), undefined, { origem: "escuta" });
    const d = transcrever(audio(4));
    trabalhador.concluirUltimo("d0");
    await esvaziar();
    trabalhador.concluirUltimo("d");
    await expect(d).resolves.toBe("d");
    trabalhador.concluirUltimo("e1");
    await expect(e1).resolves.toBe("e1");
    trabalhador.concluirUltimo("e2");
    await expect(e2).resolves.toBe("e2");
  });

  it("erro do worker rejeita só o pedido dele e a fila segue", async () => {
    const { trabalhador, transcrever } = montar();
    const falha = transcrever(audio(1));
    const seguinte = transcrever(audio(2));
    const primeiro = trabalhador.pedidos[0];
    if (primeiro === undefined) throw new Error("sem pedido");
    trabalhador.responder({ tipo: "erro", id: primeiro.id, mensagem: "modelo quebrado" });
    await expect(falha).rejects.toThrow("modelo quebrado");
    trabalhador.concluirUltimo("ok");
    await expect(seguinte).resolves.toBe("ok");
  });

  it("se o worker não sobe, todos os pedidos (em andamento e na fila) são rejeitados", async () => {
    const { trabalhador, transcrever } = montar();
    const a = transcrever(audio(1));
    const b = transcrever(audio(2), undefined, { origem: "escuta" });
    trabalhador.onerror?.({ message: "script não carregou" } as ErrorEvent);
    await expect(a).rejects.toThrow("script não carregou");
    await expect(b).rejects.toThrow("script não carregou");
    expect(trabalhador.encerrado).toBe(true);
  });

  it("o progresso do download chega a quem espera e para depois que o pedido termina", async () => {
    const { trabalhador, transcrever } = montar();
    const progressos: number[] = [];
    const pedido = transcrever(audio(), (progresso) => progressos.push(progresso));
    trabalhador.responder({ tipo: "baixando", progresso: 40 });
    trabalhador.concluirUltimo("ok");
    await pedido;
    trabalhador.responder({ tipo: "baixando", progresso: 90 });
    expect(progressos).toEqual([40]);
  });
});
