#!/usr/bin/env python3
"""Stage official files for review, then explicitly apply the reviewed transaction.

--source DIRECTORY is gated by a STRUCTURAL check plus a command-reference hash
check. It is NOT a source/authenticity check of the five files:

* structural check: the directory must contain the five official file paths

    SKILL.md
    references/command-reference.md
    references/plugin-authoring.md
    agents/openai.yaml
    assets/logo.png

  Only their existence is verified. The origin, content and authenticity of the
  other four files (SKILL.md, references/plugin-authoring.md, agents/openai.yaml,
  assets/logo.png) are NOT verified: compare them by hand after prepare.
* command-reference hash check: references/command-reference.md is imported only
  when its sha256 is in the adapter's REVIEWED_SHA256 set (reviewed official raw
  text). An already-adapted product (ADAPTED_SHA256) or an unknown hash is
  rejected fail-closed before anything is staged, so the active tree and the
  staged tree both stay unchanged.

A directory name or a version label never proves "official"; do not describe this
gate as source or authenticity certification. Re-running the adapter on an
already-adapted product is a separate idempotent path
(`scripts/adapt_upstream_reference.py <file>`), never a transaction import.

Restore semantics: a backup/rollback restores content *and* the original mode of
each touched file (recorded per file in transaction.json as `mode`; files that did
not exist before are created 0644). `apply` refuses a transaction whose target
files drifted in content or in mode since prepare, before it creates backup/.
"""
import argparse, datetime, difflib, hashlib, importlib.util, json, shutil, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
# Persistent transaction root: /var/minis/workspace does not survive across shell
# processes on this device, so staged batches live under /var/minis/shared.
TRANSACTION_ROOT = Path('/var/minis/shared/surge-updates')
ADAPTER = ROOT/'scripts/adapt_upstream_reference.py'
# Files downloaded and staged from the official installation. `agents/openai.yaml`
# is intentionally NOT applied automatically: it carries local Minis wording and is
# compared by hand after every prepare.
DOWNLOAD = {'SKILL.md':'references/upstream-SKILL.md', 'references/command-reference.md':'references/command-reference.md', 'references/plugin-authoring.md':'references/plugin-authoring.md', 'agents/openai.yaml':'agents/openai.yaml', 'assets/logo.png':'assets/logo.png'}
MANUAL = {'agents/openai.yaml'}
APPLY = {src: dst for src, dst in DOWNLOAD.items() if dst not in MANUAL}
GENERATED = {'references/upstream-command-reference.md', 'references/upstream-manifest.json'}
NEW_FILE_MODE = 0o644
def sha(data): return hashlib.sha256(data).hexdigest()
def current(p):
    p = Path(p)
    return sha(p.read_bytes()) if p.exists() else None
def mode_of(p):
    p = Path(p)
    return (p.stat().st_mode & 0o777) if p.exists() else None
def put(p, data, mode=None):
    """Write atomically, applying `mode` (default 0644, the mode for new files)."""
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    t = p.with_name(p.name+'.update-tmp'); t.write_bytes(data); t.chmod(NEW_FILE_MODE if mode is None else mode); t.replace(p)
def run(args): return subprocess.check_output(args,stderr=subprocess.PIPE)
def adapter_module():
    spec = importlib.util.spec_from_file_location('surge_adapt_upstream_reference', ADAPTER)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
def check_source_dir(source):
    """Refuse a --source that fails the structural gate (five official file paths)."""
    src = Path(source).expanduser().resolve()
    if not src.is_dir(): raise SystemExit('--source must be a directory containing the five official raw file paths: '+str(src))
    if src == ROOT.resolve() or ROOT.resolve() in src.parents:
        raise SystemExit('Refusing --source: '+str(src)+' is this skill/candidate tree, not an unadapted snapshot')
    missing = sorted(rel for rel in DOWNLOAD if not (src/rel).is_file())
    if missing: raise SystemExit('Refusing --source: structural check failed, missing official raw file path(s): '+', '.join(missing)+' (existence only; the other four files are not otherwise verified)')
    return src
