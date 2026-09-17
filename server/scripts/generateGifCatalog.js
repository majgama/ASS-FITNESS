import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.resolve(__dirname, '..', 'src', 'data', 'gif-catalog.json');

// Known top-level muscle group / category folder names that already come in Brazilian Portuguese.
const knownPtLabels = new Set([
  'ABDOMINAIS', 'ANTEBRAÇO', 'ANTEBRACO', 'BICEPS', 'BÍCEPS', 'COSTAS', 'OMBROS', 'OMBRO',
  'PANTURRILHAS', 'PANTURRILHA', 'PEITO', 'PERNA', 'PERNAS', 'TRAPÉZIO', 'TRAPEZIO', 'TRICEPS', 'TRÍCEPS',
  'CARDIO', 'ALONGAMENTO', 'MOBILIDADE', 'YOGA', 'TRX', 'KETTLEBELL', 'SUPERBAND', 'MINIBAND',
  'BOLA PILATES', 'MEDICINE BALL', 'CAIXOTE', 'PAREDE', 'PESO', 'PESO CORPORAL', 'STEP', 'STEPS',
  'LIBERAÇÃO MIOFASCIAL', 'LIBERACAO MIOFASCIAL', 'ARGOLAS', 'BANCO', 'BOSU BALL', 'CADEIRA',
  'CORDA NAVAL', 'ESCADA', 'PLIOMETRIA', 'PROPIOCEPÇÃO', 'PROPIOCEPCAO', 'TRAÇÃO', 'TRACAO',
  'ALAVANCA', 'ATIVAÇÃO NEUROMUSCULAR', 'ATIVACAO NEUROMUSCULAR', 'AGILIDADE E COORDENAÇÃO',
  'AGILIDADE E COORDENACAO', 'ESPECÍFICOS MODALIDADES', 'ESPECIFICOS MODALIDADES'
]);

// Word-by-word dictionary translator for the English exercise filenames.
// Longer phrases are matched first so multi-word fitness terms translate as a unit.
const phraseDictionary = [
  ['push up', 'flexão'], ['push-up', 'flexão'], ['pull up', 'barra fixa'], ['pull-up', 'barra fixa'],
  ['bench press', 'supino'], ['overhead press', 'desenvolvimento'], ['military press', 'desenvolvimento militar'],
  ['shoulder press', 'desenvolvimento de ombros'], ['leg press', 'leg press'], ['leg curl', 'mesa flexora'],
  ['leg extension', 'cadeira extensora'], ['leg raise', 'elevação de pernas'], ['chest fly', 'crucifixo'],
  ['lat pulldown', 'puxada'], ['bent over row', 'remada curvada'], ['upright row', 'remada alta'],
  ['romanian deadlift', 'levantamento terra romeno'], ['deadlift', 'levantamento terra'],
  ['hip thrust', 'elevação pélvica'], ['glute bridge', 'ponte de glúteo'], ['side lunge', 'afundo lateral'],
  ['reverse lunge', 'afundo reverso'], ['split squat', 'agachamento búlgaro'], ['jump rope', 'pular corda'],
  ['jumping jack', 'polichinelo'], ['mountain climber', 'escalador'], ['knee raise', 'elevação de joelho'],
  ['knee drive', 'elevação de joelho'], ['high knee', 'joelho alto'], ['butt kick', 'chute no glúteo'],
  ['calf raise', 'elevação de panturrilha'], ['triceps extension', 'extensão de tríceps'],
  ['triceps kickback', 'tríceps coice'], ['biceps curl', 'rosca bíceps'], ['hammer curl', 'rosca martelo'],
  ['front raise', 'elevação frontal'], ['lateral raise', 'elevação lateral'], ['rear delt', 'deltoide posterior'],
  ['side plank', 'prancha lateral'], ['front plank', 'prancha frontal'], ['plank', 'prancha'],
  ['sit up', 'abdominal'], ['sit-up', 'abdominal'], ['crunch', 'abdominal supra'], ['russian twist', 'torção russa'],
  ['woodchopper', 'lenhador'], ['downward dog', 'cão olhando para baixo'], ['child pose', 'postura da criança'],
  ['warrior pose', 'postura do guerreiro'], ['pigeon pose', 'postura do pombo'], ['cat cow', 'gato e vaca'],
  ['hamstring stretch', 'alongamento de posterior de coxa'], ['quadriceps stretch', 'alongamento de quadríceps'],
  ['hip flexor', 'flexor de quadril'], ['calf stretch', 'alongamento de panturrilha'],
  ['neck stretch', 'alongamento de pescoço'], ['back stretch', 'alongamento de costas'],
  ['chest stretch', 'alongamento de peito'], ['shoulder stretch', 'alongamento de ombro'],
  ['squat', 'agachamento'], ['lunge', 'afundo'], ['step up', 'subida no step'], ['step-up', 'subida no step'],
  ['burpee', 'burpee'], ['sprint', 'sprint'], ['skip', 'skip'], ['kick', 'chute'], ['punch', 'soco'],
  ['clean and jerk', 'arranco e arremesso'], ['snatch', 'arranco'], ['thruster', 'thruster'],
  ['farmer walk', 'caminhada do fazendeiro'], ['bear crawl', 'urso rastejante'], ['duck walk', 'caminhada do pato'],
  ['bird dog', 'postura cão de aponte'], ['superman', 'super-homem'], ['dead bug', 'inseto morto'],
  ['box jump', 'salto na caixa'], ['broad jump', 'salto em distância'], ['tuck jump', 'salto agrupado']
];

