import {
  calcularRetangulo,
  dominioRegistravel,
  ehEnderecoLocal,
  ehHostLocal,
  hostDaOrigem,
  LADO_MINIMO_DA_VISTA_PX,
  mesmoRetangulo,
  modoDaPrevia,
  mudouDeDominio,
  pontosDeAmostra,
} from "./previaNativa";

describe("ehHostLocal", () => {
  it.each([
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.0.1",
    "192.168.0.5",
    "169.254.0.1",
    "[::1]",
    "fd12::1",
    "fe80::1",
    "servidor.local",
    // As mesmas entradas do teste de electron/vistaDaPrevia.test.js: as duas regras têm de ser iguais.
    "::",
    "::ffff:7f00:1",
    "",
    "intranet",
    "servidor.lan",
    "wiki.internal",
    "ad.corp",
    "roteador.home.arpa",
    "home.arpa",
    "100.64.0.1",
    "100.127.255.254",
    "192.0.0.8",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::7f00:1",
    "::1.2.3.4",
    "[::a00:1]",
    "64:ff9b::7f00:1",
    "64:ff9b::a00:5",
    "64:ff9b::192.168.1.1",
    "2002:7f00:1::",
    "2002:c0a8:101::1",
    "2002:a00:1::",
    "ff02::1",
    "1:2:3:4:5:6:7:8:9",
  ])("%s é local", (host) => {
    expect(ehHostLocal(host)).toBe(true);
  });

  it.each([
    "docs.google.com",
    "notion.so",
    "github.com",
    "8.8.8.8",
    "172.32.0.1",
    "172.15.0.1",
    "192.169.1.1",
    "2606:4700::1111",
    "100.63.255.255",
    "100.128.0.1",
    "192.0.1.1",
    "223.255.255.255",
    "64:ff9b::808:808",
    "2002:808:808::1",
    "2001:4860:4860::8888",
    "lan.exemplo.com",
    "corp.exemplo.com",
  ])("%s não é local", (host) => {
    expect(ehHostLocal(host)).toBe(false);
  });
});

describe("dominioRegistravel, hostDaOrigem e mudouDeDominio", () => {
  it("dominioRegistravel pega os dois últimos rótulos, ou três em TLD de país", () => {
    expect(dominioRegistravel("docs.google.com")).toBe("google.com");
    expect(dominioRegistravel("github.com")).toBe("github.com");
    expect(dominioRegistravel("www.exemplo.com.br")).toBe("exemplo.com.br");
    expect(dominioRegistravel("a.b.exemplo.co.uk")).toBe("exemplo.co.uk");
    expect(dominioRegistravel("8.8.8.8")).toBe("8.8.8.8");
    expect(dominioRegistravel("localhost")).toBe("localhost");
  });

  it("hostDaOrigem devolve o host (com porta) só de origem http/https", () => {
    expect(hostDaOrigem("https://accounts.google.com")).toBe("accounts.google.com");
    expect(hostDaOrigem("http://exemplo.com:8080")).toBe("exemplo.com:8080");
    expect(hostDaOrigem(null)).toBeNull();
    expect(hostDaOrigem("javascript:alert(1)")).toBeNull();
    expect(hostDaOrigem("lixo")).toBeNull();
  });

  it("mudouDeDominio destaca só quando o domínio registrável muda", () => {
    expect(mudouDeDominio("https://docs.google.com/spreadsheets", "https://accounts.google.com")).toBe(false);
    expect(mudouDeDominio("https://github.com", "https://github.com")).toBe(false);
    expect(mudouDeDominio("https://www.notion.so/x", "https://notion.so")).toBe(false);
    expect(mudouDeDominio("https://www.notion.so/x", "https://accounts.google.com")).toBe(true);
    expect(mudouDeDominio("https://github.com", "https://github.io")).toBe(true);
    expect(mudouDeDominio("https://github.com", "http://github.com.atacante.net:8080")).toBe(true);
    expect(mudouDeDominio("https://github.com", null)).toBe(false);
    expect(mudouDeDominio("lixo", "https://github.com")).toBe(false);
  });
});

describe("modoDaPrevia", () => {
  it.each([
    "http://localhost:5173",
    "https://localhost:3000/app",
    "http://127.0.0.1:8080",
    "http://0.0.0.0:3000",
    "http://[::1]:4321",
    "http://192.168.0.10:5173",
    "http://10.0.0.2:3000/x",
  ])("%s segue no iframe, com ou sem app desktop", (url) => {
    expect(modoDaPrevia(url, true)).toBe("iframe");
    expect(modoDaPrevia(url, false)).toBe("iframe");
  });

  it("endereço vazio ou que não é URL fica no iframe (a mensagem de digitar o endereço é a mesma)", () => {
    expect(modoDaPrevia("", true)).toBe("iframe");
    expect(modoDaPrevia("isso não é url", true)).toBe("iframe");
  });

  it.each([
    "https://docs.google.com/spreadsheets/d/abc/edit",
    "https://www.notion.so/pagina",
    "https://github.com",
    "http://exemplo.com.br",
  ])("%s: vista nativa no app desktop, nova aba no navegador", (url) => {
    expect(modoDaPrevia(url, true)).toBe("vista-nativa");
    expect(modoDaPrevia(url, false)).toBe("nova-aba");
  });
});

