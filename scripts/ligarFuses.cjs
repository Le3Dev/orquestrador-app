// Hook afterPack do electron-builder: liga os fuses do Electron no executavel empacotado.
// (electron-builder 25.1.8 ainda nao tem a opcao `electronFuses`.)
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

module.exports = async function ligarFuses(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const nome = packager.appInfo.productFilename;
  let executavel;
  if (electronPlatformName === 'win32') executavel = path.join(appOutDir, `${nome}.exe`);
  else if (electronPlatformName === 'darwin') executavel = path.join(appOutDir, `${nome}.app`);
  else executavel = path.join(appOutDir, packager.executableName);

  try {
    await flipFuses(executavel, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: electronPlatformName === 'darwin',
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    });
  } catch (erro) {
    throw new Error(`Falha ao ligar os fuses em ${executavel}: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
};
