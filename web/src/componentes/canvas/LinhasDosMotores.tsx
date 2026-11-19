import type { DadosDaConfiguracao, EsforcosHerdados, Motor } from "../../shared/api/tipos";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeConfiguracoes } from "../../shared/idioma/textos/configuracoes";
import { textosDeNosDoCanvas } from "../../shared/idioma/textos/nosDoCanvas";
import {
  avisoDoMotor,
  motivoDoMotorIndisponivel,
  type SituacaoDosMotores,
} from "../../shared/hooks/useDadosDaConfiguracao";
import {
  comMotorDoPapel,
  comoModeloClaude,
  MODELO_PADRAO_DO_CLI,
  MOTORES,
  type PapelDoModelo,
  PADRAO_DO_ID_DE_MODELO,
  motorDoOrquestradorDe,
  motorDosSubagentesDe,
  ordemDeReservaDe,
  rotuloDoModeloPadraoDoCli,
  rotuloDoMotor,
} from "../../shared/modelos";
import "../../theme/motores.css";
import { AvisoDoEsforcoHerdado, Rotulo } from "./LinhasDaConfiguracao";
import { MenuDeModelo } from "./MenuDeModelo";

/*
 * As linhas da configuração que dependem do motor (Claude Code, Codex ou GitHub Copilot CLI): o motor e o modelo de
 * cada papel, a ordem de reserva e o navegador do agente. Usadas pela criação (NoRascunho) e pela ⚙ do terminal
 * (CamposDaConfiguracao), que mostram exatamente as mesmas linhas.
 */

interface PropsDoMotor {
  id: string;
  rotulo: string;
  motor: Motor;
  aoEscolher: (motor: Motor) => void;
  situacao: SituacaoDosMotores;
}

/**
 * O motor de um papel. Um motor que o servidor diz não estar instalado aparece desabilitado, com o motivo; o motor
 * já escolhido nunca é desabilitado (ele pode ter sido salvo quando o CLI estava lá).
 */
function SeletorDoMotor({ id, rotulo, motor, aoEscolher, situacao }: PropsDoMotor) {
  const t = useTextos(textosDeNosDoCanvas).motores;
  return (
    <select
      id={id}
      className="select select-compacto select-do-motor"
      aria-label={rotulo}
      value={motor}
      onChange={(evento) => aoEscolher(evento.target.value as Motor)}
    >
      {MOTORES.map((candidato) => {
        const motivo = motivoDoMotorIndisponivel(situacao, candidato);
        return (
          <option key={candidato} value={candidato} disabled={motivo !== null && candidato !== motor} title={motivo ?? undefined}>
            {rotuloDoMotor(candidato)}
            {motivo !== null ? t.naoInstalado : ""}
          </option>
        );
      })}
    </select>
  );
}

/** Por que o motor escolhido pode falhar (não instalado, sem login); nada quando está tudo certo. */
function AvisosDoMotorEscolhido({ motor, situacao }: { motor: Motor; situacao: SituacaoDosMotores }) {
  const indisponivel = motivoDoMotorIndisponivel(situacao, motor);
  const aviso = indisponivel ?? avisoDoMotor(situacao, motor);
  return aviso === null ? null : <span className="hint-warning">{aviso}</span>;
}

/** Os motores que o servidor diz não estar instalados, com o motivo: explica as opções desabilitadas. */
function MotoresIndisponiveis({ situacao }: { situacao: SituacaoDosMotores }) {
  const t = useTextos(textosDeNosDoCanvas).motores;
  if (situacao.naoVerificou) {
    return <span className="hint">{t.naoVerificou}</span>;
  }
  const motivos = MOTORES.flatMap((motor) => {
    const motivo = motivoDoMotorIndisponivel(situacao, motor);
    return motivo === null ? [] : [{ motor, motivo }];
  });
  return (
    <>
      {motivos.map(({ motor, motivo }) => (
        <span key={motor} className="hint">
          {rotuloDoMotor(motor)}: {motivo}
        </span>
      ))}
    </>
  );
}

