// index.html 에서 떼어 낸 파일(/js/app-*.js · /css/app.css · /shared/rules.js) 점검.  node tests/assets-unit.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stamp } from '../tools/stamp-assets.mjs';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('✗', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const html = readFileSync('index.html', 'utf8');
const { stale, files } = stamp(html);
ok('?v= 가 파일 내용과 일치 (아니면 node tools/stamp-assets.mjs)', stale === 0, stale);
const js = files.filter(f => f.startsWith('/js/'));
const onDisk = readdirSync('js').filter(f => /^app-\d+-[\w-]+\.js$/.test(f)).sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
ok('js/ 의 모든 파일을 index.html 이 번호 순서대로 읽음', JSON.stringify(js) === JSON.stringify(onDisk.map(f => '/js/' + f)), [js, onDisk]);
ok('번호가 1부터 빠짐없이', onDisk.every((f, i) => parseInt(f.slice(4)) === i + 1));
ok('css·rules 도 읽음', files.includes('/css/app.css') && files.includes('/shared/rules.js'));
ok('rules.js → supabase → 본 스크립트 순서', html.indexOf('/shared/rules.js') < html.indexOf('/js/app-1-') && html.indexOf('/vendor/supabase/') < html.indexOf('/js/app-1-'));
for (const f of onDisk) { let good = true; try { execFileSync(process.execPath, ['--check', 'js/' + f], { stdio: 'pipe' }); } catch (_) { good = false; } ok(`문법: js/${f}`, good); }
ok('index.html 에 큰 인라인 스크립트가 다시 생기지 않음', html.split('\n').length < 2500, html.split('\n').length);
ok('자산은 절대 경로(경로형 주소 셸에서도 동작)', !/(?:src|href)="(?:js|css|shared)\//.test(html));
ok('css/app.css 존재', existsSync('css/app.css') && readFileSync('css/app.css', 'utf8').includes('--wds-primary'));
// 다른 파일의 함수를 로드 시점에 바로 부르는 최상위 호출 금지 — 허용 목록 밖의 최상위 `이름(...)` 문장이 생기면 알린다
const eager = [];
for (const f of onDisk) readFileSync('js/' + f, 'utf8').split('\n').forEach((l, i) => { if (/^ {8}[A-Za-z_$][\w$]*\(.*\);?\s*(\/\/.*)?$/.test(l) && !/^ {8}(if|for|while|switch|return|function|async)\b/.test(l)) eager.push(`${f}:${i + 1} ${l.trim().slice(0, 40)}`); });
ok('최상위 즉시 호출은 마지막 파일의 initTheme() 뿐', eager.length === 1 && /initTheme\(\)/.test(eager[0]) && eager[0].startsWith(onDisk[onDisk.length - 1]), eager);
console.log(`${pass + fail}개 중 ${pass} 통과`);
process.exit(fail ? 1 : 0);
