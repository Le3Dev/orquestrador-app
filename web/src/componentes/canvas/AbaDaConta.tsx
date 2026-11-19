import type { JanelaDaCota } from "../../shared/api/tipos";
import { descreverRenovacao } from "../../shared/formatacao";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeConfiguracoes } from "../../shared/idioma/textos/configuracoes";
import { COTA_ALTA } from "./PopoverDoUso";
import { nomeLegivelDaCota } from "./usoDoSistema";

function LinhaDaCota({ janela, agora }: { janela: JanelaDaCota; agora: Date }) {
  const t = useTextos(textosDeConfiguracoes).conta;
  const percentual = Math.min(100, Math.max(0, Math.round(janela.utilizacao * 100)));
  const nome = nomeLegivelDaCota(janela.nome);
  const renovacao = janela.renovaEm === null ? t.semHorario : descreverRenovacao(janela.renovaEm, agora);
  const alta = janela.utilizacao >= COTA_ALTA;
  return (
    <div className="cfgapp-linha">
      <div className="cfgapp-linha-texto" title={janela.nome}>
        <b>{nome}</b>
        <span
          className={`cfgapp-barra ${alta ? "cfgapp-barra-alta" : ""}`}
          role="meter"
          aria-label={nome}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentual}
          aria-valuetext={t.usada(percentual)}
        >
          <i style={{ width: `${percentual}%` }} />
        </span>
        <span>
          {t.usada(percentual)} · {janela.situacao === "rejected" && <em className="cfgapp-no-limite">{t.noLimite} · </em>}
          {renovacao}
        </span>
      </div>
    </div>
  );
}

interface Props {
  /** As janelas da cota do Claude; nulo até o primeiro pedido. */
  cota: JanelaDaCota[] | null;
  /** Hora de referência da renovação (os testes fixam). */
  agora?: Date;
}

/**
 * A aba Conta: o uso de cada janela da cota do Claude (sessão, semana e as por
 * modelo), com barra, percentual e quando renova. O app não tem e-mail, plano
 * nem troca de conta: só o que o servidor lê do Claude.
 */
export function AbaDaConta({ cota, agora = new Date() }: Props) {
  const t = useTextos(textosDeConfiguracoes).conta;
  if (cota === null || cota.length === 0) {
    return (
      <div className="cfgapp-cartao">
        <div className="cfgapp-linha">
          <div className="cfgapp-linha-texto">
            <b>{t.cotaTitulo}</b>
            <span>{t.cotaVazia}</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="cfgapp-cartao" data-testid="cotas-da-conta">
      {cota.map((janela) => (
        <LinhaDaCota key={janela.nome} janela={janela} agora={agora} />
      ))}
    </div>
  );
}
