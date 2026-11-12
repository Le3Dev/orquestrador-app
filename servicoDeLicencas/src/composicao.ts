import type { Ambiente } from './ambiente';
import { EnviadorDeEmailResend } from './email/EnviadorDeEmailResend';
import { criarManipulador } from './http/roteador';
import { EmissorDeTokens } from './licencas/EmissorDeTokens';
import { CARENCIA_DE_PAGAMENTO_EM_MS } from './licencas/Licenca';
import { RepositorioDeEventosD1, RepositorioDeLicencasD1 } from './licencas/RepositorioD1';
import { ServicoDeLicencas } from './licencas/ServicoDeLicencas';
import { AdaptadorDeEventosDoStripe } from './stripe/AdaptadorDeEventosDoStripe';
import { FachadaDoStripeSdk } from './stripe/FachadaDoStripe';
import { ServicoDeCobranca } from './stripe/ServicoDeCobranca';

const emissores = new Map<string, Promise<EmissorDeTokens>>();

function emissorDe(pem: string): Promise<EmissorDeTokens> {
  let emissor = emissores.get(pem);
  if (!emissor) {
    emissor = EmissorDeTokens.aPartirDoPem(pem, CARENCIA_DE_PAGAMENTO_EM_MS);
    emissores.set(pem, emissor);
  }
  return emissor;
}

export async function montarManipulador(env: Ambiente): Promise<(pedido: Request) => Promise<Response>> {
  const maximo = Number.parseInt(env.MAXIMO_DE_MAQUINAS ?? '1', 10);
  const agora = (): number => Date.now();
  const repositorio = new RepositorioDeLicencasD1(env.BANCO);
  const licencas = new ServicoDeLicencas({
    repositorio,
    emissor: await emissorDe(env.CHAVE_PRIVADA_DA_LICENCA),
    enviadorDeEmail: new EnviadorDeEmailResend(env.RESEND_API_KEY, env.EMAIL_REMETENTE),
    maximoDeMaquinas: Number.isInteger(maximo) && maximo > 0 ? maximo : 1,
    urlDeDownload: env.URL_DE_DOWNLOAD,
    urlDoPortal: env.URL_DO_PORTAL_DO_CLIENTE,
    agora,
  });
  const fachada = new FachadaDoStripeSdk(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  const cobranca = new ServicoDeCobranca({
    fachada,
    adaptador: new AdaptadorDeEventosDoStripe(fachada, { mensal: env.PRECO_MENSAL_ID, anual: env.PRECO_ANUAL_ID }),
    licencas,
    eventos: new RepositorioDeEventosD1(env.BANCO),
    agora,
  });
  return criarManipulador({ licencas, cobranca, urlDaLanding: env.URL_DA_LANDING });
}