import { Response } from "express";
import { z } from "zod";

import {
  categoriaDoTipo,
  MENSAGEM_DE_TIPO_NAO_ACEITO,
  TAMANHO_MAXIMO_DO_DOCUMENTO,
  tipoPelaExtensao,
} from "../orquestracao/Anexo";

/**
 * Um anexo no corpo do POST de mensagem, em base64. O campo `tipoDeMidia` é o
 * que o navegador informou (pode vir vazio em .md e .csv): quem decide o tipo
 * final é `Anexo.de`, pelo tipo e pela extensão do nome. O limite por
 * categoria (5 MB por imagem, 30 MB por documento) é conferido lá também; aqui
 * só se barra o que passa do maior limite.
 */
export const esquemaDoAnexoRecebido = z.object({
  nome: z.string().max(200),
  tipoDeMidia: z.string({ error: MENSAGEM_DE_TIPO_NAO_ACEITO }).max(200).default(""),
  // Base64 ocupa 4/3 do tamanho original.
  base64: z.string().max(Math.ceil((TAMANHO_MAXIMO_DO_DOCUMENTO * 4) / 3) + 16, {
    error: `Cada documento pode ter até ${TAMANHO_MAXIMO_DO_DOCUMENTO / 1024 / 1024} MB.`,
  }),
});

/** O que o corpo do POST pode carregar: o máximo de imagens e documentos da mensagem, em base64. */
export const LIMITE_DO_CORPO_JSON = "240mb";

const NOMES_NO_DISCO = /^[0-9a-zA-Z-]{1,64}(\.texto)?\.[a-z]{2,4}$/;

/**
 * Envia um anexo guardado. Imagens seguem inline (miniaturas); documentos e
 * textos extraídos vão sempre como download (`attachment`), nunca renderizados
 * pelo navegador. `nosniff` em todos: o tipo é o declarado aqui, não o adivinhado.
 */
export function enviarAnexo(resposta: Response, arquivo: string, caminho: string): void {
  const textoExtraido = arquivo.includes(".texto.");
  const tipo = textoExtraido ? "text/plain" : tipoPelaExtensao(arquivo);
  if (tipo === null || !NOMES_NO_DISCO.test(arquivo)) {
    resposta.status(404).json({ erro: "Anexo não encontrado." });
    return;
  }
  const imagem = !textoExtraido && categoriaDoTipo(tipo) === "imagem";
  const tipoDoConteudo = tipo.startsWith("text/") ? `${tipo}; charset=utf-8` : tipo;
  resposta.sendFile(
    caminho,
    {
      maxAge: "1d",
      headers: {
        "Content-Type": tipoDoConteudo,
        "Content-Disposition": `${imagem ? "inline" : "attachment"}; filename="${arquivo}"`,
        "X-Content-Type-Options": "nosniff",
      },
    },
    (erro) => {
      if (erro !== undefined && !resposta.headersSent) {
        resposta.status(404).json({ erro: "Anexo não encontrado." });
      }
    },
  );
}