describe("ehEnderecoLocal", () => {
  it("só a máquina e a rede interna", () => {
    expect(ehEnderecoLocal("http://localhost:1")).toBe(true);
    expect(ehEnderecoLocal("https://notion.so")).toBe(false);
  });
});

describe("calcularRetangulo", () => {
  const area = { left: 0, top: 40, width: 1440, height: 860 };

  it("sem escala: o retângulo do corpo e zoom 1", () => {
    const corpo = { left: 100, top: 200, width: 700, height: 480 };
    expect(calcularRetangulo(corpo, area, 700)).toEqual({ x: 100, y: 200, largura: 700, altura: 480, zoom: 1 });
  });

  it("com zoom do canvas: o zoom é a razão entre a largura na tela e a do layout", () => {
    const corpo = { left: 100, top: 200, width: 350, height: 240 };
    expect(calcularRetangulo(corpo, area, 700)?.zoom).toBe(0.5);
    const grande = { left: 0, top: 100, width: 1400, height: 480 };
    expect(calcularRetangulo(grande, area, 700)?.zoom).toBe(2);
  });

  it("acompanha o pan: o mesmo corpo deslocado dá o retângulo deslocado", () => {
    const antes = calcularRetangulo({ left: 100, top: 200, width: 700, height: 480 }, area, 700);
    const depois = calcularRetangulo({ left: 160, top: 150, width: 700, height: 480 }, area, 700);
    expect(depois).toMatchObject({ x: 160, y: 150, largura: antes?.largura, altura: antes?.altura });
  });

  it("corta o que sai da área do canvas (cabeçalho, bordas) e mantém o zoom do corpo inteiro", () => {
    const corpo = { left: -100, top: 0, width: 700, height: 480 };
    const resultado = calcularRetangulo(corpo, area, 700);
    expect(resultado).toEqual({ x: 0, y: 40, largura: 600, altura: 440, zoom: 1 });
    const direita = calcularRetangulo({ left: 1200, top: 300, width: 700, height: 480 }, area, 700);
    expect(direita).toMatchObject({ x: 1200, largura: 240 });
  });

  it("nulo quando o corpo não está na tela: minimizado, escondido ou fora da área", () => {
    expect(calcularRetangulo({ left: 0, top: 0, width: 0, height: 0 }, area, 0)).toBeNull();
    expect(calcularRetangulo({ left: 100, top: 100, width: 700, height: 480 }, area, 0)).toBeNull();
    expect(calcularRetangulo({ left: 2000, top: 100, width: 700, height: 480 }, area, 700)).toBeNull();
    expect(calcularRetangulo({ left: 100, top: -600, width: 700, height: 480 }, area, 700)).toBeNull();
  });

  it("nulo quando sobra menos que o lado mínimo", () => {
    const quaseFora = { left: 1440 - (LADO_MINIMO_DA_VISTA_PX - 1), top: 100, width: 700, height: 480 };
    expect(calcularRetangulo(quaseFora, area, 700)).toBeNull();
    const justo = { left: 1440 - LADO_MINIMO_DA_VISTA_PX, top: 100, width: 700, height: 480 };
    expect(calcularRetangulo(justo, area, 700)).not.toBeNull();
  });
});

describe("pontosDeAmostra", () => {
  it("nove pontos dentro do retângulo: cantos, meios e centro", () => {
    const pontos = pontosDeAmostra({ x: 100, y: 200, largura: 400, altura: 300, zoom: 1 });
    expect(pontos).toHaveLength(9);
    for (const { x, y } of pontos) {
      expect(x).toBeGreaterThan(100);
      expect(x).toBeLessThan(500);
      expect(y).toBeGreaterThan(200);
      expect(y).toBeLessThan(500);
    }
    expect(pontos[4]).toEqual({ x: 300, y: 350 });
  });
});

describe("mesmoRetangulo", () => {
  const base = { x: 10, y: 10, largura: 300, altura: 200, zoom: 1 };

  it("ignora diferenças abaixo de meio pixel", () => {
    expect(mesmoRetangulo(base, { ...base, x: 10.3 })).toBe(true);
    expect(mesmoRetangulo(base, { ...base, x: 11 })).toBe(false);
    expect(mesmoRetangulo(base, { ...base, zoom: 1.01 })).toBe(false);
  });

  it("nulos", () => {
    expect(mesmoRetangulo(null, null)).toBe(true);
    expect(mesmoRetangulo(base, null)).toBe(false);
  });
});
