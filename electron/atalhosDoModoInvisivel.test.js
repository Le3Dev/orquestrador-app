"use strict";

import { describe, expect, it, vi } from "vitest";

const { criarAtalhosDoModoInvisivel, TABELA_DE_ATALHOS, ACOES_DO_ATALHO } = require("./atalhosDoModoInvisivel");

function montar({ oculto = false, registrarRetorna = true } = {}) {
  const registrados = new Map();
  const globalShortcut = {
    register: vi.fn((acelerador, fn) => {
      if (!registrarRetorna) return false;
      registrados.set(acelerador, fn);
      return true;
    }),
    unregister: vi.fn((acelerador) => registrados.delete(acelerador)),
  };
  const estado = { oculto };
  const tratadores = {
    alternar: vi.fn(),
    sair: vi.fn(),
    capturar: vi.fn(),
    focar: vi.fn(),
    enviarAcao: vi.fn(),
    estaOculto: () => estado.oculto,
  };
  const registrarNoLog = vi.fn();
  const atalhos = criarAtalhosDoModoInvisivel({ globalShortcut, tratadores, registrarNoLog });
  return { atalhos, registrados, globalShortcut, tratadores, registrarNoLog, estado };
}

describe("tabela de atalhos", () => {
  it("é congelada e só as ações conhecidas são enviadas à tela", () => {
    expect(Object.isFrozen(TABELA_DE_ATALHOS)).toBe(true);
    for (const item of TABELA_DE_ATALHOS) {
      if (item.tipo === "acao" || item.tipo === "focar") expect(ACOES_DO_ATALHO).toContain(item.acao);
    }
  });
});

describe("criarAtalhosDoModoInvisivel", () => {
  it("registra só o de alternar permanentemente", () => {
    const { atalhos, registrados } = montar();
    atalhos.registrarPermanentes();
    expect([...registrados.keys()]).toEqual(["CommandOrControl+\\"]);
  });

  it("registra e solta os atalhos do modo", () => {
    const { atalhos, registrados } = montar();
    atalhos.registrarPermanentes();
    atalhos.registrarDoModo();
    expect(registrados.has("CommandOrControl+Shift+I")).toBe(true);
    expect(registrados.has("CommandOrControl+Alt+numadd")).toBe(true);
    atalhos.desregistrarDoModo();
    expect([...registrados.keys()]).toEqual(["CommandOrControl+\\"]);
  });

  it("encaminha as ações à tela", () => {
    const { atalhos, registrados, tratadores } = montar();
    atalhos.registrarDoModo();
    registrados.get("CommandOrControl+Alt+Up")();
    registrados.get("CommandOrControl+Alt+numsub")();
    registrados.get("CommandOrControl+Shift+Enter")();
    registrados.get("CommandOrControl+Shift+S")();
    registrados.get("CommandOrControl+Shift+Space")();
    expect(tratadores.enviarAcao.mock.calls.map((c) => c[0])).toEqual(["mover-cima", "opacidade-menos", "responder-agora"]);
    expect(tratadores.capturar).toHaveBeenCalledTimes(1);
    expect(tratadores.focar).toHaveBeenCalledTimes(1);
  });

  it("oculto: só alternar e sair funcionam", () => {
    const { atalhos, registrados, tratadores } = montar({ oculto: true });
    atalhos.registrarPermanentes();
    atalhos.registrarDoModo();
    registrados.get("CommandOrControl+Alt+Up")();
    registrados.get("CommandOrControl+Shift+S")();
    registrados.get("CommandOrControl+Shift+Space")();
    expect(tratadores.enviarAcao).not.toHaveBeenCalled();
    expect(tratadores.capturar).not.toHaveBeenCalled();
    expect(tratadores.focar).not.toHaveBeenCalled();
    registrados.get("CommandOrControl+Shift+I")();
    registrados.get("CommandOrControl+\\")();
    expect(tratadores.sair).toHaveBeenCalledTimes(1);
    expect(tratadores.alternar).toHaveBeenCalledTimes(1);
  });

  it("falha ao registrar vai para o log e não derruba", () => {
    const { atalhos, registrarNoLog } = montar({ registrarRetorna: false });
    expect(() => atalhos.registrarDoModo()).not.toThrow();
    expect(registrarNoLog).toHaveBeenCalled();
  });

  it("exceção do globalShortcut também é registrada no log", () => {
    const globalShortcut = {
      register: () => {
        throw new Error("acelerador inválido");
      },
      unregister: () => {
        throw new Error("x");
      },
    };
    const registrarNoLog = vi.fn();
    const atalhos = criarAtalhosDoModoInvisivel({ globalShortcut, tratadores: {}, registrarNoLog });
    expect(() => atalhos.registrarPermanentes()).not.toThrow();
    expect(() => atalhos.desregistrarDoModo()).not.toThrow();
    expect(registrarNoLog).toHaveBeenCalledTimes(1);
  });
});
