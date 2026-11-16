const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

// Apply Windows branding without running a Windows executable on the build host.
module.exports = async context => {
  if(context.electronPlatformName !== 'win32')return;
  const target=path.join(context.appOutDir,'ZigZak Player.exe');
  const executable=ResEdit.NtExecutable.from(fs.readFileSync(target),{ignoreCert:true});
  const resources=ResEdit.NtExecutableResource.from(executable);
  const icon=ResEdit.Data.IconFile.from(fs.readFileSync(path.join(context.packager.projectDir,'resources/icon.ico')));
  const groups=ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  for(const group of groups.length ? groups : [{id:1,lang:1033}]) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icon.icons.map(item=>item.data));
  const versions=ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  for(const info of versions.length ? versions : [ResEdit.Resource.VersionInfo.createEmpty()]) {
    info.setFileVersion('1.0.0.0');info.setProductVersion('1.0.0.0');
    const languages=info.getAllLanguagesForStringValues();
    for(const language of languages.length ? languages : [{lang:1033,codepage:1200}]) info.setStringValues(language,{CompanyName:'ZigZak',FileDescription:'ZigZak Player — Music & Video',ProductName:'ZigZak Player',InternalName:'ZigZak Player',OriginalFilename:'ZigZak Player.exe',LegalCopyright:'Copyright © 2026 ZigZak Player contributors',FileVersion:'1.0.0',ProductVersion:'1.0.0'});
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  fs.writeFileSync(target,Buffer.from(executable.generate()));
};
