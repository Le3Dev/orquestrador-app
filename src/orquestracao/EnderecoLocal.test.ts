import { describe, expect, it } from "vitest";

import { extrairEnderecosLocais } from "./EnderecoLocal";

describe("extrairEnderecosLocais", () => {
  it("lê o endereço do Vite mesmo com a porta colorida", () => {
    const saida = "  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m";

    expect(extrairEnderecosLocais(saida)).toEqual(["http://localhost:5173"]);
  });

  it("troca 0.0.0.0, 127.0.0.1 e [::1] por localhost", () => {
    expect(
      extrairEnderecosLocais("http://0.0.0.0:3000 e http://127.0.0.1:8080/api e http://[::1]:4000/"),
    ).toEqual(["http://localhost:3000", "http://localhost:8080/api", "http://localhost:4000"]);
  });

  it("tira a pontuação que fecha a frase", () => {
    expect(extrairEnderecosLocais("Pronto em http://localhost:3000.")).toEqual(["http://localhost:3000"]);
    expect(extrairEnderecosLocais("(veja http://localhost:3000/docs), depois")).toEqual([
      "http://localhost:3000/docs",
    ]);
    expect(extrairEnderecosLocais('url: "http://localhost:3000/";')).toEqual(["http://localhost:3000"]);
  });

  it("só tira a barra final quando ela está sozinha", () => {
    expect(extrairEnderecosLocais("http://localhost:5173/")).toEqual(["http://localhost:5173"]);
    expect(extrairEnderecosLocais("http://localhost:5173/app/")).toEqual(["http://localhost:5173/app/"]);
  });

  it("aceita https e mantém o caminho", () => {
    expect(extrairEnderecosLocais("https://localhost:8443/painel?aba=1")).toEqual([
      "https://localhost:8443/painel?aba=1",
    ]);
  });

  it("não repete o mesmo endereço", () => {
    expect(
      extrairEnderecosLocais("http://localhost:5173/ http://127.0.0.1:5173 http://LOCALHOST:5173"),
    ).toEqual(["http://localhost:5173"]);
  });

  it("ignora endereços sem porta, de outros hosts e texto sem endereço", () => {
    expect(extrairEnderecosLocais("http://localhost/ e https://exemplo.com:443 e http://192.168.0.2:3000")).toEqual(
      [],
    );
    expect(extrairEnderecosLocais("Nada para ver aqui: localhost:5173 sem esquema.")).toEqual([]);
    expect(extrairEnderecosLocais("http://localhost:99999 e http://localhost:5173abc")).toEqual([]);
  });
});
