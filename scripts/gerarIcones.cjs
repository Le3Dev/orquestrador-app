// Gera o ícone do aplicativo desktop: `npm run icones`.
//
// O ícone é o mascote do app, o bixinho "gota" de óculos escuros, na cor
// laranja, em pixel art 16 × 16, sobre um quadrado escuro de cantos
// arredondados. Saídas:
//   - electron/icones/icone.ico: 16, 20, 24, 32, 40, 48, 64, 128 e 256 px, cada
//     tamanho como um PNG embutido (janela, barra de tarefas e instalador no
//     Windows);
//   - electron/icones/icone.png: 512 × 512 (janela fora do Windows).
//
// Só módulos nativos do Node (fs, path, zlib): nada de bibliotecas de imagem.
// Cada célula da grade vira um bloco de e × e pixels, com escala inteira, para
// o desenho ficar nítido em qualquer tamanho; só a borda arredondada do fundo
// tem antialias.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const CELULAS = 16;
const TAMANHOS_DO_ICO = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const TAMANHO_DO_PNG = 512;
const PASTA_DE_SAIDA = path.resolve(__dirname, "..", "electron", "icones");

// Raio dos cantos do fundo, em fração do lado da imagem.
const RAIO_DOS_CANTOS = 0.22;
// Amostras por eixo, por pixel, só para a máscara do arredondado (4 × 4).
const AMOSTRAS_DA_BORDA = 4;

// Cores: as mesmas dos tokens do tema em web/src/theme/index.css.
const CORES = Object.freeze({
  fundo: [0x14, 0x14, 0x13], // --claude-escuro (#141413)
  corpo: [0xd9, 0x77, 0x57], // --claude-laranja (#d97757), .bixinho-cor-laranja
  escuro: [0x14, 0x14, 0x13], // lentes e boca: .bixinho-escuro (--claude-escuro)
  // .bixinho-bochecha: color-mix(--claude-laranja 60%, --claude-claro #faf9f5) = #e6ab96
  bochecha: [0xe6, 0xab, 0x96],
  brilho: [0xfa, 0xf9, 0xf5], // brilho das lentes: --claude-claro (#faf9f5)
});

// O corpo e a boca são copiados de web/src/shared/canvas/sprites.ts
// (CORPOS.gota e a boca e as bochechas de ROSTOS.feliz). Lá é TypeScript do
// front; aqui fica a cópia, que precisa acompanhar o original se o mascote
// mudar. As lentes e o brilho dos óculos escuros são desenho próprio do ícone:
// não vêm de sprites.ts (nem do acessório `oculos` de lá).
//
// CORPOS.gota: 14 linhas que, na grade 16 × 16, começam na linha 2 (as linhas
// 0 e 1 ficam para os acessórios).
const CORPO_GOTA = Object.freeze([
  "................",
  "......####......",
  "....########....",
  "...##########...",
  "..############..",
  "..############..",
  ".##############.",
  ".##############.",
  ".##############.",
  "..############..",
  "...##########...",
  "....##....##....",
  "....##....##....",
  "................",
]);
const LINHAS_DE_ACESSORIO = 2;

// Rosto de óculos escuros: coordenadas [linha, coluna] já na grade 16 × 16
// (antes do deslocamento). Não tem olhos: as lentes ocupam o lugar deles.
//   - bochechas e boca (o sorriso): as mesmas de ROSTOS.feliz em sprites.ts;
//   - lentes: desenho próprio do ícone, dois blocos de 3 × 4 (linhas 6–8,
//     colunas 3–6 e 9–12) unidos pela ponte [6, 7]–[6, 8];
//   - brilho: desenho próprio do ícone, um pixel claro no alto de cada lente.
const COLUNAS_DAS_LENTES = [3, 4, 5, 6, 9, 10, 11, 12];
const ROSTO_DE_OCULOS_ESCUROS = Object.freeze({
  bochechas: [[9, 3], [9, 12]],
  lentes: [
    ...[6, 7, 8].flatMap((linha) => COLUNAS_DAS_LENTES.map((coluna) => [linha, coluna])),
    [6, 7], // ponte
    [6, 8], // ponte
  ],
  brilho: [[7, 4], [7, 10]],
  boca: [[10, 6], [11, 7], [11, 8], [10, 9]],
});

// Sem acessório, o desenho ocupa as linhas 3–14; subir 1 linha deixa-o em
// 2–13, centralizado na vertical (na horizontal já está, colunas 1–14).
const DESLOCAMENTO_VERTICAL = -1;

