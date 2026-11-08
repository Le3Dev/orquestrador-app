import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sondarEnderecoLocal } from "./SondaDeEnderecoLocal";

describe("sondarEnderecoLocal", () => {
  let servidor: Server;
  let porta = 0;

  beforeAll(async () => {
    // Responde 404 de propósito: qualquer resposta HTTP conta como servidor no ar.
    servidor = createServer((_requisicao, resposta) => resposta.writeHead(404).end("nada"));
    await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
    porta = (servidor.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((pronto) => servidor.close(() => pronto())));

  it("vê o servidor que escuta só em 127.0.0.1 pelo endereço com localhost e caminho", async () => {
    expect(await sondarEnderecoLocal(`http://localhost:${porta}/alguma/pagina`)).toBe(true);
  });

  it("não vê servidor numa porta fechada", async () => {
    const fechado = createServer();
    await new Promise<void>((pronto) => fechado.listen(0, "127.0.0.1", pronto));
    const portaLivre = (fechado.address() as AddressInfo).port;
    await new Promise<void>((pronto) => fechado.close(() => pronto()));

    expect(await sondarEnderecoLocal(`http://localhost:${portaLivre}`)).toBe(false);
  });

  it("endereço inválido é falso", async () => {
    expect(await sondarEnderecoLocal("não é endereço")).toBe(false);
  });
});
