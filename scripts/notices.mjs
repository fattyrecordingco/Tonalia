import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const target=process.platform==='win32'?'x86_64-pc-windows-msvc':process.platform==='darwin'?`${process.arch==='arm64'?'aarch64':'x86_64'}-apple-darwin`:'x86_64-unknown-linux-gnu';
const cargo=spawnSync('cargo',['metadata','--locked','--format-version','1','--filter-platform',target],{encoding:'utf8',maxBuffer:64*1024*1024});
if(cargo.status!==0)throw new Error(cargo.stderr||'Cargo metadata failed while gathering notices.');
const metadata=JSON.parse(cargo.stdout);
const sections=['# Third-party notices\n\nGenerated from the pinned local dependency manifests. Original licence text follows where supplied.\n'];
const inventory=[];
async function collect(name,version,license,root,extra){
 const names=(await readdir(root)).filter(n=>/^licen[sc]e|^copying|^copyright|^ofl/i.test(n));
 if(extra)names.push(extra);
 const texts=[];
 for(const file of [...new Set(names)]){try{texts.push(`--- ${file} ---\n${await readFile(join(root,file),'utf8')}`);}catch{}}
 sections.push(`\n\n## ${name} ${version}\nSPDX: ${license||'See upstream package'}\n\n${texts.join('\n\n')||'No root licence text supplied; consult the upstream package and SPDX licence expression.'}`);
 inventory.push({name,version,license:license||null,texts:names.length});
}
for(const p of metadata.packages.sort((a,b)=>a.name.localeCompare(b.name))){if(!metadata.workspace_members.includes(p.id))await collect(p.name,p.version,p.license,dirname(p.manifest_path),p.license_file);}
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
for(const [path,entry] of Object.entries(lock.packages)){if(!path||entry.dev)continue;const root=resolve(path);const p=JSON.parse(await readFile(join(root,'package.json'),'utf8'));await collect(p.name,p.version,p.license,root);}
await mkdir('apps/web/public/licenses',{recursive:true});
await writeFile('apps/web/public/licenses/THIRD-PARTY.txt',sections.join('\n'));
await writeFile('apps/web/public/licenses/inventory.json',JSON.stringify(inventory,null,2)+'\n');
console.log(`Collected notices for ${inventory.length} dependencies (${target}).`);