/**
 * Grade 16 × 16 do bixinho gota de óculos escuros, com o nome da cor de cada
 * célula (`corpo`, `bochecha`, `escuro`, `brilho`) ou `null` onde só aparece o
 * fundo. Ordem de pintura: corpo, bochechas, lentes, brilho, boca.
 */
function gradeDoMascote() {
  const grade = Array.from({ length: CELULAS }, () => new Array(CELULAS).fill(null));
  const pintar = (linha, coluna, cor) => {
    const l = linha + DESLOCAMENTO_VERTICAL;
    if (l < 0 || l >= CELULAS || coluna < 0 || coluna >= CELULAS) {
      throw new Error(`Célula fora da grade: [${linha}, ${coluna}].`);
    }
    grade[l][coluna] = cor;
  };

  CORPO_GOTA.forEach((linha, indice) => {
    [...linha].forEach((celula, coluna) => {
      if (celula === "#") pintar(indice + LINHAS_DE_ACESSORIO, coluna, "corpo");
    });
  });
  for (const [linha, coluna] of ROSTO_DE_OCULOS_ESCUROS.bochechas) pintar(linha, coluna, "bochecha");
  for (const [linha, coluna] of ROSTO_DE_OCULOS_ESCUROS.lentes) pintar(linha, coluna, "escuro");
  for (const [linha, coluna] of ROSTO_DE_OCULOS_ESCUROS.brilho) pintar(linha, coluna, "brilho");
  for (const [linha, coluna] of ROSTO_DE_OCULOS_ESCUROS.boca) pintar(linha, coluna, "escuro");
  return grade;
}

/** Fração (0–1) do pixel [x, y] coberta pelo quadrado arredondado de lado `tamanho`. */
function coberturaDoFundo(x, y, tamanho) {
  const raio = RAIO_DOS_CANTOS * tamanho;
  let dentro = 0;
  for (let sy = 0; sy < AMOSTRAS_DA_BORDA; sy += 1) {
    for (let sx = 0; sx < AMOSTRAS_DA_BORDA; sx += 1) {
      const px = x + (sx + 0.5) / AMOSTRAS_DA_BORDA;
      const py = y + (sy + 0.5) / AMOSTRAS_DA_BORDA;
      // Ponto mais próximo do "miolo" (o quadrado encolhido pelo raio).
      const cx = Math.min(Math.max(px, raio), tamanho - raio);
      const cy = Math.min(Math.max(py, raio), tamanho - raio);
      if ((px - cx) ** 2 + (py - cy) ** 2 <= raio * raio) dentro += 1;
    }
  }
  return dentro / (AMOSTRAS_DA_BORDA * AMOSTRAS_DA_BORDA);
}

/**
 * Pixels RGBA (não pré-multiplicados) do ícone de `tamanho` × `tamanho`.
 * Escala inteira e = floor(tamanho / 16), margem m = (tamanho − 16e) / 2.
 * O fundo arredondado cobre a imagem inteira e recorta também o desenho.
 */
function pixelsDoIcone(tamanho) {
  if (!Number.isInteger(tamanho) || tamanho < CELULAS) {
    throw new Error(`Tamanho inválido para o ícone: ${tamanho} (inteiro, a partir de ${CELULAS}).`);
  }
  const grade = gradeDoMascote();
  const escala = Math.floor(tamanho / CELULAS);
  const margem = Math.floor((tamanho - CELULAS * escala) / 2);
  const lado = CELULAS * escala;
  const rgba = Buffer.alloc(tamanho * tamanho * 4);

  for (let y = 0; y < tamanho; y += 1) {
    for (let x = 0; x < tamanho; x += 1) {
      let cor = CORES.fundo;
      const gx = x - margem;
      const gy = y - margem;
      if (gx >= 0 && gy >= 0 && gx < lado && gy < lado) {
        const celula = grade[Math.floor(gy / escala)][Math.floor(gx / escala)];
        if (celula) cor = CORES[celula];
      }
      const i = (y * tamanho + x) * 4;
      rgba[i] = cor[0];
      rgba[i + 1] = cor[1];
      rgba[i + 2] = cor[2];
      rgba[i + 3] = Math.round(255 * coberturaDoFundo(x, y, tamanho));
    }
  }
  return rgba;
}