interface PropsDoModelo {
  id: string;
  papel: PapelDoModelo;
  valor: DadosDaConfiguracao;
  aoMudar: (configuracao: DadosDaConfiguracao) => void;
}

/**
 * O modelo de um motor que não é o Claude Code: o padrão do CLI ou o id de um modelo, digitado (o servidor repassa o
 * id ao CLI como veio). Sem esforço: o CLI usa o dele.
 */
function ModeloDoCli({ id, papel, valor, aoMudar }: PropsDoModelo) {
  const t = useTextos(textosDeNosDoCanvas).motores;
  const dono = papel === "orquestrador" ? t.donoDoOrquestrador : t.donoDosSubagentes;
  const modelo = papel === "orquestrador" ? valor.modeloDoOrquestrador : valor.modeloDosSubagentes;
  const campo = papel === "orquestrador" ? "modeloDoOrquestrador" : "modeloDosSubagentes";
  const personalizado = modelo !== MODELO_PADRAO_DO_CLI;
  const invalido = personalizado && !PADRAO_DO_ID_DE_MODELO.test(modelo);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <select
        id={id}
        className="select select-compacto select-do-modelo-do-cli"
        aria-label={t.modeloDoDono(dono)}
        value={personalizado ? "outro" : MODELO_PADRAO_DO_CLI}
        onChange={(evento) => aoMudar({ ...valor, [campo]: evento.target.value === "outro" ? "" : MODELO_PADRAO_DO_CLI })}
      >
        <option value={MODELO_PADRAO_DO_CLI}>{rotuloDoModeloPadraoDoCli()}</option>
        <option value="outro">{t.outroModelo}</option>
      </select>
      {personalizado && (
        <input
          className="input campo-escuro campo-do-id-do-modelo mono"
          aria-label={t.idDoModeloDoDono(dono)}
          aria-invalid={invalido}
          value={modelo}
          maxLength={64}
          placeholder={t.idPlaceholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(evento) => aoMudar({ ...valor, [campo]: evento.target.value.trim() })}
        />
      )}
    </div>
  );
}

interface PropsDosPapeis {
  /** Prefixo dos ids dos campos (um `useId` do formulário). */
  idDoCampo: string;
  valor: DadosDaConfiguracao;
  aoMudar: (configuracao: DadosDaConfiguracao) => void;
  motores: SituacaoDosMotores;
  /** O esforço que o Claude Code usaria em "padrao" (só vale com o motor Claude Code). */
  herdados: EsforcosHerdados | null;
}

/**
 * Uma linha de configuração com os dois papéis, cada um com o motor e o modelo: o Orquestrador (que conversa com o
 * usuário) e os Subagentes (que trabalham em paralelo). No Claude Code, o modelo vem com o menu de esforço; nos
 * outros motores, "Padrão do CLI" ou um id, e uma dica no lugar do esforço.
 */