def check_reference_is_raw(path):
    """Fail closed unless the imported command reference is reviewed official raw text."""
    digest = current(path)
    kind = adapter_module().classify(digest)
    if kind == 'adapted':
        raise SystemExit(
            'Refusing transaction import: '+str(path)+' sha256='+digest+' is an already-adapted product\n'
            '(listed in ADAPTED_SHA256), NOT official raw text. Do not feed an adapted command\n'
            'reference (e.g. 5331f03b..., 334747c7..., 515303de..., d3163362...) to the transaction as\n'
            '--source, do not\n'
            'stage it as references/upstream-command-reference.md, and do not record it as raw_sha256 in\n'
            'upstream-manifest.json. The only supported re-run path for an adapted product is the separate\n'
            'idempotent adapter: python3 scripts/adapt_upstream_reference.py <file>')
    if kind == 'unknown':
        raise SystemExit(
            'Refusing transaction import: unreviewed command reference sha256='+digest+'\n'
            '(neither REVIEWED_SHA256 official raw text nor a known ADAPTED_SHA256 product). Review the raw\n'
            'diff, update the adapter baseline, then prepare again. Nothing was staged.')
    return digest
def prepare(args):
    source = check_source_dir(args.source) if args.source else None
    if source is not None:
        # Validated before any transaction directory exists: nothing is created or staged.
        check_reference_is_raw(source/'references/command-reference.md')
    folder=TRANSACTION_ROOT/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    folder.mkdir(parents=True); raw=folder/'raw'; staged=folder/'staged'
    version=args.version
    for src,dst in DOWNLOAD.items():
        p=raw/src; p.parent.mkdir(parents=True,exist_ok=True)
        if source:
            p.write_bytes((source/src).read_bytes())
        else:
            run(['scp','-q','-oBatchMode=yes','-oConnectTimeout=10',args.host+':/Applications/Surge.app/Contents/Resources/Skills/surge/'+src,str(p)])
    if not source:
        # A downloaded reference is gated before staging too; raw evidence survives.
        try:
            check_reference_is_raw(raw/'references/command-reference.md')
        except SystemExit as exc:
            shutil.rmtree(staged,ignore_errors=True)
            (folder/'rejected.txt').write_text(str(exc)+'\n')
            raise
    for src,dst in DOWNLOAD.items():
        put(staged/dst, (raw/src).read_bytes())
    if not args.source:
        version=run(['ssh','-oBatchMode=yes','-oConnectTimeout=10',args.host,'/Applications/Surge.app/Contents/Applications/surge-cli version']).decode().strip()
    if not version: raise SystemExit('Explicit --version required for local source')
    diff=[]
    for src,dst in DOWNLOAD.items():
        old=ROOT/dst; new=raw/src
        if new.suffix in ('.md','.yaml'):
            diff.extend(difflib.unified_diff(old.read_text().splitlines(True) if old.exists() else [],new.read_text().splitlines(True),fromfile=dst,tofile='raw/'+src))
    (folder/'review.diff').write_text(''.join(diff))
    print('Review directory:',folder,flush=True)
    # Unknown references stop here; raw evidence and diff survive failure.
    subprocess.run(['python3',str(ADAPTER),str(staged/'references/command-reference.md')],check=True)
    put(staged/'references/upstream-command-reference.md',(raw/'references/command-reference.md').read_bytes())
    provenance={'source':args.source or args.host,'version_report':version,'retrieved_at':datetime.datetime.now().isoformat(),'raw_sha256':{s:current(raw/s) for s in DOWNLOAD},'runtime_validation':'not performed'}
    put(staged/'references/upstream-manifest.json',json.dumps(provenance,indent=2).encode())
    # Only auto-applied files enter the transaction; staged copies of manual files
    # stay in staged/ for human comparison and are never written by apply. Each
    # entry records the active file's original mode (None = file did not exist yet).
    files={str(p.relative_to(staged)):{'before':current(ROOT/p.relative_to(staged)),'after':current(p),'mode':mode_of(ROOT/p.relative_to(staged))} for p in staged.rglob('*') if p.is_file() and str(p.relative_to(staged)) not in MANUAL}
    (folder/'transaction.json').write_text(json.dumps({'files':files,'adapter':current(ADAPTER),'manual':sorted(MANUAL)},indent=2))
    print('Prepared; active skill unchanged. Inspect review.diff, raw/, staged/ before apply.')
    print('Manual comparison required after review: '+', '.join(sorted(MANUAL)))
    print('Gate scope: --source was checked structurally (five official file paths) and by the '
          'command-reference hash only; the other four files (SKILL.md, references/plugin-authoring.md, '
          'agents/openai.yaml, assets/logo.png) are NOT verified by it - compare them by hand.')
