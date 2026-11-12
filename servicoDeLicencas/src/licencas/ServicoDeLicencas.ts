import type { EnviadorDeEmail } from '../email/EnviadorDeEmail';
import { mensagemDaChave } from '../email/mensagemDaChave';
import type { DadosDaAssinatura } from './DadosDaAssinatura';
import { ChaveDeLicenca } from './ChaveDeLicenca';
import type { EmissorDeTokens } from './EmissorDeTokens';
import { ErroDeLicenca } from './ErroDeLicenca';
import { Licenca, Maquina } from './Licenca';
import type { RepositorioDeLicencas } from './RepositorioDeLicencas';

export interface DependenciasDoServicoDeLicencas {
  readonly repositorio: RepositorioDeLicencas;
  readonly emissor: EmissorDeTokens;
  readonly enviadorDeEmail: EnviadorDeEmail;
  readonly maximoDeMaquinas: number;
  readonly urlDeDownload: string;
  readonly urlDoPortal: string;
  readonly agora: () => number;
}

export interface ResultadoDaSincronizacao {
  readonly licenca: Licenca;
  readonly criada: boolean;
}

/** Servico de dominio sem estado proprio: so orquestra o agregado Licenca. */
export class ServicoDeLicencas {
  constructor(private readonly d: DependenciasDoServicoDeLicencas) {}

  async ativar(chaveTexto: string, maquina: { id: string; nome: string }): Promise<string> {
    const licenca = await this.obterLicencaAtiva(chaveTexto);
    const agora = this.d.agora();
    const atualizada = licenca.ativarMaquina(new Maquina(maquina.id, maquina.nome, agora), this.d.maximoDeMaquinas);
    if (atualizada !== licenca) await this.d.repositorio.salvar(atualizada);
    return this.emitirToken(atualizada, maquina.id, agora);
  }

  async validar(chaveTexto: string, maquinaId: string): Promise<string> {
    const licenca = await this.obterLicencaAtiva(chaveTexto);
    if (!licenca.possuiMaquina(maquinaId)) throw new ErroDeLicenca('maquina-nao-ativada');
    return this.emitirToken(licenca, maquinaId, this.d.agora());
  }

  async desativar(chaveTexto: string, maquinaId: string): Promise<void> {
    const licenca = await this.obterLicenca(chaveTexto);
    const atualizada = licenca.desativarMaquina(maquinaId);
    if (atualizada !== licenca) await this.d.repositorio.salvar(atualizada);
  }

  buscarPorIdDaAssinatura(idDaAssinatura: string): Promise<Licenca | null> {
    return this.d.repositorio.buscarPorIdDaAssinatura(idDaAssinatura);
  }

  /**
   * Aplica o retrato da assinatura. Cria a licenca (e envia a chave por e-mail) so se
   * `email` for informado e ainda nao existir licenca para a assinatura.
   * Sem licenca e sem e-mail: nada a fazer (devolve null).
   */
  async sincronizarAssinatura(
    assinatura: DadosDaAssinatura,
    email: string | null,
  ): Promise<ResultadoDaSincronizacao | null> {
    const existente = await this.d.repositorio.buscarPorIdDaAssinatura(assinatura.idDaAssinatura);
    if (existente) {
      const atualizada = existente.atualizarAssinatura(assinatura);
      await this.d.repositorio.salvar(atualizada);
      return { licenca: atualizada, criada: false };
    }
    if (!email) return null;

    const nova = Licenca.emitir({
      id: crypto.randomUUID(),
      chave: ChaveDeLicenca.gerar(),
      email,
      assinatura,
      agora: this.d.agora(),
    });
    await this.d.repositorio.salvar(nova);
    await this.enviarChave(nova);
    return { licenca: nova, criada: true };
  }

  private async enviarChave(licenca: Licenca): Promise<void> {
    try {
      await this.d.enviadorDeEmail.enviar(
        mensagemDaChave({
          para: licenca.email,
          chave: licenca.chave.valor,
          plano: licenca.plano,
          urlDeDownload: this.d.urlDeDownload,
          urlDoPortal: this.d.urlDoPortal,
        }),
      );
    } catch (erro) {
      // Nao pode falhar a compra: o cliente ainda ve a chave na pagina de sucesso.
      console.error(`[email] Falha ao enviar a chave: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  private async obterLicenca(chaveTexto: string): Promise<Licenca> {
    const chave = ChaveDeLicenca.interpretar(chaveTexto);
    const licenca = chave ? await this.d.repositorio.buscarPorChave(chave) : null;
    if (!licenca) throw new ErroDeLicenca('chave-invalida');
    return licenca;
  }

  private async obterLicencaAtiva(chaveTexto: string): Promise<Licenca> {
    const licenca = await this.obterLicenca(chaveTexto);
    if (!licenca.estaAtiva(this.d.agora())) throw new ErroDeLicenca('assinatura-inativa');
    return licenca;
  }

  private emitirToken(licenca: Licenca, maquinaId: string, agora: number): Promise<string> {
    return this.d.emissor.emitir(
      { licencaId: licenca.id, maquinaId, plano: licenca.plano, pagaAte: licenca.pagaAte },
      agora,
    );
  }
}