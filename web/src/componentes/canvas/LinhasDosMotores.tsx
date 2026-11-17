import type { DadosDaConfiguracao, EsforcosHerdados, Motor } from "../../shared/api/tipos";
import { AVISO_DO_ULTRACODE } from "../../shared/formatacao";
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
  ROTULO_DO_MODELO_PADRAO_DO_CLI,
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

/** A dica de por que o esforço não aparece fora do Claude Code. */
export const DICA_DO_ESFORCO_FORA_DO_CLAUDE_CODE =
  "O esforço só vale para o Claude Code: neste motor, o CLI usa o esforço dele.";

/** A frase de que a reserva assume o pedido (a explicação da ordem de reserva). */
export const EXPLICACAO_DA_RESERVA =
  "Se o motor principal bater o limite de uso ou ficar sobrecarregado, o pedido continua no próximo da lista, sem perder a conversa.";

/** O aviso do navegador do agente: o que ele pode fazer sem pedir aprovação. */
export const AVISO_DO_NAVEGADOR_DO_AGENTE =
  "O agente pode abrir qualquer site, sem pedir aprovação a cada ação, e usar os logins feitos neste navegador. Ligue só em orquestradores em que você confia.";

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
            {motivo !== null ? " (não instalado)" : ""}
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
  if (situacao.naoVerificou) {
    return <span className="hint">Não foi possível verificar quais motores estão instalados.</span>;
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
  const dono = papel === "orquestrador" ? "do orquestrador" : "dos subagentes";
  const modelo = papel === "orquestrador" ? valor.modeloDoOrquestrador : valor.modeloDosSubagentes;
  const campo = papel === "orquestrador" ? "modeloDoOrquestrador" : "modeloDosSubagentes";
  const personalizado = modelo !== MODELO_PADRAO_DO_CLI;
  const invalido = personalizado && !PADRAO_DO_ID_DE_MODELO.test(modelo);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <select
        id={id}
        className="select select-compacto select-do-modelo-do-cli"
        aria-label={`Modelo ${dono}`}
        value={personalizado ? "outro" : MODELO_PADRAO_DO_CLI}
        onChange={(evento) => aoMudar({ ...valor, [campo]: evento.target.value === "outro" ? "" : MODELO_PADRAO_DO_CLI })}
      >
        <option value={MODELO_PADRAO_DO_CLI}>{ROTULO_DO_MODELO_PADRAO_DO_CLI}</option>
        <option value="outro">Outro modelo…</option>
      </select>
      {personalizado && (
        <input
          className="input campo-escuro campo-do-id-do-modelo mono"
          aria-label={`Id do modelo ${dono}`}
          aria-invalid={invalido}
          value={modelo}
          maxLength={64}
          placeholder="Ex.: gpt-5"
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
  const motorDoOrquestrador = motorDoOrquestradorDe(valor);
  const motorDosSubagentes = motorDosSubagentesDe(valor);

  return (
    <div className="linha-da-criacao">
      <Rotulo
        htmlFor={`${idDoCampo}-orquestrador`}
        titulo="Orquestrador"
        dica="Quem conversa com você."
        explicacao="Ele entende o pedido, divide em tarefas e passa para os subagentes. Escolha o motor (Claude Code, Codex ou GitHub Copilot CLI) e o modelo. No Claude Code, Fable é para os desafios mais difíceis, Opus é o mais capaz no dia a dia, Sonnet equilibra e Haiku é rápido e gasta menos cota; o esforço é quanto ele pensa antes de responder e, no automático, vale o padrão do Claude Code. No Codex e no Copilot, vale o modelo do próprio CLI ou o id que você digitar."
        alinharAoTopo
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SeletorDoMotor
            id={`${idDoCampo}-motor-do-orquestrador`}
            rotulo="Motor do orquestrador"
            motor={motorDoOrquestrador}
            aoEscolher={(motor) => aoMudar(comMotorDoPapel(valor, "orquestrador", motor))}
            situacao={motores}
          />
          {motorDoOrquestrador === "claude-code" && (
            <MenuDeModelo
              id={`${idDoCampo}-orquestrador`}
              rotulo="Modelo do orquestrador"
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
            {valor.esforcoDoOrquestrador === "ultracode" && <span className="hint-warning">{AVISO_DO_ULTRACODE}</span>}
          </>
        ) : (
          <>
            <ModeloDoCli id={`${idDoCampo}-orquestrador`} papel="orquestrador" valor={valor} aoMudar={aoMudar} />
            <span className="hint">{DICA_DO_ESFORCO_FORA_DO_CLAUDE_CODE}</span>
          </>
        )}
        <AvisosDoMotorEscolhido motor={motorDoOrquestrador} situacao={motores} />
        <MotoresIndisponiveis situacao={motores} />
      </div>

      <Rotulo
        htmlFor={`${idDoCampo}-subagentes`}
        titulo="Subagentes"
        dica="Ajudantes que trabalham em paralelo."
        explicacao="O orquestrador lança um para cada tarefa, e eles aparecem como bixinhos ligados ao terminal. No padrão, ele decide quantos usar, até 3 ao mesmo tempo. Eles podem rodar num motor diferente do orquestrador. Cada subagente consome a cota da assinatura do motor dele."
        alinharAoTopo
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SeletorDoMotor
            id={`${idDoCampo}-motor-dos-subagentes`}
            rotulo="Motor dos subagentes"
            motor={motorDosSubagentes}
            aoEscolher={(motor) => aoMudar(comMotorDoPapel(valor, "subagentes", motor))}
            situacao={motores}
          />
          {motorDosSubagentes === "claude-code" && (
            <MenuDeModelo
              id={`${idDoCampo}-subagentes`}
              rotulo="Modelo dos subagentes"
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
            <span className="hint">{DICA_DO_ESFORCO_FORA_DO_CLAUDE_CODE}</span>
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
        titulo="Reserva"
        dica="Se o motor principal falhar."
        explicacao={`${EXPLICACAO_DA_RESERVA} Marque os motores que podem assumir e use as setas para escolher quem vem primeiro. Cada um precisa estar instalado e com login feito neste computador. O motor do orquestrador não entra na lista.`}
        alinharAoTopo
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div role="group" aria-label="Ordem de reserva" className="lista-da-reserva">
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
                  {motivo !== null && <span className="text-muted">(não instalado)</span>}
                </label>
                {marcado && (
                  <>
                    <span className="mono ordem-da-reserva" aria-hidden="true">
                      {posicao + 1}º
                    </span>
                    <button
                      type="button"
                      className="botao-icone botao-da-reserva"
                      title={`Passar ${rotuloDoMotor(motor)} para antes`}
                      aria-label={`Subir ${rotuloDoMotor(motor)} na reserva`}
                      disabled={posicao === 0}
                      onClick={() => mover(motor, -1)}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      className="botao-icone botao-da-reserva"
                      title={`Passar ${rotuloDoMotor(motor)} para depois`}
                      aria-label={`Descer ${rotuloDoMotor(motor)} na reserva`}
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
        <span className="hint">{EXPLICACAO_DA_RESERVA}</span>
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
  const ligado = valor.navegadorDoAgente === true;
  return (
    <div className="linha-da-criacao">
      <Rotulo
        titulo="Navegador"
        dica="Um navegador que o agente controla."
        explicacao={`Liga um navegador próprio deste orquestrador (um bloco no canvas, ao lado do terminal) que os agentes controlam para abrir sites, clicar, preencher e ler páginas. Você pode pausar e assumir o controle a qualquer momento. ${AVISO_DO_NAVEGADOR_DO_AGENTE} Só vale no nível "Editar e rodar comandos" e fora do Plan Mode, e só funciona no app desktop.`}
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
            Navegador do agente
          </button>
        </div>
        <span className="hint-warning">{AVISO_DO_NAVEGADOR_DO_AGENTE}</span>
      </div>
    </div>
  );
}
