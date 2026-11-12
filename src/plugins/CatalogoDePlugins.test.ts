import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CatalogoDePlugins,
  criarExecutorDoClaude,
  ErroDePlugin,
  ExecutorDeComandos,
  ResultadoDoComando,
} from "./CatalogoDePlugins";
import { PendentesEmArquivo, PendentesEmMemoria } from "./PendentesDePlugins";

interface DisponivelFalso {
  pluginId: string;
  name: string;
  description?: string;
  marketplaceName: string;
  source?: unknown;
  version?: string;
  installCount?: number;
}

interface InstaladoFalso {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
  installedAt: string;
}

function sucesso(saida: string): ResultadoDoComando {
  return { codigo: 0, saida, erroPadrao: "", tempoEsgotado: false, naoIniciou: false };
}

function falha(erroPadrao: string, saida = ""): ResultadoDoComando {
  return { codigo: 1, saida, erroPadrao, tempoEsgotado: false, naoIniciou: false };
}

/** Um `claude plugin` falso: guarda o estado em memória e nunca instala nada nem acessa a rede. */
class ClaudeFalso {
  disponiveis: DisponivelFalso[] = [];
  instalados: InstaladoFalso[] = [];
  /** Cada chamada ao CLI, como o texto dos argumentos. */
  chamadas: string[] = [];
  /** Resposta no lugar da simulada, por subcomando (`install`, `enable`...), uma vez. */
  respostas = new Map<string, ResultadoDoComando | Error>();
  /** O que a instalação grava no disco do plugin. */
  aoInstalar: ((instalacao: string) => Promise<void>) | null = null;
  /** Segura a instalação até ser liberada (para testar a fila). */
  seguraInstalacao: Promise<void> | null = null;

  constructor(private readonly pastaDoClaude: string) {}

  readonly executar: ExecutorDeComandos = async (argumentos) => {
    this.chamadas.push(argumentos.join(" "));
    const [, comando = "", ...resto] = argumentos;
    const pronta = this.respostas.get(comando);
    if (pronta !== undefined) {
      this.respostas.delete(comando);
      if (pronta instanceof Error) {
        throw pronta;
      }
      return pronta;
    }
    if (comando === "list") {
      const conteudo = resto.includes("--available")
        ? { installed: this.instalados, available: this.disponiveis }
        : this.instalados;
      return sucesso(JSON.stringify(conteudo));
    }
    const id = resto[0] ?? "";
    if (comando === "install") {
      await this.seguraInstalacao;
      const instalacao = path.join(this.pastaDoClaude, "plugins", "cache", id.replace("@", "-"), "1.0.0");
      await mkdir(instalacao, { recursive: true });
      await this.aoInstalar?.(instalacao);
      this.instalados.push({
        id,
        version: "1.0.0",
        scope: "user",
        enabled: true,
        installPath: instalacao,
        installedAt: "2026-11-01T10:00:00.000Z",
      });
      return sucesso(JSON.stringify({ command: "install", outcome: "ok", plugin: id }));
    }
    if (comando === "enable" || comando === "disable") {
      const alvo = this.instalados.find((item) => item.id === id && item.scope === "user");
      if (alvo) {
        alvo.enabled = comando === "enable";
      }
      return sucesso(JSON.stringify({ command: comando, outcome: "ok", plugin: id }));
    }
    if (comando === "uninstall") {
      this.instalados = this.instalados.filter((item) => !(item.id === id && item.scope === "user"));
      return sucesso(JSON.stringify({ command: "uninstall", outcome: "ok", plugin: id }));
    }
    return falha("comando desconhecido");
  };

  contar(prefixo: string): number {
    return this.chamadas.filter((chamada) => chamada.startsWith(prefixo)).length;
  }
}

const DISPONIVEIS: DisponivelFalso[] = [
  {
    pluginId: "superpowers@claude-plugins-official",
    name: "superpowers",
    description: "Fluxo de trabalho com planejamento e revisão",
    marketplaceName: "claude-plugins-official",
    source: { source: "url", url: "https://github.com/obra/superpowers.git", sha: "abc" },
    version: "6.4.1",
    installCount: 5000,
  },
  {
    pluginId: "agent-sdk-dev@claude-plugins-official",
    name: "agent-sdk-dev",
    description: "Ferramentas para o Agent SDK",
    marketplaceName: "claude-plugins-official",
    source: "./plugins/agent-sdk-dev",
    installCount: 1200,
  },
  {
    pluginId: "sem-contagem@claude-plugins-official",
    name: "sem-contagem",
    description: "Plugin sem contagem de instalações",
    marketplaceName: "claude-plugins-official",
    source: { source: "git-subdir", url: "ssh://git@exemplo.com/x.git", path: "p" },
  },
  {
    pluginId: "documentacao@anthropic-plugin-directory",
    name: "documentacao",
    description: "Gera DOCUMENTAÇÃO técnica com Açúcar",
    marketplaceName: "anthropic-plugin-directory",
    source: { source: "git-subdir", url: "https://github.com/acme/docs.git", path: "p", ref: "main" },
    installCount: 900,
  },
  {
    pluginId: "api-testing@anthropic-plugin-directory",
    name: "api-testing",
    description: "Testa APIs",
    marketplaceName: "anthropic-plugin-directory",
    source: { source: "url", url: "https://github.com/acme/api.git" },
    installCount: 3000,
  },
  { pluginId: "com espaco@x", name: "invalido", marketplaceName: "x" },
];