export function LinhaDosPapeis({ idDoCampo, valor, aoMudar, motores, herdados }: PropsDosPapeis) {
  const t = useTextos(textosDeNosDoCanvas).motores;
  const avisos = useTextos(textosDeConfiguracoes).avisos;
  const motorDoOrquestrador = motorDoOrquestradorDe(valor);
  const motorDosSubagentes = motorDosSubagentesDe(valor);

  return (
    <div className="linha-da-criacao">
      <Rotulo
        htmlFor={`${idDoCampo}-orquestrador`}
        titulo={t.orquestrador}
        dica={t.orquestradorDica}
        explicacao={t.orquestradorExplicacao}
        alinharAoTopo
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SeletorDoMotor
            id={`${idDoCampo}-motor-do-orquestrador`}
            rotulo={t.motorDoOrquestrador}
            motor={motorDoOrquestrador}
            aoEscolher={(motor) => aoMudar(comMotorDoPapel(valor, "orquestrador", motor))}
            situacao={motores}
          />
          {motorDoOrquestrador === "claude-code" && (
            <MenuDeModelo
              id={`${idDoCampo}-orquestrador`}
              rotulo={t.modeloDoOrquestrador}
              modelo={comoModeloClaude(valor.modeloDoOrquestrador, "opus")}
              esforco={valor.esforcoDoOrquestrador}
              comUltracode
              aoEscolherModelo={(modelo) => aoMudar({ ...valor, modeloDoOrquestrador: modelo })}
              aoEscolherEsforco={(esforco) => aoMudar({ ...valor, esforcoDoOrquestrador: esforco })}
            />
          )}
        </div>
        {motorDoOrquestrador === "claude-code" ? (
          <>
            <AvisoDoEsforcoHerdado esforco={valor.esforcoDoOrquestrador} herdado={herdados?.orquestrador ?? null} />
            {valor.esforcoDoOrquestrador === "ultracode" && <span className="hint-warning">{avisos.ultracode}</span>}
          </>
        ) : (
          <>
            <ModeloDoCli id={`${idDoCampo}-orquestrador`} papel="orquestrador" valor={valor} aoMudar={aoMudar} />
            <span className="hint">{t.esforcoForaDoClaudeCode}</span>
          </>
        )}
        <AvisosDoMotorEscolhido motor={motorDoOrquestrador} situacao={motores} />
        <MotoresIndisponiveis situacao={motores} />
      </div>

      <Rotulo
        htmlFor={`${idDoCampo}-subagentes`}
        titulo={t.subagentes}
        dica={t.subagentesDica}
        explicacao={t.subagentesExplicacao}
        alinharAoTopo
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SeletorDoMotor
            id={`${idDoCampo}-motor-dos-subagentes`}
            rotulo={t.motorDosSubagentes}
            motor={motorDosSubagentes}
            aoEscolher={(motor) => aoMudar(comMotorDoPapel(valor, "subagentes", motor))}
            situacao={motores}
          />
          {motorDosSubagentes === "claude-code" && (
            <MenuDeModelo
              id={`${idDoCampo}-subagentes`}
              rotulo={t.modeloDosSubagentes}
              modelo={comoModeloClaude(valor.modeloDosSubagentes, "sonnet")}
              esforco={valor.esforcoDosSubagentes}
              aoEscolherModelo={(modelo) => aoMudar({ ...valor, modeloDosSubagentes: modelo })}
              aoEscolherEsforco={(esforco) => aoMudar({ ...valor, esforcoDosSubagentes: esforco })}
            />
          )}
        </div>
        {motorDosSubagentes === "claude-code" ? (
          <AvisoDoEsforcoHerdado esforco={valor.esforcoDosSubagentes} herdado={herdados?.subagentes ?? null} />
        ) : (
          <>
            <ModeloDoCli id={`${idDoCampo}-subagentes`} papel="subagentes" valor={valor} aoMudar={aoMudar} />
            <span className="hint">{t.esforcoForaDoClaudeCode}</span>
          </>
        )}
        {motorDosSubagentes !== motorDoOrquestrador && <AvisosDoMotorEscolhido motor={motorDosSubagentes} situacao={motores} />}
      </div>
    </div>
  );
}

/** Os outros motores, na ordem em que a tela mostra: os da reserva (na ordem dela) e depois os demais. */
function motoresDaLista(motorDoOrquestrador: Motor, reserva: readonly Motor[]): { motor: Motor; marcado: boolean }[] {
  const marcados = reserva.filter((motor) => motor !== motorDoOrquestrador);
  const demais = MOTORES.filter((motor) => motor !== motorDoOrquestrador && !marcados.includes(motor));
  return [
    ...marcados.map((motor) => ({ motor, marcado: true })),
    ...demais.map((motor) => ({ motor, marcado: false })),
  ];
}

/**
 * A ordem de reserva: os outros motores, com uma caixa para marcar quem pode assumir o pedido e setas para mudar a
 * ordem dos marcados. O primeiro marcado é o primeiro a assumir.
 */
