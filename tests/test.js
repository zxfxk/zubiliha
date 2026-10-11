// Проверки на выдуманных данных: node tests/test.js (нужны devDependencies: npm install).
const assert = require('assert');
const C = require('../app/core.js');
global.Core = C;
const Gen = require('../app/gen.js');
const D = require('docx');
const ExcelJS = require('exceljs');

const stops = C.parseStops(C.DEFAULT_STOPS);
const vk = [
  'Анна Иванова',
  'Не ношу маску',
  '12.10Иванова А-поле, Пионер/Фрунзе',
  '12.10 Петрова Л Пурих5 цех',
  '12.10Сидорова Н. Пурех-Пятëрка, поле',
  '12 10 Громов Д Громова Е цех пионерская- фрунзе',
  '12.10 Дорохин Д. Шалдёжка поле.',
  '12.10 Марыкина. Л пурих 5,цех',
  'Мария вышла из чата',
  '11.10 орлов а/стекляшка',
  '12.10 Кузин В черныш 5ка поле',
  '12.10 Аксенов Б шалдеж поле',
  '12.10 Попов Ж непонятноегде поле',
].join('\n');
const r = C.parseVk(vk, 12, 10, stops);
const got = r.people.map((p) => [C.personLabel(p), p.stop, p.kind]);
assert.deepStrictEqual(got, [
  ['Иванова А', 'Фрунзе/Пионерская', 'поле'],
  ['Петрова Л', 'Пурех 5ка', 'цех'],
  ['Сидорова Н', 'Пурех 5ка', 'поле'],
  ['Громов Д', 'Фрунзе/Пионерская', 'цех'],
  ['Громова Е', 'Фрунзе/Пионерская', 'цех'],
  ['Дорохин Д', 'Шалдежка', 'поле'],
  ['Марыкина Л', 'Пурех 5ка', 'цех'],
  ['Кузин В', 'Чернышевского', 'поле'],
  ['Аксенов Б', 'Шалдеж', 'поле'],
  ['Попов Ж', 'Непонятноегде', 'поле'],
]);
assert.ok(r.people[9].flags.includes('остановка не распознана'));
assert.strictEqual(r.skipped.filter((s) => s.reason === 'другая дата').length, 1);

assert.strictEqual(C.accusative('Петрова Э'), 'Петрову Э');
assert.strictEqual(C.accusative('Соколов К'), 'Соколова К');
assert.strictEqual(C.accusative('Шульц Е'), 'Шульц Е');
assert.strictEqual(C.translit('Зубилиха'), 'Zubilikha');
assert.strictEqual(Gen.places(18), '18 мест');
assert.strictEqual(Gen.places(21), '21 место');

// День: 3 газели, третья в цех.
const day = C.newDay();
day.date = '2026-10-12';
day.brigadier = 'Тестов';
day.gazelles.forEach((g, i) => { g.number = String(100 + i); g.capacity = [19, 18, 19][i]; });
day.gazelles[2].kind = 'Цех';
let k = 0;
[19, 17, 5].forEach((n, gi) => {
  for (let i = 0; i < n; i++) {
    k++;
    day.people.push({ id: 'p' + k, surname: 'Тестов' + k, initial: 'А', stop: 'Рынок', gazId: day.gazelles[gi].id, status: k % 9 === 0 ? 'noshow' : 'ok', flags: [] });
  }
});
day.people.push({ id: 'x', surname: 'Отказов', initial: 'О', stop: 'Рынок', gazId: day.gazelles[0].id, status: 'refused', flags: [] });

// В Word все 41 человек в газелях (без отказа), в Excel — 37 вышедших.
day.latinNames = true;
assert.deepStrictEqual(C.fileNames(day), { word: '12_10_41chel_Zubilikha.docx', excel: '12_10_37chel_Zubilikha.xlsx' });
day.latinNames = false;
assert.deepStrictEqual(C.fileNames(day), { word: '12_10_41чел_Зубилиха.docx', excel: '12_10_37чел_Зубилиха.xlsx' });

