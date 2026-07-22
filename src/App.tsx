import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { api, Message, Notification, Post, timeAgo, User } from './api'

type View = 'feed' | 'chat' | 'activity' | 'studio'
type IconName = View | 'spark' | 'logout' | 'send' | 'video' | 'close' | 'check'

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    feed: <><path d="M4 5.5h16M4 12h16M4 18.5h10" /><circle cx="18" cy="18.5" r="2" /></>,
    chat: <path d="M20 15a3 3 0 0 1-3 3H9l-5 3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" />,
    activity: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    studio: <><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" /></>,
    spark: <path d="m12 2 2.1 6L20 10l-5.9 2.1L12 18l-2.1-5.9L4 10l5.9-2.1Z" />,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    video: <><rect x="3" y="5" width="14" height="14" rx="2" /><path d="m17 10 4-2v8l-4-2Z" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function Mark() {
  return <span className="mark" aria-hidden="true"><i /><i /><i /><b /></span>
}

function Avatar({ user, small = false }: { user: User, small?: boolean }) {
  const initials = user.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return <span className={`avatar ${small ? 'avatar-small' : ''}`} style={{ background: user.avatarColor }}>{initials}</span>
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const body = mode === 'register'
        ? { username: form.get('username'), displayName: form.get('displayName'), password: form.get('password') }
        : { username: form.get('username'), password: form.get('password') }
      const result = await api<{ user: User }>(`/api/auth/${mode}`, {
        method: 'POST', body: JSON.stringify(body),
      })
      onAuthenticated(result.user)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.')
    } finally {
      setLoading(false)
    }
  }

  function changeMode(next: 'login' | 'register') {
    setMode(next)
    setError('')
  }

  return <main className="auth-shell">
    <section className="auth-story">
      <div className="brand brand-light"><Mark /><span>SynapseForge</span></div>
      <div className="story-copy">
        <span className="eyebrow">Signal over noise</span>
        <h1>Ideas get stronger<br />when they connect.</h1>
        <p>A calm social workspace for thoughtful posts, real-time conversation, and better creative momentum.</p>
        <div className="story-proof"><span className="pulse-dot" /> Private by default · Built for focus</div>
      </div>
      <div className="mesh mesh-one" /><div className="mesh mesh-two" />
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <div className="mobile-brand brand"><Mark /><span>SynapseForge</span></div>
        <span className="eyebrow dark">Your workspace</span>
        <h2>{mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h2>
        <p className="auth-intro">{mode === 'login' ? 'Sign in to pick up where you left off.' : 'Join the network and start shaping better ideas.'}</p>
        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => changeMode('login')}>Sign in</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => changeMode('register')}>Register</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <label>Display name<input name="displayName" autoComplete="name" minLength={2} maxLength={50} placeholder="Nicholas Kelly" required /></label>}
          <label>Username<input name="username" autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" placeholder="your_handle" required /></label>
          <label>Password<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={10} maxLength={128} placeholder="10 characters minimum" required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button" disabled={loading}>{loading ? 'Please wait…' : mode === 'login' ? 'Enter SynapseForge' : 'Create workspace'}<span>→</span></button>
        </form>
        <p className="auth-note">Session credentials stay in a secure, browser-managed cookie and never enter client storage.</p>
      </div>
    </section>
  </main>
}

function Navigation({ view, setView, user, unread, logout }: {
  view: View, setView: (view: View) => void, user: User, unread: number, logout: () => void
}) {
  const entries: Array<{ view: View, label: string }> = [
    { view: 'feed', label: 'Feed' }, { view: 'chat', label: 'Chat' },
    { view: 'activity', label: 'Activity' }, { view: 'studio', label: 'Creator studio' },
  ]
  return <>
    <aside className="sidebar">
      <div className="brand"><Mark /><span>SynapseForge</span></div>
      <nav aria-label="Primary">
        {entries.map((entry) => <button key={entry.view} className={view === entry.view ? 'active' : ''} onClick={() => setView(entry.view)}>
          <Icon name={entry.view} /><span>{entry.label}</span>{entry.view === 'activity' && unread > 0 && <b>{unread}</b>}
        </button>)}
      </nav>
      <div className="sidebar-profile">
        <Avatar user={user} small />
        <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
        <button onClick={logout} title="Sign out" aria-label="Sign out"><Icon name="logout" /></button>
      </div>
    </aside>
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {entries.map((entry) => <button key={entry.view} className={view === entry.view ? 'active' : ''} onClick={() => setView(entry.view)}>
        <Icon name={entry.view} /><span>{entry.label === 'Creator studio' ? 'Studio' : entry.label}</span>
        {entry.view === 'activity' && unread > 0 && <b>{unread}</b>}
      </button>)}
    </nav>
  </>
}

