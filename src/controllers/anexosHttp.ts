import { Response } from "express";
import { z } from "zod";

import { MAXIMO_DE_ANEXOS_POR_MENSAGEM, TAMANHO_MAXIMO_DO_DOCUMENTO } from "../orquestracao/Anexo";

/** Nome de arquivo de imagem guardada (`<id>.<ext>`): só estas vão inline; o resto é sempre baixado. */
const ARQUIVO_DE_IMAGEM = /\.(png|jpg|gif|webp)$/;

const TAMANHO_MAXIMO_DO_NOME = 200;

/**
 * Os arquivos que acompanham uma mensagem, com o conteúdo em base64: o mesmo
 * formato no chat rápido e nos Orquestradores. O tipo pode vir vazio (o
 * navegador não sabe o de .md ou .csv); a categoria, o formato aceito e os
 * limites de tamanho e de quantidade ficam com o domínio (`Anexo`).
 */
export const esquemaDosAnexosDaMensagem = z
  .array(
    z.object({
      nome: z.string().max(TAMANHO_MAXIMO_DO_NOME, {
        error: `O nome de um arquivo deve ter até ${TAMANHO_MAXIMO_DO_NOME} caracteres.`,
      }),
      tipoDeMidia: z.string().max(200).default(""),
      // Base64 ocupa 4/3 do tamanho original; o teto por tipo (imagem x documento) é do domínio.
      base64: z.string().max(Math.ceil((TAMANHO_MAXIMO_DO_DOCUMENTO * 4) / 3) + 16, {
        error: `Cada arquivo pode ter até ${TAMANHO_MAXIMO_DO_DOCUMENTO / 1024 / 1024} MB.`,
      }),
    }),
  )
  .max(MAXIMO_DE_ANEXOS_POR_MENSAGEM, {
    error: `Anexe até ${MAXIMO_DE_ANEXOS_POR_MENSAGEM} arquivos por mensagem.`,
  })
  .default([]);

/**
 * Devolve um anexo guardado. Imagem segue inline (as miniaturas da tela).
 * Documento é sempre baixado, nunca mostrado: um HTML anexado não pode ser
 * renderizado no app, então a resposta é um download opaco (`attachment` sem
 * nome — a tela escolhe o nome original —, `octet-stream`, sem adivinhar o tipo
 * e com `sandbox` por garantia).
 *
 * Se o arquivo não existe, responde 404 com a mensagem de sempre.
 */
export function enviarAnexo(resposta: Response, arquivo: string, caminho: string): void {
  const aoTerminar = (erro: Error | undefined): void => {
    if (erro !== undefined && !resposta.headersSent) {
      resposta.status(404).json({ erro: "Anexo não encontrado." });
    }
  };
  if (ARQUIVO_DE_IMAGEM.test(arquivo)) {
    resposta.sendFile(caminho, { maxAge: "1d" }, aoTerminar);
    return;
  }
  resposta.sendFile(
    caminho,
    {
      maxAge: "1d",
      headers: {
        "Content-Disposition": "attachment",
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    },
    aoTerminar,
  );
}
