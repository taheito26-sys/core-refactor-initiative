# Taheito UI: copyable examples

All examples assume the four CSS files in `assets/` are imported, in this order:

```ts
import '@/styles/customer-home.css';      // --q, --pad, ch-* pieces (card, pill, bell, avatar, nav)
import '@/styles/customer-orders.css';    // co-* pieces (hero, main card, chips, tools, tiles, cards)
import '@/styles/customer-theme.css';     // --th-* palette tokens, loaded after the two above
import '@/styles/customer-shipments.css'; // optional: example of a feature layer built on top
```

## Page shell

```tsx
<div className="ch-root co-root my-feature-root" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
  {isPhone && <PortalHero ... />}
  <div className="co-mainwrap">
    <div className="ch-card co-main">
      <div className="co-mtop">
        <div className="co-mlabel">Status</div>
        <button type="button" className="co-new"><Plus />New thing</button>
      </div>
      <div className="co-months">
        <button type="button" className="co-chip on">All <b>4</b></button>
        <button type="button" className="co-chip">Open <b>2</b></button>
      </div>
      <div className="co-tools">
        <label className="cs-search"><Search /><input placeholder="Search" /></label>
        <button type="button" className="co-tool"><Users />Drivers</button>
      </div>
      <div className="co-tiles">
        <button type="button" className="co-t t1"><div className="co-t-top"><span className="co-t-l">Label</span><span className="co-t-ic"><Icon /></span></div><div className="co-t-v">12</div></button>
      </div>
    </div>
  </div>
  <div className="cs-head"><span>All things <small>(4)</small></span></div>
  <div className="cs-list">{/* cards */}</div>
</div>
```

## Hero (phone only)

`PortalHero` takes the language, the user's name, the unread count and a title with a small status card on the
end side. It renders `co-hero2` > `co-hero2-bg`, `co-top` (zoom, bell, AR/EN pill), `co-idrow` (avatar and name),
`co-head` (`co-ttl` title with icon and subtitle, `co-grow` status card with the little bar-chart icon and an
up or down arrow). The status card is the one place to put a single headline fact: "2 need attention".

## List card (stripe card)

```tsx
<div role="button" tabIndex={0} className="co-card cs-card road" onClick={open}
     onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
  <div className="co-card-top">
    <span className="co-no">SH-0001</span>
    <span className="cs-cargo">Frozen fish</span>
    <span className="co-date" style={{ marginInlineStart: 'auto' }}>13 Nov</span>
    <span className="co-tag blue" style={{ marginInlineStart: 0 }}>On the road</span>
  </div>
  <div className="co-card-mid">
    <div className="co-amt-col"><div className="k">Now</div><div className="co-amt"><small>°C</small><b>-15</b></div></div>
    <div className="co-amt-col end"><div className="k">Target</div><div className="co-amt"><small>±3</small><b>-15</b></div></div>
  </div>
  <div className="cs-foot"><span className="cs-live live"><i />Last reading 18 min ago</span><span className="cs-go">Follow<ChevronRight /></span></div>
</div>
```

The stripe class on the card sets its colour: `prep` amber, `road` blue, `done` green, `void` grey, `alert` red (also
tints the card). Tags: `co-tag warn | ok | bad | blue | grey`.

## Side panel (sheet) in the same language

Sheets and dialogs render in a portal, outside `.ch-root`, so `--q` and the palette helpers are missing there.
Wrap the content in `<div className="ch-root co-root cs-sheet">` and use `cs-dh` (gradient header with the curved
corner), then `cs-dbody` holding `ch-card cs-box` sections (`h3` with an icon, optional `small` on the end side).
Use `[&>button]:text-white` on the sheet content so its close button shows on the dark header.
