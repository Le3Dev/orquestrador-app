import { useEffect, useId, useRef, useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import { TAMANHO_MAXIMO_DAS_NOTAS_DO_VINCULO, type VinculoDto } from "../../shared/api/tipos";

/** Como o painel mostra um lado do vínculo: o nome do orquestrador e o projeto (a pasta). */
export interface LadoDoVinculo {
  id: string;
  nome: string;
  projeto: string;
}

interface Props {
  vinculo: VinculoDto;
  a: LadoDoVinculo;
  b: LadoDoVinculo;
  aoFechar: () => void;
  aoSalvarNotas: (texto: string) => Promise<void>;
  aoEnviarMensagem: (de: string, texto: string) => Promise<void>;
  aoDesfazer: () => Promise<void>;
}

function rotuloDoLado({ nome, projeto }: LadoDoVinculo): string {
  return projeto !== "" ? `${nome} (${projeto})` : nome;
}

/**
 * O painel de um vínculo entre dois orquestradores: as notas compartilhadas
 * (editáveis; ambos as leem), uma caixa para mandar uma mensagem manual a um
 * dos lados e "Desfazer vínculo" (com confirmação). Não é modal: Esc fecha.
 */
export function PainelDoVinculo({ vinculo, a, b, aoFechar, aoSalvarNotas, aoEnviarMensagem, aoDesfazer }: Props) {
  const idDoTitulo = useId();
  const painel = useRef<HTMLElement>(null);
  const [notas, setNotas] = useState(vinculo.notas);
  const [notasSalvas, setNotasSalvas] = useState(vinculo.notas);
  const [de, setDe] = useState(a.id);
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // As notas que chegam de fora (o outro orquestrador as mudou) só entram quando não há edição em curso.
  useEffect(() => {
    if (vinculo.notas !== notasSalvas) {
      setNotas((atual) => (atual === notasSalvas ? vinculo.notas : atual));
      setNotasSalvas(vinculo.notas);
    }
  }, [vinculo.notas, notasSalvas]);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target;
      const noPainel = alvo === document.body || (alvo instanceof Node && painel.current?.contains(alvo) === true);
      if (evento.key === "Escape" && !evento.defaultPrevented && noPainel) {
        aoFechar();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  async function executar(acao: () => Promise<void>, sucesso: string | null): Promise<boolean> {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      await acao();
      setAviso(sucesso);
      return true;
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  const notasAlteradas = notas !== notasSalvas;
  const longas = notas.length > TAMANHO_MAXIMO_DAS_NOTAS_DO_VINCULO;
  const mensagemVazia = mensagem.trim() === "";
  const destino = de === a.id ? b : a;

  return (
    <section
      ref={painel}
      className="painel-flutuante painel-do-vinculo nodrag nowheel"
      aria-labelledby={idDoTitulo}
      data-testid="painel-do-vinculo"
    >
      <header className="painel-do-vinculo-cabecalho">
        <h3 id={idDoTitulo} className="label truncate" title={`${rotuloDoLado(a)} ↔ ${rotuloDoLado(b)}`}>
          Vínculo: {a.nome} ↔ {b.nome}
        </h3>
        <button type="button" className="botao-icone" aria-label="Fechar" title="Fechar" onClick={aoFechar}>
          ×
        </button>
      </header>
      <p className="text-support">
        {rotuloDoLado(a)} e {rotuloDoLado(b)} compartilham estas notas.
      </p>

      <label className="flex flex-col gap-1">
        <span className="label">Notas compartilhadas</span>
        <textarea
          className="input campo-escuro custom-scrollbar"
          rows={6}
          value={notas}
          placeholder="Combinados entre os dois orquestradores: contratos, decisões, pendências…"
          onChange={(evento) => setNotas(evento.target.value)}
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-sm btn-cta"
          disabled={ocupado || !notasAlteradas || longas}
          onClick={() => void executar(() => aoSalvarNotas(notas).then(() => setNotasSalvas(notas)), "Notas salvas.")}
        >
          Salvar notas
        </button>
        <span className={`mono ${longas ? "text-warning" : "text-muted"}`}>
          {notas.length} / {TAMANHO_MAXIMO_DAS_NOTAS_DO_VINCULO}
        </span>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="label">Enviar mensagem</span>
        <label className="flex items-center gap-2">
          <span className="text-support">De</span>
          <select className="input campo-escuro min-w-0 flex-1" aria-label="De" value={de} onChange={(evento) => setDe(evento.target.value)}>
            <option value={a.id}>{rotuloDoLado(a)}</option>
            <option value={b.id}>{rotuloDoLado(b)}</option>
          </select>
        </label>
        <textarea
          className="input campo-escuro custom-scrollbar"
          rows={3}
          aria-label="Mensagem"
          value={mensagem}
          placeholder={`Vai para a fila de ${destino.nome}, no nome de ${de === a.id ? a.nome : b.nome}…`}
          onChange={(evento) => setMensagem(evento.target.value)}
        />
        <div>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={ocupado || mensagemVazia}
            onClick={() =>
              void executar(async () => {
                await aoEnviarMensagem(de, mensagem.trim());
                setMensagem("");
              }, "Mensagem enviada.")
            }
          >
            Enviar
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        {confirmando ? (
          <>
            <span className="text-support flex-1">Desfazer este vínculo? As notas dele se perdem.</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={ocupado}
              onClick={() =>
                void executar(async () => {
                  await aoDesfazer();
                  aoFechar();
                }, null).then((ok) => {
                  if (!ok) {
                    setConfirmando(false);
                  }
                })
              }
            >
              Confirmar
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm btn-danger" disabled={ocupado} onClick={() => setConfirmando(true)}>
            Desfazer vínculo
          </button>
        )}
      </div>

      {aviso !== null && (
        <div className="alert alert-success" role="status">
          {aviso}
        </div>
      )}
      {erro !== null && (
        <div className="alert alert-error" role="alert">
          {erro}
        </div>
      )}
    </section>
  );
}