export function LinhaDaReserva({
  valor,
  aoMudar,
  motores,
}: {
  valor: DadosDaConfiguracao;
  aoMudar: (configuracao: DadosDaConfiguracao) => void;
  motores: SituacaoDosMotores;
}) {
  const t = useTextos(textosDeNosDoCanvas).motores;
  const motorDoOrquestrador = motorDoOrquestradorDe(valor);
  const reserva = ordemDeReservaDe(valor).filter((motor) => motor !== motorDoOrquestrador);
  const itens = motoresDaLista(motorDoOrquestrador, reserva);

  function definir(nova: readonly Motor[]): void {
    aoMudar({ ...valor, ordemDeReserva: [...nova] });
  }

  function alternar(motor: Motor, marcado: boolean): void {
    definir(marcado ? [...reserva, motor] : reserva.filter((existente) => existente !== motor));
  }

  function mover(motor: Motor, passo: -1 | 1): void {
    const indice = reserva.indexOf(motor);
    const destino = indice + passo;
    if (indice < 0 || destino < 0 || destino >= reserva.length) {
      return;
    }
    const nova = [...reserva];
    nova.splice(indice, 1);
    nova.splice(destino, 0, motor);
    definir(nova);
  }

  return (
    <div className="linha-da-criacao">
      <Rotulo
        titulo={t.reserva}
        dica={t.reservaDica}
        explicacao={t.reservaExplicacao(t.explicacaoDaReserva)}
        alinharAoTopo
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div role="group" aria-label={t.ordemDeReserva} className="lista-da-reserva">
          {itens.map(({ motor, marcado }) => {
            const posicao = reserva.indexOf(motor);
            const motivo = motivoDoMotorIndisponivel(motores, motor);
            return (
              <div key={motor} className="item-da-reserva">
                <label className="flex min-w-0 items-center gap-1.5 text-[12.5px]" title={motivo ?? undefined}>
                  <input
                    type="checkbox"
                    checked={marcado}
                    disabled={motivo !== null && !marcado}
                    onChange={(evento) => alternar(motor, evento.target.checked)}
                  />
                  <span className="truncate">{rotuloDoMotor(motor)}</span>
                  {motivo !== null && <span className="text-muted">{t.naoInstaladoReserva}</span>}
                </label>
                {marcado && (
                  <>
                    <span className="mono ordem-da-reserva" aria-hidden="true">
                      {t.ordem(posicao + 1)}
                    </span>
                    <button
                      type="button"
                      className="botao-icone botao-da-reserva"
                      title={t.passarParaAntes(rotuloDoMotor(motor))}
                      aria-label={t.subirNaReserva(rotuloDoMotor(motor))}
                      disabled={posicao === 0}
                      onClick={() => mover(motor, -1)}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      className="botao-icone botao-da-reserva"
                      title={t.passarParaDepois(rotuloDoMotor(motor))}
                      aria-label={t.descerNaReserva(rotuloDoMotor(motor))}
                      disabled={posicao === reserva.length - 1}
                      onClick={() => mover(motor, 1)}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <span className="hint">{t.explicacaoDaReserva}</span>
      </div>
    </div>
  );
}

/**
 * O liga e desliga do navegador do agente: um navegador próprio do orquestrador, que o agente controla sem pedir
 * aprovação a cada ação e que guarda os logins feitos nele. O aviso fica sempre à vista.
 */
export function LinhaDoNavegador({
  valor,
  aoMudar,
}: {
  valor: DadosDaConfiguracao;
  aoMudar: (configuracao: DadosDaConfiguracao) => void;
}) {
  const t = useTextos(textosDeNosDoCanvas).motores;
  const ligado = valor.navegadorDoAgente === true;
  return (
    <div className="linha-da-criacao">
      <Rotulo
        titulo={t.navegador}
        dica={t.navegadorDica}
        explicacao={t.navegadorExplicacao(t.avisoDoNavegador)}
        alinharAoTopo
      />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            role="switch"
            className="interruptor"
            aria-checked={ligado}
            onClick={() => aoMudar({ ...valor, navegadorDoAgente: !ligado })}
          >
            <span className="interruptor-trilho" aria-hidden="true" />
            {t.navegadorDoAgente}
          </button>
        </div>
        <span className="hint-warning">{t.avisoDoNavegador}</span>
      </div>
    </div>
  );
}
