// Packs the production build (dist/) into a JATOS study archive (JZIP) for one study config:
// node scripts/build-jatos.mjs <study-id> [--no-face]. npm test checks the configs themselves.
// A custom face comes from public/wads/face-<id>.wad (npm run build:face); --no-face leaves it
// out for the deploy workflow, which adds it from a secret.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { readWad } from './lib/wad.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const studyId = process.argv[2];
if (!studyId || !/^[a-z0-9-]+$/.test(studyId)) {
  throw new Error('Usage: npm run build:jatos -- <study-id> [--no-face] (a file in public/studies, without .json)');
}
const config = JSON.parse(readFileSync(resolve(root, `public/studies/${studyId}.json`), 'utf8'));
if (config.save?.target !== 'jatos' || !config.jatos) {
  throw new Error(`public/studies/${studyId}.json must have save.target "jatos" and the jatos UUIDs.`);
}
const dirName = `jspsych-fps-lab-${studyId}`;
const study = {
  version: '3',
  data: {
    uuid: config.jatos.study_uuid,
    title: config.title,
    description: `Study config public/studies/${studyId}.json, jspsych-fps-lab ${version}.`,
    groupStudy: false,
    linearStudy: false,
    allowPreview: false,
    dirName,
    comments: 'Built by npm run build:jatos. Re-importing overwrites these properties.',
    jsonData: null,
    endRedirectUrl: '',
    studyEntryMsg: null,
    componentList: [
      {
        uuid: config.jatos.component_uuid,
        title: 'Doom study',
        htmlFilePath: 'index.html',
        reloadable: true,
        active: true,
        comments: '',
        jsonData: JSON.stringify({ study: studyId }),
      },
    ],
    batchList: [
      {
        uuid: config.jatos.batch_uuid,
        title: 'Default',
        active: true,
        maxActiveMembers: null,
        maxTotalMembers: null,
        maxTotalWorkers: null,
        allowedWorkerTypes: ['Jatos', 'PersonalMultiple', 'GeneralMultiple'],
        comments: null,
        jsonData: null,
      },
    ],
  },
};
// Only what the production build loads plus Freedoom's licence; miniwad never ships.
const iwad = JSON.parse(readFileSync(resolve(root, 'src/paradigms/iwad.json'), 'utf8'));
const WADS = [
  `${config.iwad ?? iwad.name}.gz`,
  'freedoom-COPYING.txt',
  'freedoom-CREDITS.txt',
  'manifest.json',
  ...(config.wads ?? []),
];
const STUDIES = ['schema.json', `${studyId}.json`];

function distFiles() {
  return readdirSync(dist, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dist, resolve(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((path) => !path.startsWith('wads/') || WADS.includes(path.slice('wads/'.length)))
    .filter((path) => !path.startsWith('studies/') || STUDIES.includes(path.slice('studies/'.length)))
    .filter((path) => path !== 'builder.html')
    .sort();
}

function addJatosScript(html) {
  const withScript = html.replace('<head>', '<head>\n    <script src="jatos.js"></script>');
  if (withScript === html) throw new Error('dist/index.html has no <head> tag.');
  return withScript;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const deflated = packed.length < data.length;
    const body = deflated ? packed : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01: same input, same archive
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const files = distFiles();
if (!files.includes('index.html')) throw new Error('dist/index.html is missing: run npm run build first.');
for (const name of WADS) {
  if (!files.includes(`wads/${name}`)) {
    throw new Error(`dist/wads/${name} is missing: run npm run fetch:freedoom && npm run build:iwad, then rebuild.`);
  }
}
for (const name of STUDIES) {
  if (!files.includes(`studies/${name}`)) throw new Error(`dist/studies/${name} is missing: run npm run build first.`);
}

const entries = [{ name: 'study.jas', data: Buffer.from(`${JSON.stringify(study, null, 2)}\n`) }];
for (const path of files) {
  const data = readFileSync(resolve(dist, path));
  entries.push({
    name: `${dirName}/${path}`,
    data: path === 'index.html' ? Buffer.from(addJatosScript(data.toString('utf8'))) : data,
  });
}

const face = config.face ?? 'freedoom';
const withFace = face !== 'freedoom' && !process.argv.includes('--no-face');
if (withFace) {
  if (!/^[a-z0-9-]+$/.test(face)) throw new Error(`Invalid face id "${face}".`);
  const facePath = resolve(root, `public/wads/face-${face}.wad`);
  if (!existsSync(facePath)) throw new Error(`public/wads/face-${face}.wad is missing: run npm run build:face -- ${face}.`);
  const data = readFileSync(facePath);
  const { type, lumps } = readWad(data);
  if (type !== 'PWAD' || !lumps.every((lump) => lump.name.startsWith('STF'))) {
    throw new Error(`public/wads/face-${face}.wad must be a PWAD of STF* patches only.`);
  }
  entries.push({ name: `${dirName}/wads/face-${face}.wad`, data });
}

const outDir = resolve(root, 'dist-jatos');
const out = resolve(outDir, `${dirName}-${version}.jzip`);
mkdirSync(outDir, { recursive: true });
const archive = zip(entries);
writeFileSync(out, archive);
console.log(`Wrote ${relative(root, out)} (${(archive.length / 1e6).toFixed(1)} MB, ${entries.length - 1} files).`);
if (withFace) console.log(`It contains the face "${face}": keep it private (no public uploads or artifacts).`);
console.log('Import it in JATOS: Studies > + > Import study.');