const wordDictionary = {
  the: '', a: '', an: '', of: 'de', with: 'com', without: 'sem', and: 'e', to: 'para', on: 'em', in: 'em',
  from: 'de', into: 'para', over: 'sobre', under: 'sob', between: 'entre', behind: 'atrás', front: 'frente',
  back: 'costas', side: 'lateral', sides: 'laterais', up: 'para cima', down: 'para baixo', out: 'para fora',
  standing: 'em pé', sitting: 'sentado', seated: 'sentado', lying: 'deitado', kneeling: 'ajoelhado',
  bodyweight: 'peso corporal', barbell: 'barra', dumbbell: 'halteres', dumbbells: 'halteres', kettlebell: 'kettlebell',
  cable: 'cabo', band: 'faixa', bands: 'faixas', chair: 'cadeira', bench: 'banco', box: 'caixote', ball: 'bola',
  bosu: 'bosu', wall: 'parede', towel: 'toalha', rope: 'corda', stick: 'bastão', pillow: 'almofada',
  alternate: 'alternado', alternating: 'alternado', single: 'unilateral', double: 'duplo', wide: 'aberto',
  narrow: 'fechado', close: 'fechado', grip: 'pegada', reverse: 'reverso', forward: 'para frente',
  backward: 'para trás', diagonal: 'diagonal', circle: 'círculo', circles: 'círculos', rotation: 'rotação',
  raise: 'elevação', raises: 'elevações', press: 'pressão', pull: 'puxada', push: 'empurrão', row: 'remada',
  fly: 'crucifixo', extension: 'extensão', flexion: 'flexão', curl: 'rosca', kickback: 'coice', swing: 'balanço',
  stretch: 'alongamento', stretching: 'alongamento', pose: 'postura', hold: 'segurar', walk: 'caminhada',
  walking: 'caminhando', march: 'marcha', marching: 'marchando', jump: 'salto', jumping: 'saltando',
  hop: 'salto curto', hops: 'saltos curtos', tap: 'toque', taps: 'toques', touch: 'toque', high: 'alto',
  low: 'baixo', half: 'meio', full: 'completo', slow: 'lento', quick: 'rápido', fast: 'rápido',
  arm: 'braço', arms: 'braços', leg: 'perna', legs: 'pernas', knee: 'joelho', knees: 'joelhos',
  ankle: 'tornozelo', ankles: 'tornozelos', foot: 'pé', feet: 'pés', hip: 'quadril', hips: 'quadris',
  shoulder: 'ombro', shoulders: 'ombros', elbow: 'cotovelo', elbows: 'cotovelos', wrist: 'punho', wrists: 'punhos',
  chest: 'peito', spine: 'coluna', waist: 'cintura', abdominal: 'abdominal', abs: 'abdômen',
  glute: 'glúteo', glutes: 'glúteos', thigh: 'coxa', thighs: 'coxas', calf: 'panturrilha', calves: 'panturrilhas',
  neck: 'pescoço', overhead: 'acima da cabeça', floor: 'chão', ground: 'chão', supported: 'apoiado',
  assisted: 'assistido', weighted: 'com peso', beginner: 'iniciante', advanced: 'avançado', version: 'versão',
  male: 'masculino', female: 'feminino', open: 'aberto', crossover: 'cruzado',
  cross: 'cruzado', straight: 'reto', bent: 'flexionado', deep: 'profundo', shallow: 'raso', dynamic: 'dinâmico',
  static: 'estático', isometric: 'isométrico', pulse: 'pulso', pulsing: 'pulsando', hollow: 'oco',
  superset: 'superserie', combo: 'combinado', explosive: 'explosivo', jack: 'polichinelo',
  crunches: 'abdominais', bridge: 'ponte', pike: 'pique', dip: 'mergulho', dips: 'mergulhos',
  rest: 'descanso', clap: 'palma', claps: 'palmas', reach: 'alcance', reaches: 'alcances',
  twist: 'torção', twisting: 'torcendo', rotate: 'girar', prone: 'em prono', supine: 'em supino',
  staircase: 'escada', bell: 'sino', mat: 'colchonete', bicycle: 'bicicleta', recline: 'reclinado',
  reclined: 'reclinado', resistance: 'resistência', drag: 'arrasto', doorway: 'vão da porta',
  bend: 'inclinação', thrust: 'impulso', plyometrics: 'pliometria', upper: 'superior', lower: 'inferior',
  toe: 'dedo do pé', toes: 'dedos dos pés', heel: 'calcanhar', heels: 'calcanhares', outer: 'externo',
  inner: 'interno', assist: 'assistido', pillar: 'pilar', ladder: 'escada', stair: 'escada', stool: 'banquinho',
  padded: 'acolchoado', pad: 'apoio', incline: 'inclinado', decline: 'declinado', flat: 'reto',
  hold2: 'segurar', pulldown: 'puxada', pushdown: 'empurrada para baixo', row2: 'remada'
};

