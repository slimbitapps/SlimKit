import { useEffect, useMemo, useState } from 'react';
import { t, fmtSize, fmtNum, type TKey } from '../i18n';
import { call, toast, refreshHistory } from '../store';
import { Picker, ToolFrame, ToolPage, Step, Choices, Done, Empty, Busy, useFiles, errText, KindIcon, Thumb } from '../components/kit';
import { Group, Row, Seg, Switch } from '../components/ui';
import { IconFlatten, IconBroom, IconCopies, IconPie, IconList, IconFolder, IconTrash } from '../icons';
import { basename } from '../paths';

type Move = { from: string; to: string; folder: string };

// ------------------------------------------------------------------ Sortieren
export function SortTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const [by, setBy] = useState<'month' | 'year' | 'day' | 'type' | 'ext'>('month');
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ done: number; historyId?: string } | null>(null);
  useEffect(() => {
    setMoves(null);
    if (!paths.length) return;
    call<Move[]>('sort:preview', paths, { by }).then(setMoves);
  }, [paths, by]);
  const groups = useMemo(() => {
    const m = new Map<string, Move[]>();
    for (const x of moves || []) m.set(x.folder, [...(m.get(x.folder) || []), x]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [moves]);
  if (done)
    return (
      <ToolPage id="sort" compact>
        <Done text={t('sort.done', { n: fmtNum(done.done) })} reveal={paths[0]} historyId={done.historyId} />
      </ToolPage>
    );
  const ready = !!moves?.length;
  return (
    <ToolPage
      id="sort"
      foot={
        <>
          <div className="foot-sum">
            {ready ? (
              <>
                <b>{t('sort.preview', { n: fmtNum(moves!.length), f: groups.length })}</b>
                <span>{t('common.undoHint')}</span>
              </>
            ) : (
              <span>{t('sort.foot.empty')}</span>
            )}
          </div>
          <button
            className="btn primary xl"
            disabled={busy || !ready}
            data-testid="sort-apply"
            onClick={async () => {
              setBusy(true);
              try {
                setDone(await call('sort:apply', paths, { by }, t('sort.title', { n: moves!.length })));
              } catch (e) {
                toast(errText(e), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('common.working') : t('sort.apply', { n: fmtNum(moves?.length || 0) })}
          </button>
        </>
      }
    >
      <Step n={1} title={t('sort.s1')} hint={t('sort.s1.hint')}>
        <Picker mode="files" paths={paths} onChange={setPaths} empty={t('sort.pick')} testId="sort-pick" />
        {moves && paths.length > 0 && !moves.length && <div className="banner warn small" style={{ marginTop: 10 }}>{t('sort.none')}</div>}
      </Step>
      <Step n={2} title={t('sort.s2')} hint={t('sort.hint')} disabled={!paths.length}>
        <Choices
          value={by}
          onChange={setBy}
          cols={3}
          testPrefix="sort"
          options={(['month', 'year', 'day', 'type', 'ext'] as const).map((b) => ({ id: b, title: t(`sort.by.${b}` as TKey), desc: t(`sort.by.${b}.ex` as TKey), badge: b === 'month' ? t('common.popular') : undefined }))}
        />
      </Step>
      <Step n={3} title={t('sort.s3')} disabled={!ready}>
        <div className="folder-cards" data-testid="sort-preview">
          {groups.slice(0, 120).map(([folder, list]) => (
            <div className="folder-card" key={folder}>
              <div className="fc-head">
                <IconFolder size={18} />
                <b className="ellipsis">{folder}</b>
                <span className="badge">{list.length}</span>
              </div>
              <div className="fc-thumbs">
                {list.slice(0, 4).map((m) => (
                  <Thumb key={m.from} file={{ path: m.from, kind: /\.(jpe?g|png|heic|heif|gif|webp|mov|mp4)$/i.test(m.from) ? 'image' : 'other', ext: '', isDir: false }} size={36} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Step>
    </ToolPage>
  );
}

// ------------------------------------------------------------------ Ordner auflösen
export function FlattenTool({ paths: initial }: { paths: string[] }) {
  const [dir, setDir] = useState(initial.slice(0, 1));
  const [removeEmpty, setRemoveEmpty] = useState(true);
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [done, setDone] = useState<{ done: number; removed: number; historyId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMoves(null);
    if (dir[0]) call<Move[]>('flatten:preview', dir[0]).then(setMoves);
  }, [dir]);
  if (done) return <ToolFrame id="flatten" side={null} main={<Done text={t('flatten.done', { n: fmtNum(done.done) })} reveal={dir[0]} historyId={done.historyId} />} />;
  return (
    <ToolFrame
      id="flatten"
      side={
        <>
          <Picker mode="dir" paths={dir} onChange={setDir} label={t('pick.folder')} />
          <Group>
            <Row label={t('flatten.removeEmpty')} desc={t('flatten.removeEmpty.desc')}>
              <Switch on={removeEmpty} onChange={setRemoveEmpty} />
            </Row>
          </Group>
          <p className="small muted">{t('flatten.hint')}</p>
        </>
      }
      main={
        !dir[0] ? (
          <Empty icon={<IconFlatten size={40} />} text={t('flatten.empty')} />
        ) : !moves ? (
          <Busy />
        ) : !moves.length ? (
          <Empty text={t('flatten.none')} />
        ) : (
          <div className="preview">
            <div className="preview-head">
              <b>{t('flatten.preview', { n: fmtNum(moves.length) })}</b>
            </div>
            <div className="table">
              {moves.slice(0, 600).map((m) => (
                <div className="trow" key={m.from}>
                  <span className="faint ellipsis" style={{ maxWidth: '45%' }}>
                    {m.folder}/
                  </span>
                  <span className="ellipsis grow">{basename(m.to)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      }
      foot={
        !!moves?.length && (
          <>
            <div className="spacer" />
            <button
              className="btn primary lg"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setDone(await call('flatten:apply', dir[0], removeEmpty, t('flatten.title', { name: basename(dir[0]) })));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('flatten.apply', { n: fmtNum(moves.length) })}
            </button>
          </>
        )
      }
    />
  );
}

// ------------------------------------------------------------------ Leere Ordner
export function EmptyTool({ paths: initial }: { paths: string[] }) {
  const [dirs, setDirs] = useState(initial);
  const [found, setFound] = useState<string[] | null>(null);
  const [done, setDone] = useState<number | null>(null);
  useEffect(() => {
    setFound(null);
    if (dirs.length) call<string[]>('empty:find', dirs).then(setFound);
  }, [dirs]);
  if (done !== null) return <ToolFrame id="empty" side={null} main={<Done text={t('empty.done', { n: fmtNum(done) })} reveal={dirs[0]} />} />;
  return (
    <ToolFrame
      id="empty"
      side={
        <>
          <Picker mode="dirs" paths={dirs} onChange={setDirs} label={t('pick.folders')} />
          <p className="small muted">{t('empty.hint')}</p>
        </>
      }
      main={
        !dirs.length ? (
          <Empty icon={<IconBroom size={40} />} text={t('empty.empty')} />
        ) : !found ? (
          <Busy />
        ) : !found.length ? (
          <Empty text={t('empty.none')} />
        ) : (
          <div className="preview">
            <div className="preview-head">
              <b>{t('empty.preview', { n: fmtNum(found.length) })}</b>
            </div>
            <div className="table">
              {found.map((p) => (
                <div className="trow" key={p}>
                  <IconFolder size={15} />
                  <span className="ellipsis grow" title={p}>
                    {p}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      }
      foot={
        !!found?.length && (
          <>
            <span className="muted small">{t('common.trashHint')}</span>
            <div className="spacer" />
            <button className="btn primary lg" onClick={async () => setDone((await call<{ done: number }>('fs:trash', found)).done)}>
              {t('empty.apply', { n: fmtNum(found.length) })}
            </button>
          </>
        )
      }
    />
  );
}

// ------------------------------------------------------------------ Duplikate
type Dupe = { path: string; size: number; mtimeMs: number };
export function DupesTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const [groups, setGroups] = useState<Dupe[][] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  useEffect(() => {
    setGroups(null);
    if (!paths.length) return;
    setScanning(true);
    call<Dupe[][]>('dupes:find', paths).then((g) => {
      setGroups(g);
      // Vorauswahl: in jeder Gruppe alles außer der ältesten Datei
      setSel(new Set(g.flatMap((x) => x.slice(1).map((f) => f.path))));
      setScanning(false);
    });
  }, [paths]);
  const selSize = (groups || []).flat().filter((f) => sel.has(f.path)).reduce((a, f) => a + f.size, 0);
  if (done !== null) return <ToolFrame id="dupes" side={null} main={<Done text={t('dupes.done', { n: fmtNum(done) })} />} />;
  return (
    <ToolFrame
      id="dupes"
      side={
        <>
          <Picker mode="files" paths={paths} onChange={setPaths} label={t('dupes.where')} />
          <p className="small muted">{t('dupes.hint')}</p>
        </>
      }
      main={
        !paths.length ? (
          <Empty icon={<IconCopies size={40} />} text={t('dupes.empty')} />
        ) : scanning || !groups ? (
          <Busy text={t('dupes.scanning')} />
        ) : !groups.length ? (
          <Empty text={t('dupes.none')} />
        ) : (
          <div className="preview">
            <div className="preview-head">
              <b>{t('dupes.preview', { n: fmtNum(groups.length) })}</b>
              <span className="muted small">{t('dupes.selected', { n: sel.size, size: fmtSize(selSize) })}</span>
            </div>
            <div className="dupes" data-testid="dupes-list">
              {groups.slice(0, 300).map((g, i) => (
                <div className="card dupe-group" key={i}>
                  <div className="small faint" style={{ padding: '6px 12px 0' }}>
                    {t('dupes.group', { n: g.length, size: fmtSize(g[0].size) })}
                  </div>
                  {g.map((f) => (
                    <label className="list-row" key={f.path}>
                      <input
                        type="checkbox"
                        checked={sel.has(f.path)}
                        onChange={(e) => {
                          const n = new Set(sel);
                          if (e.target.checked) n.add(f.path);
                          else n.delete(f.path);
                          setSel(n);
                        }}
                      />
                      <span className="ellipsis grow" title={f.path}>
                        {f.path}
                      </span>
                      <button className="btn xs ghost" onClick={(e) => (e.preventDefault(), call('fs:reveal', f.path))}>
                        {t('common.show')}
                      </button>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )
      }
      foot={
        sel.size > 0 && (
          <>
            <span className="muted small">{t('common.trashHint')}</span>
            <div className="spacer" />
            <button
              className="btn danger lg"
              disabled={(groups || []).some((g) => g.every((f) => sel.has(f.path)))}
              title={t('dupes.keepOne')}
              onClick={async () => setDone((await call<{ done: number }>('fs:trash', [...sel])).done)}
            >
              <IconTrash size={16} /> {t('dupes.apply', { n: sel.size })}
            </button>
          </>
        )
      }
    />
  );
}

// ------------------------------------------------------------------ Ordnergröße
type Report = { total: number; files: number; dirs: number; children: { name: string; path: string; size: number; isDir: boolean }[]; biggest: { path: string; rel: string; size: number }[]; byKind: Record<string, number> };
export function SizeTool({ paths: initial }: { paths: string[] }) {
  const [dir, setDir] = useState(initial.slice(0, 1));
  const [r, setR] = useState<Report | null>(null);
  const [tab, setTab] = useState<'folders' | 'files' | 'kinds'>('folders');
  useEffect(() => {
    setR(null);
    if (dir[0]) call<Report>('size:report', dir[0]).then(setR);
  }, [dir]);
  const max = r ? Math.max(1, ...r.children.map((c) => c.size)) : 1;
  return (
    <ToolFrame
      id="size"
      side={
        <>
          <Picker mode="dir" paths={dir} onChange={setDir} label={t('pick.folder')} />
          {r && (
            <div className="stats-grid">
              <div className="mini-stat">
                <b>{fmtSize(r.total)}</b>
                <span>{t('size.total')}</span>
              </div>
              <div className="mini-stat">
                <b>{fmtNum(r.files)}</b>
                <span>{t('size.files')}</span>
              </div>
              <div className="mini-stat">
                <b>{fmtNum(r.dirs)}</b>
                <span>{t('size.dirs')}</span>
              </div>
            </div>
          )}
        </>
      }
      main={
        !dir[0] ? (
          <Empty icon={<IconPie size={40} />} text={t('size.empty')} />
        ) : !r ? (
          <Busy text={t('size.scanning')} />
        ) : (
          <div className="preview">
            <div className="preview-head">
              <Seg value={tab} onChange={setTab} options={[['folders', t('size.tab.folders')], ['files', t('size.tab.files')], ['kinds', t('size.tab.kinds')]]} />
            </div>
            <div className="table bars">
              {tab === 'folders' &&
                r.children.slice(0, 200).map((c) => (
                  <button className="trow bar-row" key={c.path} onClick={() => (c.isDir ? setDir([c.path]) : call('fs:reveal', c.path))}>
                    <i style={{ width: `${(c.size / max) * 100}%` }} />
                    <KindIcon kind={c.isDir ? 'folder' : 'other'} size={14} />
                    <span className="ellipsis grow">{c.name}</span>
                    <span className="small">{fmtSize(c.size)}</span>
                  </button>
                ))}
              {tab === 'files' &&
                r.biggest.map((f) => (
                  <button className="trow" key={f.path} onClick={() => call('fs:reveal', f.path)}>
                    <span className="ellipsis grow" title={f.rel}>
                      {f.rel}
                    </span>
                    <span className="small">{fmtSize(f.size)}</span>
                  </button>
                ))}
              {tab === 'kinds' &&
                Object.entries(r.byKind)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <div className="trow bar-row" key={k}>
                      <i style={{ width: `${(v / Math.max(1, r.total)) * 100}%` }} />
                      <KindIcon kind={k as 'image'} size={14} />
                      <span className="grow">{t(`kind.${k}` as TKey)}</span>
                      <span className="small">{fmtSize(v)}</span>
                    </div>
                  ))}
            </div>
          </div>
        )
      }
    />
  );
}

// ------------------------------------------------------------------ Dateiliste
export function ListTool({ paths: initial }: { paths: string[] }) {
  const [dir, setDir] = useState(initial.slice(0, 1));
  const [format, setFormat] = useState<'csv' | 'txt'>('csv');
  const [out, setOut] = useState('');
  if (out) return <ToolFrame id="list" side={null} main={<Done text={t('list.done')} reveal={out} />} />;
  return (
    <ToolFrame
      id="list"
      side={
        <>
          <Picker mode="dir" paths={dir} onChange={setDir} label={t('pick.folder')} />
          <div className="section-label">{t('list.format')}</div>
          <div className="preset-list cols-2">
            {(['csv', 'txt'] as const).map((f) => (
              <button key={f} className={`preset ${format === f ? 'on' : ''}`} onClick={() => setFormat(f)}>
                <b>{t(`list.${f}` as TKey)}</b>
                <span>{t(`list.${f}.ex` as TKey)}</span>
              </button>
            ))}
          </div>
        </>
      }
      main={<Empty icon={<IconList size={40} />} text={t('list.text')} />}
      foot={
        dir[0] && (
          <>
            <div className="spacer" />
            <button
              className="btn primary lg"
              onClick={async () => {
                const f = await call<string>('list:export', dir[0], format);
                call('fs:open', f);
                refreshHistory();
                setOut(f);
              }}
            >
              {t('list.apply')}
            </button>
          </>
        )
      }
    />
  );
}

// ------------------------------------------------------------------ Prüfsumme
export function HashTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const files = useFiles(paths, {});
  const [algo, setAlgo] = useState<'sha256' | 'sha1' | 'md5'>('sha256');
  const [res, setRes] = useState<{ path: string; hash: string }[] | null>(null);
  const [compare, setCompare] = useState('');
  useEffect(() => {
    setRes(null);
    if (files?.length) call<{ path: string; hash: string }[]>('hash:compute', files.slice(0, 200).map((f) => f.path), algo).then(setRes);
  }, [files, algo]);
  const cmp = compare.trim().toLowerCase();
  return (
    <ToolFrame
      id="hash"
      side={
        <>
          <Picker mode="files" paths={paths} onChange={setPaths} label={t('pick.what')} />
          <Group>
            <Row label={t('hash.algo')}>
              <Seg value={algo} onChange={setAlgo} options={[['sha256', 'SHA-256'], ['sha1', 'SHA-1'], ['md5', 'MD5']]} />
            </Row>
          </Group>
          <label className="field">
            <span>{t('hash.compare')}</span>
            <input className="input mono" value={compare} onChange={(e) => setCompare(e.target.value)} placeholder="e3b0c442…" />
          </label>
        </>
      }
      main={
        !paths.length ? (
          <Empty text={t('hash.empty')} />
        ) : !res ? (
          <Busy />
        ) : (
          <div className="table">
            {res.map((r) => (
              <div className={`trow hash-row ${cmp && (r.hash === cmp ? 'match' : 'nomatch')}`} key={r.path}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis">{basename(r.path)}</div>
                  <div className="mono small faint ellipsis">{r.hash}</div>
                </div>
                {cmp && <span className={`badge ${r.hash === cmp ? 'success' : 'warn'}`}>{r.hash === cmp ? t('hash.match') : t('hash.nomatch')}</span>}
                <button className="btn xs ghost" onClick={() => (call('clipboard:write', r.hash), toast(t('common.copied')))}>
                  {t('common.copy')}
                </button>
              </div>
            ))}
          </div>
        )
      }
    />
  );
}

// ------------------------------------------------------------------ Schnell: Neue Datei, Neuer Ordner mit Auswahl, Pfad kopieren
export function QuickTool({ id, paths: initial }: { id: 'newfile' | 'newfolder' | 'copypath'; paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const [name, setName] = useState(id === 'newfile' ? t('quick.newfile.name') : id === 'newfolder' ? t('quick.newfolder.name') : '');
  const [res, setRes] = useState('');
  const files = useFiles(paths, false);
  const dirOnly = id === 'newfile';
  if (res) return <ToolFrame id={id} side={null} main={<Done text={t(`quick.${id}.done` as TKey)} reveal={res} />} />;
  return (
    <ToolFrame
      id={id}
      side={<Picker mode={dirOnly ? 'dir' : 'files'} paths={paths} onChange={setPaths} label={dirOnly ? t('quick.newfile.where') : t('pick.what')} />}
      main={
        id === 'copypath' ? (
          <div className="preview">
            <pre className="code-box mono small">{paths.join('\n') || '…'}</pre>
          </div>
        ) : (
          <div className="card pad" style={{ maxWidth: 420 }}>
            <label className="field">
              <span>{t('common.name')}</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            {id === 'newfolder' && files && <p className="small muted">{t('quick.newfolder.hint', { n: files.length })}</p>}
          </div>
        )
      }
      foot={
        paths.length > 0 && (
          <>
            <div className="spacer" />
            <button
              className="btn primary lg"
              onClick={async () => {
                if (id === 'copypath') {
                  await call('quick:copypath', paths);
                  toast(t('common.copied'));
                  return;
                }
                const dir = files?.[0];
                const r = id === 'newfile' ? await call<string>('quick:newfile', dir?.isDir ? dir.path : dir?.dir, name) : await call<string>('quick:newfolder', paths, name);
                setRes(r);
                refreshHistory();
              }}
            >
              {t(`quick.${id}.apply` as TKey)}
            </button>
          </>
        )
      }
    />
  );
}
