/**
 * StressLab — a large tree for measuring Avalanche's own cost.
 *
 * A board of `columns` × `cardsPerColumn` cards. Each card renders about a
 * dozen components and receives fresh object and callback props on every
 * render, so a full re-render produces thousands of rendered fibers with prop
 * changes. Defaults give about 7,000 component fibers per full commit.
 *
 * Controls:
 * - "Re-render all" bumps the board's state; every card re-renders.
 * - "Re-render one column" bumps one column's state.
 * - "Mount/unmount" toggles half of the board.
 */
import React, { useCallback, useMemo, useState } from 'react';

function Avatar({ user, size }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: size, background: user.color }} />;
}

function Title({ text, meta }) {
  return <strong title={meta.hint}>{text}</strong>;
}

function CardHeader({ card, style }) {
  return (
    <div style={style}>
      <Avatar user={card.user} size={14} />
      <Title text={card.title} meta={{ hint: card.id }} />
    </div>
  );
}

function Label({ label, onSelect }) {
  return <span onClick={onSelect} style={{ marginRight: 2, fontSize: 9 }}>{label.name}</span>;
}

function Labels({ labels, onSelect }) {
  return (
    <div>
      {labels.map((label) => <Label key={label.name} label={label} onSelect={() => onSelect(label)} />)}
    </div>
  );
}

function Action({ name, onClick, options }) {
  return <button type="button" onClick={onClick} disabled={options.disabled} style={{ fontSize: 9 }}>{name}</button>;
}

function CardFooter({ card, tick, onAction }) {
  const options = useMemo(() => ({ disabled: false, tick }), [tick]);
  return (
    <div>
      <Action name="Edit" onClick={() => onAction('edit', card.id)} options={options} />
      <Action name="Move" onClick={() => onAction('move', card.id)} options={options} />
    </div>
  );
}

function Card({ card, tick, onAction }) {
  const onSelect = useCallback((label) => onAction('label', label.name), [onAction]);
  return (
    <div data-stress-card style={{ border: '1px solid #ddd', margin: 2, padding: 2, fontSize: 10 }}>
      <CardHeader card={card} style={{ display: 'flex', gap: 2 }} />
      <Labels labels={card.labels} onSelect={onSelect} />
      <CardFooter card={card} tick={tick} onAction={onAction} />
    </div>
  );
}

function Column({ index, cards, boardTick, onAction }) {
  const [columnTick, setColumnTick] = useState(0);
  const tick = boardTick + columnTick;
  return (
    <div style={{ width: 120, flex: '0 0 auto' }}>
      <button type="button" data-stress-column-rerender={index} onClick={() => setColumnTick((t) => t + 1)}>
        Re-render column {index}
      </button>
      {cards.map((card) => (
        <Card key={card.id} card={{ ...card, title: `${card.title} ${tick}` }} tick={tick} onAction={onAction} />
      ))}
    </div>
  );
}

const COLORS = ['#e57', '#5a7', '#57e', '#ea5', '#a5e'];

function buildCards(columns, cardsPerColumn) {
  return Array.from({ length: columns }, (_, c) => Array.from({ length: cardsPerColumn }, (_, i) => ({
    id: `C${c}-${i}`,
    title: `Card ${c}.${i}`,
    user: { color: COLORS[(c + i) % COLORS.length] },
    labels: [{ name: 'alpha' }, { name: 'beta' }, { name: `l${i % 7}` }],
  })));
}

export default function StressLab({ columns = 10, cardsPerColumn = 60 }) {
  const [tick, setTick] = useState(0);
  const [half, setHalf] = useState(false);
  const board = useMemo(() => buildCards(columns, cardsPerColumn), [columns, cardsPerColumn]);
  // A fresh callback on every board render, as many apps pass.
  const onAction = (kind, id) => { void kind; void id; };
  const shown = half ? board.slice(0, Math.ceil(board.length / 2)) : board;
  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <button type="button" data-stress-rerender onClick={() => setTick((t) => t + 1)}>Re-render all</button>
      <button type="button" data-stress-toggle onClick={() => setHalf((h) => !h)}>Mount/unmount half</button>
      <span data-stress-tick>{tick}</span>
      <div style={{ display: 'flex', overflow: 'auto' }}>
        {shown.map((cards, index) => (
          <Column key={index} index={index} cards={cards} boardTick={tick} onAction={onAction} />
        ))}
      </div>
    </div>
  );
}
