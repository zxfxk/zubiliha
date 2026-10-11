// Логика без интерфейса: справочник остановок, разбор текста из ВК, подсчёты, имена файлов.
(function (root) {
  'use strict';

  // Справочник: строка = остановка, первое значение — как писать в файлах, дальше варианты написания.
  // Строка "# зона ..." начинает зону (для этапа 2: распределение по газелям).
  const DEFAULT_STOPS = [
    '# зона 1: от 3шк до Энергосбыта',
    '3шк, 3 школа, 3 шк заводская',
    'Матрешки',
    'Демократическая, демократич, демокр',
    'П. Зеленый, зеленый',
    'Леспромхоз, леспромх, леспром',
    'Пурех 5ка, Пурех, пурих, пурих 5ка, пурех пятерка',
    'Ошара',
    '3комм, 3 коммуниста, 3 комм, 3-комм',
    'Рынок',
    'Энергосбыт',
    '# зона 2: от Художки до конца',
    'Художка',
    'Стекляшка',
    'Глазова/Пушкина, глаз/пушкина',
    'Глазова/Доспалова, глаз/доспал',
    'Глазова/Фрунзе, глаз/фрунзе',
    'Фрунзе/Пионерская, фрунзе/пионер',
    'Фрунзе/Папанина, фрунзе/папан',
    'Фрунзе/50лет, фрунзе/50л',
    'Чернышевского, черныш, черныш 5ка',
    '# деревни: в любую газель',
    'Зименки',
    'Шалдеж',
    'Шалдежка, шалджежка',
    'Боковая',
  ].join('\n');

  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

  // ---------- нормализация и справочник ----------

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/пят[её]рка|пят[её]ра/g, '5ка')
      .replace(/(\d)\s*-?\s*(ка)\b/g, '$1ка')
      .replace(/([а-яa-z])(\d)/g, '$1 $2')
      .replace(/(\d)(?!ка)([а-яa-z])/g, '$1 $2')
      .replace(/[^а-яa-z0-9]+/g, ' ')
      .trim();
  }

  function tokens(s) { return norm(s).split(' ').filter(Boolean); }

  function parseStops(text) {
    const stops = [];
    let zone = '';
    String(text || '').split('\n').forEach(function (line) {
      line = line.trim();
      if (!line) return;
      if (line[0] === '#') { zone = line.slice(1).trim(); return; }
      const parts = line.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      if (!parts.length) return;
      stops.push({
        name: parts[0],
        zone: zone,
        order: stops.length,
        aliases: parts.map(tokens).filter(function (t) { return t.length; }),
      });
    });
    return stops;
  }

  // Совпадение слова из текста со словом варианта: точно, по началу слова (для слов от 3 букв) или с одной опечаткой.
  function tokMatch(textTok, aliasTok) {
    if (textTok === aliasTok) return true;
    if (/^\d/.test(aliasTok) || /^\d/.test(textTok)) {
      return textTok.replace(/ка$/, '') === aliasTok.replace(/ка$/, '');
    }
    if (aliasTok.length >= 3 && textTok.length >= 3 && (textTok.startsWith(aliasTok) || aliasTok.startsWith(textTok))) return true;
    if (aliasTok.length >= 5 && textTok.length >= 5 && lev(textTok, aliasTok) <= 1) return true;
    return false;
  }

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 0; j <= b.length; j++) { d[0][j] = j; }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  // Ищет остановку среди слов. Возвращает {stop, used: индексы слов} или null.
  function findStop(toks, stops, skip) {
    let best = null;
    stops.forEach(function (stop) {
      stop.aliases.forEach(function (alias) {
        const used = [];
        let exact = 0;
        for (const at of alias) {
          let found = -1;
          for (let i = 0; i < toks.length; i++) {
            if (used.indexOf(i) >= 0 || (skip && skip(i))) continue;
            if (tokMatch(toks[i], at)) { found = i; break; }
          }
          if (found < 0) return;
          if (toks[found] === at) exact++;
          used.push(found);
        }
        const score = used.length * 1000 + exact * 100 + alias.join('').length;
        if (!best || score > best.score) best = { stop: stop, used: used, score: score };
      });
    });
    return best;
  }

  function findStopByText(text, stops) {
    const t = tokens(text);
    const m = findStop(t, stops);
    return m && m.used.length === t.length ? m.stop : (m ? m.stop : null);
  }

  // ---------- разбор текста из ВК ----------

  const DATE_RE = /^\s*(\d{1,2})\s*[.,/\- ]\s*(\d{1,2})\.?\s*(.*)$/;

  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; }

  // Латинские буквы-двойники внутри русских слов и «ë» → русские.
  const LAT = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', A: 'А', E: 'Е', O: 'О', P: 'Р', C: 'С', X: 'Х', K: 'К', M: 'М', T: 'Т', H: 'Н', B: 'В' };
  function fixLetters(s) {
    s = String(s || '').replace(/[ёë]/g, 'е').replace(/[ЁË]/g, 'Е');
    return s.replace(/[A-Za-zА-Яа-я]+/g, function (w) {
      if (!/[А-Яа-я]/.test(w) || !/[A-Za-z]/.test(w)) return w;
      return w.replace(/[A-Za-z]/g, function (ch) { return LAT[ch] || ch; });
    });
  }

  // text — вставленный текст; day, month — нужная дата (числа); stops — parseStops().
  function parseVk(text, day, month, stops) {
    const people = [];
    const skipped = [];
    String(text || '').split(/\r?\n/).forEach(function (rawLine) {
      const line = rawLine.trim();
      if (!line) return;
      const m = line.match(DATE_RE);
      if (!m) return; // имена, статусы, «вышла из чата»
      const d = +m[1], mo = +m[2];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
      if (d !== day || mo !== month) { skipped.push({ raw: line, reason: 'другая дата' }); return; }
      const ph = extractPhone(m[3]);
      const words = fixLetters(ph.rest).split(/[^А-Яа-яA-Za-z0-9]+/).filter(Boolean);
      const lower = words.map(function (w) { return norm(w); });
      const flags = [];

      let kind = '';
      const isKind = function (i) { return lower[i] === 'поле' || lower[i] === 'цех'; };
      lower.forEach(function (w) { if (w === 'поле' || w === 'цех') kind = kind && kind !== w ? 'оба?' : w; });
      if (!kind) { kind = 'поле'; flags.push('не указано поле/цех'); }
      if (kind === 'оба?') { kind = 'поле'; flags.push('и поле, и цех'); }

      // Слова, которые могут быть инициалами (одна буква), не участвуют в поиске остановки.
      const isInitial = function (i) {
        return /^[А-Яа-яA-Za-z]$/.test(words[i]) && i > 0 && words[i - 1].length >= 2 && /^[А-Яа-яA-Za-z]+$/.test(words[i - 1]) && !isKind(i - 1);
      };
      const flat = [];
      const flatIdx = [];
      words.forEach(function (w, i) {
        if (isKind(i)) return;
        norm(w).split(' ').forEach(function (t) { if (t) { flat.push(t); flatIdx.push(i); } });
      });
      const sm = findStop(flat, stops, function (fi) { return isInitial(flatIdx[fi]); });
      const usedWords = {};
      let stopName = '';
      if (sm) {
        stopName = sm.stop.name;
        sm.used.forEach(function (fi) { usedWords[flatIdx[fi]] = true; });
      }

      // Остальное — люди: Фамилия [И].
      const persons = [];
      const leftover = [];
      for (let i = 0; i < words.length; i++) {
        if (usedWords[i] || isKind(i)) continue;
        const w = words[i];
        if (/^\d+$/.test(w)) { leftover.push(w); continue; }
        if (/^[А-Яа-яA-Za-z]$/.test(w)) {
          const last = persons[persons.length - 1];
          if (last && !last.initial) last.initial = w.toUpperCase();
          else leftover.push(w);
          continue;
        }
        const last = persons[persons.length - 1];
        if (last && !last.initial && /^[А-ЯA-Z]/.test(w) && w.length >= 2 && !/^[А-ЯA-Z]+$/.test(w)) {
          // «Иванова Мария» — второе слово похоже на имя: берём первую букву.
          last.initial = w[0].toUpperCase();
          last.flags.push('инициал взят из имени «' + w + '»');
          continue;
        }
        persons.push({ surname: cap(w), initial: '', flags: [] });
      }
      if (!sm && persons.length > 1 && !persons[persons.length - 1].initial) {
        // «Иванов А Новаяостановка»: последнее слово без инициала — скорее всего неизвестная остановка.
        leftover.unshift(persons.pop().surname);
      }
      if (!persons.length) { skipped.push({ raw: line, reason: 'не найдена фамилия' }); return; }
      if (!stopName) {
        flags.push('остановка не распознана');
        stopName = leftover.join(' ');
      } else if (leftover.length) {
        flags.push('лишнее: ' + leftover.join(' '));
      }
      persons.forEach(function (p) {
        const f = flags.concat(p.flags);
        if (!p.initial) f.push('нет инициала');
        people.push({ surname: p.surname, initial: p.initial, stop: stopName, kind: kind, phone: persons.length === 1 ? ph.phone : '', flags: f, raw: line });
      });
    });
    return { people: people, skipped: skipped };
  }

  // Телефон в строке: +7 912 345-67-89, 89123456789, 8(912)345 67 89.
  const PHONE_RE = /(?:\+7|\b8|\b7)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}\b/;
  function extractPhone(text) {
    const m = String(text || '').match(PHONE_RE);
    if (!m) return { phone: '', rest: text };
    return { phone: formatPhone(m[0]), rest: text.replace(m[0], ' ') };
  }
  function formatPhone(s) {
    const d = String(s || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
      return '+7 ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9, 11);
    }
    return String(s || '').trim();
  }

  // ---------- склонение «Фамилия И» в винительный падеж ----------

  function accusative(name) {
    const parts = String(name || '').trim().split(/\s+/);
    if (!parts[0]) return '';
    let s = parts[0];
    const l = s.toLowerCase();
    if (/(ова|ева|ёва|ина|ына)$/.test(l)) s = s.slice(0, -1) + 'у';
    else if (/(ая)$/.test(l)) s = s.slice(0, -2) + 'ую';
    else if (/(ов|ев|ёв|ин|ын)$/.test(l)) s = s + 'а';
    else if (/(ский|цкий|кий|гий|хий)$/.test(l)) s = s.slice(0, -2) + 'ого';
    else if (/(ой)$/.test(l)) s = s.slice(0, -2) + 'ого';
    parts[0] = s;
    return parts.join(' ');
  }

  // ---------- транслит для имён файлов ----------

  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  function translit(s) {
    return String(s || '').split('').map(function (ch) {
      const lo = ch.toLowerCase();
      if (TR[lo] === undefined) return ch;
      const t = TR[lo];
      return ch !== lo && t ? t[0].toUpperCase() + t.slice(1) : t;
    }).join('').replace(/[^A-Za-z0-9_-]+/g, '');
  }

  // ---------- модель дня ----------

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dateParts(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  function uid() { return Math.random().toString(36).slice(2, 10); }

  function newGazelle(n) {
    // kind: Поле | Цех | Цех/поле; vehicle: газель | машина (carName — марка машины).
    return { id: uid(), kind: 'Поле', vehicle: 'газель', carName: '', number: '', letter: '', capacity: 19, departure: '', pay: '', payShop: '', start: '', end: '', work: '', workShop: '', reminder: '', contact: '' };
  }

  function newDay() {
    const t = new Date(Date.now() + 86400000);
    return {
      version: 1,
      date: t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate()),
      brigadier: '',
      place: 'Зубилиха',
      defaults: { departure: '4.50', pay: '4500', start: '06-00', end: '18-00', work: 'Уборка пекинки', workShop: '', payShop: '', reminder: 'НОЖИ С СОБОЙ! ОБЯЗАТЕЛЬНО!' },
      gazelles: [newGazelle(), newGazelle(), newGazelle()],
      people: [],
      replaceField: '-',
      replaceShop: '-',
      zp: '',
      footer: '**Без ножей - возвращают домой**',
      stopsText: DEFAULT_STOPS,
      latinNames: true,
      rate: 200, // нам за каждого вышедшего, ₽ — только справка на странице
    };
  }

  // Параметр газели с учётом значений дня по умолчанию.
  function gz(day, g, key) {
    const v = g[key];
    return v !== undefined && v !== null && String(v).trim() !== '' ? String(v).trim() : String(day.defaults[key] || '').trim();
  }

  function hh(t) { const m = String(t || '').match(/^(\d{1,2})/); return m ? pad2(+m[1]) : ''; }

  function personLabel(p) { return [p.surname, p.initial].filter(Boolean).join(' '); }

  // Куда на самом деле едет человек: у сборной газели — по его отметке цех/поле.
  function kindOf(g, p) {
    if (g.kind === 'Цех/поле') return p.kind === 'цех' ? 'Цех' : 'Поле';
    return g.kind === 'Цех' ? 'Цех' : 'Поле';
  }

  // Оплата для поля или цеха (у цеха своя, если задана).
  function payFor(day, g, kind) {
    if (kind === 'Цех') return gz(day, g, 'payShop') || gz(day, g, 'pay');
    return gz(day, g, 'pay');
  }

  // Вид работы для поля или цеха (у цеха свой, если задан).
  function workFor(day, g, kind) {
    if (kind === 'Цех') return gz(day, g, 'workShop') || gz(day, g, 'work');
    return gz(day, g, 'work');
  }

  // Люди газели в порядке списка; у сборной сначала цех, потом поле.
  function peopleOf(day, g) {
    let list = day.people.filter(function (p) { return p.gazId === g.id && p.status !== 'refused'; });
    if (g.vehicle === 'машина') {
      // Водитель всегда первым.
      list = list.filter(function (p) { return p.driver; }).concat(list.filter(function (p) { return !p.driver; }));
    }
    if (g.kind !== 'Цех/поле') return list;
    return list.filter(function (p) { return p.kind === 'цех'; }).concat(list.filter(function (p) { return p.kind !== 'цех'; }));
  }

  function byAlpha(a, b) {
    return personLabel(a).localeCompare(personLabel(b), 'ru', { sensitivity: 'base' });
  }

  // Сортирует по алфавиту людей одной газели (или «без газели» при gazId = ''), остальных не трогает.
  function sortAlpha(day, gazId) {
    const inGroup = function (p) { return (p.gazId || '') === (gazId || '') && p.status !== 'refused'; };
    const sorted = day.people.filter(inGroup).sort(byAlpha);
    let k = 0;
    day.people = day.people.map(function (p) { return inGroup(p) ? sorted[k++] : p; });
  }

  function vehicleCounts(day) {
    const cars = day.gazelles.filter(function (g) { return g.vehicle === 'машина'; }).length;
    return { gaz: day.gazelles.length - cars, cars: cars };
  }

  function stopSummary(day, g, stops) {
    const counts = {};
    peopleOf(day, g).forEach(function (p) {
      const k = (p.stop || '').trim() || '(без остановки)';
      counts[k] = (counts[k] || 0) + 1;
    });
    const orderOf = function (name) {
      const s = stops.find(function (x) { return x.name === name; });
      return s ? s.order : 1000;
    };
    return Object.keys(counts)
      .sort(function (a, b) { return orderOf(a) - orderOf(b); })
      .map(function (k) { return { stop: k, count: counts[k] }; });
  }

  // Сколько человек реально поехало (для Excel и имени файла).
  function wentPeople(day, kind) {
    const out = [];
    day.gazelles.forEach(function (g) {
      peopleOf(day, g).forEach(function (p) {
        if (p.status === 'ok' && (!kind || kindOf(g, p) === kind)) out.push({ p: p, g: g });
      });
    });
    return out;
  }

  function fileNames(day) {
    const dp = dateParts(day.date) || { y: 0, m: 0, d: 0 };
    const t = day.latinNames ? translit : function (s) { return String(s || '').replace(/[\\/:*?"<>|\s]+/g, ''); };
    const brig = t(day.brigadier) || (day.latinNames ? 'Brigadir' : 'Бригадир');
    const place = t(day.place);
    const vc = vehicleCounts(day);
    const went = wentPeople(day).length;
    const plural = function (n, one, few, many) { return n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many; };
    const parts = [];
    if (vc.gaz) parts.push(vc.gaz + (day.latinNames ? plural(vc.gaz, 'gazel', 'gazeli', 'gazeley') : plural(vc.gaz, 'газель', 'газели', 'газелей')));
    if (vc.cars) parts.push(vc.cars + (day.latinNames ? plural(vc.cars, 'mashina', 'mashiny', 'mashin') : plural(vc.cars, 'машина', 'машины', 'машин')));
    const gaz = parts.join('_');
    const word = [pad2(dp.d), pad2(dp.m), gaz, brig, place].filter(Boolean).join('_') + '.docx';
    const xls = [pad2(dp.d), pad2(dp.m), dp.y, day.latinNames ? 'brigada' : 'бригада', brig, went + (day.latinNames ? 'chel' : 'чел')].join('_') + '.xlsx';
    return { word: word, excel: xls };
  }

  // Предупреждения перед скачиванием.
  function warnings(day) {
    const w = [];
    const unassigned = day.people.filter(function (p) { return !p.gazId && p.status !== 'refused'; });
    if (unassigned.length) w.push('Без газели: ' + unassigned.length + ' чел. В файлы они не попадут.');
    day.gazelles.forEach(function (g, i) {
      const n = peopleOf(day, g).length;
      const cap = +g.capacity || 0;
      const name = (g.vehicle === 'машина' ? 'Машина ' : 'Газель ') + (i + 1);
      if (n > cap) w.push(name + ': ' + n + ' чел. при ' + cap + ' местах.');
      if (!String(g.number).trim() && !String(g.carName || '').trim()) w.push(name + ': не указан номер.');
    });
    const flagged = day.people.filter(function (p) { return p.flags && p.flags.length && p.status !== 'refused'; });
    if (flagged.length) w.push('Проверить: ' + flagged.length + ' чел.');
    if (!String(day.brigadier).trim()) w.push('Не указан бригадир.');
    const seen = {};
    day.people.forEach(function (p) {
      if (p.status === 'refused') return;
      const k = norm(personLabel(p));
      if (seen[k]) w.push('Повтор: ' + personLabel(p));
      seen[k] = true;
    });
    return w;
  }

  const Core = {
    DEFAULT_STOPS: DEFAULT_STOPS, MONTHS_GEN: MONTHS_GEN, MONTHS_NOM: MONTHS_NOM,
    norm: norm, parseStops: parseStops, findStopByText: findStopByText, parseVk: parseVk,
    accusative: accusative, translit: translit, dateParts: dateParts, pad2: pad2, uid: uid,
    newDay: newDay, newGazelle: newGazelle, gz: gz, kindOf: kindOf, payFor: payFor, workFor: workFor, sortAlpha: sortAlpha, formatPhone: formatPhone, vehicleCounts: vehicleCounts, hh: hh, personLabel: personLabel,
    peopleOf: peopleOf, stopSummary: stopSummary, wentPeople: wentPeople, fileNames: fileNames, warnings: warnings,
  };
  root.Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
