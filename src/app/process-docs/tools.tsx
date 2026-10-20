'use client'

/** The editing controls of Process Documentation. Shown only to people who may edit. */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/items/parts'
import {
  myUploadTokens,
  newFolder,
  newUploadToken,
  removeDocument,
  removeFolderAction,
  renameDocument,
  renameFolderAction,
  replaceDocument,
  revokeMyUploadToken,
  uploadDocument,
  type DocState,
  type TokenState,
} from './actions'

const ACCEPT = '.html,.htm,.md,.markdown'

/** One field and a button, in a modal: new folder, rename. */
function NameDialog({ title, initial, action, onClose, onDone }: { title: string; initial: string; action: (name: string) => Promise<DocState>; onClose: () => void; onDone: (r: DocState) => void }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setBusy(true)
    const r = await action(name)
    setBusy(false)
    if (r.error) return setError(r.error)
    onDone(r)
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="pd-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input id="pd-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus />
        <div className="pd-actions">
          {error ? <span className="mr-said mr-bad">{error}</span> : null}
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** "Remove X?" with the consequence, then the button. */
function ConfirmDialog({ title, what, action, onClose, onDone }: { title: string; what: string; action: () => Promise<DocState>; onClose: () => void; onDone: (r: DocState) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title={title} onClose={onClose}>
      <p className="pd-warn">{what}</p>
      <div className="pd-actions">
        {error ? <span className="mr-said mr-bad">{error}</span> : null}
        <button type="button" className="btn" onClick={onClose}>
          Keep it
        </button>
        <button
          type="button"
          className="btn pd-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = await action()
            setBusy(false)
            if (r.error) return setError(r.error)
            onDone(r)
          }}
        >
          {busy ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </Modal>
  )
}

/** A file picker that reads the file and hands its text on. */
function useFilePicker(onFile: (content: string, fileName: string) => Promise<void>) {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      accept={ACCEPT}
      hidden
      onChange={async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) await onFile(await f.text(), f.name)
      }}
    />
  )
  return { input, open: () => ref.current?.click() }
}

export function FolderTools({ folder }: { folder: { id: string; name: string } | null }) {
  const router = useRouter()
  const [dialog, setDialog] = useState<'new' | 'rename' | 'remove' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const picker = useFilePicker(async (content, fileName) => {
    if (!folder) return
    setBusy(true)
    setError(null)
    const r = await uploadDocument({ folderId: folder.id, content, fileName })
    setBusy(false)
    if (r.error) return setError(r.error)
    router.push(`/process-docs/a/${r.id}`)
  })

  return (
    <div className="pd-tools">
      {picker.input}
      {error ? <span className="mr-said mr-bad">{error}</span> : null}
      {folder ? (
        <button type="button" className="btn btn-primary" onClick={picker.open} disabled={busy} title="An .html or .md file, as Claude saved it">
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      ) : null}
      <button type="button" className="btn" onClick={() => setDialog('new')}>
        {folder ? 'New subfolder' : 'New folder'}
      </button>
      {folder ? (
        <>
          <button type="button" className="btn" onClick={() => setDialog('rename')}>
            Rename
          </button>
          <button type="button" className="btn" onClick={() => setDialog('remove')}>
            Remove
          </button>
        </>
      ) : null}

      {dialog === 'new' ? (
        <NameDialog
          title={folder ? `New folder in ${folder.name}` : 'New folder'}
          initial=""
          action={(name) => newFolder({ parentId: folder?.id ?? null, name })}
          onClose={() => setDialog(null)}
          onDone={(r) => router.push(`/process-docs/f/${r.id}`)}
        />
      ) : null}
      {dialog === 'rename' && folder ? (
        <NameDialog
          title="Rename folder"
          initial={folder.name}
          action={(name) => renameFolderAction({ id: folder.id, name })}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            router.refresh()
          }}
        />
      ) : null}
      {dialog === 'remove' && folder ? (
        <ConfirmDialog
          title={`Remove ${folder.name}?`}
          what="The folder, every folder inside it and every document in them are removed for everyone. This cannot be undone."
          action={() => removeFolderAction({ id: folder.id, name: folder.name })}
          onClose={() => setDialog(null)}
          onDone={(r) => router.push(r.parentId ? `/process-docs/f/${r.parentId}` : '/process-docs')}
        />
      ) : null}
    </div>
  )
}

