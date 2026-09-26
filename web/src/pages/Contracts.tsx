import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EditorContent, useEditor, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Heading2, Heading3, Italic, List, ListOrdered, Minus, Undo, Redo } from 'lucide-react';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useMutate } from '@/lib/useMutate';
import { useMe, useSettings } from '@/lib/hooks';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';

export function TemplateList() {
  const nav = useNavigate();
  const { date } = useFormat();
  const { data: me } = useMe();
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['templates'], queryFn: () => api('/templates') });
  const create = useMutate(() => api('/templates', { body: { name, content: '<h2>Equipment hire agreement</h2><p>This agreement is between {{business_name}} (ABN {{business_abn}}) and {{client_name}} for {{event_title}} on {{event_date_range}} at {{venue}}.</p>{{equipment_table}}<p>Security bond: {{bond_amount}}</p>' } }), [['templates']], (t) => nav(`/contracts/${t.id}`));
  return (
    <>
      <PageHeader title="Contract templates" actions={<>
        <Link to="/contracts/clauses"><Button variant="secondary">Clause library</Button></Link>
        {me?.role !== 'READ_ONLY' && <Button onClick={() => setOpen(true)}>New template</Button>}
      </>} />
      <Card>
        {isLoading ? <Spinner /> : (
          <Table head={['Name', 'Version', 'Docuseal', 'Last edited', '']}>
            {data?.map((t: any) => (
              <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/contracts/${t.id}`)}>
                <Td className="font-medium">{t.name}<div className="text-xs text-slate-400">{t.description}</div></Td>
                <Td>v{t.latestVersion}</Td>
                <Td>{t.docusealTemplateId ? <Badge tone="blue">Mapped #{t.docusealTemplateId}</Badge> : <span className="text-xs text-slate-400">Sent as branded document</span>}</Td>
                <Td>{date(t.updatedAt)}</Td><Td>{t.archived && <Badge>Archived</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={open} title="New template" onClose={() => setOpen(false)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
          <Field label="Name" hint="e.g. Standard dry hire, Full production with staff"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          {create.error && <Alert>{create.error}</Alert>}
          <Button loading={create.isPending}>Create</Button>
        </form>
      </Modal>
    </>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const btn = (active: boolean, onClick: () => void, icon: React.ReactNode, label: string) => (
    <button type="button" title={label} onClick={onClick} className={`rounded p-1.5 ${active ? 'bg-slate-200' : 'hover:bg-slate-100'}`}>{icon}</button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap gap-0.5 border-b p-1">
      {btn(editor.isActive('bold'), () => c().toggleBold().run(), <Bold size={16} />, 'Bold')}
      {btn(editor.isActive('italic'), () => c().toggleItalic().run(), <Italic size={16} />, 'Italic')}
      {btn(editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), <Heading2 size={16} />, 'Heading')}
      {btn(editor.isActive('heading', { level: 3 }), () => c().toggleHeading({ level: 3 }).run(), <Heading3 size={16} />, 'Subheading')}
      {btn(editor.isActive('bulletList'), () => c().toggleBulletList().run(), <List size={16} />, 'Bullet list')}
      {btn(editor.isActive('orderedList'), () => c().toggleOrderedList().run(), <ListOrdered size={16} />, 'Numbered list')}
      {btn(false, () => c().setHorizontalRule().run(), <Minus size={16} />, 'Divider')}
      {btn(false, () => c().undo().run(), <Undo size={16} />, 'Undo')}
      {btn(false, () => c().redo().run(), <Redo size={16} />, 'Redo')}
    </div>
  );
}

export function TemplateEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { dateTime } = useFormat();
  const { data: me } = useMe();
  const { data: s } = useSettings();
  const ro = me?.role === 'READ_ONLY';
  const t = useQuery({ queryKey: ['template', id], queryFn: () => api(`/templates/${id}`) });
  const fields = useQuery({ queryKey: ['contract-fields'], queryFn: () => api('/contract-fields') });
  const clauses = useQuery({ queryKey: ['clauses'], queryFn: () => api('/clauses') });
  const dsTemplates = useQuery({ queryKey: ['ds-templates'], queryFn: () => api('/docuseal/templates'), enabled: me?.role === 'ADMIN' && !!s?.hasDocusealToken, retry: false });
  const bookings = useQuery({ queryKey: ['bookings', '', ''], queryFn: () => api('/bookings') });
  const [meta, setMeta] = useState({ name: '', description: '', docusealTemplateId: '' });
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBooking, setPreviewBooking] = useState('');
  const [previewErr, setPreviewErr] = useState('');
  const editor = useEditor({ extensions: [StarterKit], content: '', editable: !ro });

  useEffect(() => {
    if (!t.data || !editor) return;
    setMeta({ name: t.data.name, description: t.data.description ?? '', docusealTemplateId: t.data.docusealTemplateId ?? '' });
    editor.commands.setContent(t.data.content);
  }, [t.data, editor]);

  const save = useMutate(() => api(`/templates/${id}`, { method: 'PUT', body: { ...meta, content: editor!.getHTML() } }), [['template', id], ['templates']]);
  const del = useMutate(() => api(`/templates/${id}`, { method: 'DELETE' }), [['templates']], () => nav('/contracts'));

  const runPreview = async () => {
    setPreviewErr('');
    try {
      const html = await api<string>('/templates/preview', { body: { content: editor!.getHTML(), bookingId: previewBooking || undefined } });
      setPreview(html);
    } catch (e) { setPreviewErr((e as Error).message); }
  };

  const printPreview = () => {
    const w = window.open('', '_blank');
    if (!w || !preview) return;
    w.document.write(preview); w.document.close(); w.focus(); w.print();
  };

  if (t.isLoading) return <Spinner />;
  const groups = (fields.data ?? []).reduce((a: Record<string, any[]>, f: any) => ({ ...a, [f.group]: [...(a[f.group] ?? []), f] }), {});
  return (
    <>
      <PageHeader title={meta.name || 'Template'} subtitle={`Version ${t.data?.versions[0]?.version ?? 1} · saving creates a new version; contracts already issued keep theirs`}
        actions={!ro && <>
          <Button variant="secondary" onClick={runPreview}>Preview PDF</Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save new version</Button>
          <Button variant="ghost" onClick={() => confirm('Delete this template? Templates used by contracts are archived instead.') && del.mutate(undefined)}>Delete</Button>
        </>} />
      {(save.error || del.error) && <div className="mb-3"><Alert>{save.error || del.error}</Alert></div>}
      {save.isSuccess && <div className="mb-3"><Alert tone="green">Saved.</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Card>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><Input value={meta.name} disabled={ro} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
              <Field label="Description"><Input value={meta.description} disabled={ro} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></Field>
              <Field label="Docuseal template (optional)" hint="Blank = send this document itself for signing">
                {dsTemplates.data ? (
                  <Select value={meta.docusealTemplateId} disabled={ro} onChange={(e) => setMeta({ ...meta, docusealTemplateId: e.target.value })}>
                    <option value="">None — send branded document</option>
                    {dsTemplates.data.map((d: any) => <option key={d.id} value={String(d.id)}>{d.name} (#{d.id})</option>)}
                  </Select>
                ) : <Input value={meta.docusealTemplateId} disabled={ro} placeholder="Docuseal template ID" onChange={(e) => setMeta({ ...meta, docusealTemplateId: e.target.value })} />}
              </Field>
            </div>
            {meta.docusealTemplateId && <p className="mt-2 text-xs text-slate-500">Mapped mode: Docuseal’s template provides the layout, and fields named after merge keys (e.g. <code>client_name</code>) are prefilled from the booking.</p>}
          </Card>
          <div className="rounded-lg border bg-white shadow-sm">
            <Toolbar editor={editor} />
            <div className="prose-sm max-w-none p-4"><EditorContent editor={editor} /></div>
          </div>
          <Card title="Version history">
            <Table head={['Version', 'Saved', 'Used by contracts']}>
              {t.data?.versions.map((v: any) => <tr key={v.id}><Td>v{v.version}</Td><Td>{dateTime(v.createdAt)}</Td><Td>{v._count.contracts}</Td></tr>)}
            </Table>
          </Card>
        </div>
        <aside className="space-y-4">
          <Card title="Merge fields">
            <p className="mb-2 text-xs text-slate-500">Click to insert at the cursor. Business values come from Settings.</p>
            {Object.entries(groups).map(([g, fs]) => (
              <div key={g} className="mb-3">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-400">{g}</div>
                <div className="flex flex-wrap gap-1">
                  {(fs as any[]).map((f) => <button key={f.key} type="button" disabled={ro} title={`{{${f.key}}}`} onClick={() => editor?.chain().focus().insertContent(`{{${f.key}}}`).run()} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs hover:bg-slate-200">{f.label}</button>)}
                </div>
              </div>
            ))}
          </Card>
          <Card title="Clauses" actions={<Link to="/contracts/clauses" className="text-xs text-brand-accent">Manage</Link>}>
            <p className="mb-2 text-xs text-slate-500">Drag into the document, or click to insert.</p>
            <div className="space-y-1">
              {clauses.data?.map((c: any) => (
                <div key={c.id} draggable={!ro} onDragStart={(e) => { e.dataTransfer.setData('text/html', c.content); e.dataTransfer.setData('text/plain', ''); }}
                  onClick={() => !ro && editor?.chain().focus().insertContent(c.content).run()}
                  className="cursor-grab rounded border border-dashed px-2 py-1.5 text-sm hover:bg-slate-50">
                  {c.title}{c.category && <span className="ml-1 text-xs text-slate-400">· {c.category}</span>}
                </div>
              ))}
              {clauses.data?.length === 0 && <p className="text-sm text-slate-400">No clauses yet.</p>}
            </div>
          </Card>
          <Card title="Preview with">
            <Select value={previewBooking} onChange={(e) => setPreviewBooking(e.target.value)}>
              <option value="">Sample data</option>
              {bookings.data?.slice(0, 100).map((b: any) => <option key={b.id} value={b.id}>{b.reference} — {b.title}</option>)}
            </Select>
            <Button variant="secondary" className="mt-2 w-full" onClick={runPreview}>Preview</Button>
            {previewErr && <Alert>{previewErr}</Alert>}
          </Card>
        </aside>
      </div>
      <Modal open={!!preview} title="Preview" onClose={() => setPreview(null)} wide>
        <div className="mb-2 flex justify-end"><Button size="sm" variant="secondary" onClick={printPreview}>Print / save as PDF</Button></div>
        {preview && <iframe srcDoc={preview} sandbox="allow-modals" className="h-[70vh] w-full rounded border bg-white" />}
      </Modal>
    </>
  );
}

export function ClauseLibrary() {
  const { data: me } = useMe();
  const ro = me?.role === 'READ_ONLY';
  const { data, isLoading } = useQuery({ queryKey: ['clauses'], queryFn: () => api('/clauses') });
  const [edit, setEdit] = useState<any>(null);
  const editor = useEditor({ extensions: [StarterKit], content: '' });
  useEffect(() => { if (edit && editor) editor.commands.setContent(edit.content ?? ''); }, [edit?.id, edit === null, editor]);
  const save = useMutate(() => api(edit.id ? `/clauses/${edit.id}` : '/clauses', { method: edit.id ? 'PUT' : 'POST', body: { title: edit.title, category: edit.category, content: editor!.getHTML() } }), [['clauses']], () => setEdit(null));
  const del = useMutate((cid: string) => api(`/clauses/${cid}`, { method: 'DELETE' }), [['clauses']]);
  return (
    <>
      <PageHeader title="Clause library" subtitle="Reusable blocks: cancellation, damage liability, power & rigging, insurance…" actions={!ro && <Button onClick={() => setEdit({ title: '', category: '', content: '' })}>New clause</Button>} />
      <Card>
        {isLoading ? <Spinner /> : (
          <Table head={['Title', 'Category', '']}>
            {data?.map((c: any) => (
              <tr key={c.id}><Td className="font-medium">{c.title}</Td><Td>{c.category}</Td>
                <Td className="space-x-2 text-right">{!ro && <><Button size="sm" variant="secondary" onClick={() => setEdit(c)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => confirm('Delete clause? Templates keep their copy.') && del.mutate(c.id)}>Delete</Button></>}</Td></tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!edit} title={edit?.id ? 'Edit clause' : 'New clause'} onClose={() => setEdit(null)} wide>
        {edit && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
              <Field label="Category"><Input value={edit.category ?? ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="e.g. Cancellation" /></Field>
            </div>
            <div className="rounded border"><Toolbar editor={editor} /><div className="p-3"><EditorContent editor={editor} /></div></div>
            <p className="text-xs text-slate-500">Merge fields like {'{{client_name}}'} work inside clauses too.</p>
            {save.error && <Alert>{save.error}</Alert>}
            <div className="flex justify-end"><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!edit.title}>Save</Button></div>
          </div>
        )}
      </Modal>
    </>
  );
}