// CRC-32 (polinômio 0xEDB88320), o mesmo do PNG; sem depender do zlib.crc32.
const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(dados) {
  let c = 0xffffffff;
  for (const byte of dados) c = TABELA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function blocoPng(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const tipoEDados = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tipoEDados), 0);
  return Buffer.concat([tamanho, tipoEDados, crc]);
}

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG RGBA de 8 bits (color type 6), filtro 0 em todas as linhas. */
function gerarPng(largura, altura, rgba) {
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura < 1 || altura < 1) {
    throw new Error(`Dimensões inválidas para o PNG: ${largura} × ${altura}.`);
  }
  if (rgba.length !== largura * altura * 4) {
    throw new Error(`Esperados ${largura * altura * 4} bytes RGBA para ${largura} × ${altura}; vieram ${rgba.length}.`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compressão deflate
  ihdr[11] = 0; // filtro adaptativo (método 0)
  ihdr[12] = 0; // sem entrelaçamento

  const bytesPorLinha = largura * 4;
  const cru = Buffer.alloc((bytesPorLinha + 1) * altura);
  for (let y = 0; y < altura; y += 1) {
    const destino = y * (bytesPorLinha + 1);
    cru[destino] = 0; // filtro "None"
    rgba.copy(cru, destino + 1, y * bytesPorLinha, (y + 1) * bytesPorLinha);
  }

  return Buffer.concat([
    ASSINATURA_PNG,
    blocoPng("IHDR", ihdr),
    blocoPng("IDAT", zlib.deflateSync(cru, { level: 9 })),
    blocoPng("IEND", Buffer.alloc(0)),
  ]);
}

/** Largura e altura lidas do IHDR de um PNG. */
function dimensoesDoPng(png) {
  if (png.length < 24 || !png.subarray(0, 8).equals(ASSINATURA_PNG) || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("O conteúdo não é um PNG válido.");
  }
  return { largura: png.readUInt32BE(16), altura: png.readUInt32BE(20) };
}

/**
 * Arquivo .ico com cada PNG embutido como está (formato aceito desde o
 * Windows Vista). Tamanho 256 vira 0 na entrada, como manda o formato.
 */
function gerarIco(pngs) {
  if (!Array.isArray(pngs) || pngs.length === 0) {
    throw new Error("O .ico precisa de pelo menos um PNG.");
  }
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // tipo 1 = ícone
  cabecalho.writeUInt16LE(pngs.length, 4);

  const entradas = [];
  let deslocamento = 6 + 16 * pngs.length;
  for (const png of pngs) {
    const { largura, altura } = dimensoesDoPng(png);
    if (largura > 256 || altura > 256) {
      throw new Error(`O .ico aceita no máximo 256 × 256; veio ${largura} × ${altura}.`);
    }
    const entrada = Buffer.alloc(16);
    entrada[0] = largura === 256 ? 0 : largura;
    entrada[1] = altura === 256 ? 0 : altura;
    entrada[2] = 0; // sem paleta
    entrada[3] = 0; // reservado
    entrada.writeUInt16LE(1, 4); // planes
    entrada.writeUInt16LE(32, 6); // bitCount
    entrada.writeUInt32LE(png.length, 8);
    entrada.writeUInt32LE(deslocamento, 12);
    entradas.push(entrada);
    deslocamento += png.length;
  }
  return Buffer.concat([cabecalho, ...entradas, ...pngs]);
}

function pngDoIcone(tamanho) {
  return gerarPng(tamanho, tamanho, pixelsDoIcone(tamanho));
}

function gravarIcones(pasta = PASTA_DE_SAIDA) {
  fs.mkdirSync(pasta, { recursive: true });
  const ico = gerarIco(TAMANHOS_DO_ICO.map(pngDoIcone));
  const png = pngDoIcone(TAMANHO_DO_PNG);
  const caminhoDoIco = path.join(pasta, "icone.ico");
  const caminhoDoPng = path.join(pasta, "icone.png");
  fs.writeFileSync(caminhoDoIco, ico);
  fs.writeFileSync(caminhoDoPng, png);
  return [
    { caminho: caminhoDoIco, bytes: ico.length },
    { caminho: caminhoDoPng, bytes: png.length },
  ];
}

module.exports = {
  CORES,
  TAMANHOS_DO_ICO,
  TAMANHO_DO_PNG,
  crc32,
  dimensoesDoPng,
  gerarIco,
  gerarPng,
  gradeDoMascote,
  gravarIcones,
  pixelsDoIcone,
};

if (require.main === module) {
  try {
    for (const { caminho, bytes } of gravarIcones()) {
      console.log(`[icones] ${path.relative(process.cwd(), caminho)} (${bytes} bytes)`);
    }
    console.log(`[icones] tamanhos no .ico: ${TAMANHOS_DO_ICO.join(", ")}`);
  } catch (erro) {
    console.error(`[icones] Não foi possível gerar os ícones: ${erro && erro.message ? erro.message : erro}`);
    process.exitCode = 1;
  }
}
