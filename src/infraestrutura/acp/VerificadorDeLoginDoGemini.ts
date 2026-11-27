import { tmpdir } from "node:os";

import { ambienteSemSessaoPai } from "../claudecode/ArgumentosDoClaudeCode";
import { VerificadorDeLogin } from "../motores/CatalogoDeMotores";
import { ErroJsonRpc } from "../motores/ProcessoJsonRpc";
import { FachadaAcp } from "./FachadaAcp";
import { criarPerfilDoGemini } from "./PerfilDoGemini";

const LIMITE_DA_VERIFICACAO_MS = 20_000;

/**
 * O Gemini CLI não tem um comando que diga se há login. O `session/new` do ACP
 * diz: abre a sessão a quem tem credencial e responde "Authentication required"
 * (-32000) a quem não tem — sem prompt, então sem gastar cota. A sessão aberta
 * é fechada em seguida (se o CLI souber fechá-la).
 *
 * O `authenticate` não serve aqui: com o método de login do Google e sem
 * credencial, o CLI tentaria abrir o navegador. `NO_BROWSER` evita isso, e o
 * limite de tempo derruba o processo se ele esperar por um código no terminal.
 *
 * Verdadeiro: logado. Falso: o CLI pediu login. Nulo: não deu para saber
 * (tempo esgotado, versão sem ACP...).
 */
export const verificarLoginDoGemini: VerificadorDeLogin = async (executavel) => {
  const perfil = criarPerfilDoGemini(executavel);
  const comando = perfil.comando();
  const fachada = new FachadaAcp(
    {
      executavel: comando.executavel,
      argumentos: comando.argumentosIniciais,
      pasta: tmpdir(),
      ambiente: { ...perfil.ambiente(ambienteSemSessaoPai(process.env)), NO_BROWSER: "true" },
      dono: { orquestradorId: "catalogo-de-motores", sessaoId: "catalogo-de-motores" },
      nomeDoCli: perfil.nomeDoCli,
      informacoesDoCliente: { nome: "orquestrador-de-agentes", versao: "1.0.0" },
    },
    { aoAtualizar: () => undefined, aoPedirPermissao: async () => null },
  );
  const limite = setTimeout(() => fachada.derrubar(), LIMITE_DA_VERIFICACAO_MS);
  try {
    await fachada.inicializar();
    const sessao = await fachada.novaSessao(tmpdir(), []);
    await fachada.fecharSessao(sessao.sessaoId);
    return true;
  } catch (erro) {
    if (erro instanceof ErroJsonRpc && perfil.ehFaltaDeLogin(erro.message, erro.codigo)) {
      return false;
    }
    return null;
  } finally {
    clearTimeout(limite);
    await fachada.encerrarComCalma();
  }
};
