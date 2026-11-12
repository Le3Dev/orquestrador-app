import type { Plano } from './Plano';

export const VALIDADE_MAXIMA_DO_TOKEN_EM_MS = 7 * 24 * 60 * 60 * 1000;

export interface DadosDoToken {
  readonly licencaId: string;
  readonly maquinaId: string;
  readonly plano: Plano;
  readonly pagaAte: number;
}

function paraBase64Url(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemParaDer(pem: string): Uint8Array {
  const base64 = pem.replace(/-----(BEGIN|END)[^-]*-----/g, '').replace(/\s+/g, '');
  const binario = atob(base64);
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

/** Emite o token (JWS compacto, EdDSA/Ed25519) preso a uma maquina. */
export class EmissorDeTokens {
  private constructor(
    private readonly chavePrivada: CryptoKey,
    private readonly carenciaEmMs: number,
  ) {}

  static async aPartirDoPem(pkcs8Pem: string, carenciaEmMs: number): Promise<EmissorDeTokens> {
    try {
      const chave = await crypto.subtle.importKey(
        'pkcs8',
        pemParaDer(pkcs8Pem),
        { name: 'Ed25519' },
        false,
        ['sign'],
      );
      return new EmissorDeTokens(chave, carenciaEmMs);
    } catch (erro) {
      throw new Error(
        `Chave privada da licença inválida (esperado PKCS8 PEM Ed25519): ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }

  async emitir(dados: DadosDoToken, emitidoEm: number): Promise<string> {
    const expiraEm = Math.min(dados.pagaAte + this.carenciaEmMs, emitidoEm + VALIDADE_MAXIMA_DO_TOKEN_EM_MS);
    const codificador = new TextEncoder();
    const cabecalho = paraBase64Url(codificador.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));
    const carga = paraBase64Url(
      codificador.encode(
        JSON.stringify({
          v: 1,
          licenca: dados.licencaId,
          maquina: dados.maquinaId,
          plano: dados.plano,
          pagaAte: dados.pagaAte,
          emitidoEm,
          expiraEm,
        }),
      ),
    );
    const assinatura = await crypto.subtle.sign(
      { name: 'Ed25519' },
      this.chavePrivada,
      codificador.encode(`${cabecalho}.${carga}`),
    );
    return `${cabecalho}.${carga}.${paraBase64Url(new Uint8Array(assinatura))}`;
  }
}