// Сборка Word (.docx) и Excel (.xlsx) в формате образцов.
// В браузере использует глобальные docx и ExcelJS, в Node — переданные библиотеки (для тестов).
(function (root) {
  'use strict';
  const Core = root.Core || (typeof require !== 'undefined' ? require('./core.js') : null);

  const RED = 'FF0000';
  const ARIAL = 'Arial';

  function places(n) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return n + ' место';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return n + ' места';
    return n + ' мест';
  }

  function dot(s) { s = String(s || '').trim(); return s && !/[.!?]$/.test(s) ? s + '.' : s; }

  // ---------------- Word ----------------

  function buildWord(day, D) {
    const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation, BorderStyle, TableLayoutType } = D;
    const stops = Core.parseStops(day.stopsText);
    const dp = Core.dateParts(day.date);
    const gs = day.gazelles;

    const run = (text, o) => new TextRun(Object.assign({ text: String(text), font: ARIAL }, o || {}));
    const para = (children, o) => new Paragraph(Object.assign({ children: children, spacing: { before: 0, after: 0, line: 240 } }, o || {}));

    // Размеры как в образце: текстовая ширина 15398, таблица 91,16 % от неё, колонка «№» 463.
    const tableW = Math.round(15398 * 0.9116);
    const numW = 463;
    const colW = Math.floor((tableW - numW) / Math.max(gs.length, 1));
    const cell = (children, w, o) => new TableCell(Object.assign({ children: children, width: { size: w, type: WidthType.DXA } }, o || {}));

    // Строка 1: заголовки газелей.
    const head = [cell([para([run('№')])], numW)].concat(gs.map(function (g, i) {
      const letter = String(g.letter || '').trim();
      const pay = Core.gz(day, g, 'pay');
      const hours = Core.hh(Core.gz(day, g, 'start')) + '-' + Core.hh(Core.gz(day, g, 'end')) + ' р.д.';
      const work = Core.gz(day, g, 'work');
      const reminder = Core.gz(day, g, 'reminder');
      const line3 = [run(['Оплата ' + dot(pay), hours, dot(work)].filter(Boolean).join(' ').replace(/\.$/, ''), { bold: true })];
      if (reminder) {
        line3.push(run('', { bold: true, break: 1 }));
        line3.push(run(reminder, { bold: true, color: RED }));
      }
      return cell([
        para([
          run((i + 1) + '. ' + (g.kind || 'Поле') + ', газель ', { bold: true }),
          run('№' + String(g.number || '').trim(), { bold: true, size: 24 }),
          run((letter ? ' ' + letter : '') + ' (' + (+g.capacity || 0) + 'м)', { bold: true }),
        ]),
        para([run('выезд в ' + dot(Core.gz(day, g, 'departure')), { bold: true, color: RED })]),
        para(line3),
      ], colW);
    }));
    const rows = [new TableRow({ children: head })];

    // Строки людей.
    const lists = gs.map(function (g) { return Core.peopleOf(day, g); });
    const maxRows = Math.max.apply(null, [0].concat(gs.map(function (g, i) { return Math.max(+g.capacity || 0, lists[i].length); })));
    for (let r = 1; r <= maxRows; r++) {
      const cells = [cell([para([run(r, { size: 20 })])], numW)];
      gs.forEach(function (g, i) {
        const cap = +g.capacity || 0;
        const list = lists[i];
        let p;
        if (r <= list.length) {
          const person = list[r - 1];
          const text = [Core.personLabel(person), person.stop].filter(Boolean).join(' ');
          p = para([run(text, person.status === 'noshow' ? { size: 20, highlight: 'yellow' } : { size: 20 })]);
        } else if (r <= cap) {
          p = para([run('СВОБОДНОЕ МЕСТО', { size: 20, highlight: 'yellow' })]);
        } else if (r === Math.max(cap, list.length) + 1) {
          p = para([run(places(cap), { size: 20, italics: true })]);
        } else {
          p = para([]);
        }
        cells.push(cell([p], colW));
      });
      rows.push(new TableRow({ children: cells }));
    }

    // Строка остановок.
    const stopCells = [cell([para([])], numW)].concat(gs.map(function (g) {
      const contact = String(g.contact || '').trim();
      const ps = [
        para([run('По остановкам прошу отписаться' + (contact ? ' – ' + contact : ''), { size: 18 })]),
        para([run('Остановки:', { size: 18, bold: true })]),
      ];
      Core.stopSummary(day, g, stops).forEach(function (s) {
        ps.push(para([run(s.stop + ' — ' + s.count, { size: 18 })]));
      });
      return cell(ps, colW);
    }));
    rows.push(new TableRow({ children: stopCells }));

    // Нижний блок на всю ширину.
    const C = { alignment: AlignmentType.CENTER };
    const foot = [
      para([run('Замена поле: ' + (String(day.replaceField || '').trim() || '-'), { size: 20, bold: true, color: RED })], C),
      para([run('Замена цех: ' + (String(day.replaceShop || '').trim() || '-'), { size: 20, bold: true, color: RED })], C),
      para([run('!!', { size: 20, bold: true, color: RED }), run('ЗП поле/цех прошу получить/выдать – ' + String(day.zp || '').trim(), { size: 20 })], C),
    ];
    if (String(day.footer || '').trim()) foot.push(para([run(String(day.footer).trim(), { size: 20, italics: true })], C));
    rows.push(new TableRow({ children: [cell(foot, tableW, { columnSpan: gs.length + 1 })] }));

    const b = { style: BorderStyle.SINGLE, size: 4, color: 'auto' };
    const table = new Table({
      rows: rows,
      width: { size: tableW, type: WidthType.DXA },
      columnWidths: [numW].concat(gs.map(function () { return colW; })),
      alignment: AlignmentType.CENTER,
      layout: TableLayoutType.FIXED,
      borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
    });

    const title = dp ? dp.d + ' ' + Core.MONTHS_GEN[dp.m - 1] : '';
    return new Document({
      styles: { default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 0, line: 240 } } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
            margin: { top: 142, right: 720, bottom: 0, left: 720, header: 0, footer: 0 },
          },
        },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: title, size: 24 })] }),
          table,
          new Paragraph({ children: [] }),
        ],
      }],
    });
  }

  // ---------------- Excel ----------------

  function payNum(s) { const n = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
  function lowerFirst(s) { s = String(s || ''); return s ? s[0].toLowerCase() + s.slice(1) : s; }

  function totalText(items) {
    if (!items.length) return '';
    const pays = items.map(function (x) { return x.pay; });
    const sum = pays.reduce(function (a, b) { return a + b; }, 0);
    const same = pays.every(function (p) { return p === pays[0]; });
    return same ? pays[0] + ' × ' + items.length + ' = ' + sum : 'Итого: ' + sum;
  }

  function buildExcel(day, ExcelJS) {
    const dp = Core.dateParts(day.date) || { y: 0, m: 1, d: 0 };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(Core.MONTHS_NOM[dp.m - 1], {
      pageSetup: {
        paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1,
        margins: { left: 1.1024, right: 0.7087, top: 0.748, bottom: 0.748, header: 0.315, footer: 0.315 },
      },
    });
    ws.properties.defaultRowHeight = 14.4;
    const widths = { A: 4.44, B: 17.44, C: 11.89, D: 7.44, E: 8.89, F: 12.44, G: 3.89, H: 16.55, I: 21.89, J: 6.66, K: 7.11, L: 11.89 };
    Object.keys(widths).forEach(function (k) { ws.getColumn(k).width = widths[k]; });

    const thin = { style: 'thin' };
    const box = { top: thin, left: thin, bottom: thin, right: thin };
    const white = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

    const toItems = function (kind) {
      return Core.wentPeople(day, kind).map(function (x) {
        const own = String(x.p.pay || '').trim();
        return {
          name: Core.personLabel(x.p),
          work: lowerFirst(Core.gz(day, x.g, 'work')),
          start: Core.gz(day, x.g, 'start'),
          end: Core.gz(day, x.g, 'end'),
          pay: payNum(own || Core.gz(day, x.g, 'pay')),
        };
      });
    };
    const shop = toItems('Цех');
    const field = toItems('Поле');
    const nRows = Math.max(shop.length, field.length) + 2 + 5;
    const last = 4 + nRows;

    // Шапка.
    ws.mergeCells('C1:E1');
    const c1 = ws.getCell('C1');
    c1.value = Core.pad2(dp.d) + '.' + Core.pad2(dp.m) + '.' + dp.y;
    c1.font = { name: 'Calibri', size: 14, bold: true };
    c1.alignment = { horizontal: 'left' };
    ['C1', 'F1'].forEach(function (a) { ws.getCell(a).fill = white; });
    ws.getCell('A2').value = 'Бригада ';
    ws.getCell('A2').font = { name: 'Calibri', size: 12, bold: true };
    ws.getCell('C2').value = String(day.brigadier || '').trim();
    ws.getCell('C2').font = { name: 'Calibri', size: 18, bold: true, underline: true };

    const block = function (cols, title, titleSize, items) {
      const [cN, cName, cWork, cStart, cEnd, cPay] = cols;
      ws.mergeCells(cN + '3:' + cPay + '3');
      const t = ws.getCell(cN + '3');
      t.value = title;
      t.font = { name: 'Calibri', size: titleSize, bold: true };
      t.alignment = { horizontal: 'center' };
      cols.forEach(function (c) { ws.getCell(c + '3').border = { bottom: thin }; });

      const heads = ['', 'ФИО ', '', 'начало смены', 'окончание смены', 'ЗП '];
      cols.forEach(function (c, i) {
        const cell = ws.getCell(c + '4');
        cell.value = heads[i] || null;
        cell.border = box;
        cell.fill = white;
        if (i > 0) {
          cell.font = { name: 'Calibri', size: 11, bold: true };
          cell.alignment = { horizontal: 'center', wrapText: i >= 2 };
        }
      });

      for (let r = 1; r <= nRows; r++) {
        const row = 4 + r;
        cols.forEach(function (c) { const cell = ws.getCell(c + row); cell.border = box; cell.fill = white; });
        ws.getCell(cN + row).value = r;
        const it = items[r - 1];
        if (it) {
          const set = function (c, v, fmt) {
            const cell = ws.getCell(c + row);
            cell.value = v;
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
            if (fmt) cell.numFmt = fmt;
          };
          set(cName, it.name);
          set(cWork, it.work);
          set(cStart, it.start, '@');
          set(cEnd, it.end, '@');
          set(cPay, it.pay);
        } else if (items.length && r === items.length + 2) {
          ws.getCell(cName + row).value = totalText(items);
        }
      }
    };
    block(['A', 'B', 'C', 'D', 'E', 'F'], 'ЦЕХ ', 16, shop);
    block(['G', 'H', 'I', 'J', 'K', 'L'], 'ПОЛЕ ', 14, field);
    // В блоке ЦЕХ ФИО крупнее, как в образце.
    for (let r = 5; r <= last; r++) ws.getCell('B' + r).font = { name: 'Calibri', size: 12 };

    ws.getRow(1).height = 21;
    ws.getRow(2).height = 24;
    ws.getRow(3).height = 31.5;
    ws.getRow(4).height = 46.5;
    for (let r = 5; r <= last; r++) ws.getRow(r).height = 15.6;
    return wb;
  }

  const Gen = { buildWord: buildWord, buildExcel: buildExcel, places: places, totalText: totalText };
  root.Gen = Gen;
  if (typeof module !== 'undefined' && module.exports) module.exports = Gen;
})(typeof window !== 'undefined' ? window : globalThis);
