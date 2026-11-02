import React from 'react';
import { HelloButton } from '../components/HelloButton';

function useStableItemOrder(items) {
  const itemIds = React.useMemo(() => items.map((item) => item.id), [items]);
  const [layoutOrder, setLayoutOrder] = React.useState(itemIds);

  React.useEffect(() => {
    setLayoutOrder((current) => {
      const currentSet = new Set(current);
      const next = current.filter((id) => itemIds.includes(id));
      itemIds.forEach((id) => {
        if (!currentSet.has(id)) {
          next.push(id);
        }
      });
      return next.length === itemIds.length ? next : itemIds;
    });
  }, [itemIds]);

  return [layoutOrder, setLayoutOrder, itemIds];
}

function DemoCard({ item, index, total, waveCount, onPromote }) {
  return (
    <article
      data-layout-id={item.id}
      data-layout-index={index}
      data-component-name="DemoCard"
      data-parent-component="LayoutPlayground"
      data-slot-name={`grid:${index}`}
      style={{
        display: 'grid',
        gap: '0.75rem',
        padding: '1rem',
        minHeight: 160,
        borderRadius: 18,
        border: '1px solid #d1d5db',
        background: 'linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)',
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
      }}
    >
  
      <header style={{ display: 'grid', gap: '0.25rem' }}>
        <small style={{ color: '#4b5563', fontWeight: 700 }}>
          slot {index + 1} / {total}
        </small>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{item.title}</h3>
      </header>
      <p style={{ margin: 0, color: '#374151' }}>{item.summary}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <HelloButton
          label={`Promote ${item.id}`}
          data-demo-button={item.id}
          data-testid={`promote-${item.id}`}
          onClick={() => onPromote(item.id)}
        />
        <span
          data-wave-count={waveCount}
          style={{
            padding: '0.35rem 0.6rem',
            borderRadius: 999,
            background: '#dbeafe',
            color: '#1d4ed8',
            fontSize: '0.85rem',
            fontWeight: 700,
          }}
        >
          wave {waveCount}
        </span>
        <code style={{ fontSize: '0.875rem', color: '#1f2937' }}>{`<DemoCard id="${item.id}" />`}</code>
      </div>
    </article>
  );
}

function LayoutStatePanel({ layoutOrder, pendingAction, onReset }) {
  return (
    <aside
      data-component-name="LayoutStatePanel"
      style={{
        display: 'grid',
        gap: '0.75rem',
        padding: '1rem',
        borderRadius: 18,
        background: 'rgba(255, 255, 255, 0.78)',
        border: '1px solid rgba(148, 163, 184, 0.45)',
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
      }}
    >
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        <h2 style={{ margin: 0, fontSize: 'inherit', fontWeight: 'inherit' }}>Interactive design mode</h2>
        <span style={{ color: '#475569', fontSize: '0.95rem' }}>
          Items stay constant. Only the UI layout order changes.
        </span>
      </div>
      <div style={{ display: 'grid', gap: '0.4rem' }}>
        <span style={{ fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Current rendered order
        </span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {layoutOrder.map((id) => (
            <span
              key={id}
              style={{
                padding: '0.35rem 0.6rem',
                borderRadius: 999,
                background: '#111827',
                color: '#ffffff',
                fontSize: '0.85rem',
              }}
            >
              {id}
            </span>
          ))}
        </div>
      </div>
      <div style={{ color: '#475569', fontSize: '0.9rem' }}>
        {pendingAction || 'Use markers to inspect components and review their resolved locations.'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={onReset}
          style={{
            border: '1px solid #0f172a',
            borderRadius: 10,
            padding: '0.55rem 0.85rem',
            background: '#ffffff',
            color: '#0f172a',
            cursor: 'pointer',
          }}
        >
          Reset UI order
        </button>
      </div>
    </aside>
  );
}

export function LayoutPlayground({ items, columns = 2 }) {
  const itemsById = React.useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const [layoutOrder, setLayoutOrder, itemIds] = useStableItemOrder(items);
  const [pendingAction, setPendingAction] = React.useState('');
  const [waveCount, setWaveCount] = React.useState(0);

  const renderedIds = React.useMemo(() => {
    const visible = layoutOrder.filter((id) => itemsById.has(id));
    itemIds.forEach((id) => {
      if (!visible.includes(id)) {
        visible.push(id);
      }
    });
    return visible;
  }, [itemIds, itemsById, layoutOrder]);

  const renderedItems = React.useMemo(() => renderedIds.map((id) => itemsById.get(id)).filter(Boolean), [itemsById, renderedIds]);

  const emitChange = React.useCallback(
    (action, nextOrder) => {
      globalThis.dispatchEvent(
        new CustomEvent('layout-playground:change', {
          detail: {
            action,
            layoutOrder: nextOrder,
          },
        }),
      );
    },
    [],
  );

  const promoteCard = React.useCallback(
    (itemId) => {
      setLayoutOrder((current) => {
        const nextOrder = current[0] === itemId
          ? [...current.slice(1), itemId]
          : [itemId, ...current.filter((id) => id !== itemId)];
        emitChange('promote', nextOrder);
        return nextOrder;
      });
      setWaveCount((current) => current + 1);
      setPendingAction(`Promoted ${itemId}. One click forced the grid to reconcile every card.`);
    },
    [emitChange, setLayoutOrder],
  );

  const resetLayout = React.useCallback(() => {
    setLayoutOrder(itemIds);
    setWaveCount(0);
    setPendingAction('UI order reset to the original component composition.');
    emitChange('reset', itemIds);
  }, [emitChange, itemIds, setLayoutOrder]);

  return (
    <main
      data-layout-root="playground"
      data-component-name="LayoutPlayground"
      style={{
        minHeight: '100vh',
        padding: '2rem',
        background: '#e5e7eb',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <section style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        <header style={{ display: 'grid', gap: '0.5rem' }}>
          <h1 style={{ margin: 0 }}>Layout playground</h1>
          <p style={{ margin: 0, color: '#374151', maxWidth: 760 }}>
            This story is in interactive design mode: the content items stay constant, while the rendered component layout can
            be re-composed by UI actions.
          </p>
        </header>

        <div
          data-layout-container="grid"
          data-component-name="CardGrid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: '1rem',
            alignItems: 'start',
          }}
        >
          {renderedItems.map((item, index) => (
            <DemoCard
              key={item.id}
              item={item}
              index={index}
              total={renderedItems.length}
              waveCount={waveCount}
              onPromote={promoteCard}
            />
          ))}
        </div>

        <LayoutStatePanel layoutOrder={renderedIds} pendingAction={pendingAction} onReset={resetLayout} />
      </section>
    </main>
  );
}
