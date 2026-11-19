import { act, render, renderHook, screen } from "@testing-library/react";

import { CHAVE_DAS_PREFERENCIAS_DA_TELA } from "../hooks/usePreferenciasDaTela";
import { definirIdioma, definirTextos, idiomaAtual, localeDoIdioma, textosAtuais, useIdioma, useTextos } from "./idioma";

const textosDeTeste = definirTextos({
  "pt-BR": { titulo: "Olá", subagentes: (n: number) => `${n} subagentes` },
  en: { titulo: "Hello", subagentes: (n: number) => `${n} subagents` },
});

// O formato do pt-BR manda: o TypeScript recusa um `en` diferente (o build confere estas linhas).
definirTextos({
  "pt-BR": { titulo: "Olá" },
  // @ts-expect-error falta a chave `titulo` e sobra `outro`
  en: { outro: "Hello" },
});

function Mostrador() {
  const t = useTextos(textosDeTeste);
  return (
    <p>
      {t.titulo} / {t.subagentes(2)}
    </p>
  );
}

const guardado = () => JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "{}") as Record<string, unknown>;

describe("idioma", () => {
  beforeEach(() => {
    localStorage.clear();
    definirIdioma("pt-BR");
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("sem nada guardado, o idioma é pt-BR", () => {
    expect(idiomaAtual()).toBe("pt-BR");
    expect(renderHook(() => useIdioma()).result.current).toBe("pt-BR");
  });

  it("preferências antigas, sem o campo, valem pt-BR", () => {
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ chatFixoNaEsquerda: true }));
    expect(idiomaAtual()).toBe("pt-BR");
  });

  it("valor inválido vale pt-BR", () => {
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ idioma: "fr" }));
    expect(idiomaAtual()).toBe("pt-BR");
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ idioma: 3 }));
    expect(idiomaAtual()).toBe("pt-BR");
  });

  it("trocar o idioma persiste e atualiza o lang do documento", () => {
    definirIdioma("en");
    expect(guardado().idioma).toBe("en");
    expect(idiomaAtual()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    definirIdioma("pt-BR");
    expect(guardado().idioma).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("useTextos re-renderiza ao trocar o idioma", () => {
    render(<Mostrador />);
    expect(screen.getByText("Olá / 2 subagentes")).toBeInTheDocument();
    act(() => definirIdioma("en"));
    expect(screen.getByText("Hello / 2 subagents")).toBeInTheDocument();
  });

  it("textosAtuais e localeDoIdioma seguem o idioma", () => {
    expect(textosAtuais(textosDeTeste).titulo).toBe("Olá");
    definirIdioma("en");
    expect(textosAtuais(textosDeTeste).subagentes(1)).toBe("1 subagents");
    expect(localeDoIdioma(idiomaAtual())).toBe("en-US");
    expect(localeDoIdioma("pt-BR")).toBe("pt-BR");
  });
});
