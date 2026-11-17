import { tmpdir } from "node:os";

import { ambienteSemSessaoPai } from "../claudecode/ArgumentosDoClaudeCode";
import { VerificadorDeLogin } from "../motores/CatalogoDeMotores";
import { ErroJsonRpc } from "../motores/ProcessoJsonRpc";
import { FachadaAcp } from "./FachadaAcp";
import { criarPerfilDoCopilot } from "./PerfilDoCopilot";

const LIMITE_DA_VERIFICACAO_MS = 20_000;

/** O método de autenticação que o Copilot anuncia no `initialize` (`authMethods`). */
const METODO_DE_LOGIN_DO_COPILOT = "copilot-login";

/**
 * O Copilot CLI não tem um comando que diga se há login. O ACP diz: o
 * `authenticate` responde vazio a quem entrou e "Authentication required"
 * (-32000) a quem não entrou, sem abrir sessão nem chamar o modelo — não gasta
 * cota nem deixa sessão vazia na lista do CLI (verificado no Copilot 1.0.83).
 *
 * Verdadeiro: logado. Falso: o CLI pediu login. Nulo: não deu para saber
 * (tempo esgotado, versão sem ACP...).
 */
export const verificarLoginDoCopilot: VerificadorDeLogin = async (executavel) => {
  const perfil = criarPerfilDoCopilot(executavel);
  const comando = perfil.comando();
  const fachada = new FachadaAcp(
    {
      executavel: comando.executavel,
      argumentos: comando.argumentosIniciais,
      pasta: tmpdir(),
      ambiente: perfil.ambiente(ambienteSemSessaoPai(process.env)),
      dono: { orquestradorId: "catalogo-de-motores", sessaoId: "catalogo-de-motores" },
      nomeDoCli: perfil.nomeDoCli,
      informacoesDoCliente: { nome: "orquestrador-de-agentes", versao: "1.0.0" },
    },
    { aoAtualizar: () => undefined, aoPedirPermissao: async () => null },
  );
  const limite = setTimeout(() => fachada.derrubar(), LIMITE_DA_VERIFICACAO_MS);
  try {
    await fachada.inicializar();
    await fachada.autenticar(METODO_DE_LOGIN_DO_COPILOT);
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