(async () => {
  const buf = await D.Packer.toBuffer(Gen.buildWord(day, D));
  assert.ok(buf.length > 5000);
  const wb = Gen.buildExcel(day, ExcelJS);
  const ws = wb.worksheets[0];
  assert.strictEqual(ws.name, 'октябрь');
  assert.strictEqual(ws.getCell('H5').value, 'Тестов1 А');
  assert.strictEqual(ws.getCell('B5').value, 'Тестов37 А');
  // Поле: 36 человек, 4 не вышли → 32; итог через строку после последнего.
  assert.strictEqual(ws.getCell('H38').value, '4500 × 32 = 144000');
  assert.strictEqual(ws.getCell('B11').value, '4500 × 5 = 22500');
  await wb.xlsx.writeBuffer();

  // Сборная газель цех/поле и машина.
  const d2 = C.newDay();
  d2.date = '2026-09-22';
  d2.brigadier = 'Тестов';
  d2.gazelles = [C.newGazelle(), C.newGazelle()];
  const [mix, car] = d2.gazelles;
  mix.kind = 'Цех/поле'; mix.number = '601'; mix.capacity = 18; mix.payShop = '3000'; mix.pay = '3500'; mix.workShop = 'Имбирь';
  car.vehicle = 'машина'; car.carName = 'тойота королла'; car.number = '685'; car.capacity = 5;
  const add = (s, g, kind, status) => d2.people.push({ id: C.uid(), surname: s, initial: 'А', stop: 'Рынок', kind, gazId: g.id, status: status || 'ok', flags: [] });
  add('Поляков', mix, 'поле'); add('Цехова', mix, 'цех'); add('Яковлев', mix, 'цех'); add('Водилов', car, 'поле');
  assert.deepStrictEqual(C.peopleOf(d2, mix).map((p) => p.surname), ['Цехова', 'Яковлев', 'Поляков']);
  const ws2 = Gen.buildExcel(d2, ExcelJS).worksheets[0];
  assert.strictEqual(ws2.getCell('B5').value, 'Цехова А');
  assert.strictEqual(ws2.getCell('F5').value, 3000);
  assert.strictEqual(ws2.getCell('C5').value, 'имбирь');
  assert.strictEqual(ws2.getCell('I5').value, 'уборка пекинки');
  assert.strictEqual(Gen.workText(d2, mix), 'Цех: Имбирь, поле: Уборка пекинки');
  assert.strictEqual(Gen.payText(d2, mix), 'цех 3000 / поле 3500');
  assert.strictEqual(ws2.getCell('H5').value, 'Поляков А');
  assert.strictEqual(ws2.getCell('L5').value, 3500);
  assert.strictEqual(ws2.getCell('H6').value, 'Водилов А');
  assert.strictEqual(ws2.getCell('L6').value, 4500);
  assert.strictEqual(ws2.getCell('H8').value, 'Итого: 8000');
  await D.Packer.toBuffer(Gen.buildWord(d2, D));

  // Бензин водителю машины, без бригадира — без него в имени файла и в Excel.
  car.fuel = '1000';
  d2.people.find((p) => p.surname === 'Водилов').driver = true;
  d2.brigadier = '';
  const ws3 = Gen.buildExcel(d2, ExcelJS).worksheets[0];
  assert.strictEqual(ws3.getCell('L6').value, 5500);
  assert.strictEqual(ws3.getCell('C2').value, null);
  car.fuel = '1000';
  d2.people.find((p) => p.surname === 'Водилов').driver = false;
  assert.ok(C.warnings(d2).some((w) => /бензин/.test(w)));
  d2.people.find((p) => p.surname === 'Водилов').driver = true;
  // В машине нет строки «По остановкам прошу отписаться».
  const JSZip = require('jszip');
  const xml = await (await JSZip.loadAsync(await D.Packer.toBuffer(Gen.buildWord(d2, D)))).file('word/document.xml').async('string');
  assert.strictEqual((xml.match(/прошу отписаться/g) || []).length, 1);

  // Сортировка во всех газелях: по остановкам, внутри по фамилиям.
  const d3 = C.newDay();
  const g3 = d3.gazelles[0];
  [['Бобров', 'Рынок'], ['Алов', 'Художка'], ['Ахов', 'Рынок'], ['Без', '']].forEach(([s, st]) => d3.people.push({ id: C.uid(), surname: s, initial: 'А', stop: st, gazId: g3.id, status: 'ok' }));
  C.sortAll(d3, 'stop');
  assert.deepStrictEqual(d3.people.map((p) => p.surname), ['Без', 'Ахов', 'Бобров', 'Алов']);
  C.sortAll(d3, 'name');
  assert.deepStrictEqual(d3.people.map((p) => p.surname), ['Алов', 'Ахов', 'Без', 'Бобров']);

  C.sortAlpha(d2, mix.id);
  assert.deepStrictEqual(d2.people.filter((p) => p.gazId === mix.id).map((p) => p.surname), ['Поляков', 'Цехова', 'Яковлев']);

  const r2 = C.parseVk('22.09 Иванова А рынок поле 8 912 345-67-89', 22, 9, stops);
  assert.strictEqual(r2.people[0].phone, '+7 912 345-67-89');
  assert.strictEqual(r2.people[0].stop, 'Рынок');
  assert.deepStrictEqual(r2.people[0].flags, []);

  // Этап 2: распределение по зонам.
  {
    const mk = (spec) => {
      const d = C.newDay(); d.people = []; let n = 0;
      spec.forEach(([st, c, k, raw]) => { for (let i = 0; i < c; i++) d.people.push({ id: 'a' + n, surname: 'Тест' + (n++), initial: 'А', stop: st, kind: k || 'поле', status: 'ok', gazId: '', raw: raw || '' }); });
      return d;
    };
    const zonesOf = (r) => r.vans.map((v) => v.zones.map((z) => z.zone.replace(/:.*/, '') + ':' + z.count).join(','));
    // Две зоны в две газели, деревни к людям, а не в пустую третью.
    let d = mk([['Рынок', 12], ['Художка', 8], ['Зименки', 3]]);
    let r = C.autoAssign(d, stops, 'all');
    assert.deepStrictEqual(zonesOf(r), ['зона 1:12', 'зона 2:8,деревни:3', '']);
    assert.strictEqual(r.left.length, 0);
    // Цех — в сборную газель, поле по зонам; машина не трогается.
    d = mk([['Рынок', 10], ['Стекляшка', 10], ['Пурех 5ка', 3, 'цех']]);
    d.gazelles[2].kind = 'Цех/поле';
    const car = C.newGazelle(); car.vehicle = 'машина'; car.capacity = 5; d.gazelles.push(car);
    d.people.push({ id: 'drv', surname: 'Водитель', initial: 'В', stop: 'Рынок', kind: 'поле', status: 'ok', gazId: car.id, driver: true });
    r = C.autoAssign(d, stops, 'all');
    assert.strictEqual(d.people.find((p) => p.id === 'drv').gazId, car.id);
    assert.ok(d.people.filter((p) => p.kind === 'цех').every((p) => p.gazId === d.gazelles[2].id));
    assert.strictEqual(r.left.length, 0);
    // Не хватает мест — лишние остаются без газели; одна строка ВК не делится.
    d = mk([['Рынок', 18], ['Художка', 2, 'поле', 'строка'], ['Художка', 19]]);
    d.gazelles = d.gazelles.slice(0, 2);
    r = C.autoAssign(d, stops, 'all');
    assert.strictEqual(r.left.length, 1);
    const pair = d.people.filter((p) => p.raw === 'строка');
    assert.strictEqual(pair[0].gazId, pair[1].gazId);
    // Только без газели: остальные остаются на местах, новый — к своей зоне.
    d = mk([['Рынок', 5], ['Художка', 5]]);
    C.autoAssign(d, stops, 'all');
    const before = d.people.map((p) => p.gazId);
    d.people.push({ id: 'new', surname: 'Новый', initial: 'Н', stop: 'Стекляшка', kind: 'поле', status: 'ok', gazId: '' });
    C.autoAssign(d, stops, 'free');
    assert.deepStrictEqual(d.people.slice(0, 10).map((p) => p.gazId), before);
    assert.strictEqual(d.people.find((p) => p.id === 'new').gazId, d.people.find((p) => p.stop === 'Художка').gazId);
  }

  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
