import { useStore, dismissToast, call, refreshHistory } from './store';
import { Onboarding } from './components/Onboarding';
import { Header, Home } from './components/Home';
import { SettingsDialog } from './components/Settings';
import { AutoScreen, HistoryScreen } from './components/Auto';
import { StructureTool } from './tools/Structure';
import { RenameTool } from './tools/Rename';
import { ImagesTool } from './tools/Images';
import { DatesTool } from './tools/Dates';
import { SendTool, ReceiveTool } from './tools/Transfer';
import { PdfTool } from './tools/Pdf';
import { SortTool, FlattenTool, EmptyTool, DupesTool, SizeTool, ListTool } from './tools/Organize';
import { t } from './i18n';
import { IconUndo, IconCheck, IconAlert } from './icons';

export function App() {
  const ready = useStore((s) => s.ready);
  const onboarded = useStore((s) => s.settings?.onboarded);
  const showIntro = useStore((s) => s.showIntro);
  const dialog = useStore((s) => s.dialog);
  const view = useStore((s) => s.view);
  // Sprache/Theme-Wechsel sollen alles neu zeichnen
  useStore((s) => s.settings?.prefs);
  if (!ready) return null;
  return (
    <>
      {!onboarded || showIntro ? (
        <Onboarding />
      ) : (
        <div className="app">
          <Header />
          {view.kind === 'home' && <Home />}
          {view.kind === 'auto' && <AutoScreen />}
          {view.kind === 'history' && <HistoryScreen />}
          {view.kind === 'tool' && (
            <div className="screen" key={view.key}>
              <ToolView tool={view.tool} paths={view.paths} />
            </div>
          )}
        </div>
      )}
      {dialog?.kind === 'settings' && <SettingsDialog tab={dialog.tab} />}
      <Toasts />
    </>
  );
}

function ToolView({ tool, paths }: { tool: string; paths: string[] }) {
  switch (tool) {
    case 'structure':
      return <StructureTool paths={paths} />;
    case 'rename':
      return <RenameTool paths={paths} />;
    case 'images':
      return <ImagesTool paths={paths} />;
    case 'dates':
      return <DatesTool paths={paths} />;
    case 'send':
      return <SendTool paths={paths} />;
    case 'receive':
      return <ReceiveTool paths={paths} />;
    case 'pdf':
      return <PdfTool paths={paths} />;
    case 'sort':
      return <SortTool paths={paths} />;
    case 'flatten':
      return <FlattenTool paths={paths} />;
    case 'empty':
      return <EmptyTool paths={paths} />;
    case 'dupes':
      return <DupesTool paths={paths} />;
    case 'size':
      return <SizeTool paths={paths} />;
    case 'list':
      return <ListTool paths={paths} />;
    default:
      return null;
  }
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind === 'error' ? 'error' : ''}`} data-testid="toast">
          {x.kind === 'error' ? <IconAlert size={16} /> : <IconCheck size={16} />}
          <span className="grow">{x.text}</span>
          {x.undo && (
            <button
              className="btn xs ghost"
              onClick={async () => {
                await call('history:undo', x.undo);
                dismissToast(x.id);
                refreshHistory();
              }}
            >
              <IconUndo size={13} /> {t('common.undo')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