function FeedView({ currentUser, initialDraft, onDraftPublished }: { currentUser: User, initialDraft: string, onDraftPublished: () => void }) {
  const [posts, setPosts] = useState<Post[]>([])
  const [content, setContent] = useState(initialDraft)
  const [video, setVideo] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    api<{ posts: Post[] }>('/api/feed')
      .then((result) => { if (active) setPosts(result.posts) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load the feed.') })
    return () => { active = false }
  }, [])

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!content.trim() && !video) return
    setBusy(true); setError('')
    try {
      let videoUrl: string | undefined
      if (video) {
        const form = new FormData(); form.append('video', video)
        videoUrl = (await api<{ videoUrl: string }>('/api/videos', { method: 'POST', body: form })).videoUrl
      }
      const result = await api<{ post: Post }>('/api/feed', {
        method: 'POST', body: JSON.stringify({ content, videoUrl }),
      })
      setPosts((current) => [result.post, ...current])
      setContent(''); setVideo(null)
      onDraftPublished()
      if (fileRef.current) fileRef.current.value = ''
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not publish the post.')
    } finally { setBusy(false) }
  }

  async function remove(postId: string) {
    try {
      await api(`/api/feed/${postId}`, { method: 'DELETE' })
      setPosts((current) => current.filter((post) => post.id !== postId))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete the post.') }
  }

  return <section className="view feed-view">
    <header className="view-header"><div><span className="eyebrow dark">The network</span><h1>Good morning, {currentUser.displayName.split(' ')[0]}.</h1></div><p>Share something worth carrying forward.</p></header>
    <form className="composer card" onSubmit={publish}>
      <Avatar user={currentUser} />
      <div className="composer-main">
        <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} placeholder="What are you thinking through?" aria-label="Post content" />
        {video && <div className="file-pill"><Icon name="video" /><span>{video.name}</span><button type="button" onClick={() => setVideo(null)} aria-label="Remove video"><Icon name="close" /></button></div>}
        <div className="composer-actions">
          <label className="icon-button"><Icon name="video" /><span>Add video</span><input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => setVideo(event.target.files?.[0] ?? null)} /></label>
          <span className="character-count">{content.length}/2000</span>
          <button className="publish-button" disabled={busy || (!content.trim() && !video)}>{busy ? 'Publishing…' : 'Publish'}<Icon name="send" /></button>
        </div>
      </div>
    </form>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="feed-list">
      {posts.length === 0 && <div className="empty-state card"><span className="empty-orbit"><Mark /></span><h2>Start the first thread.</h2><p>Your network is quiet. Share an observation, a question, or a small win above.</p></div>}
      {posts.map((post) => <article className="post card" key={post.id}>
        <Avatar user={post.user} />
        <div className="post-body">
          <header><span><strong>{post.user.displayName}</strong><small>@{post.user.username} · {timeAgo(post.createdAt)}</small></span>
            {post.user.id === currentUser.id && <button className="subtle-button" onClick={() => void remove(post.id)}>Delete</button>}
          </header>
          {post.content && <p>{post.content}</p>}
          {post.videoUrl && <video className="post-video" src={post.videoUrl} controls preload="metadata" />}
        </div>
      </article>)}
    </div>
  </section>
}

function ChatView({ user }: { user: User }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [body, setBody] = useState('')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const socketRef = useRef<Socket | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const socket = io({ withCredentials: true })
    socketRef.current = socket
    socket.on('connect', () => { setConnected(true); setError('') })
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', (caught) => setError(caught.message))
    socket.on('chat:history', (history: Message[]) => setMessages(history))
    socket.on('chat:message', (message: Message) => setMessages((current) => [...current, message].slice(-100)))
    return () => { socket.disconnect(); socketRef.current = null }
  }, [])
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages])

  function send(event: FormEvent) {
    event.preventDefault()
    const message = body.trim()
    if (!message || !socketRef.current) return
    socketRef.current.emit('chat:send', message, (result: { ok: boolean, error?: string }) => {
      if (!result.ok) setError(result.error ?? 'Message was not sent.')
    })
    setBody('')
  }

  return <section className="view chat-view">
    <header className="view-header compact"><div><span className="eyebrow dark">Realtime room</span><h1>Open channel</h1></div><span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Live' : 'Reconnecting'}</span></header>
    <div className="chat-card card">
      <div className="messages" aria-live="polite">
        {messages.length === 0 && <div className="empty-chat"><Icon name="chat" /><h2>No messages yet</h2><p>Open the room with a question or quick update.</p></div>}
        {messages.map((message) => <div key={message.id} className={`message ${message.user.id === user.id ? 'mine' : ''}`}>
          <Avatar user={message.user} small />
          <div><header><strong>{message.user.id === user.id ? 'You' : message.user.displayName}</strong><time>{timeAgo(message.createdAt)}</time></header><p>{message.body}</p></div>
        </div>)}
        <div ref={endRef} />
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <form className="chat-composer" onSubmit={send}><input value={body} onChange={(event) => setBody(event.target.value)} maxLength={1000} placeholder="Write to the room…" aria-label="Chat message" /><button disabled={!connected || !body.trim()} aria-label="Send message"><Icon name="send" /></button></form>
    </div>
  </section>
}

