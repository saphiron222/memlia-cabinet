import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=new URL('../packages/ui/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('PROVENANCE.json',base),'utf8'));
for(const file of manifest.files){const digest=createHash('sha256').update(await readFile(new URL(file.local,base))).digest('hex');if(digest!==file.sha256Adapted)throw new Error('Empreinte UI différente : '+file.local);if(!file.adaptations.length&&digest!==file.sha256Original)throw new Error('Adaptation non déclarée : '+file.local)}
console.log(`${manifest.files.length} fichiers Twenty vérifiés, révision ${manifest.revision}.`);
