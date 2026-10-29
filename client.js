// dsh-experience — client bundle (classic script, factory-form CJS).
// Purpose-first experience-library panel. Views:
//   home (我要做什么 → 库的缺口 → 按主题浏览 → 内容重叠) → category → content
//   (structured sections: 症状/原因/避坑/诊断关键词, 避坑 copyable) → search → inbox.
// Styling is centralized in style constants; all colors follow --dsw-alias-*
// theme tokens; text-only tags replace emoji so the UI stays monochrome.
window.__ModuleLoader__.load({
  id: 'dsh-experience',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var LIST_URL = '/experience/list'
    var SEARCH_URL = '/experience/search'
    var READ_URL = '/experience/read'
    var STATS_URL = '/experience/stats'
    var GAPS_URL = '/experience/gaps'
    var INBOX_URL = '/experience/inbox'
    var FLAG_URL = '/experience/flag'

    // The official Desktop app (Electron) draws its own window controls in the
    // top-right corner. A full-height panel pinned to top:0 puts our ✕ right
    // underneath them, so start the panel below that strip inside Electron
    // (browsers have no such strip, so the inset stays 0 there).
    var IS_DESKTOP = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '')
    var TOP_INSET = IS_DESKTOP ? 38 : 0

    // ── style constants ──
    // Layout language borrowed from dsh-better-sidebar: flat surface (no
    // shadow), hairline borders, session-row interaction (hover fill, mount
    // fade), pill badges, tertiary section titles, theme transitions.
    var s = {
      panel: {
        position: 'fixed', top: TOP_INSET, right: 0, bottom: 0, width: 400, maxWidth: '94vw',
        background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
        borderLeft: '1px solid var(--dsw-alias-border-l2)',
        zIndex: 40, display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)', overflow: 'hidden',
      },
      header: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 14, flex: '0 0 auto',
      },
      iconBtn: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: 26, padding: '0 8px', border: 'none', borderRadius: 6,
        background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer', fontSize: 12,
        transition: 'background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)',
      },
      searchBar: { padding: 8, display: 'flex', gap: 6, flex: '0 0 auto', alignItems: 'center' },
      input: {
        flex: 1, height: 26, padding: '0 9px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', fontSize: 12, outline: 'none',
      },
      btn: {
        height: 26, padding: '0 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap',
        transition: 'background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)',
      },
      miniBtn: {
        height: 20, padding: '0 7px', borderRadius: 5, border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
      },
      list: { flex: 1, overflowY: 'auto', padding: '4px 6px 12px' },
      row: { padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, display: 'block', width: '100%', boxSizing: 'border-box' },
      title: { fontWeight: 600, fontSize: 13 },
      sub: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 },
      secTitle: { padding: '10px 10px 4px', fontWeight: 600, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', letterSpacing: '0.08em' },
      muted: { color: 'var(--dsw-alias-label-secondary)' },
      error: { color: 'var(--dsw-alias-state-error-primary)' },
      warn: { color: 'var(--dsw-alias-state-warn-primary)' },
      crumb: { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' },
      crumbLink: { color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontSize: 12, textDecoration: 'none' },
      crumbSep: { opacity: 0.5 },
      actionRow: { display: 'flex', gap: 6, alignItems: 'center', padding: '4px 10px 8px', flex: '0 0 auto', flexWrap: 'wrap' },
      gapCard: {
        margin: '2px 10px 6px', padding: '8px 10px', borderRadius: 8, fontSize: 12,
        border: '1px dashed var(--dsw-alias-border-l2)',
        background: 'color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef6) 6%, transparent)',
      },
      gapTitle: { fontWeight: 600, fontSize: 12 },
      gapSub: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 },
      gapBtns: { marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' },
      sect: { margin: '0 10px 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, overflow: 'hidden' },
      sectHead: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 9px', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
        color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)',
      },
      sectBody: { padding: '8px 9px', fontSize: 13, lineHeight: 1.6 },
      chead: { padding: '6px 10px 0', flex: '0 0 auto' },
      ctitle: { fontSize: 15, fontWeight: 600, lineHeight: 1.35 },
      cpath: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 },
    }

    // Pill badge: minimal status chip (better-sidebar tabBadge recipe:
    // hover-fill background + semantic ink, radius 8 pill).
    function Tag(text, color) {
      return React.createElement('span', {
        style: {
          display: 'inline-block', fontSize: 10, lineHeight: 1, padding: '3px 7px', borderRadius: 8,
          background: 'var(--dsw-alias-interactive-bg-hover)', color: color, marginLeft: 6, verticalAlign: 'middle',
        },
      }, text)
    }

    var PANEL_CSS = [
      // Session-row interaction: hover fill + mount fade (better-sidebar rows).
      '.dsh-exp-row { transition: background var(--ds-transition-duration-slow) var(--ds-ease-in-out); animation: dsh-exp-row-in 150ms var(--ds-ease-in-out); }',
      '.dsh-exp-row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      // Chevron is a hover affordance only: space reserved, invisible at rest.
      '.dsh-exp-chev { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 13px; color: var(--dsw-alias-label-tertiary); opacity: 0; transition: opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out); }',
      '.dsh-exp-row:hover .dsh-exp-chev { opacity: 1; }',
      '@keyframes dsh-exp-row-in { from { opacity: 0; } }',
      // Press feedback: smooth hover fill, a real pressed state (scale), and a focus ring.
      '.dsh-exp-btn, .dsh-exp-iconbtn { transition: background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), transform 90ms var(--ds-ease-in-out); }',
      '.dsh-exp-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.dsh-exp-iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.dsh-exp-btn:active, .dsh-exp-iconbtn:active { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); transform: scale(0.93); }',
      '.dsh-exp-btn:focus-visible, .dsh-exp-iconbtn:focus-visible { outline: 2px solid var(--dsw-alias-border-l2); outline-offset: 1px; }',
      '.dsh-exp-crumb:hover { color: var(--dsw-alias-label-primary); text-decoration: underline; }',
      '.dsh-exp-input:focus { border-color: var(--dsw-alias-border-l2); }',
      '.dsh-exp-list::-webkit-scrollbar { width: 8px; }',
      '.dsh-exp-list::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l1); border-radius: 4px; }',
      '.dsh-exp-list::-webkit-scrollbar-track { background: transparent; }',
      // Structured content body
      '.dsh-exp-sb p { margin: 0 0 6px; }',
      '.dsh-exp-sb p:last-child { margin-bottom: 0; }',
      '.dsh-exp-sb ul { margin: 2px 0; padding-left: 18px; }',
      '.dsh-exp-sb li { margin: 2px 0; }',
      '.dsh-exp-sb code { background: var(--dsw-alias-interactive-bg-hover); padding: 1px 4px; border-radius: 4px; font-size: 12px; }',
      '.dsh-exp-sb pre { margin: 4px 0; padding: 8px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover); overflow-x: auto; font-size: 12px; line-height: 1.5; }',
      '.dsh-exp-sb blockquote { margin: 2px 0; padding-left: 8px; border-left: 2px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }',
    ].join('\n')
    function injectStyles() {
      var style = document.createElement('style')
      style.textContent = PANEL_CSS
      document.head.appendChild(style)
      return function () { style.remove() }
    }

    function BookIcon(size) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', style: { display: 'block' },
      }, React.createElement('path', { d: 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z' }))
    }

    // Minimal outline file glyphs (feather-style): monochrome, theme ink.
    var glyph = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', display: 'block', flex: 'none' }
    function FolderIcon(size) {
      return React.createElement('svg', Object.assign({}, glyph, { width: size, height: size, viewBox: '0 0 24 24' }),
        React.createElement('path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }))
    }
    function FileIcon(size) {
      return React.createElement('svg', Object.assign({}, glyph, { width: size, height: size, viewBox: '0 0 24 24' }),
        React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        React.createElement('polyline', { points: '14 2 14 8 20 8' }))
    }
    function IndexIcon(size) {
      return React.createElement('svg', Object.assign({}, glyph, { width: size, height: size, viewBox: '0 0 24 24' }),
        React.createElement('path', { d: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' }),
        React.createElement('path', { d: 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' }))
    }
    // Hover-only affordance: this row opens into a library / directory.
    function ChevronIcon(size) {
      return React.createElement('svg', Object.assign({}, glyph, { width: size, height: size, viewBox: '0 0 24 24' }),
        React.createElement('polyline', { points: '9 18 15 12 9 6' }))
    }

    // ── markdown-lite renderer (no dependency; structure over fidelity) ──
    // Inline: `code` and **bold** become elements, everything else stays text.
    function inline(text, kp) {
      var out = []
      var re = /(`[^`]+`|\*\*[^*]+\*\*)/g
      var last = 0, m, i = 0
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index))
        var tk = m[0]
        if (tk.charAt(0) === '`') out.push(React.createElement('code', { key: kp + '-c' + (i++) }, tk.slice(1, -1)))
        else out.push(React.createElement('strong', { key: kp + '-b' + (i++) }, tk.slice(2, -2)))
        last = m.index + tk.length
      }
      if (last < text.length) out.push(text.slice(last))
      return out.length ? out : [text]
    }
    // Blocks: fenced code, headings, lists, quotes, paragraphs.
    function mdBlocks(text, kp) {
      var lines = String(text || '').split('\n')
      var blocks = [], i = 0, n = 0
      function isList(t) { return /^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t) }
      while (i < lines.length) {
        var t = lines[i].trim()
        if (!t) { i++; continue }
        if (t.slice(0, 3) === '```') {
          var code = []
          i++
          while (i < lines.length && lines[i].trim().slice(0, 3) !== '```') { code.push(lines[i]); i++ }
          i++
          blocks.push(React.createElement('pre', { key: kp + '-code' + (n++) }, code.join('\n')))
          continue
        }
        if (t.charAt(0) === '#') {
          var lvl = (t.match(/^#+/) || ['#'])[0].length
          blocks.push(React.createElement('div', {
            key: kp + '-h' + (n++),
            style: { fontWeight: 600, fontSize: lvl <= 2 ? 13 : 12, margin: '4px 0 2px' },
          }, inline(t.replace(/^#+\s*/, ''), kp + 'h' + n)))
          i++
          continue
        }
        if (isList(t)) {
          var items = []
          while (i < lines.length && isList(lines[i].trim())) {
            items.push(lines[i].trim().replace(/^([-*]|\d+\.)\s+/, ''))
            i++
          }
          blocks.push(React.createElement('ul', { key: kp + '-ul' + (n++) },
            items.map(function (it, k) {
              return React.createElement('li', { key: k }, inline(it, kp + 'li' + n + '-' + k))
            })))
          continue
        }
        if (t.charAt(0) === '>') {
          var qs = []
          while (i < lines.length && lines[i].trim().charAt(0) === '>') {
            qs.push(lines[i].trim().replace(/^>\s?/, ''))
            i++
          }
          blocks.push(React.createElement('blockquote', { key: kp + '-q' + (n++) }, inline(qs.join(' '), kp + 'q' + n)))
          continue
        }
        var para = [t]
        i++
        while (i < lines.length) {
          var nx = lines[i].trim()
          if (!nx || nx.charAt(0) === '#' || nx.charAt(0) === '>' || nx.slice(0, 3) === '```' || isList(nx)) break
          para.push(nx)
          i++
        }
        blocks.push(React.createElement('p', { key: kp + '-p' + (n++) }, inline(para.join(' '), kp + 'p' + n)))
      }
      return blocks
    }
    // Split one entry: front-matter off, first `#` is the title, `##` are sections.
    function splitEntry(text) {
      var src = String(text || '').replace(/^\s*<!--[\s\S]*?-->\s*/, '')
      var lines = src.split('\n')
      var title = '', intro = [], sections = [], cur = null
      for (var i = 0; i < lines.length; i++) {
        var m1 = /^#\s+(.+)$/.exec(lines[i])
        var m2 = /^##\s+(.+)$/.exec(lines[i])
        if (m1) { title = m1[1].trim(); continue }
        if (m2) { cur = { name: m2[1].trim(), body: [] }; sections.push(cur); continue }
        if (cur) cur.body.push(lines[i])
        else intro.push(lines[i])
      }
      return { title: title, intro: intro.join('\n'), sections: sections }
    }
    function sectionTone(name) {
      if (/症状|问题/.test(name)) return { color: 'var(--dsw-alias-state-warn-primary)' }
      if (/避坑|解决|做法/.test(name)) return { color: 'var(--dsw-alias-brand-primary, #3b6ef6)' }
      return { color: 'var(--dsw-alias-label-secondary)' }
    }
    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text)
      } catch (e) { /* ignore */ }
      try {
        var ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch (e) { /* ignore */ }
      return Promise.resolve()
    }

    function ExperiencePanel(props) {
      var wide = props.wide
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var hoverState = React.useState(false)
      var hovered = hoverState[0]
      var setHovered = hoverState[1]
      var dataState = React.useState(null)
      var data = dataState[0]
      var setData = dataState[1]
      var gapsState = React.useState(null)
      var gaps = gapsState[0]
      var setGaps = gapsState[1]
      var hitsState = React.useState(null)
      var hits = hitsState[0]
      var setHits = hitsState[1]
      var qState = React.useState('')
      var q = qState[0]
      var setQ = qState[1]
      var dirState = React.useState(null)
      var dir = dirState[0]
      var setDir = dirState[1]
      var libState = React.useState(null)
      var lib = libState[0]
      var setLib = libState[1]
      var contentState = React.useState(null)
      var content = contentState[0]
      var setContent = contentState[1]
      var errState = React.useState(null)
      var err = errState[0]
      var setErr = errState[1]
      var inboxState = React.useState(null)
      var inbox = inboxState[0]
      var setInbox = inboxState[1]
      var inboxCountState = React.useState(0)
      var inboxCount = inboxCountState[0]
      var setInboxCount = inboxCountState[1]


      function loadList() {
        return fetch(LIST_URL).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.ok) setData({ libraries: d.libraries || [], categories: d.categories || [], guide: d.guide || [], warnings: d.warnings || [], similar: d.similar || [] })
        })
      }
      function loadGaps() {
        return fetch(GAPS_URL).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.ok) setGaps({ signatures: d.signatures || [], missed: d.missed || [], drafts: d.drafts || [], inbox: d.inbox || null })
        }).catch(function () { /* ignore */ })
      }
      function openPanel() {
        setOpen(true)
        setContent(null)
        setDir(null)
        setLib(null)
        setHits(null)
        setQ('')
        setErr(null)
        setInbox(null)
        loadList().catch(function () { setErr('加载失败') })
        loadGaps()
        fetch(STATS_URL).then(function (r) { return r.json() }).then(function (st) {
          if (st && st.ok) setInboxCount(st.inboxCount || 0)
        }).catch(function () {})
      }
      // One click: move inbox records already answered elsewhere out of the
      // pool — either the library covers the error, or the failure is a
      // usage/config class covered by 00-global/03. Nothing is deleted: they
      // land in meta.inboxArchive.
      function pruneInbox() {
        setErr(null)
        fetch('/experience/inbox/prune').then(function (r) { return r.json() }).then(function (d) {
          if (d && d.ok) {
            setErr('已归档 ' + d.archived + ' 条候选、' + (d.draftsArchived || 0) + ' 份废草稿（库内已覆盖/用法类，保留可追溯）；队列剩 ' + d.remaining + ' 条（待整理 ' + d.open + ' 条）')
            loadList(); loadGaps(); openInbox()
            fetch(STATS_URL).then(function (r) { return r.json() }).then(function (st) {
              if (st && st.ok) setInboxCount(st.inboxCount || 0)
            }).catch(function () {})
          } else setErr((d && d.error) || '清理失败')
        }).catch(function () { setErr('清理失败') })
      }

      function close() { setOpen(false) }

      function refresh() {
        setErr(null)
        fetch('/experience/refresh').then(function (r) { return r.json() }).then(function (d) {
          if (d && d.ok) { loadList(); loadGaps() } else setErr((d && d.error) || '刷新失败')
        }).catch(function () { setErr('刷新失败') })
      }

      function openInbox() {
        fetch(INBOX_URL).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.ok) { setInbox(d.inbox || []); setErr(null) } else setErr('读取候选失败')
        }).catch(function () { setErr('读取候选失败') })
      }
      function inboxDraft(id) {
        fetch('/experience/inbox/draft?id=' + encodeURIComponent(id))
          .then(function (r) { return r.json() })
          .then(function (d) {
            setErr(d && d.ok ? ('草稿已生成: ' + d.path) : ((d && d.error) || '生成草稿失败'))
            openInbox()
          })
          .catch(function () { setErr('生成草稿失败') })
      }
      function inboxDismiss(id) {
        fetch('/experience/inbox/dismiss?id=' + encodeURIComponent(id))
          .then(function (r) { return r.json() })
          .then(function (d) { if (d && d.ok) { setInbox(d.inbox || []); setInboxCount(d.inbox.length) } })
          .catch(function () {})
      }

      function doSearch(queryOverride) {
        var query = (queryOverride !== undefined ? queryOverride : q).trim()
        if (!query) { setHits(null); return }
        if (queryOverride !== undefined) setQ(query)
        setContent(null)
        setDir(null)
        setInbox(null)
        fetch(SEARCH_URL + '?q=' + encodeURIComponent(query))
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (d && d.ok) { setHits({ query: query, items: d.hits || [], suggest: !!d.suggest }); setErr(null) } else setErr('搜索失败')
          })
          .catch(function () { setErr('搜索失败') })
      }
      function reset() { setQ(''); setHits(null); setContent(null); setDir(null); setLib(null); setErr(null); setInbox(null) }

      function submitCandidate(msg) {
        fetch(INBOX_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'search-miss', message: msg || ('面板搜索未命中: ' + q) }),
        }).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.ok) { setErr('已提交候选（可到「候选」中生成草稿）'); setInboxCount((d.inbox || []).length); openInbox() }
          else setErr('提交失败')
        }).catch(function () { setErr('提交失败') })
      }

      function flagFile(rel) {
        fetch(FLAG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: rel, issue: '面板标记有误/已过时' }),
        }).then(function (r) { return r.json() }).then(function (d) {
          setErr(d && d.ok ? '已标记，可信度降至 ' + d.confidence.toFixed(1) : '标记失败')
        }).catch(function () { setErr('标记失败') })
      }

      function jumpToDir(target) {
        setDir(target.replace(/\/+$/g, ''))
        setLib(null)
        setContent(null)
        setHits(null)
        setInbox(null)
      }
      function openFile(rel) {
        fetch(READ_URL + '?path=' + encodeURIComponent(rel))
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (d && d.ok) { setContent({ rel: d.path, text: d.text, meta: d.meta || {} }); setErr(null) }
            else setErr((d && d.error) || '读取失败')
          })
          .catch(function () { setErr('读取失败') })
      }

      var activeCat = null
      if (data && dir) {
        for (var i = 0; i < data.categories.length; i++) {
          if (data.categories[i].dir === dir) { activeCat = data.categories[i]; break }
        }
      }
      var activeLib = null
      if (data && data.libraries && lib) {
        for (var li = 0; li < data.libraries.length; li++) {
          if (data.libraries[li].id === lib) { activeLib = data.libraries[li]; break }
        }
      }

      // ── view helpers ──

      function statusTags(h) {
        var tags = []
        if (h.severity === 'critical') tags.push(Tag('⚠ 最高危险', 'var(--dsw-alias-state-error-primary)'))
        if (h.stale) tags.push(Tag('过时', 'var(--dsw-alias-state-warn-primary)'))
        if (typeof h.confidence === 'number' && h.confidence < 0.5) tags.push(Tag('可信度低', 'var(--dsw-alias-state-error-primary)'))
        if (h.verified === false) tags.push(Tag('验证失败', 'var(--dsw-alias-state-error-primary)'))
        return tags
      }

      // Breadcrumb: 经验库 › 目录 › 文件（每级可回退）。
      function breadcrumb() {
        var nodes = []
        nodes.push(React.createElement('button', {
          key: 'home', className: 'dsh-exp-crumb', style: s.crumbLink,
          onClick: function () { setDir(null); setLib(null); setContent(null); setHits(null); setInbox(null) },
        }, '经验库'))
        if (activeLib) {
          nodes.push(React.createElement('span', { key: 's0', style: s.crumbSep }, '›'))
          nodes.push(React.createElement('span', { key: 'l', style: { fontSize: 12 } }, activeLib.name))
        }
        if (dir) {
          nodes.push(React.createElement('span', { key: 's1', style: s.crumbSep }, '›'))
          nodes.push(React.createElement('span', { key: 'd', style: { fontSize: 12 } }, dir))
        }
        if (content) {
          nodes.push(React.createElement('span', { key: 's2', style: s.crumbSep }, '›'))
          nodes.push(React.createElement('span', { key: 'f', style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)' } }, content.rel.split('/').pop()))
        }
        return React.createElement('div', { key: 'crumb', style: s.crumb }, nodes)
      }

      // 库的缺口：最该补的经验（复发且无解法）+ 已起草待认领 + 未命中查询。
      function gapsView() {
        var nodes = []
        var list = (gaps && gaps.signatures ? gaps.signatures : []).filter(function (g) { return g.gap })
        var missed = (gaps && gaps.missed) ? gaps.missed : []
        var drafts = (gaps && gaps.drafts) ? gaps.drafts.filter(function (d) { return d.promotable }) : []
        if (!list.length && !missed.length && !drafts.length) return nodes
        nodes.push(React.createElement('div', { key: 'gaps-t', style: s.secTitle }, '库的缺口 · 建议补写'))
        if (drafts.length) {
          nodes.push(React.createElement('div', { key: 'drafts-t', style: s.secTitle }, '已起稿 · 待认领'))
          drafts.slice(0, 4).forEach(function (d, i) {
            nodes.push(React.createElement('div', { key: 'draft' + i, style: s.gapCard },
              React.createElement('div', { style: s.gapTitle }, d.file,
                d.signature ? Tag(d.signature + ' × ' + d.count, 'var(--dsw-alias-state-warn-primary)') : Tag('待认领', 'var(--dsw-alias-state-warn-primary)')),
              React.createElement('div', { style: s.gapSub }, '草稿在 .drafts/ 下；补全「原因 / 避坑」后让 agent 用 experience_promote 认领入库（会自动查重并同步分类 README）'),
            ))
          })
        }
        list.slice(0, 4).forEach(function (g, i) {
          nodes.push(React.createElement('div', { key: 'gap' + i, style: s.gapCard },
            React.createElement('div', { style: s.gapTitle }, g.id + ' × ' + g.count, Tag('无解法', 'var(--dsw-alias-state-warn-primary)')),
            React.createElement('div', { style: s.gapSub }, '反复出现，但库里还没有已确认的解法条目'),
            React.createElement('div', { style: s.gapBtns },
              g.sample ? React.createElement('button', { className: 'dsh-exp-btn', style: s.miniBtn, onClick: function () { doSearch(g.sample) } }, '查看相关') : null,
              React.createElement('button', { className: 'dsh-exp-btn', style: s.miniBtn, onClick: function () { submitCandidate('待补经验（签名 ' + g.id + '）: ' + (g.sample || g.id)) } }, '提交候选'),
            ),
          ))
        })
        missed.slice(0, 3).forEach(function (m, i) {
          nodes.push(React.createElement('div', { key: 'miss' + i, style: s.gapCard },
            React.createElement('div', { style: s.gapTitle }, '未命中：' + m.query),
            React.createElement('div', { style: s.gapSub }, '检索不到，可能缺条目或需换关键词'),
            React.createElement('div', { style: s.gapBtns },
              React.createElement('button', { className: 'dsh-exp-btn', style: s.miniBtn, onClick: function () { submitCandidate('未命中查询: ' + m.query) } }, '提交候选'),
            ),
          ))
        })
        return nodes
      }

      function homeView() {
        var nodes = []
        var libs = (data && data.libraries && data.libraries.length) ? data.libraries : null
        if (libs) {
          nodes.push(React.createElement('div', { key: 'lib-t', style: s.secTitle }, '按库浏览'))
          libs.forEach(function (lb, i) {
            nodes.push(React.createElement('div', {
              key: 'lib' + i, className: 'dsh-exp-row', style: s.row,
              onClick: function () {
                if (lb.dirs.length === 1) { setDir(lb.dirs[0].dir); setLib(null) } else { setLib(lb.id); setDir(null) }
                setContent(null); setHits(null); setInbox(null)
              },
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                React.createElement('span', { className: 'dsh-exp-chev' }, ChevronIcon(13)),
                React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, FolderIcon(15)),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', { style: s.title }, lb.name, Tag(String(lb.count), 'var(--dsw-alias-label-secondary)'),
                    lb.dirs.length > 1 ? Tag(lb.dirs.length + ' 个主题', 'var(--dsw-alias-label-secondary)') : null),
                  React.createElement('div', { style: s.sub }, lb.desc),
                ),
              ),
            ))
          })
        }
        if (data && data.guide.length) {
          nodes.push(React.createElement('div', { key: 'guide-t', style: s.secTitle }, '我要做什么'))
          data.guide.forEach(function (g, i) {
            nodes.push(React.createElement('div', { key: 'guide' + i, className: 'dsh-exp-row', style: s.row, onClick: function () { jumpToDir(g.target) } },
              React.createElement('div', { style: s.title }, g.scene),
              React.createElement('div', { style: s.sub }, g.target),
            ))
          })
        }
        gapsView().forEach(function (n) { nodes.push(n) })
        // 长尾索引不上首页（用户要求）：条目在各库内点进去即可见，统计仍在 /experience/stats。
        if (!libs && data && data.categories.length) {
          nodes.push(React.createElement('div', { key: 'c-t', style: s.secTitle }, '按主题浏览'))
          data.categories.forEach(function (cat, i) {
            nodes.push(React.createElement('div', { key: 'c' + i, className: 'dsh-exp-row', style: s.row, onClick: function () { setDir(cat.dir); setContent(null) } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, FolderIcon(15)),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', { style: s.title }, cat.dir, Tag(String(cat.count), 'var(--dsw-alias-label-secondary)')),
                  cat.summary && React.createElement('div', { style: s.sub }, cat.summary),
                ),
              ),
            ))
          })
        }
        if (data && data.similar && data.similar.length) {
          nodes.push(React.createElement('div', { key: 'sim-t', style: s.secTitle }, '内容重叠 · 建议核对'))
          data.similar.slice(0, 5).forEach(function (si, i) {
            nodes.push(React.createElement('div', {
              key: 'sim' + i,
              style: {
                padding: '4px 10px', margin: '2px 10px 4px', borderRadius: 6, fontSize: 11,
                color: 'var(--dsw-alias-state-warn-primary)',
                background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent)',
              },
            }, si.a.split('/').pop() + ' ↔ ' + si.b.split('/').pop() + '（' + si.score + '%）'))
          })
        }
        if (!data) nodes.push(React.createElement('div', { key: 'loading', style: { padding: 12, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, '加载中…'))
        return nodes
      }

      // 库视图：一个库下的所有"技术主题"目录。
      function libView(lb) {
        var nodes = []
        nodes.push(React.createElement('div', { key: 'ld-h', style: s.secTitle }, lb.name + ' · ' + lb.dirs.length + ' 个主题目录'))
        lb.dirs.forEach(function (d) {
          nodes.push(React.createElement('div', {
            key: 'ld' + d.dir, className: 'dsh-exp-row', style: s.row,
            onClick: function () { setDir(d.dir); setLib(null); setContent(null) },
          },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              React.createElement('span', { className: 'dsh-exp-chev' }, ChevronIcon(13)),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, FolderIcon(15)),
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('div', { style: s.title }, d.dir, Tag(String(d.count), 'var(--dsw-alias-label-secondary)')),
                d.summary && React.createElement('div', { style: s.sub }, d.summary),
              ),
            ),
          ))
        })
        return nodes
      }

      function catView(cat) {
        var nodes = []
        nodes.push(React.createElement('div', { key: 'cat-h', style: s.secTitle }, cat.dir + ' · ' + cat.count + ' 个文件'))
        cat.files.forEach(function (f) {
          var isIndex = f.role === 'index'
          nodes.push(React.createElement('div', { key: f.rel, className: 'dsh-exp-row', style: s.row, onClick: function () { openFile(f.rel) } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, isIndex ? IndexIcon(15) : FileIcon(15)),
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('div', { style: s.title },
                  f.title,
                  f.severity === 'critical' ? Tag('⚠ 最高危险', 'var(--dsw-alias-state-error-primary)') : null,
                  isIndex ? Tag('索引', 'var(--dsw-alias-label-secondary)') : null,
                  f.readCount ? Tag('读 ' + f.readCount, 'var(--dsw-alias-label-secondary)') : null,
                ),
                React.createElement('div', { style: s.sub }, f.rel),
              ),
            ),
          ))
        })
        if (!cat.files.length) nodes.push(React.createElement('div', { key: 'e', style: { padding: 12, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, '（空）'))
        return nodes
      }

      function hitsView() {
        if (!hits || !hits.items.length) {
          return [
            React.createElement('div', { key: 'n', style: { padding: 12, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, '没有匹配的经验'),
            React.createElement('div', { key: 'hint', style: { padding: '4px 12px 8px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
              '库中可能缺少这类经验，可提交候选供维护方确认入库。'),
            React.createElement('div', { key: 'b', style: { padding: '0 12px 12px' } },
              React.createElement('button', { className: 'dsh-exp-btn', style: s.btn, onClick: function () { submitCandidate() } }, '提交候选「' + (hits && hits.query ? hits.query : '') + '」')),
          ]
        }
        return hits.items.map(function (h) {
          var snip = String(h.snippet || '')
          var sm = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(snip)
          return React.createElement('div', { key: h.rel, className: 'dsh-exp-row', style: s.row, onClick: function () { openFile(h.rel) } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, FileIcon(15)),
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('div', { style: s.title }, h.title, statusTags(h)),
                React.createElement('div', { style: s.sub }, h.rel),
                snip && React.createElement('div', { style: { fontSize: 12, marginTop: 4, color: 'var(--dsw-alias-label-secondary)' } },
                  sm ? React.createElement('span', { style: { color: 'var(--dsw-alias-brand-primary, #3b6ef6)', fontWeight: 600, fontSize: 11 } }, sm[1] + ' ') : null,
                  sm ? sm[2] : snip),
              ),
            ),
          )
        })
      }

      function contentView() {
        var parsed = splitEntry(content.text)
        var cmeta = content.meta || {}
        var metaBits = []
        if (cmeta.readCount) metaBits.push('阅读 ' + cmeta.readCount)
        if (typeof cmeta.confidence === 'number' && cmeta.confidence < 1) metaBits.push('可信度 ' + cmeta.confidence.toFixed(1))
        var sevMatch = /severity:\s*([a-z]+)/i.exec(content.text)
        var sev = sevMatch ? sevMatch[1].toLowerCase() : ''
        var fixSection = null
        for (var i = 0; i < parsed.sections.length; i++) {
          if (/避坑|解决|做法/.test(parsed.sections[i].name)) { fixSection = parsed.sections[i]; break }
        }
        var nodes = [
          React.createElement('div', { key: 'meta', style: s.chead },
            React.createElement('div', { style: s.ctitle }, parsed.title || content.rel.split('/').pop(),
              sev === 'critical' ? Tag('⚠ 最高危险', 'var(--dsw-alias-state-error-primary)') : null),
            React.createElement('div', { style: s.cpath }, content.rel + (metaBits.length ? ' · ' + metaBits.join(' · ') : '')),
            sev === 'critical' ? React.createElement('div', {
              style: {
                marginTop: 6, padding: '6px 9px', borderRadius: 6, fontSize: 12, lineHeight: 1.5,
                color: 'var(--dsw-alias-state-error-primary)',
                background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)',
              },
            }, '⚠ 最高危险：对应「让 harness 整体不可用」的故障，动手前请先读完「避坑」再改。') : null,
          ),
          React.createElement('div', { key: 'actions', style: s.actionRow },
            React.createElement('button', { className: 'dsh-exp-btn', style: s.btn, onClick: function () { setContent(null) } }, '← 返回'),
            fixSection ? React.createElement('button', {
              className: 'dsh-exp-btn', style: s.btn,
              onClick: function () { copyText(fixSection.body.join('\n').trim()); setErr('已复制「' + fixSection.name + '」') },
            }, '复制避坑') : null,
            React.createElement('button', { className: 'dsh-exp-btn', style: s.btn, onClick: function () { flagFile(content.rel) } }, '标记有误/过时'),
          ),
        ]
        if (parsed.intro.trim()) {
          nodes.push(React.createElement('div', { key: 'intro', style: { margin: '0 10px 8px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } },
            mdBlocks(parsed.intro, 'intro')))
        }
        if (!parsed.sections.length) {
          nodes.push(React.createElement('div', { key: 'raw', style: { margin: '0 10px 12px' } }, mdBlocks(parsed.intro || content.text, 'raw')))
          return nodes
        }
        parsed.sections.forEach(function (sec, i) {
          var tone = sectionTone(sec.name)
          nodes.push(React.createElement('div', { key: 'sec' + i, style: s.sect },
            React.createElement('div', { style: Object.assign({}, s.sectHead, { color: tone.color }) },
              React.createElement('span', null, sec.name),
              /避坑|解决|做法/.test(sec.name)
                ? React.createElement('button', {
                    className: 'dsh-exp-btn', style: s.miniBtn,
                    onClick: function () { copyText(sec.body.join('\n').trim()); setErr('已复制「' + sec.name + '」') },
                  }, '复制')
                : null,
            ),
            React.createElement('div', { className: 'dsh-exp-sb', style: s.sectBody }, mdBlocks(sec.body.join('\n'), 'sb' + i)),
          ))
        })
        return nodes
      }

      function inboxView() {
        var nodes = [
          React.createElement('div', { key: 'meta', style: { padding: '4px 10px 0', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' } },
            '待确认候选 · 自动采集 + 面板提交'),
          React.createElement('div', { key: 'actions', style: s.actionRow },
            React.createElement('button', { className: 'dsh-exp-btn', style: s.btn, onClick: function () { setInbox(null) } }, '← 返回'),
          ),
        ]
        if (!inbox.length) {
          nodes.push(React.createElement('div', { key: 'empty', style: { padding: 12, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, '暂无候选'))
        }
        inbox.forEach(function (it) {
          var kv = []
          if (it.tool) kv.push('工具 ' + it.tool)
          if (it.query) kv.push('查询 ' + it.query)
          if (it.repeat > 1) kv.push('复发 ' + it.repeat + ' 次')
          var cls = it.cls || 'knowledge'
          if (it.clsReason) kv.push(it.clsReason)
          nodes.push(React.createElement('div', { key: it.id, className: 'dsh-exp-row', style: s.row },
            React.createElement('div', { style: s.title }, it.kind, Tag(new Date(it.ts).toLocaleString(), 'var(--dsw-alias-label-secondary)'),
              cls !== 'knowledge' ? Tag(cls === 'usage' ? '用法类' : '配置类', 'var(--dsw-alias-label-tertiary)') : null,
              it.repeat > 1 ? Tag('×' + it.repeat, 'var(--dsw-alias-state-warn-primary)') : null),
            React.createElement('div', { style: { fontSize: 12, marginTop: 4, color: 'var(--dsw-alias-label-secondary)' } }, it.message),
            kv.length ? React.createElement('div', { style: { fontSize: 11, marginTop: 4, color: 'var(--dsw-alias-label-tertiary)' } }, kv.join(' · ')) : null,
            it.fix ? React.createElement('pre', {
              style: { margin: '6px 0 0', padding: 6, borderRadius: 6, background: 'var(--dsw-alias-interactive-bg-hover)', fontSize: 11, overflowX: 'auto' },
            }, '修复证据: ' + it.fix) : null,
            React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
              cls === 'knowledge'
                ? React.createElement('button', { className: 'dsh-exp-btn', style: s.btn, onClick: function () { inboxDraft(it.id) } }, '生成草稿')
                : React.createElement('button', { className: 'dsh-exp-btn', style: s.btn, onClick: pruneInbox }, '归档用法类'),
              React.createElement('button', { className: 'dsh-exp-btn', style: s.btn, onClick: function () { inboxDismiss(it.id) } }, '忽略'),
            ),
          ))
        })
        return nodes
      }

      var gapCount = 0
      if (gaps && gaps.signatures) for (var gi = 0; gi < gaps.signatures.length; gi++) if (gaps.signatures[gi].gap) gapCount++

      // ── root render ──
      return React.createElement('div', { style: { display: 'inline-flex' } },
        wide
          ? React.createElement('button', {
              title: 'DSH 经验库', onClick: openPanel,
              onMouseEnter: function () { setHovered(true) },
              onMouseLeave: function () { setHovered(false) },
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: hovered ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
                color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: 1,
              },
            }, BookIcon(16), '经验库')
          : React.createElement('button', {
              title: 'DSH 经验库', onClick: openPanel,
              onMouseEnter: function () { setHovered(true) },
              onMouseLeave: function () { setHovered(false) },
              style: {
                width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: hovered ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
                color: 'var(--dsw-alias-label-primary)', padding: 0,
              },
            }, BookIcon(18)),

        open && React.createElement('div', { style: s.panel },
          React.createElement('div', { style: s.header },
            React.createElement('span', { style: { fontWeight: 600 } }, '经验库'),
            React.createElement('div', { style: { display: 'inline-flex', gap: 2, alignItems: 'center' } },
              React.createElement('button', {
                className: 'dsh-exp-iconbtn', title: '库的缺口 / 建议补写', onClick: function () { setInbox(null); setContent(null); setHits(null); setDir(null) }, style: s.iconBtn,
              }, '待办' + (gapCount > 0 ? ' ' + gapCount : '')),
              React.createElement('button', {
                className: 'dsh-exp-iconbtn', title: '待确认候选', onClick: openInbox, style: s.iconBtn,
              }, '候选' + (inboxCount > 0 ? ' ' + inboxCount : '')),
              React.createElement('button', {
                className: 'dsh-exp-iconbtn', title: '归档：库内已有条目覆盖 + 用法/配置类候选（不删除，进 meta.inboxArchive）', onClick: pruneInbox, style: s.iconBtn,
              }, '归档'),
              React.createElement('button', { className: 'dsh-exp-iconbtn', title: '刷新索引', onClick: refresh, style: s.iconBtn }, '刷新'),
              React.createElement('button', { className: 'dsh-exp-iconbtn', onClick: close, style: s.iconBtn }, '✕'),
            ),
          ),
          data && data.warnings && data.warnings.length > 0 && React.createElement('div', {
            style: {
              padding: '5px 12px', fontSize: 11, flex: '0 0 auto',
              borderBottom: '1px solid var(--dsw-alias-border-l1)',
              color: 'var(--dsw-alias-state-error-primary)',
              background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)',
            },
          }, '索引一致性：' + data.warnings.join('；')),
          React.createElement('div', { style: s.searchBar },
            React.createElement('input', {
              className: 'dsh-exp-input', value: q,
              onChange: function (e) { setQ(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') doSearch() },
              placeholder: '描述你的问题 / 粘贴报错原文', style: s.input,
            }),
            React.createElement('button', { className: 'dsh-exp-btn', onClick: function () { doSearch() }, style: s.btn }, '搜索'),
            React.createElement('button', { className: 'dsh-exp-btn', onClick: reset, style: s.btn }, '重置'),
          ),
          err && React.createElement('div', { style: { padding: '4px 12px', fontSize: 12, flex: '0 0 auto', color: 'var(--dsw-alias-label-secondary)' } }, err),
          breadcrumb(),
          React.createElement('div', { className: 'dsh-exp-list', style: s.list },
            inbox
              ? inboxView()
              : content
                ? contentView()
                : hits !== null
                  ? hitsView()
                  : activeCat
                    ? catView(activeCat)
                    : activeLib
                      ? libView(activeLib)
                      : homeView(),
          ),
        ),
      )
    }

    // 0.1.2+ 的 client 契约：必须声明 inject，否则访问受限 ctx 的服务会抛
    // `cannot get property "slots" without inject`；同时 ctx.get('slots') 会静默返回 undefined。
    exports.inject = ['slots']
    exports.apply = function (ctx) {
      ctx.effect ? ctx.effect(injectStyles) : injectStyles()
      var slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
      if (!slots) return
      slots.inject('sidebar.footer.action', function () {
        return slots.register(
          { name: 'sidebar.footer.action', id: 'experience', order: 200, label: '经验库' },
          function (ownerProps) {
            return React.createElement(ExperiencePanel, { ctx: ctx, wide: ownerProps && ownerProps.wide })
          },
        )
      })
    }
    return module.exports
  },
})
