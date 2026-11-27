// O xterm com o ajuste ao tamanho e o CSS dele, num pedaço à parte do pacote:
// o NoShell importa este arquivo sob demanda, quando o primeiro shell abre.
import "@xterm/xterm/css/xterm.css";

export { FitAddon } from "@xterm/addon-fit";
export { Terminal } from "@xterm/xterm";
