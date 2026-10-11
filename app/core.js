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

 // «Фамилия И» или «Фамилия И.» в начале строки, дальше что-то ещё.
  const UNDATED_RE = /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.?(?=[\s,(]|$)\s*[,(]?\s*\S/;
  const DATE_RE = /^\s*(\d{1,2})\s*[.,/\- ]\s*(\d{1,2})\.?\s*(.*)$/;

  // Дата посреди строки: «Иванова А рынок 12.10цех». Только через точку, чтобы не спутать с номерами.
  const MID_DATE_RE = /(^|[^\d.\/])(\d{1,2})\.(\d{1,2})(?!\d)\.?/;
  // «могу на л/а», «на легковой» — человек согласен ехать на машине.
  const CAR_RE = /(?:могу\s+)?(?:и\s+)?на\s+(?:л\s*\/\s*а|легков\S*)\.?|\bл\s*\/\s*а\b\.?/gi;
  // Слова, которые не бывают фамилиями.
  const NOT_NAMES = ['могу', 'на', 'в', 'и', 'или', 'тоже', 'еще', 'пожалуйста', 'буду', 'поеду', 'еду', 'едем', 'завтра', 'я', 'с', 'со', 'от', 'до', 'мы', 'нас', 'плюс', 'утром', 'хочу', 'есть', 'место', 'мест', 'чел', 'человек', 'нет'];

  // Сообщение в ВК может идти в несколько строк: «12.10», потом «Иванова А.», потом «Рынок», «Цех.».
  // Строку с одной датой склеиваю со следующими строками до пустой строки или следующей даты.
  function joinMessages(text) {
    const src = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); });
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const l = src[i];
      if (!l) continue;
      const m = l.match(DATE_RE);
      if (m && !m[3].replace(/[\s.,!:;\-]+/g, '')) {
        const parts = [l];
        let j = i + 1;
        while (j < src.length && src[j] && parts.length < 5 && !DATE_RE.test(src[j])) { parts.push(src[j]); j++; }
        out.push(parts.join(' '));
        i = j - 1;
        continue;
      }
      out.push(l);
    }
    return out;
  }

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
    joinMessages(text).forEach(function (line) {
      const m = line.match(DATE_RE);
      const mm = m ? null : line.match(MID_DATE_RE);
      let body;
      let undated = false;
      if (m) {
        const d = +m[1], mo = +m[2];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
        if (d !== day || mo !== month) { skipped.push({ raw: line, reason: 'другая дата' }); return; }
        body = m[3];
      } else if (mm && +mm[3] >= 1 && +mm[3] <= 12 && +mm[2] >= 1 && +mm[2] <= 31) {
        if (+mm[2] !== day || +mm[3] !== month) { skipped.push({ raw: line, reason: 'другая дата' }); return; }
        body = line.slice(0, mm.index) + mm[1] + ' ' + line.slice(mm.index + mm[0].length);
      } else {
        // Без даты берём только строки вида «Фамилия И остановка [цех]»; имена авторов, время и «(ред.)» пропускаем.
        if (!UNDATED_RE.test(fixLetters(line))) return;
        body = line;
        undated = true;
      }
      const ph = extractPhone(body);
      const flags = [];
      let rest = fixLetters(ph.rest);
      if (CAR_RE.test(rest)) { flags.push('может на легковой'); rest = rest.replace(CAR_RE, ' '); }
      CAR_RE.lastIndex = 0;
      const words = rest.split(/[^А-Яа-яA-Za-z0-9]+/).filter(Boolean);
      const lower = words.map(function (w) { return norm(w); });

      let kind = '';
      const isKind = function (i) { return lower[i] === 'поле' || lower[i] === 'цех'; };
      lower.forEach(function (w) { if (w === 'поле' || w === 'цех') kind = kind && kind !== w ? 'оба?' : w; });
      const kindGiven = !!kind;
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
      let initAt = -2;
      for (let i = 0; i < words.length; i++) {
        if (usedWords[i] || isKind(i)) continue;
        const w = words[i];
        if (/^\d+$/.test(w)) { leftover.push(w); continue; }
        const last = persons[persons.length - 1];
        if (/^[А-Яа-яA-Za-z]$/.test(w) && last && (!last.initial || initAt === i - 1)) {
          // Инициал, а следом за ним отчество («Иванов А.Е») — пропускаю.
          if (!last.initial) { last.initial = w.toUpperCase(); initAt = i; }
          continue;
        }
        if (NOT_NAMES.indexOf(w.toLowerCase()) >= 0) continue;
        if (/^[А-Яа-яA-Za-z]$/.test(w)) { leftover.push(w); continue; }
        if (last && !last.initial && /^[А-ЯA-Z]/.test(w) && w.length <= 2) {
          // «Петров Дм.» — сокращённое имя.
          last.initial = w[0].toUpperCase(); initAt = i;
          continue;
        }
        if (last && !last.initial && /^[А-ЯA-Z]/.test(w) && !/^[А-ЯA-Z]+$/.test(w)) {
          // «Иванова Мария» — второе слово похоже на имя: берём первую букву.
          last.initial = w[0].toUpperCase(); initAt = i;
          last.flags.push('инициал взят из имени «' + w + '»');
          continue;
        }
        // Фамилия пишется с большой буквы; маленькими — только если это первое слово записи.
        if (persons.length && !/^[А-ЯA-Z]/.test(w)) { leftover.push(w); continue; }
        persons.push({ surname: cap(w), initial: '', flags: [] });
      }
      if (!sm && persons.length > 1 && !persons[persons.length - 1].initial) {
        // «Иванов А Новаяостановка»: последнее слово без инициала — скорее всего неизвестная остановка.
        leftover.unshift(persons.pop().surname);
      }
      if (!persons.length) { if (!undated) skipped.push({ raw: line, reason: 'не найдена фамилия' }); return; }
      if (undated) {
        // Без даты и без остановки/цеха это скорее не запись, а просто сообщение.
        if (!sm && !kindGiven) return;
        flags.unshift('без даты');
      }
      if (!stopName) {
        flags.push('остановка не распознана');
        stopName = leftover.join(' ');
        stopName = stopName.charAt(0).toUpperCase() + stopName.slice(1);
      } else if (leftover.length) {
        flags.push('лишнее: ' + leftover.join(' '));
      }
      persons.forEach(function (p) {
        const f = flags.concat(p.flags);
        if (!p.initial) f.push('нет инициала');
        // Одна и та же запись дважды (цитата в ВК, повторное сообщение): оставляю первую.
        const key = norm(p.surname + ' ' + p.initial);
        const twin = people.find(function (x) { return norm(x.surname + ' ' + x.initial) === key; });
        if (twin) {
          if (twin.stop !== stopName && twin.flags.indexOf('ещё раз с остановкой «' + stopName + '»') < 0) twin.flags.push('ещё раз с остановкой «' + stopName + '»');
          return;
        }
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
    // kind: Поле | Цех | Цех/поле; vehicle: газель | машина (carName — марка машины, fuel — бензин водителю, ₽).
    return { id: uid(), kind: 'Поле', vehicle: 'газель', carName: '', number: '', letter: '', capacity: 19, departure: '', pay: '', payShop: '', start: '', end: '', work: '', workShop: '', reminder: '', contact: '', fuel: '', noOrder: false };
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
      latinNames: false,
      namesV2: true, // имена файлов кириллицей по умолчанию
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

  // Сортирует людей во всех газелях: by 'name' — по фамилиям, 'stop' — по остановкам (по алфавиту), внутри — по фамилиям.
  function sortAll(day, by) {
    const cmp = by === 'stop'
      ? function (a, b) { return String(a.stop || '').localeCompare(String(b.stop || ''), 'ru', { sensitivity: 'base' }) || byAlpha(a, b); }
      : byAlpha;
    const inVan = function (p) { return p.gazId && p.status !== 'refused'; };
    const sorted = day.people.filter(inVan).sort(cmp);
    let k = 0;
    day.people = day.people.map(function (p) { return inVan(p) ? sorted[k++] : p; });
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
      if (g.noOrder) return; // «заявки в цех пока нет» — в ведомость не идут
      peopleOf(day, g).forEach(function (p) {
        if (p.status === 'ok' && (!kind || kindOf(g, p) === kind)) out.push({ p: p, g: g });
      });
    });
    return out;
  }

  // Имена файлов: дата, число людей, место. В Word — все, кто в газелях, в Excel — кто вышел.
  function fileNames(day) {
    const dp = dateParts(day.date) || { y: 0, m: 0, d: 0 };
    const t = day.latinNames ? translit : function (s) { return String(s || '').replace(/[\\/:*?"<>|\s]+/g, ''); };
    const place = t(day.place);
    const chel = day.latinNames ? 'chel' : 'чел';
    const listed = day.gazelles.reduce(function (n, g) { return n + peopleOf(day, g).length; }, 0);
    const went = wentPeople(day).length;
    const name = function (n) { return [pad2(dp.d), pad2(dp.m), n + chel, place].filter(Boolean).join('_'); };
    return { word: name(listed) + '.docx', excel: name(went) + '.xlsx' };
  }

  // Чья газель: «М» или «Д» (Миша или Дима); любое другое значение — как есть.
  function owner(g) {
    const l = String(g.letter || '').trim().toLowerCase();
    if (l === 'м' || l === 'm') return 'М';
    if (l === 'д' || l === 'd') return 'Д';
    return '';
  }
  // Сколько газелей дня у Димы и у Миши: только газели (не машины), где есть люди и есть заявка.
  function vanTally(day) {
    const t = { d: 0, m: 0 };
    day.gazelles.forEach(function (g) {
      if (g.vehicle === 'машина' || g.noOrder || !peopleOf(day, g).length) return;
      const o = owner(g);
      if (o === 'Д') t.d++;
      else if (o === 'М') t.m++;
    });
    return t;
  }
  // Текст для чата: «Октябрь:» и строки «1-1д/1м», в конце итог.
  function tallyText(tally, ym) {
    const p = ym.split('-');
    const keys = Object.keys(tally).filter(function (k) { return k.slice(0, 7) === ym; }).sort();
    let d = 0, m = 0;
    const lines = keys.map(function (k) {
      const t = tally[k];
      d += +t.d || 0; m += +t.m || 0;
      return (+k.slice(8)) + '-' + (+t.d || 0) + 'д/' + (+t.m || 0) + 'м';
    });
    const name = MONTHS_NOM[+p[1] - 1] || '';
    return { text: [name.charAt(0).toUpperCase() + name.slice(1) + ':'].concat(lines).concat(['Итого: Д ' + d + ', М ' + m]).join('\n'), d: d, m: m, keys: keys };
  }

  // Обратно из текста: «Октябрь:» меняет месяц, строки «1- 1 Д/1м», «3-2д/2м» дают день. Год берётся из ym.
  function parseTally(text, ym) {
    let y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    const out = {};
    String(text || '').split(/\r?\n/).forEach(function (line) {
      const l = line.trim().toLowerCase();
      const mi = MONTHS_NOM.indexOf(l.replace(/[:.\s]+$/, ''));
      if (mi >= 0) { m = mi + 1; return; }
      const r = /^(\d{1,2})\s*[-–—.:)]\s*(.*)$/.exec(l);
      if (!r) return;
      const t = { d: 0, m: 0 };
      let hit = false;
      r[2].replace(/(\d+)\s*([дdмm])/g, function (_, n, k) { hit = true; if (k === 'д' || k === 'd') t.d = +n; else t.m = +n; return ''; });
      const dd = +r[1];
      if (!hit || dd < 1 || dd > 31) return;
      out[y + '-' + pad2(m) + '-' + pad2(dd)] = t;
    });
    return out;
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
    day.gazelles.forEach(function (g, i) {
      if (g.vehicle === 'машина' && +g.fuel > 0 && !peopleOf(day, g).some(function (p) { return p.driver; })) {
        w.push('Машина ' + (i + 1) + ': не отмечен водитель, бензин в Excel не попадёт.');
      }
    });
    return w.concat(duplicates(day));
  }

  // Расстояние Левенштейна без ограничений (для подсказок).
  function levFull(a, b) {
    let prev = [];
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // Где человек: «Газель 2», «Машина 3» или «без газели».
  function placeOf(day, p) {
    const i = day.gazelles.findIndex(function (g) { return g.id === p.gazId; });
    if (i < 0) return 'без газели';
    return (day.gazelles[i].vehicle === 'машина' ? 'Машина ' : 'Газель ') + (i + 1);
  }

  // Похоже на одного человека: та же «Фамилия И», или фамилия с одной опечаткой при том же инициале,
  // или та же фамилия, где у одного инициал не указан.
  function duplicates(day) {
    const list = day.people.filter(function (p) { return p.status !== 'refused' && String(p.surname || '').trim(); });
    const out = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const sa = norm(a.surname), sb = norm(b.surname);
        const ia = norm(a.initial), ib = norm(b.initial);
        let what = '';
        if (sa === sb && ia === ib) what = 'Повтор';
        else if (sa === sb && (!ia || !ib)) what = 'Похоже на одного человека';
        else if (ia === ib && Math.min(sa.length, sb.length) >= 4 && levFull(sa, sb) <= 1 && sa.replace(/а$/, '') !== sb.replace(/а$/, '')) what = 'Похоже на одного человека';
        if (what) out.push(what + ': ' + personLabel(a) + ' (' + placeOf(day, a) + ') и ' + personLabel(b) + ' (' + placeOf(day, b) + ')');
      }
    }
    return out;
  }

  // Ближайшая остановка из справочника для нераспознанной: по опечатке или началу слова.
  function suggestStop(text, stops) {
    const t = norm(text).replace(/ /g, '');
    if (t.length < 3 || stopInfo(text, stops)) return null;
    let best = null;
    stops.forEach(function (stop) {
      stop.aliases.forEach(function (alias) {
        const a = alias.join('');
        if (!a) return;
        let d = levFull(t, a);
        if (a.length >= 3 && (a.startsWith(t) || t.startsWith(a))) d = Math.min(d, 0.5);
        const limit = Math.max(1, Math.floor(Math.max(t.length, a.length) * 0.34));
        if (d <= limit && (!best || d < best.d)) best = { stop: stop, d: d };
      });
    });
    return best ? best.stop.name : null;
  }

  // ---------- этап 2: распределение по газелям ----------

  // Зона остановки: обычная (по маршруту) или «в любую газель» (деревни и неизвестные остановки).
  function stopInfo(name, stops) {
    const n = String(name || '').trim();
    if (!n) return null;
    return stops.find(function (s) { return s.name === n; }) || stops.find(function (s) { return norm(s.name) === norm(n); }) || null;
  }
  function isFlexZone(zone) { return /любую|деревн/i.test(zone || ''); }

  // Раскладывает людей по газелям (машины не трогает: туда сажают вручную).
  // mode 'all' — всех заново, 'free' — только тех, кто без газели.
  // Цех едет в цеховые газели, потом в сборные; поле — в полевые и в остаток сборных.
  // Каждая зона по возможности в своей газели, деревни — вместе туда, где больше мест.
  // Люди из одной строки ВК не разделяются.
  function autoAssign(day, stops, mode) {
    const vans = day.gazelles.filter(function (g) { return g.vehicle !== 'машина'; });
    const vanIds = {};
    vans.forEach(function (g) { vanIds[g.id] = true; });
    const known = {};
    day.gazelles.forEach(function (g) { known[g.id] = true; });
    const active = day.people.filter(function (p) { return p.status !== 'refused'; });
    const todo = active.filter(function (p) {
      if (!known[p.gazId]) return true;
      return mode === 'all' && vanIds[p.gazId];
    });
    todo.forEach(function (p) { p.gazId = ''; });

    const free = {};
    vans.forEach(function (g) {
      free[g.id] = (+g.capacity || 0) - active.filter(function (p) { return p.gazId === g.id; }).length;
    });
    const zonesIn = {}; // gazId -> {zoneKey: count}
    vans.forEach(function (g) {
      zonesIn[g.id] = {};
      active.forEach(function (p) { if (p.gazId === g.id) addZone(g.id, unitZone(p), 1); });
    });
    function unitZone(p) {
      const s = stopInfo(p.stop, stops);
      if (!s) return { key: '?', flex: true, order: 9999 };
      return { key: s.zone, flex: isFlexZone(s.zone), order: s.order };
    }
    function addZone(gid, z, n) { const k = (z.flex ? '*' : '') + z.key; zonesIn[gid][k] = (zonesIn[gid][k] || 0) + n; }

    // Единицы: люди из одной строки ВК с одним видом работы.
    const units = [];
    const byKey = {};
    todo.forEach(function (p, i) {
      const kind = p.kind === 'цех' ? 'цех' : 'поле';
      const key = p.raw ? kind + '|' + p.raw : 'p' + i;
      if (!byKey[key]) { byKey[key] = { people: [], kind: kind, zone: unitZone(p), idx: i }; units.push(byKey[key]); }
      byKey[key].people.push(p);
    });
    const byRoute = function (a, b) { return a.zone.order - b.zone.order || a.idx - b.idx; };

    function put(u, g) {
      u.people.forEach(function (p) { p.gazId = g.id; });
      free[g.id] -= u.people.length;
      addZone(g.id, u.zone, u.people.length);
    }

    // В газель, где уже есть эта зона; деревни — лучше к людям, чем в пустую газель, остальные — наоборот.
    function placeFlex(list, pool) {
      const left = [];
      list.sort(byRoute).forEach(function (u) {
        const n = u.people.length;
        const fit = pool.filter(function (g) { return free[g.id] >= n; });
        if (!fit.length) { left.push(u); return; }
        const k = (u.zone.flex ? '*' : '') + u.zone.key;
        const used = function (g) { return Object.keys(zonesIn[g.id]).some(function (x) { return zonesIn[g.id][x] > 0; }) ? 1 : 0; };
        fit.sort(function (a, b) {
          return (zonesIn[b.id][k] || 0) - (zonesIn[a.id][k] || 0) || (u.zone.flex ? used(b) - used(a) : used(a) - used(b)) || free[b.id] - free[a.id];
        });
        put(u, fit[0]);
      });
      return left;
    }

    // Только новые: каждого в газель, где уже есть его зона, иначе где больше мест.
    function placeEach(list, pool) {
      const reg = list.filter(function (u) { return !u.zone.flex; });
      const left = placeFlex(reg, pool);
      return left.concat(placeFlex(list.filter(function (u) { return u.zone.flex; }), pool));
    }

    // Всех заново: газели делятся между зонами, внутри зоны люди идут по маршруту.
    function placeAll(list, pool) {
      pool = pool.filter(function (g) { return free[g.id] > 0; });
      const reg = list.filter(function (u) { return !u.zone.flex; }).sort(byRoute);
      const flex = list.filter(function (u) { return u.zone.flex; });
      const zones = [];
      const demand = {};
      reg.forEach(function (u) {
        if (!(u.zone.key in demand)) { demand[u.zone.key] = 0; zones.push(u.zone.key); }
        demand[u.zone.key] += u.people.length;
      });
      // Сколько газелей нужно каждой зоне.
      const share = {};
      let rest = pool.slice();
      let fits = true;
      zones.forEach(function (z) {
        share[z] = [];
        let cap = 0;
        while (cap < demand[z] && rest.length) { const g = rest.shift(); share[z].push(g); cap += free[g.id]; }
        if (cap < demand[z]) fits = false;
      });
      if (fits) {
        // Лишние газели — зонам, где теснее всего.
        while (rest.length && zones.length) {
          const load = function (z) { return demand[z] / share[z].reduce(function (a, g) { return a + free[g.id]; }, 0); };
          const z = zones.slice().sort(function (a, b) { return load(b) - load(a); })[0];
          if (demand[z] <= share[z].length) break;
          share[z].push(rest.shift());
        }
      } else {
        // Мест по зонам не хватает: заполняем газели подряд по маршруту.
        zones.length = 0; zones.push('*all');
        demand['*all'] = reg.reduce(function (a, u) { return a + u.people.length; }, 0);
        share['*all'] = pool.slice();
      }
      let left = [];
      zones.forEach(function (z) {
        const units = z === '*all' ? reg : reg.filter(function (u) { return u.zone.key === z; });
        const vs = share[z];
        const total = vs.reduce(function (a, g) { return a + free[g.id]; }, 0);
        let vi = 0, inVan = 0, lastStop = null;
        units.forEach(function (u) {
          const n = u.people.length;
          while (vi < vs.length) {
            const g = vs[vi];
            const target = vi === vs.length - 1 ? Infinity : Math.round(demand[z] * (free[g.id] + inVan) / total);
            // Одну остановку не делим между газелями, пока есть место.
            if (free[g.id] >= n && (inVan + n <= target || inVan === 0 || u.zone.order === lastStop)) break;
            vi++; inVan = 0; lastStop = null;
          }
          if (vi >= vs.length) {
            // Не влезло подряд — ищем любое место среди газелей зоны.
            const g = vs.filter(function (x) { return free[x.id] >= n; })[0];
            if (g) put(u, g); else left.push(u);
            return;
          }
          put(u, vs[vi]); inVan += n; lastStop = u.zone.order;
        });
      });
      return left.concat(placeFlex(flex, pool));
    }

    const place = mode === 'all' ? placeAll : placeEach;
    const shopVans = vans.filter(function (g) { return g.kind === 'Цех'; });
    const mixVans = vans.filter(function (g) { return g.kind === 'Цех/поле'; });
    const fieldVans = vans.filter(function (g) { return g.kind !== 'Цех' && g.kind !== 'Цех/поле'; });
    const shopUnits = units.filter(function (u) { return u.kind === 'цех'; });
    const fieldUnits = units.filter(function (u) { return u.kind !== 'цех'; });
    let left = place(shopUnits, shopVans);
    left = place(left, mixVans);
    left = left.concat(place(fieldUnits, fieldVans.concat(mixVans)));

    const leftPeople = [];
    left.forEach(function (u) { u.people.forEach(function (p) { leftPeople.push(p); }); });
    return {
      placed: todo.length - leftPeople.length,
      left: leftPeople,
      vans: vans.map(function (g) {
        const z = zonesIn[g.id];
        return { g: g, zones: Object.keys(z).filter(function (k) { return z[k] > 0; }).map(function (k) {
          return { zone: k === '*?' ? 'без остановки в справочнике' : k.replace(/^\*/, ''), count: z[k] };
        }) };
      }),
    };
  }

  // ---------- этап 3: слияние правок двух человек ----------
  // base — что было у обоих последний раз, local — моё, remote — пришло от второго человека.
  // Побеждает то, что поменял кто-то один; если поменяли оба одно и то же — побеждает моё.

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  // Плоский объект: каждое поле отдельно.
  function mergeMap(base, local, remote, skip) {
    base = base || {}; local = local || {}; remote = remote || {};
    const out = {};
    const keys = {};
    [base, local, remote].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = true; }); });
    Object.keys(keys).forEach(function (k) {
      if (skip && skip.indexOf(k) >= 0) return;
      const v = same(local[k], base[k]) ? remote[k] : local[k];
      if (v !== undefined) out[k] = clone(v);
    });
    return out;
  }

  // Список объектов с id (люди, газели): по каждому элементу целиком, порядок — чей поменялся.
  function mergeList(base, local, remote) {
    base = base || []; local = local || []; remote = remote || [];
    const byId = function (list) { const m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; };
    const B = byId(base), L = byId(local), R = byId(remote);
    const pick = function (id) {
      const b = B[id], l = L[id], r = R[id];
      if (l && r) return same(l, b) ? r : l;
      if (l) return !b || !same(l, b) ? l : null;   // у второго удалён: оставляю, только если я его менял
      if (r) return !b || !same(r, b) ? r : null;   // у меня удалён: оставляю, только если второй его менял
      return null;
    };
    const ids = function (list) { return list.map(function (x) { return x.id; }); };
    const common = function (list) { return ids(list).filter(function (id) { return B[id]; }); };
    const localMoved = !same(common(local), ids(base).filter(function (id) { return L[id]; }));
    const first = localMoved ? local : remote, second = localMoved ? remote : local;
    const out = [], seen = {};
    first.concat(second).forEach(function (x) {
      if (seen[x.id]) return;
      seen[x.id] = true;
      const v = pick(x.id);
      if (v) out.push(clone(v));
    });
    return out;
  }

  function mergeDay(base, local, remote) {
    if (!base) return clone(remote);
    const out = mergeMap(base, local, remote, ['people', 'gazelles']);
    out.gazelles = mergeList(base.gazelles, local.gazelles, remote.gazelles);
    out.people = mergeList(base.people, local.people, remote.people);
    return out;
  }

  const Core = {
    DEFAULT_STOPS: DEFAULT_STOPS, MONTHS_GEN: MONTHS_GEN, MONTHS_NOM: MONTHS_NOM,
    norm: norm, parseStops: parseStops, findStopByText: findStopByText, parseVk: parseVk,
    accusative: accusative, translit: translit, dateParts: dateParts, pad2: pad2, uid: uid,
    newDay: newDay, newGazelle: newGazelle, gz: gz, kindOf: kindOf, payFor: payFor, workFor: workFor, sortAlpha: sortAlpha, sortAll: sortAll, formatPhone: formatPhone, vehicleCounts: vehicleCounts, hh: hh, personLabel: personLabel,
    peopleOf: peopleOf, autoAssign: autoAssign, mergeMap: mergeMap, mergeDay: mergeDay, stopInfo: stopInfo, stopSummary: stopSummary, wentPeople: wentPeople, fileNames: fileNames, warnings: warnings, owner: owner, vanTally: vanTally, tallyText: tallyText, parseTally: parseTally, duplicates: duplicates, suggestStop: suggestStop, placeOf: placeOf,
  };
  root.Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
