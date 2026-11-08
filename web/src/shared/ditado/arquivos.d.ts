// Importação de arquivo como URL ("?url"), resolvida pelo Vite no build.
declare module "*?url" {
  const url: string;
  export default url;
}