def apply(args):
    folder=Path(args.directory).resolve(); tx=json.loads((folder/'transaction.json').read_text()); files=tx['files']
    allowed=set(APPLY.values())|GENERATED
    if set(files)!=allowed: raise SystemExit('Invalid transaction file list')
    if tx['adapter']!=current(ADAPTER): raise SystemExit('Adapter changed; prepare again')
    for name,h in files.items():
        if current(ROOT/name)!=h['before'] or current(folder/'staged'/name)!=h['after']: raise SystemExit('Changed since prepare: '+name)
    # Mode drift is checked BEFORE backup/ is created: if someone tightened or
    # loosened a target file's mode after prepare (content untouched), applying
    # would silently overwrite it with the mode recorded at prepare time.
    for name,h in files.items():
        now=mode_of(ROOT/name)
        if now!=h['mode']:
            raise SystemExit(
                'Mode changed since prepare: '+name+' (recorded '
                +('absent' if h['mode'] is None else oct(h['mode']))+', now '
                +('absent' if now is None else oct(now))+'). Re-run prepare before applying:\n'
                'nothing was written, the active tree is unchanged and no backup/ was created.')
    backup=folder/'backup'; backup.mkdir() # refuse reapplication
    for name,h in files.items():
        if h['before'] is not None: put(backup/name,(ROOT/name).read_bytes(),h['mode'])
    (folder/'state').write_text('applying')
    touched=[]
    try:
        for name in files:
            touched.append(name); put(ROOT/name,(folder/'staged'/name).read_bytes(),files[name]['mode'])
    except BaseException:
        for name in reversed(touched):
            if files[name]['before'] is None: (ROOT/name).unlink(missing_ok=True)
            else: put(ROOT/name,(backup/name).read_bytes(),files[name]['mode'])
        (folder/'state').write_text('rolled-back'); raise
    (folder/'state').write_text('applied')
    print('Applied. Backup:',backup,'; runtime not tested. Review local capability notes separately.')
    print('Modes: each file was written with its recorded original mode (transaction.json files.<name>.mode); new files 0644.')
    print('Not a filesystem-wide atomic transaction and not kill-proof: if this run was killed with state=applying, restore the touched files from backup/ with their recorded mode (content + mode) before retrying.')
p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter,epilog='--source gate = structural check (the directory must contain the five official file paths SKILL.md, references/command-reference.md, references/plugin-authoring.md, agents/openai.yaml, assets/logo.png; existence only) + command-reference hash check (sha256 must be in the adapter REVIEWED_SHA256 set of reviewed official raw text). The other four files require manual comparison after prepare: this gate is not a source or authenticity certification, and a directory name or version label never proves "official". Never pass this skill/candidate tree or an already-adapted upstream copy: an adapted references/command-reference.md is rejected fail-closed.')
sub=p.add_subparsers(dest='action',required=True)
s=sub.add_parser('prepare',description='Stage the five official files for review; never changes the active skill.')
s.add_argument('--host',default='macmini')
s.add_argument('--source',help='Snapshot directory gated by: structural check (must contain the five official file paths SKILL.md, references/command-reference.md, references/plugin-authoring.md, agents/openai.yaml, assets/logo.png; existence only) + command-reference hash check (must be in the reviewed official raw set). The other four files need manual comparison; this is not a source/authenticity certification. Not this skill/candidate tree, not an already-adapted upstream copy.')
s.add_argument('--version',help='Version label for a local --source (required when --source is used).')
s=sub.add_parser('apply',description='Apply a prepared transaction directory (content + recorded modes); refuses content or mode drift since prepare before creating backup/.')
s.add_argument('directory')
a=p.parse_args()
if a.action=='prepare': prepare(a)
else: apply(a)