function translatePhrase(text) {
  let result = text.toLowerCase();
  for (const [en, pt] of phraseDictionary) {
    result = result.split(en).join(pt);
  }
  const words = result.split(/\s+/).filter(Boolean);
  const translated = words.map((word) => {
    if (wordDictionary[word] !== undefined) return wordDictionary[word];
    return word;
  });
  return translated.filter(Boolean).join(' ');
}

function toTitleCase(text) {
  return text
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function cleanFileName(fileName) {
  let name = fileName.replace(/\.gif$/i, '');
  name = name.replace(/_converted( ?\d*)?$/i, '');
  name = name.replace(/\((male|female)\)/gi, '');
  name = name.replace(/[_]+/g, ' ');
  name = name.replace(/-/g, ' ');
  name = name.replace(/\bFIX\d*\b/gi, '');
  name = name.replace(/\bcopy\b/gi, '');
  name = name.replace(/\s+\d+$/g, '');
  name = name.replace(/\s{2,}/g, ' ').trim();
  return name;
}

function extractMuscleTag(fileName) {
  const match = fileName.match(/_([A-Za-z-]+)_{1,2}(?:converted)/i);
  return match ? match[1].replace(/-/g, ' ') : null;
}

const muscleTagTranslation = {
  chest: 'Peito', back: 'Costas', shoulders: 'Ombros', hips: 'Quadril', thighs: 'Coxas',
  calves: 'Panturrilhas', 'upper arms': 'Braços', forearms: 'Antebraço', waist: 'Cintura/Abdômen',
  neck: 'Pescoço', cardio: 'Cardio', plyometrics: 'Pliometria', stretching: 'Alongamento',
  pilates: 'Pilates', feet: 'Pés', face: 'Face', hands: 'Mãos'
};

function walk(dir, segments, entries) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name === 'desktop.ini' || item.name.startsWith('.')) continue;
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      walk(fullPath, [...segments, item.name], entries);
    } else if (item.isFile() && item.name.toLowerCase().endsWith('.gif')) {
      entries.push({ segments: [...segments], fileName: item.name, fullPath });
    }
  }
}

function buildCatalog() {
  const root = env.gifLibraryDir;
  if (!fs.existsSync(root)) {
    console.error(`Gif library directory not found: ${root}`);
    process.exitCode = 1;
    return;
  }

  const rawEntries = [];
  walk(root, [], rawEntries);

  const catalog = rawEntries.map(({ segments, fileName, fullPath }) => {
    const relativePath = path.join(...segments, fileName).split(path.sep).join('/');
    const gender = segments[0] || null;
    const environment = segments[1] || null;
    const categoryPath = segments.slice(2);
    const lastFolder = categoryPath[categoryPath.length - 1] || null;

    let muscleGroupPt = null;
    if (lastFolder && knownPtLabels.has(lastFolder.toUpperCase())) {
      muscleGroupPt = toTitleCase(lastFolder.toLowerCase());
    } else {
      const tag = extractMuscleTag(fileName);
      if (tag) {
        muscleGroupPt = muscleTagTranslation[tag.toLowerCase()] || toTitleCase(tag);
      }
    }

    const cleanedEn = cleanFileName(fileName);
    const tag = extractMuscleTag(fileName);
    let cleanedForTranslation = cleanedEn;
    if (tag) {
      const tagPattern = new RegExp(`\\s+${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      cleanedForTranslation = cleanedForTranslation.replace(tagPattern, '');
    }
    const namePt = toTitleCase(translatePhrase(cleanedForTranslation)) || cleanedEn;
    const stat = fs.statSync(fullPath);

    const id = crypto.createHash('sha1').update(relativePath).digest('hex');

    return {
      id,
      relativePath,
      gender,
      environment,
      categoryPath,
      muscleGroupPt,
      nameEn: cleanedEn,
      namePt,
      sizeBytes: stat.size
    };
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(catalog), 'utf8');
  console.log(`Catalog generated with ${catalog.length} entries -> ${outputPath}`);
}

buildCatalog();
