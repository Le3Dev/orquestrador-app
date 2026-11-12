import { ChaveDeLicenca } from './ChaveDeLicenca';
import type { SituacaoDaAssinatura } from './DadosDaAssinatura';
import { Licenca, Maquina } from './Licenca';
import type { Plano } from './Plano';
import type { RepositorioDeEventosProcessados, RepositorioDeLicencas } from './RepositorioDeLicencas';

interface LinhaDaLicenca {
  id: string;
  chave: string;
  id_da_assinatura: string;
  id_do_cliente: string;
  email: string;
  plano: Plano;
  situacao: SituacaoDaAssinatura;
  paga_ate: number;
  criada_em: number;
}

interface LinhaDaMaquina {
  maquina_id: string;
  nome: string;
  ativada_em: number;
}

const COLUNAS =
  'id, chave, id_da_assinatura, id_do_cliente, email, plano, situacao, paga_ate, criada_em';

/** Adaptador D1 (SQLite) do repositorio de licencas. */
export class RepositorioDeLicencasD1 implements RepositorioDeLicencas {
  constructor(private readonly banco: D1Database) {}

  buscarPorChave(chave: ChaveDeLicenca): Promise<Licenca | null> {
    return this.buscar('chave', chave.valor);
  }

  buscarPorIdDaAssinatura(idDaAssinatura: string): Promise<Licenca | null> {
    return this.buscar('id_da_assinatura', idDaAssinatura);
  }

  async salvar(l: Licenca): Promise<void> {
    const comandos = [
      this.banco
        .prepare(
          `INSERT INTO licencas (${COLUNAS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             id_do_cliente = excluded.id_do_cliente, email = excluded.email, plano = excluded.plano,
             situacao = excluded.situacao, paga_ate = excluded.paga_ate`,
        )
        .bind(l.id, l.chave.valor, l.idDaAssinatura, l.idDoCliente, l.email, l.plano, l.situacao, l.pagaAte, l.criadaEm),
      this.banco.prepare('DELETE FROM maquinas WHERE licenca_id = ?').bind(l.id),
      ...l.maquinas.map((m) =>
        this.banco
          .prepare('INSERT INTO maquinas (licenca_id, maquina_id, nome, ativada_em) VALUES (?, ?, ?, ?)')
          .bind(l.id, m.id, m.nome, m.ativadaEm),
      ),
    ];
    // batch do D1 e transacional (tudo ou nada).
    await this.banco.batch(comandos);
  }

  // `coluna` vem sempre de constantes internas, nunca de entrada do usuario.
  private async buscar(coluna: 'chave' | 'id_da_assinatura', valor: string): Promise<Licenca | null> {
    const linha = await this.banco
      .prepare(`SELECT ${COLUNAS} FROM licencas WHERE ${coluna} = ?`)
      .bind(valor)
      .first<LinhaDaLicenca>();
    if (!linha) return null;
    const { results } = await this.banco
      .prepare('SELECT maquina_id, nome, ativada_em FROM maquinas WHERE licenca_id = ? ORDER BY ativada_em')
      .bind(linha.id)
      .all<LinhaDaMaquina>();
    return Licenca.reconstituir({
      id: linha.id,
      chave: ChaveDeLicenca.reconstituir(linha.chave),
      idDaAssinatura: linha.id_da_assinatura,
      idDoCliente: linha.id_do_cliente,
      email: linha.email,
      plano: linha.plano,
      situacao: linha.situacao,
      pagaAte: linha.paga_ate,
      criadaEm: linha.criada_em,
      maquinas: results.map((m) => new Maquina(m.maquina_id, m.nome, m.ativada_em)),
    });
  }
}

export class RepositorioDeEventosD1 implements RepositorioDeEventosProcessados {
  constructor(private readonly banco: D1Database) {}

  async jaProcessado(idDoEvento: string): Promise<boolean> {
    const linha = await this.banco
      .prepare('SELECT 1 AS existe FROM eventos_processados WHERE id = ?')
      .bind(idDoEvento)
      .first<{ existe: number }>();
    return linha !== null;
  }

  async registrar(idDoEvento: string, quando: number): Promise<void> {
    await this.banco
      .prepare('INSERT OR IGNORE INTO eventos_processados (id, processado_em) VALUES (?, ?)')
      .bind(idDoEvento, quando)
      .run();
  }
}