function ActivityView({ notifications, refresh }: { notifications: Notification[], refresh: () => Promise<void> }) {
  async function markRead() { await api('/api/notifications/read-all', { method: 'POST' }); await refresh() }
  return <section className="view activity-view">
    <header className="view-header compact"><div><span className="eyebrow dark">Your signals</span><h1>Activity</h1></div>{notifications.some((item) => !item.read) && <button className="text-button" onClick={() => void markRead()}><Icon name="check" />Mark all read</button>}</header>
    <div className="activity-list card">
      {notifications.length === 0 && <div className="empty-state"><h2>All caught up.</h2><p>Important updates will land here.</p></div>}
      {notifications.map((item) => <div className={`activity-item ${item.read ? '' : 'unread'}`} key={item.id}><span className="activity-symbol"><Icon name="spark" /></span><div><p>{item.message}</p><time>{timeAgo(item.createdAt)}</time></div>{!item.read && <i className="unread-dot" />}</div>)}
    </div>
  </section>
}

function StudioView({ onUse }: { onUse: (text: string) => void }) {
  const [topic, setTopic] = useState('')
  const [tone, setTone] = useState('clear')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await api<{ suggestions: string[] }>('/api/creator/assist', { method: 'POST', body: JSON.stringify({ topic, tone }) })
      setSuggestions(result.suggestions)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not generate ideas.') }
    finally { setBusy(false) }
  }
  return <section className="view studio-view">
    <header className="view-header"><div><span className="eyebrow dark">Creator tools</span><h1>Find the sharper angle.</h1></div><p>Turn a rough topic into useful starting points—then make the words yours.</p></header>
    <div className="studio-grid">
      <form className="studio-form card" onSubmit={generate}><span className="studio-icon"><Icon name="studio" /></span><h2>Post catalyst</h2><p>Describe the idea you want to explore.</p><label>Topic<textarea value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={180} placeholder="e.g. What building in public taught me about momentum" required /></label><fieldset><legend>Tone</legend><div className="tone-picker">{['clear', 'bold', 'warm'].map((item) => <button type="button" className={tone === item ? 'active' : ''} onClick={() => setTone(item)} key={item}>{item}</button>)}</div></fieldset>{error && <div className="inline-error">{error}</div>}<button className="primary-button" disabled={busy || topic.trim().length < 3}>{busy ? 'Finding angles…' : 'Generate starting points'}<Icon name="spark" /></button></form>
      <div className="suggestions">
        {suggestions.length === 0 ? <div className="suggestion-placeholder"><span>01</span><h2>Your ideas will appear here.</h2><p>Use them as a first draft, not a final voice.</p></div> : suggestions.map((suggestion, index) => <article className="suggestion card" key={suggestion}><span>0{index + 1}</span><p>{suggestion}</p><button onClick={() => onUse(suggestion)}>Use in feed <b>→</b></button></article>)}
      </div>
    </div>
  </section>
}

function Workspace({ user, onLogout }: { user: User, onLogout: () => void }) {
  const [view, setView] = useState<View>('feed')
  const [feedDraft, setFeedDraft] = useState('')
  const [notifications, setNotifications] = useState<Notification[]>([])

  const refreshNotifications = useCallback(async () => {
    const result = await api<{ notifications: Notification[] }>('/api/notifications')
    setNotifications(result.notifications)
  }, [])
  useEffect(() => {
    let active = true
    api<{ notifications: Notification[] }>('/api/notifications')
      .then((result) => { if (active) setNotifications(result.notifications) })
      .catch((error) => console.error(error))
    return () => { active = false }
  }, [])
  const unread = useMemo(() => notifications.filter((item) => !item.read).length, [notifications])

  return <div className="workspace">
    <Navigation view={view} setView={setView} user={user} unread={unread} logout={onLogout} />
    <main className="content">
      {view === 'feed' && <FeedView currentUser={user} initialDraft={feedDraft} onDraftPublished={() => setFeedDraft('')} />}
      {view === 'chat' && <ChatView user={user} />}
      {view === 'activity' && <ActivityView notifications={notifications} refresh={refreshNotifications} />}
      {view === 'studio' && <StudioView onUse={(text) => { setFeedDraft(text); setView('feed') }} />}
    </main>
  </div>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ user: User | null }>('/api/auth/session')
      .then((result) => setUser(result.user))
      .catch((error) => console.error(error))
      .finally(() => setLoading(false))
  }, [])

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }) } finally { setUser(null) }
  }

  if (loading) return <main className="loading-screen"><Mark /><span>Opening SynapseForge</span></main>
  if (!user) return <AuthScreen onAuthenticated={setUser} />
  return <Workspace user={user} onLogout={() => void logout()} />
}
