import { parseJibunToParams } from '../src/lib/jibun';
import fs from 'node:fs';
const bjdong = JSON.parse(fs.readFileSync('public/data/regions/11170/bjdong.json', 'utf-8')).bjdong;
const places = JSON.parse(fs.readFileSync('public/data/regions/11170/places.json', 'utf-8'));
let ok = 0, fail = 0;
const failSamples: string[] = [];
for (const p of places) {
  if (!p.jibunAddress) { fail++; continue; }
  const r = parseJibunToParams(p.jibunAddress, '서울특별시 용산구', bjdong);
  if (r) ok++;
  else { fail++; if (failSamples.length < 5) failSamples.push(p.jibunAddress); }
}
console.log('파싱 성공', ok, '/', places.length, '실패', fail);
console.log('실패 표본:', failSamples);
console.log('예시:', JSON.stringify(parseJibunToParams(places[0].jibunAddress, '서울특별시 용산구', bjdong)), '<-', places[0].jibunAddress);