export function DocTools({ doc }: { doc: { id: string; name: string; folderId: string } }) {
  const router = useRouter()
  const [dialog, setDialog] = useState<'rename' | 'remove' | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const picker = useFilePicker(async (content, fileName) => {
    setBusy(true)
    setNote(null)
    const r = await replaceDocument({ id: doc.id, content, fileName })
    setBusy(false)
    if (r.error) return setNote(r.error)
    setNote(`Version ${r.version} is up.`)
    router.refresh()
  })
  return (
    <div className="pd-tools">
      {picker.input}
      {note ? <span className="pd-note">{note}</span> : null}
      <button type="button" className="btn" onClick={picker.open} disabled={busy} title="Upload a new version over this one; the earlier ones are kept">
        {busy ? 'Uploading…' : 'Replace'}
      </button>
      <button type="button" className="btn" onClick={() => setDialog('rename')}>
        Rename
      </button>
      <button type="button" className="btn" onClick={() => setDialog('remove')}>
        Remove
      </button>
      {dialog === 'rename' ? (
        <NameDialog
          title="Rename"
          initial={doc.name}
          action={(name) => renameDocument({ id: doc.id, name })}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            router.refresh()
          }}
        />
      ) : null}
      {dialog === 'remove' ? (
        <ConfirmDialog
          title={`Remove ${doc.name}?`}
          what="It is removed for everyone, with all its versions. This cannot be undone."
          action={() => removeDocument({ id: doc.id, name: doc.name })}
          onClose={() => setDialog(null)}
          onDone={() => router.push(`/process-docs/f/${doc.folderId}`)}
        />
      ) : null}
    </div>
  )
}

/** Tokens for publishing from Claude, and the words to give Claude. */
export function PublishFromClaude() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Publish from Claude
      </button>
      {open ? <PublishDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function PublishDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<TokenState | null>(null)
  const [copied, setCopied] = useState(false)
  // Only ever rendered in the browser, after a click: the address is there.
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin))
  useEffect(() => {
    myUploadTokens()
      .then(setState)
      .catch(() => setState({ error: 'Could not load your tokens.' }))
  }, [])
  const instructions = state?.token
    ? [
        `To publish an artifact to MR Portfolio Control's Process Documentation:`,
        `POST ${origin}/api/docs/upload`,
        `Header: Authorization: Bearer ${state.token}`,
        `JSON body: {"folder": "Folder/Subfolder", "name": "Document name", "html": "<the artifact's complete HTML>"}`,
        `Publishing again with the same name in the same folder uploads a new version. GET the same address with the header to list the folders.`,
        `Treat the token as a password: it publishes as me.`,
      ].join('\n')
    : ''
  return (
    <Modal title="Publish from Claude" onClose={onClose}>
      <div className="pd-form">
        <p className="pd-lead">Give Claude a token, and it can publish an artifact here directly, or a new version of one.</p>
        {state?.error ? <p className="mr-said mr-bad">{state.error}</p> : null}
        {state?.token ? (
          <>
            <p className="pd-warn">Copy this now: it is shown once. Paste it into your Claude chat or project instructions.</p>
            <pre className="pd-code">{instructions}</pre>
            <div className="pd-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(instructions)
                    setCopied(true)
                  } catch {
                    setCopied(false)
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy for Claude'}
              </button>
            </div>
          </>
        ) : (
          <div className="pd-actions">
            <button type="button" className="btn btn-primary" onClick={async () => setState(await newUploadToken('Claude'))}>
              Make a token
            </button>
          </div>
        )}
        {state?.tokens?.length ? (
          <ul className="pd-tokens">
            {state.tokens.map((t) => (
              <li key={t.id}>
                <span>{t.label ?? 'Token'} · made {t.createdAt.slice(0, 10)}</span>
                <em>{t.lastUsedAt ? `last used ${t.lastUsedAt.slice(0, 10)}` : 'not used yet'}</em>
                <button type="button" className="linkish" onClick={async () => setState({ ...(await revokeMyUploadToken(t.id)), token: state.token })}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  )
}
