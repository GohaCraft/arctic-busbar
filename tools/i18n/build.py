#!/usr/bin/env python3
"""ARCTIC BUSBAR AI v2.4.0-prod — сборка словаря перевода.

Источник правды: tools/i18n/dict.psv   (строка = ключ | ru | en | zh | kk | be | uk; разделитель «|», комментарии — строки с #)
Движок:          tools/i18n/i18n.engine.js (маркер /* @@DICT@@ */)
Результат:       scripts/core/i18n.js      (его и подключает index.html; вручную не правится)

Запуск:   python3 tools/i18n/build.py            — проверить словарь и собрать i18n.js
          python3 tools/i18n/build.py --check    — только проверить (код возврата 1 при ошибках)

Проверки: 7 колонок, нет пустых значений, плейсхолдеры {name} одинаковы во всех языках, одинаковое число тегов <b>,
          все ключи из index.html и scripts/**/*.js (data-i18n*, t('ключ')) есть в словаре; «лишние» ключи — предупреждение.
Правки переводов носителями языка вносятся ТОЛЬКО в dict.psv, затем запускается этот скрипт.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
LANGS = ['ru', 'en', 'zh', 'kk', 'be', 'uk']
PSV = ROOT / 'tools' / 'i18n' / 'dict.psv'
ENGINE = ROOT / 'tools' / 'i18n' / 'i18n.engine.js'
OUT = ROOT / 'scripts' / 'core' / 'i18n.js'
DYNAMIC = ('cat.', 'role.', 'pd.', 'tz.', 'th.', 'tag.', 'ev.', 'st.', 'src.', 'perm.', 'u.', 'sev.', 'via.', 'node.', 'nt.', 'sd.', 'thr.', 'kv.', 'sc.', 'nd.', 'in.', 'toast.', 'a.rb.', 'badge.', 'nav.', 'demo.', 'p.c', 'al.', 'dock.')  # ключи собираются в коде: 'cat.' + cat

PH = re.compile(r'\{(\w+)\}')


def read_psv():
    rows, errors, seen = {}, [], set()
    for n, line in enumerate(PSV.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        parts = [p.strip() for p in line.split('|')]
        if len(parts) != 7:
            errors.append(f'dict.psv:{n}: ожидалось 7 колонок, найдено {len(parts)}: {line[:70]}')
            continue
        key, vals = parts[0], [v.replace('\\n', '\n') for v in parts[1:]]   # «\n» в словаре = перевод строки (шаблоны кода)
        if key in seen:
            errors.append(f'dict.psv:{n}: дубликат ключа {key}')
        seen.add(key)
        for lang, v in zip(LANGS, vals):
            if not v:
                errors.append(f'dict.psv:{n}: пустое значение {key}[{lang}]')
        base = sorted(PH.findall(vals[0]))
        for lang, v in zip(LANGS, vals):
            if sorted(PH.findall(v)) != base:
                errors.append(f'dict.psv:{n}: плейсхолдеры {key}[{lang}] {sorted(PH.findall(v))} != ru {base}')
            if v.count('<b>') != vals[0].count('<b>') or v.count('</b>') != vals[0].count('</b>'):
                errors.append(f'dict.psv:{n}: теги <b> {key}[{lang}] отличаются от ru')
        rows[key] = vals
    return rows, errors


def scan_used():
    used = {}
    files = [ROOT / 'index.html'] + [p for p in (ROOT / 'scripts').rglob('*.js') if p.name != 'i18n.js']
    pat_html = re.compile(r'data-i18n(?:-html|-ph|-title|-aria)?="([^"]+)"')
    pat_js = re.compile(r"""(?<![\w.$])(?:I18N\.t|TT|tt|T|t)\(\s*['"]([\w.\-]+)['"]""")
    pat_k = re.compile(r"""\bk:\s*['"]([\w.\-]+)['"]""")                 # записи журнала: {k: 'ev.login'}
    pat_s = re.compile(r"""['"]((?:ev|nt|al|cb|rq|pf|rb|st|set|p|g|a|insp|sd|src|perm|via|kv|nd|in|sc|toast|thr|cr|auth|cam|qr|rcv|common|act|name|badge|role|cat|demo|dock|nav|tag|tz|th|node|grid|core|pd|u)\.[\w.\-]+)['"]""")
    for f in files:
        txt = f.read_text(encoding='utf-8')
        pats = [pat_html] if f.suffix == '.html' else [pat_js, pat_k, pat_s]
        for pat in pats:
            for m in pat.finditer(txt):
                used.setdefault(m.group(1), set()).add(f.name)
    return used


def main():
    check_only = '--check' in sys.argv
    rows, errors = read_psv()
    used = scan_used()
    missing = sorted(k for k in used if k not in rows and not k.endswith('.'))
    unused = sorted(k for k in rows if k not in used and not k.startswith(DYNAMIC))
    for e in errors:
        print('ОШИБКА  ', e)
    for k in missing:
        print('НЕТ КЛЮЧА', k, '←', ', '.join(sorted(used[k])))
    for k in unused:
        print('не используется', k)
    print(f'ключей в словаре: {len(rows)}; языков: {len(LANGS)}; используется в коде: {len(used)}; ошибок: {len(errors)}; нет в словаре: {len(missing)}; лишних: {len(unused)}')
    if errors or missing:
        # сборка всё равно выполняется, чтобы не блокировать работу; код возврата сообщает о проблеме
        pass
    if not check_only:
        dict_js = json.dumps({k: v for k, v in rows.items()}, ensure_ascii=False, indent=0, separators=(',', ':'))
        dict_js = dict_js.replace('\n', '\n')
        eng = ENGINE.read_text(encoding='utf-8')
        if '/* @@DICT@@ */' not in eng:
            sys.exit('в движке нет маркера /* @@DICT@@ */')
        OUT.write_text(eng.replace('/* @@DICT@@ */', dict_js), encoding='utf-8')
        print('записан', OUT.relative_to(ROOT), f'({OUT.stat().st_size // 1024} КБ)')
    sys.exit(1 if (errors or missing) else 0)


if __name__ == '__main__':
    main()