describe("catálogo e ciclo de vida dos plugins", () => {
  let pasta: string;
  let claude: string;
  let cli: ClaudeFalso;
  let agora: number;
  let catalogo: CatalogoDePlugins;
  let pendentes: PendentesEmMemoria;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "catalogo-plugins-teste-"));
    claude = path.join(pasta, ".claude");
    await mkdir(path.join(claude, "plugins"), { recursive: true });
    cli = new ClaudeFalso(claude);
    cli.disponiveis = DISPONIVEIS;
    agora = 1_000_000;
    pendentes = new PendentesEmMemoria();
    catalogo = new CatalogoDePlugins({ executar: cli.executar, pastaDoClaude: claude, agora: () => agora, pendentes });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(pasta, { recursive: true, force: true });
  });

  const consulta = (sobra: Partial<Parameters<CatalogoDePlugins["buscarCatalogo"]>[0]> = {}) => ({
    busca: "",
    origem: "oficial" as const,
    limite: 50,
    deslocamento: 0,
    ...sobra,
  });

  async function erroDe(promessa: Promise<unknown>): Promise<ErroDePlugin> {
    try {
      await promessa;
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDePlugin);
      return erro as ErroDePlugin;
    }
    throw new Error("Esperava um ErroDePlugin.");
  }

  describe("catálogo", () => {
    it("lista os oficiais por instalações desc, com nulas por último, e os totais por origem", async () => {
      const pagina = await catalogo.buscarCatalogo(consulta());

      expect(pagina.plugins.map((plugin) => plugin.id)).toEqual([
        "superpowers@claude-plugins-official",
        "agent-sdk-dev@claude-plugins-official",
        "sem-contagem@claude-plugins-official",
      ]);
      expect(pagina.total).toBe(3);
      expect(pagina.totais).toEqual({ oficial: 3, aberto: 2 });
      expect(pagina.plugins[0]).toEqual({
        id: "superpowers@claude-plugins-official",
        nome: "superpowers",
        descricao: "Fluxo de trabalho com planejamento e revisão",
        marketplace: "claude-plugins-official",
        oficial: true,
        instalacoes: 5000,
        versao: "6.4.1",
        fonte: "https://github.com/obra/superpowers",
        instalado: false,
        jaTem: { skills: [], servidoresMcp: [] },
      });
    });

    it("marca em jaTem as skills e os servidores MCP do usuário com o mesmo nome do plugin", async () => {
      catalogo = new CatalogoDePlugins({
        executar: cli.executar,
        pastaDoClaude: claude,
        agora: () => agora,
        pendentes,
        lerNomesDoUsuario: async () => ({ skills: ["superpowers-skill", "outra"], servidoresMcp: ["Superpowers", "x"] }),
      });

      const pagina = await catalogo.buscarCatalogo(consulta({ origem: "todos" }));
      const porNome = new Map(pagina.plugins.map((plugin) => [plugin.nome, plugin.jaTem]));

      expect(porNome.get("superpowers")).toEqual({ skills: ["superpowers-skill"], servidoresMcp: ["Superpowers"] });
      expect(porNome.get("api-testing")).toEqual({ skills: [], servidoresMcp: [] });
    });

    it("se o leitor dos nomes do usuário falhar, a listagem segue sem o aviso", async () => {
      catalogo = new CatalogoDePlugins({
        executar: cli.executar,
        pastaDoClaude: claude,
        agora: () => agora,
        pendentes,
        lerNomesDoUsuario: async () => {
          throw new Error("falha");
        },
      });

      const pagina = await catalogo.buscarCatalogo(consulta());

      expect(pagina.total).toBe(3);
      expect(pagina.plugins[0]?.jaTem).toEqual({ skills: [], servidoresMcp: [] });
    });

    it("fonte só quando é URL https; sem contagem nem versão vira nulo; id mal formado fica fora", async () => {
      const pagina = await catalogo.buscarCatalogo(consulta({ origem: "todos" }));
      const porId = new Map(pagina.plugins.map((plugin) => [plugin.id, plugin]));

      expect(porId.get("agent-sdk-dev@claude-plugins-official")?.fonte).toBeNull();
      expect(porId.get("sem-contagem@claude-plugins-official")).toMatchObject({ fonte: null, instalacoes: null, versao: null });
      expect(pagina.total).toBe(5);
      expect([...porId.keys()]).not.toContain("com espaco@x");
    });

    it("origem aberto são todos os marketplaces menos o oficial", async () => {
      const pagina = await catalogo.buscarCatalogo(consulta({ origem: "aberto" }));

      expect(pagina.plugins.map((plugin) => plugin.id)).toEqual([
        "api-testing@anthropic-plugin-directory",
        "documentacao@anthropic-plugin-directory",
      ]);
      expect(pagina.plugins.every((plugin) => !plugin.oficial)).toBe(true);
    });

    it("busca sem acento e sem maiúscula em nome e descrição, com todos os termos", async () => {
      const porAcento = await catalogo.buscarCatalogo(consulta({ origem: "todos", busca: "acucar DOCUMENTACAO" }));
      const porNome = await catalogo.buscarCatalogo(consulta({ origem: "todos", busca: "SUPERPOWERS" }));
      const semResultado = await catalogo.buscarCatalogo(consulta({ origem: "todos", busca: "documentacao superpowers" }));

      expect(porAcento.plugins.map((plugin) => plugin.nome)).toEqual(["documentacao"]);
      expect(porNome.plugins.map((plugin) => plugin.nome)).toEqual(["superpowers"]);
      expect(semResultado.total).toBe(0);
    });

    it("os totais por origem respeitam a busca", async () => {
      const pagina = await catalogo.buscarCatalogo(consulta({ busca: "api" }));

      expect(pagina.totais).toEqual({ oficial: 0, aberto: 1 });
      expect(pagina.total).toBe(0);
    });

    it("pagina com limite e deslocamento, e total é o da origem inteira", async () => {
      const pagina = await catalogo.buscarCatalogo(consulta({ limite: 1, deslocamento: 1 }));

      expect(pagina.plugins.map((plugin) => plugin.nome)).toEqual(["agent-sdk-dev"]);
      expect(pagina.total).toBe(3);
    });

    it("marca como instalado o que está no escopo do usuário, e só ele", async () => {
      cli.instalados = [
        { id: "superpowers@claude-plugins-official", version: "6.4.1", scope: "user", enabled: true, installPath: "/x", installedAt: "2026-01-01" },
        { id: "agent-sdk-dev@claude-plugins-official", version: "1", scope: "project", enabled: true, installPath: "/y", installedAt: "2026-01-01" },
      ];

      const pagina = await catalogo.buscarCatalogo(consulta());

      expect(pagina.plugins.filter((plugin) => plugin.instalado).map((plugin) => plugin.nome)).toEqual(["superpowers"]);
    });

    it("guarda o catálogo por 10 minutos e consulta de novo depois", async () => {
      await catalogo.buscarCatalogo(consulta());
      await catalogo.buscarCatalogo(consulta({ busca: "api" }));
      expect(cli.contar("plugin list --available")).toBe(1);

      agora += 9 * 60_000;
      await catalogo.buscarCatalogo(consulta());
      expect(cli.contar("plugin list --available")).toBe(1);

      agora += 2 * 60_000;
      await catalogo.buscarCatalogo(consulta());
      expect(cli.contar("plugin list --available")).toBe(2);
    });

    it("consultas simultâneas compartilham uma única chamada ao CLI", async () => {
      await Promise.all([catalogo.buscarCatalogo(consulta()), catalogo.buscarCatalogo(consulta({ origem: "aberto" }))]);

      expect(cli.contar("plugin list --available")).toBe(1);
    });

    it("usa o CLI sem shell: argumentos separados, em um subcomando só de leitura", async () => {
      await catalogo.buscarCatalogo(consulta());

      expect(cli.chamadas).toEqual(["plugin list --available --json"]);
    });
  });

  describe("instalados", () => {
    it("lista só o escopo user, por nome, com o inventário lido do disco", async () => {
      const instalacao = path.join(claude, "plugins", "cache", "m", "zebra", "1.0.0");
      await mkdir(path.join(instalacao, "skills", "uma"), { recursive: true });
      await writeFile(path.join(instalacao, "skills", "uma", "SKILL.md"), "---\nname: uma\ndescription: Faz uma coisa\n---\n");
      cli.instalados = [
        { id: "zebra@claude-plugins-official", version: "1.0.0", scope: "user", enabled: false, installPath: instalacao, installedAt: "2026-02-02T00:00:00.000Z" },
        { id: "abelha@impeccable", version: "2", scope: "user", enabled: true, installPath: path.join(pasta, "fora"), installedAt: "2026-03-03T00:00:00.000Z" },
        { id: "projeto@claude-plugins-official", version: "1", scope: "project", enabled: true, installPath: instalacao, installedAt: "x" },
        { id: "sincronizado@synced", version: "1", scope: "synced", enabled: true, installPath: instalacao, installedAt: "x" },
      ];

      const plugins = await catalogo.listarInstalados();

      expect(plugins.map((plugin) => plugin.id)).toEqual(["abelha@impeccable", "zebra@claude-plugins-official"]);
      expect(plugins[1]).toEqual({
        id: "zebra@claude-plugins-official",
        nome: "zebra",
        marketplace: "claude-plugins-official",
        oficial: true,
        versao: "1.0.0",
        ligado: false,
        instaladoEm: "2026-02-02T00:00:00.000Z",
        inventario: {
          skills: [{ nome: "uma", descricao: "Faz uma coisa" }],
          subagentes: 0,
          servidoresMcp: 0,
          hooks: 0,
          verificado: true,
          temBin: false,
        },
      });
      expect(plugins[0]?.oficial).toBe(false);
      expect(plugins[0]?.inventario).toEqual({
        skills: [],
        subagentes: 0,
        servidoresMcp: 0,
        hooks: 0,
        verificado: false,
        temBin: false,
      });
    });

    it("lista simultânea compartilha uma única chamada `list --json` e o inventário fica guardado até mudar algo", async () => {
      const instalacao = path.join(claude, "plugins", "cache", "m", "zebra", "1.0.0");
      await mkdir(instalacao, { recursive: true });
      cli.instalados = [
        { id: "zebra@claude-plugins-official", version: "1", scope: "user", enabled: true, installPath: instalacao, installedAt: "x" },
      ];

      await Promise.all([catalogo.listarInstalados(), catalogo.listarInstalados(), catalogo.listarInstalados()]);
      await writeFile(path.join(instalacao, "mudou.txt"), "x");
      await mkdir(path.join(instalacao, "bin"));
      const guardado = await catalogo.listarInstalados();

      expect(cli.contar("plugin list --json")).toBe(1);
      expect(guardado[0]?.inventario.temBin).toBe(false);

      await catalogo.desligar("zebra@claude-plugins-official");
      expect((await catalogo.listarInstalados())[0]?.inventario.temBin).toBe(true);
    });
  });

  describe("instalar", () => {
    const API = "api-testing@anthropic-plugin-directory";

    it("instala no escopo do usuário, desliga na hora e só liga se o inventário provar que é seguro", async () => {
      cli.aoInstalar = async (instalacao) => {
        await mkdir(path.join(instalacao, "skills", "s"), { recursive: true });
        await writeFile(path.join(instalacao, "skills", "s", "SKILL.md"), "---\nname: s\ndescription: D\n---\n");
      };

      const { plugin, precisaConfirmar } = await catalogo.instalar(API);

      expect(precisaConfirmar).toBe(false);
      expect(plugin).toMatchObject({ id: API, ligado: true });
      expect(plugin.inventario).toMatchObject({ skills: [{ nome: "s", descricao: "D" }], verificado: true, temBin: false });
      expect(cli.instalados[0]?.enabled).toBe(true);
      expect(cli.chamadas.join("\n")).not.toMatch(/--yes|-y |--accept-command/);
      expect(pendentes.ler()).toEqual([]);
    });

    it("o disable vem logo depois do install, antes de qualquer list ou leitura do disco", async () => {
      await catalogo.instalar(API);

      expect(cli.chamadas).toEqual([
        "plugin list --json",
        `plugin install ${API} --scope user --json`,
        `plugin disable ${API} --scope user --json`,
        "plugin list --json",
        `plugin enable ${API} --scope user --json`,
      ]);
    });

    it("o plugin já nasce desligado enquanto o inventário é lido", async () => {
      let ligadoNaLeitura: boolean | undefined;
      const executarOriginal = cli.executar;
      const lista: ExecutorDeComandos = async (argumentos, tempo) => {
        if (argumentos[1] === "list" && cli.chamadas.some((chamada) => chamada.startsWith("plugin install"))) {
          ligadoNaLeitura = cli.instalados.find((item) => item.id === API)?.enabled;
        }
        return executarOriginal(argumentos, tempo);
      };
      catalogo = new CatalogoDePlugins({ executar: lista, pastaDoClaude: claude, agora: () => agora, pendentes });

      await catalogo.instalar(API);

      expect(ligadoNaLeitura).toBe(false);
    });

    it("registra o pendente antes do install e o tira quando liga sozinho", async () => {
      let pendenteNoInstall: string[] = [];
      cli.aoInstalar = async () => {
        pendenteNoInstall = pendentes.ler();
      };

      await catalogo.instalar(API);

      expect(pendenteNoInstall).toEqual([API]);
      expect(pendentes.ler()).toEqual([]);
    });

    it("com hooks, fica desligado, pede confirmação e continua pendente", async () => {
      cli.aoInstalar = async (instalacao) => {
        await mkdir(path.join(instalacao, "hooks"), { recursive: true });
        await writeFile(
          path.join(instalacao, "hooks", "hooks.json"),
          JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } }),
        );
      };

      const { plugin, precisaConfirmar } = await catalogo.instalar(API);

      expect(precisaConfirmar).toBe(true);
      expect(plugin.ligado).toBe(false);
      expect(plugin.inventario.hooks).toBe(1);
      expect(cli.contar("plugin enable")).toBe(0);
      expect(cli.instalados[0]?.enabled).toBe(false);
      expect(pendentes.ler()).toEqual([API]);
    });

    it("hooks.json acima de 256 KB sai desligado (falha fechada)", async () => {
      cli.aoInstalar = async (instalacao) => {
        await mkdir(path.join(instalacao, "hooks"), { recursive: true });
        await writeFile(
          path.join(instalacao, "hooks", "hooks.json"),
          JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] }, enchimento: "x".repeat(300 * 1024) }),
        );
      };

      const { plugin, precisaConfirmar } = await catalogo.instalar(API);

      expect(precisaConfirmar).toBe(true);
      expect(plugin).toMatchObject({ ligado: false, inventario: { hooks: 0, verificado: false } });
      expect(cli.contar("plugin enable")).toBe(0);
      expect(cli.instalados[0]?.enabled).toBe(false);
    });

    it("plugin com bin/ sai desligado", async () => {
      cli.aoInstalar = async (instalacao) => {
        await mkdir(path.join(instalacao, "bin"), { recursive: true });
      };

      const { plugin, precisaConfirmar } = await catalogo.instalar(API);

      expect(precisaConfirmar).toBe(true);
      expect(plugin).toMatchObject({ ligado: false, inventario: { temBin: true, verificado: true } });
      expect(cli.contar("plugin enable")).toBe(0);
    });

    it("hooks no frontmatter de uma skill também pedem confirmação", async () => {
      cli.aoInstalar = async (instalacao) => {
        await mkdir(path.join(instalacao, "skills", "s"), { recursive: true });
        await writeFile(path.join(instalacao, "skills", "s", "SKILL.md"), "---\nname: s\nhooks:\n  Stop: []\n---\n");
      };

      expect((await catalogo.instalar(API)).precisaConfirmar).toBe(true);
    });

    it("se o enable automático falhar, o plugin fica desligado e pede confirmação", async () => {
      cli.respostas.set("enable", falha("boom"));

      const { plugin, precisaConfirmar } = await catalogo.instalar(API);

      expect(precisaConfirmar).toBe(true);
      expect(plugin.ligado).toBe(false);
      expect(pendentes.ler()).toEqual([API]);
    });

    it("se não conseguir desligar logo depois de instalar, remove e devolve erro", async () => {
      cli.respostas.set("disable", falha("boom"));

      const erro = await erroDe(catalogo.instalar(API));

      expect(erro.motivo).toBe("falha_do_cli");
      expect(erro.message).toContain("removido por segurança");
      expect(cli.instalados).toEqual([]);
      expect(pendentes.ler()).toEqual([]);
      expect(cli.contar("plugin list --json")).toBe(1);
    });

    it("se nem remover der certo, orienta pela lista e mantém o pendente", async () => {
      cli.respostas.set("disable", falha("boom"));
      cli.respostas.set("uninstall", falha("boom"));

      const erro = await erroDe(catalogo.instalar(API));

      expect(erro.message).toContain("Desligue ou remova pela lista");
      expect(pendentes.ler()).toEqual([API]);
    });

    it("instalação que falha tira o pendente, menos no tempo esgotado", async () => {
      cli.respostas.set("install", falha("Erro qualquer"));
      await erroDe(catalogo.instalar(API));
      expect(pendentes.ler()).toEqual([]);

      cli.respostas.set("install", { codigo: null, saida: "", erroPadrao: "", tempoEsgotado: true, naoIniciou: false });
      await erroDe(catalogo.instalar(API));
      expect(pendentes.ler()).toEqual([API]);
    });

    it("plugin que já está instalado volta como está, sem chamar o instalador nem desligar", async () => {
      cli.instalados = [
        { id: "api-testing@anthropic-plugin-directory", version: "1", scope: "user", enabled: true, installPath: path.join(pasta, "x"), installedAt: "2026-01-01" },
      ];

      const { plugin, precisaConfirmar } = await catalogo.instalar("api-testing@anthropic-plugin-directory");

      expect(plugin.ligado).toBe(true);
      expect(precisaConfirmar).toBe(false);
      expect(cli.contar("plugin install")).toBe(0);
    });

    it.each(["", "sem-marketplace", "a b@c", "a@b;rm -rf", "--scope@x", "../x@y", "a@b/c", `${"a".repeat(101)}@b`, "a@b\nc", "a@b\n", "-a@b", "a@-b", ".a@b", "a@.b"])(
      "recusa o id inválido %j antes de chamar o CLI",
      async (id) => {
        const erro = await erroDe(catalogo.instalar(id));

        expect(erro.motivo).toBe("id_invalido");
        expect(cli.chamadas).toEqual([]);
      },
    );

    it.each(["Superpowers@Claude-Plugins-Official", "A1@B2", "a.b_c-d@E.f"])("aceita maiúsculas no id %s", async (id) => {
      const instalacao = path.join(pasta, "x");
      cli.instalados = [{ id, version: "1", scope: "user", enabled: true, installPath: instalacao, installedAt: "x" }];

      await expect(catalogo.instalar(id)).resolves.toMatchObject({ plugin: { id } });
    });

    it("recusa uma segunda instalação enquanto há uma rodando e libera depois", async () => {
      let liberar: () => void = () => undefined;
      cli.seguraInstalacao = new Promise<void>((resolver) => {
        liberar = resolver;
      });

      const primeira = catalogo.instalar("api-testing@anthropic-plugin-directory");
      await vi.waitFor(() => expect(cli.contar("plugin install")).toBe(1));
      const erro = await erroDe(catalogo.instalar("superpowers@claude-plugins-official"));
      liberar();
      await primeira;

      expect(erro.motivo).toBe("instalacao_em_andamento");
      expect(cli.contar("plugin install")).toBe(1);
      cli.seguraInstalacao = null;
      await expect(catalogo.instalar("superpowers@claude-plugins-official")).resolves.toBeDefined();
    });

    it("libera a fila também quando a instalação falha", async () => {
      cli.respostas.set("install", falha("Erro qualquer"));

      await erroDe(catalogo.instalar("api-testing@anthropic-plugin-directory"));

      await expect(catalogo.instalar("api-testing@anthropic-plugin-directory")).resolves.toBeDefined();
    });

    it("instalar invalida os instalados guardados", async () => {
      await catalogo.buscarCatalogo(consulta());
      expect((await catalogo.buscarCatalogo(consulta({ origem: "todos" }))).plugins.some((p) => p.instalado)).toBe(false);

      await catalogo.instalar("api-testing@anthropic-plugin-directory");
      const pagina = await catalogo.buscarCatalogo(consulta({ origem: "todos" }));

      expect(pagina.plugins.filter((p) => p.instalado).map((p) => p.nome)).toEqual(["api-testing"]);
      expect(cli.contar("plugin list --available")).toBe(1);
    });
  });

  describe("ligar, desligar e remover", () => {
    beforeEach(() => {
      cli.instalados = [
        { id: "superpowers@claude-plugins-official", version: "6.4.1", scope: "user", enabled: false, installPath: path.join(pasta, "x"), installedAt: "2026-01-01" },
        { id: "so-projeto@claude-plugins-official", version: "1", scope: "project", enabled: true, installPath: path.join(pasta, "y"), installedAt: "2026-01-01" },
      ];
    });

    it("liga e desliga pelo CLI, no escopo do usuário, e devolve o plugin atualizado", async () => {
      const ligado = await catalogo.ligar("superpowers@claude-plugins-official");
      const desligado = await catalogo.desligar("superpowers@claude-plugins-official");

      expect(ligado.ligado).toBe(true);
      expect(desligado.ligado).toBe(false);
      expect(cli.chamadas).toContain("plugin enable superpowers@claude-plugins-official --scope user --json");
      expect(cli.chamadas).toContain("plugin disable superpowers@claude-plugins-official --scope user --json");
    });

    it("remove pelo CLI e o plugin some dos instalados", async () => {
      await catalogo.remover("superpowers@claude-plugins-official");

      expect(cli.chamadas).toContain("plugin uninstall superpowers@claude-plugins-official --scope user --json");
      expect(await catalogo.listarInstalados()).toEqual([]);
    });

    it("id desconhecido dá 404 sem chamar o CLI (o enable aceitaria até um id inexistente)", async () => {
      for (const acao of [
        () => catalogo.ligar("nao-existe@claude-plugins-official"),
        () => catalogo.desligar("nao-existe@claude-plugins-official"),
        () => catalogo.remover("nao-existe@claude-plugins-official"),
        () => catalogo.ligar("so-projeto@claude-plugins-official"),
      ]) {
        expect((await erroDe(acao())).motivo).toBe("nao_encontrado");
      }

      expect(cli.contar("plugin enable") + cli.contar("plugin disable") + cli.contar("plugin uninstall")).toBe(0);
    });

    it("ligar confirma: tira o plugin dos pendentes; desligar não tira", async () => {
      pendentes.adicionar("superpowers@claude-plugins-official");

      await catalogo.desligar("superpowers@claude-plugins-official");
      expect(pendentes.ler()).toEqual(["superpowers@claude-plugins-official"]);

      await catalogo.ligar("superpowers@claude-plugins-official");
      expect(pendentes.ler()).toEqual([]);
    });

    it("remover tira o plugin dos pendentes", async () => {
      pendentes.adicionar("superpowers@claude-plugins-official");

      await catalogo.remover("superpowers@claude-plugins-official");

      expect(pendentes.ler()).toEqual([]);
    });

    it("ligar, desligar e remover esperam a instalação em andamento (fila única)", async () => {
      let liberar: () => void = () => undefined;
      cli.seguraInstalacao = new Promise<void>((resolver) => {
        liberar = resolver;
      });

      const instalacao = catalogo.instalar("api-testing@anthropic-plugin-directory");
      await vi.waitFor(() => expect(cli.contar("plugin install")).toBe(1));
      const ligar = catalogo.ligar("superpowers@claude-plugins-official");
      const desligar = catalogo.desligar("superpowers@claude-plugins-official");
      const remover = catalogo.remover("superpowers@claude-plugins-official");
      await new Promise((resolver) => setTimeout(resolver, 30));

      expect(cli.contar("plugin enable") + cli.contar("plugin uninstall")).toBe(0);
      expect(cli.contar("plugin disable")).toBe(0);

      liberar();
      await Promise.all([instalacao, ligar, desligar, remover]);

      const comandos = cli.chamadas.filter((chamada) => /^plugin (install|enable|disable|uninstall)/.test(chamada)).map((chamada) => chamada.split(" ").slice(0, 3).join(" "));
      expect(comandos).toEqual([
        "plugin install api-testing@anthropic-plugin-directory",
        "plugin disable api-testing@anthropic-plugin-directory",
        "plugin enable api-testing@anthropic-plugin-directory",
        "plugin enable superpowers@claude-plugins-official",
        "plugin disable superpowers@claude-plugins-official",
        "plugin uninstall superpowers@claude-plugins-official",
      ]);
    });

    it("uma operação que falha não trava a fila", async () => {
      cli.respostas.set("enable", falha("boom"));

      await erroDe(catalogo.ligar("superpowers@claude-plugins-official"));

      await expect(catalogo.ligar("superpowers@claude-plugins-official")).resolves.toMatchObject({ ligado: true });
    });

    it("id inválido dá erro de id antes de qualquer chamada", async () => {
      expect((await erroDe(catalogo.ligar("--all"))).motivo).toBe("id_invalido");
      expect((await erroDe(catalogo.remover("a@b c"))).motivo).toBe("id_invalido");
      expect(cli.chamadas).toEqual([]);
    });
  });

  describe("reconciliação no início", () => {
    const entrada = (id: string, enabled: boolean) => ({
      id,
      version: "1",
      scope: "user",
      enabled,
      installPath: path.join(pasta, "x"),
      installedAt: "x",
    });

    it("desliga só os pendentes que estão ligados e esquece os que já não estão instalados", async () => {
      cli.instalados = [
        entrada("ligado-pendente@m", true),
        entrada("desligado-pendente@m", false),
        entrada("ligado-do-usuario@m", true),
      ];
      pendentes.adicionar("ligado-pendente@m");
      pendentes.adicionar("desligado-pendente@m");
      pendentes.adicionar("sumiu@m");

      await catalogo.reconciliar();

      expect(cli.chamadas).toEqual(["plugin list --json", "plugin disable ligado-pendente@m --scope user --json"]);
      expect(cli.instalados.map((item) => [item.id, item.enabled])).toEqual([
        ["ligado-pendente@m", false],
        ["desligado-pendente@m", false],
        ["ligado-do-usuario@m", true],
      ]);
      expect(pendentes.ler().sort()).toEqual(["desligado-pendente@m", "ligado-pendente@m"]);
    });

    it("sem pendentes não chama o CLI", async () => {
      await catalogo.reconciliar();

      expect(cli.chamadas).toEqual([]);
    });

    it("nunca lança: falha do CLI só vai para o log, e o pendente continua", async () => {
      cli.instalados = [entrada("ligado-pendente@m", true)];
      pendentes.adicionar("ligado-pendente@m");
      cli.respostas.set("disable", falha("boom"));

      await expect(catalogo.reconciliar()).resolves.toBeUndefined();

      expect(pendentes.ler()).toEqual(["ligado-pendente@m"]);
      expect(console.error).toHaveBeenCalled();
    });

    it("entra na mesma fila: uma instalação pedida depois espera a reconciliação", async () => {
      cli.instalados = [entrada("ligado-pendente@m", true)];
      pendentes.adicionar("ligado-pendente@m");

      const reconciliacao = catalogo.reconciliar();
      const instalacao = catalogo.instalar("api-testing@anthropic-plugin-directory");
      await Promise.all([reconciliacao, instalacao]);

      expect(cli.chamadas.indexOf("plugin disable ligado-pendente@m --scope user --json")).toBeLessThan(
        cli.chamadas.findIndex((chamada) => chamada.startsWith("plugin install")),
      );
    });
  });

  describe("pendentes em arquivo", () => {
    it("grava e lê os ids, sem duplicar, e tolera arquivo ausente ou corrompido", async () => {
      const arquivo = path.join(pasta, "dados", "pendentes.json");
      const registro = new PendentesEmArquivo(arquivo);
      expect(registro.ler()).toEqual([]);

      registro.adicionar("a@m");
      registro.adicionar("a@m");
      registro.adicionar("b@m");
      registro.remover("a@m");
      expect(new PendentesEmArquivo(arquivo).ler()).toEqual(["b@m"]);

      await writeFile(arquivo, "{ quebrado");
      expect(registro.ler()).toEqual([]);
    });
  });

  describe("falhas do CLI", () => {
    it.each([
      ["ENOTFOUND", "Error: getaddrinfo ENOTFOUND github.com"],
      ["Could not resolve host", "fatal: Could not resolve host: github.com"],
      ["network", "Network request failed"],
    ])("falha de rede (%s) vira sem_internet", async (_nome, mensagem) => {
      cli.respostas.set("install", falha(mensagem));

      const erro = await erroDe(catalogo.instalar("api-testing@anthropic-plugin-directory"));

      expect(erro.motivo).toBe("sem_internet");
      expect(erro.message).toMatch(/internet/);
    });

    it("falha de rede dentro do JSON de saída também é detectada", async () => {
      cli.respostas.set(
        "install",
        falha("", JSON.stringify({ command: "install", outcome: "failed", message: "Failed to clone: ENOTFOUND github.com" })),
      );

      expect((await erroDe(catalogo.instalar("api-testing@anthropic-plugin-directory"))).motivo).toBe("sem_internet");
    });

    it("tempo esgotado vira tempo_esgotado", async () => {
      cli.respostas.set("install", { codigo: null, saida: "", erroPadrao: "", tempoEsgotado: true, naoIniciou: false });

      expect((await erroDe(catalogo.instalar("api-testing@anthropic-plugin-directory"))).motivo).toBe("tempo_esgotado");
    });

    it("o plugin não encontrado pelo CLI vira nao_encontrado", async () => {
      cli.respostas.set(
        "install",
        falha("", JSON.stringify({ outcome: "failed", message: "Plugin x not found", failureCode: "not_found" })),
      );

      expect((await erroDe(catalogo.instalar("api-testing@anthropic-plugin-directory"))).motivo).toBe("nao_encontrado");
    });

    it("comando declarado pelo marketplace é recusado com mensagem clara", async () => {
      cli.respostas.set(
        "install",
        falha("", JSON.stringify({ outcome: "failed", message: "x", failureCode: "command_source_refused" })),
      );

      const erro = await erroDe(catalogo.instalar("api-testing@anthropic-plugin-directory"));

      expect(erro.motivo).toBe("falha_do_cli");
      expect(erro.message).toMatch(/comando declarado pelo marketplace/);
    });

    it("outra falha vira mensagem fixa: nada do texto do CLI chega à tela, só ao log", async () => {
      cli.respostas.set(
        "install",
        falha(
          `\n\u001b[31mErro: falha em /Users/fulano/Meus Documentos/x.json ao clonar https://usuario:senha@exemplo.com/r.git\u001b[0m\n    at foo (/Users/fulano/x.js:1:1)\n`,
        ),
      );

      const erro = await erroDe(catalogo.instalar("api-testing@anthropic-plugin-directory"));

      expect(erro.motivo).toBe("falha_do_cli");
      expect(erro.message).toBe("O Claude Code não conseguiu concluir a operação. Tente de novo ou use o terminal.");
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("usuario:senha@exemplo.com");
    });

    it("a mensagem do JSON de falha também não vai para a tela", async () => {
      cli.respostas.set(
        "install",
        falha("", JSON.stringify({ outcome: "failed", message: "Falha em /Users/fulano/segredo https://u:p@x.com" })),
      );

      const erro = await erroDe(catalogo.instalar("api-testing@anthropic-plugin-directory"));

      expect(erro.message).not.toMatch(/fulano|u:p@/);
    });

    it("saída com código 0 mas outcome failed também é falha", async () => {
      cli.respostas.set("enable", sucesso(JSON.stringify({ outcome: "failed", message: "Não deu" })));
      cli.instalados = [
        { id: "superpowers@claude-plugins-official", version: "1", scope: "user", enabled: false, installPath: path.join(pasta, "x"), installedAt: "x" },
      ];

      const erro = await erroDe(catalogo.ligar("superpowers@claude-plugins-official"));

      expect(erro).toMatchObject({
        motivo: "falha_do_cli",
        message: "O Claude Code não conseguiu concluir a operação. Tente de novo ou use o terminal.",
      });
    });

    it("executor que quebra vira falha_do_cli sem vazar o erro", async () => {
      cli.respostas.set("list", new Error("spawn /caminho/secreto/claude ENOENT"));

      const erro = await erroDe(catalogo.buscarCatalogo(consulta()));

      expect(erro.motivo).toBe("falha_do_cli");
      expect(erro.message).not.toContain("secreto");
    });

    it("lista que não é JSON vira falha_do_cli", async () => {
      cli.respostas.set("list", sucesso("isto não é json"));

      expect((await erroDe(catalogo.buscarCatalogo(consulta()))).motivo).toBe("falha_do_cli");
    });

    it("executável não encontrado vira falha clara", async () => {
      cli.respostas.set("list", { codigo: null, saida: "", erroPadrao: "", tempoEsgotado: false, naoIniciou: true });

      const erro = await erroDe(catalogo.buscarCatalogo(consulta()));

      expect(erro.message).toMatch(/não foi encontrado/);
    });

    it("guarda a falha do catálogo por 45 segundos, com a mesma mensagem, e tenta de novo depois", async () => {
      cli.respostas.set("list", falha("ENOTFOUND"));
      const primeira = await erroDe(catalogo.buscarCatalogo(consulta()));

      agora += 44_000;
      const segunda = await erroDe(catalogo.buscarCatalogo(consulta()));
      expect(segunda).toMatchObject({ motivo: primeira.motivo, message: primeira.message });
      expect(cli.contar("plugin list --available")).toBe(1);

      agora += 2_000;
      const pagina = await catalogo.buscarCatalogo(consulta());

      expect(pagina.total).toBe(3);
      expect(cli.contar("plugin list --available")).toBe(2);
    });
  });

  describe("limites do que vem do marketplace", () => {
    it("corta o nome em 100 caracteres e a fonte acima de 300 vira nula", async () => {
      cli.disponiveis = [
        {
          pluginId: "grande@claude-plugins-official",
          name: "n".repeat(500),
          marketplaceName: "claude-plugins-official",
          source: { source: "url", url: `https://github.com/${"a".repeat(400)}.git` },
        },
        {
          pluginId: "normal@claude-plugins-official",
          name: "normal",
          marketplaceName: "claude-plugins-official",
          source: { source: "url", url: "https://github.com/a/b.git" },
        },
      ];

      const pagina = await catalogo.buscarCatalogo(consulta());
      const porId = new Map(pagina.plugins.map((plugin) => [plugin.id, plugin]));

      expect(porId.get("grande@claude-plugins-official")?.nome).toHaveLength(100);
      expect(porId.get("grande@claude-plugins-official")?.fonte).toBeNull();
      expect(porId.get("normal@claude-plugins-official")?.fonte).toBe("https://github.com/a/b");
    });
  });
});

describe("executor do claude", () => {
  it("executável que não existe vira naoIniciou, sem lançar", async () => {
    const executar = criarExecutorDoClaude(path.join(tmpdir(), "nao-existe", "claude"));

    const resultado = await executar(["plugin", "list"], 5_000);

    expect(resultado).toMatchObject({ codigo: null, naoIniciou: true, tempoEsgotado: false });
  });

  it("processo que sai com erro devolve código e saída de erro, sem shell", async () => {
    const executar = criarExecutorDoClaude(process.execPath);

    // O Node trata "plugin" como um script que não existe: sai com 1 e escreve no stderr.
    const resultado = await executar(["plugin-que-nao-existe;touch-nada"], 20_000);

    expect(resultado.codigo).toBe(1);
    expect(resultado.erroPadrao).toContain("Cannot find module");
    expect(resultado.tempoEsgotado).toBe(false);
  });

  it("estoura o tempo limite e marca tempoEsgotado", async () => {
    const executar = criarExecutorDoClaude(process.execPath);

    const resultado = await executar(["-e", "setTimeout(() => {}, 30000)"], 300);

    expect(resultado.tempoEsgotado).toBe(true);
    expect(resultado.codigo).toBeNull();
  });
});
